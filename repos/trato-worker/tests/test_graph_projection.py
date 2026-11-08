import unittest
from unittest.mock import Mock,patch
from trato_worker.graph_projection import build_projection
from trato_worker.connected import ConnectedWorker,ConnectedThread,JobError
from uuid import uuid4

def fixture():
 owner,client,project,doc,extract=[str(uuid4()) for _ in range(5)]
 context={'owner_id':owner,'client_id':client,'project_id':project}
 snapshot={'schema_version':1,'projection_version':2,'project_start_plans':[],'project_start_stages':[],'plan_stage_evidence':[],'plan_stage_payments':[],'owner_id':owner,'project_id':project,'project':{'id':project,'name':'Proyecto','status':'draft','client_id':client,'client_name':'Cliente'},
 'documents':[{'id':doc,'title':'Fuentes','kind':'initial_agreement'}],
 'document_extractions':[{'id':extract,'document_id':doc,'status':'ready'}]}
 for table in ('change_proposals','proposal_revisions','proposal_revision_sources','proposal_artifacts','proposal_reviews','proposal_acceptances','proposal_deliveries','proposal_payments','project_agreement_heads'):snapshot[table]=[]
 return context,snapshot
class GraphProjectionTests(unittest.TestCase):
 def test_projection_version_is_explicit_and_preserved_in_project_root(self):
  context,snapshot=fixture();result=build_projection(snapshot,context)
  self.assertEqual(next(n for n in result['nodes'] if n['kind']=='Project')['projection_version'],2)
  for version in (None,1,4,True,'2'):
   bad=dict(snapshot,projection_version=version)
   if version is None:bad.pop('projection_version')
   with self.assertRaises(JobError) as error:build_projection(bad,context)
   self.assertEqual(error.exception.code,'GRAPH_PROJECTION_VERSION_UNSUPPORTED')
 def test_refund_projection_connects_exact_pdf_and_verified_receipt_to_original_payment(self):
  context,snapshot=fixture()
  case,version,payment,receipt=[str(uuid4()) for _ in range(4)]
  document=snapshot['documents'][0]['id']
  snapshot.update(projection_version=3,
   refund_cases=[dict(id=case,reason='Cancelled',status='completed',confirmed_refund_minor=7500,created_at='2026-11-08')],
   refund_versions=[dict(id=version,settlement_id=case,version_no=1,draft_sequence=1,amount_minor=7500,
                         created_at='2026-11-08',is_current_revision=True,accepted_at='2026-11-08')],
   refund_documents=[dict(settlement_id=case,snapshot_id=version,document_id=document,role='pdf')],
   refund_payments=[dict(settlement_id=case,id=payment,proposal_payment_id=None,origin='initial',
                         amount_minor=9000,currency='USD',verified_at='2026-11-01')],
   refund_receipts=[dict(settlement_id=case,id=receipt,payment_id=payment,amount_minor=7500,
                         currency='USD',confirmed_at='2026-11-08')])
  result=build_projection(snapshot,context)
  edges={(e['kind'],e['source'],e['target']) for e in result['edges']}
  self.assertIn(('REFUND_PDF','refund_snapshots:'+version,'documents:'+document),edges)
  self.assertIn(('REFUND_CONFIRMED_RECEIPT','refund_settlements:'+case,'refund_provider_receipts:'+receipt),edges)
  self.assertIn(('REFUND_APPLIES_TO_PAYMENT','refund_provider_receipts:'+receipt,'project_received_payments:'+payment),edges)
  self.assertEqual(next(n for n in result['nodes'] if n['kind']=='Project')['projection_version'],3)
 def test_new_projection_cannot_silently_skip_missing_plan_collections(self):
  context,snapshot=fixture()
  for field in ('project_start_plans','project_start_stages','plan_stage_evidence','plan_stage_payments'):
   bad=dict(snapshot);bad.pop(field)
   with self.assertRaises(JobError):build_projection(bad,context)
 def test_business_kind_does_not_replace_node_label(self):
  context,snapshot=fixture();result=build_projection(snapshot,context)
  document=next(n for n in result['nodes'] if n['kind']=='Document')
  self.assertEqual(document['business_kind'],'initial_agreement')
  self.assertEqual({e['kind'] for e in result['edges']},{'HAS_DOCUMENT','HAS_EXTRACTION'})
 def test_rejects_cross_project_and_cross_owner(self):
  context,snapshot=fixture()
  for field in ('owner_id','project_id'):
   with self.assertRaises(JobError):build_projection({**snapshot,field:str(uuid4())},context)
 def test_missing_foreign_key_is_not_invented(self):
  context,snapshot=fixture();snapshot['documents']=[]
  with self.assertRaises(JobError):build_projection(snapshot,context)
 def test_sync_workflow_uses_private_input_and_generic_result(self):
  context,snapshot=fixture();message={'type':'thread','schema_version':1,'mode':'connected','thread_id':str(uuid4()),'event_id':str(uuid4()),'action':'start','workflow':'sync_project_graph','context':context,'payload':{'project_id':context['project_id'],'generation':2,'content_hash':'a'*64}}
  client=Mock(api_url='http://private',worker_token='private');client.claim.return_value={'terminal':False,'lease_id':str(uuid4())}
  client.request.return_value=__import__('json').dumps({'data':{'snapshot':snapshot,'generation':2,'content_hash':'a'*64}}).encode()
  with patch('trato_worker.graph_projection.GraphWriter') as writer:
   event=ConnectedWorker(client).handle(message)
   writer.from_env.return_value.sync.assert_called_once()
  self.assertEqual(event['action'],'completed');self.assertEqual(event['causation_id'],message['event_id'])
  self.assertEqual(event['workflow'],'sync_project_graph')
 def test_wrong_payload_does_not_select_wrong_handler(self):
  context,_=fixture()
  with self.assertRaises(ValueError):ConnectedThread.model_validate({'type':'thread','schema_version':1,'mode':'connected','thread_id':str(uuid4()),'event_id':str(uuid4()),'action':'start','workflow':'ingest_document','context':context,'payload':{'project_id':context['project_id'],'generation':1,'content_hash':'a'*64}})
