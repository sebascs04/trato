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
    calls=[]
    def rpc(self,name,data):
        Repo.calls.append((name,data))
        if name=='edit_plan_stage':return {'position':data['p_position'],'title':data['p_title'].strip()}
        if name=='create_planned_project':return {'id':data['p_key'],'client_id':data['p_client'],'name':data['p_name']}
        if data['p_action']=='lookup':return {'client':{'id':PROFILE}}
        return {'reviews':[{'id':'review','version':1,'body':'The project used clear deliverables.'}], 'next_offset':None}
class AIRoutesTests(unittest.TestCase):
    def setUp(self):
        from datetime import date
        from unittest.mock import patch
        clock=patch('trato_api.ai_routes.project_today',return_value=date(2026,11,5));clock.start();self.addCleanup(clock.stop)
        self.owner='owner';self.jobs=Jobs();app=FastAPI()
        app.include_router(build_ai_router(None,lambda:self.owner,Repo,self.jobs,Preferences()))
        @app.exception_handler(ApiError)
        async def error(_,e):return JSONResponse({'error':{'code':e.code}},status_code=e.status)
        self.client=TestClient(app)
    def test_saved_plan_stage_edits_only_send_wording_to_the_guarded_function(self):
        project=str(uuid4());url=f'/api/v1/ai/projects/{project}/plan/stages/2';Repo.calls.clear()
        body={'title':' Design ','deliverables':'Home and menu pages','payment_condition':'On sign-off'}
        response=self.client.patch(url,json=body)
        self.assertEqual(response.status_code,200)
        self.assertEqual(Repo.calls,[('edit_plan_stage',{'p_project':project,'p_position':2,'p_title':' Design ','p_deliverables':'Home and menu pages','p_payment_condition':'On sign-off'})])
        for bad in ({**body,'amount':'500.00'},{**body,'title':'   '},{'title':'Design'}):
            self.assertEqual(self.client.patch(url,json=bad).status_code,422)
        self.assertEqual(self.client.patch(f'/api/v1/ai/projects/{project}/plan/stages/9',json=body).status_code,404)
        self.assertEqual(len(Repo.calls),1)
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

    def test_confirming_plan_registers_server_usage_only_after_validated_creation(self):
        from unittest.mock import Mock
        writer=Mock();app=FastAPI();app.include_router(build_ai_router(None,lambda:'owner',Repo,self.jobs,Preferences(),usage_writer=writer))
        self.jobs.owner='owner';self.jobs.data={'workflow':'project_plan','client_id':CLIENT,'draft_id':DRAFT,'brief':'Brief','budget':'100.00','target_date':'2026-12-01','reviews':[{'id':'review','version':1,'body':'Published source'}],'output_language':'es'}
        body={'client_id':CLIENT,'name':'Project','plan_job_id':JOB,'stages':[{'title':'Delivery','body':'Deliver work','percent':100,'when':'On review'}]}
        response=TestClient(app).post('/api/v1/ai/projects',json=body,headers={'Idempotency-Key':DRAFT})
        self.assertEqual(response.status_code,201);writer.assert_called_once_with(None,'owner',DRAFT,JOB,self.jobs.data)

    def test_delivery_date_rejects_past_and_allows_today_and_future(self):
        body={'client_id':CLIENT,'draft_id':DRAFT,'brief':'Website','budget':'600.00','target_date':'2026-11-04','output_language':'es'}
        self.assertEqual(self.client.post('/api/v1/ai/project-plans',json=body,headers={'Idempotency-Key':JOB}).status_code,422)
        self.assertIsNone(self.jobs.data)
        for target in ['2026-11-05','2026-11-20']:
            self.assertEqual(self.client.post('/api/v1/ai/project-plans',json={**body,'target_date':target},headers={'Idempotency-Key':str(uuid4())}).status_code,202)
            self.assertEqual(self.jobs.data['today'],'2026-11-05')

    def test_plan_sources_are_validated_and_kept_in_job_context(self):
        body={'client_id':CLIENT,'draft_id':DRAFT,'brief':'Website','budget':'600.00','target_date':'2026-11-20','output_language':'en'}
        source={'filename':'01-initial-conversation.pdf','text':'USD 180 on design approval, USD 300 on development, USD 120 before launch.'}
        for bad in [[{**source,'extra':'x'}],[{**source,'text':''}],[source]*6,[{**source,'text':'x'*60001}]]:
            self.assertEqual(self.client.post('/api/v1/ai/project-plans',json={**body,'sources':bad},headers={'Idempotency-Key':JOB}).status_code,422)
        self.assertIsNone(self.jobs.data)
        self.assertEqual(self.client.post('/api/v1/ai/project-plans',json={**body,'sources':[source]},headers={'Idempotency-Key':JOB}).status_code,202)
        self.assertEqual(self.jobs.data['sources'],[source])
        self.assertEqual(self.client.post('/api/v1/ai/project-plans',json=body,headers={'Idempotency-Key':str(uuid4())}).status_code,202)
        self.assertEqual(self.jobs.data['sources'],[])

    def test_project_amount_rejects_nonpositive_and_fractional_cents(self):
        body={'client_id':CLIENT,'draft_id':DRAFT,'brief':'Website','target_date':'2026-11-20','output_language':'es'}
        for budget in ['0','-1','0.001','NaN','Infinity']:
            self.assertEqual(self.client.post('/api/v1/ai/project-plans',json={**body,'budget':budget},headers={'Idempotency-Key':JOB}).status_code,422)
        self.assertIsNone(self.jobs.data)
        self.assertEqual(self.client.post('/api/v1/ai/project-plans',json={**body,'budget':'0.01'},headers={'Idempotency-Key':JOB}).status_code,202)

    def test_confirming_edited_stages_requires_review_of_the_exact_plan(self):
        original=[{'title':'Delivery','body':'Website','percent':100,'when':'After delivery'}]
        confirmed=[{**original[0],'when':'After client acknowledgment'}]
        self.jobs.owner='owner';self.jobs.data={'workflow':'project_plan','client_id':CLIENT,'draft_id':DRAFT,'brief':'Brief','budget':'100.00','target_date':'2026-12-01','reviews':[],'output_language':'es'}
        old_get=self.jobs.get
        self.jobs.get=lambda owner,id,*args:{**old_get(owner,id,*args),'result':{**old_get(owner,id,*args)['result'],'stages':original}}
        response=self.client.post('/api/v1/ai/projects',json={'client_id':CLIENT,'name':'Project','plan_job_id':JOB,'stages':confirmed},headers={'Idempotency-Key':DRAFT})
        self.assertEqual(response.status_code,409);self.assertEqual(response.json()['error']['code'],'AI_PLAN_REVIEW_REQUIRED')
