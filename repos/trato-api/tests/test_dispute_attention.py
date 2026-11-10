import unittest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from trato_api.disputes import DisputeReader, build_dispute_router
from trato_api.errors import ApiError

PROJECT = '11111111-2222-4333-8444-555555555555'
OTHER_PROJECT = '99999999-2222-4333-8444-555555555555'
CAPTURE, CLOSED_CAPTURE, ORPHAN_CAPTURE = '6YT21169SK952354J', '6VS08203YW693662A', '1AB23456CD789012E'


def dispute(dispute_id, capture, status='WAITING_FOR_SELLER_RESPONSE', due='2026-11-28T06:09:01.643Z', links=('send_message',)):
    return {'dispute_id': dispute_id, 'reason': 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED', 'status': status, 'dispute_life_cycle_stage': 'INQUIRY',
            'dispute_amount': {'currency_code': 'USD', 'value': '120.00'}, 'seller_response_due_date': due,
            'disputed_transactions': [{'seller_transaction_id': capture}], 'create_time': '2026-11-08T06:09:01Z',
            'messages': [{'posted_by': 'BUYER', 'time_posted': '2026-11-08T06:09:01Z', 'content': 'Not as described.'}],
            'links': [{'rel': rel} for rel in links]}


class Repo:
    def __init__(self, payments=None, fail_history=False):
        self.recorded, self.fail_history, self.queries = [], fail_history, []
        self.payments = payments if payments is not None else [
            {'id': 'rp1', 'project_id': PROJECT, 'origin': 'change', 'capture_id': CAPTURE, 'amount_minor': 12000, 'currency': 'USD', 'proposal_payment_id': 'pp1'},
            {'id': 'rp2', 'project_id': PROJECT, 'origin': 'change', 'capture_id': CLOSED_CAPTURE, 'amount_minor': 100, 'currency': 'USD', 'proposal_payment_id': 'pp2'},
            {'id': 'rp3', 'project_id': OTHER_PROJECT, 'origin': 'change', 'capture_id': ORPHAN_CAPTURE, 'amount_minor': 100, 'currency': 'USD'},
            {'id': 'rp4', 'project_id': PROJECT, 'origin': 'initial', 'capture_id': None, 'amount_minor': 1000, 'currency': 'USD'}]

    def rows(self, table, params):
        self.queries.append((table, params))
        if table == 'project_received_payments':
            return self.payments
        if table == 'projects':
            # OTHER_PROJECT was deleted: RLS and deleted_at hide it.
            return [{'id': PROJECT, 'client_id': 'client-1', 'name': 'Café Aurora Website'}]
        raise AssertionError(table)

    def rpc(self, name, params):
        if self.fail_history:
            raise ApiError('PERSISTENCE_UNAVAILABLE', 503)
        self.recorded.append((name, params['p_project'], params['p_dispute']))
        return 1


class PayPal:
    def __init__(self):
        self.listed, self.read = [], []

    def list_disputes(self, capture):
        self.listed.append(capture)
        if capture == CAPTURE:
            return {'items': [{'dispute_id': 'PP-R-VHD-10197086', 'status': 'WAITING_FOR_SELLER_RESPONSE'}, {'dispute_id': 'PP-R-ELSE-1'}]}
        return {'items': [{'dispute_id': 'PP-R-FSH-10197362', 'status': 'RESOLVED'}]}

    def get_dispute(self, dispute_id):
        self.read.append(dispute_id)
        return dispute(dispute_id, CAPTURE if dispute_id == 'PP-R-VHD-10197086' else 'SOMEONEELSE123')


class OpenDisputesTests(unittest.TestCase):
    def test_lists_only_open_disputes_on_this_freelancers_live_projects(self):
        paypal, repo = PayPal(), Repo()
        data = DisputeReader(paypal).open_disputes(repo)
        self.assertEqual(sorted(paypal.listed), sorted([CAPTURE, CLOSED_CAPTURE]))  # The deleted project's payment is never sent to PayPal.
        self.assertNotIn('PP-R-FSH-10197362', paypal.read)  # Already resolved in the listing: not read again.
        self.assertEqual([d['dispute_id'] for d in data['disputes']], ['PP-R-VHD-10197086'])  # The other transaction's dispute is dropped.
        item = data['disputes'][0]
        self.assertEqual((item['project_id'], item['project_name'], item['client_id'], item['your_turn']), (PROJECT, 'Café Aurora Website', 'client-1', True))
        self.assertEqual(item['amount'], {'value': '120.00', 'currency': 'USD'})
        self.assertNotIn('messages', item)
        self.assertEqual(data['payments_checked'], 2)
        self.assertTrue(data['history_saved'])
        self.assertEqual(repo.recorded, [('record_dispute_events', PROJECT, 'PP-R-VHD-10197086')])

    def test_no_payments_means_no_paypal_call(self):
        class Untouchable:
            def __getattr__(self, name): raise AssertionError('PayPal was called')
        self.assertEqual(DisputeReader(Untouchable()).open_disputes(Repo(payments=[])), {'payments_checked': 0, 'disputes': []})

    def test_history_failure_still_returns_the_warning(self):
        data = DisputeReader(PayPal()).open_disputes(Repo(fail_history=True))
        self.assertFalse(data['history_saved'])
        self.assertEqual(len(data['disputes']), 1)

    def test_waiting_for_the_client_is_not_the_freelancers_turn(self):
        class Waiting(PayPal):
            def get_dispute(self, dispute_id):
                return dispute(dispute_id, CAPTURE, status='WAITING_FOR_BUYER_RESPONSE')
        self.assertFalse(DisputeReader(Waiting()).open_disputes(Repo())['disputes'][0]['your_turn'])

    def test_a_just_opened_dispute_is_the_freelancers_turn(self):
        class Opened(PayPal):
            def get_dispute(self, dispute_id):
                return dispute(dispute_id, CAPTURE, status='OPEN')
        self.assertTrue(DisputeReader(Opened()).open_disputes(Repo())['disputes'][0]['your_turn'])

    def test_route_requires_the_user_and_does_not_cache(self):
        app = FastAPI()
        app.include_router(build_dispute_router(None, lambda: 'owner', lambda *_: Repo(), DisputeReader(PayPal()), jobs=object(), preferences=object()))
        response = TestClient(app).get('/api/v1/disputes/attention', headers={'authorization': 'Bearer x'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers['cache-control'], 'no-store')
        self.assertEqual(response.json()['data']['disputes'][0]['dispute_id'], 'PP-R-VHD-10197086')


if __name__ == '__main__':
    unittest.main()
