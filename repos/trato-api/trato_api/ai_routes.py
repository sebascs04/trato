"""Authenticated AI jobs. The server, not the browser, supplies reputation context."""
from datetime import date, datetime
from zoneinfo import ZoneInfo
from decimal import Decimal
from typing import Literal
from uuid import UUID
import json
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator
from starlette.concurrency import run_in_threadpool
from .persistence import Repository, uuid
from .business_routes import read_bytes
from .errors import ApiError
from .model_preferences import ModelPreferences
from .ai_jobs import AIJobs
from .reputation_usage import record_plan_usage

def project_today():
    return datetime.now(ZoneInfo('America/Lima')).date()

class ReputationInput(BaseModel):
    model_config=ConfigDict(extra='forbid')
    profile_id:UUID
    output_language:Literal['es','en']
class PlanStageTextInput(BaseModel):
    # Only the wording of a deliverable that has not started; amounts change through an addendum.
    model_config=ConfigDict(extra='forbid')
    title:str=Field(min_length=1,max_length=200)
    deliverables:str=Field(min_length=1,max_length=2000)
    payment_condition:str=Field(min_length=1,max_length=500)
class PlanSourceInput(BaseModel):
    # Text extracted without persistence by /api/v1/documents/extract; the original is uploaded only on confirmation.
    model_config=ConfigDict(extra='forbid')
    filename:str=Field(min_length=1,max_length=255)
    text:str=Field(min_length=1,max_length=60000)
class ProjectPlanInput(BaseModel):
    model_config=ConfigDict(extra='forbid')
    client_id:UUID
    draft_id:UUID
    output_language:Literal['es','en']
    brief:str=Field(min_length=1,max_length=4000)
    sources:list[PlanSourceInput]=Field(default_factory=list,max_length=5)
    # A project that started outside Trato: plan only the remaining work, for the remaining amount.
    ongoing:bool=False
    budget:Decimal=Field(gt=0,le=100000000,max_digits=11,decimal_places=2)
    target_date:date
    @field_validator('target_date')
    @classmethod
    def future_delivery(cls,value):
        if value < project_today():raise ValueError('Delivery date is in the past')
        return value
    @field_validator('brief')
    @classmethod
    def nonempty(cls,v):
        if not v.strip():raise ValueError('Empty brief')
        return v.strip()

class HumanStage(BaseModel):
    model_config=ConfigDict(extra='forbid',strict=True)
    title:str=Field(min_length=1,max_length=200)
    body:str=Field(min_length=1,max_length=2000)
    percent:int=Field(ge=1,le=100)
    when:str=Field(min_length=1,max_length=500)
class CreatePlannedProject(BaseModel):
    model_config=ConfigDict(extra='forbid')
    client_id:UUID
    name:str=Field(min_length=1,max_length=200)
    plan_job_id:UUID
    stages:list[HumanStage]=Field(min_length=1,max_length=8)
    review_job_id:UUID|None=None

class AttachPlan(BaseModel):
    # The plan of a project created without one (started outside Trato): same confirmation as CreatePlannedProject.
    model_config=ConfigDict(extra='forbid')
    plan_job_id:UUID
    stages:list[HumanStage]=Field(min_length=1,max_length=8)
    review_job_id:UUID|None=None

class ReviewPlanInput(BaseModel):
    model_config=ConfigDict(extra='forbid')
    plan_job_id:UUID
    stages:list[HumanStage]=Field(min_length=1,max_length=8)
    output_language:Literal['es','en']

def reputation_context(repo,profile_id):
    reviews=[];offset=0;seen=set()
    while True:
        result=repo.rpc('community_reputation',{'p_action':'detail','p_data':{'profile_id':str(profile_id),'offset':offset}})
        for review in result['reviews']:
            if review['id'] in seen:raise ApiError('AI_CONTEXT_INVALID',502)
            seen.add(review['id'])
            reviews.append({key:review[key] for key in ('id','version','body')})
        if len(json.dumps(reviews).encode())>500000:raise ApiError('AI_CONTEXT_LIMIT',413)
        next_offset=result.get('next_offset')
        if next_offset is None:return reviews
        if type(next_offset) is not int or next_offset<=offset:raise ApiError('AI_CONTEXT_INVALID',502)
        offset=next_offset

def plan_context(repo,item):
    client_id=str(item.client_id)
    clients=repo.rows('clients',{'select':'id,contact_email','id':'eq.'+client_id})
    if not clients:raise ApiError('CLIENT_NOT_FOUND',404)
    email=clients[0].get('contact_email')
    profile=repo.rpc('community_reputation',{'p_action':'lookup','p_data':{'public_email':email}}).get('client') if email else None
    return {'client_id':client_id,'draft_id':str(item.draft_id),'brief':item.brief,'budget':str(item.budget),
            'target_date':item.target_date.isoformat(),'today':project_today().isoformat(),
            'sources':[source.model_dump() for source in item.sources],
            'reviews':reputation_context(repo,profile['id']) if profile else [],
            **({'ongoing':True} if item.ongoing else {})}

def build_ai_router(settings,require_user,repository_factory=None,jobs=None,preferences=None,usage_writer=None):
    router=APIRouter(prefix='/api/v1/ai');jobs=jobs if jobs is not None else AIJobs()
    preferences=preferences if preferences is not None else ModelPreferences()
    def repository(request):return (repository_factory or Repository)(settings,request.headers.get('authorization',''))
    async def parse(request,cls,maximum=100000):
        try:return cls.model_validate_json(await read_bytes(request,maximum))
        except (ValidationError,ValueError):raise ApiError('AI_INVALID_INPUT',422) from None
    async def enqueue(request,owner,data):
        data['model_id']=await run_in_threadpool(preferences.for_request,request,owner)
        result=await run_in_threadpool(jobs.enqueue,owner,uuid(request.headers.get('Idempotency-Key','')),data)
        return JSONResponse({'data':result},status_code=202,headers={'Cache-Control':'no-store'})
    @router.post('/reputation')
    async def reputation(request:Request,owner=Depends(require_user)):
        item=await parse(request,ReputationInput)
        reviews=await run_in_threadpool(reputation_context,repository(request),str(item.profile_id))
        return await enqueue(request,owner,{'workflow':'reputation','profile_id':str(item.profile_id),'output_language':item.output_language,'reviews':reviews})
    @router.post('/project-plans')
    async def project_plan(request:Request,owner=Depends(require_user)):
        item=await parse(request,ProjectPlanInput,400000)
        data=await run_in_threadpool(plan_context,repository(request),item)
        return await enqueue(request,owner,{'workflow':'project_plan','output_language':item.output_language,**data})
    @router.post('/project-plans/review')
    async def review_plan(request:Request,owner=Depends(require_user)):
        item=await parse(request,ReviewPlanInput)
        original=await run_in_threadpool(jobs.get,owner,str(item.plan_job_id),'project_plan')
        context=await run_in_threadpool(jobs.input,owner,str(item.plan_job_id))
        if original['status']!='completed' or context.get('mode')=='review':raise ApiError('AI_PLAN_NOT_READY',409)
        stages=[st.model_dump() for st in item.stages]
        if sum(st.percent for st in item.stages)!=100 or any(not st.title.strip() or not st.body.strip() or not st.when.strip() for st in item.stages):raise ApiError('AI_INVALID_PLAN',422)
        # The original job already fixed the owner and client; authorize that client again.
        repo=repository(request)
        if not await run_in_threadpool(repo.rows,'clients',{'select':'id','id':'eq.'+context['client_id'],'owner_id':'eq.'+owner,'deleted_at':'is.null'}):raise ApiError('CLIENT_NOT_FOUND',404)
        data={k:context[k] for k in ('client_id','draft_id','brief','budget','target_date','reviews')}
        if context.get('ongoing') is True:data['ongoing']=True
        data['sources']=context.get('sources',[])
        return await enqueue(request,owner,{'workflow':'project_plan','mode':'review','source_plan_job_id':str(item.plan_job_id),'output_language':item.output_language,'today':project_today().isoformat(),**data,'original_stages':original['result']['stages'],'confirmed_stages':stages})
    @router.post('/projects')
    async def create_project(request:Request,owner=Depends(require_user)):
        item=await parse(request,CreatePlannedProject)
        creation_key=uuid(request.headers.get('Idempotency-Key',''))
        job=await run_in_threadpool(jobs.get,owner,str(item.plan_job_id),'project_plan')
        context=await run_in_threadpool(jobs.input,owner,str(item.plan_job_id))
        if job['status']!='completed' or context.get('mode')=='review':raise ApiError('AI_PLAN_NOT_READY',409)
        if context['client_id']!=str(item.client_id) or context['draft_id']!=creation_key:raise ApiError('AI_PLAN_CONTEXT_MISMATCH',409)
        if not item.name.strip():raise ApiError('AI_INVALID_PLAN',422)
        plan=await confirmed_plan(owner,item,job,context)
        data=await run_in_threadpool(repository(request).rpc,'create_planned_project',{'p_key':creation_key,'p_client':str(item.client_id),'p_name':item.name.strip(),'p_plan':plan})
        await run_in_threadpool(usage_writer or record_plan_usage,settings,owner,data['id'],str(item.plan_job_id),context)
        return JSONResponse({'data':data},status_code=201,headers={'Cache-Control':'no-store'})
    async def confirmed_plan(owner,item,job,context):
        # The stages the freelancer confirmed, checked against the AI job (and its review when they changed them).
        if sum(stage.percent for stage in item.stages)!=100:raise ApiError('AI_INVALID_PLAN',422)
        if any(not st.title.strip() or not st.body.strip() or not st.when.strip() for st in item.stages):raise ApiError('AI_INVALID_PLAN',422)
        result=job['result'];confirmed=[st.model_dump() for st in item.stages]
        original_proposal={'source_job_id':str(item.plan_job_id),'stages':result.get('stages',[]),'summary':result['summary'],'model':result['model']}
        if result.get('stages') is not None and confirmed!=result['stages']:
            if item.review_job_id is None:raise ApiError('AI_PLAN_REVIEW_REQUIRED',409)
            review=await run_in_threadpool(jobs.get,owner,str(item.review_job_id),'project_plan')
            review_input=await run_in_threadpool(jobs.input,owner,str(item.review_job_id))
            if review['status']!='completed' or review_input.get('mode')!='review' or review_input.get('source_plan_job_id')!=str(item.plan_job_id) or review_input.get('confirmed_stages')!=confirmed or review['result'].get('stages')!=confirmed:raise ApiError('AI_PLAN_CONTEXT_MISMATCH',409)
            result=review['result'];original_proposal.update(review_job_id=str(item.review_job_id),material_change=result['material_change'])
        plan={**{key:context[key] for key in ('brief','budget','target_date','reviews','output_language')},
              **{key:result[key] for key in ('summary','observations','limitations','model')},
              'source_job_id':str(item.plan_job_id),'original_proposal':original_proposal,'stages':[st.model_dump() for st in item.stages]}
        return plan
    @router.post('/projects/{project_id}/plan')
    async def attach_plan(project_id:UUID,request:Request,owner=Depends(require_user)):
        # A project that started outside Trato gets its Work plan later, from the same planning assistant.
        item=await parse(request,AttachPlan)
        repo=repository(request)
        project=await run_in_threadpool(repo.project,str(project_id))
        job=await run_in_threadpool(jobs.get,owner,str(item.plan_job_id),'project_plan')
        context=await run_in_threadpool(jobs.input,owner,str(item.plan_job_id))
        if job['status']!='completed' or context.get('mode')=='review':raise ApiError('AI_PLAN_NOT_READY',409)
        # The plan was drafted for this very project and its client, never another one.
        if context['draft_id']!=str(project_id) or context['client_id']!=str(project.get('client_id')):raise ApiError('AI_PLAN_CONTEXT_MISMATCH',409)
        plan=await confirmed_plan(owner,item,job,context)
        data=await run_in_threadpool(repo.rpc,'attach_project_plan',{'p_project':str(project_id),'p_plan':plan})
        await run_in_threadpool(usage_writer or record_plan_usage,settings,owner,str(project_id),str(item.plan_job_id),context)
        return JSONResponse({'data':data},status_code=201,headers={'Cache-Control':'no-store'})
    @router.get('/projects/{project_id}/plan')
    async def get_plan(project_id:UUID,request:Request,owner=Depends(require_user)):
        repo=repository(request)
        await run_in_threadpool(repo.project,str(project_id))
        rows=await run_in_threadpool(repo.rows,'project_start_plans',{'select':'brief,budget,currency,target_date,summary,model,source_job_id,output_language,considerations,limitations,stages:project_start_stages!project_start_stages_plan_fk(position,title,deliverables,percent,payment_condition,amount)','project_id':'eq.'+str(project_id)})
        if not rows:raise ApiError('AI_PLAN_NOT_FOUND',404)
        plan=rows[0];plan['stages'].sort(key=lambda stage:stage['position'])
        return JSONResponse({'data':plan},headers={'Cache-Control':'no-store'})
    @router.patch('/projects/{project_id}/plan/stages/{position}')
    async def edit_plan_stage(project_id:UUID,position:int,request:Request,owner=Depends(require_user)):
        if not 1<=position<=8:raise ApiError('PLAN_STAGE_NOT_FOUND',404)
        item=await parse(request,PlanStageTextInput,8000)
        if not item.title.strip() or not item.deliverables.strip() or not item.payment_condition.strip():raise ApiError('PLAN_STAGE_INVALID',422)
        data=await run_in_threadpool(repository(request).rpc,'edit_plan_stage',{'p_project':str(project_id),'p_position':position,
            'p_title':item.title,'p_deliverables':item.deliverables,'p_payment_condition':item.payment_condition})
        return JSONResponse({'data':data},headers={'Cache-Control':'no-store'})
    @router.get('/jobs/{job_id}')
    async def get(job_id:UUID,request:Request,owner=Depends(require_user)):
        result=await run_in_threadpool(jobs.get,owner,str(job_id))
        if result['status']=='completed' and result['result'].get('kind')=='change_reply':
            raise ApiError('AI_NOT_FOUND',404)
        if result['status']=='completed' and result['result'].get('kind')=='dispute_defense':
            from .disputes import completed_defense
            result['result']=await run_in_threadpool(completed_defense,jobs,repository(request),owner,str(job_id),result['result'])
        if result['status']=='completed' and result['result'].get('kind')=='invoice_concept':
            from .invoice_concept import validate_concept
            result['result']=validate_concept(result['result'])
        if result['status']=='completed' and result['result'].get('kind')=='section_help':
            from .section_help import completed_result
            result['result']=await run_in_threadpool(completed_result,jobs,owner,str(job_id),result['result'])
        if result['status']=='completed' and result['result'].get('kind')=='project_assistant':
            from .project_assistant import ProjectAssistant
            result['result']=await run_in_threadpool(ProjectAssistant(settings,jobs=jobs).validate_result,repository(request),owner,str(job_id),result['result'])
        return JSONResponse({'data':result},headers={'Cache-Control':'no-store'})
    return router
