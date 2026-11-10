import unittest

from trato_api.errors import ApiError
from trato_api.refunds.client_request import refund_client_request

REQ, PROJECT, PAY, SETTLE, SNAP, AUTH = ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
                                         '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444',
                                         '55555555-5555-4555-8555-555555555555', '66666666-6666-4666-8666-666666666666')


class Repo:
    def __init__(self, status='open', settlement='draft'):
        self.item = {'id': REQ, 'project_id': PROJECT, 'received_payment_id': PAY, 'requested_minor': 100, 'status': status, 'settlement_id': None}
        self.status, self.calls = settlement, []

    def rows(self, table, params):
        return [self.item] if params['id'] == 'eq.' + REQ else []

    def rpc(self, name, args):
        self.calls.append(name)
        if name == 'client_refund_request_accept':
            self.status = 'accepted'
        return {'settlement': {'id': SETTLE, 'status': self.status}, 'snapshot': {'id': SNAP}}

    def settlement(self, parent):
        return {'id': parent, 'status': self.status}

    def financial_authorize(self, data, key):
        self.calls.append(('authorize', data['check_id'], data['confirmed'], key))
        self.status = 'refund_pending'

    def financial(self, parent):
        return {'authorizations': [{'id': AUTH, 'snapshot_id': SNAP}]}


class Finance:
    def __init__(self, repo):
        self.repo, self.intake = repo, []

    def check_intake(self, repo, project, data):
        self.intake.append(data)

    def check(self, repo, owner, parent, snapshot):
        return {'check': {'id': 'check-1', 'digest': 'a' * 64}}

    def execute(self, repo, owner, parent, authorization, key):
        self.repo.calls.append(('execute', authorization, key))
        self.repo.status = 'completed'


def run(repo, finance=None):
    finance = finance or Finance(repo)
    pdfs = []
    result = refund_client_request(repo, 'owner', PROJECT, REQ, 'client-request-' + REQ, finance=finance,
                                   pdf=lambda *args: pdfs.append(args), complete=lambda action, *args: action(*args), language='en')
    return result, pdfs, finance


class ClientRequestRefundTest(unittest.TestCase):
    def test_one_click_chains_the_existing_steps_in_order(self):
        repo = Repo()
        result, pdfs, finance = run(repo)
        self.assertEqual(result['settlement']['status'], 'completed')
        self.assertEqual(len(pdfs), 1)
        self.assertEqual(finance.intake, [{'scope': 'payment_only', 'payment_id': PAY}])
        self.assertEqual(repo.calls[:2], ['client_refund_request_settle', 'client_refund_request_accept'])
        self.assertEqual(repo.calls[2][:3], ('authorize', 'check-1', True))
        self.assertEqual(repo.calls[3], ('execute', AUTH, 'client-request-' + REQ + '-execute'))

    def test_a_repeat_after_a_cut_resumes_without_a_second_authorization(self):
        repo = Repo(status='registered', settlement='refund_pending')
        result, pdfs, finance = run(repo)
        self.assertEqual(pdfs, [])
        self.assertEqual(finance.intake, [])
        self.assertEqual([c for c in repo.calls if isinstance(c, tuple) and c[0] == 'authorize'], [])
        self.assertEqual(result['settlement']['status'], 'completed')

    def test_a_finished_refund_is_never_executed_again(self):
        repo = Repo(status='registered', settlement='completed')
        run(repo)
        self.assertEqual(repo.calls, ['client_refund_request_settle'])

    def test_another_project_request_is_not_found(self):
        repo = Repo()
        with self.assertRaises(ApiError) as error:
            refund_client_request(repo, 'owner', PROJECT, '77777777-7777-4777-8777-777777777777', 'k', finance=Finance(repo),
                                  pdf=None, complete=None, language='en')
        self.assertEqual(error.exception.code, 'REFUND_REQUEST_NOT_FOUND')


if __name__ == '__main__':
    unittest.main()
