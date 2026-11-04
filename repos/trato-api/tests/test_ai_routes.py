import unittest
from uuid import uuid4
from fastapi import FastAPI
from fastapi.testclient import TestClient
from fastapi.responses import JSONResponse
from trato_api.ai_routes import build_ai_router
from trato_api.errors import ApiError

CLIENT=str(uuid4());DRAFT=str(uuid4());PROFILE=str(uuid4());JOB=str(uuid4())
class Preferences:
    def for_request(self,request,owner):return 'gemini-3.8-flash'
class Jobs:
    def __init__(self):self.data=None;self.owner=None
    def enqueue(self,owner,id,data):self.owner=owner;self.data=data;return {'id':id,'status':'queued'}
    def get(self,owner,id,*args):
        if owner!=self.owner:raise ApiError('AI_NOT_FOUND',404)
        return {'id':id,'status':'completed','result':{'kind':'project_plan','summary':'Plan','observations':[],'limitations':['Review required'],'model':'gemini-3.8-flash'}}
    def input(self,owner,id):self.get(owner,id);return self.data
class Repo:
    def __init__(self,*args):pass
    def rows(self,table,params):return [{'id':CLIENT,'contact_email':'client@example.invalid'}]
    def rpc(self,name,data):
        if name=='create_planned_project':return {'id':data['p_key'],'client_id':data['p_client'],'name':data['p_name']}
        if data['p_action']=='lookup':return {'client':{'id':PROFILE}}
        return {'reviews':[{'id':'review','version':1,'body':'The project used clear deliverables.'}], 'next_offset':None}
class AIRoutesTests(unittest.TestCase):
    def setUp(self):
        self.owner='owner';self.jobs=Jobs();app=FastAPI()
        app.include_router(build_ai_router(None,lambda:self.owner,Repo,self.jobs,Preferences()))
        @app.exception_handler(ApiError)
        async def error(_,e):return JSONResponse({'error':{'code':e.code}},status_code=e.status)
        self.client=TestClient(app)
    def test_context_is_server_owned_and_extra_reviews_are_rejected(self):
        body={'client_id':CLIENT,'draft_id':DRAFT,'brief':'Build a website','budget':'100.00','target_date':'2026-12-01','output_language':'es'}
        h={'Idempotency-Key':JOB}
        self.assertEqual(self.client.post('/api/v1/ai/project-plans',json={**body,'reviews':[]},headers=h).status_code,422)
        self.assertEqual(self.client.post('/api/v1/ai/project-plans',json=body,headers=h).status_code,202)
        self.assertEqual(self.jobs.data['reviews'][0]['id'],'review')
        self.assertEqual(self.jobs.data['model_id'],'gemini-3.8-flash')
        self.owner='other';self.assertEqual(self.client.get('/api/v1/ai/jobs/'+JOB).status_code,404)
    def test_plan_creation_requires_matching_owner_client_and_draft(self):
        self.jobs.owner='owner';self.jobs.data={'workflow':'project_plan','client_id':CLIENT,'draft_id':DRAFT,'brief':'Brief','budget':'100.00','target_date':'2026-12-01','reviews':[],'output_language':'es'}
        body={'client_id':CLIENT,'name':'Project','plan_job_id':JOB,'stages':[{'title':'Delivery','body':'Deliver the work','percent':100,'when':'Before delivery'}]}
        self.assertEqual(self.client.post('/api/v1/ai/projects',json=body,headers={'Idempotency-Key':DRAFT}).status_code,201)
        self.assertEqual(self.client.post('/api/v1/ai/projects',json=body,headers={'Idempotency-Key':str(uuid4())}).status_code,409)
        body['stages'][0]['percent']=50
        self.assertEqual(self.client.post('/api/v1/ai/projects',json=body,headers={'Idempotency-Key':DRAFT}).status_code,422)
