import unittest
from unittest.mock import Mock
from trato_api.initial_payments.evidence import StageEvidence
from trato_api.errors import ApiError

class RetirementTests(unittest.TestCase):
 def setUp(self):
  self.repo=Mock();self.repo.project.return_value={'owner_id':'owner'};self.store=Mock();self.gateway=Mock()
  self.record={'file_id':'file','client_id':'client','cleanup_status':'pending'}
  self.store.repo.rpc.side_effect=lambda name,data:{**self.record,'cleanup_status':'complete' if data['p_action']=='cleaned' else 'pending'}
  self.gateway.connection.return_value.lock.return_value.acquire.return_value=True
  self.service=StageEvidence(None,store=self.store,gateway=self.gateway)
 def test_revokes_before_deleting_both_chunk_and_summary_records_in_exact_scope(self):
  order=[]
  def command(name,data):order.append(data['p_action']);return {**self.record,'cleanup_status':'complete' if data['p_action']=='cleaned' else 'pending'}
  self.store.repo.rpc.side_effect=command;self.gateway.store.remove_file.side_effect=lambda *args:order.append('purge')
  result=self.service.remove(self.repo,'owner','project',1,'file')
  self.assertEqual(order,['withdraw','purge','cleaned']);self.assertEqual(result['cleanup_status'],'complete');self.gateway.store.remove_file.assert_called_once_with('owner','client','project','file')
 def test_failed_purge_stays_pending_and_does_not_erase_receipt_or_claim_success(self):
  self.gateway.store.remove_file.side_effect=ApiError('VECTOR_PROVIDER_UNAVAILABLE',503)
  result=self.service.remove(self.repo,'owner','project',1,'file')
  self.assertEqual(result['cleanup_status'],'pending');self.assertEqual(result['cleanup_error'],'VECTOR_PROVIDER_UNAVAILABLE');self.gateway.connection.return_value.delete.assert_not_called()
  self.assertEqual([c.args[1]['p_action'] for c in self.store.repo.rpc.call_args_list],['withdraw'])
 def test_protected_evidence_never_reaches_vector_delete(self):
  self.store.repo.rpc.side_effect=ApiError('PLAN_EVIDENCE_PROTECTED',409)
  with self.assertRaises(ApiError):self.service.remove(self.repo,'owner','project',1,'file')
  self.gateway.store.remove_file.assert_not_called()
 def test_owner_mismatch_never_retires_or_deletes(self):
  with self.assertRaises(ApiError):self.service.remove(self.repo,'other','project',1,'file')
  self.store.repo.rpc.assert_not_called();self.gateway.store.remove_file.assert_not_called()
 def test_indexing_race_remains_pending_without_deleting_active_vector_batch(self):
  self.gateway.connection.return_value.lock.return_value.acquire.return_value=False
  result=self.service.remove(self.repo,'owner','project',1,'file')
  self.assertEqual(result['cleanup_error'],'VECTOR_INDEX_BUSY');self.gateway.store.remove_file.assert_not_called()
