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
class Call(Strict):
 execution_id:UUID
 tool:Literal['catalog','search_document_summaries','read_document_summary','search_document_text','search_conversation_history']
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
  if data.get('workflow')!='project_assistant' or data.get('owner_id')!=row.get('owner'):raise ApiError('AI_JOB_INVALID',502)
  repo=self.server if self.server is not None else ThreadStore(self.settings).repo
  project=self.scope(repo,row['owner'],data['project_id'],data['client_id'])
  from .case_assistant import validate_case_job
  validate_case_job(repo,row['owner'],data)
  if data.get('action')=='draft_change':
   from .change_proposal import validate_job_context
   validate_job_context(repo,row['owner'],data)
  return row,data,repo,project
 def catalog_files(self,repo,owner,project):
  result=[]
  for offset in range(0,1001,100):
   rows=repo.rows('documents',{'select':'id,title,kind','project_id':'eq.'+project['id'],'owner_id':'eq.'+owner,'order':'created_at.desc,id.asc','limit':100,'offset':offset})
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
  if item.tool=='catalog':
   if item.params:raise ApiError('AI_TOOL_INVALID',422)
   documents=self.catalog_files(repo,owner,project)
   selected=data.get('source_document_ids')
   if selected is not None:
    if not set(selected).issubset({document['id'] for document in documents}):raise ApiError('DOCUMENT_NOT_FOUND',404)
    documents=[document for document in documents if document['id'] in selected]
   return {'workflow':'project_assistant','project_id':project['id'],'tools':TOOLS+([MEMORY_TOOL] if data.get('memory') is not None else []),'documents':documents,
    **({'source_scope':{'document_ids':selected,'complete_project':False}} if selected is not None else {}),
    **({'case_context':data['case_context']} if data.get('case_context') else {})}
  if item.tool=='search_conversation_history':
   if data.get('memory') is None:raise ApiError('AI_TOOL_NOT_ALLOWED',422)
   try:params=Query.model_validate(item.params)
   except ValidationError:raise ApiError('AI_TOOL_INVALID',422) from None
   result=self.memory.call(owner,project['id'],'search',{'query':params.query,'revision':data['memory']['revision']})
   return {'sources':[],'messages':result['messages'],'project_id':project['id']}
  try:
   if item.tool=='read_document_summary':
    params=Document.model_validate(item.params)
    if data.get('source_document_ids') is not None and str(params.document_id) not in data['source_document_ids']:raise ApiError('DOCUMENT_NOT_FOUND',404)
    value=source(repo,owner,project,str(params.document_id))
    summary=self.gateway.summary(repo,{'id':str(params.document_id),'generation':value['generation']})
    if summary is None:raise ApiError('FILE_SUMMARY_NOT_READY',409)
    rows=[{'file_id':str(params.document_id),'title':value['document']['title'],'generation':value['generation'],
       'source_kind':'summary','summary_fingerprint':summary['summary_fingerprint'],'text':summary['summary'],'locator':None}]
   elif item.tool=='search_document_summaries':
    params=Query.model_validate(item.params)
    rows=self.gateway.search_summaries(repo,owner,project['id'],params.query,5,
      **({'file_ids':data['source_document_ids']} if data.get('source_document_ids') is not None else {}))['matches']
   elif item.tool=='search_document_text':
    params=TextQuery.model_validate(item.params)
    if params.document_ids and len(set(params.document_ids))!=len(params.document_ids):raise ApiError('AI_TOOL_INVALID',422)
    selected=[str(i) for i in params.document_ids] if params.document_ids else data.get('source_document_ids')
    if data.get('source_document_ids') is not None and not set(selected).issubset(data['source_document_ids']):raise ApiError('DOCUMENT_NOT_FOUND',404)
    result=self.gateway.search(repo,owner,project['id'],params.query,8,selected)
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
 def validate_result(self,repo,owner,job_id,result):
  if isinstance(result,dict) and result.get('project_id') and result.get('answer_basis') is not None:
   project=self.scope(repo,owner,result['project_id'])
   saved=self.memory.call(owner,project['id'],'turn',{'job_id':job_id})
   if saved:return saved['result']
  data=self.jobs.input(owner,job_id)
  if data.get('workflow')!='project_assistant':raise ApiError('AI_JOB_INVALID',502)
  project=self.scope(repo,owner,data['project_id'],data['client_id'])
  from .case_assistant import validate_case_job,validate_case_answer
  validate_case_job(repo,owner,data)
  if data.get('action')=='draft_change':
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
  checked={};canonical=[]
  for citation in result['citations']:
   if not isinstance(citation,dict) or set(citation)!={'source_id','quote'}:raise ApiError('AI_INVALID_CITATION',502)
   record=stored.get(citation['source_id']);quote=citation['quote']
   if record is None or not isinstance(quote,str) or not quote.strip() or quote not in record['text']:raise ApiError('AI_INVALID_CITATION',502)
   file_id=record['file_id']
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
  return {**{k:v for k,v in result.items() if k!='source_scope'},'question':data['question'],'sources':canonical,
   **({'conversation_context':{'document_ids':data.get('source_document_ids'),'change_proposal_job_id':data.get('change_proposal_job_id')}} if data.get('memory') is not None else {}),
    **({'source_scope':{'document_ids':data['source_document_ids'],'complete_project':False}} if data.get('source_document_ids') is not None else {}),
    **({'case_context':data['case_context']} if data.get('case_context') else {})}

def build_project_assistant_router(settings,require_user,repository_factory=None,service=None,preferences=None):
 router=APIRouter();service=service if service is not None else ProjectAssistant(settings)
 preferences=preferences if preferences is not None else ModelPreferences()
 def repository(request):return (repository_factory or Repository)(settings,request.headers.get('authorization',''))
 @router.post('/api/v1/ai/project-questions')
 async def question(request:Request,owner=Depends(require_user)):
  try:item=Question.model_validate_json(await read_bytes(request,50000))
  except (ValueError,ValidationError):raise ApiError('AI_INVALID_INPUT',422) from None
  if not item.question.strip():raise ApiError('AI_INVALID_INPUT',422)
  repo=repository(request);project=await run_in_threadpool(service.scope,repo,owner,str(item.project_id))
  selected=await run_in_threadpool(service.selected_documents,repo,owner,project,item.document_ids)
  job_id=uuid(request.headers.get('Idempotency-Key',''))
  saved=await run_in_threadpool(service.memory.call,owner,project['id'],'turn',{'job_id':job_id})
  if saved:
   if saved['result']['question']!=item.question.strip() or saved['result'].get('output_language')!=item.output_language or saved['result'].get('conversation_context',{}).get('document_ids')!=selected or saved['result'].get('conversation_context',{}).get('change_proposal_job_id')!=(str(item.change_proposal_job_id) if item.change_proposal_job_id else None):raise ApiError('AI_CONFLICT',409)
   return reply({'id':job_id,'status':'completed','result':saved['result']},202)
  try:
   old=await run_in_threadpool(service.jobs.input,owner,job_id)
  except ApiError as error:
   if error.code!='AI_NOT_FOUND':raise
  else:
   if old.get('workflow')!='project_assistant' or old.get('project_id')!=project['id'] or old.get('question')!=item.question.strip() or old.get('output_language')!=item.output_language or old.get('source_document_ids')!=selected or old.get('change_proposal_job_id')!=(str(item.change_proposal_job_id) if item.change_proposal_job_id else None):raise ApiError('AI_CONFLICT',409)
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
  data['thread']={'type':'thread','schema_version':1,'workflow':'project_assistant','action':'start','thread_id':job_id,
    'event_id':str(uuid5(NAMESPACE_URL,'trato:assistant:'+job_id)),'context':{'owner_id':owner,'project_id':project['id'],'client_id':project['client_id']}}
  job=await run_in_threadpool(service.jobs.enqueue,owner,job_id,data)
  if job['status']=='completed':job['result']=await run_in_threadpool(service.validate_result,repo,owner,job_id,job['result'])
  return reply(job,202)
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
   if outcome['project_id']!=project['id'] or outcome['output_language']!=data['output_language'] or not outcome['answer'].strip() or any(not item.strip() or len(item)>500 for item in outcome['missing_information']) or any(tool not in {t['name'] for t in TOOLS+[MEMORY_TOOL]} for tool in outcome['tools_used']):raise ApiError('AI_INVALID_RESPONSE',502)
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
