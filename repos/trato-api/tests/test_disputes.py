import unittest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from fastapi.responses import JSONResponse
from trato_api.dispute_history import record_escalation
from trato_api.disputes import build_dispute_router, DisputeReader
from trato_api.errors import ApiError

PROJECT = '11111111-2222-4333-8444-555555555555'
CAPTURE = '6YT21169SK952354J'


class Repo:
    def __init__(self, *args): self.calls = []
    def project(self, project_id):
        if project_id != PROJECT: raise ApiError('PROJECT_NOT_FOUND', 404)
        return {'id': project_id}
    def rpc(self, name, params): return 0
    def rows(self, table, params):
        self.calls.append((table, params))
        return [{'id': 'rp1', 'origin': 'change', 'capture_id': CAPTURE, 'amount_minor': 12000, 'currency': 'USD',
                 'verified_at': '2026-11-08T04:17:07Z', 'proposal_payment_id': 'pp1'},
                {'id': 'rp2', 'origin': 'initial', 'capture_id': None, 'amount_minor': 1000, 'currency': 'USD'}]


class PayPal:
    def __init__(self): self.listed = []
    def list_disputes(self, capture):
        self.listed.append(capture)
        return {'items': [{'dispute_id': 'PP-R-VHD-10197086'}, {'dispute_id': 'PP-R-OTHER-1'}]}
    def get_dispute(self, dispute_id):
        seller = CAPTURE if dispute_id == 'PP-R-VHD-10197086' else 'SOMEONEELSE123'
        return {'dispute_id': dispute_id, 'reason': 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED', 'status': 'WAITING_FOR_SELLER_RESPONSE',
                'dispute_life_cycle_stage': 'INQUIRY', 'dispute_amount': {'currency_code': 'USD', 'value': '120.00'},
                'seller_response_due_date': '2026-11-28T06:09:01.643Z', 'disputed_transactions': [{'seller_transaction_id': seller, 'buyer': {'email': 'private@example.com'}}],
                'messages': [{'posted_by': 'BUYER', 'time_posted': '2026-11-08T06:09:01Z', 'content': 'Not as described.'}],
                'links': [{'rel': 'self'}, {'rel': 'send_message'}, {'rel': 'escalate'}, {'rel': 'accept_claim'}]}


class EscalationHistoryTests(unittest.TestCase):
    def test_the_escalation_is_recorded_once_under_a_fixed_key(self):
        calls = []
        class Saved:
            def rpc(self, name, data):
                calls.append((name, data))
        self.assertTrue(record_escalation(Saved(), PROJECT, 'PP-R-1'))
        name, data = calls[0]
        self.assertEqual((name, data['p_dispute'], data['p_events'][0]['event_key'], data['p_events'][0]['details']),
                         ('record_dispute_events', 'PP-R-1', 'escalated', {'escalated': True}))

    def test_a_failed_record_does_not_undo_the_escalation(self):
        class Broken:
            def rpc(self, name, data):
                raise ApiError('UNAVAILABLE', 503)
        self.assertFalse(record_escalation(Broken(), PROJECT, 'PP-R-1'))


class DisputeTests(unittest.TestCase):
    def setUp(self):
        self.paypal = PayPal(); app = FastAPI()
        app.include_router(build_dispute_router(None, lambda: 'owner', Repo, DisputeReader(self.paypal)))
        @app.exception_handler(ApiError)
        async def error(_, e): return JSONResponse({'error': {'code': e.code}}, status_code=e.status)
        self.client = TestClient(app)

    def test_only_disputes_on_this_projects_verified_captures_are_shown(self):
        response = self.client.get(f'/api/v1/projects/{PROJECT}/disputes')
        self.assertEqual(response.status_code, 200)
        data = response.json()['data']
        self.assertEqual(self.paypal.listed, [CAPTURE])
        self.assertEqual([d['dispute_id'] for d in data['disputes']], ['PP-R-VHD-10197086'])
        dispute = data['disputes'][0]
        self.assertEqual(dispute['amount'], {'value': '120.00', 'currency': 'USD'})
        self.assertEqual(dispute['actions'], ['accept_claim', 'escalate', 'send_message'])
        self.assertEqual(dispute['messages'][0], {'by': 'BUYER', 'at': '2026-11-08T06:09:01Z', 'text': 'Not as described.', 'documents': []})
        self.assertEqual(dispute['payment']['capture_id'], CAPTURE)
        self.assertNotIn('private@example.com', response.text)

    def test_other_projects_are_not_read(self):
        self.assertEqual(self.client.get('/api/v1/projects/99999999-2222-4333-8444-555555555555/disputes').status_code, 404)
        self.assertEqual(self.paypal.listed, [])


class AgentToolkitTests(unittest.TestCase):
    def test_reads_go_through_the_toolkit_and_writes_are_not_allowed(self):
        from paypal.agent_toolkit import AgentToolkit
        from paypal.client import PayPalError
        calls = []
        class Api:
            def run(self, tool, params):
                calls.append((tool, params)); return '{"items":[]}'
        toolkit = AgentToolkit('', '', api=Api())
        self.assertEqual(toolkit.list_disputes(CAPTURE), {'items': []})
        self.assertEqual(calls, [('list_disputes', {'disputed_transaction_id': CAPTURE})])
        with self.assertRaises(PayPalError): toolkit._run('accept_dispute_claim', {'dispute_id': 'x'})
        self.assertEqual(len(calls), 1)

    def test_a_silent_or_failing_provider_is_a_visible_error(self):
        import threading
        from paypal.agent_toolkit import AgentToolkit
        from paypal.client import PayPalError
        release = threading.Event(); self.addCleanup(release.set)
        class Slow:
            def run(self, *a): release.wait(5); return '{}'
        class Broken:
            def run(self, *a): raise RuntimeError('secret detail')
        with self.assertRaises(PayPalError) as slow: AgentToolkit('', '', api=Slow(), timeout=.05).get_dispute('PP-R-1')
        self.assertEqual(slow.exception.code, 'PAYPAL_UNAVAILABLE')
        with self.assertRaises(PayPalError) as broken: AgentToolkit('', '', api=Broken()).get_dispute('PP-R-1')
        self.assertEqual(broken.exception.code, 'PAYPAL_REQUEST_FAILED')
        self.assertNotIn('secret', str(broken.exception))


class SpeedTests(unittest.TestCase):
    def test_the_token_is_reused_until_it_should_be_renewed(self):
        from types import SimpleNamespace
        from paypal.agent_toolkit import reuse_token, TOKEN_SECONDS
        calls, now = [], [0]
        def fetch(): calls.append(1); return f'token-{len(calls)}'
        client = SimpleNamespace(get_access_token=fetch)
        reuse_token(SimpleNamespace(_paypal_client=client), clock=lambda: now[0])
        self.assertEqual([client.get_access_token(), client.get_access_token()], ['token-1', 'token-1'])
        now[0] = TOKEN_SECONDS
        self.assertEqual(client.get_access_token(), 'token-2')

    def test_payments_are_read_in_parallel_and_keep_their_order(self):
        import threading
        barrier = threading.Barrier(2, timeout=5)
        class Many:
            def rows(self, table, params):
                return [{'id': n, 'origin': 'change', 'capture_id': n * 10, 'amount_minor': 1, 'currency': 'USD'} for n in ('A', 'B')]
            def project(self, project_id): return {'id': project_id}
        class Parallel:
            def list_disputes(self, capture):
                barrier.wait()  # Fails with BrokenBarrierError if these calls ran one after the other.
                return {'items': [{'dispute_id': 'PP-R-' + capture}]}
            def get_dispute(self, dispute_id):
                return {'dispute_id': dispute_id, 'disputed_transactions': [{'seller_transaction_id': dispute_id[5:]}]}
        data = DisputeReader(Parallel()).project_disputes(Many(), 'p')
        self.assertEqual([d['dispute_id'] for d in data['disputes']], ['PP-R-AAAAAAAAAA', 'PP-R-BBBBBBBBBB'])


class ClientViewTests(unittest.TestCase):
    def test_client_sees_the_dispute_without_internal_records_or_foreign_transactions(self):
        from trato_api.disputes import client_dispute
        result = client_dispute(DisputeReader(PayPal()), CAPTURE)
        self.assertEqual(result['dispute_id'], 'PP-R-VHD-10197086')
        self.assertEqual(set(result), {'dispute_id', 'reason', 'status', 'stage', 'outcome', 'amount', 'messages', 'reply_url'})
        self.assertNotIn('private@example.com', str(result))
        self.assertIsNone(client_dispute(DisputeReader(PayPal()), None))

    def test_no_dispute_and_a_resolved_one_offer_no_reply_link(self):
        from trato_api.disputes import client_dispute
        class Empty(PayPal):
            def list_disputes(self, capture): return {'items': []}
        self.assertIsNone(client_dispute(DisputeReader(Empty()), CAPTURE))
        class Resolved(PayPal):
            def list_disputes(self, capture): return {'items': [{'dispute_id': 'PP-R-VHD-10197086'}]}
            def get_dispute(self, dispute_id): return {**PayPal.get_dispute(self, dispute_id), 'status': 'RESOLVED'}
        self.assertIsNone(client_dispute(DisputeReader(Resolved()), CAPTURE)['reply_url'])


class DocumentPreviewTests(unittest.TestCase):
    def setUp(self):
        outer = self
        self.fetched = []
        class Client(PayPal):
            def get_dispute(_, dispute_id):
                return {**PayPal.get_dispute(_, dispute_id), 'messages': [{'posted_by': 'SELLER', 'content': 'x', 'documents': [{'name': 'scope.pdf', 'url': 'https://api-m.sandbox.paypal.com/v1/customer/disputes/x/doc'}]}]}
            def fetch_dispute_document(_, url):
                outer.fetched.append(url); return outer.result
        self.result = (b'%PDF-1.', 'application/pdf')
        app = FastAPI()
        app.include_router(build_dispute_router(None, lambda: 'owner', Repo, DisputeReader(Client())))
        @app.exception_handler(ApiError)
        async def error(_, e): return JSONResponse({'error': {'code': e.code}}, status_code=e.status)
        self.client = TestClient(app)

    def get(self, dispute='PP-R-VHD-10197086', message=0, document=0, project=PROJECT):
        return self.client.get(f'/api/v1/projects/{project}/disputes/{dispute}/messages/{message}/documents/{document}')

    def test_attachment_is_served_through_the_backend_and_its_url_stays_hidden(self):
        listed = self.client.get(f'/api/v1/projects/{PROJECT}/disputes')
        self.assertEqual(listed.json()['data']['disputes'][0]['messages'][0]['documents'], ['scope.pdf'])
        self.assertNotIn('customer/disputes/x/doc', listed.text)
        response = self.get()
        self.assertEqual((response.status_code, response.content, response.headers['content-type'], response.headers['x-content-type-options']), (200, b'%PDF-1.', 'application/pdf', 'nosniff'))

    def test_other_projects_disputes_positions_and_file_types_are_refused(self):
        self.assertEqual(self.get(project='99999999-2222-4333-8444-555555555555').status_code, 404)
        self.assertEqual(self.get(dispute='PP-R-OTHER-1').status_code, 404)
        self.assertEqual(self.get(message=5).status_code, 404)
        self.assertEqual(self.get(document=5).status_code, 404)
        self.assertEqual(self.fetched, [])
        self.result = (b'<html>', 'text/html')
        self.assertEqual(self.get().status_code, 502)

    def test_downloads_only_come_from_paypals_dispute_api(self):
        from paypal.client import PayPalSandboxClient, PayPalError, Response as PayPalResponse
        client = PayPalSandboxClient('id', 'secret', 'MERCHANT123', transport=lambda *a: PayPalResponse(200, {'access_token': 'x', 'expires_in': 3600}))
        good = '/v2/content/documents/ABC-123/files/1/download'
        for url in ('https://evil.example.com' + good, 'http://api-m.sandbox.paypal.com' + good, 'https://api-m.sandbox.paypal.com/v1/oauth2/token', 'https://api-m.sandbox.paypal.com' + good + '?x=1', 'https://api-m.sandbox.paypal.com/v2/content/documents/../files/1/download', None):
            with self.assertRaises(PayPalError, msg=url) as caught: client.fetch_dispute_document(url)
            self.assertEqual(caught.exception.code, 'INVALID_DISPUTE_DOCUMENT')
        from unittest.mock import MagicMock, patch
        answer = MagicMock(); answer.__enter__.return_value = answer; answer.read.return_value = b'%PDF'; answer.headers.get.return_value = 'application/pdf;charset=UTF-8'
        with patch('paypal.client.build_opener') as opener:
            opener.return_value.open.return_value = answer
            self.assertEqual(client.fetch_dispute_document('https://api-m.sandbox.paypal.com' + good), (b'%PDF', 'application/pdf'))


class DisputeHistoryTests(unittest.TestCase):
    dispute = {'dispute_id': 'PP-R-1', 'reason': 'X', 'status': 'WAITING_FOR_BUYER_RESPONSE', 'stage': 'INQUIRY', 'amount': {'value': '120.00', 'currency': 'USD'}, 'outcome': None,
               'created_at': '2026-11-08T06:00:00Z', 'updated_at': '2026-11-08T18:00:00Z',
               'messages': [{'by': 'BUYER', 'at': '2026-11-08T06:00:00Z', 'text': 'Claim', 'documents': []}, {'by': 'SELLER', 'at': '2026-11-08T18:00:00Z', 'text': 'Reply', 'documents': ['a.pdf']}]}

    def test_events_come_from_the_dispute_and_their_keys_are_stable(self):
        from trato_api.dispute_history import dispute_events
        events = dispute_events(self.dispute)
        self.assertEqual([e['kind'] for e in events], ['dispute_opened', 'client_message', 'freelancer_message'])
        self.assertEqual(events[2]['details'], {'text': 'Reply', 'documents': ['a.pdf']})
        self.assertEqual([e['event_key'] for e in events], ['opened', 'message:0', 'message:1'])

    def test_escalation_review_and_resolution_are_milestones(self):
        from trato_api.dispute_history import dispute_events
        for change in ({'stage': 'CHARGEBACK', 'status': 'WAITING_FOR_SELLER_RESPONSE'}, {'stage': 'CHARGEBACK', 'status': 'UNDER_REVIEW'}, {'status': 'RESOLVED', 'outcome': 'RESOLVED_SELLER_FAVOUR'}):
            self.assertEqual(dispute_events({**self.dispute, **change})[-1]['kind'], 'dispute_status', change)
        self.assertNotEqual(dispute_events({**self.dispute, 'status': 'UNDER_REVIEW'})[-1]['kind'], 'dispute_status', 'a moment of review during the inquiry is not a milestone')

    def test_groups_are_added_newest_first_and_a_failed_save_is_reported(self):
        from trato_api.dispute_history import with_dispute_groups, dispute_activity, record_disputes
        rows = [{'id': '1', 'dispute_id': 'PP-R-1', 'kind': 'dispute_opened', 'details': {'reason': 'X'}, 'happened_at': '2026-11-08T06:00:00+00:00'},
                {'id': '2', 'dispute_id': 'PP-R-1', 'kind': 'client_message', 'details': {'text': 'Claim'}, 'happened_at': '2026-11-08T07:00:00+00:00'}]
        class History:
            def rows(self, table, params): return rows
            def rpc(self, name, params): raise ApiError('RPC_FAILED', 500)
        groups = with_dispute_groups(History(), PROJECT, [{'group_kind': 'project', 'group_id': 'p', 'last_at': '2026-11-01T00:00:00+00:00', 'event_count': 1}])
        self.assertEqual([g['group_kind'] for g in groups], ['dispute', 'project'])
        self.assertEqual((groups[0]['event_count'], groups[0]['last_at']), (2, '2026-11-08T07:00:00+00:00'))
        events = dispute_activity(History(), PROJECT, 'PP-R-1')
        self.assertEqual((events[1]['group_kind'], events[1]['group_id'], events[1]['text']), ('dispute', 'PP-R-1', 'Claim'))
        rows.insert(0, {'id': '0', 'dispute_id': 'PP-R-1', 'kind': 'client_message', 'details': {}, 'happened_at': '2026-11-08T06:00:00+00:00'})
        self.assertEqual(dispute_activity(History(), PROJECT, 'PP-R-1')[0]['kind'], 'dispute_opened', 'the opening goes first at the same time')
        self.assertFalse(record_disputes(History(), PROJECT, [self.dispute]))
