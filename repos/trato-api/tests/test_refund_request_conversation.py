import unittest

from trato_api.errors import ApiError
from trato_api.client_refund_requests import decline, reply
from trato_api.refunds.client_request import refund_settlement

PROJECT, REQ, SETTLE, SNAP, AUTH = ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111',
                                    '44444444-4444-4444-8444-444444444444', '55555555-5555-4555-8555-555555555555',
                                    '66666666-6666-4666-8666-666666666666')


class Requests:
    def __init__(self):
        self.calls = []
        self.item = {'id': REQ, 'project_id': PROJECT, 'status': 'open'}

    def project(self, project_id):
        return {'id': project_id}

    def rows(self, table, params):
        if table == 'client_refund_requests':
            return [dict(self.item)] if params.get('id', 'eq.' + REQ) == 'eq.' + REQ else []
        return [{'request_id': REQ, 'author': 'freelancer', 'body': 'Hola', 'created_at': '2026-11-10T00:00:00Z'}]

    def rpc(self, name, args):
        self.calls.append((name, args))


class ConversationTest(unittest.TestCase):
    def test_reply_saves_the_freelancer_message_and_returns_the_conversation(self):
        repo = Requests()
        items = reply(repo, PROJECT, REQ, '  Lo reviso hoy  ')
        self.assertEqual(repo.calls, [('client_refund_request_reply', {'p_request': REQ, 'p_body': 'Lo reviso hoy'})])
        self.assertEqual(items[0]['messages'][0]['body'], 'Hola')

    def test_an_empty_reply_is_rejected(self):
        with self.assertRaises(ApiError):
            reply(Requests(), PROJECT, REQ, '   ')

    def test_decline_keeps_an_optional_note(self):
        repo = Requests()
        decline(repo, PROJECT, REQ, '')
        decline(repo, PROJECT, REQ, ' The work was delivered ')
        self.assertEqual([c[1]['p_note'] for c in repo.calls], [None, 'The work was delivered'])


class Settlement:
    def __init__(self, status):
        self.status, self.calls = status, []

    def settlement(self, parent):
        return {'id': parent, 'owner_id': 'owner', 'status': self.status, 'current_snapshot_id': SNAP}

    def rpc(self, name, args):
        self.calls.append(name)
        if name == 'refund_freelancer_accept':
            self.status = 'accepted'

    def financial_authorize(self, data, key):
        self.calls.append('authorize')
        self.status = 'refund_pending'

    def financial(self, parent):
        return {'authorizations': [{'id': AUTH, 'snapshot_id': SNAP}]}


class Finance:
    def __init__(self, repo):
        self.repo = repo

    def check(self, *args):
        return {'check': {'id': 'c', 'digest': 'a' * 64}}

    def execute(self, repo, owner, parent, authorization, key):
        repo.calls.append('execute')
        repo.status = 'completed'


def manual(repo, owner='owner', snapshot=SNAP):
    pdfs = []
    result = refund_settlement(repo, owner, SETTLE, snapshot, 'refund-key', finance=Finance(repo), pdf=lambda *a: pdfs.append(a),
                               complete=lambda action, *args: action(*args), language='en')
    return result, pdfs


class ManualRefundTest(unittest.TestCase):
    def test_saved_proposal_is_refunded_in_one_click(self):
        repo = Settlement('draft')
        result, pdfs = manual(repo)
        self.assertEqual(len(pdfs), 1)
        self.assertEqual(repo.calls, ['refund_freelancer_accept', 'authorize', 'execute'])
        self.assertEqual(result['settlement']['status'], 'completed')

    def test_an_already_sent_proposal_is_accepted_too(self):
        repo = Settlement('awaiting_response')
        manual(repo)
        self.assertEqual(repo.calls[0], 'refund_freelancer_accept')

    def test_another_owner_or_version_is_refused(self):
        with self.assertRaises(ApiError):
            manual(Settlement('draft'), owner='someone-else')
        with self.assertRaises(ApiError):
            manual(Settlement('draft'), snapshot='77777777-7777-4777-8777-777777777777')


if __name__ == '__main__':
    unittest.main()
