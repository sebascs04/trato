import os
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from trato_api.app import create_app
from trato_api.client_portal import paypal_order_id
from test_client_portal import TOKEN, REVISION, Payments, PortalStoreWithContext

CHECKOUT = 'c' * 43
ORDER = '5O190127TN364715T'


class CapturingPayments(Payments):
    def checkout(self, token, capture=False):
        self.calls.append(('checkout', token, capture))
        return {'status': 'completed'}


class PayPalButtonsTests(unittest.TestCase):
    """PayPal's own buttons open the order Trato already created; the server still captures and verifies."""

    def client(self, store, payments):
        from trato_api.client_portal import build_client_portal_router
        app = create_app()
        app.router.routes = [r for r in app.router.routes if not getattr(r, 'path', '').startswith('/api/v1/portal')]
        app.include_router(build_client_portal_router(None, store, payments))
        return TestClient(app)

    def test_only_a_well_formed_order_id_reaches_the_page(self):
        self.assertEqual(paypal_order_id(ORDER), ORDER)
        for bad in (None, '', 'abc', ORDER + '"><script>', 'https://evil.example'):
            self.assertIsNone(paypal_order_id(bad))

    def test_pay_adds_the_order_id_for_the_buttons(self):
        payments = Payments({'status': 'pending_approval', 'order_id': ORDER,
                             'approval_url': 'https://www.sandbox.paypal.com/checkoutnow?token=' + ORDER})
        with self.client(PortalStoreWithContext('accepted'), payments) as client:
            data = client.post('/api/v1/portal/pay', json={'token': TOKEN}).json()['data']
        self.assertEqual(data['order_id'], ORDER)

    def test_capture_uses_the_server_side_checkout_token_and_never_returns_it(self):
        payments = CapturingPayments({'status': 'approved', 'order_id': ORDER, 'checkout_token': CHECKOUT})
        with self.client(PortalStoreWithContext('accepted'), payments) as client:
            response = client.post('/api/v1/portal/pay-capture', json={'token': TOKEN})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(payments.calls, [('owner', 'proposal', REVISION), ('checkout', CHECKOUT, True)])
        self.assertNotIn(CHECKOUT, response.text)

    def test_capture_needs_an_accepted_addendum_and_a_known_payment(self):
        payments = CapturingPayments({'status': 'approved', 'checkout_token': CHECKOUT})
        with self.client(PortalStoreWithContext('ready_for_review'), payments) as client:
            self.assertEqual(client.post('/api/v1/portal/pay-capture', json={'token': TOKEN}).status_code, 409)
        self.assertEqual(payments.calls, [])
        missing = CapturingPayments({'status': 'approved'})
        with self.client(PortalStoreWithContext('accepted'), missing) as client:
            self.assertEqual(client.post('/api/v1/portal/pay-capture', json={'token': TOKEN}).status_code, 409)

    def test_sdk_config_gives_only_the_public_client_id_in_sandbox(self):
        env = {'PAYPAL_CLIENT_ID': 'A' * 80, 'PAYPAL_CLIENT_SECRET': 'never-sent-to-the-page', 'PAYPAL_ENVIRONMENT': 'sandbox'}
        with patch.dict(os.environ, env), self.client(PortalStoreWithContext('accepted'), None) as client:
            response = client.get('/api/v1/portal/paypal-sdk')
        self.assertEqual(response.json()['data'], {'client_id': 'A' * 80, 'currency': 'USD', 'environment': 'sandbox'})
        self.assertNotIn('never-sent', response.text)
        with patch.dict(os.environ, {'PAYPAL_CLIENT_ID': ''}), self.client(PortalStoreWithContext('accepted'), None) as client:
            self.assertEqual(client.get('/api/v1/portal/paypal-sdk').status_code, 503)


if __name__ == '__main__':
    unittest.main()
