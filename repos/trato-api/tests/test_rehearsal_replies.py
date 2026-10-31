import os,unittest
from unittest.mock import patch
from uuid import uuid4
from fastapi import FastAPI
from fastapi.testclient import TestClient
from fastapi.responses import JSONResponse
from trato_api.rehearsal_routes import build_rehearsal_router
from trato_api.rehearsal_jobs import RehearsalJobs
from trato_api.errors import ApiError
from test_rehearsal_jobs import Redis

class ReplyRoutes(unittest.TestCase):
    def test_queued_reply_uses_canonical_case_and_owner_scope(self):
        redis=Redis();jobs=RehearsalJobs(redis);app=FastAPI();app.include_router(build_rehearsal_router(lambda:'owner',jobs=jobs))
        @app.exception_handler(ApiError)
        async def error(_,exc):return JSONResponse({'error':{'code':exc.code}},status_code=exc.status)
        body={'action':'reply','scenario':'scope','output_language':'en','persona':{'patience':3,'flexibility':3,'price_sensitivity':3},'messages':[]}
        with patch.dict(os.environ,{'TRATO_REHEARSAL_EVALUATOR_ENABLED':'true'}),TestClient(app) as client:
            job=str(uuid4());h={'Idempotency-Key':job}
            self.assertEqual(client.post('/api/v1/rehearsals/replies',json=body,headers=h).status_code,202)
            self.assertEqual(client.post('/api/v1/rehearsals/replies',json=body,headers=h).status_code,202)
            self.assertEqual(redis.queued,1)
            self.assertEqual(client.get('/api/v1/rehearsals/evaluations/'+job).status_code,404)
            row=redis.rows['trato:rehearsal:evaluation:'+job];import json
            self.assertIn('agreement',json.loads(row['input'])['case'])
            row.update(status='completed',result=json.dumps({'message':'Client reply','ended':False}))
            result=client.get('/api/v1/rehearsals/replies/'+job).json()['data']
            self.assertEqual(result['reply']['message'],'Client reply');self.assertNotIn('evaluation',result)
            with self.assertRaises(ApiError):jobs.get('another-owner',job,'reply')
            self.assertEqual(client.post('/api/v1/rehearsals/replies',json={**body,'case':{}},headers={'Idempotency-Key':str(uuid4())}).status_code,422)
