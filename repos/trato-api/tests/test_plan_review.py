from copy import deepcopy
from unittest import TestCase
from unittest.mock import Mock
from uuid import uuid4
from fastapi import FastAPI
from fastapi.testclient import TestClient
from fastapi.responses import JSONResponse
from trato_api.ai_routes import build_ai_router
from trato_api.errors import ApiError

class PlanReviewTests(TestCase):
 def setUp(self):
  self.client_id,self.draft,self.original,self.review=[str(uuid4()) for _ in range(4)]
  self.base=[{'title':'Design','body':'Website design','percent':100,'when':'After delivery'}]
  self.edited=[{**self.base[0],'when':'After client acknowledgment'}]
  context={'client_id':self.client_id,'draft_id':self.draft,'brief':'Website','budget':'600.00','target_date':'2027-01-01','reviews':[],'output_language':'es'}
  base={'summary':'Original proposal','observations':[],'limitations':[],'model':'test-model','stages':self.base}
  self.review_input={**context,'mode':'review','source_plan_job_id':self.original,'original_stages':self.base,'confirmed_stages':self.edited}
  result={**base,'summary':'Updated proposal','stages':self.edited,'material_change':True}
  jobs=Mock();jobs.get.side_effect=lambda owner,id,*args: {'status':'completed','result':deepcopy(base if id==self.original else result)};jobs.input.side_effect=lambda owner,id:deepcopy(context if id==self.original else self.review_input);jobs.enqueue.return_value={'id':str(uuid4()),'status':'queued'}
  self.repo=Mock();self.repo.rows.return_value=[{'id':self.client_id}];self.repo.rpc.return_value={'id':self.draft,'client_id':self.client_id,'name':'Website'}
  preferences=Mock();preferences.for_request.return_value='test-model';app=FastAPI();app.include_router(build_ai_router(None,lambda:'owner',lambda *args:self.repo,jobs,preferences,usage_writer=Mock()))
  @app.exception_handler(ApiError)
  async def error(_,e):return JSONResponse({'error':{'code':e.code}},status_code=e.status)
  self.client=TestClient(app);self.jobs=jobs
 def body(self):return {'client_id':self.client_id,'name':'Website','plan_job_id':self.original,'review_job_id':self.review,'stages':self.edited}
 def test_creation_keeps_original_and_persists_reviewed_reasoning_for_exact_confirmed_stages(self):
  response=self.client.post('/api/v1/ai/projects',json=self.body(),headers={'Idempotency-Key':self.draft})
  self.assertEqual(response.status_code,201)
  plan=self.repo.rpc.call_args.args[1]['p_plan'];self.assertEqual(plan['summary'],'Updated proposal');self.assertEqual(plan['stages'],self.edited);self.assertEqual(plan['original_proposal']['stages'],self.base);self.assertTrue(plan['original_proposal']['material_change'])
 def test_a_review_of_different_edits_cannot_authorize_creation(self):
  self.review_input['confirmed_stages']=self.base
  response=self.client.post('/api/v1/ai/projects',json=self.body(),headers={'Idempotency-Key':self.draft});self.assertEqual(response.status_code,409);self.repo.rpc.assert_not_called()
 def test_review_uses_original_job_context_and_rejects_client_supplied_reviews(self):
  body={'plan_job_id':self.original,'stages':self.edited,'output_language':'es'}
  response=self.client.post('/api/v1/ai/project-plans/review',json=body,headers={'Idempotency-Key':str(uuid4())});self.assertEqual(response.status_code,202)
  payload=self.jobs.enqueue.call_args.args[2];self.assertEqual(payload['client_id'],self.client_id);self.assertEqual(payload['original_stages'],self.base);self.assertEqual(payload['confirmed_stages'],self.edited)
  response=self.client.post('/api/v1/ai/project-plans/review',json={**body,'reviews':[]},headers={'Idempotency-Key':str(uuid4())});self.assertEqual(response.status_code,422)
