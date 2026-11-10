"""HTTP/DTO and repository contract tests. Doubles do not prove SQL isolation."""
import unittest
from uuid import UUID
from types import SimpleNamespace
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient

from trato_api.app import create_app
from trato_api.errors import ApiError
from trato_api.refunds.repository import RefundRepository
from trato_api.refunds.domain import SettlementTerms, prepare_settlement


def uid(n):
    return str(UUID(int=n))


class Services:
    def authenticate(self, token):
        if token != 'Bearer test-owner':
            raise ApiError('UNAUTHORIZED', 401)
        return uid(1)


class Repo:
    def __init__(self):
        self.calls = []

    def command(self, action, data, key):
        self.calls.append((action, data, key))
        return {'settlement': {'id': uid(10)}}

    def list_settlements(self, project):
        self.calls.append(('list',project)); return []

    def detail(self, parent):
        self.calls.append(('detail',parent)); return {'snapshots':[]}

    def snapshot(self, parent, snapshot):
        self.calls.append(('snapshot',parent,snapshot)); return {'snapshot':{}}

    def eligible_payments(self, project):
        self.calls.append(('payments',project)); return []

    def received_payments(self, project, payment=None):
        self.calls.append(('received', project, payment))
        rows = [{'id': uid(3), 'capture_id': 'CAPTURE123'}, {'id': uid(30), 'capture_id': 'CAPTURE456'}]
        return [row for row in rows if payment is None or row['id'] == payment]

    def operation(self, project, key):
        self.calls.append(('operation',project,key)); return {'state':'unconfirmed'}

    def queue_document(self, document_id):
        self.calls.append(('queue',document_id));return {'thread_id':uid(90),'status':'queued'}


class RefundApiTests(unittest.TestCase):
    def setUp(self):
        self.repo = Repo()
        self.workflow_calls=[]
        def invoke(name):
            def call(*args,**kwargs):
                self.workflow_calls.append((name,args,kwargs));return {'settlement':{'id':uid(10)},
                    **({'artifact':{'document_id':uid(40)}} if name=='pdf' else {})}
            return call
        self.workflow=SimpleNamespace(**{name:invoke(name) for name in ['pdf','preview','send','register_initial','reconcile_send','sync']})
        dispute_guard = patch('trato_api.app.ensure_no_open_dispute')
        self.dispute_guard = dispute_guard.start()
        self.addCleanup(dispute_guard.stop)
        self.dispute_guard.return_value = None
        with patch('trato_api.app.RefundWorkflow',return_value=self.workflow):
            self.client = TestClient(create_app(services=Services(),
                refund_repository_factory=lambda settings, authorization: self.repo))
        self.client.__enter__(); self.addCleanup(self.client.__exit__, None, None, None)
        self.headers={'Authorization':'Bearer test-owner','Idempotency-Key':'create-test'}
        self.create_url=f'/api/v1/projects/{uid(2)}/refunds'
        self.create_data={'payment_id':uid(3),'scope':'payment_only','reason':'Cancel this payment',
                          'requested_by':'customer','request_evidence':[{'document_id':uid(4),
                          'extraction_id':uid(5),'document_sha256':'a'*64,'quote':'Cancel please'}]}

    def test_create_uses_path_project_and_idempotency(self):
        r=self.client.post(self.create_url,json=self.create_data,headers=self.headers)
        self.assertEqual(r.status_code,200,r.text)
        self.dispute_guard.assert_called_once_with('CAPTURE123')
        self.assertIn(('received',uid(2),uid(3)), self.repo.calls)
        action,data,key=self.repo.calls[-1]
        self.assertEqual((action,data['project_id'],key),('create',uid(2),'create-test'))
        self.assertEqual(r.headers['cache-control'],'no-store')

    def test_create_reports_open_dispute_before_registering_the_request(self):
        self.dispute_guard.side_effect = ApiError('REFUND_PAYMENT_IN_DISPUTE', 409)
        response = self.client.post(self.create_url, json=self.create_data, headers=self.headers)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['error']['code'], 'REFUND_PAYMENT_IN_DISPUTE')
        self.assertFalse(any(call[0] == 'create' for call in self.repo.calls))

    def test_create_prepares_evidence_after_registration_and_reports_queue_failure(self):
        def prepare(*_):
            self.assertEqual(self.repo.calls[-1][0], 'create')
            raise ApiError('AI_QUEUE_UNAVAILABLE', 503)

        with patch.dict('os.environ', {'TRATO_FILE_PROCESSING_ENABLED': 'true', 'TRATO_VECTOR_SEARCH_ENABLED': 'true'}), \
             patch('trato_api.refunds.routes.prepare_request_evidence', side_effect=prepare) as enqueue:
            response = self.client.post(self.create_url, json=self.create_data, headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['data']['settlement']['id'], uid(10))
        self.assertEqual(response.json()['data']['evidence_processing_error'], 'AI_QUEUE_UNAVAILABLE')
        enqueue.assert_called_once()

    def test_all_routes_require_jwt(self):
        paths=[('GET',self.create_url),('POST',self.create_url),('GET',f'/api/v1/refunds/{uid(10)}'),
               ('GET',f'/api/v1/projects/{uid(2)}/refund-payments'),
               ('POST',f'/api/v1/projects/{uid(2)}/refund-payments/sync'),
               ('GET',f'/api/v1/projects/{uid(2)}/refund-operations/key'),
               ('GET',f'/api/v1/refunds/{uid(10)}/snapshots/{uid(11)}'),
               ('POST',f'/api/v1/refunds/{uid(10)}/draft'),('POST',f'/api/v1/refunds/{uid(10)}/close')]
        base=f'/api/v1/refunds/{uid(10)}';snapshot=base+'/snapshots/'+uid(11)
        paths += [('POST',f'/api/v1/projects/{uid(2)}/initial-payments')]
        paths += [('POST',base+'/'+action) for action in ['review','feedback','acceptance']]
        paths += [('GET',snapshot+'/email-preview')]+[('POST',snapshot+'/'+action) for action in ['pdf','email','email/reconcile','responses/sync']]
        paths += [('GET',base+f'/responses/{uid(12)}/attachments/0'),('POST',base+f'/responses/{uid(12)}/attachments/0/import')]
        for method,path in paths:
            with self.subTest(path=path):self.assertEqual(self.client.request(method,path).status_code,401)
        self.assertFalse(self.repo.calls)

    def test_operation_query_and_payment_list_are_read_only_and_project_scoped(self):
        path=f'/api/v1/projects/{uid(2)}'
        self.assertEqual(self.client.get(path+'/refund-payments',headers=self.headers).status_code,200)
        r=self.client.get(path+'/refund-operations/saved-key',headers=self.headers)
        self.assertEqual(r.json()['data'],{'state':'unconfirmed'})
        self.assertIn(('operation',uid(2),'saved-key'),self.repo.calls)
        self.assertEqual(self.client.get(path+'/refund-operations/'+('a'*129),headers=self.headers).status_code,422)
        self.assertFalse(any(call[0] in ['create','edit_draft','close'] for call in self.repo.calls))

    def test_client_cannot_supply_financial_context_or_override_project(self):
        for extra in [{'project_id':uid(99)},{'capture_verified':True},{'merchant_id':'other'},
                      {'previous_refunds_minor':0},{'provider_remaining_minor':30000}]:
            with self.subTest(extra=extra):
                r=self.client.post(self.create_url,json=self.create_data|extra,headers=self.headers)
                self.assertEqual(r.status_code,422,r.text)
        self.assertFalse(self.repo.calls)

    def test_missing_key_bad_ids_malformed_json_and_body_limit(self):
        self.assertEqual(self.client.post(self.create_url,json=self.create_data,
            headers={'Authorization':'Bearer test-owner'}).status_code,422)
        self.assertEqual(self.client.get('/api/v1/refunds/bad',headers=self.headers).status_code,422)
        self.assertEqual(self.client.post(self.create_url,content=b'{',headers=self.headers).status_code,422)
        self.assertEqual(self.client.post(self.create_url,content=b'x'*2_000_001,headers=self.headers).status_code,413)
        self.assertFalse(self.repo.calls)

    def test_first_draft_requires_explicit_null_then_snapshot_id(self):
        terms={'currency':'USD','adjustments':[],'proposed_refund_minor':30000,'conditions':'Full refund'}
        url=f'/api/v1/refunds/{uid(10)}/draft'
        self.assertEqual(self.client.post(url,json={'terms':terms},headers=self.headers).status_code,422)
        for snapshot in [None,uid(11)]:
            r=self.client.post(url,json={'terms':terms,'expected_snapshot_id':snapshot},headers=self.headers)
            self.assertEqual(r.status_code,200,r.text)
        self.assertEqual(self.repo.calls[-1][1]['expected_snapshot_id'],uid(11))
        for bad in [True,-1,'30000',1.2]:
            r=self.client.post(url,json={'terms':terms|{'proposed_refund_minor':bad},
                               'expected_snapshot_id':None},headers=self.headers)
            self.assertEqual(r.status_code,422,r.text)

    def test_close_has_explicit_reason_and_no_acceptance_or_provider_routes(self):
        base=f'/api/v1/refunds/{uid(10)}'
        for reason in ['accepted','completed','refund_pending']:
            self.assertEqual(self.client.post(base+'/close',json={'reason':reason,'notes':'x'},headers=self.headers).status_code,422)
        self.assertEqual(self.client.post(base+'/close',json={'reason':'withdrawn','notes':'Client withdrew'},headers=self.headers).status_code,200)
        for action in ['accept','send','authorize']:
            self.assertEqual(self.client.post(base+'/'+action,headers=self.headers).status_code,404)
        # /refund is the one-click last step. It still needs a key and explicit confirmation, and
        # goes through the usual check, authorization and execution (refunds/client_request.py).
        self.assertEqual(self.client.post(base+'/refund',headers=self.headers).status_code,422)

    def test_project_scope_requires_reviewed_distinct_members_and_no_individual_id(self):
        data={k:v for k,v in self.create_data.items() if k!='payment_id'}
        data|={'scope':'project_closure','payment_ids':[uid(3),uid(30)],'payments_reviewed':True}
        for invalid in [{'payments_reviewed':False},{'payments_reviewed':'true'},{'payment_ids':[uid(3),uid(3)]},{'payment_id':uid(3)}]:
            self.assertEqual(self.client.post(self.create_url,json=data|invalid,headers=self.headers).status_code,422)
        self.assertFalse(self.repo.calls)
        self.assertEqual(self.client.post(self.create_url,json=data,headers=self.headers).status_code,200)
        self.assertEqual(self.repo.calls[-1][1]['payment_ids'],[uid(3),uid(30)])
        self.assertEqual([call.args[0] for call in self.dispute_guard.call_args_list], ['CAPTURE123', 'CAPTURE456'])

    def test_review_and_acceptance_require_explicit_confirmation_exact_head_and_known_evidence(self):
        base=f'/api/v1/refunds/{uid(10)}'
        data={'expected_snapshot_id':uid(11),'confirmed':True,'notes':'Reviewed exact version'}
        for bad in [data|{'confirmed':False},data|{'confirmed':'true'},{'confirmed':True,'notes':'Reviewed'}]:
            self.assertEqual(self.client.post(base+'/review',json=bad,headers=self.headers).status_code,422)
        self.assertEqual(self.client.post(base+'/review',json=data,headers=self.headers).status_code,200)
        self.assertEqual(self.repo.calls[-1][0],'review_pdf')
        for evidence in [{'email_id':'bad'},{'email_id':uid(12),'provider_verified':True},{'document_id':uid(4),'document_sha256':'x'}]:
            self.assertEqual(self.client.post(base+'/acceptance',json=data|{'evidence':evidence},headers=self.headers).status_code,422)
        for suffix,action in [('feedback','feedback'),('acceptance','accept')]:
            self.assertEqual(self.client.post(base+'/'+suffix,json=data|{'evidence':{'email_id':uid(12)}},headers=self.headers).status_code,200)
            self.assertEqual(self.repo.calls[-1][0],action)
        citation=self.create_data['request_evidence'][0]
        self.assertEqual(self.client.post(base+'/feedback',json=data|{'evidence':citation},headers=self.headers).status_code,200)
        self.assertEqual(self.repo.calls[-1][1]['evidence'],citation)
        pdf={'document_id':uid(4),'document_sha256':'a'*64}
        self.assertEqual(self.client.post(base+'/acceptance',json=data|{'evidence':pdf},headers=self.headers).status_code,200)
        self.assertEqual(self.client.post(base+'/feedback',json=data|{'evidence':pdf},headers=self.headers).status_code,422)

    def test_server_workflow_routes_bind_identity_and_reject_unreviewed_send_and_language(self):
        base=f'/api/v1/refunds/{uid(10)}/snapshots/{uid(11)}'
        for data in [{'digest':'d'*64,'confirmed':False},{'digest':'d'*64,'confirmed':True,'recipient':'arbitrary@example.invalid'}]:
            self.assertEqual(self.client.post(base+'/email',json=data,headers=self.headers).status_code,422)
        self.assertEqual(self.client.post(base+'/pdf',json={'language':'fr'},headers=self.headers).status_code,422)
        self.assertFalse(self.workflow_calls)
        self.assertEqual(self.client.post(base+'/pdf',json={'language':'en'},headers=self.headers).status_code,200)
        self.assertEqual(self.client.post(base+'/email',json={'digest':'d'*64,'confirmed':True},headers=self.headers).status_code,200)
        name,args,_=self.workflow_calls[-1]
        self.assertEqual((name,args[1:]),('send',(uid(1),uid(10),uid(11),'d'*64,'create-test')))

    def test_initial_receipt_cannot_claim_amount_currency_or_merchant_from_http(self):
        data={'order_id':'ORDER','capture_id':'CAPTURE','notes':'Reviewed','confirmed':True,'evidence':self.create_data['request_evidence']}
        url=f'/api/v1/projects/{uid(2)}/initial-payments'
        for invalid in [{'amount_minor':10000},{'merchant_id':'other'},{'confirmed':False},{'order_id':'https://other.invalid'}]:
            self.assertEqual(self.client.post(url,json=data|invalid,headers=self.headers).status_code,422)
        self.assertFalse(self.workflow_calls)
        self.assertEqual(self.client.post(url,json=data,headers=self.headers).status_code,200)
        self.assertEqual(self.workflow_calls[0][1][1:3],(uid(1),uid(2)))

    def test_reads_and_snapshot_pair_are_passed_to_repository(self):
        self.assertEqual(self.client.get(self.create_url,headers=self.headers).status_code,200)
        self.assertEqual(self.client.get(f'/api/v1/refunds/{uid(10)}',headers=self.headers).status_code,200)
        self.assertEqual(self.client.get(f'/api/v1/refunds/{uid(10)}/snapshots/{uid(11)}',headers=self.headers).status_code,200)
        self.assertIn(('snapshot',uid(10),uid(11)),self.repo.calls)


class RefundRepositoryTests(unittest.TestCase):
    def test_payment_lookup_uses_scoped_read_rpc_without_financial_inputs(self):
        import json
        requests=[]
        def transport(request):
            requests.append(request)
            if request.url.path.endswith('projects'):data=[{'id':uid(2)}]
            else:
                self.assertTrue(request.url.path.endswith('/rpc/refund_payments'))
                self.assertEqual(json.loads(request.content),{'p_project_id':uid(2)})
                data=[{'id':uid(3),'amount_minor':30000,'local_previous_refunds_minor':5000}]
            return httpx.Response(200,json=data)
        repo=RefundRepository(SimpleNamespace(supabase_url='https://example.invalid',supabase_key='key'),
                              'Bearer user',transport=httpx.MockTransport(transport))
        self.assertEqual(repo.eligible_payments(uid(2))[0]['local_previous_refunds_minor'],5000)
        self.assertEqual(len(requests),2)

    def test_history_reads_all_pages_without_loading_full_terms(self):
        requests=[]
        def transport(request):
            requests.append(request)
            if request.url.path.endswith('refund_settlements'):
                return httpx.Response(200,json=[{'id':uid(10)}])
            if request.url.path.endswith('refund_snapshots'):
                self.assertNotEqual(request.url.params['select'],'*')
                offset=int(request.url.params['offset'])
                return httpx.Response(200,json=[{'id':uid(i+100)} for i in range(offset,min(offset+100,101))])
            return httpx.Response(200,json=[])
        repo=RefundRepository(SimpleNamespace(supabase_url='https://example.invalid',supabase_key='key'),
                              'Bearer user',transport=httpx.MockTransport(transport))
        self.assertEqual(len(repo.detail(uid(10))['snapshots']),101)
        self.assertEqual(len(requests),5)

    def test_reads_use_user_jwt_and_parent_scope(self):
        calls=[]
        def transport(request):
            calls.append(request)
            self.assertEqual(request.headers['Authorization'],'Bearer owner-token')
            if request.url.path.endswith('refund_settlements'):
                return httpx.Response(200,json=[{'id':uid(10)}])
            return httpx.Response(200,json=[])
        repo=RefundRepository(SimpleNamespace(supabase_url='https://example.invalid',supabase_key='public-key'),
                              'Bearer owner-token',transport=httpx.MockTransport(transport))
        with self.assertRaises(ApiError) as caught:repo.snapshot(uid(10),uid(11))
        self.assertEqual(caught.exception.code,'REFUND_SNAPSHOT_NOT_FOUND')
        self.assertEqual(calls[1].url.params['settlement_id'],'eq.'+uid(10))
        self.assertEqual(calls[1].url.params['id'],'eq.'+uid(11))

    def test_missing_parent_stops_child_reads(self):
        calls=[]
        def transport(request):
            calls.append(request);return httpx.Response(200,json=[])
        repo=RefundRepository(SimpleNamespace(supabase_url='https://example.invalid',supabase_key='key'),
                              'Bearer user',transport=httpx.MockTransport(transport))
        with self.assertRaises(ApiError):repo.detail(uid(10))
        self.assertEqual(len(calls),1)


class PreparationTests(unittest.TestCase):
    def test_preparation_cannot_claim_provider_verification_or_zero_fees(self):
        terms=SettlementTerms(currency='USD',adjustments=[],proposed_refund_minor=25000,conditions='Review')
        result=prepare_settlement(terms,30000,5000)
        self.assertEqual(result.refund_minor,25000)
        self.assertIsNone(result.original_fee_minor)
        self.assertIsNone(result.provider_remaining_minor)
        self.assertFalse(result.provider_verified)
        self.assertFalse(result.financial_execution_ready)

    def test_local_previous_refunds_are_not_deducted_twice(self):
        terms=SettlementTerms(currency='USD',adjustments=[],proposed_refund_minor=20000,conditions='Review')
        with self.assertRaises(ApiError):prepare_settlement(terms,30000,5000)
