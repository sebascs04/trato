"""The client asks for a refund from their space; the freelancer registers it in Refunds. A request never moves money."""
import unittest
from types import SimpleNamespace

from trato_api.errors import ApiError
from trato_api import client_refund_requests as module

PROJECT = '11111111-1111-4111-8111-111111111111'
PROPOSAL = '33333333-3333-4333-8333-333333333333'
REQUEST = '44444444-4444-4444-8444-444444444444'
SETTLEMENT = '55555555-5555-4555-8555-555555555555'


class ClientRouteTest(unittest.TestCase):
    def client(self):
        from fastapi import Request
        from fastapi.testclient import TestClient
        from trato_api.app import create_app
        from trato_api.client_portal import build_client_portal_router
        calls = self.calls = []

        class Store:
            def refund_request(self, user, project, stage, proposal, amount, reason):
                calls.append((user, project, stage, proposal, amount, reason))

            def refund_requests(self, user):
                return [{'id': REQUEST, 'project_id': PROJECT, 'stage_position': 1, 'status': 'open'}]

        app = create_app()
        app.router.routes = [r for r in app.router.routes if not getattr(r, 'path', '').startswith('/api/v1/portal')]

        def require_user(request: Request):
            if request.headers.get('authorization') != 'Bearer client':
                raise ApiError('UNAUTHORIZED', 401)
            return 'client-user'
        app.include_router(build_client_portal_router(SimpleNamespace(web_origin='http://localhost:5173'), Store(), None, require_user))
        return TestClient(app)

    def post(self, client, body, auth='Bearer client'):
        return client.post(f'/api/v1/portal/account/projects/{PROJECT}/refund-requests', json=body, headers={'Authorization': auth})

    def test_client_asks_for_part_of_a_paid_stage(self):
        client = self.client()
        response = self.post(client, {'stage_position': 1, 'amount_minor': 100, 'reason': '  Part of the design was not delivered.  '})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.calls, [('client-user', PROJECT, 1, None, 100, 'Part of the design was not delivered.')])
        self.assertEqual(response.json()['data'][0]['status'], 'open')

    def test_client_asks_for_a_paid_addendum(self):
        client = self.client()
        self.assertEqual(self.post(client, {'proposal_id': PROPOSAL, 'amount_minor': 50, 'reason': 'Not what we agreed'}).status_code, 200)
        self.assertEqual(self.calls[0][2:5], (None, PROPOSAL, 50))

    def test_invalid_requests_never_reach_the_database(self):
        client = self.client()
        for body in ({'amount_minor': 100, 'reason': 'x'},  # Neither stage nor addendum.
                     {'stage_position': 1, 'proposal_id': PROPOSAL, 'amount_minor': 100, 'reason': 'x'},  # Both.
                     {'stage_position': 9, 'amount_minor': 100, 'reason': 'x'},
                     {'stage_position': 1, 'amount_minor': 0, 'reason': 'x'},
                     {'stage_position': 1, 'amount_minor': 1.5, 'reason': 'x'},
                     {'stage_position': 1, 'amount_minor': 100, 'reason': '   '}):
            with self.subTest(body=body):
                self.assertEqual(self.post(client, body).status_code, 422)
        self.assertEqual(self.post(client, {'stage_position': 1, 'amount_minor': 100, 'reason': 'x'}, auth='Bearer other').status_code, 401)
        self.assertEqual(self.calls, [])


class Repo:
    def __init__(self):
        self.calls = []

    def project(self, project_id):
        if project_id != PROJECT:
            raise ApiError('PROJECT_NOT_FOUND', 404)
        return {'id': PROJECT, 'name': 'Café Aurora Website'}

    def rows(self, table, params):
        self.calls.append((table, params))
        if table == 'client_refund_requests':
            return [{'id': REQUEST, 'project_id': PROJECT, 'stage_position': 1, 'proposal_id': None, 'client_email': 'client@example.com',
                     'requested_minor': 100, 'reason': 'Part of the design was not delivered.', 'status': 'open', 'settlement_id': None,
                     'created_at': '2026-11-10T02:00:00Z', 'received_payment_id': 'pay-1'}]
        if table == 'project_start_stages':
            return [{'title': 'Planning and Initial UI Design'}]
        if table == 'client_refund_request_messages':
            return []
        raise AssertionError(table)

    def rpc(self, name, data):
        self.calls.append((name, data))
        return {}


class FreelancerSideTest(unittest.TestCase):
    def test_the_pdf_carries_the_clients_own_words(self):
        content = module.request_pdf(Repo(), PROJECT, REQUEST, 'en')
        self.assertTrue(content.startswith(b'%PDF-'))

    def test_registering_links_the_request_to_its_refund(self):
        repo = Repo()
        module.register(repo, PROJECT, REQUEST, SETTLEMENT)
        self.assertIn(('client_refund_request_register', {'p_request': REQUEST, 'p_settlement': SETTLEMENT}), repo.calls)

    def test_another_project_is_rejected_before_reading(self):
        with self.assertRaises(ApiError):
            module.project_requests(Repo(), '99999999-9999-4999-8999-999999999999')


class AlertTest(unittest.TestCase):
    CLAIM = {'acquired': True, 'owner_id': 'owner', 'request_id': REQUEST, 'notification_id': '66666666-6666-4666-8666-666666666666',
             'recipient': 'freelancer@example.com', 'project_name': 'Café Aurora Website', 'client_name': 'Café Aurora',
             'item': 'Deliverable 1 · Planning and Initial UI Design', 'amount_minor': 100, 'reason': 'Part of the design was not delivered.'}

    def alerts(self, claim, error=None):
        from trato_api.refund_request_alerts import RefundRequestAlerts
        calls = self.calls = []

        class Repo:
            def rpc(_, name, data):
                calls.append((name, data))
                return claim if name == 'refund_request_alert_claim' else None

        class Gmail:
            def _send_built(_, owner, item, notification_id, builder, sender):
                calls.append(('send', owner, builder('trato@example.com', item, notification_id)))
                if error:
                    raise error
                return {'message_id': 'm-1'}
        return RefundRequestAlerts(SimpleNamespace(web_origin='https://trato.example/'), Repo(), Gmail())

    def test_the_freelancer_gets_one_email_with_amount_and_reason(self):
        self.assertEqual(self.alerts(self.CLAIM).notify(REQUEST), 'sent')
        message = next(c[2] for c in self.calls if c[0] == 'send')
        self.assertEqual(message['To'], 'freelancer@example.com')
        self.assertEqual(message['Subject'], 'Refund requested · Café Aurora Website')
        text = message.get_body(preferencelist=('plain',)).get_content()
        self.assertIn('USD 1.00', text)
        self.assertIn('Part of the design was not delivered.', text)
        self.assertIn(('refund_request_alert_finish', {'p_request': REQUEST, 'p_status': 'sent', 'p_message_id': 'm-1'}), self.calls)

    def test_already_sent_sends_nothing(self):
        self.assertIsNone(self.alerts({'acquired': False}).notify(REQUEST))
        self.assertFalse(any(c[0] == 'send' for c in self.calls))

    def test_a_failed_email_is_recorded_not_raised(self):
        from paypal.email import EmailDeliveryError
        self.assertEqual(self.alerts(self.CLAIM, EmailDeliveryError('GMAIL_SEND_FAILED')).notify(REQUEST), 'failed')
        self.assertEqual(self.calls[-1][1]['p_status'], 'failed')


if __name__ == '__main__':
    unittest.main()
