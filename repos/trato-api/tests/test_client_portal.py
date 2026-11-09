from hashlib import sha256
import unittest

from fastapi.testclient import TestClient

from trato_api.app import create_app
from trato_api.errors import ApiError

TOKEN = 'a' * 64
REVISION = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
PDF = b'%PDF-portal-test'
PDF_SHA = sha256(PDF).hexdigest()


class Store:
    def __init__(self, status='ready_for_review'):
        self.calls = []
        self.status = status

    def view(self, digest):
        self.calls.append(('view', digest))
        if digest != sha256(TOKEN.encode()).hexdigest():
            raise ApiError('PORTAL_LINK_NOT_FOUND', 404)
        return {'link_id': 'internal-link', 'owner_id': 'internal-owner', 'proposal_id': 'internal-proposal',
                'project_name': 'Proyecto', 'client_name': 'Cliente', 'revision_id': REVISION, 'revision_no': 1,
                'is_current': True, 'scope_summary': 'Un video', 'conditions': '', 'currency': 'USD',
                'additional_minor': 1000, 'deadline': '2026-11-20', 'addendum_document_id': 'internal-doc',
                'addendum_sha256': PDF_SHA, 'status': self.status, 'accepted_at': None, 'expires_at': '2026-12-07',
                'payment_required': True, 'payment_status': None}

    def accept(self, digest, revision, addendum):
        self.calls.append(('accept', digest, revision, addendum))
        self.status = 'accepted'
        return {'acceptance_id': 'acc'}

    def document(self, view):
        self.calls.append(('document', view['addendum_document_id']))
        return {'sha256': PDF_SHA}, PDF


class ClientPortalRouteTests(unittest.TestCase):
    def client(self, store):
        app = create_app()
        app.router.routes = [r for r in app.router.routes if not getattr(r, 'path', '').startswith('/api/v1/portal')]
        from trato_api.client_portal import build_client_portal_router
        app.include_router(build_client_portal_router(None, store))
        return TestClient(app)

    def test_view_hashes_the_token_and_hides_internal_ids(self):
        store = Store()
        with self.client(store) as client:
            response = client.post('/api/v1/portal/view', json={'token': TOKEN})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers['cache-control'], 'no-store')
        data = response.json()['data']
        self.assertEqual(data['revision_id'], REVISION)
        for hidden in ('link_id', 'owner_id', 'proposal_id', 'addendum_document_id'):
            self.assertNotIn(hidden, data)
        self.assertEqual(store.calls, [('view', sha256(TOKEN.encode()).hexdigest())])

    def test_malformed_or_unknown_tokens_are_not_found_without_backend_call_for_malformed(self):
        store = Store()
        with self.client(store) as client:
            for bad in ('', 'x' * 64, 'A' * 64, None, 5):
                self.assertEqual(client.post('/api/v1/portal/view', json={'token': bad}).status_code, 404)
            self.assertEqual(store.calls, [])
            self.assertEqual(client.post('/api/v1/portal/view', json={'token': 'b' * 64}).status_code, 404)

    def test_document_is_served_only_when_it_matches_the_reviewed_hash(self):
        store = Store()
        with self.client(store) as client:
            ok = client.post('/api/v1/portal/document', json={'token': TOKEN})
            self.assertEqual(ok.status_code, 200)
            self.assertEqual(ok.content, PDF)
            self.assertEqual(ok.headers['content-type'], 'application/pdf')
            store.document = lambda view: ({'sha256': PDF_SHA}, b'%PDF-tampered')
            self.assertEqual(client.post('/api/v1/portal/document', json={'token': TOKEN}).status_code, 409)

    def test_accept_requires_revision_and_pdf_hash_and_returns_updated_view(self):
        store = Store()
        with self.client(store) as client:
            self.assertEqual(client.post('/api/v1/portal/accept', json={'token': TOKEN, 'revision_id': 'bad', 'addendum_sha256': PDF_SHA}).status_code, 422)
            self.assertEqual(client.post('/api/v1/portal/accept', json={'token': TOKEN, 'revision_id': REVISION, 'addendum_sha256': 'x'}).status_code, 422)
            self.assertFalse([c for c in store.calls if c[0] == 'accept'])
            response = client.post('/api/v1/portal/accept', json={'token': TOKEN, 'revision_id': REVISION, 'addendum_sha256': PDF_SHA})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['data']['status'], 'accepted')
        self.assertIn(('accept', sha256(TOKEN.encode()).hexdigest(), REVISION, PDF_SHA), store.calls)


class Payments:
    def __init__(self, result):
        self.calls = []
        self.result = result

    def create_payment(self, owner, proposal, revision):
        self.calls.append((owner, proposal, revision))
        return self.result


class PortalStoreWithContext(Store):
    def payment_context(self, digest):
        self.calls.append(('context', digest))
        return {'owner_id': 'owner', 'proposal_id': 'proposal', 'revision_id': REVISION}


class ClientPortalPaymentTests(unittest.TestCase):
    def client(self, store, payments):
        from trato_api.client_portal import build_client_portal_router
        app = create_app()
        app.router.routes = [r for r in app.router.routes if not getattr(r, 'path', '').startswith('/api/v1/portal')]
        app.include_router(build_client_portal_router(None, store, payments))
        return TestClient(app)

    def test_pay_requires_acceptance_before_any_payment_call(self):
        payments = Payments({'status': 'pending_approval', 'approval_url': 'https://www.sandbox.paypal.com/checkoutnow?token=X'})
        with self.client(PortalStoreWithContext('ready_for_review'), payments) as client:
            self.assertEqual(client.post('/api/v1/portal/pay', json={'token': TOKEN}).status_code, 409)
        self.assertEqual(payments.calls, [])

    def test_pay_reuses_owner_payment_and_returns_only_sandbox_checkout(self):
        payments = Payments({'status': 'pending_approval', 'approval_url': 'https://www.sandbox.paypal.com/checkoutnow?token=X'})
        with self.client(PortalStoreWithContext('accepted'), payments) as client:
            response = client.post('/api/v1/portal/pay', json={'token': TOKEN})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['data'], {'status': 'pending_approval', 'approval_url': 'https://www.sandbox.paypal.com/checkoutnow?token=X'})
        self.assertEqual(payments.calls, [('owner', 'proposal', REVISION)])

    def test_pay_rejects_non_paypal_redirects_and_reports_completed(self):
        with self.client(PortalStoreWithContext('accepted'), Payments({'status': 'pending_approval', 'approval_url': 'https://evil.example/pay'})) as client:
            self.assertEqual(client.post('/api/v1/portal/pay', json={'token': TOKEN}).status_code, 409)
        with self.client(PortalStoreWithContext('accepted'), Payments({'status': 'completed'})) as client:
            self.assertEqual(client.post('/api/v1/portal/pay', json={'token': TOKEN}).json()['data'], {'status': 'completed'})


class AccountStore(Store):
    def saved(self, digest, user):
        self.calls.append(('saved', user)); return False

    def claim(self, digest, user):
        self.calls.append(('claim', digest, user)); return {'saved': True}

    def agreements(self, user):
        self.calls.append(('agreements', user)); return [{'proposal_id': 'p1', 'project_name': 'Proyecto'}]

    def link_hash(self, user, proposal):
        self.calls.append(('link_hash', user, proposal))
        if user != 'client-user':
            raise ApiError('AGREEMENT_NOT_FOUND', 404)
        return sha256(TOKEN.encode()).hexdigest()


class Auth:
    def authenticate(self, token):
        if token != 'Bearer client':
            raise ApiError('UNAUTHORIZED', 401)
        return 'client-user'


class ClientAccountRouteTests(unittest.TestCase):
    def client(self, store):
        from trato_api.client_portal import build_client_portal_router
        app = create_app()
        app.router.routes = [r for r in app.router.routes if not getattr(r, 'path', '').startswith('/api/v1/portal')]
        def require_user(request: __import__('fastapi').Request):
            return Auth().authenticate(request.headers.get('authorization', ''))
        app.include_router(build_client_portal_router(None, store, None, require_user))
        return TestClient(app)

    def test_account_routes_require_a_session_before_touching_the_store(self):
        store = AccountStore()
        with self.client(store) as client:
            self.assertEqual(client.get('/api/v1/portal/account/agreements').status_code, 401)
            self.assertEqual(client.post(f'/api/v1/portal/account/agreements/{REVISION}/view', json={}).status_code, 401)
        self.assertEqual(store.calls, [])

    def test_agreement_opens_with_session_through_the_same_view(self):
        store = AccountStore()
        with self.client(store) as client:
            auth = {'Authorization': 'Bearer client'}
            self.assertEqual(client.get('/api/v1/portal/account/agreements', headers=auth).json()['data'][0]['proposal_id'], 'p1')
            view = client.post(f'/api/v1/portal/account/agreements/{REVISION}/view', json={}, headers=auth)
            self.assertEqual(client.post('/api/v1/portal/account/agreements/not-a-uuid/view', json={}, headers=auth).status_code, 422)
        self.assertEqual(view.status_code, 200)
        self.assertNotIn('link_id', view.json()['data'])
        self.assertIn(('link_hash', 'client-user', REVISION), store.calls)


class ChangeStore(Store):
    def request_changes(self, digest, notes):
        self.calls.append(('request_changes', digest, notes))


class ClientPortalChangeRequestTests(unittest.TestCase):
    def client(self, store):
        from trato_api.client_portal import build_client_portal_router
        app = create_app()
        app.router.routes = [r for r in app.router.routes if not getattr(r, 'path', '').startswith('/api/v1/portal')]
        app.include_router(build_client_portal_router(None, store))
        return TestClient(app)

    def test_request_changes_requires_notes_and_stores_trimmed_text(self):
        store = ChangeStore()
        with self.client(store) as client:
            for bad in ('', '   ', None, 'x' * 4001):
                self.assertEqual(client.post('/api/v1/portal/request-changes', json={'token': TOKEN, 'notes': bad}).status_code, 422)
            self.assertFalse([c for c in store.calls if c[0] == 'request_changes'])
            ok = client.post('/api/v1/portal/request-changes', json={'token': TOKEN, 'notes': '  Two more rounds, please. '})
        self.assertEqual(ok.status_code, 200)
        self.assertIn(('request_changes', sha256(TOKEN.encode()).hexdigest(), 'Two more rounds, please.'), store.calls)


class ReviseModelTests(unittest.TestCase):
    def test_portal_request_is_valid_client_feedback(self):
        from trato_api.proposals.routes import Revise
        base = {'expected_revision_id': REVISION, 'source_document_ids': [REVISION, REVISION], 'feedback_notes': 'x',
                'terms': {'scope_summary': 's', 'conditions': '', 'currency': 'USD', 'deadline': '2026-12-01',
                          'line_items': [{'description': 'd', 'quantity': 1, 'unit_amount_minor': 100}]}}
        self.assertEqual(str(Revise.model_validate({**base, 'feedback_portal_request_id': REVISION}).feedback_portal_request_id), REVISION)
        with self.assertRaises(Exception):
            Revise.model_validate(base)


if __name__ == '__main__':
    unittest.main()
