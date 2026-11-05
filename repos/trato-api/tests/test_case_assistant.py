"""Revision, privacy and durable-history regression checks; no model/provider calls."""
import json
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch
from uuid import uuid4
from trato_api.case_assistant import case_scope,validate_case_job,CaseAssistant,Outcome,validate_case_answer
from trato_api.errors import ApiError

OWNER,PROJECT,CLIENT,CASE,REV,SESSION,JOB,LEASE,FILE=(str(uuid4()) for _ in range(9))
class Repo:
 def __init__(self):
  self.head=REV;self.owner=OWNER;self.missing=False;self.rpc_calls=[];self.messages=[]
 def project(self,id):return {'id':PROJECT,'owner_id':self.owner,'client_id':CLIENT}
 def rows(self,table,params):
  if table in ('change_proposals','refund_settlements'):
   return [] if self.missing else [{'id':CASE,'owner_id':OWNER,'project_id':PROJECT,'current_revision_id':self.head,'current_snapshot_id':self.head,'approval_url':'DO_NOT_SEND','reason':'Cancellation requested'}]
  if table in ('proposal_revisions','refund_snapshots'):return [{'id':self.head,'scope_summary':'Two designs','internal_token':'DO_NOT_SEND'}]
  if table=='case_assistant_sessions':return [{'id':SESSION,'owner_id':OWNER,'project_id':PROJECT,'client_id':CLIENT,'case_kind':'change','case_id':CASE,'revision_id':REV}]
  if table=='case_assistant_messages':return self.messages
  raise AssertionError(table)
 def rpc(self,name,data):self.rpc_calls.append((name,data));return {'stored':True}
class Jobs:
 def __init__(self):self.missing=False;self.row={}
 def get(self,*args):raise ApiError('AI_NOT_FOUND',404)
 def connection(self):return self
 def hgetall(self,key):return self.row

class CaseAssistantTests(TestCase):
 def setUp(self):
  self.repo=Repo();self.jobs=Jobs();self.assistant=SimpleNamespace(jobs=self.jobs,gateway=SimpleNamespace())
  self.service=CaseAssistant(None,assistant=self.assistant,server=self.repo)
 def answer(self):return {'question':'Explain the agreement','case_context':self.context(),'kind':'project_assistant','project_id':PROJECT,'model':'configured-model','output_language':'es','tools_used':[],'status':'insufficient_evidence','answer':'Ask for clarification','citations':[],'missing_information':['Agreement needed']}
 def context(self):return {'session_id':SESSION,'case_kind':'change','case_id':CASE,'revision_id':REV,'project_id':PROJECT,'client_id':CLIENT}
 def test_scope_does_not_pass_tokens_or_links_to_model(self):
  scope,mandatory=case_scope(self.repo,OWNER,'change',CASE)
  self.assertEqual(scope['revision_id'],REV)
  self.assertNotIn('DO_NOT_SEND',json.dumps(mandatory))
 def test_missing_or_foreign_case_rejected(self):
  self.repo.missing=True
  with self.assertRaisesRegex(ApiError,'AI_CASE_NOT_FOUND'):case_scope(self.repo,OWNER,'change',CASE)
  self.repo.missing=False;self.repo.owner=str(uuid4())
  with self.assertRaisesRegex(ApiError,'AI_CASE_NOT_FOUND'):case_scope(self.repo,OWNER,'change',CASE)
 def test_revision_change_blocks_existing_job(self):
  self.repo.head=str(uuid4())
  with self.assertRaisesRegex(ApiError,'AI_CASE_STALE'):validate_case_job(self.repo,OWNER,{'case_context':self.context(),'project_id':PROJECT})
 def test_context_must_match_stored_session(self):
  for key in ('case_id','client_id','project_id','revision_id'):
   context=self.context();context[key]=str(uuid4())
   with self.assertRaises(ApiError):validate_case_job(self.repo,OWNER,{'case_context':context,'project_id':PROJECT})
 def test_durable_answer_survives_missing_redis_job(self):
  result=self.answer();result.update({'sources':[]})
  self.repo.messages=[{'job_id':JOB,'status':'completed','result':result}]
  self.assertEqual(self.service.poll(self.repo,OWNER,SESSION,JOB)['result'],result)
  self.assertEqual(self.repo.rpc_calls,[])
 def test_expired_unfinished_job_is_durable_visible_failure(self):
  self.repo.messages=[{'job_id':JOB,'status':'queued'}]
  result=self.service.poll(self.repo,OWNER,SESSION,JOB)
  self.assertEqual(result['error_code'],'AI_JOB_EXPIRED')
  self.assertEqual(self.repo.rpc_calls[-1][1]['p_error'],'AI_JOB_EXPIRED')
 def test_archived_source_must_still_match_current_generation(self):
  result=self.answer();result.update({'citations':[{'source_id':'a'*64,'quote':'Two designs'}],'sources':[{'source_id':'a'*64,'file_id':FILE,'title':'Agreement','generation':'old','source_kind':'original'}]})
  with patch('trato_api.case_assistant.source',return_value={'generation':'new'}):
   with self.assertRaisesRegex(ApiError,'VECTOR_SOURCE_CHANGED'):self.service.revalidate_archive(self.repo,OWNER,self.repo.project(PROJECT),result)
 def test_error_outcome_checks_lease_even_after_case_revision_changes(self):
  self.repo.head=str(uuid4())
  self.jobs.row={'owner':OWNER,'status':'running','execution_id':LEASE,'input':json.dumps({'workflow':'project_assistant','owner_id':OWNER,'case_context':self.context()})}
  self.assertEqual(self.service.complete(JOB,Outcome(execution_id=LEASE,error_code='AI_CASE_STALE')),{'stored':True})
  with self.assertRaisesRegex(ApiError,'AI_JOB_NOT_ACTIVE'):self.service.complete(JOB,Outcome(execution_id=str(uuid4()),error_code='AI_CASE_STALE'))
 def test_original_quote_cannot_be_replaced_with_invented_text(self):
  result=self.answer();result.update({'citations':[{'source_id':'a'*64,'quote':'Invented'}],'sources':[{'source_id':'a'*64,'file_id':FILE,'title':'Agreement','generation':'g','source_kind':'original'}]})
  with patch('trato_api.case_assistant.source',return_value={'generation':'g','segments':[{'text':'Two designs'}]}):
   with self.assertRaisesRegex(ApiError,'AI_INVALID_CITATION'):self.service.revalidate_archive(self.repo,OWNER,self.repo.project(PROJECT),result)
 def test_outcome_requires_exactly_one_terminal_value(self):
  for data in ({'execution_id':LEASE},{'execution_id':LEASE,'result':{},'error_code':'FAILED'}):
   with self.assertRaises(ValueError):Outcome(**data)

 def test_case_output_rejects_malformed_and_unbounded_fields(self):
  for key,value in [('answer',' '),('answer','a'*6001),('status','paid'),('citations',[{'source_id':'x','quote':'q'}]),('missing_information',[1]),('missing_information',[' ']),('tools_used',['pay']),('model',None),('unexpected',True)]:
   result=self.answer();result[key]=value
   with self.subTest(key=key),self.assertRaisesRegex(ApiError,'AI_INVALID_RESPONSE'):validate_case_answer(result)
 def test_durable_history_also_rejects_malformed_output(self):
  result=self.answer();result['answer']=None
  with self.assertRaisesRegex(ApiError,'AI_INVALID_RESPONSE'):self.service.revalidate_archive(self.repo,OWNER,self.repo.project(PROJECT),result)

class MvpScopeTests(TestCase):
 def test_refund_agent_execution_is_blocked_before_document_or_model_access(self):
  repo=SimpleNamespace(rows=lambda *args:[{'case_kind':'refund'}])
  with self.assertRaises(ApiError) as error:
   validate_case_job(repo,OWNER,{'case_context':{'session_id':SESSION}})
  self.assertEqual(error.exception.code,'AI_CASE_COMING_SOON')
