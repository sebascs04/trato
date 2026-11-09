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
    'projects':[] if foreign else [{'id':PROJECT,'client_id':'client','name':'Project','created_at':'2026-10-25T10:00:00Z'}],
    'documents':[{'id':'agreement','title':'Acuerdo inicial','created_at':'2026-10-25T11:00:00Z'}] if request.url.params.get('kind')=='eq.initial_agreement' else [{'id':'request','title':'Pedido de cambio','created_at':'2026-10-26T15:00:00Z'}],
    'change_proposals':[{'id':'proposal','request_document_id':'request'}],
    'proposal_revisions':[{'id':'revision','proposal_id':'proposal','revision_no':1,'additional_minor':10}],
    'proposal_deliveries':[{'id':'mail-adenda','proposal_id':'proposal','revision_id':'revision','kind':'adenda','updated_at':'2026-10-26T16:00:00Z'},{'id':'mail-payment','proposal_id':'proposal','revision_id':'revision','kind':'payment','updated_at':'2026-10-26T17:00:00Z'}],
    'proposal_acceptances':[{'id':'acceptance','proposal_id':'proposal','revision_id':'revision','created_at':'2026-10-26T16:30:00Z'}],
    'proposal_payments':[{'id':'payment','proposal_id':'proposal','revision_id':'revision','amount_minor':10,'currency':'USD','updated_at':'2026-10-26T18:00:00Z'}],
    'client_portal_change_requests':getattr(self,'portal_requests',[]),
    'request_closures':[],**getattr(self,'plan_tables',{'project_start_plans':[]}),**{table:[] for table in ['refund_settlements','refund_snapshots','refund_deliveries','refund_feedback','refund_acceptances','refund_financial_authorizations','refund_provider_receipts','refund_receipt_applications']}}
   return httpx.Response(200,json=data[table])
  return Repository(Settings(supabase_url='https://tests.supabase.invalid',supabase_key='sb_publishable_test'),'Bearer owner-user',transport=httpx.MockTransport(handle))
 def test_plan_milestones_use_verified_stage_payments_in_project_group(self):
  self.plan_tables={'project_start_plans':[{'created_at':'2026-10-25T10:30:00Z','currency':'USD'}],
   'project_start_stages':[{'position':1,'title':'Design','amount':'180.00'},{'position':2,'title':'Build','amount':'300.00'}],
   'document_upload_contexts':[{'document_id':'evidence-1','stage_position':1},{'document_id':'evidence-2','stage_position':2}],
   'project_plan_progress':{'completed_at':None,'stages':[{'position':1,'payment_id':'pay-1','status':'completed','paid_at':'2026-10-27T10:00:00Z','evidence_document_id':'evidence-1'},
     {'position':2,'payment_id':'pay-2','status':'pending_approval','paid_at':None,'evidence_document_id':'evidence-2'}]}}
  repo=self.repo();original=repo.rows
  def rows(table,params):
   if table=='documents' and params.get('kind')=='eq.delivery':return [{'id':'evidence-1','title':'Sign-off 1','created_at':'2026-10-26T09:00:00Z'},{'id':'evidence-2','title':'Sign-off 2','created_at':'2026-10-26T12:00:00Z'}][int(params.get('offset',0)):]
   return original(table,params)
  repo.rows=rows;repo.rpc=lambda name,data:self.plan_tables[name]
  plan=[e for e in repo.activity(PROJECT) if e['group_kind']=='project' and e['kind'] in ('plan_confirmed','delivery_evidence_added','stage_paid','plan_completed')]
  self.assertEqual([e['kind'] for e in plan],['stage_paid','delivery_evidence_added','delivery_evidence_added','plan_confirmed'])
  self.assertEqual((plan[0]['stage_position'],plan[0]['amount_minor'],plan[0]['document_id']),(1,18000,'evidence-1'))
  self.assertEqual((plan[-1]['stages'],plan[-1]['amount_minor']),(2,48000))
  self.assertNotIn('stage-paid-pay-2',[e['id'] for e in plan])
 def test_single_feed_includes_verified_payment_first_and_only_business_milestones(self):
  events=self.repo().activity(PROJECT)
  self.assertEqual([e['kind'] for e in events],['payment_completed','payment_requested','acceptance_recorded','adenda_sent','request_registered','initial_source_added','project_created'])
  self.assertEqual(events[0]['title'],'Pago confirmado · USD 0.10')
  self.assertEqual(events[0]['request_title'],'Pedido de cambio')
  start=[e for e in events if e['group_kind']=='project']
  self.assertEqual({e['group_id'] for e in start},{PROJECT})
  self.assertEqual(start[0]['document_id'],'agreement')
  self.assertEqual(start[1]['created_at'],'2026-10-25T10:00:00Z')
  initial=[r for r in self.requests if r.url.params.get('kind')=='eq.initial_agreement']
  self.assertEqual(initial[0].url.params['deleted_at'],'is.null')
  for request in self.requests:
   self.assertEqual(request.headers['authorization'],'Bearer owner-user')
   if request.url.path.endswith('/proposal_payments'):self.assertEqual(request.url.params['status'],'eq.completed')
   if request.url.path.endswith('/proposal_deliveries'):self.assertEqual(request.url.params['status'],'eq.accepted_by_gmail')
   self.assertNotIn('/proposal_events',request.url.path)
 def test_foreign_project_is_rejected_before_reading_financial_records(self):
  repo=self.repo(foreign=True)
  with self.assertRaises(ApiError):repo.activity(PROJECT)
  self.assertEqual(len(self.requests),1)


class PortalActivityTest(ActivityTest):
 def test_portal_request_and_portal_acceptance_are_labelled_as_client_actions(self):
  self.portal_requests=[{'id':'portal-req','proposal_id':'proposal','revision_id':'revision','created_at':'2026-10-26T16:10:00Z'}]
  events={e['id']:e for e in self.repo().activity(PROJECT)}
  self.assertEqual(events['portal-request-portal-req']['kind'],'client_changes_requested')
  self.assertEqual(events['portal-request-portal-req']['source'],'client_portal')
  self.assertEqual(events['portal-request-portal-req']['revision_no'],1)
  self.assertNotIn('source',events['acceptance-acceptance'])
