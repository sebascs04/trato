from copy import deepcopy
import os
from unittest.mock import patch
from hashlib import sha256
import unittest
from types import SimpleNamespace
from trato_api.errors import ApiError
from trato_api.proposals.workflow import ProposalWorkflow
from paypal.email import EmailDeliveryError, build_proposal_email

class WorkflowTest(unittest.TestCase):
 def setUp(self):
  self.sent=[];self.commands=[];self.portal=[];self.content=b'%PDF-test-immutable'
  env=patch.dict(os.environ,{'PORTAL_LINK_SECRET':'s'*64});env.start();self.addCleanup(env.stop)
  self.snapshot={'proposal':{'id':'p','project_id':'project','current_revision_id':'r','status':'ready_for_review'},'revision':{'id':'r','scope_summary':'Un video adicional','additional_minor':10,'deadline':'2026-11-12'},'artifacts':[{'document_id':'pdf','sha256':sha256(self.content).hexdigest()}],'reviews':[{}],'payments':[]}
  parent=self
  class Repo:
   def get_revision(self,*args,**kwargs):return deepcopy(parent.snapshot)
   def project(self,id):return {'id':id,'client_id':'c','name':'Proyecto'}
   def rows(self,*args):return [{'name':'Cliente','contact_email':'recipient@example.com'}]
   def document(self,id):return {'original_filename':'adenda-v1.pdf'}
   def download(self,doc):return parent.content
   def rpc(self,name,data):parent.portal.append((name,data));return {'link_id':'link'}
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
  message=build_proposal_email(preview['sender'],self.sent[0][1],'delivery')
  self.assertEqual(preview['body_html'],message.get_body(preferencelist=('html',)).get_content())
  self.assertIn('Alcance del cambio',preview['body_html'])
  self.assertIn('USD 0.10',preview['body_html'])
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
 def test_addendum_email_carries_the_portal_link_and_registers_only_its_hash(self):
  preview=self.flow.preview(self.repo,'owner','p','r','adenda')
  self.assertIn('http://localhost:5173/portal.html#t=',preview['body'])
  self.assertIn('Revisar y aceptar en línea',preview['body_html'])
  self.assertEqual(self.portal,[])
  self.flow.send(self.repo,'owner','p','r','adenda',preview['digest'])
  token=self.sent[0][1].portal_url.split('#t=')[1]
  self.assertRegex(token,'^[0-9a-f]{64}$')
  self.assertEqual(self.portal,[('client_portal_link_issue',{'p_proposal':'p','p_expected_revision':'r','p_token_hash':sha256(token.encode()).hexdigest(),'p_days':60})])
  self.assertNotIn(token,str(self.portal))
  self.assertEqual([c[1] for c in self.commands],['mail_reserve','mail_finish'])
 def test_portal_link_is_stable_between_preview_and_send_and_differs_per_revision(self):
  first=self.flow.preview(self.repo,'owner','p','r','adenda')
  again=self.flow.preview(self.repo,'owner','p','r','adenda')
  self.assertEqual(first['digest'],again['digest'])
  self.snapshot['proposal']['current_revision_id']='r2';self.snapshot['revision']['id']='r2'
  other=self.flow.preview(self.repo,'owner','p','r2','adenda')
  self.assertNotEqual(first['body'].split('#t=')[1][:64],other['body'].split('#t=')[1][:64])
 def test_missing_portal_secret_blocks_the_addendum_without_reserving_delivery(self):
  with patch.dict(os.environ,{'PORTAL_LINK_SECRET':''}):
   with self.assertRaises(ApiError) as caught:self.flow.preview(self.repo,'owner','p','r','adenda')
  self.assertEqual(caught.exception.code,'PORTAL_NOT_CONFIGURED');self.assertEqual(self.commands,[]);self.assertEqual(self.sent,[])
 def test_changed_digest_never_sends(self):
  with self.assertRaises(ApiError):self.flow.send(self.repo,'owner','p','r','adenda','0'*64)
  self.assertEqual(self.sent,[]);self.assertEqual(self.commands,[])
 def test_english_addendum_binds_preview_language_without_changing_delivery_identity(self):
  spanish=self.flow.prepare_email(self.repo,'owner','p','r','adenda',for_preview=True)
  _,preview,digest=self.flow.prepare_email(self.repo,'owner','p','r','adenda',for_preview=True,language='en')
  self.assertEqual(digest,spanish[2])
  self.assertNotEqual(preview['digest'],spanish[1]['digest'])
  self.assertIn('Addendum for review',preview['subject'])
  self.assertIn('Scope of change',preview['body_html'])
  self.assertIn('Un video adicional',preview['body'])
  with self.assertRaises(ApiError) as caught:
   self.flow.send(self.repo,'owner','p','r','adenda',preview['digest'])
  self.assertEqual(caught.exception.code,'EMAIL_PREVIEW_CHANGED')
  self.flow.send(self.repo,'owner','p','r','adenda',preview['digest'],language='en')
  message=build_proposal_email(preview['sender'],self.sent[0][1],'delivery')
  self.assertEqual(preview['body_html'],message.get_body(preferencelist=('html',)).get_content())
 def test_english_change_payment_email_keeps_the_verified_checkout_link(self):
  self.snapshot['proposal']['status']='accepted'
  url='https://www.sandbox.paypal.com/checkoutnow?token=ORDER'
  self.snapshot['payments']=[{'id':'payment','status':'pending_approval','approval_url':url}]
  preview=self.flow.preview(self.repo,'owner','p','r','payment',language='en')
  self.assertIn('Test payment request',preview['subject'])
  self.assertIn('Review payment in PayPal Sandbox',preview['body_html'])
  self.assertIn(url,preview['body'])
  self.assertIn('USD 0.10',preview['body_html'])
  self.flow.send(self.repo,'owner','p','r','payment',preview['digest'],language='en')
  self.assertEqual(self.sent[0][1].agreement.content,self.content)
 def test_verified_contact_appears_in_preview_and_is_bound_to_confirmation(self):
  legacy=self.flow.preview(self.repo,'owner','p','r','adenda')
  contact='freelancer@example.com'
  preview=self.flow.preview(self.repo,'owner','p','r','adenda',freelancer_email=contact)
  self.assertIn('Proyecto: Proyecto',preview['body'])
  self.assertIn('Correo del freelancer: '+contact,preview['body'])
  self.assertIn(contact,preview['body_html'])
  with self.assertRaises(ApiError) as caught:
   self.flow.send(self.repo,'owner','p','r','adenda',preview['digest'],freelancer_email='changed@example.com')
  self.assertEqual(caught.exception.code,'EMAIL_PREVIEW_CHANGED')
  self.flow.send(self.repo,'owner','p','r','adenda',preview['digest'],freelancer_email=contact)
  self.assertEqual(self.sent[0][1].freelancer_email,contact)
  self.assertEqual(self.commands[0][2]['message_hash'],legacy['digest'])
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
