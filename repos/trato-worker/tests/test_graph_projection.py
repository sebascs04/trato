import unittest
from unittest.mock import Mock,patch
from trato_worker.graph_projection import build_projection
from trato_worker.connected import ConnectedWorker,ConnectedThread,JobError
from uuid import uuid4

def fixture():
 owner,client,project,doc,extract=[str(uuid4()) for _ in range(5)]
 context={'owner_id':owner,'client_id':client,'project_id':project}
 snapshot={'owner_id':owner,'project_id':project,'project':{'id':project,'name':'Proyecto','status':'draft','client_id':client,'client_name':'Cliente'},
 'documents':[{'id':doc,'title':'Fuentes','kind':'initial_agreement'}],
 'document_extractions':[{'id':extract,'document_id':doc,'status':'ready'}]}
 for table in ('change_proposals','proposal_revisions','proposal_revision_sources','proposal_artifacts','proposal_reviews','proposal_acceptances','proposal_deliveries','proposal_payments','project_agreement_heads'):snapshot[table]=[]
 return context,snapshot
class GraphProjectionTests(unittest.TestCase):
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
