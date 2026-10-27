from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from pathlib import Path
import tempfile
import unittest

from fastapi import FastAPI,Request,HTTPException
from fastapi.testclient import TestClient
from paypal.client import PayPalSandboxClient,PayPalError
from paypal.config import SandboxSettings
from trato_api.sandbox_payment import SandboxPaymentTest
from trato_api.sandbox_payment_routes import build_sandbox_payment_router


class FakePayPal(PayPalSandboxClient):
    def __init__(self):
        super().__init__('synthetic-client','synthetic-secret','MERCHANT12345')
        self.creations=0;self.captures=0;self.order=None;self.fail_creation=False;self.fail_capture=False
    def create_order(self,item,key,return_url,cancel_url):
        self.creations+=1
        if self.fail_creation:raise PayPalError('PAYPAL_UNAVAILABLE',uncertain=True)
        self.order={'id':'ORDER12345','intent':'CAPTURE','status':'CREATED','purchase_units':[{'reference_id':item.payment_id,'custom_id':item.payment_id,'amount':{'currency_code':'USD','value':item.amount},'payee':{'merchant_id':item.merchant_id}}],'links':[{'rel':'payer-action','href':'https://www.sandbox.paypal.com/checkoutnow?token=ORDER12345'}]}
        return deepcopy(self.order)
    def get_order(self,id):return deepcopy(self.order)
    def capture_order(self,id,key):
        self.captures+=1
        if self.fail_capture:raise PayPalError('PAYPAL_UNAVAILABLE',uncertain=True)
        self.order['status']='COMPLETED'
        self.order['purchase_units'][0]['payments']={'captures':[{'id':'CAPTURE12345','status':'COMPLETED','amount':{'currency_code':'USD','value':'0.10'}}]}
        return deepcopy(self.order)


class SandboxTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.settings=SandboxSettings('synthetic-client','synthetic-secret','MERCHANT12345',return_url='http://localhost:5173/paypal-sandbox-return.html',cancel_url='http://localhost:5173/paypal-sandbox-return.html?result=cancel')
        self.provider=FakePayPal();self.path=Path(self.temp.name)/'tests.sqlite3'
        self.service=SandboxPaymentTest(self.settings,self.path,client=self.provider)
    def create(self):return self.service.create('owner','stable-test-key')
    def test_fixed_value_creation_is_durable_and_idempotent_under_concurrency(self):
        with ThreadPoolExecutor(max_workers=2) as executor:
            records=list(executor.map(lambda _:self.create(),range(2)))
        self.assertEqual(records[0]['id'],records[1]['id']);self.assertEqual(self.provider.creations,1)
        self.assertEqual(records[0]['amount'],'0.10')
        self.assertEqual(self.service.create('owner','another-key')['id'],records[0]['id'])
        self.assertEqual(self.provider.creations,1)
        self.assertEqual(self.path.stat().st_mode & 0o777,0o600)
        reloaded=SandboxPaymentTest(self.settings,self.path,client=self.provider)
        self.assertEqual(reloaded.latest('owner')['id'],records[0]['id'])
        self.assertIsNone(reloaded.latest('another'))
    def test_capture_requires_provider_approval_and_never_uses_return_parameters(self):
        record=self.create()
        with self.assertRaises(PayPalError):self.service.capture('owner',record['id'])
        self.assertEqual(self.provider.captures,0)
        self.assertEqual(self.service.get('owner',record['id'])['status'],'pending_approval')
    def test_verified_capture_completes_once_and_survives_stale_provider_poll(self):
        record=self.create();self.provider.order['status']='APPROVED'
        paid=self.service.capture('owner',record['id'].upper())
        self.assertEqual(paid['status'],'completed');self.assertEqual(paid['capture_id'],'CAPTURE12345')
        self.service.capture('owner',record['id']);self.assertEqual(self.provider.captures,1)
        self.provider.order['purchase_units'][0].pop('payments');self.provider.order['status']='CREATED'
        self.assertEqual(self.service.reconcile('owner',record['id'])['status'],'completed')
    def test_foreign_owner_cannot_capture_or_reconcile(self):
        record=self.create()
        for method in [self.service.capture,self.service.reconcile]:
            with self.assertRaises(PayPalError) as error:method('another',record['id'])
            self.assertEqual(error.exception.status,404)
        self.assertEqual(self.provider.captures,0)
    def test_mismatched_amount_prevents_capture(self):
        record=self.create();self.provider.order['status']='APPROVED'
        self.provider.order['purchase_units'][0]['amount']['value']='1.00'
        with self.assertRaises(PayPalError):self.service.capture('owner',record['id'])
        self.assertEqual(self.provider.captures,0)
    def test_creation_timeout_never_silently_creates_another_order(self):
        self.provider.fail_creation=True
        with self.assertRaises(PayPalError):self.create()
        retry=self.create();self.assertEqual(retry['status'],'reconciliation_required')
        self.assertEqual(self.provider.creations,1)
    def test_capture_timeout_requires_reconciliation_and_never_recaptures(self):
        record=self.create();self.provider.order['status']='APPROVED';self.provider.fail_capture=True
        with self.assertRaises(PayPalError):self.service.capture('owner',record['id'])
        with self.assertRaises(PayPalError):self.service.capture('owner',record['id'])
        self.assertEqual(self.provider.captures,1)
    def test_pending_capture_is_not_a_completed_payment(self):
        record=self.create()
        self.provider.order['purchase_units'][0]['payments']={'captures':[{'id':'CAPTURE12345','status':'PENDING','amount':{'currency_code':'USD','value':'0.10'}}]}
        self.assertEqual(self.service.reconcile('owner',record['id'])['status'],'pending')
        self.assertEqual(self.provider.captures,0)
    def test_route_authenticates_and_rejects_arbitrary_amount_and_merchant(self):
        app=FastAPI()
        def user(request:Request):
            if request.headers.get('authorization')!='Bearer synthetic':raise HTTPException(401)
            return 'owner'
        app.include_router(build_sandbox_payment_router(self.service,user));client=TestClient(app)
        url='/api/v1/sandbox/paypal-test';auth={'Authorization':'Bearer synthetic','Idempotency-Key':'stable'}
        self.assertEqual(client.post(url,json={}).status_code,401)
        for extra in [{'amount':'99.00'},{'merchant_id':'OTHER'},{'owner':'another'}]:self.assertEqual(client.post(url,headers=auth,json=extra).status_code,422)
        result=client.post(url,headers=auth,json={})
        self.assertEqual(result.status_code,200);self.assertEqual(result.json()['data']['amount'],'0.10')
        self.assertNotIn('owner',result.json()['data']);self.assertNotIn('command_key',result.json()['data'])
        self.assertEqual(self.provider.creations,1)
