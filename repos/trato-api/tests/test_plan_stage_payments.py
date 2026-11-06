import unittest
from types import SimpleNamespace
from unittest.mock import Mock,patch
from uuid import uuid4
from pydantic import ValidationError
from trato_api.initial_payments.stages import StagePayments,StageStore
from trato_api.initial_payments.routes import StagePaymentInput
from trato_api.initial_payments.workflow import build_email
from trato_api.errors import ApiError

OWNER,PROJECT,CLIENT,FILE=[str(uuid4()) for _ in range(4)]
class StageTests(unittest.TestCase):
 def setUp(self):
  self.repo=Mock();self.repo.project.return_value={'id':PROJECT,'owner_id':OWNER,'client_id':CLIENT}
  def rows(table,params):
   if table=='project_start_stages':return [{'position':2,'title':'Development','amount':'240.00','payment_condition':'After delivery'}]
   if table=='document_upload_contexts':return [{'stage_position':2,'purpose':'delivery_evidence'}]
   return [{'contact_email':'client@example.com'}]
  self.repo.rows.side_effect=rows;self.gateway=Mock();self.gateway.receipt.return_value={'status':'ready','generation':'a'*64,'summary_fingerprint':'b'*64};self.gateway.summary.return_value={'summary_fingerprint':'b'*64}
  self.store=Mock();self.flow=StagePayments(SimpleNamespace(),None,2,store=self.store,gateway=self.gateway,paypal=Mock())
  self.data={'evidence_document_id':FILE,'output_language':'en'}
 def test_amount_and_conditions_come_from_saved_stage_after_current_index_receipt(self):
  with patch('trato_api.initial_payments.stages.source',return_value={'generation':'a'*64}),patch('trato_api.initial_payments.stages.InitialPayments.prepare',return_value={'status':'pending_approval'}) as prepare:
   self.flow.prepare_stage(self.repo,OWNER,PROJECT,self.data,'key')
   payload=prepare.call_args.args[3];self.assertEqual(payload['amount_minor'],24000);self.assertEqual(payload['conditions'],'After delivery');self.assertEqual(payload['evidence_document_id'],FILE)
 def test_missing_or_stale_vector_receipt_blocks_provider_actions(self):
  for receipt in [None,{'status':'indexing'},{'status':'ready','generation':'old','summary_fingerprint':'b'*64}]:
   self.gateway.receipt.return_value=receipt
   with patch('trato_api.initial_payments.stages.source',return_value={'generation':'a'*64}),patch('trato_api.initial_payments.stages.InitialPayments.prepare') as prepare:
    with self.assertRaises(ApiError) as error:self.flow.prepare_stage(self.repo,OWNER,PROJECT,self.data,'key')
    self.assertEqual(error.exception.code,'PLAN_EVIDENCE_NOT_READY');prepare.assert_not_called()
 def test_foreign_owner_and_evidence_binding_are_rejected(self):
  with self.assertRaises(ApiError):self.flow.prepare_stage(self.repo,str(uuid4()),PROJECT,self.data,'key')
  self.repo.rows.side_effect=lambda table,params:[{'amount':'240','payment_condition':'After delivery'}] if table=='project_start_stages' else [{'stage_position':1,'purpose':'delivery_evidence'}]
  with self.assertRaises(ApiError) as error:self.flow.prepare_stage(self.repo,OWNER,PROJECT,self.data,'key')
  self.assertEqual(error.exception.code,'PLAN_EVIDENCE_INVALID')
 def test_confirmation_is_strict_and_amount_cannot_be_overridden(self):
  with self.assertRaises(ValidationError):StagePaymentInput.model_validate({'output_language':'en','confirmed':True})
  for extra in [{'confirmed':1},{'confirmed':False},{'confirmed':True,'amount_minor':1}]:
   with self.assertRaises(ValidationError):StagePaymentInput.model_validate({**self.data,**extra})
 def test_stage_wrapper_keeps_provider_reconciliation_bound_to_checkout_id(self):
  store=Mock();wrapper=StageStore(store,2);wrapper.command(OWNER,'get',{'project_id':PROJECT});self.assertEqual(store.command.call_args.args[2]['stage_position'],2)
  wrapper.command(OWNER,'apply',{'id':'checkout'});self.assertEqual(store.command.call_args.args[2],{'id':'checkout'})
 def test_email_identifies_stage_and_contains_brand_mascot_and_exact_link(self):
  item={'output_language':'en','amount_minor':24000,'project_name':'Aurora','stage_position':2,'recipient_email':'client@example.com','conditions':'After delivery','url':'https://example.invalid/initial-payment.html?checkout=test'}
  email=build_email('sender@example.com',item,'notification');html=email.get_body(preferencelist=('html',)).get_content()
  self.assertIn('Deliverable payment',str(email['Subject']));self.assertIn('trato-guide.png',html);self.assertIn(item['url'],html);self.assertIn('deliverable 2',email.get_body(preferencelist=('plain',)).get_content())
