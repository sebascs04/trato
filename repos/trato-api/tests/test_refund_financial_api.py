"""HTTP authorization contracts; explicit finance workflow and repository doubles."""
from types import SimpleNamespace
from unittest.mock import patch
import unittest
import httpx
from fastapi.testclient import TestClient

from trato_api.app import create_app
from trato_api.errors import ApiError
from trato_api.refunds.repository import RefundRepository
from refund_financial_fixtures import uid,OWNER,PARENT,SNAPSHOT,AUTH

class Services:
    def authenticate(self,token):
        if token!='Bearer confirmed-owner':raise ApiError('UNAUTHORIZED',401)
        return OWNER
class Repo:
    def __init__(self):self.calls=[]
    def financial(self,parent):self.calls.append(('read',parent));return {'confirmed_minor':0,'reserved_minor':0}
    def financial_authorize(self,data,key):self.calls.append(('authorize',data,key));return {'settlement':{'id':PARENT}}

class FinancialApiTests(unittest.TestCase):
    def setUp(self):
        self.repo=Repo();self.calls=[]
        def action(name):
            def run(*args):self.calls.append((name,args));return {'settlement':{'id':PARENT}}
            return run
        flow=SimpleNamespace(**{k:action(k) for k in ['check','execute','refresh']})
        with patch('trato_api.app.RefundFinance',return_value=flow):self.client=TestClient(create_app(services=Services(),refund_repository_factory=lambda *_:self.repo))
        self.client.__enter__();self.addCleanup(self.client.__exit__,None,None,None)
        self.base='/api/v1/refunds/'+PARENT;self.headers={'Authorization':'Bearer confirmed-owner','Idempotency-Key':'financial-key'}
        self.body={'expected_snapshot_id':SNAPSHOT,'check_id':uid(90),'digest':'a'*64,'confirmed':True,'notes':'Reviewed exact allocation'}
    def test_every_financial_route_requires_jwt_before_work_or_body(self):
        for method,suffix in [('GET','/financial'),('POST','/financial-checks'),('POST','/financial-authorizations'),('POST',f'/financial-authorizations/{AUTH}/execute'),('POST',f'/financial-operations/{uid(80)}/refresh')]:
            self.assertEqual(self.client.request(method,self.base+suffix).status_code,401)
        self.assertFalse(self.calls);self.assertFalse(self.repo.calls)
    def test_checks_bind_server_owner_parent_and_snapshot(self):
        response=self.client.post(self.base+'/financial-checks',headers=self.headers,json={'expected_snapshot_id':SNAPSHOT})
        self.assertEqual(response.status_code,200,response.text);self.assertEqual(self.calls[0][1][1:],(OWNER,PARENT,SNAPSHOT))
        self.assertEqual(response.headers['cache-control'],'no-store')
    def test_authorization_is_not_inferred_from_documentary_acceptance(self):
        for invalid in [{k:v for k,v in self.body.items() if k!='confirmed'},self.body|{'confirmed':False},self.body|{'confirmed':'true'},self.body|{'notes':''}]:
            self.assertEqual(self.client.post(self.base+'/financial-authorizations',json=invalid,headers=self.headers).status_code,422)
        self.assertFalse(self.repo.calls)
        r=self.client.post(self.base+'/financial-authorizations',json=self.body,headers=self.headers)
        self.assertEqual(r.status_code,200,r.text);self.assertEqual(self.repo.calls[0],('authorize',{'settlement_id':PARENT,**self.body},'financial-key'))
        self.assertFalse(self.calls)
    def test_client_cannot_forge_amount_capture_merchant_provider_balance_or_owner(self):
        for extra in [{'amount_minor':1},{'capture_id':'foreign'},{'merchant_id':'foreign'},{'provider_remaining_minor':999},{'owner_id':uid(99)},{'settlement_id':uid(99)}]:
            self.assertEqual(self.client.post(self.base+'/financial-authorizations',json=self.body|extra,headers=self.headers).status_code,422)
        self.assertFalse(self.repo.calls)
    def test_execute_requires_explicit_action_idempotency_and_only_server_plan(self):
        url=self.base+f'/financial-authorizations/{AUTH}/execute'
        for body in [{},{'confirmed':False},{'confirmed':1},{'confirmed':True,'amount_minor':1}]:
            self.assertEqual(self.client.post(url,json=body,headers=self.headers).status_code,422)
        self.assertEqual(self.client.post(url,json={'confirmed':True},headers={'Authorization':'Bearer confirmed-owner'}).status_code,422)
        r=self.client.post(url,json={'confirmed':True},headers=self.headers);self.assertEqual(r.status_code,200,r.text)
        self.assertEqual(self.calls[-1][1][1:],(OWNER,PARENT,AUTH,'financial-key'))
    def test_refresh_accepts_no_provider_result_and_read_does_not_execute(self):
        self.assertEqual(self.client.get(self.base+'/financial',headers=self.headers).status_code,200);self.assertFalse(self.calls)
        url=self.base+f'/financial-operations/{uid(80)}/refresh'
        self.assertEqual(self.client.post(url,json={'status':'COMPLETED'},headers=self.headers).status_code,422)
        self.assertEqual(self.client.post(url,headers=self.headers).status_code,200)
        self.assertEqual(self.calls[-1][0],'refresh')
    def test_bad_uuid_digest_key_and_oversize_body_do_not_reach_workflow(self):
        self.assertEqual(self.client.post('/api/v1/refunds/bad/financial-checks',json={'expected_snapshot_id':SNAPSHOT},headers=self.headers).status_code,422)
        self.assertEqual(self.client.post(self.base+'/financial-authorizations',json=self.body|{'digest':'bad'},headers=self.headers).status_code,422)
        self.assertEqual(self.client.post(self.base+'/financial-authorizations',json=self.body,headers=self.headers|{'Idempotency-Key':'x'*129}).status_code,422)
        self.assertEqual(self.client.post(self.base+'/financial-checks',content=b'x'*2_000_001,headers=self.headers).status_code,413)
        self.assertFalse(self.calls);self.assertFalse(self.repo.calls)

class FinancialRepositoryTests(unittest.TestCase):
    def test_user_jwt_is_preserved_and_owner_is_not_sent_as_a_claim(self):
        import json
        calls=[]
        def transport(request):
            self.assertEqual(request.headers['Authorization'],'Bearer owner-jwt');calls.append((request.url.path,json.loads(request.content)))
            return httpx.Response(200,json={})
        repo=RefundRepository(SimpleNamespace(supabase_url='https://test.invalid',supabase_key='public'),'Bearer owner-jwt',transport=httpx.MockTransport(transport))
        repo.financial(PARENT);repo.financial_authorize({'settlement_id':PARENT},'key')
        self.assertEqual(calls[0],('/rest/v1/rpc/refund_financial',{'p_settlement_id':PARENT}))
        self.assertEqual(calls[1][1],{'p_data':{'settlement_id':PARENT},'p_key':'key'})
