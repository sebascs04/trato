from copy import deepcopy
from hashlib import sha256
import unittest
from types import SimpleNamespace
from trato_api.errors import ApiError
from trato_api.proposals.workflow import ProposalWorkflow
from paypal.email import EmailDeliveryError

class WorkflowTest(unittest.TestCase):
 def setUp(self):
  self.sent=[];self.commands=[];self.content=b'%PDF-test-immutable'
  self.snapshot={'proposal':{'id':'p','project_id':'project','current_revision_id':'r','status':'ready_for_review'},'revision':{'id':'r','scope_summary':'Un video adicional','additional_minor':10,'deadline':'2026-11-12'},'artifacts':[{'document_id':'pdf','sha256':sha256(self.content).hexdigest()}],'reviews':[{}],'payments':[]}
  parent=self
  class Repo:
   def get_revision(self,*args,**kwargs):return deepcopy(parent.snapshot)
   def project(self,id):return {'id':id,'client_id':'c','name':'Proyecto'}
   def rows(self,*args):return [{'name':'Cliente','contact_email':'recipient@example.com'}]
   def document(self,id):return {'original_filename':'adenda-v1.pdf'}
   def download(self,doc):return parent.content
  class Gmail:
   def status(self,owner):return {'connected':True,'email':'sender@example.com'}
   def send(self,owner,item,id,**kwargs):parent.sent.append((owner,item,id,kwargs));return {'status':'accepted_by_gmail','message_id':'msg'}
  class Store:
   def command(self,owner,action,data):
    parent.commands.append((owner,action,data))
    if action=='mail_reserve':return {'acquired':True,'id':'outbox','status':'sending'}
    return {'id':'outbox',**data}
  self.repo=Repo();self.flow=ProposalWorkflow(SimpleNamespace(web_origin='http://localhost:5173'),Gmail(),store=Store())
 def test_preview_never_sends_or_reserves_and_contains_exact_pdf(self):
  result=self.flow.preview(self.repo,'owner','p','r','adenda')
  self.assertEqual(result['recipient'],'recipient@example.com');self.assertEqual(result['sha256'],sha256(self.content).hexdigest())
  self.assertIn('USD 0.10',result['body']);self.assertEqual(self.sent,[]);self.assertEqual(self.commands,[])
 def test_send_is_bound_to_reviewed_digest_sender_and_pdf(self):
  preview=self.flow.preview(self.repo,'owner','p','r','adenda')
  result=self.flow.send(self.repo,'owner','p','r','adenda',preview['digest'])
  self.assertEqual(result['status'],'accepted_by_gmail');self.assertEqual(self.sent[0][1].agreement.content,self.content)
  self.assertEqual(self.sent[0][3]['expected_sender'],'sender@example.com')
  self.assertEqual([c[1] for c in self.commands],['mail_reserve','mail_finish'])
 def test_draft_can_preview_but_cannot_send_until_its_review_is_recorded(self):
  self.snapshot['reviews']=[];self.snapshot['proposal']['status']='draft'
  preview=self.flow.preview(self.repo,'owner','p','r','adenda')
  self.assertEqual(self.sent,[]);self.assertEqual(self.commands,[])
  with self.assertRaises(ApiError) as caught:self.flow.send(self.repo,'owner','p','r','adenda',preview['digest'])
  self.assertEqual(caught.exception.code,'PROPOSAL_REVIEW_REQUIRED')
  self.snapshot['reviews']=[{}];self.snapshot['proposal']['status']='ready_for_review'
  self.flow.send(self.repo,'owner','p','r','adenda',preview['digest'])
  self.assertEqual(len(self.sent),1)
 def test_draft_preview_does_not_allow_missing_pdf_or_bypass_payment_acceptance(self):
  self.snapshot['reviews']=[];self.snapshot['proposal']['status']='draft'
  with self.assertRaises(ApiError):self.flow.preview(self.repo,'owner','p','r','payment')
  self.snapshot['artifacts']=[]
  with self.assertRaises(ApiError):self.flow.preview(self.repo,'owner','p','r','adenda')
  self.assertEqual(self.sent,[]);self.assertEqual(self.commands,[])
 def test_changed_digest_never_sends(self):
  with self.assertRaises(ApiError):self.flow.send(self.repo,'owner','p','r','adenda','0'*64)
  self.assertEqual(self.sent,[]);self.assertEqual(self.commands,[])
 def test_superseded_revision_is_rejected_before_send(self):
  self.snapshot['proposal']['current_revision_id']='new'
  with self.assertRaises(ApiError):self.flow.preview(self.repo,'owner','p','r','adenda')
 def test_duplicate_accepted_delivery_is_not_sent_again(self):
  preview=self.flow.preview(self.repo,'owner','p','r','adenda')
  self.flow.store=SimpleNamespace(command=lambda *args:{'id':'old','acquired':False,'status':'accepted_by_gmail'})
  self.assertEqual(self.flow.send(self.repo,'owner','p','r','adenda',preview['digest'])['id'],'old');self.assertEqual(self.sent,[])
 def test_uncertain_delivery_is_not_resent(self):
  preview=self.flow.preview(self.repo,'owner','p','r','adenda')
  self.flow.store=SimpleNamespace(command=lambda *args:{'id':'old','acquired':False,'status':'sending'})
  with self.assertRaises(ApiError) as caught:self.flow.send(self.repo,'owner','p','r','adenda',preview['digest'])
  self.assertEqual(caught.exception.code,'EMAIL_DELIVERY_UNCERTAIN');self.assertEqual(self.sent,[])
 def test_payment_email_requires_accepted_revision_and_prepared_order(self):
  with self.assertRaises(ApiError):self.flow.preview(self.repo,'owner','p','r','payment')
  self.snapshot['proposal']['status']='accepted'
  with self.assertRaises(ApiError):self.flow.preview(self.repo,'owner','p','r','payment')
 def test_unknown_checkout_does_not_contact_paypal(self):
  with self.assertRaises(ApiError):self.flow.checkout('bad',capture=True)
  self.assertEqual(self.commands,[])
