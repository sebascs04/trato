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

 def test_scope_is_validated_before_any_database_or_graph_read(self):
  for query in ('scope=other','scope=change','scope=all&request_id='+PROJECT,'scope=plan&request_id='+PROJECT,'scope=change&request_id=not-a-uuid'):
   with self.subTest(query=query):
    self.assertEqual(self.client.get(f'/api/v1/projects/{PROJECT}/graph?{query}',headers={'Authorization':'Bearer test'}).status_code,422)
    self.assertEqual(Repo.calls,[]);self.assertEqual(self.reader.calls,[])
 def test_selected_scope_keeps_owner_and_state_checks(self):
  for scope,request_id in [('plan',None),('change',PROJECT)]:
   Repo.calls=[];self.reader.calls=[]
   url=f'/api/v1/projects/{PROJECT}/graph?scope={scope}'+('&request_id='+request_id if request_id else '')
   r=self.client.get(url,headers={'Authorization':'Bearer test'})
   self.assertEqual(r.status_code,200);self.assertEqual(r.headers['cache-control'],'no-store')
   self.assertEqual(Repo.calls,['state','state']);self.assertEqual(self.reader.calls[0][:2],(OWNER,PROJECT))
   self.assertEqual(self.reader.calls[0][3:],(scope,request_id))
 def test_scope_does_not_bypass_missing_owner_or_changed_generation(self):
  Repo.forbidden=True
  url=f'/api/v1/projects/{PROJECT}/graph?scope=change&request_id={PROJECT}'
  self.assertEqual(self.client.get(url,headers={'Authorization':'Bearer test'}).status_code,404)
  self.assertEqual(self.reader.calls,[])
  Repo.forbidden=False;Repo.changed=True
  self.assertEqual(self.client.get(url,headers={'Authorization':'Bearer test'}).status_code,409)

class GraphSerializationTests(unittest.TestCase):
 def test_internal_timestamp_is_not_leaked_as_driver_object(self):
  import os,json
  from unittest.mock import MagicMock,patch
  from neo4j.time import DateTime
  from trato_api.graph_routes import GraphReader
  driver=MagicMock();session=driver.__enter__.return_value.session.return_value.__enter__.return_value
  session.run.return_value.single.return_value={'nodes':[{'kind':'Project','synced_at':DateTime(2026,10,27),'_graph_lock':1}],'edges':[],'scopes':[],'scope_found':True,'synced_at':'2026-10-27'}
  with patch.dict(os.environ,{'NEO4J_URI':'neo4j+s://test.databases.neo4j.io','NEO4J_PASSWORD':'test'}),patch('trato_api.graph_routes.GraphDatabase.driver',return_value=driver):
   data=GraphReader().read(OWNER,PROJECT,{'generation':1,'content_hash':'a'*64})
  json.dumps(data)
  self.assertEqual(data['nodes'],[{'kind':'Project'}])

class GraphScopeQueryTests(unittest.TestCase):
 def read(self,scope,found=True):
  import os
  from unittest.mock import MagicMock,patch
  from trato_api.graph_routes import GraphReader
  driver=MagicMock();session=driver.__enter__.return_value.session.return_value.__enter__.return_value
  session.run.return_value.single.return_value={'nodes':[],'edges':[],'scopes':[],'scope_found':found,'synced_at':'2026-11-06'}
  with patch.dict(os.environ,{'NEO4J_URI':'neo4j+s://test.databases.neo4j.io','NEO4J_PASSWORD':'test'}),patch('trato_api.graph_routes.GraphDatabase.driver',return_value=driver):
   result=GraphReader().read(OWNER,PROJECT,{'generation':17,'content_hash':'b'*64},scope,PROJECT if scope=='change' else None)
  return result,session.run.call_args
 def test_static_scopes_have_bounded_paths_and_exact_project_anchor(self):
  for scope in ('all','plan','change'):
   result,call=self.read(scope);query=call.args[0]
   self.assertEqual(query.timeout,15)
   self.assertEqual(call.kwargs['owner'],OWNER);self.assertEqual(call.kwargs['project'],PROJECT)
   self.assertEqual(call.kwargs['projection_version'],2);self.assertIn('projection_version:$projection_version',query.text)
   self.assertEqual(call.kwargs['generation'],17);self.assertEqual(call.kwargs['hash'],'b'*64)
   self.assertEqual(result['scope'],{'kind':scope,'request_id':PROJECT if scope=='change' else None})
   self.assertIn('r.owner_id=p.owner_id AND r.project_id=p.project_id',query.text)
   self.assertIn('a IN chosen AND b IN chosen',query.text)
   if scope=='plan':
    self.assertEqual(call.kwargs['anchor'],'project_start_plans:'+PROJECT);self.assertIn('*0..3',query.text)
   if scope=='change':
    self.assertEqual(call.kwargs['anchor'],'documents:'+PROJECT);self.assertIn('*0..4',query.text)
    self.assertNotIn('[:HAS_DOCUMENT',query.text)
 def test_missing_scope_is_404_not_an_entire_project_fallback(self):
  with self.assertRaises(ApiError) as error:self.read('change',False)
  self.assertEqual(error.exception.code,'GRAPH_SCOPE_NOT_FOUND');self.assertEqual(error.exception.status,404)
