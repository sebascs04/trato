"""Durable, read-only assistant conversations bound to a real business revision."""
import json, os, secrets
from typing import Literal
from uuid import UUID, uuid5, NAMESPACE_URL
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator
from starlette.concurrency import run_in_threadpool
from .project_assistant import Strict, ProjectAssistant, reply
from .vector_routes import source
from .persistence import Repository, uuid
from .errors import ApiError
from .business_routes import read_bytes
from .thread_store import ThreadStore
from .model_preferences import ModelPreferences
from .ai_jobs import PREFIX


class CaseCitation(BaseModel):
    model_config=ConfigDict(extra='forbid',strict=True)
    source_id:str=Field(pattern=r'^[a-f0-9]{64}$')
    quote:str=Field(min_length=1,max_length=600)

class CaseAnswer(BaseModel):
    model_config=ConfigDict(extra='forbid',strict=True)
    kind:Literal['project_assistant']
    project_id:str=Field(pattern=r'^[a-f0-9-]{36}$')
    model:str=Field(min_length=1,max_length=200)
    output_language:Literal['es','en']
    tools_used:list[Literal['search_document_summaries','read_document_summary','search_document_text']]=Field(max_length=4)
    status:Literal['answered','insufficient_evidence']
    answer:str=Field(min_length=1,max_length=6000)
    citations:list[CaseCitation]=Field(max_length=6)
    missing_information:list[str]=Field(max_length=8)
    @model_validator(mode='after')
    def text_content(self):
        if not self.answer.strip() or any(not text.strip() or len(text)>500 for text in self.missing_information):raise ValueError('Invalid text')
        if any(not c.quote.strip() for c in self.citations):raise ValueError('Invalid quote')
        if self.status=='answered' and not self.citations:raise ValueError('Missing evidence')
        return self

def validate_case_answer(result):
    if not isinstance(result,dict):raise ApiError('AI_INVALID_RESPONSE',502)
    allowed={'question','sources','case_context','source_scope'}
    try:CaseAnswer.model_validate({k:v for k,v in result.items() if k not in allowed})
    except ValidationError:raise ApiError('AI_INVALID_RESPONSE',502) from None
    return result


class OpenSession(Strict):
    case_kind: Literal['change','refund']
    case_id: UUID
    output_language: Literal['es','en']

class Message(Strict):
    question: str = Field(min_length=1,max_length=4000)
    output_language: Literal['es','en']
    document_ids: list[UUID] | None = Field(default=None,min_length=1,max_length=100)

class Outcome(Strict):
    execution_id: UUID
    result: dict | None = None
    error_code: str | None = Field(default=None,pattern=r'^[A-Z][A-Z_0-9]{1,79}$')
    @model_validator(mode='after')
    def exclusive(self):
        if (self.result is None)==(self.error_code is None):raise ValueError('One outcome required')
        return self


def case_scope(repo, owner, kind, case_id):
    table,revision_table,parent_key,current=('change_proposals','proposal_revisions','proposal_id','current_revision_id') if kind=='change' else ('refund_settlements','refund_snapshots','settlement_id','current_snapshot_id')
    rows=repo.rows(table,{'select':'*','id':'eq.'+uuid(case_id),'owner_id':'eq.'+owner})
    if not rows:raise ApiError('AI_CASE_NOT_FOUND',404)
    record=rows[0]
    project=repo.project(record['project_id'])
    if project['owner_id']!=owner:raise ApiError('AI_CASE_NOT_FOUND',404)
    revision_id=record.get(current)
    revisions=repo.rows(revision_table,{'select':'*','id':'eq.'+uuid(revision_id),parent_key:'eq.'+record['id']}) if revision_id else []
    if not revisions and (revision_id or kind=='change'):raise ApiError('AI_CASE_REVISION_MISSING',409)
    revision=revisions[0] if revisions else None
    # Contractual values are records, not proof of provider balances/acceptance.
    record={k:v for k,v in record.items() if k in ('id','project_id','request_document_id','scope','reason','requested_by','status','current_revision_id','current_snapshot_id')}
    revision={k:v for k,v in revision.items() if k in ('id','revision_no','version_no','draft_sequence','scope_summary','conditions','currency','additional_minor','deadline','terms','calculation')} if revision else None
    return {'case_kind':kind,'case_id':record['id'],'revision_id':revision_id,'project_id':project['id'],'client_id':project['client_id']}, {'record':record,'revision':revision}


def validate_case_job(repo, owner, data):
    context=data.get('case_context')
    if context is None:return
    if not isinstance(context,dict):raise ApiError('AI_CONTEXT_INVALID',409)
    rows=repo.rows('case_assistant_sessions',{'select':'*','id':'eq.'+uuid(context.get('session_id')),'owner_id':'eq.'+owner})
    if not rows:raise ApiError('AI_CASE_NOT_FOUND',404)
    session=rows[0]
    if session['case_kind']=='refund':raise ApiError('AI_CASE_COMING_SOON',409)
    actual,_=case_scope(repo,owner,session['case_kind'],session['case_id'])
    if any(context.get(k)!=session.get(k) for k in ('case_kind','case_id','revision_id','project_id','client_id')):raise ApiError('AI_CONTEXT_INVALID',409)
    expected={k:context.get(k) for k in actual}
    if actual!=expected or session['revision_id']!=actual['revision_id'] or data.get('project_id')!=actual['project_id']:
        raise ApiError('AI_CASE_STALE',409)


class CaseAssistant:
    def __init__(self,settings,*,assistant=None,server=None):
        self.settings=settings;self.assistant=assistant or ProjectAssistant(settings);self.server=server
    def internal_repo(self):return self.server if self.server is not None else ThreadStore(self.settings).repo
    def revalidate_archive(self,repo,owner,project,result):
        validate_case_answer(result)
        selection=result.get('source_scope')
        if selection is not None:
            if (not isinstance(selection,dict) or set(selection)!={'document_ids','complete_project'} or
                selection['complete_project'] is not False or not isinstance(selection['document_ids'],list)):
                raise ApiError('AI_CONTEXT_INVALID',409)
            selected=self.assistant.selected_documents(repo,owner,project,selection['document_ids'])
            if selected!=selection['document_ids']:raise ApiError('AI_CONTEXT_INVALID',409)
        else:selected=None
        if result['project_id']!=project['id'] or not isinstance(result.get('question'),str) or not 1<=len(result['question'].strip())<=4000:raise ApiError('AI_INVALID_RESPONSE',502)
        if not isinstance(result.get('sources'),list) or len(result['sources'])>6:raise ApiError('AI_INVALID_RESPONSE',502)
        for record in result['sources']:
            if not isinstance(record,dict) or not {'source_id','file_id','generation','source_kind','title'}.issubset(record):raise ApiError('AI_INVALID_CITATION',502)
            if selected is not None and record['file_id'] not in selected:raise ApiError('AI_INVALID_CITATION',502)
        for citation in result.get('citations',[]):
            records=[r for r in result.get('sources',[]) if r.get('source_id')==citation.get('source_id')]
            if len(records)!=1:raise ApiError('AI_INVALID_CITATION',502)
            record=records[0];current=source(repo,owner,project,record['file_id'])
            if current['generation']!=record['generation']:raise ApiError('VECTOR_SOURCE_CHANGED',409)
            if record['source_kind']=='original':
                if not any(citation['quote'] in segment['text'] for segment in current['segments']):raise ApiError('AI_INVALID_CITATION',502)
            elif record['source_kind']=='summary':
                summary=self.assistant.gateway.summary(repo,{'id':record['file_id'],'generation':record['generation']})
                if summary is None or summary['summary_fingerprint']!=record.get('summary_fingerprint') or citation['quote'] not in summary['summary']:raise ApiError('FILE_SUMMARY_CHANGED',409)
            else:raise ApiError('AI_INVALID_CITATION',502)
        return result
    def check_message_scope(self,owner,message,selected):
        try:previous=self.assistant.jobs.input(owner,message['job_id']).get('source_document_ids')
        except ApiError as error:
            if error.code!='AI_NOT_FOUND':raise
            if message['status']!='completed' or not isinstance(message.get('result'),dict):raise ApiError('AI_JOB_EXPIRED',409) from None
            previous=message['result'].get('source_scope',{}).get('document_ids')
        if previous!=selected:raise ApiError('AI_CONFLICT',409)
    def session(self,repo,owner,session_id):
        rows=repo.rows('case_assistant_sessions',{'select':'*','id':'eq.'+uuid(session_id),'owner_id':'eq.'+owner})
        if not rows:raise ApiError('AI_CASE_NOT_FOUND',404)
        session=rows[0];scope,_=case_scope(repo,owner,session['case_kind'],session['case_id'])
        session['stale']=session['revision_id']!=scope['revision_id']
        session['messages']=repo.rows('case_assistant_messages',{'select':'id,job_id,status,question,output_language,result,error_code,created_at','session_id':'eq.'+session['id'],'order':'created_at.asc,id.asc','limit':101})
        if len(session['messages'])>100:raise ApiError('AI_CONTEXT_LIMIT',413)
        project=repo.project(session['project_id'])
        for message in session['messages']:
            if message['status']=='completed':
                expected={k:session[k] for k in ('project_id','client_id','case_kind','case_id','revision_id')}
                expected['session_id']=session['id']
                if message['result'].get('case_context')!=expected:raise ApiError('AI_CONTEXT_INVALID',409)
                self.revalidate_archive(repo,owner,project,message['result'])
        return session
    def finish(self,owner,job_id,*,result=None,error_code=None):
        return self.internal_repo().rpc('case_assistant_outcome',{'p_owner':owner,'p_job':job_id,'p_result':result,'p_error':error_code})
    def poll(self,repo,owner,session_id,job_id):
        session=self.session(repo,owner,session_id)
        rows=[m for m in session['messages'] if m['job_id']==job_id]
        if not rows:raise ApiError('AI_NOT_FOUND',404)
        message=rows[0]
        if message['status'] in ('completed','failed'):
            return {'id':job_id,'status':message['status'],**({'result':message['result']} if message['status']=='completed' else {'error_code':message['error_code']})}
        try:job=self.assistant.jobs.get(owner,job_id,'project_assistant')
        except ApiError as e:
            if e.code!='AI_NOT_FOUND':raise
            self.finish(owner,job_id,error_code='AI_JOB_EXPIRED')
            return {'id':job_id,'status':'failed','error_code':'AI_JOB_EXPIRED'}
        if job['status']=='completed':
            try:job['result']=self.assistant.validate_result(repo,owner,job_id,job['result'])
            except ApiError as e:
                self.finish(owner,job_id,error_code=e.code)
                return {'id':job_id,'status':'failed','error_code':e.code}
            self.finish(owner,job_id,result=job['result'])
        elif job['status']=='failed':self.finish(owner,job_id,error_code=job['error_code'])
        return job
    def complete(self,job_id,item):
        if item.error_code is not None:
            row=self.assistant.jobs.connection().hgetall(PREFIX+job_id)
            if row.get('status')!='running' or row.get('execution_id')!=str(item.execution_id):raise ApiError('AI_JOB_NOT_ACTIVE',409)
            try:data=json.loads(row['input'])
            except (KeyError,ValueError):raise ApiError('AI_JOB_INVALID',502) from None
            if data.get('workflow')!='project_assistant' or data.get('owner_id')!=row.get('owner'):raise ApiError('AI_JOB_INVALID',502)
            repo=self.internal_repo()
        else:row,data,repo,project=self.assistant.active_job(job_id,str(item.execution_id))
        if not data.get('case_context'):raise ApiError('AI_CONTEXT_INVALID',409)
        if item.result is not None:
            result=self.assistant.validate_result(repo,row['owner'],job_id,item.result)
            self.finish(row['owner'],job_id,result=result)
        else:self.finish(row['owner'],job_id,error_code=item.error_code)
        return {'stored':True}


def build_case_assistant_router(settings,require_user,repository_factory=None,service=None,preferences=None):
    router=APIRouter();service=service or CaseAssistant(settings);preferences=preferences or ModelPreferences()
    def repository(request):return (repository_factory or Repository)(settings,request.headers.get('authorization',''))
    async def parse(request,cls):
        try:return cls.model_validate_json(await read_bytes(request,24000))
        except ValueError:raise ApiError('AI_INVALID_INPUT',422) from None
    @router.post('/api/v1/ai/case-sessions')
    async def open_session(request:Request,owner=Depends(require_user)):
        item=await parse(request,OpenSession);repo=repository(request)
        if item.case_kind=='refund':raise ApiError('AI_CASE_COMING_SOON',409)
        scope,_=await run_in_threadpool(case_scope,repo,owner,item.case_kind,str(item.case_id))
        result=await run_in_threadpool(repo.rpc,'case_assistant_open',{'p_kind':item.case_kind,'p_case':str(item.case_id),'p_revision':scope['revision_id']})
        return reply(await run_in_threadpool(service.session,repo,owner,result['id']))
    @router.get('/api/v1/ai/case-sessions/{session_id}')
    async def get_session(session_id:UUID,request:Request,owner=Depends(require_user)):
        return reply(await run_in_threadpool(service.session,repository(request),owner,str(session_id)))
    @router.post('/api/v1/ai/case-sessions/{session_id}/messages')
    async def message(session_id:UUID,request:Request,owner=Depends(require_user)):
        item=await parse(request,Message);repo=repository(request);job_id=uuid(request.headers.get('Idempotency-Key',''))
        if not item.question.strip():raise ApiError('AI_INVALID_INPUT',422)
        session=await run_in_threadpool(service.session,repo,owner,str(session_id))
        if session['case_kind']=='refund':raise ApiError('AI_CASE_COMING_SOON',409)
        if session['stale']:raise ApiError('AI_CASE_STALE',409)
        project=await run_in_threadpool(repo.project,session['project_id'])
        selected=await run_in_threadpool(service.assistant.selected_documents,repo,owner,project,item.document_ids)
        old=next((m for m in session['messages'] if m['job_id']==job_id),None)
        if old:
            if old['question']!=item.question.strip() or old['output_language']!=item.output_language:raise ApiError('AI_CONFLICT',409)
            await run_in_threadpool(service.check_message_scope,owner,old,selected)
            return reply(await run_in_threadpool(service.poll,repo,owner,str(session_id),job_id),202)
        if any(m['status']=='queued' for m in session['messages']):raise ApiError('AI_CASE_BUSY',409)
        scope,mandatory=await run_in_threadpool(case_scope,repo,owner,session['case_kind'],session['case_id'])
        documents=await run_in_threadpool(repo.rows,'documents',{'select':'id','project_id':'eq.'+scope['project_id'],'owner_id':'eq.'+owner,'kind':'eq.initial_agreement','limit':101})
        if len(documents)>100:raise ApiError('AI_CONTEXT_LIMIT',413)
        if scope['revision_id']:
            linked=await run_in_threadpool(repo.rows,'proposal_revision_sources' if session['case_kind']=='change' else 'refund_sources',{'select':'document_id',('revision_id' if session['case_kind']=='change' else 'snapshot_id'):'eq.'+scope['revision_id'],'limit':101})
            if len(linked)>100:raise ApiError('AI_CONTEXT_LIMIT',413)
            for entry in linked:
                if not any(d['id']==entry['document_id'] for d in documents):documents.append({'id':entry['document_id']})
        request_id=mandatory['record'].get('request_document_id')
        if request_id and not any(d['id']==request_id for d in documents):documents.append({'id':request_id})
        mandatory['documents']=[]
        if selected is not None:
            mandatory['missing_document_ids']=sorted(document['id'] for document in documents if document['id'] not in selected)
            documents=[document for document in documents if document['id'] in selected]
        for document in documents:
            value=await run_in_threadpool(source,repo,owner,project,document['id'])
            mandatory['documents'].append({'document_id':document['id'],'generation':value['generation'],'segments':value['segments']})
        if len(json.dumps(mandatory).encode())>90000:raise ApiError('AI_CONTEXT_LIMIT',413)
        model=await run_in_threadpool(preferences.for_request,request,owner)
        history=[{'question':m['question'],'answer':m['result']['answer']} for m in session['messages'] if m['status']=='completed']
        if len(json.dumps(history).encode())>60000:raise ApiError('AI_CONTEXT_LIMIT',413)
        context={**scope,'session_id':session['id']}
        data={'workflow':'project_assistant','owner_id':owner,'project_id':scope['project_id'],'client_id':scope['client_id'],'question':item.question.strip(),'output_language':item.output_language,'model_id':model,'history':history,'case_context':context,'mandatory_context':mandatory}
        if selected is not None:data['source_document_ids']=selected
        data['thread']={'type':'thread','schema_version':1,'workflow':'project_assistant','action':'start','thread_id':job_id,'event_id':str(uuid5(NAMESPACE_URL,'trato:assistant:'+job_id)),'context':{'owner_id':owner,'project_id':scope['project_id'],'client_id':scope['client_id']}}
        # Reserve once in Postgres before any inference. Enqueue failure is durable and visible.
        await run_in_threadpool(repo.rpc,'case_assistant_message',{'p_session':session['id'],'p_job':job_id,'p_question':item.question.strip(),'p_language':item.output_language})
        try:job=await run_in_threadpool(service.assistant.jobs.enqueue,owner,job_id,data)
        except ApiError as e:
            await run_in_threadpool(service.finish,owner,job_id,error_code=e.code)
            raise
        return reply(job,202)
    @router.get('/api/v1/ai/case-sessions/{session_id}/messages/{job_id}')
    async def poll(session_id:UUID,job_id:UUID,request:Request,owner=Depends(require_user)):
        return reply(await run_in_threadpool(service.poll,repository(request),owner,str(session_id),str(job_id)))
    @router.post('/internal/case-assistant/{job_id}/complete')
    async def complete(job_id:UUID,request:Request):
        token=os.getenv('TRATO_WORKER_TOKEN','')
        if not token or not secrets.compare_digest(request.headers.get('authorization','').encode(),('Bearer '+token).encode()):raise ApiError('UNAUTHORIZED',401)
        item=await parse(request,Outcome)
        return reply(await run_in_threadpool(service.complete,str(job_id),item))
    return router
