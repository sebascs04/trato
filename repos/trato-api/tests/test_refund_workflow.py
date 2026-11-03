"""Document workflow tests with explicit provider/Storage/Gmail doubles; no real sends."""
import base64
import json
import os
from copy import deepcopy
from email import message_from_bytes,policy
from hashlib import sha256
import subprocess
import threading
import unittest
from unittest.mock import patch
from uuid import UUID

from paypal.email import EmailDeliveryError
from trato_api.errors import ApiError
from trato_api.gmail.vault import GmailError
from trato_api.gmail.service import GmailConnectionService,GoogleTransport,SEND_URL,READ_SCOPE
from trato_api.refunds.mail import SettlementEmail,build_settlement_email
from trato_api.refunds.pdf import render_pdf
from trato_api.refunds.workflow import RefundWorkflow


def uid(n):return str(UUID(int=n))
OWNER,PARENT,SNAP,ART,DOC,PAY,PROJECT,CLIENT,DELIVERY=[uid(i) for i in range(1,10)]
CITE={'document_id':uid(20),'extraction_id':uid(21),'document_sha256':'a'*64,'quote':'Cancel this project.'}

def artifact_fixture():
    return {'id':ART,'snapshot_id':SNAP,'document_id':DOC,'language':'es','render_context':{
      'project_name':'Proyecto Café','client_name':'Cliente Norte','scope':'project_closure','request_evidence':[CITE],
      'snapshot':{'id':SNAP,'version_no':1,'terms':{'conditions':'Cierre acordado.','adjustments':[]},
       'breakdown':{'gross_minor':40000,'local_previous_refunds_minor':0,'seller_retention_minor':0,'customer_credit_minor':0,'refund_minor':40000,'additional_payment_due_minor':0},
       'payments':[{'payment_id':PAY,'capture_id':'CAPTURE-TEST','amount_minor':40000,'refund_minor':40000}]}}}

class Repo:
    def __init__(self):
        self.artifact=artifact_fixture();self.content=render_pdf(self.artifact);self.artifact['sha256']=sha256(self.content).hexdigest()
        self.parent={'id':PARENT,'project_id':PROJECT,'owner_id':OWNER,'payment_id':PAY,'current_snapshot_id':SNAP,'status':'draft'}
        self.replies=[];self.deliveries=[];self.email='customer@example.invalid'
    def snapshot(self,parent,snapshot):
        if parent!=PARENT or snapshot!=SNAP:raise ApiError('REFUND_NOT_FOUND',404)
        return {'settlement':deepcopy(self.parent),'snapshot':{'id':SNAP,'version_no':1,'breakdown':{'refund_minor':40000}},'artifacts':[deepcopy(self.artifact)],'reviews':[{'snapshot_id':SNAP}],'responses':deepcopy(self.replies),'deliveries':deepcopy(self.deliveries)}
    def settlement(self,parent):return deepcopy(self.parent)
    def project(self,project):return {'id':PROJECT,'client_id':CLIENT}
    def rows(self,table,params):return [{'contact_email':self.email}]
    def document(self,document):return {'id':DOC,'original_filename':'settlement.pdf'}
    def download(self,document):return self.content

class Store:
    def __init__(self,repo):self.repo=repo;self.calls=[];self.claim=None
    def command(self,owner,action,data):
        self.calls.append((owner,action,deepcopy(data)))
        if action=='register_initial':return {'project_id':PROJECT,'payment':{'id':PAY}}
        if action=='mail_reserve':
            if self.claim:return deepcopy(self.claim)|{'acquired':False}
            self.claim={'id':DELIVERY,'operation_key':data['operation_key'],'status':'sending','sender':data['sender'],'recipient':data['recipient'],'created_at':'2026-11-01T12:00:00+00:00','provider_thread_id':None}
            return deepcopy(self.claim)|{'acquired':True}
        if action=='mail_finish':
            self.claim.update(status=data['status'],provider_message_id=data.get('message_id'),provider_thread_id=data.get('thread_id'))
            self.repo.deliveries=[deepcopy(self.claim)]
            if data['status']=='accepted_by_gmail':self.repo.parent['status']='awaiting_response'
            return deepcopy(self.claim)
        if action=='response_record':
            self.repo.replies.append({'provider_message_id':data['provider_message_id']});return {'recorded':True}
        raise AssertionError(action)

class Gmail:
    _header=staticmethod(GmailConnectionService._header)
    message_content=GmailConnectionService.message_content
    _body_bytes=staticmethod(GmailConnectionService._body_bytes)
    _safe_filename=staticmethod(GmailConnectionService._safe_filename)
    def __init__(self):self.sent=[];self.error=None;self.messages=[];self.sender='owner@example.invalid'
    def status(self,owner):return {'connected':True,'email':self.sender}
    def send_refund(self,owner,item,id,**kwargs):
        self.sent.append((owner,item,id,kwargs))
        if self.error:raise self.error
        return {'status':'accepted_by_gmail','message_id':'SENT','thread_id':'THREAD'}
    def read_thread(self,owner,thread):return {'id':thread,'messages':deepcopy(self.messages)}

class Provider:
    merchant_id='TESTMERCHANT123'
    def __init__(self):
        self.order={'id':'ORDER','status':'COMPLETED','payer':{'email_address':'customer@example.invalid'},'purchase_units':[{'reference_id':'initial-'+PROJECT,'custom_id':'initial-'+PROJECT,'payee':{'merchant_id':self.merchant_id},'payments':{'captures':[{'id':'CAPTURE'}]}}]}
        self.capture={'id':'CAPTURE','status':'COMPLETED','amount':{'currency_code':'USD','value':'100.00'}}
    def get_order(self,id):return self.order
    def get_capture(self,id):return self.capture

class RefundWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.repo=Repo();self.store=Store(self.repo);self.gmail=Gmail();self.provider=Provider()
        self.flow=RefundWorkflow(None,self.gmail,store=self.store,paypal=self.provider)
    def preview(self):return self.flow.preview(self.repo,OWNER,PARENT,SNAP)
    def send(self,digest=None,key='send-key'):
        return self.flow.send(self.repo,OWNER,PARENT,SNAP,digest or self.preview()['digest'],key)
    def test_pdf_is_deterministic_contains_settlement_and_does_not_claim_execution(self):
        self.assertEqual(self.repo.content,render_pdf(self.repo.artifact))
        result=subprocess.run(['pdftotext','-','-'],input=self.repo.content,capture_output=True,check=True).stdout.decode()
        for text in ['Proyecto Café','USD 400.00','CAPTURE-TEST','Cancel this project.','pendientes de comprobación']:
            self.assertIn(text,result)
    def test_pdf_language_changes_template_without_translating_customer_data(self):
        artifact=deepcopy(self.repo.artifact);artifact['language']='en'
        text=subprocess.run(['pdftotext','-','-'],input=render_pdf(artifact),capture_output=True,check=True).stdout.decode()
        self.assertIn('Settlement proposal',text);self.assertIn('Cierre acordado.',text)
    def test_pdf_rejects_unsupported_language_and_characters(self):
        for update in [('language','fr'),('project','Unsupported \U0001f9ea')]:
            a=deepcopy(self.repo.artifact)
            if update[0]=='language':a['language']=update[1]
            else:a['render_context']['project_name']=update[1]
            with self.assertRaises(ApiError):render_pdf(a)
    def test_saved_pdf_is_returned_exactly_and_language_cannot_change(self):
        self.assertEqual(self.flow.pdf(self.repo,OWNER,PARENT,SNAP,'es','pdf-key')['artifact']['sha256'],self.repo.artifact['sha256'])
        with self.assertRaises(ApiError):self.flow.pdf(self.repo,OWNER,PARENT,SNAP,'en','other-key')
    def test_corrupt_pdf_is_never_previewed_or_sent(self):
        self.repo.content=b'%PDF-corrupt'
        with self.assertRaises(ApiError):self.preview()
        self.assertFalse(self.gmail.sent)
    def test_send_uses_one_reviewed_context_and_persists_exact_preview(self):
        p=self.preview();result=self.send(p['digest'])
        self.assertEqual(result['delivery']['status'],'accepted_by_gmail')
        claim=next(c[2] for c in self.store.calls if c[1]=='mail_reserve')
        self.assertEqual(claim['preview'],p);self.assertEqual(self.gmail.sent[0][1].recipient_email,p['recipient'])
    def test_changed_recipient_sender_or_digest_blocks_send_before_reservation(self):
        for change in ['recipient','sender','digest']:
            with self.subTest(change=change):
                self.setUp();p=self.preview()
                if change=='recipient':self.repo.email='other@example.invalid'
                if change=='sender':self.gmail.sender='new@example.invalid'
                digest='b'*64 if change=='digest' else p['digest']
                with self.assertRaises(ApiError):self.send(digest)
                self.assertFalse(self.store.calls);self.assertFalse(self.gmail.sent)
    def test_same_send_key_never_sends_again(self):
        p=self.preview();self.send(p['digest']);self.send(p['digest'])
        self.assertEqual(len(self.gmail.sent),1)
    def test_uncertain_send_stays_uncertain_and_is_not_retried(self):
        self.gmail.error=EmailDeliveryError('GOOGLE_UNAVAILABLE',uncertain=True);p=self.preview()
        with self.assertRaises(ApiError):self.send(p['digest'])
        self.assertEqual(self.store.claim['status'],'delivery_uncertain')
        with self.assertRaises(ApiError):self.send(p['digest'])
        self.assertEqual(len(self.gmail.sent),1);self.assertEqual(self.repo.parent['status'],'draft')
    def test_definitive_failure_is_not_an_accepted_send(self):
        self.gmail.error=EmailDeliveryError('GMAIL_SEND_NOT_AUTHORIZED')
        with self.assertRaises(ApiError):self.send()
        self.assertEqual(self.store.claim['status'],'failed');self.assertEqual(self.repo.parent['status'],'draft')
    def test_initial_sandbox_binding_is_explicit_owner_scoped_and_preserves_capture_checks(self):
        data={'order_id':'ORDER','capture_id':'CAPTURE','notes':'Reviewed','evidence':[CITE]}
        self.provider.order['payer']['email_address']='sandbox@example.invalid'
        config={'PAYPAL_ENVIRONMENT':'sandbox','TRATO_SANDBOX_INITIAL_PAYER_BINDINGS':json.dumps({str(OWNER):'sandbox@example.invalid'})}
        with patch.dict(os.environ,config):
            self.flow.register_initial(self.repo,OWNER,PROJECT,data,'bound')
            self.assertEqual(len(self.store.calls),1)
            self.provider.order['purchase_units'][0]['payee']['merchant_id']='OTHER'
            with self.assertRaises(ApiError):self.flow.register_initial(self.repo,OWNER,PROJECT,data,'wrong-merchant')
            self.provider.order['purchase_units'][0]['payee']['merchant_id']=self.provider.merchant_id
            self.provider.order['payer']['email_address']='unexpected@example.invalid'
            with self.assertRaises(ApiError):self.flow.register_initial(self.repo,OWNER,PROJECT,data,'wrong-payer')
        self.provider.order['payer']['email_address']='sandbox@example.invalid'
        with patch.dict(os.environ,config|{'TRATO_SANDBOX_INITIAL_PAYER_BINDINGS':json.dumps({'another-owner':'sandbox@example.invalid'})}):
            with self.assertRaises(ApiError):self.flow.register_initial(self.repo,OWNER,PROJECT,data,'other-owner')
        self.assertEqual(len(self.store.calls),1)

    def test_initial_sandbox_binding_rejects_live_or_invalid_configuration(self):
        data={'order_id':'ORDER','capture_id':'CAPTURE','notes':'Reviewed','evidence':[CITE]}
        for environment,mapping in [('live',json.dumps({str(OWNER):'sandbox@example.invalid'})),('sandbox','invalid-json'),('sandbox','[]'),('sandbox',json.dumps({str(OWNER):'invalid'}))]:
            with self.subTest(environment=environment,mapping=mapping),patch.dict(os.environ,{'PAYPAL_ENVIRONMENT':environment,'TRATO_SANDBOX_INITIAL_PAYER_BINDINGS':mapping}):
                with self.assertRaises(ApiError) as raised:self.flow.register_initial(self.repo,OWNER,PROJECT,data,'invalid-binding')
                self.assertEqual(raised.exception.code,'REFUND_SANDBOX_BINDING_INVALID')
        self.assertEqual(len(self.store.calls),0)

    def test_initial_registration_requires_project_reference_customer_and_verified_capture(self):
        data={'order_id':'ORDER','capture_id':'CAPTURE','notes':'Reviewed','evidence':[CITE]}
        self.flow.register_initial(self.repo,OWNER,PROJECT,data,'initial-key')
        payload=self.store.calls[0][2];self.assertEqual(payload['amount_minor'],10000)
        for change in ['reference','payer','merchant','status','currency']:
            with self.subTest(change=change):
                self.setUp()
                if change=='reference':self.provider.order['purchase_units'][0]['custom_id']='diagnostic'
                if change=='payer':self.provider.order['payer']['email_address']='other@example.invalid'
                if change=='merchant':self.provider.order['purchase_units'][0]['payee']['merchant_id']='OTHER'
                if change=='status':self.provider.capture['status']='PARTIALLY_REFUNDED'
                if change=='currency':self.provider.capture['amount']['currency_code']='EUR'
                with self.assertRaises(ApiError):self.flow.register_initial(self.repo,OWNER,PROJECT,data,'initial-key')
                self.assertFalse(self.store.calls)
    def test_initial_registration_rejects_incomplete_order_malformed_data_and_invalid_amount(self):
        data={'order_id':'ORDER','capture_id':'CAPTURE','notes':'Reviewed','evidence':[CITE]}
        for change in ['incomplete','units','payments','capture','amount','payer']:
            with self.subTest(change=change):
                self.setUp()
                if change=='incomplete':self.provider.order['status']='APPROVED'
                if change=='units':self.provider.order['purchase_units']=None
                if change=='payments':self.provider.order['purchase_units'][0]['payments']=None
                if change=='capture':self.provider.capture=None
                if change=='amount':self.provider.capture['amount']['value']='1e2'
                if change=='payer':self.provider.order['payer']=None
                with self.assertRaises(ApiError):self.flow.register_initial(self.repo,OWNER,PROJECT,data,'invalid-initial')
                self.assertFalse(self.store.calls)

    def test_gmail_read_errors_remain_structured_and_do_not_mutate_delivery(self):
        self.send()
        def denied(*args):raise GmailError('GMAIL_READ_PERMISSION_REQUIRED',409)
        self.gmail.read_thread=denied
        with self.assertRaises(ApiError) as error:self.flow.sync(self.repo,OWNER,PARENT,SNAP)
        self.assertEqual((error.exception.code,error.exception.status),('GMAIL_READ_PERMISSION_REQUIRED',409))
        self.assertEqual(self.store.claim['status'],'accepted_by_gmail');self.assertFalse(self.repo.replies)

    def test_reconciliation_requires_exact_sent_message_body_recipient_and_pdf(self):
        for change in ['missing','body','recipient','attachment','exact']:
            with self.subTest(change=change):
                self.setUp();self.gmail.error=EmailDeliveryError('GOOGLE_UNAVAILABLE',uncertain=True)
                with self.assertRaises(ApiError):self.send()
                _,item,sender=self.flow.context(self.repo,PARENT,SNAP)
                email=build_settlement_email(sender,item,DELIVERY)
                text=email.get_body(preferencelist=('plain',)).get_content()
                message={'id':'FOUND','threadId':'THREAD','payload':{'mimeType':'multipart/mixed','headers':[{'name':key,'value':str(value)} for key,value in email.items()],
                    'parts':[{'mimeType':'text/plain','body':{'data':base64.urlsafe_b64encode(text.encode()).decode()}},
                    {'mimeType':'application/pdf','filename':item.agreement.filename,'body':{'attachmentId':'ATTACHMENT','size':len(self.repo.content)}}]}}
                if change=='body':message['payload']['parts'][0]['body']['data']=base64.urlsafe_b64encode(b'Other content').decode()
                if change=='recipient':next(h for h in message['payload']['headers'] if h['name']=='To')['value']='other@example.invalid'
                self.gmail.find_refund_sent=lambda *args:None if change=='missing' else message
                self.gmail.read_attachment=lambda *args:b'%PDF-different' if change=='attachment' else self.repo.content
                if change in ['missing','exact']:
                    result=self.flow.reconcile_send(self.repo,OWNER,PARENT,SNAP,'send-key')
                    self.assertEqual(result['state'],'unconfirmed' if change=='missing' else 'confirmed')
                else:
                    with self.assertRaises(ApiError):self.flow.reconcile_send(self.repo,OWNER,PARENT,SNAP,'send-key')
                self.assertEqual(len(self.gmail.sent),1)
                self.assertEqual(self.store.claim['status'],'accepted_by_gmail' if change=='exact' else 'delivery_uncertain')

    def test_sync_validates_immediate_reply_thread_participants_and_deduplicates_without_accepting(self):
        self.send();expected='<canonical-sent-message@example.invalid>'
        def message(id,**headers):
            h={'From':'customer@example.invalid','To':'owner@example.invalid','In-Reply-To':expected,'References':expected}|headers
            return {'id':id,'threadId':'THREAD','internalDate':'1793538000000','payload':{'mimeType':'text/plain','headers':[{'name':k,'value':v} for k,v in h.items()],'body':{'data':base64.urlsafe_b64encode(b'Please revise the proposal.').decode().rstrip('=')}}}
        self.gmail.messages=[message('SENT',From='owner@example.invalid',To='customer@example.invalid',**{'Message-ID':expected,'In-Reply-To':'','References':''}),message('valid'),message('foreign',From='other@example.invalid'),message('older',**{'In-Reply-To':'<trato-refund-other@example.invalid>','References':expected})]
        self.assertEqual(self.flow.sync(self.repo,OWNER,PARENT,SNAP)['synced'],1)
        self.assertEqual(self.flow.sync(self.repo,OWNER,PARENT,SNAP)['synced'],0)
        self.assertEqual(self.repo.parent['status'],'awaiting_response')

class RefundGmailTransportTests(unittest.TestCase):
    def test_real_gmail_adapter_builds_exact_attachment_and_rechecks_sender(self):
        service=object.__new__(GmailConnectionService);service.lock=threading.RLock();calls=[]
        service.credentials=lambda user:{'email':'owner@example.invalid','access_token':'test-token','scope':READ_SCOPE}
        service.transport=lambda method,url,**kwargs:(calls.append((method,url,kwargs)) or (200,{'id':'sent','threadId':'thread'}))
        from paypal.email import PdfAttachment
        pdf=b'%PDF-test';item=SettlementEmail('customer@example.invalid','Project',1,'en',100,PdfAttachment('settlement.pdf',pdf,sha256(pdf).hexdigest()))
        result=service.send_refund(OWNER,item,DELIVERY,expected_sender='owner@example.invalid')
        self.assertEqual(result['status'],'accepted_by_gmail');self.assertEqual(calls[0][1],SEND_URL)
        mail=message_from_bytes(base64.urlsafe_b64decode(calls[0][2]['json']['raw']),policy=policy.default)
        self.assertEqual(str(mail['Message-ID']),f'<trato-refund-{DELIVERY}@example.invalid>')
        self.assertEqual(next(mail.iter_attachments()).get_payload(decode=True),pdf)
        with self.assertRaises(EmailDeliveryError):service.send_refund(OWNER,item,DELIVERY,expected_sender='other@example.invalid')
        self.assertEqual(len(calls),1)
    def test_header_injection_is_rejected(self):
        from paypal.email import PdfAttachment
        pdf=b'%PDF-test'
        with self.assertRaises(EmailDeliveryError):build_settlement_email('owner@example.invalid',SettlementEmail('customer@example.invalid','Project\nBcc: hidden@example.invalid',1,'es',10,PdfAttachment('a.pdf',pdf,sha256(pdf).hexdigest())),DELIVERY)

    def test_sent_search_is_fixed_scoped_and_ambiguous_results_are_not_confirmation(self):
        import httpx
        from urllib.parse import parse_qs,urlparse
        from trato_api.gmail.service import ATTACHMENTS_URL
        calls=[]
        def transport(request):
            calls.append(request)
            if request.url.path.endswith('/messages'):
                query=parse_qs(request.url.query.decode())
                self.assertEqual(query,{'q':[f'in:sent rfc822msgid:<trato-refund-{DELIVERY}@example.invalid>'],'maxResults':['2']})
                return httpx.Response(200,json={'messages':[{'id':'found'}]})
            return httpx.Response(200,json={'id':'found','threadId':'thread','payload':{}})
        service=object.__new__(GmailConnectionService)
        service.credentials=lambda user:{'email':'owner@example.invalid','access_token':'test-token','scope':READ_SCOPE}
        service.transport=GoogleTransport(httpx.MockTransport(transport))
        self.assertEqual(service.find_refund_sent(OWNER,DELIVERY)['id'],'found');self.assertEqual(len(calls),2)
        with self.assertRaises(GmailError):service.transport('GET',ATTACHMENTS_URL+'?q=in:inbox&maxResults=2')
        service.transport=lambda *args,**kwargs:(200,{'messages':[{'id':'one'},{'id':'two'}]})
        with self.assertRaises(GmailError):service.find_refund_sent(OWNER,DELIVERY)
