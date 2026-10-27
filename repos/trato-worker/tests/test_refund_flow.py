import copy
import json
from pathlib import Path
import socket
import tempfile
import unittest
from unittest.mock import patch
from uuid import uuid4
from trato_worker.threads import ThreadWorker

class RefundTests(unittest.TestCase):
 def setUp(self):
  folder=tempfile.TemporaryDirectory();self.addCleanup(folder.cleanup)
  self.path=Path(folder.name)/'refund.sqlite';self.worker=ThreadWorker(self.path,mode='simulation')
  self.msg={'type':'thread','schema_version':1,'mode':'simulation','workflow':'manage_refund','thread_id':str(uuid4()),'event_id':str(uuid4()),'action':'start','context':{key:str(uuid4()) for key in ('owner_id','client_id','project_id')},'payload':{'request_id':str(uuid4()),'fixture_id':'partial'}}
  self.approve={'action':'approve_refund_proposal','recognized_work_minor':20000,'terms':'Se entrega lo trabajado y se devuelven USD 100.'}
 def start(self):
  self.response=self.worker.handle(self.msg);return self.response['result']
 def resume(self,action):
  msg={**self.msg,'event_id':str(uuid4()),'action':'resume','payload':{'interrupt_id':self.response['result']['pending']['interrupt_id'],'input':action}}
  self.response=self.worker.handle(msg);return self.response['result']
 def draft(self):
  self.start();self.resume({'action':'confirm_case'});return self.resume(self.approve)
 def accepted(self):
  self.draft();self.resume({'action':'simulate_send'});return self.resume({'action':'accept'})
 def test_full_lifecycle_needs_authorization_and_pending_does_not_finish(self):
  with patch.object(socket.socket,'connect',side_effect=AssertionError('No network')):
   result=self.accepted();self.assertEqual(result['pending']['stage'],'authorize_refund');self.assertIsNone(result['refund'])
   self.resume({'action':'authorize_simulated_refund'})
   result=self.resume({'action':'simulate_pending'});self.assertFalse(result['read_only']);self.assertEqual(result['refund']['status'],'PENDING')
   result=self.resume({'action':'simulate_completed'});self.assertTrue(result['read_only']);self.assertEqual(result['business_status'],'Devolución completada');self.assertFalse(result['provider_verified'])
   self.assertEqual(result['case']['payment_status'],'COMPLETED');self.assertEqual(result['refund']['amount_minor'],10000)
   with self.assertRaises(ValueError):self.worker.handle({**self.msg,'action':'resume','event_id':str(uuid4()),'payload':{'interrupt_id':'old','input':{'action':'simulate_completed'}}})
 def test_fees_are_separate_from_customer_refund(self):
  result=self.draft();c=result['calculation'];self.assertEqual(c['proposed_refund_minor'],10000);self.assertEqual(c['original_net_minor'],29000);self.assertEqual(c['net_after_refund_minor'],19000)
  self.assertEqual(len(result['policy_sources']),3);self.assertTrue(all(s['url'].startswith('https://') for s in result['policy_sources']))
 def test_unclear_requires_evidence_before_draft(self):
  self.msg['payload']['fixture_id']='unclear';self.start();result=self.resume({'action':'confirm_case'})
  self.assertEqual(result['pending']['stage'],'clarify_refund');self.assertEqual(result['revisions'],[])
  result=self.resume({'action':'provide_clarification','recognized_work_minor':15000,'notes':'Ambas partes revisan USD 150 de trabajo.'});self.assertEqual(result['pending']['stage'],'review_refund')
 def test_expired_cannot_proceed_to_refund(self):
  self.msg['payload']['fixture_id']='expired';self.start();result=self.resume({'action':'confirm_case'})
  self.assertTrue(result['read_only']);self.assertIsNone(result['pending']);self.assertIsNone(result['refund']);self.assertGreater(result['analysis']['days_since_payment'],180)
 def test_previous_refunds_reduce_remaining_and_new_refund(self):
  self.msg['payload']['fixture_id']='previous_refund';result=self.draft();self.assertEqual(result['calculation']['proposed_refund_minor'],5000)
 def test_edits_preserve_version_and_snapshots_stale_resume_rejected(self):
  result=self.draft();old=copy.deepcopy(self.response);snapshot=result['revisions'][0]['snapshot_id']
  result=self.resume({'action':'edit_draft','recognized_work_minor':25000,'terms':'Se reconocen USD 250 y se devuelven USD 50.'})
  self.assertEqual(len(result['revisions']),1);self.assertEqual(len(result['draft_snapshots']),2);self.assertEqual(result['revisions'][0]['version'],1);self.assertNotEqual(result['revisions'][0]['snapshot_id'],snapshot)
  with self.assertRaises(ValueError):self.worker.handle({**self.msg,'action':'resume','event_id':str(uuid4()),'payload':{'interrupt_id':old['result']['pending']['interrupt_id'],'input':{'action':'simulate_send'}}})
 def test_feedback_revision_keeps_previous_snapshot_and_needs_new_acceptance(self):
  self.draft();self.resume({'action':'simulate_send'});self.resume({'action':'request_revision','feedback_notes':'Propongo reconocer USD 150.', 'feedback_document_id':str(uuid4())})
  result=self.resume({**self.approve,'recognized_work_minor':15000});self.assertEqual(len(result['revisions']),2);self.assertEqual(result['revisions'][-1]['version'],2);self.assertEqual(result['pending']['stage'],'send_refund')
  self.assertEqual(result['analysis']['client_feedback'],'Propongo reconocer USD 150.')
 def test_invalid_action_does_not_advance_and_event_redelivery_is_idempotent(self):
  original=self.start();self.assertEqual(self.worker.handle(self.msg),self.response)
  with self.assertRaises(ValueError):self.resume({'action':'simulate_completed'})
  self.assertEqual(self.start()['pending'],original['pending'])
 def test_context_isolation_restart_and_zero_refund(self):
  self.draft();bad={**self.msg,'action':'get','event_id':str(uuid4()),'payload':{},'context':{**self.msg['context'],'project_id':str(uuid4())}}
  with self.assertRaises(PermissionError):self.worker.handle(bad)
  self.worker=ThreadWorker(self.path,mode='simulation');self.resume({'action':'edit_draft','recognized_work_minor':30000,'terms':'Se acuerda cierre sin devolución.'});self.resume({'action':'simulate_send'});result=self.resume({'action':'accept'})
  self.assertTrue(result['read_only']);self.assertEqual(result['business_status'],'Cierre acordado · sin devolución');self.assertIsNone(result['refund'])
 def test_failure_never_becomes_a_completed_refund(self):
  self.accepted();self.resume({'action':'authorize_simulated_refund'});result=self.resume({'action':'simulate_failed'})
  self.assertEqual(result['status'],'refund_failed');self.assertEqual(result['refund']['status'],'FAILED');self.assertFalse(result['provider_verified'])
