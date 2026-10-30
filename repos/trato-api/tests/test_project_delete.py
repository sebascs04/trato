import unittest
from unittest.mock import Mock
import httpx
from fastapi.testclient import TestClient
from trato_api.app import create_app,Settings
from trato_api.errors import ApiError
from trato_api.persistence import Repository

PROJECT='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
class Services:
 def authenticate(self,header):
  if header!='Bearer owner':raise ApiError('UNAUTHORIZED',401)
  return 'owner'
class ProjectDeleteTests(unittest.TestCase):
 def setUp(self):
  self.repo=Mock();self.repo.soft_delete_project.return_value={'id':PROJECT,'deleted_at':'2026-10-29T00:00:00Z'}
  self.client=TestClient(create_app(Settings(),Services(),lambda *_:self.repo))
 def test_session_and_uuid_checked_before_write(self):
  self.assertEqual(self.client.post(f'/api/v1/projects/{PROJECT}/delete').status_code,401)
  self.assertEqual(self.client.post('/api/v1/projects/not-uuid/delete',headers={'Authorization':'Bearer owner'}).status_code,422)
  self.repo.soft_delete_project.assert_not_called()
 def test_only_authenticated_project_id_used(self):
  response=self.client.post(f'/api/v1/projects/{PROJECT}/delete',headers={'Authorization':'Bearer owner'},json={'owner_id':'foreign'})
  self.assertEqual(response.status_code,200);self.assertEqual(response.json()['data']['id'],PROJECT);self.repo.soft_delete_project.assert_called_once_with(PROJECT)
 def test_foreign_or_missing_project_returns_same_not_found(self):
  self.repo.soft_delete_project.side_effect=ApiError('PROJECT_NOT_FOUND',404)
  self.assertEqual(self.client.post(f'/api/v1/projects/{PROJECT}/delete',headers={'Authorization':'Bearer owner'}).status_code,404)
 def test_repository_preserves_user_token_for_rpc(self):
  calls=[]
  def handle(request):calls.append(request);return httpx.Response(200,json={'id':PROJECT,'deleted_at':'2026-10-29T00:00:00Z'})
  repo=Repository(Settings(supabase_url='https://test.supabase.invalid',supabase_key='sb_publishable_test'),'Bearer owner',transport=httpx.MockTransport(handle))
  self.assertEqual(repo.soft_delete_project(PROJECT)['id'],PROJECT)
  self.assertEqual(calls[0].headers['Authorization'],'Bearer owner');self.assertEqual(calls[0].url.path,'/rest/v1/rpc/soft_delete_project');self.assertNotIn(b'owner_id',calls[0].content)
