"""Report a problem: client portal actions and the freelancer's routes, with in-memory doubles."""
from hashlib import sha256
import unittest

from fastapi.testclient import TestClient

from trato_api.app import create_app
from trato_api.errors import ApiError


def app_with(router, prefix):
    # The real app, for its error handling, with these routes replaced by the ones under test.
    app = create_app()
    app.router.routes = [r for r in app.router.routes if not getattr(r, 'path', '').startswith(prefix)]
    app.include_router(router)
    return TestClient(app)

TOKEN = 'a' * 64
DIGEST = sha256(TOKEN.encode()).hexdigest()
PROJECT = '11111111-1111-4111-8111-111111111111'
OTHER = '22222222-2222-4222-8222-222222222222'
REPORT = '33333333-3333-4333-8333-333333333333'
REVISION = '44444444-4444-4444-8444-444444444444'


class Store:
    def __init__(self):
        self.calls = []

    def problem(self, digest):
        self.calls.append(('problem', digest)); return None

    def report_problem(self, digest, reason, notes):
        self.calls.append(('report', digest, reason, notes))
        return {'reason': reason, 'notes': notes, 'status': 'open', 'messages': []}

    def problem_message(self, digest, body):
        self.calls.append(('message', digest, body)); return {'status': 'open', 'messages': [{'author': 'client', 'body': body}]}

    def close_problem(self, digest, status):
        self.calls.append(('close', digest, status)); return {'status': status, 'messages': []}


def portal(store):
    from trato_api.client_portal import build_client_portal_router
    return app_with(build_client_portal_router(None, store), '/api/v1/portal')


class PortalProblemTests(unittest.TestCase):
    def test_the_client_reports_with_a_known_reason_and_trimmed_notes(self):
        store = Store()
        with portal(store) as client:
            response = client.post('/api/v1/portal/report-problem', json={'token': TOKEN, 'reason': 'not_as_agreed', 'notes': '  The logo is missing  '})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers['cache-control'], 'no-store')
        self.assertEqual(store.calls, [('report', DIGEST, 'not_as_agreed', 'The logo is missing')])

    def test_invalid_reports_never_reach_the_database(self):
        store = Store()
        with portal(store) as client:
            for body in ({'reason': 'refund_now', 'notes': 'x'}, {'reason': 'quality', 'notes': '  '},
                         {'reason': 'quality', 'notes': 'x' * 4001}, {'reason': 'quality'}):
                self.assertEqual(client.post('/api/v1/portal/report-problem', json={'token': TOKEN, **body}).status_code, 422)
            self.assertEqual(client.post('/api/v1/portal/close-problem', json={'token': TOKEN, 'status': 'refunded'}).status_code, 422)
            self.assertEqual(client.post('/api/v1/portal/problem-message', json={'token': TOKEN, 'body': ''}).status_code, 422)
        self.assertEqual(store.calls, [])

    def test_a_malformed_link_is_not_found_before_any_call(self):
        store = Store()
        with portal(store) as client:
            self.assertEqual(client.post('/api/v1/portal/problem', json={'token': 'x'}).status_code, 404)
        self.assertEqual(store.calls, [])

    def test_the_client_reads_replies_and_closes_its_report(self):
        store = Store()
        with portal(store) as client:
            self.assertIsNone(client.post('/api/v1/portal/problem', json={'token': TOKEN}).json()['data'])
            client.post('/api/v1/portal/problem-message', json={'token': TOKEN, 'body': 'Still missing'})
            closed = client.post('/api/v1/portal/close-problem', json={'token': TOKEN, 'status': 'unresolved'}).json()['data']
        self.assertEqual(closed['status'], 'unresolved')
        self.assertEqual([c[0] for c in store.calls], ['problem', 'message', 'close'])

    def test_the_database_decision_is_returned_as_is(self):
        class Unpaid(Store):
            def report_problem(self, *a): raise ApiError('PROBLEM_REQUIRES_PAYMENT', 409)
        with portal(Unpaid()) as client:
            response = client.post('/api/v1/portal/report-problem', json={'token': TOKEN, 'reason': 'quality', 'notes': 'x'})
        self.assertEqual(response.status_code, 409)


class AccountProblemsTests(unittest.TestCase):
    def test_the_client_lists_learn_the_state_and_whether_the_fix_was_paid(self):
        from trato_api.client_portal import build_client_portal_router

        class Account(Store):
            def agreements(self, user):
                return [{'proposal_id': 'p1', 'payment_status': 'completed'}, {'proposal_id': 'p2', 'payment_status': 'completed'},
                        {'proposal_id': 'p3', 'payment_status': None}]

            def link_hash(self, user, proposal_id):
                return proposal_id

            def problem(self, digest):
                return {'p1': {'status': 'open', 'request_paid': True}, 'p2': None}.get(digest)

        app_client = app_with(build_client_portal_router(None, Account(), require_user=lambda: 'client'), '/api/v1/portal')
        with app_client as client:
            data = client.get('/api/v1/portal/account/problems').json()['data']
        self.assertEqual(data, {'p1': {'status': 'open', 'request_paid': True}})


class Repo:
    def __init__(self, reports, messages, projects=()):
        self.reports, self.messages, self.projects, self.rpcs = reports, messages, list(projects), []

    def rows(self, table, params):
        if table == 'client_problem_reports':
            rows = self.reports
            if 'project_id' in params: rows = [r for r in rows if 'eq.' + r['project_id'] == params['project_id']]
            if 'id' in params: rows = [r for r in rows if 'eq.' + r['id'] == params['id']]
            if params.get('status') == 'eq.open': rows = [r for r in rows if r['status'] == 'open']
            return rows
        if table == 'client_problem_messages': return self.messages
        if table == 'projects': return self.projects
        if table == 'proposal_revisions': return [{'id': REVISION, 'revision_no': 2}]
        raise AssertionError(table)

    def rpc(self, name, data):
        self.rpcs.append((name, data)); return {}


def report(status='open', project=PROJECT):
    return {'id': REPORT, 'project_id': project, 'proposal_id': 'p', 'revision_id': REVISION, 'reason': 'quality',
            'notes': 'Blurry photos', 'status': status, 'created_at': '2026-11-09T10:00:00Z', 'updated_at': '2026-11-09T10:00:00Z', 'closed_at': None}


def freelancer(repo):
    from trato_api.problem_reports import build_problem_report_router
    router = build_problem_report_router(None, lambda: 'owner', repository_factory=lambda settings, auth: repo)
    app = create_app()
    app.router.routes = [r for r in app.router.routes if 'problem-reports' not in getattr(r, 'path', '')]
    app.include_router(router)
    return TestClient(app)


class FreelancerProblemTests(unittest.TestCase):
    def test_attention_lists_open_reports_with_the_freelancers_turn_first(self):
        repo = Repo([report()], [], [{'id': PROJECT, 'name': 'Café Aurora Website', 'client_id': 'c1'}])
        with freelancer(repo) as client:
            rows = client.get('/api/v1/problem-reports/attention').json()['data']['reports']
        self.assertEqual(rows, [{'report_id': REPORT, 'project_id': PROJECT, 'project_name': 'Café Aurora Website', 'client_id': 'c1',
                                 'reason': 'quality', 'created_at': '2026-11-09T10:00:00Z', 'your_turn': True}])

    def test_after_the_freelancer_replies_it_is_the_clients_turn(self):
        from trato_api.problem_reports import your_turn
        self.assertFalse(your_turn(report(), [{'author': 'freelancer'}]))
        self.assertTrue(your_turn(report(), [{'author': 'freelancer'}, {'author': 'client'}]))
        self.assertFalse(your_turn(report('resolved'), []))
        # Registering it as a request answers the report: the client's turn until they write again.
        linked = report(); linked['request_document_id'] = 'doc'
        self.assertFalse(your_turn(linked, []))
        self.assertTrue(your_turn(linked, [{'author': 'client'}]))

    def test_project_reports_carry_the_version_and_conversation(self):
        repo = Repo([report()], [{'report_id': REPORT, 'author': 'freelancer', 'body': 'Sending new ones', 'created_at': 't'}])
        with freelancer(repo) as client:
            data = client.get(f'/api/v1/projects/{PROJECT}/problem-reports').json()['data']['reports'][0]
        self.assertEqual(data['revision_no'], 2)
        self.assertEqual(data['messages'], [{'author': 'freelancer', 'body': 'Sending new ones', 'created_at': 't'}])
        self.assertFalse(data['your_turn'])

    def test_a_reply_goes_through_the_database_function_for_its_own_project(self):
        repo = Repo([report()], [])
        with freelancer(repo) as client:
            self.assertEqual(client.post(f'/api/v1/projects/{PROJECT}/problem-reports/{REPORT}/messages', json={'body': ' Fixed '}).status_code, 200)
            self.assertEqual(client.post(f'/api/v1/projects/{OTHER}/problem-reports/{REPORT}/messages', json={'body': 'x'}).status_code, 404)
            self.assertEqual(client.post(f'/api/v1/projects/{PROJECT}/problem-reports/{REPORT}/messages', json={'body': ''}).status_code, 422)
        self.assertEqual(repo.rpcs, [('problem_report_reply', {'p_report': REPORT, 'p_body': 'Fixed'})])


class RegisterAsRequestTests(unittest.TestCase):
    def repo(self):
        repo = Repo([report()], [{'report_id': REPORT, 'author': 'freelancer', 'body': 'Sending new ones', 'created_at': '2026-11-09T11:00:00Z'}],
                    [{'id': PROJECT, 'name': 'Café Aurora Website', 'client_id': 'c1'}])
        return repo

    def test_the_report_becomes_a_pdf_for_the_usual_request_upload(self):
        with freelancer(self.repo()) as client:
            response = client.get(f'/api/v1/projects/{PROJECT}/problem-reports/{REPORT}/request-pdf', headers={'Accept-Language': 'en'})
            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.content.startswith(b'%PDF-'))
            self.assertEqual(response.headers['cache-control'], 'no-store')
            self.assertEqual(client.get(f'/api/v1/projects/{OTHER}/problem-reports/{REPORT}/request-pdf').status_code, 404)

    def test_linking_goes_through_the_database_function_for_its_own_project(self):
        repo = self.repo()
        document = '55555555-5555-4555-8555-555555555555'
        with freelancer(repo) as client:
            self.assertEqual(client.post(f'/api/v1/projects/{PROJECT}/problem-reports/{REPORT}/request', json={'document_id': document}).status_code, 200)
            self.assertEqual(client.post(f'/api/v1/projects/{OTHER}/problem-reports/{REPORT}/request', json={'document_id': document}).status_code, 404)
            self.assertEqual(client.post(f'/api/v1/projects/{PROJECT}/problem-reports/{REPORT}/request', json={'document_id': 'x'}).status_code, 422)
        self.assertEqual(repo.rpcs, [('problem_report_link_request', {'p_report': REPORT, 'p_document': document})])


class AssistantProblemDraftTests(unittest.TestCase):
    def answer(self, **extra):
        return {'kind': 'portal_assistant', 'status': 'draft_problem', 'answer': 'Choose a reason and send it.', 'sources': [],
                'change_request': '', 'problem_report': 'The photos are blurry.', **extra}

    def test_a_problem_draft_is_shown_only_when_the_database_allowed_a_report(self):
        from trato_api.portal_assistant import validate_answer
        self.assertEqual(validate_answer(self.answer(), False, True)['problem_report'], 'The photos are blurry.')
        for can_report, bad in ((False, self.answer()), (True, self.answer(change_request='Both')), (True, self.answer(problem_report='  '))):
            with self.assertRaises(ApiError):
                validate_answer(bad, False, can_report)
        hidden = {**self.answer(), 'status': 'answered', 'sources': ['scope']}
        with self.assertRaises(ApiError):
            validate_answer(hidden, True, True)  # A draft never travels inside a normal answer.

    def test_an_answer_stored_before_reports_existed_is_still_valid(self):
        from trato_api.portal_assistant import validate_answer
        old = {'kind': 'portal_assistant', 'status': 'answered', 'answer': 'Five products.', 'sources': ['scope'], 'change_request': ''}
        self.assertEqual(validate_answer(old, True)['problem_report'], '')

    def test_the_context_offers_a_report_only_for_paid_addenda_without_one(self):
        from trato_api.portal_assistant import agreement_context, can_report_problem
        paid = {'status': 'accepted', 'payment_status': 'completed'}
        self.assertTrue(can_report_problem(paid, False))
        self.assertFalse(can_report_problem(paid, True))
        self.assertFalse(can_report_problem({'status': 'accepted', 'payment_status': 'pending'}, False))
        self.assertIs(agreement_context(paid)['can_report_problem'], False)


if __name__ == '__main__':
    unittest.main()
