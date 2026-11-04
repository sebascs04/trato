import json
import os
from unittest import TestCase
from unittest.mock import patch
from uuid import uuid4
from fastapi import FastAPI
from fastapi.testclient import TestClient
from fastapi.responses import JSONResponse
from trato_api.errors import ApiError
from trato_api.vector_jobs import IndexJobs, enqueue_index, build_vector_job_router
from trato_api.vector_routes import source
from test_vector_routes import Repo, OWNER, CLIENT, PROJECT, FILE

JOB, EXECUTION = str(uuid4()), str(uuid4())


class Jobs:
    def __init__(self): self.row = {}; self.calls = []
    def enqueue(self, owner, job, data):
        self.calls.append((owner, job, data))
        self.row = {'owner':owner,'status':'running','execution_id':EXECUTION,'input':json.dumps(data)}
        return {'id':job,'status':'queued'}
    def connection(self): return self
    def hgetall(self, key): return self.row


class Gateway:
    def __init__(self): self.calls = []
    def index(self, repo, owner, project, file):
        self.calls.append((owner,project,file));return {'status':'ready','id':file}


class IndexJobTests(TestCase):
    def setUp(self):
        self.repo, self.jobs, self.gateway = Repo(), Jobs(), Gateway()
        self.rows = self.repo.rows
        self.repo.rows = lambda table,params:[{'id':CLIENT}] if table=='clients' else self.rows(table,params)
        self.service = IndexJobs(None,jobs=self.jobs,repository=self.repo,gateway=self.gateway)
    def test_enqueue_is_deterministic_and_carries_no_text_or_credentials(self):
        first = enqueue_index(self.repo,self.jobs,OWNER,PROJECT,FILE)
        second = enqueue_index(self.repo,self.jobs,OWNER,PROJECT,FILE)
        self.assertEqual(first,second)
        data = self.jobs.calls[0][2]
        self.assertEqual(data['workflow'],'index_document')
        self.assertNotIn('text',data);self.assertNotIn('authorization',data);self.assertNotIn('model_id',data)
        result = self.service.execute(first['id'],EXECUTION)
        self.assertEqual(result['kind'],'document_index')
        self.assertEqual(self.gateway.calls,[(OWNER,PROJECT,FILE)])
    def test_execution_lease_wrong_owner_and_source_change_prevent_index(self):
        enqueue_index(self.repo,self.jobs,OWNER,PROJECT,FILE)
        with self.assertRaisesRegex(ApiError,'VECTOR_JOB_NOT_ACTIVE'):
            self.service.execute(JOB,str(uuid4()))
        self.jobs.row['owner']=str(uuid4())
        with self.assertRaisesRegex(ApiError,'VECTOR_JOB_INVALID'):self.service.execute(JOB,EXECUTION)
        enqueue_index(self.repo,self.jobs,OWNER,PROJECT,FILE);self.repo.text+='Changed'
        with self.assertRaisesRegex(ApiError,'VECTOR_SOURCE_CHANGED'):self.service.execute(JOB,EXECUTION)
        self.assertEqual(self.gateway.calls,[])
    def test_internal_route_needs_worker_token_and_exact_body(self):
        app=FastAPI();app.include_router(build_vector_job_router(None,self.service))
        @app.exception_handler(ApiError)
        async def error(_,e):return JSONResponse({'error':{'code':e.code}},status_code=e.status)
        client=TestClient(app)
        with patch.dict(os.environ,{'TRATO_WORKER_TOKEN':'worker'}):
            path='/internal/vector-jobs/'+JOB+'/execute'
            self.assertEqual(client.post(path,json={'execution_id':EXECUTION}).status_code,401)
            self.assertEqual(client.post(path,json={'execution_id':EXECUTION,'owner_id':OWNER},headers={'Authorization':'Bearer worker'}).status_code,422)
