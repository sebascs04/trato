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
  self.payload=dict(project_id=PROJECT,alias='Designer',name='Example studio',public_email='studio@example.invalid',rating=4,communication=5,scope=4,payment='late',body='This is a test of a reviewed experience.',consent=True)
 def test_requires_authentication_for_reads_and_writes(self):
  for method,path in [('get','/api/v1/reputation'),('post','/api/v1/reputation/lookup'),('get','/api/v1/reputation/review-options'),('get',f'/api/v1/reputation/clients/{PROFILE}'),('post','/api/v1/reputation/reviews')]:
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

 def test_lookup_normalizes_email_without_dropping_plus_or_dots(self):
  response=self.client.post('/api/v1/reputation/lookup',headers=self.headers,json={'public_email':'  Name.Tag+work@Example.COM  '})
  self.assertEqual(response.status_code,200)
  self.assertEqual(Repo.calls[-1][2],{'p_action':'lookup','p_data':{'public_email':'name.tag+work@example.com'}})
 def test_invalid_public_email_never_calls_rpc(self):
  for email in ['', 'not-email', 'a@-example.com','a..b@example.com','a@example..com','a@localhost','a@example.com\r\nBcc:b@example.com','a'*65+'@example.com']:
   with self.subTest(email=email):
    self.assertEqual(self.client.post('/api/v1/reputation/lookup',headers=self.headers,json={'public_email':email}).status_code,422)
  self.assertEqual(Repo.calls,[])
 def test_creation_requires_email_even_with_profile_selected(self):
  payload=self.payload.copy();payload.pop('public_email')
  for extra in [{},{'profile_id':PROFILE}]:
   self.assertEqual(self.client.post('/api/v1/reputation/reviews',headers=self.headers,json=payload|extra).status_code,422)
  self.assertEqual(Repo.calls,[])
 def test_search_accepts_complete_email_and_stays_bounded(self):
  email='a'*64+'@'+'b'*63+'.'+'c'*63+'.example'
  self.assertEqual(self.client.get('/api/v1/reputation',params={'search':email},headers=self.headers).status_code,200)
  self.assertEqual(self.client.get('/api/v1/reputation',params={'search':'a'*255},headers=self.headers).status_code,422)

 def test_new_experience_never_invents_payment_or_legacy_scope(self):
  payload=self.payload.copy();payload.pop('scope');payload.pop('payment');payload['collaboration']=3
  self.assertEqual(self.client.post('/api/v1/reputation/reviews',headers=self.headers,json=payload).status_code,200)
  saved=Repo.calls[-1][2]['p_data']
  self.assertEqual(saved['collaboration'],3)
  self.assertNotIn('payment',saved);self.assertNotIn('scope',saved)
 def test_options_pass_normalized_client_filter_to_database(self):
  response=self.client.get('/api/v1/reputation/review-options',params={'public_email':' Chosen@Example.invalid '},headers=self.headers)
  self.assertEqual(response.status_code,200)
  self.assertEqual(Repo.calls[-1][2],{'p_action':'options','p_data':{'public_email':'chosen@example.invalid'}})
 def test_invalid_collaboration_or_client_filter_never_calls_rpc(self):
  payload=self.payload.copy();payload.pop('scope');payload.pop('payment');payload['collaboration']=6
  self.assertEqual(self.client.post('/api/v1/reputation/reviews',headers=self.headers,json=payload).status_code,422)
  self.assertEqual(self.client.get('/api/v1/reputation/review-options?public_email=invalid',headers=self.headers).status_code,422)
  self.assertEqual(Repo.calls,[])

 def test_new_profile_needs_only_email_and_experience(self):
  payload=self.payload.copy()
  for field in ('name','location','website','scope','payment'):payload.pop(field,None)
  payload['collaboration']=4
  self.assertEqual(self.client.post('/api/v1/reputation/reviews',headers=self.headers,json=payload).status_code,200)
  saved=Repo.calls[-1][2]['p_data']
  for field in ('name','location','website'):self.assertNotIn(field,saved)
