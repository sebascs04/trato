from hashlib import sha256
import unittest
from unittest.mock import patch
import httpx
from fastapi.testclient import TestClient
from trato_api.app import create_app,Settings
from trato_api.errors import ApiError
from trato_api.persistence import Repository
from trato_api import reputation_evidence as evidence

USER='a1111111-1111-4111-8111-111111111111'
PROJECT='d1111111-1111-4111-8111-111111111111'
FILE='f1111111-1111-4111-8111-111111111111'
PDF=b'%PDF-1.4\n%%EOF\n'
def metadata(**extra):
 return dict(id=FILE,filename='evidence.pdf',size_bytes=len(PDF),sha256=sha256(PDF).hexdigest(),status='reserved',storage_path=USER+'/'+FILE+'.pdf',object_exists=False)|extra
class EvidenceTests(unittest.TestCase):
 def setUp(self):
  self.environment=patch.dict('os.environ',{'SUPABASE_SERVER_KEY':'sb_secret_private_test'});self.environment.start();self.addCleanup(self.environment.stop)
 def repo(self,handler):return Repository(Settings(supabase_url='https://tests.supabase.invalid',supabase_key='sb_publishable_test'),'Bearer user',transport=httpx.MockTransport(handler))
 def test_upload_uses_private_bucket_user_token_and_never_overwrites(self):
  calls=[]
  def handler(r):
   calls.append(r);self.assertEqual(r.headers['authorization'],'Bearer user');self.assertEqual(r.headers['apikey'],'sb_publishable_test')
   if '/rpc/' in r.url.path:
    import json
    p=json.loads(r.content)
    if p['p_action']=='attachment_reserve':self.assertEqual(p['p_data']['sha256'],sha256(PDF).hexdigest());return httpx.Response(200,json=metadata())
    self.assertEqual(p['p_action'],'attachment_ready');return httpx.Response(200,json=metadata(status='ready'))
   self.assertEqual(r.url.path,'/storage/v1/object/reputation-evidence/'+USER+'/'+FILE+'.pdf');self.assertEqual(r.headers['x-upsert'],'false');self.assertEqual(r.headers['content-type'],'application/pdf');self.assertEqual(r.content,PDF);return httpx.Response(200,json={'Key':'stored'})
  item=evidence.upload(self.repo(handler),PROJECT,'evidence.pdf','key',PDF)
  self.assertEqual(item['status'],'ready');self.assertNotIn('storage_path',item);self.assertNotIn('object_exists',item);self.assertEqual(len(calls),3)
 def test_retry_reconciles_existing_object_without_another_upload(self):
  methods=[]
  def handler(r):
   methods.append(r.method)
   if r.method=='GET':return httpx.Response(200,content=PDF)
   import json
   p=json.loads(r.content);return httpx.Response(200,json=metadata(object_exists=True,status='reserved' if p['p_action']=='attachment_reserve' else 'ready'))
  self.assertEqual(evidence.upload(self.repo(handler),PROJECT,'evidence.pdf','same-key',PDF)['status'],'ready');self.assertEqual(methods,['POST','GET','POST'])
 def test_mismatched_canonical_bytes_fail_without_completion_or_replacement(self):
  calls=[]
  def handler(r):
   calls.append(r.method);return httpx.Response(200,content=b'other') if r.method=='GET' else httpx.Response(200,json=metadata(object_exists=True))
  with self.assertRaises(ApiError) as error:evidence.upload(self.repo(handler),PROJECT,'evidence.pdf','same-key',PDF)
  self.assertEqual(error.exception.code,'REPUTATION_ATTACHMENT_MISMATCH');self.assertEqual(calls,['POST','GET'])
 def test_download_reauthorizes_after_reading_and_omits_content_on_revocation(self):
  authorizations=0
  def handler(r):
   nonlocal authorizations
   if r.method=='GET':
    self.assertEqual(r.headers['apikey'],'sb_secret_private_test');self.assertNotIn('Authorization',r.headers);return httpx.Response(200,content=PDF)
   self.assertEqual(r.headers['authorization'],'Bearer user');authorizations+=1
   if authorizations==2:return httpx.Response(400,json={'message':'REPUTATION_ATTACHMENT_NOT_FOUND'})
   return httpx.Response(200,json=metadata(status='attached'))
  with self.assertRaises(ApiError) as error:evidence.download(self.repo(handler),FILE)
  self.assertEqual(error.exception.status,404);self.assertEqual(authorizations,2)
 def test_missing_backend_key_fails_without_a_storage_fallback(self):
  methods=[]
  def handler(r):methods.append(r.method);return httpx.Response(200,json=metadata(status='attached'))
  with patch.dict('os.environ',{},clear=True):
   with self.assertRaises(ApiError) as error:evidence.download(self.repo(handler),FILE)
  self.assertEqual(error.exception.code,'REPUTATION_FILE_BACKEND_NOT_CONFIGURED');self.assertEqual(methods,['POST'])
 def test_successful_download_checks_hash_and_both_access_checks(self):
  methods=[]
  def handler(r):methods.append(r.method);return httpx.Response(200,content=PDF) if r.method=='GET' else httpx.Response(200,json=metadata(status='attached'))
  _,data=evidence.download(self.repo(handler),FILE);self.assertEqual(data,PDF);self.assertEqual(methods,['POST','GET','POST'])
 def test_published_file_cannot_be_discarded_or_deleted(self):
  methods=[]
  def handler(r):methods.append(r.method);return httpx.Response(400,json={'message':'REPUTATION_ATTACHMENT_INVALID'})
  with self.assertRaises(ApiError):evidence.discard(self.repo(handler),FILE)
  self.assertEqual(methods,['POST'])

class Services:
 def authenticate(self,header):
  if header!='Bearer owner':raise ApiError('UNAUTHORIZED',401)
  return USER
class ApiRepo:
 calls=[]
 def __init__(self,*args):pass
 def rpc(self,name,payload):
  self.calls.append(payload)
  if payload['p_action']=='attachment_context':return {'project_id':PROJECT}
  return metadata(status='ready')
 def call(self,*args,**kwargs):raise AssertionError('Unexpected storage call')
class EvidenceApiTests(unittest.TestCase):
 def setUp(self):ApiRepo.calls=[];self.client=TestClient(create_app(Settings(),Services(),ApiRepo));self.headers={'Authorization':'Bearer owner','Content-Type':'application/pdf','Idempotency-Key':'test-evidence'}
 def test_evidence_routes_require_a_session(self):
  for method,path in [('get',f'/api/v1/reputation/attachments?project_id={PROJECT}'),('post',f'/api/v1/reputation/attachments?project_id={PROJECT}&filename=a.pdf'),('get',f'/api/v1/reputation/attachments/{FILE}/file'),('delete',f'/api/v1/reputation/attachments/{FILE}')]:
   self.assertEqual(getattr(self.client,method)(path).status_code,401)
  self.assertEqual(ApiRepo.calls,[])
 def test_file_format_and_metadata_are_bounded(self):
  path=f'/api/v1/reputation/attachments?project_id={PROJECT}'
  for filename,body,mime in [('a.txt',PDF,'application/pdf'),('a.pdf',b'not pdf','application/pdf'),('a.pdf',PDF,'text/html'),('../a.pdf',PDF,'application/pdf')]:
   response=self.client.post(path,params={'filename':filename},headers=self.headers|{'Content-Type':mime},content=body);self.assertIn(response.status_code,(415,422))
 def test_oversize_body_never_reaches_storage(self):
  response=self.client.post(f'/api/v1/reputation/attachments?project_id={PROJECT}&filename=a.pdf',headers=self.headers,content=PDF+b'x'*evidence.MAX_FILE_BYTES)
  self.assertEqual(response.status_code,413)
  self.assertFalse(any(c['p_action']=='attachment_reserve' for c in ApiRepo.calls))
 def test_valid_retry_does_not_return_storage_paths(self):
  with patch.object(ApiRepo,'call',lambda self,*args,**kwargs:PDF):
   response=self.client.post(f'/api/v1/reputation/attachments?project_id={PROJECT}&filename=a.pdf',headers=self.headers,content=PDF)
  self.assertEqual(response.status_code,200);self.assertNotIn('storage_path',response.json()['data']);self.assertEqual(response.headers['cache-control'],'no-store')
 def test_four_or_duplicate_evidence_ids_are_rejected_before_review_write(self):
  payload=dict(project_id=PROJECT,public_email='client@example.invalid',alias='Author',name='Client',rating=4,communication=4,scope=4,payment='late',body='This is a review with explicit supporting evidence.',consent=True)
  for ids in [[FILE]*4,[FILE,FILE],['not-uuid']]:
   self.assertEqual(self.client.post('/api/v1/reputation/reviews',headers=self.headers,json=payload|{'attachment_ids':ids}).status_code,422)
  self.assertEqual(ApiRepo.calls,[])
