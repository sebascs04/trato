import json
import unittest

from paypal.client import PayPalError
from trato_api.errors import ApiError
from trato_api.payment_detective import LIMIT, PAYMENTS_TOOL, payments_source

OWNER, PROJECT = 'owner-a', {'id': 'project-a'}


class Repo:
    def __init__(self, changes=(), stages=()):
        self.tables = {'proposal_payments': list(changes), 'project_initial_checkouts': list(stages),
                       'proposal_revisions': [{'id': 'rev', 'revision_no': 2}], 'project_start_stages': [{'position': 1, 'title': 'Design'}]}
        self.calls = []

    def rows(self, table, params):
        self.calls.append((table, params))
        return self.tables[table]


class Toolkit:
    def __init__(self, fail=None): self.fail, self.orders = fail, []
    def get_order(self, order_id):
        self.orders.append(order_id)
        if self.fail == 'order': raise PayPalError('PAYPAL_UNAVAILABLE', status=503)
        return {'message': 'The PayPal order has been successfully captured.', 'status': 'PAYER_ACTION_REQUIRED',
                'raw': {'create_time': '2026-11-08T10:00:00Z', 'update_time': '2026-11-08T11:00:00Z', 'id': order_id,
                        'payment_source': {'paypal': {'email_address': 'buyer@example.com'}}}}
    def list_disputes(self, capture_id):
        return {'items': [{'dispute_id': 'PP-R-1', 'status': 'OPEN', 'reason': 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED'}]}


class Client:
    def get_capture(self, capture_id):
        return {'id': capture_id, 'status': 'PENDING', 'status_details': {'reason': 'PENDING_REVIEW'}, 'seller_protection': {'status': 'ELIGIBLE'}, 'update_time': 'later'}


class Reader:
    def __init__(self, toolkit=None): self.toolkit = toolkit or Toolkit()
    def provider(self): return self.toolkit
    def writer(self): return Client()


def change(**extra):
    return {'proposal_id': 'prop', 'revision_id': 'rev', 'amount_minor': 12000, 'currency': 'USD', 'status': 'pending_approval', 'order_id': 'ORDER1234', 'capture_id': None, 'created_at': '2026-11-08', 'updated_at': '2026-11-08', **extra}


def stage(**extra):
    return {'stage_position': 1, 'amount_minor': 18000, 'currency': 'USD', 'status': 'created', 'order_id': None, 'capture_id': None, 'created_at': '2026-11-07', 'updated_at': '2026-11-07', 'paid_at': None, **extra}


class PaymentDetectiveTests(unittest.TestCase):
    def read(self, repo, reader=None):
        record = payments_source(repo, OWNER, PROJECT, reader or Reader())
        return record, json.loads(record['text'])

    def test_the_toolkit_message_that_claims_a_capture_never_reaches_the_agent(self):
        record, value = self.read(Repo([change()]))
        self.assertEqual(value['payments'][0]['order']['status'], 'PAYER_ACTION_REQUIRED')
        self.assertNotIn('successfully captured', record['text'])
        self.assertFalse(value['payments'][0]['order']['client_approved_in_paypal'])

    def test_no_identifiers_or_emails_reach_the_agent(self):
        record, _ = self.read(Repo([change(capture_id='CAPTURE12')]))
        for hidden in ('ORDER1234', 'CAPTURE12', 'buyer@example.com', 'PP-R-1', 'prop', 'owner-a'):
            self.assertNotIn(hidden, record['text'])

    def test_capture_reason_and_disputes_are_reported_from_paypal(self):
        _, value = self.read(Repo([change(capture_id='CAPTURE12', status='pending')]))
        payment = value['payments'][0]
        self.assertEqual(payment['capture'], {'status': 'PENDING', 'reason': 'PENDING_REVIEW', 'seller_protection': 'ELIGIBLE', 'updated_at': 'later'})
        self.assertEqual(payment['disputes'], [{'status': 'OPEN', 'reason': 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED'}])
        self.assertEqual(payment['for'], {'kind': 'addendum', 'version': 2})

    def test_a_failed_read_stays_visible_and_is_never_a_state(self):
        _, value = self.read(Repo([change()]), Reader(Toolkit(fail='order')))
        payment = value['payments'][0]
        self.assertIsNone(payment['order'])
        self.assertEqual(payment['paypal_errors'], [{'read': 'order', 'code': 'PAYPAL_UNAVAILABLE'}])

    def test_a_payment_without_an_order_asks_paypal_nothing(self):
        toolkit = Toolkit()
        _, value = self.read(Repo(stages=[stage()]), Reader(toolkit))
        self.assertEqual(toolkit.orders, [])
        self.assertFalse(value['payments'][0]['paypal_order_created'])
        self.assertEqual(value['payments'][0]['for'], {'kind': 'deliverable', 'number': 1, 'title': 'Design'})

    def test_every_read_is_scoped_to_the_owner_and_project(self):
        repo = Repo([change()], [stage()])
        self.read(repo)
        for table, params in repo.calls:
            self.assertEqual(params['owner_id'], 'eq.owner-a', table)
            self.assertEqual(params['project_id'], 'eq.project-a', table)

    def test_a_project_without_payments_does_not_call_paypal(self):
        class Fails:
            def provider(self): raise AssertionError('PayPal must not be called')
            writer = provider
        record = payments_source(Repo(), OWNER, PROJECT, Fails())
        self.assertEqual(json.loads(record['text'])['payments'], [])

    def test_newest_payments_first_and_bounded(self):
        rows = [change(created_at=f'2026-11-{day:02d}') for day in range(1, LIMIT + 5)]
        _, value = self.read(Repo(rows))
        self.assertEqual(len(value['payments']), LIMIT)
        self.assertEqual(value['payments'][0]['requested_at'], f'2026-11-{LIMIT + 4:02d}')

    def test_the_tool_takes_no_parameters(self):
        self.assertEqual(PAYMENTS_TOOL['parameters']['properties'], {})
        self.assertEqual(PAYMENTS_TOOL['parameters']['required'], [])
