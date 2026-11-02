from copy import deepcopy
from unittest import TestCase
from unittest.mock import patch
import os
from trato_api.vector_routes import VectorGateway,summary_record,source
from trato_api.vector_contract import digest
from trato_api.errors import ApiError
from test_vector_routes import Repo,Store,MemoryRedis,Processor,OWNER,PROJECT,FILE
class SummaryStore(Store):
 def __init__(self):super().__init__();self.summary_record=None;self.summary_reads=0;self.tamper=None
 def write_summary(self,owner,record):self.summary_record=deepcopy(record)
 def search_summaries(self,owner,client,project,files,query,limit):
  self.summary_reads+=1;row={**deepcopy(self.summary_record),'score':0.7}
  if self.tamper:self.tamper(row)
  return [row]
class SummaryRepo(Repo):
 def __init__(self):super().__init__();self.summary=None
 def rows(self,table,params):
  if table=='file_processing_artifacts':return [{'artifact':self.summary}] if self.summary else []
  return super().rows(table,params)
@patch.dict(os.environ,{'TRATO_VECTOR_SEARCH_ENABLED':'true','TRATO_FILE_PROCESSING_ENABLED':'true'})
class SummaryTests(TestCase):
 def setUp(self):
  self.repo=SummaryRepo();self.store=SummaryStore();self.redis=MemoryRedis()
  self.gateway=VectorGateway(None,store=self.store,redis=self.redis,processor=Processor())
  # Summary source fingerprint is the pipeline extraction fingerprint, not the raw inventory generation.
  self.repo.summary={'summary':'The agreement sets revisions and payment conditions.','topics':['scope'],'citations':[],
    'output_language':'en','model_identity':'test-model','source_fingerprint':'f'*64}
  self.repo.summary['summary_fingerprint']=digest(self.repo.summary)
 def test_summary_is_its_own_vector_record_in_the_same_embedding_space(self):
  receipt=self.gateway.index(self.repo,OWNER,PROJECT,FILE)
  summary=self.store.summary_record['properties'];chunk=self.store.records[0]['properties']
  self.assertEqual(summary['segment_id'],'document_summary');self.assertEqual(summary['chunk_text'],self.repo.summary['summary'])
  self.assertNotEqual(summary['generation'],chunk['generation']);self.assertEqual(summary['embedding_identity'],chunk['embedding_identity'])
  self.assertEqual(receipt['objects'],len(self.store.records)+1)
  result=self.gateway.search_summaries(self.repo,OWNER,PROJECT,'What is this agreement about?')
  self.assertEqual(result['matches'][0]['source_kind'],'summary');self.assertEqual(self.store.summary_reads,1)
 def test_missing_summary_never_becomes_a_successful_partial_index(self):
  self.repo.summary=None
  with self.assertRaisesRegex(ApiError,'FILE_SUMMARY_NOT_READY'):self.gateway.index(self.repo,OWNER,PROJECT,FILE)
  self.assertEqual(self.gateway.receipt(OWNER,FILE)['status'],'failed')
 def test_summary_queries_require_a_current_index_and_reject_forged_metadata(self):
  with self.assertRaisesRegex(ApiError,'VECTOR_SUMMARY_INDEX_INCOMPLETE'):self.gateway.search_summaries(self.repo,OWNER,PROJECT,'scope')
  self.gateway.index(self.repo,OWNER,PROJECT,FILE)
  self.store.tamper=lambda row:row['properties'].update(owner_id='foreign')
  with self.assertRaisesRegex(ApiError,'VECTOR_RESULT_INVALID'):self.gateway.search_summaries(self.repo,OWNER,PROJECT,'scope')
 def test_new_summary_version_or_changed_document_invalidates_the_index(self):
  self.gateway.index(self.repo,OWNER,PROJECT,FILE)
  self.repo.summary['summary']='A different summary.';self.repo.summary.pop('summary_fingerprint');self.repo.summary['summary_fingerprint']=digest(self.repo.summary)
  with self.assertRaisesRegex(ApiError,'VECTOR_SUMMARY_INDEX_INCOMPLETE'):self.gateway.search_summaries(self.repo,OWNER,PROJECT,'scope')
 def test_original_search_cannot_use_foreign_file_filter(self):
  self.gateway.index(self.repo,OWNER,PROJECT,FILE)
  from uuid import uuid4
  with self.assertRaisesRegex(ApiError,'DOCUMENT_NOT_FOUND'):self.gateway.search(self.repo,OWNER,PROJECT,'scope',8,[str(uuid4())])
