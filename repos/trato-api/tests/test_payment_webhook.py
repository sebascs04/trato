import json
import unittest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from trato_api.errors import ApiError
from trato_api.payment_webhook import PaymentWebhook, build_payment_webhook_router, order_id
from paypal.client import PayPalError

ORDER, TOKEN = '5O190127TN364715T', 'x' * 43


def event(kind='CHECKOUT.ORDER.APPROVED', order=ORDER):
    resource = {'id': order} if kind == 'CHECKOUT.ORDER.APPROVED' else {'id': '3C679366HH908993F', 'supplementary_data': {'related_ids': {'order_id': order}}}
    return json.dumps({'id': 'WH-1', 'event_type': kind, 'resource_type': 'checkout-order', 'resource': resource}).encode()


class PayPal:
    def __init__(self, valid=True, error=None): self.valid, self.error, self.checked = valid, error, 0
    def verify_webhook(self, headers, payload):
        self.checked += 1
        if self.error: raise self.error
        return self.valid


class Repo:
    def __init__(self, found=('proposal_payments',)): self.found, self.queries = found, []
    def rows(self, table, params):
        self.queries.append((table, params['order_id']))
        return [{'checkout_token': TOKEN}] if table in self.found else []


class Store:
    def __init__(self, repo): self.repo = repo


class Checkouts(dict):
    def __init__(self, fail=False):
        self.calls = []
        def run(kind):
            def confirm(token):
                self.calls.append((kind, token))
                if fail: raise ApiError('PAYPAL_REQUEST_FAILED', 503)
                return {'status': 'completed'}
            return confirm
        super().__init__(change=run('change'), initial=run('initial'))


def hook(paypal=None, repo=None, checkouts=None):
    return PaymentWebhook(None, paypal=paypal or PayPal(), store=Store(repo or Repo()), checkouts=checkouts if checkouts is not None else Checkouts())


class PaymentWebhookTests(unittest.TestCase):
    def test_approved_order_runs_the_same_checkout_as_verify_payment(self):
        checkouts, repo = Checkouts(), Repo()
        result = hook(repo=repo, checkouts=checkouts).receive(event(), {})
        self.assertEqual(result, {'received': True, 'applied': True, 'kind': 'change', 'status': 'completed'})
        self.assertEqual(checkouts.calls, [('change', TOKEN)])
        self.assertEqual(repo.queries[0], ('proposal_payments', 'eq.' + ORDER))

    def test_capture_events_use_the_related_order_and_find_initial_payments(self):
        checkouts = Checkouts()
        for kind in ('PAYMENT.CAPTURE.COMPLETED', 'PAYMENT.CAPTURE.PENDING', 'PAYMENT.CAPTURE.DENIED'):
            self.assertTrue(hook(repo=Repo(found=('project_initial_checkouts',)), checkouts=checkouts).receive(event(kind), {})['applied'])
        self.assertEqual(checkouts.calls, [('initial', TOKEN)] * 3)

    def test_bad_signature_is_rejected_before_any_lookup(self):
        repo, checkouts = Repo(), Checkouts()
        with self.assertRaises(ApiError) as caught:
            hook(paypal=PayPal(valid=False), repo=repo, checkouts=checkouts).receive(event(), {})
        self.assertEqual((caught.exception.code, caught.exception.status), ('INVALID_PAYPAL_SIGNATURE', 401))
        self.assertEqual((repo.queries, checkouts.calls), ([], []))

    def test_paypal_unavailable_while_verifying_is_a_retryable_error(self):
        with self.assertRaises(ApiError) as caught:
            hook(paypal=PayPal(error=PayPalError('PAYPAL_REQUEST_FAILED', status=503))).receive(event(), {})
        self.assertEqual(caught.exception.status, 503)

    def test_unknown_order_or_other_event_changes_nothing(self):
        checkouts = Checkouts()
        self.assertFalse(hook(repo=Repo(found=()), checkouts=checkouts).receive(event(), {})['applied'])
        self.assertFalse(hook(checkouts=checkouts).receive(event('CUSTOMER.DISPUTE.CREATED'), {})['applied'])
        self.assertFalse(hook(checkouts=checkouts).receive(event(order='not an order!'), {})['applied'])
        self.assertEqual(checkouts.calls, [])

    def test_failed_confirmation_asks_paypal_to_send_it_again(self):
        with self.assertRaises(ApiError) as caught:
            hook(checkouts=Checkouts(fail=True)).receive(event(), {})
        self.assertEqual((caught.exception.code, caught.exception.status), ('PAYMENT_WEBHOOK_PROCESSING_FAILED', 503))

    def test_malformed_body_is_rejected(self):
        with self.assertRaises(ApiError) as caught:
            hook().receive(b'{"id": "a", "id": "b", "event_type": "X"}', {})
        self.assertEqual(caught.exception.status, 422)

    def test_order_id_reads_only_paypal_shaped_ids(self):
        self.assertEqual(order_id({'event_type': 'CHECKOUT.ORDER.APPROVED', 'resource': {'id': ORDER}}), ORDER)
        self.assertIsNone(order_id({'event_type': 'PAYMENT.CAPTURE.COMPLETED', 'resource': {'supplementary_data': 'x'}}))

    def test_route(self):
        app = FastAPI()
        app.include_router(build_payment_webhook_router(None, webhook=hook()))
        response = TestClient(app).post('/api/v1/payments/webhooks/paypal', content=event())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers['cache-control'], 'no-store')
        self.assertTrue(response.json()['data']['applied'])


if __name__ == '__main__':
    unittest.main()


INVOICE_ID = 'INV2-XZSM-DRER-DW39-V8LQ'


def invoice_event(resource):
    return json.dumps({'id': 'WH-2', 'event_type': 'INVOICING.INVOICE.PAID', 'resource_type': 'invoices', 'resource': resource}).encode()


class InvoiceRepo:
    def __init__(self, rows): self.rows_found, self.queries = rows, []
    def rows(self, table, params):
        self.queries.append((table, params.get('invoice_id'), params.get('method')))
        return self.rows_found


class InvoicePaidTests(unittest.TestCase):
    def setUp(self):
        self.verified = []

    def receive(self, resource, rows, fail=False, paypal=None):
        def verify(pay):
            self.verified.append(pay['id'])
            if fail: raise ApiError('PAYPAL_REQUEST_FAILED', 503)
            return {**pay, 'status': 'completed'}
        repo = InvoiceRepo(rows)
        hook = PaymentWebhook(None, paypal=paypal or PayPal(), store=Store(repo), checkouts=Checkouts(), invoices=verify)
        return hook.receive(invoice_event(resource), {}), repo

    def test_paid_invoice_runs_the_same_verification_as_verify_payment(self):
        result, repo = self.receive({'id': INVOICE_ID, 'status': 'PAID'}, [{'id': 'pay'}])
        self.assertEqual(result, {'received': True, 'applied': True, 'kind': 'invoice', 'status': 'completed'})
        self.assertEqual(repo.queries, [('proposal_payments', 'eq.' + INVOICE_ID, 'eq.invoice')])
        self.assertEqual(self.verified, ['pay'])

    def test_nested_invoice_id_is_also_accepted(self):
        result, _ = self.receive({'invoice': {'id': INVOICE_ID}}, [{'id': 'pay'}])
        self.assertTrue(result['applied'])

    def test_unknown_or_malformed_invoice_changes_nothing(self):
        result, repo = self.receive({'id': INVOICE_ID}, [])
        self.assertEqual(result, {'received': True, 'applied': False})
        result, repo = self.receive({'id': 'INV2-../x'}, [{'id': 'pay'}])
        self.assertEqual((result['applied'], repo.queries), (False, []))
        self.assertEqual(self.verified, [])

    def test_bad_signature_is_rejected_before_any_lookup(self):
        with self.assertRaises(ApiError) as caught:
            self.receive({'id': INVOICE_ID}, [{'id': 'pay'}], paypal=PayPal(valid=False))
        self.assertEqual(caught.exception.status, 401)
        self.assertEqual(self.verified, [])

    def test_failed_verification_asks_paypal_to_retry(self):
        with self.assertRaises(ApiError) as caught:
            self.receive({'id': INVOICE_ID}, [{'id': 'pay'}], fail=True)
        self.assertEqual((caught.exception.code, caught.exception.status), ('PAYMENT_WEBHOOK_PROCESSING_FAILED', 503))
