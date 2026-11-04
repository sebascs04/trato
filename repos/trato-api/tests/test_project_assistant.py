import json
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch
from uuid import uuid4
from trato_api.project_assistant import ProjectAssistant,Call,TOOLS
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
  self.data={'workflow':'project_assistant','owner_id':OWNER,'client_id':CLIENT,'project_id':PROJECT,'question':'Scope?'}
  self.row={'owner':OWNER,'status':'running','execution_id':self.lease,'input':json.dumps(self.data)}
  self.jobs=Jobs(self.row);self.service=ProjectAssistant(None,jobs=self.jobs,server=self.repo,gateway=SimpleNamespace())
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
  self.assertEqual(catalog['tools'],TOOLS)
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
