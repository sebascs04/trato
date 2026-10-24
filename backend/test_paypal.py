from dataclasses import replace
import json
import unittest
from paypal.client import PayPalSandboxClient,PaymentInstruction,PayPalError,Response
from paypal.repository import PayableAcceptance,PaymentRecord,OperationClaim,WebhookClaim
from paypal.service import PaymentService

MERCHANT='MERCHANT12345'

def order(status='CREATED',capture=None,amount='125.00'):
    unit={'reference_id':'payment-1','custom_id':'payment-1','amount':{'currency_code':'USD','value':amount},'payee':{'merchant_id':MERCHANT}}
    if capture:unit['payments']={'captures':[{'id':'CAPTURE12345','status':capture,'amount':{'currency_code':'USD','value':amount}}]}
    return {'id':'ORDER12345','intent':'CAPTURE','status':status,'purchase_units':[unit],'links':[{'rel':'payer-action','href':'https://www.sandbox.paypal.com/checkoutnow?token=ORDER12345'}]}

class Transport:
    def __init__(self,responses):self.responses=list(responses);self.calls=[]
    def __call__(self,method,path,headers,body):
        self.calls.append((method,path,headers,body))
        if path=='/v1/oauth2/token':return Response(200,{'access_token':'fake-token','expires_in':3600})
        item=self.responses.pop(0)
        if isinstance(item,Exception):raise item
        return Response(200,item)

class Repo:
    """Test double only; P2 supplies the transactional Supabase implementation."""
    def __init__(self,mode='connected',amount='125.00'):
        self.acceptance=PayableAcceptance('user-1','project-1','acceptance-1','revision-1','version-1',amount,'USD',MERCHANT,mode)
        self.record=None;self.marked=[];self.events=set();self.applied=0
    def resolve_payable_acceptance(self,user,acceptance):return self.acceptance
    def reserve_payment(self,user,a,key,command_hash):
        if self.record:return OperationClaim(self.record,False)
        self.record=PaymentRecord('payment-1',a,'creating','create-stable-id','capture-stable-id');return OperationClaim(self.record,True,'lease-test','2026-10-24T23:00:00Z')
    def get_payment(self,user,id):return self.record
    def claim_capture(self,user,id):self.record=replace(self.record,status='capturing');return OperationClaim(self.record,True,'lease-test','2026-10-24T23:00:00Z')
    def apply_provider_order(self,id,expected,result,*,expected_revision,lease_token=None):
        status='completed' if self.record.status=='completed' else result['status']
        self.record=replace(self.record,status=status,provider_order_id=result['order_id'],provider_capture_id=result['capture_id'],approval_url=result['approval_url'],revision=self.record.revision+1);self.applied+=1;return self.record
    def mark_uncertain(self,id,operation,code,*,expected_revision,lease_token):
        self.marked.append((id,operation,code));self.record=replace(self.record,status='reconciliation_required');return self.record
    def find_by_provider_order(self,id):return self.record if self.record and self.record.provider_order_id==id else None
    def reserve_webhook(self,id,kind,order_id):
        if id in self.events:return WebhookClaim('processed')
        self.events.add(id);return WebhookClaim('acquired','webhook-lease')
    def finish_webhook(self,id,processed,*,lease_token):
        if not processed:self.events.discard(id)

class PayPalTest(unittest.TestCase):
    def client(self,responses):
        transport=Transport(responses)
        return PayPalSandboxClient('fake-id','fake-secret',MERCHANT,'fake-webhook',transport=transport),transport
    def service(self,responses,repo=None):
        client,transport=self.client(responses);repo=repo or Repo()
        return PaymentService(client,repo,return_url='http://localhost:5173/paypal/return',cancel_url='http://localhost:5173/paypal/cancel'),repo,transport
    def test_create_uses_persisted_amount_merchant_reference_and_stable_id(self):
        service,repo,transport=self.service([order()])
        result=service.create('user-1','acceptance-1','key-1')
        self.assertEqual(result.status,'pending_approval')
        payload=json.loads(transport.calls[-1][3]);unit=payload['purchase_units'][0]
        self.assertEqual(unit['amount']['value'],'125.00');self.assertEqual(unit['payee']['merchant_id'],MERCHANT)
        self.assertEqual(transport.calls[-1][2]['PayPal-Request-Id'],'create-stable-id')
        before=len(transport.calls)
        self.assertEqual(service.create('user-1','acceptance-1','key-1').id,result.id)
        self.assertEqual(len(transport.calls),before)
    def test_simulated_acceptance_or_zero_never_calls_paypal(self):
        for repo,code in [(Repo(mode='simulation'),'ACCEPTANCE_NOT_PAYABLE'),(Repo(amount='0.00'),'PAYMENT_NOT_REQUIRED')]:
            service,_,transport=self.service([],repo)
            with self.assertRaises(PayPalError) as ctx:service.create('user-1','acceptance-1','key-1')
            self.assertEqual(ctx.exception.code,code);self.assertEqual(transport.calls,[])
    def test_timeout_retains_reservation_and_does_not_mint_new_order(self):
        service,repo,transport=self.service([PayPalError('PAYPAL_UNAVAILABLE',uncertain=True)])
        with self.assertRaises(PayPalError):service.create('user-1','acceptance-1','key-1')
        self.assertEqual(repo.record.status,'reconciliation_required')
        count=len(transport.calls);service.create('user-1','acceptance-1','key-1')
        self.assertEqual(len(transport.calls),count)
    def test_capture_checks_approval_and_pending_is_not_paid(self):
        service,repo,transport=self.service([order(),order('APPROVED'),order('COMPLETED','PENDING'),order('COMPLETED','PENDING')])
        service.create('user-1','acceptance-1','key-1')
        result=service.capture('user-1','payment-1')
        self.assertEqual(result.status,'pending')
        capture_call=next(call for call in transport.calls if call[1].endswith('/capture'))
        self.assertEqual(capture_call[2]['PayPal-Request-Id'],'capture-stable-id')
    def test_unapproved_order_cannot_be_captured(self):
        service,repo,transport=self.service([order(),order()])
        service.create('user-1','acceptance-1','key-1')
        with self.assertRaises(PayPalError) as ctx:service.capture('user-1','payment-1')
        self.assertEqual(ctx.exception.code,'BUYER_APPROVAL_REQUIRED')
        self.assertFalse(any(call[1].endswith('/capture') for call in transport.calls))
    def test_wrong_amount_merchant_or_reference_is_rejected(self):
        client,_=self.client([]);instruction=PaymentInstruction('payment-1','125.00','USD',MERCHANT)
        for field,value in [('amount','1.00'),('payee','OTHER12345'),('custom_id','wrong-payment')]:
            document=order()
            if field=='amount':document['purchase_units'][0]['amount']['value']=value
            elif field=='payee':document['purchase_units'][0]['payee']['merchant_id']=value
            else:document['purchase_units'][0]['custom_id']=value
            with self.assertRaises(PayPalError):client.validate_order(document,instruction)
    def test_approval_link_is_sandbox_only_and_no_live_endpoint_is_configurable(self):
        document=order();document['links'][0]['href']='https://www.paypal.com/checkoutnow?token=LIVE'
        self.assertIsNone(PayPalSandboxClient.approval_url(document))
    def test_webhook_signature_required_and_duplicate_does_not_repeat_apply(self):
        service,repo,transport=self.service([order(),{'verification_status':'SUCCESS'},order('COMPLETED','COMPLETED'),{'verification_status':'SUCCESS'}])
        service.create('user-1','acceptance-1','key-1')
        event={'id':'EVENT12345','event_type':'PAYMENT.CAPTURE.COMPLETED','resource':{'id':'CAPTURE12345','supplementary_data':{'related_ids':{'order_id':'ORDER12345'}}}}
        with self.assertRaises(PayPalError):service.webhook({},event)
        headers={'paypal-auth-algo':'SHA256withRSA','paypal-cert-url':'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-TEST','paypal-transmission-id':'transmission-1','paypal-transmission-sig':'fake-signature','paypal-transmission-time':'2026-10-24T20:00:00Z'}
        service.webhook(headers,event);applied=repo.applied
        self.assertEqual(repo.record.status,'completed')
        self.assertTrue(service.webhook(headers,event)['duplicate']);self.assertEqual(repo.applied,applied)
    def test_owner_is_not_accepted_from_payload(self):
        service,repo,transport=self.service([])
        with self.assertRaises(PayPalError) as ctx:service.create('other-user','acceptance-1','key-1')
        self.assertEqual(ctx.exception.status,404);self.assertEqual(transport.calls,[])

if __name__=='__main__':unittest.main()


class EmailTest(unittest.TestCase):
    def item(self):
        from paypal.email import PaymentEmail
        return PaymentEmail('payment-1','cliente@example.com','Ana','Proyecto <prueba>','125.00','USD','https://www.sandbox.paypal.com/checkoutnow?token=ORDER12345')
    def test_email_is_multipart_sandbox_and_escapes_html(self):
        from paypal.email import build_payment_email,EmailDeliveryError
        message=build_payment_email('estudio@example.com',self.item(),'notice-1')
        self.assertEqual(message['To'],'cliente@example.com')
        self.assertIn('sin dinero real',message.get_body(preferencelist=('plain',)).get_content())
        self.assertIn('&lt;prueba&gt;',message.get_body(preferencelist=('html',)).get_content())
        with self.assertRaises(EmailDeliveryError):build_payment_email('estudio@example.com',replace(self.item(),recipient_email='a@example.com\nBcc:other@example.com'),'notice-1')
        with self.assertRaises(EmailDeliveryError):build_payment_email('estudio@example.com',replace(self.item(),approval_url='https://www.paypal.com/checkout'),'notice-1')
    def test_smtp_uses_starttls_and_only_confirms_server_acceptance(self):
        from paypal.email import SmtpPaymentMailer,SmtpConfig
        calls=[]
        class FakeSmtp:
            def __init__(self,*args,**kwargs):calls.append(('connect',args))
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def ehlo(self):calls.append('ehlo')
            def starttls(self,**kwargs):calls.append('tls')
            def login(self,*args):calls.append('login')
            def send_message(self,message):calls.append(('send',message['To']));return {}
        mailer=SmtpPaymentMailer(SmtpConfig('smtp.example.com',587,'estudio@example.com','fake-user','fake-password'),smtp_factory=FakeSmtp)
        result=mailer.send(self.item(),'notice-1')
        self.assertEqual(result['status'],'accepted_by_smtp')
        self.assertLess(calls.index('tls'),calls.index('login'))
        self.assertIn(('send','cliente@example.com'),calls)
    def test_timeout_after_data_is_uncertain_and_remote_plaintext_is_forbidden(self):
        from paypal.email import SmtpPaymentMailer,SmtpConfig,EmailDeliveryError
        import smtplib
        class Disconnected:
            def __init__(self,*args,**kwargs):pass
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def ehlo(self):pass
            def starttls(self,**kwargs):pass
            def send_message(self,message):raise smtplib.SMTPServerDisconnected()
        with self.assertRaises(EmailDeliveryError) as ctx:
            SmtpPaymentMailer(SmtpConfig('smtp.example.com',587,'estudio@example.com'),smtp_factory=Disconnected).send(self.item(),'notice-1')
        self.assertTrue(ctx.exception.uncertain)
        with self.assertRaises(EmailDeliveryError):SmtpPaymentMailer(SmtpConfig('smtp.example.com',25,'estudio@example.com',encryption='local'))
    def test_simulated_acceptance_never_sends_email(self):
        from paypal.notifications import PaymentNotificationService,NotificationContext
        from paypal.email import EmailDeliveryError
        class NotificationRepo:
            def resolve_email_context(self,user,id):return NotificationContext(PaymentRecord('payment-1',Repo(mode='simulation').acceptance,'pending_approval','create','capture',approval_url='https://www.sandbox.paypal.com/checkoutnow'), 'cliente@example.com','Ana','Proyecto')
        class NeverMailer:
            def send(self,*args):raise AssertionError('must not send')
        with self.assertRaises(EmailDeliveryError):PaymentNotificationService(NotificationRepo(),NeverMailer()).send('user-1','payment-1','mail-key')

class SandboxBoundaryTest(unittest.TestCase):
    def test_foreign_owner_cannot_get_capture_or_reconcile_even_with_incomplete_repo(self):
        repo=Repo();repo.reserve_payment('user-1',repo.acceptance,'key','hash')
        transport=Transport([])
        service=PaymentService(PayPalSandboxClient('fake','fake-secret',MERCHANT,transport=transport),repo,return_url='http://localhost:5173',cancel_url='http://localhost:5173')
        for operation in [service.get,service.capture,service.reconcile]:
            with self.assertRaises(PayPalError) as error:operation('foreign-user','payment-1')
            self.assertEqual(error.exception.status,404)
        self.assertEqual(transport.calls,[])
    def test_malformed_oauth_never_returns_token_or_crashes_on_scalar_body(self):
        for body in [[],{}, {'access_token':'','expires_in':3600},{'access_token':'SECRET_TOKEN','expires_in':float('inf')}]:
            client=PayPalSandboxClient('fake','secret',MERCHANT,transport=lambda *args:Response(200,body))
            with self.assertRaises(PayPalError) as error:client.get_order('ORDER12345')
            self.assertNotIn('SECRET_TOKEN',str(error.exception))
    def test_config_requires_real_repository_and_never_enables_live_environment(self):
        from paypal.config import SandboxSettings,build_payment_service
        settings=SandboxSettings(client_id='private-id',client_secret='private-secret',merchant_id=MERCHANT,return_url='http://localhost:5173',cancel_url='http://localhost:5173')
        self.assertNotIn('private-secret',repr(settings));self.assertNotIn('private-id',repr(settings))
        with self.assertRaises(PayPalError) as error:build_payment_service(None,settings)
        self.assertEqual(error.exception.code,'PAYMENT_REPOSITORY_NOT_CONFIGURED')
        with self.assertRaises(PayPalError) as error:build_payment_service(Repo(),replace(settings,environment='live'))
        self.assertEqual(error.exception.code,'LIVE_PAYMENTS_DISABLED')
    def test_http_transport_refuses_redirect_instead_of_forwarding_credentials(self):
        from paypal.client import NoRedirect
        self.assertIsNone(NoRedirect().redirect_request(None,None,302,'Found',{},'https://example.com/steal'))
