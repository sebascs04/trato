"""Project-bound read tools and questions. No payment, email or mutation tools."""
from hashlib import sha256
import json,os,secrets,time
from typing import Literal
from uuid import UUID,uuid5,NAMESPACE_URL
from fastapi import APIRouter,Depends,Request,Query as QueryParam
from fastapi.responses import JSONResponse
from pydantic import BaseModel,ConfigDict,Field,ValidationError
from starlette.concurrency import run_in_threadpool
from redis.exceptions import RedisError
from .errors import ApiError
from .persistence import Repository,uuid
from .business_routes import read_bytes
from .thread_store import ThreadStore
from .ai_jobs import AIJobs,PREFIX
from .model_preferences import ModelPreferences
from .vector_routes import VectorGateway,source
from .vector_contract import digest
from .assistant_memory import AssistantMemory
from .plan_context import PLAN_TOOL,plan_source
from .project_status import STATUS_TOOL,status_source
from .refund_assistant import REFUND_TOOL, RefundFocus, Guidance, context as refund_context, refund_documents, materialize

MEMORY_TOOL={'name':'search_conversation_history','description':'Retrieves matching messages from the current conversation archive.','when_to_use':'Use when an earlier statement or detail is needed beyond the available conversation context.','parameters':{'type':'object','additionalProperties':False,'required':['query'],'properties':{'query':{'type':'string','minLength':1,'maxLength':4096}}}}
QUERY={'type':'string','minLength':1,'maxLength':4096}
TOOLS=[
 {'name':'search_document_summaries','description':'Searches processed document summaries.',
  'when_to_use':'Use when relevant documents need to be identified or understood at a high level.',
  'parameters':{'type':'object','additionalProperties':False,'required':['query'],
   'properties':{'query':QUERY}}},
 {'name':'read_document_summary','description':'Retrieves a processed summary for an authorized document.',
  'when_to_use':'Use when a high-level understanding of a known document is needed.',
  'parameters':{'type':'object','additionalProperties':False,'required':['document_id'],
   'properties':{'document_id':{'type':'string','format':'uuid'}}}},
 {'name':'search_document_text','description':'Searches original extracted document passages.',
  'when_to_use':'Use when an answer requires specific details, exact wording, or supporting evidence.',
  'parameters':{'type':'object','additionalProperties':False,'required':['query'],
   'properties':{'query':QUERY,'document_ids':{'type':'array','minItems':1,'maxItems':10,'uniqueItems':True,'items':{'type':'string','format':'uuid'}}}}}
]
class Strict(BaseModel):
 model_config=ConfigDict(extra='forbid')
class Question(Strict):
 project_id:UUID
 output_language:Literal['es','en']
 question:str=Field(min_length=1,max_length=4000)
 document_ids:list[UUID]|None=Field(default=None,min_length=1,max_length=100)
 change_proposal_job_id:UUID|None=None
 focus_request_id:UUID|None=None
 refund_focus:RefundFocus|None=None
 
class MemoryCitation(Strict):
 source_id:str=Field(pattern='^[a-f0-9]{64}$')
 quote:str=Field(min_length=1,max_length=600)
class MemoryAnswer(Strict):
 kind:Literal['project_assistant']
 project_id:UUID
 model:str=Field(min_length=1,max_length=200)
 output_language:Literal['es','en']
 tools_used:list[str]=Field(max_length=4)
 status:Literal['answered','insufficient_evidence']
 answer_basis:Literal['documents','conversation']
 answer:str=Field(min_length=1,max_length=6000)
 citations:list[MemoryCitation]=Field(max_length=6)
 missing_information:list[str]=Field(max_length=8)
 refund:Guidance|None=None
class Call(Strict):
 execution_id:UUID
 tool:Literal['catalog','search_document_summaries','read_document_summary','search_document_text','search_conversation_history','read_project_plan','read_project_status','read_refund_status']
 params:dict=Field(default_factory=dict)
class Query(Strict):
 query:str=Field(min_length=1,max_length=4096)
class TextQuery(Query):
 document_ids:list[UUID]|None=Field(default=None,min_length=1,max_length=10)
class Document(Strict):
 document_id:UUID

def reply(value,status=200):return JSONResponse({'data':value},status_code=status,headers={'Cache-Control':'no-store'})

class ProjectAssistant:
 def __init__(self,settings,*,jobs=None,gateway=None,server=None,memory=None):
  self.settings=settings;self.jobs=jobs if jobs is not None else AIJobs()
  self.memory=memory if memory is not None else AssistantMemory(settings,server)
  self.gateway=gateway if gateway is not None else VectorGateway(settings);self.server=server
 def scope(self,repo,owner,project_id,client_id=None):
  project=repo.project(uuid(project_id))
  if project['owner_id']!=owner or(client_id and project['client_id']!=client_id):raise ApiError('PROJECT_NOT_FOUND',404)
  clients=repo.rows('clients',{'select':'id','id':'eq.'+project['client_id'],'owner_id':'eq.'+owner,'deleted_at':'is.null'})
  if not clients:raise ApiError('PROJECT_NOT_FOUND',404)
  return project
 def active_job(self,job_id,execution_id):
  try:row=self.jobs.connection().hgetall(PREFIX+uuid(job_id))
  except RedisError:raise ApiError('AI_QUEUE_UNAVAILABLE',503) from None
  if not row or row.get('status')!='running' or row.get('execution_id')!=uuid(execution_id):raise ApiError('AI_JOB_NOT_ACTIVE',409)
  try:data=json.loads(row['input'])
  except (KeyError,ValueError):raise ApiError('AI_JOB_INVALID',502) from None
  # A dispute response reads the project's documents through these same authorized tools.
  if data.get('workflow') not in ('project_assistant','dispute_defense') or data.get('owner_id')!=row.get('owner'):raise ApiError('AI_JOB_INVALID',502)
  repo=self.server if self.server is not None else ThreadStore(self.settings).repo
  project=self.scope(repo,row['owner'],data['project_id'],data['client_id'])
  from .case_assistant import validate_case_job
  validate_case_job(repo,row['owner'],data)
  if data.get('action')=='draft_change':
   from .change_proposal import validate_job_context
   validate_job_context(repo,row['owner'],data)
  return row,data,repo,project
 def refund_record(self,repo,owner,project,focus):
  def financial_lookup(name,params):
   backend=self.server if self.server is not None else ThreadStore(self.settings).repo
   return backend.rpc(name,params)
  return refund_context(repo,owner,project,focus,financial_lookup=financial_lookup)
 def catalog_files(self,repo,owner,project):
  result=[]
  for offset in range(0,1001,100):
   rows=repo.rows('documents',{'select':'id,title,kind','deleted_at':'is.null','project_id':'eq.'+project['id'],'owner_id':'eq.'+owner,'order':'created_at.desc,id.asc','limit':100,'offset':offset})
   result.extend(rows)
   if len(result)>1000:raise ApiError('VECTOR_INVENTORY_LIMIT',413)
   if len(rows)<100:break
  return result
 def selected_documents(self,repo,owner,project,document_ids):
  if document_ids is None:return None
  selected=[uuid(str(value)) for value in document_ids]
  if not selected or len(selected)>100 or len(set(selected))!=len(selected):raise ApiError('AI_INVALID_INPUT',422)
  allowed={row['id'] for row in self.catalog_files(repo,owner,project)}
  if not set(selected).issubset(allowed):raise ApiError('DOCUMENT_NOT_FOUND',404)
  return sorted(selected)
 def execute(self,job_id,item):
  row,data,repo,project=self.active_job(job_id,str(item.execution_id));owner=row['owner']
  refund=data.get('refund_focus')
  refund_documents_allowed=set(data['refund_document_ids']) if refund else None
  intake=refund and refund['task']=='intake'
  if item.tool=='catalog':
   if item.params:raise ApiError('AI_TOOL_INVALID',422)
   documents=[] if intake else self.catalog_files(repo,owner,project)
   if refund:documents=[d for d in documents if d['id'] in refund_documents_allowed]
   selected=data.get('source_document_ids')
   if selected is not None:
    if not set(selected).issubset({document['id'] for document in documents}):raise ApiError('DOCUMENT_NOT_FOUND',404)
    documents=[document for document in documents if document['id'] in selected]
   return {'workflow':'project_assistant','project_id':project['id'],'tools':([] if intake else TOOLS)+([REFUND_TOOL] if refund else [])+([MEMORY_TOOL] if data.get('memory') is not None and (not refund or refund['task']=='guide' and not refund.get('conversation_id')) else [])+([PLAN_TOOL,STATUS_TOOL] if data.get('memory') is not None and not data.get('source_document_ids') and not data.get('case_context') and not refund else []),'documents':documents,
    **({'source_scope':{'document_ids':selected,'complete_project':False}} if selected is not None else {}),
    **({'case_context':data['case_context']} if data.get('case_context') else {})}
  if item.tool=='search_conversation_history':
   if data.get('memory') is None or refund and (refund['task']!='guide' or refund.get('conversation_id')):raise ApiError('AI_TOOL_NOT_ALLOWED',422)
   try:params=Query.model_validate(item.params)
   except ValidationError:raise ApiError('AI_TOOL_INVALID',422) from None
   result=self.memory.call(owner,project['id'],'search',{'query':params.query,'revision':data['memory']['revision']})
   return {'sources':[],'messages':result['messages'],'project_id':project['id']}
  try:
   if intake and item.tool!='read_refund_status':raise ApiError('AI_TOOL_NOT_ALLOWED',422)
   if refund and item.tool in ('read_project_plan','read_project_status'):raise ApiError('AI_TOOL_NOT_ALLOWED',422)
   if item.tool=='read_refund_status':
    if item.params or not refund:raise ApiError('AI_TOOL_NOT_ALLOWED',422)
    record=data['intake_record'] if intake else self.refund_record(repo,owner,project,refund)[0]
    if record['generation']!=data['refund_generation']:raise ApiError('REFUND_REVISION_CONFLICT',409)
    rows=[record]
   elif item.tool=='read_project_plan':
    if item.params or data.get('memory') is None or data.get('source_document_ids') or data.get('case_context'):raise ApiError('AI_TOOL_NOT_ALLOWED',422)
    record=plan_source(repo,owner,project);rows=[record] if record else []
   elif item.tool=='read_project_status':
    if item.params or data.get('memory') is None or data.get('source_document_ids') or data.get('case_context'):raise ApiError('AI_TOOL_NOT_ALLOWED',422)
    rows=[status_source(repo,owner,project)]
   elif item.tool=='read_document_summary':
    params=Document.model_validate(item.params)
    if data.get('source_document_ids') is not None and str(params.document_id) not in data['source_document_ids']:raise ApiError('DOCUMENT_NOT_FOUND',404)
    if refund and str(params.document_id) not in refund_documents_allowed:
     raise ApiError('DOCUMENT_NOT_FOUND',404)
    value=source(repo,owner,project,str(params.document_id))
    summary=self.gateway.summary(repo,{'id':str(params.document_id),'generation':value['generation']})
    if summary is None:raise ApiError('FILE_SUMMARY_NOT_READY',409)
    rows=[{'file_id':str(params.document_id),'title':value['document']['title'],'generation':value['generation'],
       'source_kind':'summary','summary_fingerprint':summary['summary_fingerprint'],'text':summary['summary'],'locator':None}]
   elif item.tool=='search_document_summaries':
    params=Query.model_validate(item.params)
    selected=data.get('source_document_ids')
    if refund:selected=sorted(refund_documents_allowed)
    rows=[] if selected==[] else self.gateway.search_summaries(repo,owner,project['id'],params.query,5,
      **({'file_ids':selected} if selected is not None else {}))['matches']
   elif item.tool=='search_document_text':
    params=TextQuery.model_validate(item.params)
    if params.document_ids and len(set(params.document_ids))!=len(params.document_ids):raise ApiError('AI_TOOL_INVALID',422)
    selected=[str(i) for i in params.document_ids] if params.document_ids else data.get('source_document_ids')
    if data.get('source_document_ids') is not None and not set(selected).issubset(data['source_document_ids']):raise ApiError('DOCUMENT_NOT_FOUND',404)
    if refund:
     if selected is not None and not set(selected).issubset(refund_documents_allowed):raise ApiError('DOCUMENT_NOT_FOUND',404)
     if selected is None:selected=sorted(refund_documents_allowed)
    result={'matches':[]} if selected==[] else self.gateway.search(repo,owner,project['id'],params.query,8,selected)
    rows=[{**r,'source_kind':'original'} for r in result['matches']]
   else:raise ApiError('AI_TOOL_NOT_ALLOWED',422)
  except ValidationError:raise ApiError('AI_TOOL_INVALID',422) from None
  sources=[]
  for row_source in rows:
   record={k:row_source[k] for k in ('file_id','title','generation','source_kind','text')}
   record.update({k:row_source[k] for k in ('locator','summary_fingerprint','segment_id','start_char','end_char') if k in row_source})
   record['source_id']=digest(record);sources.append(record)
  # Recheck the lease after retrieval before binding evidence to this execution.
  self.active_job(job_id,str(item.execution_id))
  connection=self.jobs.connection();key=PREFIX+job_id
  try:
   previous=json.loads(connection.hget(key,'assistant_sources') or '{}')
   for record in sources:previous[record['source_id']]=record
   if len(json.dumps(previous).encode())>300000:raise ApiError('AI_CONTEXT_LIMIT',413)
   stored=connection.eval("if redis.call('HGET',KEYS[1],'status')~='running' or redis.call('HGET',KEYS[1],'execution_id')~=ARGV[1] then return 0 end redis.call('HSET',KEYS[1],'assistant_sources',ARGV[2],'started_at',ARGV[3]) return 1",1,key,str(item.execution_id),json.dumps(previous,ensure_ascii=False),time.time())
   if stored!=1:raise ApiError('AI_JOB_NOT_ACTIVE',409)
  except RedisError:raise ApiError('AI_QUEUE_UNAVAILABLE',503) from None
  return {'sources':sources,'exhaustive_evidence':False}
 def validate_result(self,repo,owner,job_id,result,*,draft_saved=False):
  if isinstance(result,dict) and result.get('project_id') and result.get('answer_basis') is not None:
   project=self.scope(repo,owner,result['project_id'])
   saved=self.memory.call(owner,project['id'],'turn',{'job_id':job_id})
   if saved:return saved['result']
  data=self.jobs.input(owner,job_id)
  if data.get('workflow')!='project_assistant':raise ApiError('AI_JOB_INVALID',502)
  project=self.scope(repo,owner,data['project_id'],data['client_id'])
  from .case_assistant import validate_case_job,validate_case_answer
  validate_case_job(repo,owner,data)
  # Once its proposal is saved the request context has changed by design; proposal_ai checks project and request itself.
  if data.get('action')=='draft_change' and not draft_saved:
   from .change_proposal import validate_job_context
   validate_job_context(repo,owner,data)
  if data.get('case_context'):
   validate_case_answer(result)
   if result['output_language']!=data['output_language'] or result['model']!=data['model_id']:raise ApiError('AI_INVALID_RESPONSE',502)
  try:stored=json.loads(self.jobs.connection().hget(PREFIX+job_id,'assistant_sources') or '{}')
  except (RedisError,ValueError):raise ApiError('AI_QUEUE_UNAVAILABLE',503) from None
  if not isinstance(result,dict) or result.get('kind')!='project_assistant' or result.get('project_id')!=project['id'] or result.get('status') not in ('answered','insufficient_evidence') or not isinstance(result.get('citations'),list):raise ApiError('AI_INVALID_RESPONSE',502)
  if result.get('answer_basis','documents') not in ('documents','conversation'):raise ApiError('AI_INVALID_RESPONSE',502)
  if result['status']=='answered' and result.get('answer_basis','documents')!='conversation' and not result['citations']:raise ApiError('AI_INVALID_CITATION',502)
  refund=data.get('refund_focus')
  if bool(refund)!=(result.get('refund') is not None):raise ApiError('AI_INVALID_RESPONSE',502)
  if refund:
   if refund['task']=='intake':
    current=data['intake_record'];allowed=set()
   else:
    current,linked=self.refund_record(repo,owner,project,refund)
    allowed={d['id'] for d in refund_documents(self.catalog_files(repo,owner,project),linked,refund)}
   if current['generation']!=data['refund_generation']:raise ApiError('REFUND_REVISION_CONFLICT',409)
   if current['source_id'] not in stored:raise ApiError('AI_INVALID_CITATION',502)
  checked={};canonical=[]
  for citation in result['citations']:
   if not isinstance(citation,dict) or set(citation)!={'source_id','quote'}:raise ApiError('AI_INVALID_CITATION',502)
   record=stored.get(citation['source_id']);quote=citation['quote']
   if record is None or not isinstance(quote,str) or not quote.strip() or quote not in record['text']:raise ApiError('AI_INVALID_CITATION',502)
   file_id=record['file_id']
   if record['source_kind']=='refund_status':
    if not refund or current['source_id']!=record['source_id']:raise ApiError('AI_CONTEXT_INVALID',409)
    canonical.append({k:record[k] for k in ('source_id','file_id','title','source_kind','generation')});continue
   if refund and file_id not in allowed:raise ApiError('AI_INVALID_CITATION',502)
   if record['source_kind']=='status':
    # Business records can change between the tool call and the answer; cite only the current state.
    # Same server repository as the tool that produced the record, so both read identical business state.
    current=status_source(self.server if self.server is not None else ThreadStore(self.settings).repo,owner,project)
    if data.get('source_document_ids') or data.get('case_context') or current['source_id']!=record['source_id']:raise ApiError('AI_CONTEXT_INVALID',409)
    canonical.append({k:record[k] for k in ('source_id','file_id','title','source_kind','generation')});continue
   if record['source_kind']=='plan':
    current=plan_source(repo,owner,project)
    if data.get('source_document_ids') or data.get('case_context') or current is None or current['source_id']!=record['source_id']:raise ApiError('AI_CONTEXT_INVALID',409)
    canonical.append({k:record[k] for k in ('source_id','file_id','title','source_kind','generation')});continue
   if data.get('source_document_ids') is not None and file_id not in data['source_document_ids']:raise ApiError('AI_INVALID_CITATION',502)
   if file_id not in checked:checked[file_id]=source(repo,owner,project,file_id)
   if checked[file_id]['generation']!=record['generation']:raise ApiError('VECTOR_SOURCE_CHANGED',409)
   if record['source_kind']=='summary':
    current=self.gateway.summary(repo,{'id':file_id,'generation':record['generation']})
    if current is None or current['summary_fingerprint']!=record['summary_fingerprint']:raise ApiError('FILE_SUMMARY_CHANGED',409)
   canonical.append({k:record[k] for k in ('source_id','file_id','title','source_kind','generation','locator','summary_fingerprint') if k in record})
  if data.get('case_context') and result['status']=='answered' and not any(s['source_kind']=='original' for s in canonical):raise ApiError('AI_INVALID_CITATION',502)
  if data.get('action')=='draft_change':
   from .change_proposal import validate_draft_result
   validate_draft_result(data,result,canonical)
  guidance=materialize(refund,result,canonical,stored,checked,current) if refund else None
  return {**{k:v for k,v in result.items() if k not in ('source_scope','refund')},'question':data['question'],'sources':canonical,
   **({'refund':guidance,'refund_focus':refund,'refund_generation':data['refund_generation']} if refund else {}),
   **({'conversation_context':{'document_ids':data.get('source_document_ids'),'change_proposal_job_id':data.get('change_proposal_job_id'),'focus':data.get('focus')}} if data.get('memory') is not None else {}),
    **({'source_scope':{'document_ids':data['source_document_ids'],'complete_project':False}} if data.get('source_document_ids') is not None else {}),
    **({'case_context':data['case_context']} if data.get('case_context') else {})}

def focus_context(repo,owner,project,request_id):
 # Where the user is looking (a change request), verified against owner and project. Navigation context, not evidence.
 if request_id is None:return None
 rows=repo.rows('documents',{'select':'id,title','id':'eq.'+uuid(str(request_id)),'project_id':'eq.'+project['id'],'owner_id':'eq.'+owner,'kind':'eq.email_request','deleted_at':'is.null'})
 if len(rows)!=1:raise ApiError('DOCUMENT_NOT_FOUND',404)
 proposals=repo.rows('change_proposals',{'select':'current_revision_id','request_document_id':'eq.'+rows[0]['id'],'owner_id':'eq.'+owner})
 version=None
 if proposals and proposals[0].get('current_revision_id'):
  revisions=repo.rows('proposal_revisions',{'select':'revision_no','id':'eq.'+proposals[0]['current_revision_id'],'owner_id':'eq.'+owner})
  version=revisions[0]['revision_no'] if revisions else None
 return {'kind':'change_request','request_document_id':rows[0]['id'],'title':rows[0]['title'],'addendum_version':version}

def build_project_assistant_router(settings,require_user,repository_factory=None,service=None,preferences=None):
 router=APIRouter();service=service if service is not None else ProjectAssistant(settings)
 preferences=preferences if preferences is not None else ModelPreferences()
 def repository(request):return (repository_factory or Repository)(settings,request.headers.get('authorization',''))
 @router.post('/api/v1/ai/project-questions')
 async def question(request:Request,owner=Depends(require_user)):
  try:item=Question.model_validate_json(await read_bytes(request,50000))
  except (ValueError,ValidationError):raise ApiError('AI_INVALID_INPUT',422) from None
  if not item.question.strip() or item.refund_focus and (item.focus_request_id or item.change_proposal_job_id or item.document_ids):
   raise ApiError('AI_INVALID_INPUT',422)
  repo=repository(request);project=await run_in_threadpool(service.scope,repo,owner,str(item.project_id))
  selected=await run_in_threadpool(service.selected_documents,repo,owner,project,item.document_ids)
  focus=await run_in_threadpool(focus_context,repo,owner,project,item.focus_request_id)
  focus_id=focus['request_document_id'] if focus else None
  refund=item.refund_focus.model_dump(mode='json') if item.refund_focus else None
  if refund and refund['conversation_id'] is None:refund.pop('conversation_id')
  job_id=uuid(request.headers.get('Idempotency-Key',''))
  saved=await run_in_threadpool(service.memory.call,owner,project['id'],'turn',{'job_id':job_id})
  if saved:
   if saved['result'].get('refund_focus')!=refund or saved['result']['question']!=item.question.strip() or saved['result'].get('output_language')!=item.output_language or saved['result'].get('conversation_context',{}).get('document_ids')!=selected or saved['result'].get('conversation_context',{}).get('change_proposal_job_id')!=(str(item.change_proposal_job_id) if item.change_proposal_job_id else None) or (saved['result'].get('conversation_context',{}).get('focus') or {}).get('request_document_id')!=focus_id:raise ApiError('AI_CONFLICT',409)
   return reply({'id':job_id,'status':'completed','result':saved['result']},202)
  try:
   old=await run_in_threadpool(service.jobs.input,owner,job_id)
  except ApiError as error:
   if error.code!='AI_NOT_FOUND':raise
  else:
   if old.get('refund_focus')!=refund or old.get('workflow')!='project_assistant' or old.get('project_id')!=project['id'] or old.get('question')!=item.question.strip() or old.get('output_language')!=item.output_language or old.get('source_document_ids')!=selected or old.get('change_proposal_job_id')!=(str(item.change_proposal_job_id) if item.change_proposal_job_id else None) or (old.get('focus') or {}).get('request_document_id')!=focus_id:raise ApiError('AI_CONFLICT',409)
   existing=await run_in_threadpool(service.jobs.get,owner,job_id)
   if existing['status']=='completed':existing['result']=await run_in_threadpool(service.validate_result,repo,owner,job_id,existing['result'])
   return reply(existing,202)
  memory=await run_in_threadpool(service.memory.call,owner,project['id'],'context')
  model_id=await run_in_threadpool(preferences.for_request,request,owner)
  data={'workflow':'project_assistant','owner_id':owner,'project_id':project['id'],'client_id':project['client_id'],
       'question':item.question.strip(),'output_language':item.output_language,'memory':memory,'model_id':model_id,'change_proposal_job_id':str(item.change_proposal_job_id) if item.change_proposal_job_id else None}
  if item.change_proposal_job_id is not None:
   from .change_proposal import ChangeProposalService
   previous=await run_in_threadpool(ChangeProposalService(settings,assistant=service).result,repo,owner,str(item.change_proposal_job_id))
   if previous['status']!='completed' or previous['result']['project_id']!=project['id']:raise ApiError('AI_CONTEXT_INVALID',409)
   data['proposal_discussion']=previous['result']
  if selected is not None:data['source_document_ids']=selected
  if focus:data['focus']=focus
  if refund:
   documents=[] if refund['task']=='intake' else await run_in_threadpool(service.catalog_files,repo,owner,project)
   if refund['task']!='intake' and not set(refund['evidence_ids']).issubset({d['id'] for d in documents}):raise ApiError('DOCUMENT_NOT_FOUND',404)
   record,linked=await run_in_threadpool(service.refund_record,repo,owner,project,refund)
   data.update(refund_focus=refund,refund_generation=record['generation'],
    refund_document_ids=sorted(d['id'] for d in refund_documents(documents,linked,refund)))
   if refund['task']=='intake':data['intake_record']=record
   if refund.get('conversation_id') and refund['task'] in ('intake','guide'):
    page=await run_in_threadpool(service.memory.call,owner,project['id'],'history',{'before':memory['revision']+1})
    data['refund_history']=[{'question':entry['result']['question'],'answer':entry['result']['answer']}
      for entry in page['entries'] if (entry['result'].get('refund_focus') or {}).get('conversation_id')==refund['conversation_id']][-8:]
  data['thread']={'type':'thread','schema_version':1,'workflow':'project_assistant','action':'start','thread_id':job_id,
    'event_id':str(uuid5(NAMESPACE_URL,'trato:assistant:'+job_id)),'context':{'owner_id':owner,'project_id':project['id'],'client_id':project['client_id']}}
  job=await run_in_threadpool(service.jobs.enqueue,owner,job_id,data)
  if job['status']=='completed':job['result']=await run_in_threadpool(service.validate_result,repo,owner,job_id,job['result'])
  return reply(job,202)
 @router.get('/api/v1/projects/{project_id}/assistant/refund-suggestions/{job_id}')
 def refund_suggestion(project_id:UUID,job_id:UUID,request:Request,owner=Depends(require_user)):
  repo=repository(request);project=service.scope(repo,owner,str(project_id))
  saved=service.memory.call(owner,project['id'],'turn',{'job_id':str(job_id)})
  if not saved or not saved['result'].get('refund_focus'):raise ApiError('AI_NOT_FOUND',404)
  result=saved['result'];focus=result['refund_focus']
  record,linked=service.refund_record(repo,owner,project,focus)
  if record['generation']!=result['refund_generation']:raise ApiError('REFUND_REVISION_CONFLICT',409)
  allowed=set() if focus['task']=='intake' else {d['id'] for d in refund_documents(service.catalog_files(repo,owner,project),linked,focus)}
  for ref in result['sources']:
   if ref['source_kind']=='original':
    if ref['file_id'] not in allowed:raise ApiError('DOCUMENT_NOT_FOUND',404)
    if source(repo,owner,project,ref['file_id'])['generation']!=ref['generation']:raise ApiError('VECTOR_SOURCE_CHANGED',409)
  return reply({'focus':focus,'guidance':result['refund']})
 @router.get('/api/v1/projects/{project_id}/assistant/conversation')
 async def conversation(project_id:UUID,request:Request,before:int|None=QueryParam(default=None,ge=1),owner=Depends(require_user)):
  repo=repository(request);await run_in_threadpool(service.scope,repo,owner,str(project_id))
  return reply(await run_in_threadpool(service.memory.call,owner,str(project_id),'history',{'before':before} if before else {}))
 @router.post('/internal/project-assistant/{job_id}/memory')
 async def memory_action(job_id:UUID,request:Request):
  token=os.getenv('TRATO_WORKER_TOKEN','')
  if not token or not secrets.compare_digest(request.headers.get('authorization','').encode(),('Bearer '+token).encode()):raise ApiError('UNAUTHORIZED',401)
  try:body=json.loads(await read_bytes(request,2100000))
  except (ValueError,TypeError):raise ApiError('AI_INVALID_INPUT',422) from None
  if not isinstance(body,dict) or set(body)!={'execution_id','action','data'} or not isinstance(body['data'],dict):raise ApiError('AI_INVALID_INPUT',422)
  row,data,repo,project=await run_in_threadpool(service.active_job,str(job_id),uuid(body['execution_id']))
  action=body['action'];params=body['data']
  if action not in ('checkpoint_get','checkpoint_put','checkpoint_writes','commit'):raise ApiError('AI_TOOL_NOT_ALLOWED',422)
  if action=='commit':
   if set(params)!={'result','summary','summarized_through'} or not isinstance(params['summary'],str) or len(params['summary'].encode())>60000 or type(params['summarized_through']) is not int:raise ApiError('AI_MEMORY_INVALID',422)
   try:outcome=MemoryAnswer.model_validate(params['result']).model_dump(mode='json')
   except ValidationError:raise ApiError('AI_INVALID_RESPONSE',502) from None
   if outcome['project_id']!=project['id'] or outcome['output_language']!=data['output_language'] or not outcome['answer'].strip() or any(not item.strip() or len(item)>500 for item in outcome['missing_information']) or any(tool not in {t['name'] for t in TOOLS+[MEMORY_TOOL,PLAN_TOOL,STATUS_TOOL]+([REFUND_TOOL] if data.get('refund_focus') else [])} for tool in outcome['tools_used']):raise ApiError('AI_INVALID_RESPONSE',502)
   result=await run_in_threadpool(service.validate_result,repo,row['owner'],str(job_id),outcome)
   params={'question':data['question'],'answer':result,'revision':data['memory']['revision'],'summary':params['summary'],'summarized_through':params['summarized_through']}
  elif set(params)-{'checkpoint_id','payload','writes'}:raise ApiError('AI_MEMORY_INVALID',422)
  params={**params,'job_id':str(job_id)}
  return reply(await run_in_threadpool(service.memory.call,row['owner'],project['id'],action,params))
 @router.post('/internal/project-assistant/{job_id}/tools')
 async def tools(job_id:UUID,request:Request):
  token=os.getenv('TRATO_WORKER_TOKEN','')
  if not token:raise ApiError('AI_ASSISTANT_NOT_CONFIGURED',503)
  if not secrets.compare_digest(request.headers.get('authorization','').encode(),('Bearer '+token).encode()):raise ApiError('UNAUTHORIZED',401)
  try:item=Call.model_validate_json(await read_bytes(request,24000))
  except (ValueError,ValidationError):raise ApiError('AI_TOOL_INVALID',422) from None
  return reply(await run_in_threadpool(service.execute,str(job_id),item))
 return router
