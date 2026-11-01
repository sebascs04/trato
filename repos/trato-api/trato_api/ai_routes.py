"""Authenticated AI jobs. The server, not the browser, supplies reputation context."""
from datetime import date
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

class ReputationInput(BaseModel):
    model_config=ConfigDict(extra='forbid')
    profile_id:UUID
    output_language:Literal['es','en']
class ProjectPlanInput(BaseModel):
    model_config=ConfigDict(extra='forbid')
    client_id:UUID
    draft_id:UUID
    output_language:Literal['es','en']
    brief:str=Field(min_length=1,max_length=4000)
    budget:Decimal=Field(gt=0,le=100000000,max_digits=11,decimal_places=2)
    target_date:date
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
            'target_date':item.target_date.isoformat(),'today':date.today().isoformat(),
            'reviews':reputation_context(repo,profile['id']) if profile else []}

def build_ai_router(settings,require_user,repository_factory=None,jobs=None,preferences=None):
    router=APIRouter(prefix='/api/v1/ai');jobs=jobs if jobs is not None else AIJobs()
    preferences=preferences if preferences is not None else ModelPreferences()
    def repository(request):return (repository_factory or Repository)(settings,request.headers.get('authorization',''))
    async def parse(request,cls):
        try:return cls.model_validate_json(await read_bytes(request,100000))
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
        item=await parse(request,ProjectPlanInput)
        data=await run_in_threadpool(plan_context,repository(request),item)
        return await enqueue(request,owner,{'workflow':'project_plan','output_language':item.output_language,**data})
    @router.post('/projects')
    async def create_project(request:Request,owner=Depends(require_user)):
        item=await parse(request,CreatePlannedProject)
        creation_key=uuid(request.headers.get('Idempotency-Key',''))
        job=await run_in_threadpool(jobs.get,owner,str(item.plan_job_id),'project_plan')
        context=await run_in_threadpool(jobs.input,owner,str(item.plan_job_id))
        if job['status']!='completed':raise ApiError('AI_PLAN_NOT_READY',409)
        if context['client_id']!=str(item.client_id) or context['draft_id']!=creation_key:raise ApiError('AI_PLAN_CONTEXT_MISMATCH',409)
        if sum(stage.percent for stage in item.stages)!=100:raise ApiError('AI_INVALID_PLAN',422)
        if not item.name.strip() or any(not st.title.strip() or not st.body.strip() or not st.when.strip() for st in item.stages):raise ApiError('AI_INVALID_PLAN',422)
        result=job['result']
        plan={**{key:context[key] for key in ('brief','budget','target_date','reviews','output_language')},
              **{key:result[key] for key in ('summary','observations','limitations','model')},
              'source_job_id':str(item.plan_job_id),'stages':[st.model_dump() for st in item.stages]}
        data=await run_in_threadpool(repository(request).rpc,'create_planned_project',{'p_key':creation_key,'p_client':str(item.client_id),'p_name':item.name.strip(),'p_plan':plan})
        return JSONResponse({'data':data},status_code=201,headers={'Cache-Control':'no-store'})
    @router.get('/projects/{project_id}/plan')
    async def get_plan(project_id:UUID,request:Request,owner=Depends(require_user)):
        repo=repository(request)
        await run_in_threadpool(repo.project,str(project_id))
        rows=await run_in_threadpool(repo.rows,'project_start_plans',{'select':'brief,budget,currency,target_date,summary,model,source_job_id,output_language,considerations,limitations,stages:project_start_stages!project_start_stages_plan_fk(position,title,deliverables,percent,payment_condition,amount)','project_id':'eq.'+str(project_id)})
        if not rows:raise ApiError('AI_PLAN_NOT_FOUND',404)
        plan=rows[0];plan['stages'].sort(key=lambda stage:stage['position'])
        return JSONResponse({'data':plan},headers={'Cache-Control':'no-store'})
    @router.get('/jobs/{job_id}')
    async def get(job_id:UUID,owner=Depends(require_user)):
        result=await run_in_threadpool(jobs.get,owner,str(job_id))
        return JSONResponse({'data':result},headers={'Cache-Control':'no-store'})
    return router
