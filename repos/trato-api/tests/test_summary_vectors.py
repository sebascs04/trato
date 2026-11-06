from copy import deepcopy
from unittest import TestCase
from unittest.mock import patch
import os
from uuid import uuid4
from trato_api.vector_routes import VectorGateway,summary_record,source
from trato_api.vector_contract import digest
from trato_api.errors import ApiError
from test_vector_routes import Repo,Store,MemoryRedis,MemoryRegistry,Processor,OWNER,PROJECT,FILE
class SummaryStore(Store):
 def __init__(self):super().__init__();self.summary_record=None;self.summary_reads=0;self.tamper=None;self.summary_scope=None
 def write_summary(self,owner,record):self.summary_record=deepcopy(record)
 def search_summaries(self,owner,client,project,files,query,limit):
  self.summary_reads+=1;row={**deepcopy(self.summary_record),'score':0.7}
  self.summary_scope={'owner':owner,'client':client,'project':project,'files':deepcopy(files)}
  if self.tamper:self.tamper(row)
  if self.after_search:self.after_search()
  return [row]
class SummaryRepo(Repo):
 def __init__(self):super().__init__();self.summary=None
 def rows(self,table,params):
  if table=='file_processing_artifacts':return [{'artifact':self.summary}] if self.summary else []
  return super().rows(table,params)

class MixedSummaryRepo(SummaryRepo):
 def __init__(self):
  super().__init__()
  self.pending={**deepcopy(self.document),'id':str(uuid4()),'title':'Pending acceptance','kind':'reference'}
 def rows(self,table,params):
  if table=='documents':
   rows=([deepcopy(self.document)] if not getattr(self,'hide_ready',False) else [])
   if not getattr(self,'hide_pending',False):rows.append(deepcopy(self.pending))
   return rows if params.get('offset',0)==0 else []
  return super().rows(table,params)
 def extraction(self,file):
  if file==self.pending['id']:
   return {'document':self.pending,'extraction':None,'segments':[]}
  return super().extraction(file)
@patch.dict(os.environ,{'TRATO_VECTOR_SEARCH_ENABLED':'true','TRATO_FILE_PROCESSING_ENABLED':'true'})
class SummaryTests(TestCase):
 def setUp(self):
  self.repo=SummaryRepo();self.store=SummaryStore();self.redis=MemoryRedis()
  self.gateway=VectorGateway(None,store=self.store,redis=self.redis,processor=Processor(),registry=MemoryRegistry())
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

 def mixed_project(self):
  summary=self.repo.summary;self.repo=MixedSummaryRepo();self.repo.summary=summary
  self.gateway.index(self.repo,OWNER,PROJECT,FILE)

 def test_explicit_summary_scope_allows_ready_documents_without_hiding_pending_inventory(self):
  self.mixed_project()
  with self.assertRaisesRegex(ApiError,'VECTOR_SUMMARY_INDEX_INCOMPLETE'):
   self.gateway.search_summaries(self.repo,OWNER,PROJECT,'scope')
  self.assertEqual(self.store.summary_reads,0)
  result=self.gateway.search_summaries(self.repo,OWNER,PROJECT,'scope',8,[FILE])
  self.assertEqual([file['id'] for file in self.store.summary_scope['files']],[FILE])
  self.assertEqual(self.store.summary_scope['owner'],OWNER)
  self.assertEqual(self.store.summary_scope['project'],PROJECT)
  self.assertEqual(result['documents_total'],2)
  self.assertEqual(result['documents_checked'],1)
  self.assertEqual(result['selected_document_ids'],[FILE])
  self.assertFalse(result['complete_inventory'])
  self.assertFalse(result['exhaustive_evidence'])

 def test_explicit_pending_summary_scope_fails_instead_of_selecting_another_document(self):
  self.mixed_project()
  for ids in ([self.repo.pending['id']],[FILE,self.repo.pending['id']]):
   with self.subTest(ids=ids),self.assertRaisesRegex(ApiError,'VECTOR_SUMMARY_INDEX_INCOMPLETE'):
    self.gateway.search_summaries(self.repo,OWNER,PROJECT,'scope',8,ids)
  self.assertEqual(self.store.summary_reads,0)

 def test_explicit_summary_scope_rejects_unknown_or_foreign_document_before_retrieval(self):
  self.mixed_project()
  for ids in ([],[str(uuid4())],[FILE,str(uuid4())]):
   with self.subTest(ids=ids),self.assertRaisesRegex(ApiError,'DOCUMENT_NOT_FOUND'):
    self.gateway.search_summaries(self.repo,OWNER,PROJECT,'scope',8,ids)
  self.assertEqual(self.store.summary_reads,0)

 def test_scoped_summary_revalidates_selected_source_and_summary_after_search(self):
  self.mixed_project()
  self.store.after_search=lambda:setattr(self.repo,'text',self.repo.text+' Changed original.')
  with self.assertRaisesRegex(ApiError,'VECTOR_SOURCE_CHANGED'):
   self.gateway.search_summaries(self.repo,OWNER,PROJECT,'scope',8,[FILE])
  self.store.after_search=None;self.gateway.index(self.repo,OWNER,PROJECT,FILE)
  def change_summary():
   self.repo.summary['summary']='Changed document orientation'
   self.repo.summary.pop('summary_fingerprint');self.repo.summary['summary_fingerprint']=digest(self.repo.summary)
  self.store.after_search=change_summary
  with self.assertRaisesRegex(ApiError,'FILE_SUMMARY_CHANGED'):
   self.gateway.search_summaries(self.repo,OWNER,PROJECT,'scope',8,[FILE])

 def test_selected_summary_cannot_expand_to_an_unselected_document(self):
  self.mixed_project()
  self.store.tamper=lambda row:row['properties'].update(file_id=self.repo.pending['id'])
  with self.assertRaisesRegex(ApiError,'VECTOR_RESULT_INVALID'):
   self.gateway.search_summaries(self.repo,OWNER,PROJECT,'scope',8,[FILE])

 def test_selected_document_removed_during_retrieval_invalidates_summary(self):
  self.mixed_project()
  self.store.after_search=lambda:setattr(self.repo,'hide_ready',True)
  with self.assertRaisesRegex(ApiError,'VECTOR_SOURCE_CHANGED'):
   self.gateway.search_summaries(self.repo,OWNER,PROJECT,'scope',8,[FILE])

 def test_unselected_inventory_change_does_not_expand_search_scope(self):
  self.mixed_project()
  self.store.after_search=lambda:setattr(self.repo,'hide_pending',True)
  result=self.gateway.search_summaries(self.repo,OWNER,PROJECT,'scope',8,[FILE])
  self.assertEqual(result['selected_document_ids'],[FILE])
  self.assertEqual(result['documents_total'],1)
  self.assertEqual([file['id'] for file in self.store.summary_scope['files']],[FILE])

 def test_original_scope_preserves_strictness_and_reports_selected_inventory(self):
  self.mixed_project()
  with self.assertRaisesRegex(ApiError,'VECTOR_INDEX_INCOMPLETE'):
   self.gateway.search(self.repo,OWNER,PROJECT,'scope')
  result=self.gateway.search(self.repo,OWNER,PROJECT,'scope',8,[FILE])
  self.assertFalse(result['complete_inventory'])
  self.assertEqual(result['documents_total'],2)
  self.assertEqual(result['selected_document_ids'],[FILE])
