from unittest import TestCase
from unittest.mock import Mock
from trato_api.initial_payments.evidence import StageEvidence
from trato_api.errors import ApiError

class StageInventoryTests(TestCase):
 def setUp(self):
  self.repo=Mock();self.repo.project.return_value={'owner_id':'owner'}
  self.gateway=Mock();self.gateway.inventory.return_value={'files':[{'id':'file','status':'ready','summary_status':'ready'}]}
  self.store=Mock();self.store.repo.rpc.return_value=[]
  self.service=StageEvidence(None,store=self.store,gateway=self.gateway)
 def test_only_selected_stage_documents_are_loaded_and_indexed(self):
  self.repo.rows.side_effect=[[{'document_id':'file','stage_position':2,'purpose':'delivery_evidence'}],
   [{'id':'file','title':'Proof','document_extractions':{'status':'ready'}}],
   [{'document_id':'file','status':'processed'}]]
  result=self.service.inventory(self.repo,'owner','project',2)
  filters=self.repo.rows.call_args_list[0].args[1]
  self.assertEqual(filters['stage_position'],'eq.2');self.assertEqual(filters['project_id'],'eq.project')
  self.assertEqual(filters['owner_id'],'eq.owner');self.assertEqual(filters['purpose'],'eq.delivery_evidence')
  self.gateway.inventory.assert_called_once_with(self.repo,'owner','project',limit=1000,file_ids=['file'])
  self.assertEqual(result['documents'][0]['extraction'],{'status':'ready'})
  self.assertEqual(result['documents'][0]['processing_outcome']['status'],'processed')
 def test_empty_stage_does_not_load_project_documents_or_vector_inventory(self):
  self.repo.rows.return_value=[]
  result=self.service.inventory(self.repo,'owner','project',3)
  self.assertEqual(result['documents'],[]);self.assertEqual(result['files'],[])
  self.assertEqual(self.repo.rows.call_count,1);self.gateway.inventory.assert_not_called()
 def test_other_owner_cannot_read_evidence(self):
  with self.assertRaisesRegex(ApiError,'PROJECT_NOT_FOUND'):self.service.inventory(self.repo,'other','project',1)
  self.repo.rows.assert_not_called();self.gateway.inventory.assert_not_called()
