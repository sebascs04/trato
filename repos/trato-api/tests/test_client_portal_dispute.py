import unittest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from fastapi.responses import JSONResponse
from hashlib import sha256
from trato_api.client_portal import build_client_portal_router
from trato_api.disputes import DisputeReader
from trato_api.errors import ApiError
from test_disputes import PayPal, CAPTURE

TOKEN = 'a' * 64
REVISION = '11111111-2222-4333-8444-555555555555'


class Store:
    def __init__(self, payment_status): self.payment_status = payment_status; self.captures = 0
    def view(self, digest): return {'revision_id': REVISION, 'payment_status': self.payment_status}
    def capture(self, revision_id): self.captures += 1; return CAPTURE


class Listing(PayPal):
    def list_disputes(self, capture): self.listed.append(capture); return {'items': [{'dispute_id': 'PP-R-VHD-10197086'}]}


class PortalDisputeTests(unittest.TestCase):
    def client(self, store, paypal, token_hash=None):
        app = FastAPI()
        app.include_router(build_client_portal_router(None, store, disputes=DisputeReader(paypal)))
        @app.exception_handler(ApiError)
        async def error(_, e): return JSONResponse({'error': {'code': e.code}}, status_code=e.status)
        return TestClient(app)

    def test_paid_addendum_shows_its_dispute_by_link(self):
        paypal = Listing()
        body = self.client(Store('completed'), paypal).post('/api/v1/portal/dispute', json={'token': TOKEN}).json()['data']
        self.assertEqual(body['dispute_id'], 'PP-R-VHD-10197086')
        self.assertEqual(paypal.listed, [CAPTURE])

    def test_unpaid_addendum_never_asks_paypal(self):
        store, paypal = Store(None), Listing()
        self.assertIsNone(self.client(store, paypal).post('/api/v1/portal/dispute', json={'token': TOKEN}).json()['data'])
        self.assertEqual((paypal.listed, store.captures), ([], 0))

    def test_client_previews_an_attachment_of_its_own_dispute(self):
        class Docs(Listing):
            def get_dispute(_, dispute_id):
                return {**PayPal.get_dispute(_, dispute_id), 'messages': [{'posted_by': 'SELLER', 'content': 'x', 'documents': [{'name': 'a.pdf', 'url': 'https://api-m.sandbox.paypal.com/v1/customer/disputes/x/doc'}]}]}
            def fetch_dispute_document(_, url): return b'%PDF-1.', 'application/pdf'
        client = self.client(Store('completed'), Docs())
        post = lambda **body: client.post('/api/v1/portal/dispute-document', json={'token': TOKEN, **body})
        self.assertEqual(post(message=0, document=0).content, b'%PDF-1.')
        self.assertEqual(post(message=9, document=0).status_code, 404)
        self.assertEqual(post(message='0', document=0).status_code, 404)
        unpaid = self.client(Store(None), Docs()).post('/api/v1/portal/dispute-document', json={'token': TOKEN, 'message': 0, 'document': 0})
        self.assertEqual(unpaid.status_code, 404)

    def test_an_invalid_link_gets_nothing(self):
        paypal = Listing()
        self.assertEqual(self.client(Store('completed'), paypal).post('/api/v1/portal/dispute', json={'token': 'short'}).status_code, 404)
        self.assertEqual(paypal.listed, [])


class AccountDisputeTests(unittest.TestCase):
    def client(self, paypal, user='client-1'):
        class AccountStore:
            def __init__(self): self.links = []
            def agreements(_, owner):
                return [{'proposal_id': 'paid-1', 'payment_status': 'completed'}, {'proposal_id': 'open-1', 'payment_status': None}]
            def link_hash(s, owner, proposal_id): s.links.append((owner, proposal_id)); return 'digest'
            def view(_, digest): return {'revision_id': REVISION, 'payment_status': 'completed'}
            def capture(_, revision_id): return CAPTURE
        self.store = AccountStore()
        app = FastAPI()
        app.include_router(build_client_portal_router(None, self.store, require_user=lambda: user, disputes=DisputeReader(paypal)))
        return TestClient(app)

    def test_only_paid_agreements_of_this_account_are_checked(self):
        data = self.client(Listing()).get('/api/v1/portal/account/disputes').json()['data']
        self.assertEqual(self.store.links, [('client-1', 'paid-1')])
        self.assertEqual(data, {'paid-1': {'dispute_id': 'PP-R-VHD-10197086', 'status': 'WAITING_FOR_SELLER_RESPONSE', 'reason': 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED', 'outcome': None}})

    def test_without_disputes_the_answer_is_empty(self):
        class Empty(PayPal):
            def list_disputes(self, capture): return {'items': []}
        self.assertEqual(self.client(Empty()).get('/api/v1/portal/account/disputes').json()['data'], {})
