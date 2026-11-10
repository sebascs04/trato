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
    'client_problem_reports':getattr(self,'problems',[]),'client_problem_messages':getattr(self,'problem_messages',[]),
    'project_stage_delivery_shares':getattr(self,'shares',[]),'project_stage_reviews':getattr(self,'reviews',[]),
    'request_closures':[],**getattr(self,'plan_tables',{'project_start_plans':[]}),**{table:[] for table in ['refund_settlements','refund_snapshots','refund_deliveries','refund_feedback','refund_acceptances','refund_financial_authorizations','refund_provider_receipts','refund_receipt_applications']}}
   if table=='proposal_payments' and request.url.params.get('method')=='eq.invoice':return httpx.Response(200,json=getattr(self,'invoices',[]))
   if table=='documents' and request.url.params.get('id','').startswith('in.'):return httpx.Response(200,json=getattr(self,'linked_requests',[]))
   return httpx.Response(200,json=data[table])
  return Repository(Settings(supabase_url='https://tests.supabase.invalid',supabase_key='sb_publishable_test'),'Bearer owner-user',transport=httpx.MockTransport(handle))
 def test_plan_milestones_use_verified_stage_payments_in_project_group(self):
  self.plan_tables={'project_start_plans':[{'created_at':'2026-10-25T10:30:00Z','currency':'USD'}],
   'project_start_stages':[{'position':1,'title':'Design','amount':'180.00'},{'position':2,'title':'Build','amount':'300.00'}],
   'document_upload_contexts':[{'document_id':'evidence-1','stage_position':1},{'document_id':'evidence-2','stage_position':2}],
   'project_plan_progress':{'completed_at':None,'stages':[{'position':1,'payment_id':'pay-1','status':'completed','paid_at':'2026-10-27T10:00:00Z','evidence_document_id':'evidence-1'},
     {'position':2,'payment_id':'pay-2','status':'pending_approval','paid_at':None,'evidence_document_id':'evidence-2'}]},'project_stage_payment_emails':[]}
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
   # Money events come only from completed payments; the invoice lookup only names the payment email and confirms nothing.
   if request.url.path.endswith('/proposal_payments'):
    if request.url.params.get('method')=='eq.invoice':self.assertEqual(request.url.params['select'],'revision_id,invoice_number')
    else:self.assertEqual(request.url.params['status'],'eq.completed')
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


class NewRecordsActivityTest(ActivityTest):
 def test_invoice_charged_payment_email_is_named_as_the_paypal_invoice(self):
  self.invoices=[{"revision_id":"revision","invoice_number":"TR-C6UD7DWUMV"}]
  events={e["id"]:e for e in self.repo().activity(PROJECT)}
  self.assertEqual(events["email-mail-payment"]["kind"],"invoice_sent")
  self.assertEqual(events["email-mail-payment"]["invoice_number"],"TR-C6UD7DWUMV")
  self.assertEqual(events["email-mail-adenda"]["kind"],"adenda_sent")

 def test_problem_report_replies_link_and_closure_join_the_request_group(self):
  self.problems=[{"id":"rep","proposal_id":"proposal","revision_id":"revision","reason":"not_received","status":"resolved",
                  "created_at":"2026-10-27T09:00:00Z","closed_at":"2026-10-27T12:00:00Z","request_document_id":"new-request"}]
  self.problem_messages=[{"id":"m1","report_id":"rep","author":"freelancer","created_at":"2026-10-27T10:00:00Z"}]
  self.linked_requests=[{"id":"new-request","title":"Fix the footer","created_at":"2026-10-27T11:00:00Z"}]
  events={e["id"]:e for e in self.repo().activity(PROJECT)}
  for key,kind in (("problem-rep","problem_reported"),("problem-message-m1","problem_message"),("problem-request-rep","problem_request_registered"),("problem-closed-rep","problem_closed")):
   self.assertEqual(events[key]["kind"],kind)
   self.assertEqual((events[key]["group_kind"],events[key]["group_id"]),("change","request"))
  self.assertEqual(events["problem-rep"]["revision_no"],1)
  self.assertEqual(events["problem-message-m1"]["author"],"freelancer")
  self.assertEqual(events["problem-request-rep"]["new_request_title"],"Fix the footer")
  self.assertEqual(events["problem-closed-rep"]["status"],"resolved")
  messages=[r for r in self.requests if r.url.path.endswith("/client_problem_messages")]
  self.assertEqual(messages[0].url.params["report_id"],"in.(rep)")

 def test_stage_delivery_shared_and_client_decision_join_the_project_group(self):
  self.plan_tables={"project_start_plans":[{"created_at":"2026-10-25T10:30:00Z","currency":"USD"}],
   "project_start_stages":[{"position":1,"title":"Design","amount":"180.00"}],"document_upload_contexts":[],
   "project_plan_progress":{"completed_at":None,"stages":[]},
   "project_stage_payment_emails":[{"id":7,"stage_position":1,"invoice":False,"sent_at":"2026-10-26T15:29:00Z"},{"id":8,"stage_position":1,"invoice":True,"invoice_number":"TR-1","sent_at":"2026-10-26T15:33:00Z"}]}
  self.shares=[{"document_id":"evidence-1","stage_position":1,"shared_at":"2026-10-26T10:00:00Z"},{"document_id":"gone","stage_position":1,"shared_at":"2026-10-26T10:00:00Z"}]
  self.reviews=[{"document_id":"evidence-1","stage_position":1,"decision":"changes_requested","created_at":"2026-10-26T11:00:00Z"}]
  repo=self.repo();original=repo.rows
  def rows(table,params):
   if table=="documents" and params.get("kind")=="eq.delivery":return [{"id":"evidence-1","title":"Sign-off 1","created_at":"2026-10-26T09:00:00Z"}][int(params.get("offset",0)):]
   return original(table,params)
  repo.rows=rows;repo.rpc=lambda name,data:self.plan_tables[name]
  events={e["id"]:e for e in repo.activity(PROJECT)}
  self.assertEqual(events["delivery-shared-evidence-1"]["kind"],"delivery_shared")
  self.assertEqual(events["stage-review-evidence-1"]["decision"],"changes_requested")
  self.assertEqual(events["stage-review-evidence-1"]["group_kind"],"project")
  self.assertNotIn("delivery-shared-gone",events)  # A deleted delivery is not counted either.
  self.assertEqual((events["stage-payment-email-7"]["kind"],events["stage-payment-email-7"]["invoice"]),("stage_payment_requested",False))
  self.assertEqual((events["stage-payment-email-8"]["invoice"],events["stage-payment-email-8"]["invoice_number"]),(True,"TR-1"))
  self.assertNotIn("invoice_number",events["stage-payment-email-7"])

 def test_problem_report_on_a_paid_deliverable_joins_the_project_group(self):
  self.plan_tables={"project_start_plans":[{"created_at":"2026-10-25T10:30:00Z","currency":"USD"}],
   "project_start_stages":[{"position":1,"title":"Design","amount":"180.00"}],"document_upload_contexts":[],
   "project_plan_progress":{"completed_at":None,"stages":[]},"project_stage_payment_emails":[]}
  self.problems=[{"id":"stage-rep","proposal_id":None,"revision_id":None,"stage_position":1,"reason":"quality","status":"open",
                  "created_at":"2026-10-27T09:00:00Z","closed_at":None,"request_document_id":None}]
  self.problem_messages=[{"id":"m1","report_id":"stage-rep","author":"client","created_at":"2026-10-27T10:00:00Z"}]
  repo=self.repo();original=repo.rows
  def rows(table,params):
   if table=="documents" and params.get("kind")=="eq.delivery":return []
   return original(table,params)
  repo.rows=rows;repo.rpc=lambda name,data:self.plan_tables[name]
  events={e["id"]:e for e in repo.activity(PROJECT)}  # Before the fix, a report without addendum broke the whole history.
  self.assertEqual((events["problem-stage-rep"]["group_kind"],events["problem-stage-rep"]["stage_position"]),("project",1))
  self.assertEqual(events["problem-message-m1"]["group_kind"],"project")
