import json
import unittest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from fastapi.responses import JSONResponse
from trato_api.dispute_webhook import DisputeWebhook, build_dispute_webhook_router
from trato_api.errors import ApiError

CAPTURE, PROJECT, OWNER, DISPUTE = '6YT21169SK952354J', '11111111-2222-4333-8444-555555555555', '22222222-2222-4333-8444-555555555555', 'PP-R-VHD-10197086'
PAYMENT = {'id': 'rp1', 'origin': 'change', 'capture_id': CAPTURE, 'amount_minor': 12000, 'currency': 'USD', 'verified_at': '2026-11-08T04:17:07Z',
           'proposal_payment_id': 'pp1', 'owner_id': OWNER, 'project_id': PROJECT}


def event(kind='CUSTOMER.DISPUTE.CREATED', dispute=DISPUTE):
    return {'id': 'WH-1', 'event_type': kind, 'resource_type': 'dispute', 'resource': {'dispute_id': dispute}}


class PayPal:
    client_id, webhook_id, merchant_id = 'app', 'listener', 'merchant'
    def __init__(self, signed=True): self.signed, self.read = signed, []
    def verify_webhook(self, headers, payload): return self.signed
    def get_dispute(self, dispute_id):
        self.read.append(dispute_id)
        return {'dispute_id': dispute_id, 'status': 'WAITING_FOR_SELLER_RESPONSE', 'dispute_life_cycle_stage': 'INQUIRY', 'create_time': '2026-11-08T06:09:01Z',
                'disputed_transactions': [{'seller_transaction_id': CAPTURE}], 'messages': [{'posted_by': 'BUYER', 'time_posted': '2026-11-08T06:09:01Z', 'content': 'Not as described.'}]}


class Store:
    def __init__(self, known=True, seen=False, fail=None): self.known, self.seen, self.fail, self.calls, self.records = known, seen, fail, [], []
    def webhook(self, action, data):
        self.calls.append(action)
        if action == 'claim': return {'duplicate': True} if self.seen else {'id': 'c', 'claim_id': 'k'}
        if action == 'lookup': return {'found': True, 'payment': PAYMENT} if self.known else {'found': False}
        if action == 'finish': self.finished = data['status']; return {'recorded': True}
    def record(self, *args):
        if self.fail: raise self.fail
        self.records.append(args)


class Finance:
    def __init__(self, paypal, store): self.paypal, self.store = paypal, store
    def provider(self, *, webhook=False): return self.paypal
    def backend(self): return self.store


class Reader:
    def __init__(self, paypal): self.paypal = paypal
    def provider(self): return self.paypal


class DisputeWebhookTests(unittest.TestCase):
    def setUp(self):
        self.paypal, self.store = PayPal(), Store()

    def client(self):
        app = FastAPI()
        app.include_router(build_dispute_webhook_router(None, finance=Finance(self.paypal, self.store), reader=Reader(self.paypal)))
        @app.exception_handler(ApiError)
        async def failed(request, error): return JSONResponse({'error': {'code': error.code}}, status_code=error.status)
        return TestClient(app)

    def post(self, payload=None):
        return self.client().post('/api/v1/disputes/webhooks/paypal', content=json.dumps(payload or event()))

    def test_a_signed_event_saves_what_paypal_reports_for_the_project_of_the_payment(self):
        self.assertEqual(self.post().status_code, 200)
        self.assertEqual(self.paypal.read, [DISPUTE], 'facts come from reading the dispute back')
        owner, project, dispute, events = self.store.records[0]
        self.assertEqual((owner, project, dispute), (OWNER, PROJECT, DISPUTE))
        self.assertEqual([e['kind'] for e in events], ['dispute_opened', 'client_message'])
        self.assertEqual(self.store.finished, 'processed')

    def test_an_unsigned_event_touches_nothing(self):
        self.paypal = PayPal(signed=False)
        self.assertEqual(self.post().status_code, 401)
        self.assertEqual((self.store.calls, self.paypal.read, self.store.records), ([], [], []))

    def test_a_repeated_event_is_not_processed_again(self):
        self.store = Store(seen=True)
        self.assertEqual(self.post().json()['data'], {'received': True, 'duplicate': True})
        self.assertEqual((self.paypal.read, self.store.records), ([], []))

    def test_a_dispute_on_an_unknown_payment_is_ignored(self):
        self.store = Store(known=False)
        self.assertEqual(self.post().status_code, 200)
        self.assertEqual((self.store.records, self.store.finished), ([], 'ignored'))

    def test_other_events_and_malformed_ids_read_nothing_from_paypal(self):
        for payload in (event('PAYMENT.CAPTURE.COMPLETED'), event(dispute='../etc'), {**event(), 'resource': 'x'}):
            self.paypal, self.store = PayPal(), Store()
            self.client().post('/api/v1/disputes/webhooks/paypal', content=json.dumps(payload))
            self.assertEqual((self.paypal.read, self.store.records), ([], []), payload)

    def test_a_failed_save_asks_paypal_to_try_again(self):
        self.store = Store(fail=ApiError('PERSISTENCE_UNAVAILABLE', 503))
        self.assertEqual(self.post().status_code, 503)
        self.assertEqual(self.store.finished, 'retryable')

    def test_the_refund_webhook_is_not_changed(self):
        from trato_api.refunds.webhook import EVENTS as REFUND_EVENTS
        self.assertFalse(REFUND_EVENTS & {'CUSTOMER.DISPUTE.CREATED', 'CUSTOMER.DISPUTE.UPDATED', 'CUSTOMER.DISPUTE.RESOLVED'})
