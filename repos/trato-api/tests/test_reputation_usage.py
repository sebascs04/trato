from unittest import TestCase
from unittest.mock import patch,Mock
from uuid import uuid4
from fastapi import FastAPI
from fastapi.testclient import TestClient
from fastapi.responses import JSONResponse
from trato_api.errors import ApiError
from trato_api.reputation_routes import build_reputation_router
from trato_api.reputation_usage import record_plan_usage

PROFILE=str(uuid4())
class Repo:
    calls=[]
    def __init__(self,*args):pass
    def rpc(self,name,data):
        self.calls.append((name,data))
        return {'profile_id':data['p_profile_id'],'confirmed_plan_freelancers':2,'self_reported_helpful':1,'my_helpful':data.get('p_helpful')}

class ReputationUsageTests(TestCase):
    def setUp(self):
        Repo.calls=[];app=FastAPI();app.include_router(build_reputation_router(None,lambda:'owner',Repo))
        @app.exception_handler(ApiError)
        async def error(_,e):return JSONResponse({'error':{'code':e.code}},status_code=e.status)
        self.client=TestClient(app)
    def test_usage_and_opinion_use_separate_authenticated_rpc_and_no_private_identifiers(self):
        response=self.client.get('/api/v1/reputation/clients/'+PROFILE+'/usage');self.assertEqual(response.status_code,200)
        self.assertEqual(Repo.calls[-1],('reputation_usage',{'p_profile_id':PROFILE}))
        self.assertEqual(response.json()['data']['confirmed_plan_freelancers'],2)
        response=self.client.post('/api/v1/reputation/clients/'+PROFILE+'/usefulness',json={'helpful':True});self.assertEqual(response.status_code,200)
        self.assertEqual(Repo.calls[-1][1]['p_helpful'],True)
        self.assertNotIn('owner_id',response.json()['data'])
    def test_browser_cannot_send_a_counter_or_impersonate_an_owner(self):
        for body in [{'helpful':True,'owner_id':'other'},{'helpful':True,'confirmed_plan_freelancers':100},{'helpful':1}]:
            self.assertEqual(self.client.post('/api/v1/reputation/clients/'+PROFILE+'/usefulness',json=body).status_code,422)
        self.assertEqual(Repo.calls,[])
    @patch('trato_api.reputation_usage.ThreadStore')
    def test_no_background_never_records_and_failed_server_confirmation_is_visible(self,store):
        record_plan_usage(None,'owner','project','job',{'reviews':[]});store.assert_not_called()
        store.return_value.repo.rpc.return_value={'recorded':False}
        with self.assertRaisesRegex(ApiError,'AI_PLAN_USAGE_NOT_RECORDED'):
            record_plan_usage(None,'owner','project','job',{'reviews':[{'id':'review'}]})
        store.return_value.repo.rpc.assert_called_once_with('record_reputation_plan_usage',{'p_owner':'owner','p_project':'project','p_job':'job'})
