import unittest
from types import SimpleNamespace

from paypal.email import EmailDeliveryError
from trato_api.dispute_alerts import DisputeAlert, DisputeAlerts, build_dispute_alert_email

NOTIFICATION = '11111111-1111-4111-8111-111111111111'
SUMMARY = {'dispute_id': 'PP-R-LHI-10197541', 'status': 'WAITING_FOR_SELLER_RESPONSE', 'reason': 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',
           'amount': {'value': '120.00', 'currency': 'USD'}, 'response_due': '2026-11-28T10:00:00.000Z'}


class Repo:
    def __init__(self, acquired=True):
        self.acquired, self.calls = acquired, []

    def rpc(self, name, data):
        self.calls.append((name, data))
        if name == 'dispute_alert_claim':
            return {'acquired': self.acquired, 'notification_id': NOTIFICATION, 'recipient': 'freelancer@example.com',
                    'project_name': 'Café Aurora Website', 'client_name': 'Café Aurora'} if self.acquired else {'acquired': False}
        return None


class Gmail:
    def __init__(self, error=None):
        self.error, self.sent = error, []

    def _send_built(self, user, item, notification_id, builder, expected_sender):
        if self.error:
            raise self.error
        self.sent.append(builder('trato.notificaciones@example.com', item, notification_id))
        return {'message_id': 'gmail-1'}


def alerts(repo, gmail):
    return DisputeAlerts(SimpleNamespace(web_origin='https://trato.example/'), SimpleNamespace(repo=repo), gmail)


class DisputeAlertTests(unittest.TestCase):
    def test_email_says_who_how_much_why_and_by_when(self):
        item = DisputeAlert('freelancer@example.com', 'Café Aurora Website', 'Café Aurora', SUMMARY['dispute_id'], '120.00', 'USD',
                            'MERCHANDISE_OR_SERVICE_NOT_RECEIVED', '2026-11-28T10:00:00.000Z', 'https://trato.example/#inicio')
        message = build_dispute_alert_email('trato.notificaciones@example.com', item, NOTIFICATION)
        text = message.get_body(preferencelist=('plain',)).get_content()
        self.assertEqual(message['Subject'], 'PayPal dispute · Café Aurora Website')
        for expected in ('Café Aurora opened a PayPal dispute on a payment of USD 120.00', 'Reason: Service not received',
                         'Respond by: 2026-11-28', 'https://trato.example/#inicio'):
            self.assertIn(expected, text)

    def test_one_email_per_open_dispute(self):
        repo, gmail = Repo(), Gmail()
        self.assertEqual(alerts(repo, gmail).notify('owner', 'project', SUMMARY), 'sent')
        self.assertEqual(len(gmail.sent), 1)
        self.assertEqual(repo.calls[-1][1]['p_status'], 'sent')
        repo, gmail = Repo(acquired=False), Gmail()
        self.assertIsNone(alerts(repo, gmail).notify('owner', 'project', SUMMARY))
        self.assertEqual(gmail.sent, [])

    def test_resolved_disputes_are_not_announced(self):
        repo, gmail = Repo(), Gmail()
        self.assertIsNone(alerts(repo, gmail).notify('owner', 'project', {**SUMMARY, 'status': 'RESOLVED'}))
        self.assertEqual(repo.calls, [])

    def test_a_failed_email_is_recorded_without_raising(self):
        repo = Repo()
        self.assertEqual(alerts(repo, Gmail(EmailDeliveryError('GMAIL_SEND_FAILED', uncertain=True))).notify('owner', 'project', SUMMARY), 'uncertain')
        self.assertEqual(repo.calls[-1][1]['p_status'], 'uncertain')

    def test_webhook_saves_history_even_if_the_email_breaks(self):
        from trato_api.dispute_webhook import DisputeWebhook

        class Reader:
            def provider(self):
                return SimpleNamespace(get_dispute=lambda dispute_id: {
                    'dispute_id': dispute_id, 'status': 'OPEN', 'disputed_transactions': [{'seller_transaction_id': 'CAPTURE1'}]})

        class Store:
            recorded = []
            def webhook(self, action, data):
                return {'found': True, 'payment': {'owner_id': 'owner', 'project_id': 'project', 'capture_id': 'CAPTURE1'}}
            def record(self, *args):
                self.recorded.append(args)

        class Broken:
            def notify(self, *args):
                raise KeyError('recipient')

        hook = DisputeWebhook(SimpleNamespace(), Reader(), Broken())
        store = Store()
        event = {'event_type': 'CUSTOMER.DISPUTE.CREATED', 'resource': {'dispute_id': 'PP-R-LHI-10197541'}}
        self.assertTrue(hook.process(event, SimpleNamespace(merchant_id='M'), store))
        self.assertEqual(len(store.recorded), 1)


if __name__ == '__main__':
    unittest.main()
