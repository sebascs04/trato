"""TeTrato's original proposal for an addendum version, kept for comparison with the saved terms.

The stored analysis is advisory: the revision remains the record of what the freelancer saved and sent.
"""
from typing import Literal
from uuid import NAMESPACE_URL,UUID,uuid5
from fastapi import APIRouter,Depends,Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel,ConfigDict,ValidationError
from starlette.concurrency import run_in_threadpool
from .business_routes import read_bytes
from .change_proposal import ChangeProposalService,Draft,revision_feedback_notes
from .errors import ApiError
from .persistence import Repository,uuid
from .ai_jobs import AIJobs
from .model_preferences import ModelPreferences
from .vector_contract import digest

class SaveAnalysis(BaseModel):
    model_config=ConfigDict(extra='forbid')
    change_proposal_job_id:UUID

def revision_scope(repo,owner,proposal_id,revision_id):
    rows=repo.rows('proposal_revisions',{'select':'id,proposal_id,project_id,owner_id','id':'eq.'+uuid(revision_id),'proposal_id':'eq.'+uuid(proposal_id),'owner_id':'eq.'+owner})
    if len(rows)!=1:raise ApiError('PROPOSAL_NOT_FOUND',404)
    proposals=repo.rows('change_proposals',{'select':'id,request_document_id,project_id','id':'eq.'+rows[0]['proposal_id'],'owner_id':'eq.'+owner})
    if len(proposals)!=1:raise ApiError('PROPOSAL_NOT_FOUND',404)
    return rows[0],proposals[0]

def analysis_record(service,repo,owner,job_id,proposal,revision=None):
    """Read the completed draft job directly: its request context changed when the proposal was created."""
    assistant=service.assistant
    data=assistant.jobs.input(owner,job_id)
    bound=data.get('change_proposal_context') or {}
    if data.get('action')!='draft_change' or data.get('project_id')!=proposal['project_id'] or bound.get('request_document_id')!=proposal['request_document_id']:
        raise ApiError('AI_CONTEXT_INVALID',409)
    job=assistant.jobs.get(owner,job_id,'project_assistant')
    if job['status']!='completed':raise ApiError('AI_PLAN_NOT_READY',409)
    result=assistant.validate_result(repo,owner,job_id,job['result'],draft_saved=True)
    if result.get('status')!='answered':raise ApiError('AI_CONTEXT_INVALID',409)
    if bound.get('feedback_document_id'):
        if revision is None or bound.get('proposal_id')!=proposal['id']:raise ApiError('AI_CONTEXT_INVALID',409)
        target=repo.rows('proposal_revisions',{'select':'revision_no,feedback_document_id,feedback_notes','id':'eq.'+revision['id'],'owner_id':'eq.'+owner})
        previous=repo.rows('proposal_revisions',{'select':'revision_no','id':'eq.'+bound['revision_id'],'proposal_id':'eq.'+proposal['id'],'owner_id':'eq.'+owner})
        expected_notes=revision_feedback_notes(bound,result['answer'])
        if (len(target)!=1 or len(previous)!=1 or target[0]['revision_no']!=previous[0]['revision_no']+1 or
            target[0]['feedback_document_id']!=bound['feedback_document_id'] or target[0]['feedback_notes']!=expected_notes):
            raise ApiError('AI_CONTEXT_INVALID',409)
    elif bound.get('feedback_portal_request_id'):
        # Same check for a version prepared from a client portal request.
        if revision is None or bound.get('proposal_id')!=proposal['id']:raise ApiError('AI_CONTEXT_INVALID',409)
        target=repo.rows('proposal_revisions',{'select':'revision_no,feedback_portal_request_id,feedback_notes','id':'eq.'+revision['id'],'owner_id':'eq.'+owner})
        previous=repo.rows('proposal_revisions',{'select':'revision_no','id':'eq.'+bound['revision_id'],'proposal_id':'eq.'+proposal['id'],'owner_id':'eq.'+owner})
        if (len(target)!=1 or len(previous)!=1 or target[0]['revision_no']!=previous[0]['revision_no']+1 or
            target[0]['feedback_portal_request_id']!=bound['feedback_portal_request_id'] or target[0]['feedback_notes']!=revision_feedback_notes(bound,result['answer'])):
            raise ApiError('AI_CONTEXT_INVALID',409)

    try:draft=Draft.model_validate(result['proposal'])
    except (ValidationError,KeyError):raise ApiError('AI_INVALID_RESPONSE',502) from None
    sources={s['source_id']:s for s in result['sources']}
    citations=[{'quote':c['quote'],'title':sources[c['source_id']]['title'],'file_id':sources[c['source_id']]['file_id'],'source_kind':sources[c['source_id']]['source_kind']}
               for c in result['citations'] if c['source_id'] in sources]
    return {'scope_summary':draft.scope_summary,'conditions':draft.conditions,'description':draft.description,
            'estimated_hours':draft.estimated_hours,'reasoning':result['answer'],'citations':citations}

class ReviewInput(BaseModel):
    model_config=ConfigDict(extra='forbid')
    output_language:Literal['es','en']

def saved_terms(repo,owner,revision):
    """The saved addendum terms that TeTrato reviews, and their fingerprint."""
    rows=repo.rows('proposal_revisions',{'select':'scope_summary,conditions,currency,additional_minor,deadline','id':'eq.'+revision['id'],'owner_id':'eq.'+owner})
    items=repo.rows('proposal_revision_items',{'select':'description,ordinal','revision_id':'eq.'+revision['id'],'order':'ordinal.asc','limit':1})
    if len(rows)!=1:raise ApiError('PROPOSAL_NOT_FOUND',404)
    r=rows[0];minor=int(r['additional_minor'])
    terms={'scope_summary':r['scope_summary'],'conditions':r.get('conditions') or '','description':items[0]['description'] if items else '',
           'additional_amount':f"{r.get('currency') or 'USD'} {minor//100}.{minor%100:02d}",'deadline':str(r['deadline'])}
    return terms,digest(terms)

def build_proposal_ai_router(settings,require_user,repository_factory=None,service=None,jobs=None,preferences=None):
    router=APIRouter(prefix='/api/v1/proposals');service=service or ChangeProposalService(settings)
    jobs=jobs or AIJobs();preferences=preferences or ModelPreferences()
    def repository(request:Request):return (repository_factory or Repository)(settings,request.headers.get('authorization',''))
    def stored(repo,revision):
        rows=repo.rows('proposal_revision_ai',{'select':'job_id,proposal,review,created_at','revision_id':'eq.'+revision['id']})
        return rows[0] if rows else None
    @router.post('/{proposal_id}/revisions/{revision_id}/ai-analysis/review')
    async def request_review(proposal_id:str,revision_id:str,request:Request,owner=Depends(require_user)):
        try:item=ReviewInput.model_validate_json(await read_bytes(request,1024))
        except (ValueError,ValidationError):raise ApiError('AI_INVALID_INPUT',422) from None
        repo=repository(request)
        revision,_=await run_in_threadpool(revision_scope,repo,owner,proposal_id,revision_id)
        row=await run_in_threadpool(stored,repo,revision)
        if row is None:raise ApiError('AI_NOT_FOUND',404)
        terms,fingerprint=await run_in_threadpool(saved_terms,repo,owner,revision)
        if (row.get('review') or {}).get('fingerprint')==fingerprint:
            return JSONResponse({'data':{'status':'completed','result':row['review']}},headers={'Cache-Control':'no-store'})
        original={k:row['proposal'].get(k) for k in ('scope_summary','conditions','description','estimated_hours')}
        data={'workflow':'change_review','output_language':item.output_language,'revision_id':revision['id'],'fingerprint':fingerprint,'original':original,'saved':terms,
              'model_id':await run_in_threadpool(preferences.for_request,request,owner)}
        # Reopening the analysis resumes the review of these exact terms; only an explicit retry sends a new key.
        key=request.headers.get('Idempotency-Key')
        job_id=uuid(key) if key else str(uuid5(NAMESPACE_URL,f"trato:change-review:{revision['id']}:{fingerprint}:{item.output_language}:{data['model_id']}"))
        job=await run_in_threadpool(jobs.enqueue,owner,job_id,data)
        return JSONResponse({'data':job},status_code=202,headers={'Cache-Control':'no-store'})
    @router.get('/{proposal_id}/revisions/{revision_id}/ai-analysis/review/{job_id}')
    async def collect_review(proposal_id:str,revision_id:str,job_id:UUID,request:Request,owner=Depends(require_user)):
        repo=repository(request)
        revision,_=await run_in_threadpool(revision_scope,repo,owner,proposal_id,revision_id)
        context=await run_in_threadpool(jobs.input,owner,str(job_id))
        if context.get('workflow')!='change_review' or context.get('revision_id')!=revision['id']:raise ApiError('AI_NOT_FOUND',404)
        job=await run_in_threadpool(jobs.get,owner,str(job_id))
        if job['status']!='completed':return JSONResponse({'data':job},headers={'Cache-Control':'no-store'})
        result=job['result']
        if result.get('kind')!='change_review' or result.get('fingerprint')!=context['fingerprint'] or not isinstance(result.get('material_change'),bool):raise ApiError('AI_INVALID_RESPONSE',502)
        _,fingerprint=await run_in_threadpool(saved_terms,repo,owner,revision)
        # A review of terms that were edited afterwards is never stored as the current review.
        if fingerprint!=context['fingerprint']:raise ApiError('AI_CONTEXT_CHANGED',409)
        review={k:result[k] for k in ('material_change','summary','changes','fingerprint','output_language','model')}
        await run_in_threadpool(repo.call,'PATCH','/rest/v1/proposal_revision_ai',params={'revision_id':'eq.'+revision['id']},json={'review':review})
        return JSONResponse({'data':{'status':'completed','result':review}},headers={'Cache-Control':'no-store'})
    @router.post('/{proposal_id}/revisions/{revision_id}/ai-analysis')
    async def save(proposal_id:str,revision_id:str,request:Request,owner=Depends(require_user)):
        try:item=SaveAnalysis.model_validate_json(await read_bytes(request,4096))
        except (ValueError,ValidationError):raise ApiError('AI_INVALID_INPUT',422) from None
        repo=repository(request)
        revision,proposal=await run_in_threadpool(revision_scope,repo,owner,proposal_id,revision_id)
        existing=await run_in_threadpool(repo.rows,'proposal_revision_ai',{'select':'job_id,proposal,created_at','revision_id':'eq.'+revision['id']})
        if existing:
            if existing[0]['job_id']!=str(item.change_proposal_job_id):raise ApiError('AI_CONFLICT',409)
            return JSONResponse({'data':existing[0]},headers={'Cache-Control':'no-store'})
        record=await run_in_threadpool(analysis_record,service,repo,owner,str(item.change_proposal_job_id),proposal,revision)
        await run_in_threadpool(repo.call,'POST','/rest/v1/proposal_revision_ai',json={'revision_id':revision['id'],'proposal_id':revision['proposal_id'],
            'project_id':revision['project_id'],'owner_id':owner,'job_id':str(item.change_proposal_job_id),'proposal':record})
        return JSONResponse({'data':{'job_id':str(item.change_proposal_job_id),'proposal':record}},status_code=201,headers={'Cache-Control':'no-store'})
    @router.get('/{proposal_id}/revisions/{revision_id}/ai-analysis')
    async def read(proposal_id:str,revision_id:str,request:Request,owner=Depends(require_user)):
        repo=repository(request)
        revision,_=await run_in_threadpool(revision_scope,repo,owner,proposal_id,revision_id)
        row=await run_in_threadpool(stored,repo,revision)
        if row is not None:
            _,fingerprint=await run_in_threadpool(saved_terms,repo,owner,revision)
            # Only a review of the current saved terms is shown; editing the draft makes it stale.
            row={**row,'review':row['review'] if (row.get('review') or {}).get('fingerprint')==fingerprint else None}
        return JSONResponse({'data':row},headers={'Cache-Control':'no-store'})
    return router
