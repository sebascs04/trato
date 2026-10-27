import unittest
import httpx
from trato_api.app import Settings
from trato_api.persistence import Repository
from trato_api.errors import ApiError

PROJECT='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
class ActivityTest(unittest.TestCase):
 def repo(self,foreign=False):
  self.requests=[]
  def handle(request):
   self.requests.append(request)
   table=request.url.path.split('/')[-1]
   data={
    'projects':[] if foreign else [{'id':PROJECT,'client_id':'client','name':'Project'}],
    'documents':[{'id':'request','title':'Pedido de cambio','created_at':'2026-10-26T15:00:00Z'}],
    'change_proposals':[{'id':'proposal','request_document_id':'request'}],
    'proposal_revisions':[{'id':'revision','proposal_id':'proposal','revision_no':1,'additional_minor':10}],
    'proposal_deliveries':[{'id':'mail-adenda','proposal_id':'proposal','revision_id':'revision','kind':'adenda','updated_at':'2026-10-26T16:00:00Z'},{'id':'mail-payment','proposal_id':'proposal','revision_id':'revision','kind':'payment','updated_at':'2026-10-26T17:00:00Z'}],
    'proposal_acceptances':[{'id':'acceptance','proposal_id':'proposal','revision_id':'revision','created_at':'2026-10-26T16:30:00Z'}],
    'proposal_payments':[{'id':'payment','proposal_id':'proposal','revision_id':'revision','amount_minor':10,'currency':'USD','updated_at':'2026-10-26T18:00:00Z'}],
    'request_closures':[]}
   return httpx.Response(200,json=data[table])
  return Repository(Settings(supabase_url='https://tests.supabase.invalid',supabase_key='sb_publishable_test'),'Bearer owner-user',transport=httpx.MockTransport(handle))
 def test_single_feed_includes_verified_payment_first_and_only_business_milestones(self):
  events=self.repo().activity(PROJECT)
  self.assertEqual([e['kind'] for e in events],['payment_completed','payment_requested','acceptance_recorded','adenda_sent','request_registered'])
  self.assertEqual(events[0]['title'],'Pago confirmado · USD 0.10')
  self.assertEqual(events[0]['request_title'],'Pedido de cambio')
  for request in self.requests:
   self.assertEqual(request.headers['authorization'],'Bearer owner-user')
   if request.url.path.endswith('/proposal_payments'):self.assertEqual(request.url.params['status'],'eq.completed')
   if request.url.path.endswith('/proposal_deliveries'):self.assertEqual(request.url.params['status'],'eq.accepted_by_gmail')
   self.assertNotIn('/proposal_events',request.url.path)
 def test_foreign_project_is_rejected_before_reading_financial_records(self):
  repo=self.repo(foreign=True)
  with self.assertRaises(ApiError):repo.activity(PROJECT)
  self.assertEqual(len(self.requests),1)
