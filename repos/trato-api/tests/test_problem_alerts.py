import unittest
from types import SimpleNamespace

from paypal.email import EmailDeliveryError
from trato_api.problem_alerts import ProblemAlert, ProblemAlerts, build_problem_alert_email

NOTIFICATION = '22222222-2222-4222-8222-222222222222'
CLAIM = {'acquired': True, 'owner_id': 'owner', 'report_id': 'report', 'notification_id': NOTIFICATION, 'recipient': 'freelancer@example.com',
         'project_name': 'Café Aurora Website', 'client_name': 'Café Aurora', 'title': 'Online store', 'reason': 'not_as_agreed',
         'notes': 'The store only shows three products.'}


class Repo:
    def __init__(self, claim=CLAIM):
        self.claim, self.calls = claim, []

    def rpc(self, name, data):
        self.calls.append((name, data))
        return self.claim if name == 'problem_alert_claim' else None


class Gmail:
    def __init__(self, error=None):
        self.error, self.sent = error, []

    def _send_built(self, user, item, notification_id, builder, expected_sender):
        if self.error:
            raise self.error
        self.sent.append((user, builder('trato.notificaciones@example.com', item, notification_id)))
        return {'message_id': 'gmail-1'}


def alerts(repo, gmail):
    return ProblemAlerts(SimpleNamespace(web_origin='https://trato.example'), repo, gmail)


class ProblemAlertTests(unittest.TestCase):
    def test_email_says_who_what_and_why(self):
        item = ProblemAlert('freelancer@example.com', 'Café Aurora Website', 'Café Aurora', 'Online store', 'not_as_agreed',
                            'The store only shows three products.', 'https://trato.example/#inicio')
        message = build_problem_alert_email('trato.notificaciones@example.com', item, NOTIFICATION)
        text = message.get_body(preferencelist=('plain',)).get_content()
        self.assertEqual(message['Subject'], 'Problem reported · Café Aurora Website')
        for expected in ('Café Aurora reported a problem with «Online store» in Café Aurora Website.', 'Reason: Not as agreed',
                         '“The store only shows three products.”', 'https://trato.example/#inicio'):
            self.assertIn(expected, text)

    def test_a_trailing_dot_in_the_client_name_is_dropped(self):
        item = ProblemAlert('freelancer@example.com', 'Sitio web', 'Café Aurora.', 'Addendum v1 · $1.00', 'quality', 'x', 'https://t.example')
        text = build_problem_alert_email('trato.notificaciones@example.com', item, NOTIFICATION).get_body(preferencelist=('plain',)).get_content()
        self.assertIn('Café Aurora reported a problem with «Addendum v1 · $1.00» in Sitio web.', text)

    def test_sent_once_from_the_owner_mailbox_and_recorded(self):
        repo, gmail = Repo(), Gmail()
        self.assertEqual(alerts(repo, gmail).notify('a' * 64), 'sent')
        self.assertEqual(gmail.sent[0][0], 'owner')
        self.assertEqual(repo.calls[-1], ('problem_alert_finish', {'p_report': 'report', 'p_status': 'sent', 'p_message_id': 'gmail-1'}))
        repo, gmail = Repo({'acquired': False}), Gmail()
        self.assertIsNone(alerts(repo, gmail).notify('a' * 64))
        self.assertEqual(gmail.sent, [])

    def test_a_failed_email_is_recorded(self):
        repo = Repo()
        self.assertEqual(alerts(repo, Gmail(EmailDeliveryError('GMAIL_SEND_FAILED'))).notify('a' * 64), 'failed')
        self.assertEqual(repo.calls[-1][1]['p_status'], 'failed')

    def test_without_a_mailbox_nothing_is_claimed(self):
        repo = Repo()
        self.assertIsNone(alerts(repo, None).notify('a' * 64))
        self.assertEqual(repo.calls, [])


if __name__ == '__main__':
    unittest.main()
