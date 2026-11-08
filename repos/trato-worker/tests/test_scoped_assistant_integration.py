"""HTTP API -> worker tools -> vector gateway with a deliberately incomplete project.

Only the model and storage/providers are explicit doubles. No external service runs.
"""
import json,os,sys,unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4
import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient
from fastapi.responses import JSONResponse
sys.path.append(str(Path(__file__).resolve().parents[2]/'trato-api/tests'))
from test_summary_vectors import MixedSummaryRepo,SummaryStore
from test_vector_routes import MemoryRedis,MemoryRegistry,Processor,OWNER,PROJECT,FILE
from trato_api.errors import ApiError
from trato_api.project_assistant import ProjectAssistant,build_project_assistant_router
from trato_api.refund_assistant import refund_documents
from trato_api.vector_routes import VectorGateway
from trato_api.vector_contract import digest
from trato_worker.project_assistant import run_project_assistant
from trato_worker.source_tools import BackendToolClient,ToolError

from memory_test_support import TestMemory

class Repo(MixedSummaryRepo):
 def rows(self,table,params):
  if table=='clients':return [{'id':self.project(PROJECT)['client_id']}]
  return super().rows(table,params)
class Jobs:
 def __init__(self):self.row={};self.data=None;self.lease=str(uuid4())
 def enqueue(self,owner,id,data):
  self.id=id;self.data=data;self.row={'owner':owner,'status':'running','execution_id':self.lease,'input':json.dumps(data)}
  return {'id':id,'status':'queued'}
 def input(self,owner,id):
  if self.data is None or id!=self.id:raise ApiError('AI_NOT_FOUND',404)
  return self.data
 def connection(self):return self
 def hgetall(self,key):return self.row
 def hget(self,key,field):return self.row.get(field)
 def eval(self,*args):self.row['assistant_sources']=args[4];return 1
class Model:
 name='explicit-test-model'
 def __init__(self):self.calls=0
 def generate(self,messages,schema):
  self.calls+=1
  if self.calls<3:return {'type':'tool_call','tool':'search_document_summaries' if self.calls==1 else 'search_document_text','params':{'query':'payment conditions'}}
  record=json.loads(messages[-1]['content'])['tool_result']['data']['sources'][0]
  return {'type':'final','result':{'answer_basis':'documents','status':'answered','answer':'The selected agreement states its payment terms.',
    'citations':[{'source_id':record['source_id'],'quote':record['text']}],'missing_information':[]}}

@patch.dict(os.environ,{'TRATO_FILE_PROCESSING_ENABLED':'true','TRATO_VECTOR_SEARCH_ENABLED':'true','TRATO_WORKER_TOKEN':'worker'})
class ScopedAssistantIntegrationTests(unittest.TestCase):
 def test_explicit_scope_roundtrip_cites_ready_original_while_pending_stays_pending(self):
  repo=Repo();store=SummaryStore();gateway=VectorGateway(None,store=store,redis=MemoryRedis(),processor=Processor(),registry=MemoryRegistry())
  repo.summary={'summary':'Project payment and delivery terms.','topics':['payment'],'citations':[],
    'output_language':'en','model_identity':'test-model','source_fingerprint':'f'*64}
  repo.summary['summary_fingerprint']=digest(repo.summary)
  gateway.index(repo,OWNER,PROJECT,FILE)
  jobs=Jobs();service=ProjectAssistant(None,jobs=jobs,gateway=gateway,server=repo,memory=TestMemory())
  app=FastAPI();app.include_router(build_project_assistant_router(None,lambda:OWNER,
    repository_factory=lambda *args:repo,service=service,preferences=SimpleNamespace(for_request=lambda *args:'explicit-test-model')))
  @app.exception_handler(ApiError)
  async def error(_,e):return JSONResponse({'error':{'code':e.code}},status_code=e.status)
  with TestClient(app) as api:
   def handler(request):
    response=api.request(request.method,request.url.path,content=request.content,headers=dict(request.headers))
    return httpx.Response(response.status_code,json=response.json())
   client=BackendToolClient('http://api.invalid','worker',transport=httpx.MockTransport(handler))
   for selection in ([FILE],None):
    with self.subTest(selection=selection):
     body={'project_id':PROJECT,'question':'What are the payment terms?','output_language':'en'}
     if selection is not None:body['document_ids']=selection
     response=api.post('/api/v1/ai/project-questions',headers={'Idempotency-Key':str(uuid4())},json=body)
     self.assertEqual(response.status_code,202,response.text)
     model=Model()
     if selection is None:
      with self.assertRaisesRegex(ToolError,'VECTOR_SUMMARY_INDEX_INCOMPLETE'):
       run_project_assistant(jobs.data,model,client,jobs.id,jobs.lease)
      self.assertEqual(model.calls,1)
     else:
      result=run_project_assistant(jobs.data,model,client,jobs.id,jobs.lease)
      result=service.validate_result(repo,OWNER,jobs.id,result)
      self.assertEqual(result['status'],'answered')
      self.assertEqual(result['source_scope'],{'document_ids':[FILE],'complete_project':False})
      self.assertEqual({s['file_id'] for s in result['sources']},{FILE})
      self.assertEqual(result['sources'][0]['source_kind'],'original')
      self.assertIn(result['citations'][0]['quote'],repo.text)
      self.assertEqual(gateway.receipt(OWNER,repo.pending['id']),None)


@patch.dict(os.environ,{'TRATO_FILE_PROCESSING_ENABLED':'true','TRATO_VECTOR_SEARCH_ENABLED':'true','TRATO_WORKER_TOKEN':'worker'})
class RefundAssistantIntegrationTests(unittest.TestCase):
 def test_request_drafting_searches_only_selected_evidence(self):
  evidence={'id':FILE,'kind':'reference'}
  agreement={'id':str(uuid4()),'kind':'initial_agreement'}
  self.assertEqual(refund_documents([evidence,agreement],{FILE},{'task':'request'}),[evidence])

 def test_proposal_uses_verified_case_and_original_citation_then_revalidates_on_apply(self):
  settlement_id,payment_id=map(str,(uuid4(),uuid4()))
  class RefundRepo(Repo):
   status='draft'
   open_change=False
   def project(self,project):return {**super().project(project),'status':'active'}
   def rows(self,table,params):
    if table=='refund_settlements':
     if params.get('id')!='eq.'+settlement_id:return []
     return [{'id':settlement_id,'status':self.status,'scope':'payment_only','reason':'Client requested a refund.',
              'requested_by':'customer','request_evidence':[{'document_id':FILE}],'current_snapshot_id':None,'confirmed_refund_minor':None}]
    if table=='refund_settlement_payments':return [{'payment_id':payment_id}]
    if table=='project_received_payments':return [{'id':payment_id,'origin':'initial','amount_minor':10000,'currency':'USD'}]
    if table=='documents' and params.get('kind')=='eq.email_request':return [{'id':FILE}] if self.open_change else []
    if table in ('refund_financial_operations','refund_receipt_applications'):
     raise AssertionError('Drafting a proposal must not read financial operations')
    if table in ('request_closures','change_proposals','document_upload_contexts'):return []
    return super().rows(table,params)

  class RefundModel:
   name='explicit-test-model'
   def __init__(self):self.status_record=None
   def generate(self,messages,schema):
    payload=json.loads(messages[1]['content'])
    self.status_record=json.loads(payload['refund_record'])
    evidence={'source_index':0,'quote':payload['passages'][0]['text']}
    return {'answer':'Review the work you delivered.','next_step':'Confirm the value of the work.',
      'draft':{'conditions':'Review the terms before confirming.', 'evidence':evidence,
               'concepts':[{'type':'recognized_work','description':'Completed work','evidence':evidence}]}}


  repo=RefundRepo();store=SummaryStore();gateway=VectorGateway(None,store=store,redis=MemoryRedis(),processor=Processor(),registry=MemoryRegistry())
  repo.summary={'summary':'Project payment and delivery terms.','topics':['payment'],'citations':[],
    'output_language':'en','model_identity':'test-model','source_fingerprint':'f'*64}
  repo.summary['summary_fingerprint']=digest(repo.summary)
  gateway.index(repo,OWNER,PROJECT,FILE)
  jobs=Jobs();service=ProjectAssistant(None,jobs=jobs,gateway=gateway,server=repo,memory=TestMemory())
  app=FastAPI();app.include_router(build_project_assistant_router(None,lambda:OWNER,
    repository_factory=lambda *args:repo,service=service,preferences=SimpleNamespace(for_request=lambda *args:'explicit-test-model')))
  @app.exception_handler(ApiError)
  async def error(_,e):return JSONResponse({'error':{'code':e.code}},status_code=e.status)
  with TestClient(app) as api:
   def handler(request):
    response=api.request(request.method,request.url.path,content=request.content,headers=dict(request.headers))
    return httpx.Response(response.status_code,json=response.json())
   client=BackendToolClient('http://api.invalid','worker',transport=httpx.MockTransport(handler))
   body={'project_id':PROJECT,'question':'Can you prepare the refund?','output_language':'en',
         'refund_focus':{'step':2,'task':'proposal','settlement_id':str(uuid4())}}
   def enqueue():
    return api.post('/api/v1/ai/project-questions',headers={'Idempotency-Key':str(uuid4())},json=body)
   self.assertEqual(enqueue().status_code,404)
   body['refund_focus']['settlement_id']=settlement_id
   response=enqueue()
   self.assertEqual(response.status_code,202,response.text)
   model=RefundModel()
   run_project_assistant(jobs.data,model,client,jobs.id,jobs.lease)
   self.assertEqual(model.status_record['payments'][0]['amount_minor'],10000)
   path=f'/api/v1/projects/{PROJECT}/assistant/refund-suggestions/{jobs.id}'
   response=api.get(path)
   self.assertEqual(response.status_code,200,response.text)
   concept=response.json()['data']['guidance']['concepts'][0]
   self.assertEqual(concept['evidence'][0]['document_id'],FILE)
   self.assertIn(concept['evidence'][0]['quote'],repo.text)
   self.assertNotIn('amount_minor',concept)
   repo.status='awaiting_response'
   self.assertEqual(api.get(path).status_code,409)

   class IntakeModel:
    name='explicit-test-model'
    def generate(self,messages,schema):
     facts=json.loads(json.loads(messages[1]['content'])['record'])
     assert facts['payments'][0]['id']==payment_id and facts['open_change']
     return {'answer':'Review the request before saving.', 'next_step':'Attach the request.',
      'quote':None,'intake':{'scope':'payment_only','payment_id':payment_id,
      'requested_by':'customer','reason':'The customer cancelled.'}}
   repo.open_change=True
   body['refund_focus']={'step':1,'task':'intake'}
   body['question']='The customer cancelled and asked to refund the only payment.'
   response=enqueue()
   self.assertEqual(response.status_code,202,response.text)
   result=run_project_assistant(jobs.data,IntakeModel(),client,jobs.id,jobs.lease)
   self.assertEqual(result['tools_used'],['read_refund_status'])
   response=api.get(f'/api/v1/projects/{PROJECT}/assistant/refund-suggestions/{jobs.id}')
   self.assertEqual(response.status_code,200,response.text)
   self.assertEqual(response.json()['data']['guidance']['intake']['payment_id'],payment_id)

   class RequestModel:
    name='explicit-test-model'
    def generate(self,messages,schema):
     passages=json.loads(messages[1]['content'])['passages']
     assert passages and passages[0]['source_index']==0
     return {'answer':'Review this reason.',
             'draft':{'reason':'The customer cancelled.', 'source_index':0,'quote':passages[0]['text']}}
   body['refund_focus']={'step':1,'task':'request','evidence_ids':[FILE]}
   response=enqueue()
   self.assertEqual(response.status_code,202,response.text)
   result=run_project_assistant(jobs.data,RequestModel(),client,jobs.id,jobs.lease)
   self.assertEqual(result['tools_used'],['read_refund_status','search_document_text'])
   self.assertEqual(result['refund']['reason'],'The customer cancelled.')
   self.assertIn(result['citations'][0]['quote'],repo.text)

   conversation_id=str(uuid4())
   body['refund_focus']={'step':1,'task':'intake','conversation_id':conversation_id}
   response=enqueue()
   self.assertEqual(response.status_code,202,response.text)
   self.assertEqual(jobs.data['refund_history'],[])
   run_project_assistant(jobs.data,IntakeModel(),client,jobs.id,jobs.lease)
   response=enqueue()
   self.assertEqual(response.status_code,202,response.text)
   self.assertEqual(jobs.data['refund_history'],[{
    'question':body['question'],'answer':'Review the request before saving.'}])
