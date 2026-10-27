import os
from unittest.mock import patch
import unittest
from fastapi.testclient import TestClient
from fastapi import FastAPI
from trato_api.app import Settings,create_app
from trato_api.thread_routes import build_thread_router
from trato_api.errors import ApiError
from test_business import PROJECT,DOCUMENT,Repo,Services

class Backend:
    def __init__(self,*args):self.calls=[]
    def command(self,action,data):
        self.calls.append(action)
        return {'terminal':False,'lease_id':DOCUMENT,'document':{'id':DOCUMENT,'storage_path':'private/path','ingestion_key':'private-key','sha256':'a'*64}}
    def original(self,thread_id,lease_id):return b'%PDF-test'

class ThreadRoutesTests(unittest.TestCase):
    def test_internal_original_requires_worker_token_not_browser_jwt(self):
        app=create_app(services=Services())
        with patch.dict(os.environ,{'TRATO_WORKER_TOKEN':'test-worker'}),TestClient(app) as client:
            self.assertEqual(client.get(f'/internal/threads/{DOCUMENT}/original?lease_id={PROJECT}',headers={'Authorization':'Bearer user-a'}).status_code,401)
            self.assertEqual(client.post('/internal/threads/claim',json={},headers={'Authorization':'Bearer user-a'}).status_code,401)

    def test_claim_strips_storage_and_ingestion_metadata(self):
        app=FastAPI();backend=Backend();app.include_router(build_thread_router(Settings(),lambda _:backend))
        with patch.dict(os.environ,{'TRATO_WORKER_TOKEN':'test-worker'}),TestClient(app) as client:
            result=client.post('/internal/threads/claim',json={'thread_id':DOCUMENT},headers={'Authorization':'Bearer test-worker'})
        self.assertEqual(result.status_code,200)
        self.assertNotIn('storage_path',result.text)
        self.assertNotIn('private-key',result.text)

    def test_word_requires_explicit_conversion_before_reserving_document(self):
        repo=Repo()
        with TestClient(create_app(services=Services(),repository_factory=lambda *_:repo)) as client:
            result=client.post(f'/api/v1/projects/{PROJECT}/documents?filename=source.docx&title=Fuente',
                content=b'PKtest',headers={'Authorization':'Bearer user-a','Idempotency-Key':'test-word',
                'Content-Type':'application/vnd.openxmlformats-officedocument.wordprocessingml.document'})
        self.assertEqual(result.status_code,422)
        self.assertEqual(result.json()['error']['code'],'PDF_CONVERSION_REQUIRED')
        self.assertEqual(repo.calls,[])
