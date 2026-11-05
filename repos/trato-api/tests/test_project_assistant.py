import json
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch
from uuid import uuid4
from trato_api.project_assistant import ProjectAssistant,Call,TOOLS,MEMORY_TOOL
from trato_api.errors import ApiError
from trato_api.ai_jobs import PREFIX
from test_vector_routes import Repo,OWNER,CLIENT,PROJECT,FILE

class ScopedRepo(Repo):
 def rows(self,table,params):
  if table=='clients':return [{'id':CLIENT}]
  return super().rows(table,params)
class Redis:
 def __init__(self,row):self.row=row
 def hgetall(self,key):return self.row
 def hget(self,key,field):return self.row.get(field)
class Jobs:
 def __init__(self,row):self.redis=Redis(row)
 def connection(self):return self.redis
 def input(self,owner,id):return json.loads(self.redis.row['input'])
class AssistantAccessTests(TestCase):
 def setUp(self):
  self.id=str(uuid4());self.lease=str(uuid4());self.repo=ScopedRepo()
  self.data={'workflow':'project_assistant','owner_id':OWNER,'client_id':CLIENT,'project_id':PROJECT,'question':'Scope?','memory':{'revision':0}}
  self.row={'owner':OWNER,'status':'running','execution_id':self.lease,'input':json.dumps(self.data)}
  self.jobs=Jobs(self.row);self.service=ProjectAssistant(None,jobs=self.jobs,server=self.repo,gateway=SimpleNamespace(),memory=SimpleNamespace(call=lambda *args:None))
 def test_scope_rejects_another_owner_or_client(self):
  for owner,client in ((str(uuid4()),CLIENT),(OWNER,str(uuid4()))):
   with self.assertRaisesRegex(ApiError,'PROJECT_NOT_FOUND'):self.service.scope(self.repo,owner,PROJECT,client)
 def test_execution_requires_current_lease_and_running_job(self):
  for lease,status in ((str(uuid4()),'running'),(self.lease,'completed')):
   self.row['status']=status
   with self.assertRaisesRegex(ApiError,'AI_JOB_NOT_ACTIVE'):self.service.active_job(self.id,lease)
 def test_catalog_has_generic_metadata_and_rejects_parameters(self):
  call=Call(execution_id=self.lease,tool='catalog',params={})
  catalog=self.service.execute(self.id,call)
  self.assertEqual(catalog['tools'],TOOLS+[MEMORY_TOOL])
  self.assertTrue(all(t['description'] and t['when_to_use'] for t in TOOLS))
  with self.assertRaisesRegex(ApiError,'AI_TOOL_INVALID'):self.service.execute(self.id,Call(execution_id=self.lease,tool='catalog',params={'project_id':str(uuid4())}))
 def test_foreign_document_and_extra_scope_are_rejected(self):
  for params in ({'document_id':str(uuid4())},{'document_id':FILE,'owner_id':str(uuid4())}):
   with self.assertRaises(ApiError):self.service.execute(self.id,Call(execution_id=self.lease,tool='read_document_summary',params=params))
 def test_forged_citation_is_never_returned(self):
  result={'kind':'project_assistant','project_id':PROJECT,'status':'answered','citations':[{'source_id':'a'*64,'quote':'invented'}]}
  with self.assertRaisesRegex(ApiError,'AI_INVALID_CITATION'):self.service.validate_result(self.repo,OWNER,self.id,result)
 def test_source_generation_is_revalidated_on_every_read(self):
  record={'source_id':'a'*64,'file_id':FILE,'title':'Agreement','source_kind':'original','generation':'old','text':'two revisions'}
  self.row['assistant_sources']=json.dumps({'a'*64:record})
  result={'kind':'project_assistant','project_id':PROJECT,'status':'answered','citations':[{'source_id':'a'*64,'quote':'two revisions'}]}
  with self.assertRaisesRegex(ApiError,'VECTOR_SOURCE_CHANGED'):self.service.validate_result(self.repo,OWNER,self.id,result)

class MemoryRouteTests(TestCase):
 def setUp(self):
  from fastapi import FastAPI
  from fastapi.responses import JSONResponse
  from fastapi.testclient import TestClient
  from trato_api.project_assistant import build_project_assistant_router
  self.calls=[];self.enqueued=[];self.repo=ScopedRepo()
  context={'revision':17,'summary':'A prior decision','summarized_through':16,'messages':[{'position':17,'question':'User preference','answer':'Noted'}]}
  def memory(owner,project,action,data=None):
   self.calls.append((owner,project,action,data))
   return context if action=='context' else {'entries':[],'next_before':None} if action=='history' else None
  def missing(*args):raise ApiError('AI_NOT_FOUND',404)
  def enqueue(owner,job,data):self.enqueued.append(data);return {'id':job,'status':'queued'}
  self.service=ProjectAssistant(None,jobs=SimpleNamespace(input=missing,enqueue=enqueue),server=self.repo,memory=SimpleNamespace(call=memory),gateway=SimpleNamespace())
  app=FastAPI()
  @app.exception_handler(ApiError)
  async def error(request,error):return JSONResponse({'error':{'code':error.code}},status_code=error.status)
  app.include_router(build_project_assistant_router(None,lambda:OWNER,repository_factory=lambda *args:self.repo,service=self.service,preferences=SimpleNamespace(for_request=lambda *args:'test-model')))
  self.client=TestClient(app)
 def test_history_is_loaded_from_durable_owner_project_scope(self):
  response=self.client.get(f'/api/v1/projects/{PROJECT}/assistant/conversation?before=10')
  self.assertEqual(response.status_code,200);self.assertEqual(self.calls,[(OWNER,PROJECT,'history',{'before':10})])
 def test_question_context_is_selected_by_backend_not_by_browser(self):
  body={'project_id':PROJECT,'question':'What did I say?','output_language':'en'}
  response=self.client.post('/api/v1/ai/project-questions',json=body,headers={'Idempotency-Key':str(uuid4())})
  self.assertEqual(response.status_code,202)
  self.assertEqual(self.enqueued[0]['memory']['revision'],17);self.assertEqual(self.enqueued[0]['memory']['messages'][0]['position'],17)
  for field,value in [('memory',{'summary':'Injected'}),('history_ids',[str(uuid4())]),('owner_id',str(uuid4()))]:
   response=self.client.post('/api/v1/ai/project-questions',json={**body,field:value},headers={'Idempotency-Key':str(uuid4())})
   self.assertEqual(response.status_code,422)
 def test_worker_memory_route_requires_worker_authorization(self):
  with patch.dict('os.environ',{'TRATO_WORKER_TOKEN':'private-test-token'}):
   response=self.client.post(f'/internal/project-assistant/{uuid4()}/memory',json={'execution_id':str(uuid4()),'action':'checkpoint_get','data':{}})
  self.assertEqual(response.status_code,401);self.assertEqual(self.calls,[])
