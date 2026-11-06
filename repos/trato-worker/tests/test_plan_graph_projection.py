from copy import deepcopy
from uuid import uuid4
from unittest import TestCase
from test_graph_projection import fixture
from trato_worker.graph_projection import build_projection
from trato_worker.connected import JobError

class PlanGraphTests(TestCase):
 def plan(self):
  context,snapshot=fixture();project=context['project_id'];doc=str(uuid4())
  snapshot['documents'].append({'id':doc,'kind':'delivery','title':'Stage delivery'})
  snapshot['project_start_plans']=[{'project_id':project,'budget':100,'currency':'USD','target_date':'2030-01-01','summary':'Confirmed plan','created_at':'2026-11-06T00:00:00Z','completed_at':None}]
  snapshot['project_start_stages']=[{'position':1,'title':'First delivery','deliverables':'Files','percent':100,'payment_condition':'After delivery','amount':100}]
  snapshot['plan_stage_evidence']=[{'document_id':doc,'stage_position':1}]
  snapshot['plan_stage_payments']=[]
  return context,snapshot,doc
 def payment(self,doc):
  return {'id':str(uuid4()),'stage_position':1,'status':'completed','amount_minor':10000,'currency':'USD','paid_at':'2026-11-06T00:10:00Z','evidence_document_id':doc,'received_payment_id':str(uuid4())}
 def test_plan_deliverable_and_original_document_have_exact_relationships(self):
  context,snapshot,doc=self.plan();graph=build_projection(snapshot,context)
  plan=next(n for n in graph['nodes'] if n['kind']=='Plan');stage=next(n for n in graph['nodes'] if n['kind']=='PlanStage')
  self.assertEqual(plan['status'],'planned');self.assertEqual(stage['source_id'],context['project_id'])
  self.assertTrue(stage['entity_key'].endswith(':1'))
  self.assertTrue({'HAS_PLAN','HAS_STAGE','DELIVERY_EVIDENCE'} <= {e['kind'] for e in graph['edges']})
  self.assertTrue(any(e['source']==stage['entity_key'] and e['target']=='documents:'+doc and e['kind']=='DELIVERY_EVIDENCE' for e in graph['edges']))
  self.assertFalse(any(n['kind']=='Payment' for n in graph['nodes']))
 def test_only_verified_completed_payment_can_finish_plan_without_closing_project(self):
  context,snapshot,doc=self.plan();snapshot['plan_stage_payments']=[self.payment(doc)]
  snapshot['project_start_plans'][0]['completed_at']='2026-11-06T00:10:00Z'
  graph=build_projection(snapshot,context)
  self.assertEqual(next(n for n in graph['nodes'] if n['kind']=='Plan')['status'],'finished')
  self.assertEqual(next(n for n in graph['nodes'] if n['kind']=='Project')['status'],'draft')
  payment=next(n for n in graph['nodes'] if n['kind']=='Payment')
  self.assertEqual(payment['status'],'completed');self.assertEqual(payment['amount_minor'],10000)
  self.assertTrue(any(e['kind']=='PAYMENT_EVIDENCE' and e['source']==payment['entity_key'] and e['target']=='documents:'+doc for e in graph['edges']))
 def test_incomplete_financial_or_evidence_context_fails_closed(self):
  context,snapshot,doc=self.plan();payment=self.payment(doc)
  for changes in ({'status':'pending'},{'paid_at':None},{'received_payment_id':None},{'stage_position':2},{'evidence_document_id':str(uuid4())}):
   bad=deepcopy(snapshot);bad['plan_stage_payments']=[dict(payment,**changes)]
   with self.assertRaises(JobError):build_projection(bad,context)
  bad=deepcopy(snapshot);bad['project_start_plans'][0]['completed_at']='2026-11-06T00:10:00Z'
  with self.assertRaises(JobError):build_projection(bad,context)
 def test_stage_identity_and_plan_owner_scope_are_not_guessed(self):
  context,snapshot,doc=self.plan();snapshot['project_start_stages'][0]['position']=True
  with self.assertRaises(JobError):build_projection(snapshot,context)
  context,snapshot,doc=self.plan();snapshot['project_start_plans'][0]['project_id']=str(uuid4())
  with self.assertRaises(JobError):build_projection(snapshot,context)
  context,snapshot,doc=self.plan();snapshot['documents']=[snapshot['documents'][0]]
  with self.assertRaises(JobError):build_projection(snapshot,context)
 def test_neo4j_writer_preserves_real_plan_relationships_and_scope(self):
  from unittest.mock import MagicMock
  from trato_worker.graph_projection import GraphWriter
  context,snapshot,doc=self.plan();snapshot['plan_stage_payments']=[self.payment(doc)]
  graph=build_projection(snapshot,context);driver=MagicMock()
  session=driver.session.return_value.__enter__.return_value
  tx=session.begin_transaction.return_value.__enter__.return_value
  tx.run.return_value.single.return_value={'owner':context['owner_id'],'project':context['project_id'],'generation':None}
  GraphWriter(driver,'neo4j').sync(graph,context,5,'a'*64)
  writes=[(call.args[0],call.kwargs) for call in tx.run.call_args_list]
  self.assertTrue(any(':Plan ' in query for query,params in writes))
  self.assertTrue(any(':PlanStage ' in query for query,params in writes))
  self.assertTrue(any('[r:STAGE_PAYMENT ' in query for query,params in writes))
  self.assertTrue(any('[r:PAYMENT_EVIDENCE ' in query for query,params in writes))
  for query,params in writes:
   if 'MERGE (a)-[r:' in query:
    self.assertEqual(params['owner'],context['owner_id']);self.assertEqual(params['project'],context['project_id'])
  tx.commit.assert_called_once();driver.close.assert_called_once()
