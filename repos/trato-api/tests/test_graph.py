import unittest
from fastapi.testclient import TestClient
from trato_api.app import create_app,Settings
from trato_api.errors import ApiError

PROJECT='a3000000-0000-4000-8000-000000000001'
OWNER='a1000000-0000-4000-8000-000000000001'
class Services:
 def authenticate(self,value):
  if value!='Bearer test':raise ApiError('UNAUTHORIZED',401)
  return OWNER
class Repo:
 calls=[];changed=False;forbidden=False
 def __init__(self,*args):pass
 def rpc(self,name,data):
  if self.forbidden:raise ApiError('PROJECT_NOT_FOUND',404)
  self.calls.append(data['p_action'])
  return {'thread_id':'job','status':'stale' if self.changed and len(self.calls)>1 else 'ready','generation':1,'content_hash':'a'*64,'current':True}
class Reader:
 def __init__(self):self.calls=[]
 def read(self,*args):self.calls.append(args);return {'nodes':[],'edges':[]}
class GraphRouteTests(unittest.TestCase):
 def setUp(self):
  Repo.calls=[];Repo.changed=False;Repo.forbidden=False;self.reader=Reader()
  self.client=TestClient(create_app(Settings(),Services(),Repo,graph_reader=self.reader))
 def test_requires_session(self):
  self.assertEqual(self.client.get(f'/api/v1/projects/{PROJECT}/graph').status_code,401)
  self.assertEqual(self.reader.calls,[])
 def test_never_queries_neo4j_for_unowned_project(self):
  Repo.forbidden=True
  self.assertEqual(self.client.get(f'/api/v1/projects/{PROJECT}/graph',headers={'Authorization':'Bearer test'}).status_code,404)
  self.assertEqual(self.reader.calls,[])
 def test_checks_source_state_before_and_after_read(self):
  r=self.client.get(f'/api/v1/projects/{PROJECT}/graph',headers={'Authorization':'Bearer test'})
  self.assertEqual(r.status_code,200);self.assertEqual(Repo.calls,['state','state'])
  self.assertEqual(self.reader.calls[0][:2],(OWNER,PROJECT))
 def test_changed_source_rejects_graph_read(self):
  Repo.changed=True
  self.assertEqual(self.client.get(f'/api/v1/projects/{PROJECT}/graph',headers={'Authorization':'Bearer test'}).status_code,409)
 def test_sync_uses_durable_rpc_and_not_direct_writer(self):
  r=self.client.post(f'/api/v1/projects/{PROJECT}/graph/sync',headers={'Authorization':'Bearer test'})
  self.assertEqual(r.status_code,200);self.assertEqual(Repo.calls,['sync']);self.assertEqual(self.reader.calls,[])

class GraphSerializationTests(unittest.TestCase):
 def test_internal_timestamp_is_not_leaked_as_driver_object(self):
  import os,json
  from unittest.mock import MagicMock,patch
  from neo4j.time import DateTime
  from trato_api.graph_routes import GraphReader
  driver=MagicMock();session=driver.__enter__.return_value.session.return_value.__enter__.return_value
  session.run.return_value.single.return_value={'nodes':[{'kind':'Project','synced_at':DateTime(2026,10,27),'_graph_lock':1}],'edges':[],'synced_at':'2026-10-27'}
  with patch.dict(os.environ,{'NEO4J_URI':'neo4j+s://test.databases.neo4j.io','NEO4J_PASSWORD':'test'}),patch('trato_api.graph_routes.GraphDatabase.driver',return_value=driver):
   data=GraphReader().read(OWNER,PROJECT,{'generation':1,'content_hash':'a'*64})
  json.dumps(data)
  self.assertEqual(data['nodes'],[{'kind':'Project'}])
