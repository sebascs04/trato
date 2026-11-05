"""Generated and existing settlement PDFs enter the existing idempotent reading queue."""
from copy import deepcopy
import os
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient
from trato_api.errors import ApiError
from trato_api.refunds.routes import build_refund_router
from test_refund_api import uid

OWNER,PARENT,SNAPSHOT,DOCUMENT,PROJECT=map(uid,[1,2,3,4,5])

class Repo:
 def __init__(self):self.calls=[];self.requested=False;self.options=[];self.fail=False
 def document(self,id):return {'id':id,'project_id':PROJECT,'owner_id':OWNER}
 def rows(self,table,params):
  assert table=='file_processing_options'
  return deepcopy(self.options)
 def queue_document(self,id):
  self.calls.append(('queue',id))
  if self.fail:raise ApiError('ORIGINAL_NOT_STORED',409)
  self.requested=True
  return {'thread_id':uid(90),'status':'queued'}

class Workflow:
 def __init__(self,repo):self.repo=repo;self.originals=0;self.saved=None
 def pdf(self,repo,owner,parent,snapshot,language,key):
  if self.saved is None:
   self.originals+=1
   self.saved={'settlement':{'id':parent},'artifact':{'document_id':DOCUMENT,'sha256':'a'*64,'language':language}}
  repo.calls.append(('attached',DOCUMENT))
  return deepcopy(self.saved)

class RefundPdfReadingTests(TestCase):
 def setup_api(self):
  repo=Repo();workflow=Workflow(repo);app=FastAPI()
  app.include_router(build_refund_router(None,lambda:OWNER,repository_factory=lambda *args:repo,workflow=workflow))
  @app.exception_handler(ApiError)
  async def error(_,e):return JSONResponse({'error':{'code':e.code}},status_code=e.status)
  return repo,workflow,TestClient(app)
 def post(self,api):return api.post(f'/api/v1/refunds/{PARENT}/snapshots/{SNAPSHOT}/pdf',
  json={'language':'en'},headers={'Idempotency-Key':'same-original'})
 @patch.dict(os.environ,{'TRATO_FILE_PROCESSING_ENABLED':'false'})
 def test_new_and_existing_pdf_queue_same_original_after_attachment(self):
  repo,workflow,api=self.setup_api()
  with api:
   first=self.post(api);second=self.post(api)
  self.assertEqual(first.status_code,200,first.text);self.assertEqual(second.status_code,200,second.text)
  self.assertEqual(first.json(),second.json());self.assertEqual(workflow.originals,1)
  self.assertEqual(repo.calls,[('attached',DOCUMENT),('queue',DOCUMENT)]*2)
 @patch.dict(os.environ,{'TRATO_FILE_PROCESSING_ENABLED':'true'})
 def test_existing_analysis_options_are_preserved(self):
  repo,workflow,api=self.setup_api();repo.options=[{'document_id':DOCUMENT}]
  with patch('trato_api.file_processing.remember_options') as remember,api:
   response=self.post(api)
  self.assertEqual(response.status_code,200,response.text);remember.assert_not_called()
  self.assertTrue(repo.requested)
 @patch.dict(os.environ,{'TRATO_FILE_PROCESSING_ENABLED':'true'})
 def test_new_pdf_records_explicit_language_before_queue(self):
  repo,workflow,api=self.setup_api()
  def remember(settings,user_repo,document,language):
   self.assertEqual(language,'en');self.assertFalse(repo.requested)
   self.assertEqual(document['id'],DOCUMENT)
  with patch('trato_api.file_processing.remember_options',side_effect=remember) as registration,api:
   response=self.post(api)
  self.assertEqual(response.status_code,200,response.text);registration.assert_called_once()
  self.assertTrue(repo.requested)
 @patch.dict(os.environ,{'TRATO_FILE_PROCESSING_ENABLED':'false'})
 def test_failed_queue_is_visible_and_retry_reuses_saved_pdf(self):
  repo,workflow,api=self.setup_api();repo.fail=True
  with api:
   failed=self.post(api);repo.fail=False;retried=self.post(api)
  self.assertEqual(failed.status_code,409)
  self.assertEqual(failed.json()['error']['code'],'ORIGINAL_NOT_STORED')
  self.assertEqual(retried.status_code,200,retried.text)
  self.assertEqual(workflow.originals,1)
