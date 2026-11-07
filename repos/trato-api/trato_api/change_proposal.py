"""Read-only drafting assistance; human-reviewed terms use existing business commands."""
from decimal import Decimal, ROUND_HALF_UP
from typing import Literal
from uuid import UUID, uuid5, NAMESPACE_URL
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator
from starlette.concurrency import run_in_threadpool
from .business_routes import read_bytes
from .errors import ApiError
from .persistence import Repository, uuid
from .project_assistant import ProjectAssistant, reply
from .model_preferences import ModelPreferences
from .vector_routes import source
from .vector_contract import digest

class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
class Draft(Strict):
    scope_summary: str = Field(max_length=12000)
    conditions: str = Field(max_length=12000)
    description: str = Field(max_length=1000)
    estimated_hours: str | None = Field(pattern=r'^\d{1,5}(\.\d{1,2})?$', default=None)
    suggested_deadline: None = None
    @model_validator(mode='after')
    def hours(self):
        if self.estimated_hours is not None and not Decimal('0') < Decimal(self.estimated_hours) <= Decimal('10000'):
            raise ValueError('Invalid effort')
        return self
class Prepare(BaseModel):
    model_config=ConfigDict(extra='forbid')
    project_id: UUID
    request_document_id: UUID
    proposal_id: UUID | None = None
    revision_id: UUID | None = None
    output_language: Literal['es','en']
    question: str = Field(default='',max_length=4000)
    feedback_document_id: UUID | None = None
    feedback_notes: str = Field(default='',max_length=4000)
    document_ids: list[UUID] | None = Field(default=None,min_length=1,max_length=100)
    history_ids: list[UUID] = Field(default_factory=list,max_length=6)
class Price(Strict):
    rate_minor: int = Field(ge=0,le=99999999999)
    confirmed_hours: str = Field(pattern=r'^\d{1,5}(\.\d{1,2})?$')

def calculate_price(rate_minor, confirmed_hours):
    try: item=Price(rate_minor=rate_minor,confirmed_hours=confirmed_hours)
    except ValidationError: raise ApiError('AI_INVALID_INPUT',422) from None
    hours=Decimal(item.confirmed_hours)
    if not Decimal('0') < hours <= Decimal('10000'): raise ApiError('AI_INVALID_INPUT',422)
    total=int((Decimal(item.rate_minor)*hours).quantize(Decimal('1'),rounding=ROUND_HALF_UP))
    if total>99999999999: raise ApiError('INVALID_AMOUNT',422)
    return {'additional_minor':total,'currency':'USD','rate_minor':item.rate_minor,'confirmed_hours':item.confirmed_hours}

def context(repo, owner, project_id, request_document_id, proposal_id=None, revision_id=None, feedback_document_id=None, feedback_notes=''):
    project=repo.project(uuid(project_id))
    if project['owner_id']!=owner: raise ApiError('PROJECT_NOT_FOUND',404)
    value=source(repo,owner,project,uuid(request_document_id));doc=value['document']
    if doc['kind']!='email_request': raise ApiError('AI_CHANGE_REQUEST_REQUIRED',422)
    common={'project_id':'eq.'+project['id'],'owner_id':'eq.'+owner}
    rows=repo.rows('change_proposals',{'select':'id,current_revision_id,status,locked_at','request_document_id':'eq.'+doc['id'],**common})
    if len(rows)>1: raise ApiError('AI_CONTEXT_INVALID',409)
    proposal=rows[0] if rows else None
    if proposal_id and (not proposal or proposal['id']!=uuid(proposal_id)): raise ApiError('PROPOSAL_REVISION_CONFLICT',409)
    if revision_id and (not proposal or proposal['current_revision_id']!=uuid(revision_id)): raise ApiError('PROPOSAL_REVISION_CONFLICT',409)
    revising=feedback_document_id is not None
    if revising and (not proposal_id or not revision_id or not proposal):raise ApiError('AI_CONTEXT_INVALID',409)
    if proposal:
        if proposal.get('locked_at') or proposal['status']!=('ready_for_review' if revising else 'draft'): raise ApiError('CHANGE_READ_ONLY',409)
        deliveries=repo.rows('proposal_deliveries',{'select':'id','revision_id':'eq.'+proposal['current_revision_id'],
            'kind':'eq.adenda','status':'in.(sending,accepted_by_gmail,delivery_uncertain)',**common,'limit':1})
        if revising:
            sent=repo.rows('proposal_deliveries',{'select':'id','revision_id':'eq.'+proposal['current_revision_id'],'kind':'eq.adenda','status':'eq.accepted_by_gmail',**common,'limit':1})
            accepted=repo.rows('proposal_acceptances',{'select':'id','revision_id':'eq.'+proposal['current_revision_id'],**common,'limit':1})
            if not sent or accepted:raise ApiError('CHANGE_READ_ONLY',409)
        elif deliveries:raise ApiError('CHANGE_READ_ONLY',409)
        revisions=repo.rows('proposal_revisions',{'select':'*','id':'eq.'+proposal['current_revision_id'],
            'proposal_id':'eq.'+proposal['id'],**common})
        if len(revisions)!=1:raise ApiError('PROPOSAL_REVISION_CONFLICT',409)
        revision_fingerprint=digest(revisions[0])
    else:revision_fingerprint=None
    closures=repo.rows('request_closures',{'select':'request_document_id','request_document_id':'eq.'+doc['id'],**common,'limit':1})
    if closures: raise ApiError('CHANGE_READ_ONLY',409)
    agreements=repo.rows('documents',{'select':'id,sha256','kind':'eq.initial_agreement',**common,'order':'id.asc','limit':101})
    if len(agreements)>100: raise ApiError('AI_CONTEXT_LIMIT',413)
    heads=repo.rows('project_agreement_heads',{'select':'generation,acceptance_id',**common})
    result={'project_id':project['id'],'request_document_id':doc['id'],'request_generation':value['generation'],
        'baseline_document_ids':[row['id'] for row in agreements], 'proposal_id':proposal['id'] if proposal else None,
        'revision_id':proposal['current_revision_id'] if proposal else None}
    if revising:
        feedback=source(repo,owner,project,uuid(feedback_document_id))
        bindings=repo.rows('document_upload_contexts',{'select':'purpose,revision_id','document_id':'eq.'+uuid(feedback_document_id),**common})
        if feedback['document']['kind']!='reference' or len(bindings)!=1 or bindings[0]['purpose']!='addendum_adjustments' or bindings[0]['revision_id']!=proposal['current_revision_id']:
            raise ApiError('AI_CONTEXT_INVALID',409)
        result.update(feedback_document_id=uuid(feedback_document_id),feedback_generation=feedback['generation'],feedback_notes=feedback_notes.strip(),
            sent_terms={key:revisions[0].get(key) for key in ('scope_summary','conditions','additional_minor','currency','deadline','revision_no')})
    result['fingerprint']=digest([result,agreements,heads,proposal,revision_fingerprint])
    return result

def validate_job_context(repo,owner,data):
    bound=data.get('change_proposal_context')
    if bound is None:return
    if not isinstance(bound,dict): raise ApiError('AI_CONTEXT_INVALID',409)
    fresh=context(repo,owner,bound['project_id'],bound['request_document_id'],bound.get('proposal_id'),bound.get('revision_id'),bound.get('feedback_document_id'),bound.get('feedback_notes',''))
    if fresh!=bound: raise ApiError('AI_CONTEXT_CHANGED',409)

def validate_draft_result(data,result,canonical):
    from .case_assistant import CaseAnswer
    try:CaseAnswer.model_validate({k:v for k,v in result.items() if k not in ('proposal','sources','question','case_context','source_scope')})
    except ValidationError:raise ApiError('AI_INVALID_RESPONSE',502) from None
    if result['model']!=data['model_id'] or result['output_language']!=data['output_language']:raise ApiError('AI_INVALID_RESPONSE',502)
    try:draft=Draft.model_validate(result['proposal'])
    except (ValidationError,KeyError):raise ApiError('AI_INVALID_RESPONSE',502) from None
    if result['status']=='answered':
        bound=data['change_proposal_context'];originals={row['file_id'] for row in canonical if row['source_kind']=='original'}
        if (bound.get('feedback_document_id') and bound['feedback_document_id'] not in originals or bound['request_document_id'] not in originals or not originals.intersection(bound['baseline_document_ids']) or
            not draft.scope_summary.strip() or not draft.description.strip()):raise ApiError('AI_INVALID_CITATION',502)
    return draft

def revision_feedback_notes(bound,answer):
    return bound.get('feedback_notes') or answer.strip()[:4000].strip()

class ChangeProposalService:
    def __init__(self,settings,*,assistant=None):self.assistant=assistant or ProjectAssistant(settings)
    def result(self,repo,owner,job_id):
        data=self.assistant.jobs.input(owner,job_id)
        if data.get('action')!='draft_change':raise ApiError('AI_NOT_FOUND',404)
        validate_job_context(repo,owner,data)
        job=self.assistant.jobs.get(owner,job_id,'project_assistant')
        if job['status']!='completed':return job
        result=self.assistant.validate_result(repo,owner,job_id,job['result'])
        try:draft=Draft.model_validate(result['proposal'])
        except (ValidationError,KeyError):raise ApiError('AI_INVALID_RESPONSE',502) from None
        bound=data['change_proposal_context'];original_ids={s['file_id'] for s in result['sources'] if s['source_kind']=='original'}
        ready=result['status']=='answered'
        if ready and (bound.get('feedback_document_id') and bound['feedback_document_id'] not in original_ids or not draft.scope_summary.strip() or not draft.description.strip() or
            bound['request_document_id'] not in original_ids or not original_ids.intersection(bound['baseline_document_ids'])):
            raise ApiError('AI_INVALID_CITATION',502)
        job['result']={'kind':'change_proposal','project_id':data['project_id'],'request_document_id':bound['request_document_id'],
            'proposal_id':bound['proposal_id'],'revision_id':bound['revision_id'],'status':'ready' if ready else 'insufficient_evidence',
            **draft.model_dump(),'citations':result['citations'],'sources':result['sources'],
            **({'feedback_notes':revision_feedback_notes(bound,result['answer'])} if bound.get('feedback_document_id') else {}),
            'missing_information':result['missing_information'],'reasoning':result['answer'],
            **({'source_scope':result['source_scope']} if 'source_scope' in result else {})}
        return job

def build_change_proposal_router(settings,require_user,repository_factory=None,service=None,preferences=None):
    router=APIRouter();service=service or ChangeProposalService(settings);preferences=preferences or ModelPreferences()
    def repository(request):return (repository_factory or Repository)(settings,request.headers.get('authorization',''))
    async def parse(request,cls):
        try:return cls.model_validate_json(await read_bytes(request,24000))
        except ValueError:raise ApiError('AI_INVALID_INPUT',422) from None
    @router.post('/api/v1/ai/change-proposals')
    async def prepare(request:Request,owner=Depends(require_user)):
        item=await parse(request,Prepare);repo=repository(request)
        project=await run_in_threadpool(service.assistant.scope,repo,owner,str(item.project_id))
        bound=await run_in_threadpool(context,repo,owner,str(item.project_id),str(item.request_document_id),
            str(item.proposal_id) if item.proposal_id else None,str(item.revision_id) if item.revision_id else None,
            str(item.feedback_document_id) if item.feedback_document_id else None,item.feedback_notes)
        selected=await run_in_threadpool(service.assistant.selected_documents,repo,owner,project,item.document_ids)
        if bound.get('feedback_document_id') and selected is not None and bound['feedback_document_id'] not in selected:raise ApiError('AI_CONTEXT_INVALID',409)
        if len(set(item.history_ids))!=len(item.history_ids):raise ApiError('AI_CONTEXT_INVALID',409)
        history=[]
        for previous_id in item.history_ids:
            previous_id=str(previous_id)
            previous=await run_in_threadpool(service.assistant.jobs.get,owner,previous_id,'project_assistant')
            old=await run_in_threadpool(service.assistant.jobs.input,owner,previous_id)
            if previous['status']!='completed' or old['project_id']!=project['id']:raise ApiError('AI_CONTEXT_INVALID',409)
            old_context=old.get('change_proposal_context')
            if old_context and old_context['request_document_id']!=bound['request_document_id']:raise ApiError('AI_CONTEXT_INVALID',409)
            validated=await run_in_threadpool(service.assistant.validate_result,repo,owner,previous_id,previous['result'])
            history.append({'question':old['question'],'answer':validated['answer']})
        import json
        if len(json.dumps(history).encode())>60000:raise ApiError('AI_CONTEXT_LIMIT',413)
        model=await run_in_threadpool(preferences.for_request,request,owner);job_id=uuid(request.headers.get('idempotency-key',''))
        data={'workflow':'project_assistant','action':'draft_change','owner_id':owner,'project_id':project['id'],
            'client_id':project['client_id'],'model_id':model,'output_language':item.output_language,'question':item.question.strip(),
            'history':history,'change_proposal_context':bound}
        if selected is not None:data['source_document_ids']=selected
        data['thread']={'type':'thread','schema_version':1,'workflow':'project_assistant','action':'start','thread_id':job_id,
            'event_id':str(uuid5(NAMESPACE_URL,'trato:change-proposal:'+job_id)),
            'context':{k:data[k] for k in ('owner_id','client_id','project_id')}}
        job=await run_in_threadpool(service.assistant.jobs.enqueue,owner,job_id,data)
        if job['status']=='completed':job=await run_in_threadpool(service.result,repo,owner,job_id)
        return reply(job,202)
    @router.get('/api/v1/ai/change-proposals/{job_id}')
    def poll(job_id:UUID,request:Request,owner=Depends(require_user)):
        return reply(service.result(repository(request),owner,str(job_id)))
    @router.post('/api/v1/ai/change-proposals/{job_id}/price')
    async def price(job_id:UUID,request:Request,owner=Depends(require_user)):
        item=await parse(request,Price);job=await run_in_threadpool(service.result,repository(request),owner,str(job_id))
        if job['status']!='completed' or job['result']['status']!='ready':raise ApiError('AI_PROPOSAL_NOT_READY',409)
        return reply(calculate_price(item.rate_minor,item.confirmed_hours))
    return router
