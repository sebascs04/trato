import unittest
from fastapi.testclient import TestClient
from trato_api.app import create_app, Settings
from trato_api.errors import ApiError

USER='a1111111-1111-4111-8111-111111111111'
PROJECT='d1111111-1111-4111-8111-111111111111'
PROFILE='c1111111-1111-4111-8111-111111111111'
class Services:
 def authenticate(self,header):
  if header!='Bearer owner':raise ApiError('UNAUTHORIZED',401)
  return USER
class Repo:
 calls=[]
 def __init__(self,settings,authorization):self.authorization=authorization
 def rpc(self,name,data):
  self.calls.append((self.authorization,name,data));return {'profile_id':PROFILE,'review_id':PROFILE}
class ReputationTests(unittest.TestCase):
 def setUp(self):
  Repo.calls=[];self.client=TestClient(create_app(Settings(),Services(),Repo));self.headers={'Authorization':'Bearer owner'}
  self.payload=dict(project_id=PROJECT,alias='Designer',name='Example studio',rating=4,communication=5,scope=4,payment='late',body='This is a test of a reviewed experience.',consent=True)
 def test_requires_authentication_for_reads_and_writes(self):
  for method,path in [('get','/api/v1/reputation'),('get','/api/v1/reputation/review-options'),('get',f'/api/v1/reputation/clients/{PROFILE}'),('post','/api/v1/reputation/reviews')]:
   self.assertEqual(getattr(self.client,method)(path).status_code,401)
  self.assertEqual(Repo.calls,[])
 def test_rpc_keeps_user_token_and_safe_action(self):
  response=self.client.get('/api/v1/reputation?search=Design&offset=25',headers=self.headers)
  self.assertEqual(response.status_code,200);self.assertEqual(response.headers['cache-control'],'no-store')
  self.assertEqual(Repo.calls,[('Bearer owner','community_reputation',{'p_action':'list','p_data':{'search':'Design','offset':25}})])
 def test_create_review_uses_explicit_project_consent_and_scores(self):
  response=self.client.post('/api/v1/reputation/reviews',headers=self.headers,json=self.payload)
  self.assertEqual(response.status_code,200);self.assertEqual(Repo.calls[0][2]['p_data']['project_id'],PROJECT)
 def test_rejects_missing_consent_scores_forged_owner_and_unsafe_websites(self):
  for change in [dict(consent=False),dict(rating=0),dict(rating='5'),dict(owner_id=USER),dict(website='javascript:alert(1)'),dict(website='https://user:pass@example.com'),dict(project_id='bad')]:
   with self.subTest(change=change):
    self.assertEqual(self.client.post('/api/v1/reputation/reviews',headers=self.headers,json=self.payload|change).status_code,422)
  self.assertEqual(Repo.calls,[])
 def test_detail_and_options_actions_are_separate(self):
  self.assertEqual(self.client.get('/api/v1/reputation/review-options',headers=self.headers).status_code,200)
  self.assertEqual(self.client.get(f'/api/v1/reputation/clients/{PROFILE}',headers=self.headers).status_code,200)
  self.assertEqual([c[2]['p_action'] for c in Repo.calls],['options','detail'])
 def test_pagination_limits_and_withdrawal(self):
  self.assertEqual(self.client.get('/api/v1/reputation?offset=-1',headers=self.headers).status_code,422)
  self.assertEqual(self.client.post('/api/v1/reputation/reviews/withdraw',headers=self.headers,json={'review_id':PROFILE}).status_code,200)
  self.assertEqual(Repo.calls[0][2]['p_action'],'withdraw')
 def test_report_does_not_publish_a_review(self):
  response=self.client.post('/api/v1/reputation/reviews/report',headers=self.headers,json={'review_id':PROFILE,'reason':'privacy','details':'The review includes private data.'})
  self.assertEqual(response.status_code,200);self.assertEqual(Repo.calls[0][2]['p_action'],'report')
