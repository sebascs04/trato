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
from test_vector_routes import MemoryRedis,Processor,OWNER,PROJECT,FILE
from trato_api.errors import ApiError
from trato_api.project_assistant import ProjectAssistant,build_project_assistant_router
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
  repo=Repo();store=SummaryStore();gateway=VectorGateway(None,store=store,redis=MemoryRedis(),processor=Processor())
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
