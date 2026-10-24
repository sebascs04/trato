import unittest
try:
    from fastapi import FastAPI,Request,HTTPException
    from fastapi.testclient import TestClient
except ImportError:
    raise unittest.SkipTest('FastAPI routing tests require the trato-api dependencies.')
from paypal.routes import build_router
from paypal.client import PayPalError
from paypal.repository import PayableAcceptance,PaymentRecord

ID='11111111-1111-4111-8111-111111111111'
USER='22222222-2222-4222-8222-222222222222'

class Service:
    def __init__(self):self.calls=[]
    def record(self):return PaymentRecord(ID,PayableAcceptance(USER,ID,ID,ID,ID,'125.00','USD','MERCHANT12345','connected'),'pending_approval','private-create-key','private-capture-key',approval_url='https://www.sandbox.paypal.com/checkoutnow',updated_at='2026-10-24T00:00:00Z')
    def create(self,user,acceptance,key):self.calls.append(('create',user,acceptance,key));return self.record()
    def get(self,user,id):self.calls.append(('get',user,id));return self.record()
    def capture(self,user,id):self.calls.append(('capture',user,id));return self.record()
    def reconcile(self,user,id):self.calls.append(('reconcile',user,id));return self.record()
    def webhook(self,headers,event):self.calls.append(('webhook',event));raise PayPalError('INVALID_WEBHOOK_SIGNATURE',status=400)

class RoutesTest(unittest.TestCase):
    def setUp(self):
        self.service=Service();app=FastAPI()
        def require_user(request:Request):
            if request.headers.get('authorization')!='Bearer valid-user':raise HTTPException(status_code=401)
            return USER
        app.include_router(build_router(self.service,None,require_user))
        self.client=TestClient(app)
        self.auth={'Authorization':'Bearer valid-user','Idempotency-Key':'stable-key'}
    def test_authentication_precedes_payment_service(self):
        response=self.client.post('/api/v1/payments',json={'acceptance_id':ID})
        self.assertEqual(response.status_code,401);self.assertEqual(self.service.calls,[])
    def test_create_only_accepts_acceptance_id_not_arbitrary_amount_or_owner(self):
        for extra in [{'amount':'1.00'},{'owner_id':USER},{'recipient_email':'other@example.com'}]:
            response=self.client.post('/api/v1/payments',headers=self.auth,json={'acceptance_id':ID,**extra})
            self.assertEqual(response.status_code,422)
        self.assertEqual(self.service.calls,[])
        response=self.client.post('/api/v1/payments',headers=self.auth,json={'acceptance_id':ID})
        self.assertEqual(response.status_code,200)
        self.assertEqual(self.service.calls[0],('create',USER,ID,'stable-key'))
        data=response.json()['data']
        self.assertEqual(data['amount'],'125.00');self.assertEqual(data['updated_at'],'2026-10-24T00:00:00Z')
        self.assertNotIn('capture_request_id',data);self.assertNotIn('owner_id',data)
        self.assertEqual(response.headers['cache-control'],'no-store')
    def test_capture_does_not_accept_browser_claims_of_paid_status(self):
        response=self.client.post(f'/api/v1/payments/{ID}/capture',headers=self.auth,json={'status':'completed'})
        self.assertEqual(response.status_code,422);self.assertEqual(self.service.calls,[])
        response=self.client.post(f'/api/v1/payments/{ID}/capture',headers=self.auth)
        self.assertEqual(response.status_code,200)
    def test_email_not_configured_does_not_report_sent(self):
        response=self.client.post(f'/api/v1/payments/{ID}/notifications/email',headers=self.auth,json={})
        self.assertEqual(response.status_code,503);self.assertEqual(response.json()['error']['code'],'EMAIL_NOT_CONFIGURED')
    def test_webhook_uses_provider_verification_instead_of_user_jwt(self):
        response=self.client.post('/api/v1/webhooks/paypal',json={'id':'event-1','event_type':'PAYMENT.CAPTURE.COMPLETED'})
        self.assertEqual(response.status_code,400)
        self.assertEqual(self.service.calls[0][0],'webhook')
    def test_invalid_id_and_missing_key_do_not_call_provider(self):
        self.assertEqual(self.client.get('/api/v1/payments/no-uuid',headers=self.auth).status_code,422)
        self.assertEqual(self.client.post('/api/v1/payments',headers={'Authorization':'Bearer valid-user'},json={'acceptance_id':ID}).status_code,422)
        self.assertEqual(self.service.calls,[])

if __name__=='__main__':unittest.main()
