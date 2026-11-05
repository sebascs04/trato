"""Initial checkout contracts, provider verification and exactly-once business effects."""
import copy,json,unittest
from types import SimpleNamespace
from uuid import uuid4
from unittest.mock import Mock,patch
from fastapi import FastAPI
from fastapi.testclient import TestClient
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from paypal.client import PayPalSandboxClient,PayPalError,Response
from paypal.email import EmailDeliveryError
from trato_api.errors import ApiError
from trato_api.initial_payments.workflow import InitialPayments,build_email
from trato_api.initial_payments.routes import PaymentInput,SendInput,build_initial_payment_router
OWNER,PROJECT,CLIENT,ID=[str(uuid4()) for _ in range(4)]
MERCHANT='MERCHANT12345';TOKEN='a'*43

def payment(**kwargs):
    return dict(id=ID,owner_id=OWNER,project_id=PROJECT,amount_minor=45000,currency='USD',merchant_id=MERCHANT,
        payer_email='buyer@example.com',recipient_email='client@example.com',client_name='Client',project_name='Website',
        conditions='First stage before starting',output_language='en',checkout_token=TOKEN,status='pending_approval',
        order_id='ORDER12345',mail_id=str(uuid4()),mail_status='not_sent',**kwargs)

def order(status='APPROVED',payer='buyer@example.com',amount='450.00',capture=False):
    unit={'reference_id':'initial-'+PROJECT,'custom_id':'initial-'+PROJECT,'payee':{'merchant_id':MERCHANT},'amount':{'currency_code':'USD','value':amount}}
    if capture:unit['payments']={'captures':[{'id':'CAPTURE12345','status':'COMPLETED','amount':{'currency_code':'USD','value':amount}}]}
    return {'id':'ORDER12345','intent':'CAPTURE','status':status,'purchase_units':[unit],'payer':{'email_address':payer},'links':[{'rel':'approve','href':'https://www.sandbox.paypal.com/checkoutnow?token=ORDER12345'}]}

class Store:
    def __init__(self,pay=None):self.pay=pay or payment();self.calls=[];self.received=0
    def command(self,owner,action,data):
        self.calls.append((owner,action,copy.deepcopy(data)))
        if action in ('get','checkout'):return copy.deepcopy(self.pay)
        if action in ('claim_create','claim_capture','mail_claim'):return {**copy.deepcopy(self.pay),'acquired':True}
        if action=='apply':
            if self.pay['status']!='completed' and data['status']=='completed':self.received+=1
            self.pay.update({k:v for k,v in data.items() if k!='id'});return copy.deepcopy(self.pay)
        if action=='mail_finish':self.pay['mail_status']=data['status'];return copy.deepcopy(self.pay)
        if action=='prepare':self.pay.update(data);return copy.deepcopy(self.pay)
        return copy.deepcopy(self.pay)

class InitialPaymentTest(unittest.TestCase):
    def setUp(self):
        self.settings=SimpleNamespace(web_origin='http://localhost:5173')
        self.store=Store();self.calls=[];self.orders=[order('COMPLETED',capture=True)]
        def transport(method,path,headers,body):
            self.calls.append((method,path,headers,body))
            if path=='/v1/oauth2/token':return Response(200,{'access_token':'private-token','expires_in':3600})
            if path.startswith('/v2/payments/captures/'):
                return Response(200,{'id':'CAPTURE12345','status':'COMPLETED','amount':{'currency_code':'USD','value':'450.00'}})
            if path.endswith('/capture'):return Response(201,self.orders[-1])
            return Response(200,self.orders.pop(0) if len(self.orders)>1 else self.orders[0])
        self.provider=PayPalSandboxClient('id','secret',MERCHANT,transport=transport)
        self.flow=InitialPayments(self.settings,store=self.store,paypal=self.provider)
        self.repo=Mock();self.repo.project.return_value={'id':PROJECT,'owner_id':OWNER,'client_id':CLIENT};self.repo.rows.return_value=[{'contact_email':'buyer@example.com'}]
    def test_completed_capture_is_verified_and_recorded_once(self):
        a=self.flow.checkout(TOKEN,capture=True);b=self.flow.checkout(TOKEN,capture=True)
        self.assertEqual(a['status'],'completed');self.assertEqual(a,b);self.assertEqual(self.store.received,1)
        self.assertTrue(any(path=='/v2/payments/captures/CAPTURE12345' for _,path,_,_ in self.calls))
        self.assertNotIn('payer_email',a);self.assertNotIn('owner_id',a);self.assertNotIn('checkout_token',a)
    def test_return_url_or_capture_flag_never_proves_a_payment(self):
        self.orders=[order('CREATED')];result=self.flow.checkout(TOKEN,capture=True)
        self.assertEqual(result['status'],'pending_approval');self.assertEqual(self.store.received,0)
        self.assertFalse(any(method=='POST' and path.endswith('/capture') for method,path,_,_ in self.calls))
    def test_wrong_payer_cannot_be_captured(self):
        self.orders=[order(payer='other@example.com')]
        with self.assertRaises(ApiError) as error:self.flow.checkout(TOKEN,capture=True)
        self.assertEqual(error.exception.code,'INITIAL_PAYER_MISMATCH');self.assertEqual(self.store.received,0)
        self.assertFalse(any(path.endswith('/capture') for _,path,_,_ in self.calls))
    def test_wrong_amount_reference_merchant_or_capture_rejected(self):
        for mutator in [lambda x:x['purchase_units'][0]['amount'].update(value='451.00'),lambda x:x['purchase_units'][0].update(custom_id='other'),lambda x:x['purchase_units'][0]['payee'].update(merchant_id='OTHER12345')]:
            value=order('COMPLETED',capture=True);mutator(value)
            with self.assertRaises(PayPalError):self.flow.apply(payment(),value)
        self.assertEqual(self.store.received,0)
    def test_capture_detail_amount_must_match(self):
        self.provider.get_capture=Mock(return_value={'id':'CAPTURE12345','status':'COMPLETED','amount':{'currency_code':'USD','value':'1.00'}})
        with self.assertRaises(ApiError):self.flow.checkout(TOKEN)
        self.assertEqual(self.store.received,0)
    def test_capture_uses_stable_provider_request_id(self):
        self.orders=[order(),order('COMPLETED',capture=True)]
        self.flow.checkout(TOKEN,capture=True)
        calls=[x for x in self.calls if x[0]=='POST' and x[1].endswith('/capture')]
        self.assertEqual(len(calls),1);self.assertEqual(calls[0][2]['PayPal-Request-Id'],'ic-'+ID.replace('-',''))
    def test_owner_mismatch_stops_before_provider_or_store(self):
        with self.assertRaises(ApiError):self.flow.prepare(self.repo,str(uuid4()),PROJECT,{},str(uuid4()))
        self.assertFalse(self.calls);self.assertFalse(self.store.calls)
    def test_invalid_tokens_stop_before_store(self):
        for token in ['',None,'a'*42,'x/'+'a'*41]:
            with self.assertRaises(ApiError):self.flow.checkout(token)
        self.assertFalse(self.store.calls)
    def test_creation_retry_keeps_reference_request_id_and_configured_return(self):
        self.store.pay['order_id']=None;self.store.pay['status']='creating';self.orders=[order('CREATED')]
        self.flow.create(self.store.pay)
        call=next(c for c in self.calls if c[1]=='/v2/checkout/orders');body=json.loads(call[3])
        self.assertEqual(call[2]['PayPal-Request-Id'],'ip-'+ID.replace('-',''))
        self.assertEqual(body['purchase_units'][0]['reference_id'],'initial-'+PROJECT)
        self.assertTrue(body['payment_source']['paypal']['experience_context']['return_url'].startswith('http://localhost:5173/initial-payment.html?'))
    def test_no_browser_confirmation_coercion_or_unreviewed_amount(self):
        good={'amount_minor':100,'conditions':'Agreed advance','confirmed':True,'output_language':'en'}
        self.assertEqual(PaymentInput.model_validate(good).amount_minor,100)
        for update in [{'amount_minor':0},{'amount_minor':-1},{'amount_minor':'100'},{'confirmed':False},{'confirmed':'true'},{'conditions':'  '},{'output_language':'fr'},{'currency':'EUR'}]:
            with self.assertRaises(ValidationError):PaymentInput.model_validate({**good,**update})
    def test_send_requires_unchanged_preview_and_preserves_recipient(self):
        gmail=Mock();gmail.status.return_value={'connected':True,'email':'trato@example.com'};gmail._send_built.return_value={'message_id':'m','thread_id':'t'}
        flow=InitialPayments(self.settings,gmail,store=self.store,paypal=self.provider)
        _,_,preview=flow.preview(self.repo,OWNER,PROJECT)
        with self.assertRaises(ApiError):flow.send(self.repo,OWNER,PROJECT,'b'*64)
        gmail._send_built.assert_not_called()
        result=flow.send(self.repo,OWNER,PROJECT,preview['digest']);self.assertEqual(result['mail_status'],'sent')
        self.assertEqual(gmail._send_built.call_args.args[1]['recipient_email'],'client@example.com')
    def test_ambiguous_email_is_not_reported_sent(self):
        gmail=Mock();gmail.status.return_value={'connected':True,'email':'trato@example.com'};gmail._send_built.side_effect=EmailDeliveryError('GMAIL_SEND_FAILED',uncertain=True)
        flow=InitialPayments(self.settings,gmail,store=self.store,paypal=self.provider);_,_,p=flow.preview(self.repo,OWNER,PROJECT)
        with self.assertRaises(ApiError):flow.send(self.repo,OWNER,PROJECT,p['digest'])
        self.assertEqual(self.store.pay['mail_status'],'uncertain')
    def test_email_bilingual_and_escapes_project_and_conditions(self):
        for lang in ['es','en']:
            item={**payment(),'output_language':lang,'conditions':'<script>bad</script>','url':'https://example.com/initial-payment.html?checkout='+TOKEN}
            m=build_email('trato@example.com',item,str(uuid4()))
            self.assertEqual(m['To'],'client@example.com');self.assertNotIn('<script>',m.get_body(preferencelist=('html',)).get_content())
            self.assertIn('450.00',m.get_body(preferencelist=('plain',)).get_content())

class InitialRouteTest(unittest.TestCase):
    def test_auth_and_explicit_review_before_external_call(self):
        app=FastAPI();flow=Mock()
        def require_user():return OWNER
        @app.exception_handler(ApiError)
        async def handle(request,error):return JSONResponse({"error":{"code":error.code}},status_code=error.status)
        app.include_router(build_initial_payment_router(SimpleNamespace(),require_user,workflow=flow,repository_factory=lambda *a:Mock()))
        with TestClient(app) as client:
            response=client.post('/api/v1/projects/'+PROJECT+'/initial-checkout',headers={'Idempotency-Key':str(uuid4())},json={'amount_minor':100,'conditions':'x','confirmed':False,'output_language':'en'})
            self.assertEqual(response.status_code,422)
        flow.prepare.assert_not_called()
