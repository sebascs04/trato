import json
import unittest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from fastapi.responses import JSONResponse
from trato_api.disputes import build_dispute_router, DisputeReader, completed_defense
from trato_api.errors import ApiError
from test_disputes import PROJECT, CAPTURE, PayPal

JOB = 'aaaaaaaa-2222-4333-8444-555555555555'
DISPUTE = 'PP-R-VHD-10197086'
DOC = 'dddddddd-2222-4333-8444-555555555555'
OTHER_DOC = 'eeeeeeee-2222-4333-8444-555555555555'
SOURCE = 'a' * 64
TABLES = {
    'project_received_payments': [{'id': 'rp1', 'origin': 'change', 'capture_id': CAPTURE, 'amount_minor': 12000, 'currency': 'USD',
                                   'verified_at': '2026-11-08T04:17:07Z', 'proposal_payment_id': 'pp1'}],
    'proposal_payments': [{'id': 'pp1', 'proposal_id': 'prop', 'revision_id': 'rev', 'acceptance_id': 'acc', 'status': 'completed',
                           'capture_id': CAPTURE, 'amount_minor': 12000, 'currency': 'USD'}],
    'proposal_revisions': [{'revision_no': 1, 'scope_summary': 'Online store module', 'conditions': 'One round of changes', 'additional_minor': 12000,
                            'currency': 'USD', 'deadline': '2026-12-20', 'created_at': '2026-11-07T17:00:00Z'}],
    'proposal_revision_items': [{'description': 'Store', 'quantity': 1, 'unit_amount_minor': 12000}],
    'proposal_artifacts': [{'document_id': DOC, 'sha256': 'abc123', 'created_at': '2026-11-07T17:10:00Z'}],
    'documents': [{'id': DOC, 'title': 'Addendum v1', 'kind': 'addendum', 'mime_type': 'application/pdf', 'size_bytes': 7},
                  {'id': OTHER_DOC, 'title': 'Initial agreement', 'kind': 'initial_agreement', 'mime_type': 'application/pdf', 'size_bytes': 7},
                  {'id': 'huge', 'title': 'Video', 'kind': 'other', 'mime_type': 'video/mp4', 'size_bytes': 7}],
    'proposal_deliveries': [{'kind': 'adenda', 'status': 'accepted_by_gmail', 'created_at': '2026-11-07T17:11:00Z', 'recipient': 'private@example.com'},
                            {'kind': 'adenda', 'status': 'failed', 'created_at': '2026-11-07T17:09:00Z'}],
    'proposal_acceptances': [{'method': 'client_portal', 'created_at': '2026-11-08T04:12:10Z'}]}


class Repo:
    def __init__(self, *args): pass
    def project(self, project_id):
        if project_id != PROJECT: raise ApiError('PROJECT_NOT_FOUND', 404)
        return {'id': project_id, 'client_id': 'client-1'}
    def rows(self, table, params): return TABLES[table]
    def rpc(self, name, params): return 1


class Preferences:
    def for_request(self, request, owner): return 'gemini-3.8-flash'


class Jobs:
    def __init__(self): self.data = None
    def enqueue(self, owner, job_id, data): self.owner = owner; self.data = data; return {'id': job_id, 'status': 'queued'}
    def input(self, owner, job_id): return self.data
    def connection(self):
        sources = {SOURCE: {'source_kind': 'original', 'file_id': OTHER_DOC, 'title': 'Initial agreement', 'text': 'The store includes ten products.'},
                   'b' * 64: {'source_kind': 'summary', 'file_id': DOC, 'title': 'Addendum v1', 'text': 'A summary.'}}
        class Connection:
            def hget(_, key, field): return json.dumps(sources)
        return Connection()


def replies(owner, project_id, proposal_id):
    return [{'revision_id': 'rev', 'reply_text': 'I accept this version.', 'received_at': '2026-11-07T17:14:10Z', 'from_email': 'private@example.com'},
            {'revision_id': 'rev', 'reply_text': 'Deleted message', 'received_at': '2026-11-07T17:15:00Z', 'mailbox_removed_at': '2026-11-08'},
            {'revision_id': 'other', 'reply_text': 'Another version', 'received_at': '2026-11-07T17:16:00Z'}]


class DefenseTests(unittest.TestCase):
    def setUp(self):
        self.jobs = Jobs(); self.paypal = PayPal(); app = FastAPI()
        app.include_router(build_dispute_router(None, lambda: 'owner', Repo, DisputeReader(self.paypal), jobs=self.jobs, preferences=Preferences(), replies=replies))
        @app.exception_handler(ApiError)
        async def error(_, e): return JSONResponse({'error': {'code': e.code}}, status_code=e.status)
        self.client = TestClient(app)

    def post(self, dispute=DISPUTE, project=PROJECT, body=None):
        return self.client.post(f'/api/v1/projects/{project}/disputes/{dispute}/defense', json=body or {'output_language': 'en'}, headers={'Idempotency-Key': JOB})

    def test_job_carries_this_payments_records_without_contact_data(self):
        self.assertEqual(self.post().status_code, 202)
        data = self.jobs.data
        self.assertEqual((data['workflow'], data['dispute_id'], data['model_id'], data['owner_id'], data['client_id']), ('dispute_defense', DISPUTE, 'gemini-3.8-flash', 'owner', 'client-1'))
        self.assertEqual([e['id'] for e in data['evidence']], ['agreement', 'document-1', 'delivery-1', 'acceptance', 'payment', 'reply-1'])
        self.assertEqual(data['dispute']['client_messages'], ['Not as described.'])
        self.assertEqual(data['dispute']['actions'], ['accept_claim', 'escalate', 'send_message'])
        text = json.dumps(data)
        self.assertIn('Online store module', text); self.assertIn('USD 120.00', text); self.assertIn("through Trato's client portal on 2026-11-07 23:12 Peru time", text)
        for hidden in ('private@example.com', 'Deleted message', 'Another version'): self.assertNotIn(hidden, text)

    def test_unknown_disputes_other_projects_and_bad_language_are_rejected(self):
        self.assertEqual(self.post(dispute='PP-R-OTHER-1').status_code, 404)
        self.assertEqual(self.post(project='99999999-2222-4333-8444-555555555555').status_code, 404)
        self.assertEqual(self.post(body={'output_language': 'fr'}).status_code, 422)
        self.assertIsNone(self.jobs.data)

    def test_resolved_disputes_cannot_be_answered(self):
        original = self.paypal.get_dispute
        self.paypal.get_dispute = lambda d: {**original(d), 'status': 'RESOLVED'}
        self.assertEqual(self.post().status_code, 409)

    def test_analysis_runs_again_only_after_a_new_client_message(self):
        original = self.paypal.get_dispute
        def conversation(*senders):
            self.paypal.get_dispute = lambda d: {**original(d), 'messages': [{'posted_by': by, 'time_posted': f'2026-11-08T0{i}:00:00Z', 'content': by} for i, by in enumerate(senders)]}
        conversation('BUYER', 'SELLER')
        self.assertEqual(self.post().json()['error']['code'], 'DISPUTE_ANALYSIS_NOT_NEEDED')
        self.assertIsNone(self.jobs.data)
        conversation('BUYER', 'SELLER', 'BUYER')
        self.assertEqual(self.post().status_code, 202)

        self.assertEqual([m['by'] for m in self.jobs.data['dispute']['conversation']], ['BUYER', 'SELLER', 'BUYER'])

    def test_analysis_runs_again_when_paypal_asks_for_evidence(self):
        original = self.paypal.get_dispute
        answered = [{'posted_by': by, 'time_posted': f'2026-11-08T0{i}:00:00Z', 'content': by} for i, by in enumerate(('BUYER', 'SELLER'))]
        self.paypal.get_dispute = lambda d: {**original(d), 'messages': answered, 'links': [{'rel': 'self'}, {'rel': 'provide_evidence'}]}
        self.assertEqual(self.post().status_code, 202)

    def test_results_are_rechecked_and_list_the_projects_documents(self):
        self.post()
        answer = {'kind': 'dispute_defense', 'dispute_id': DISPUTE, 'model': 'x', 'assessment': 'partial', 'summary': 'Accepted, delivery unproven.',
                  'gaps': ['No proof of delivery.'], 'recommended_action': 'send_message', 'response_message': 'What is missing?',
                  'documents': [{'document_id': OTHER_DOC, 'recommended': True, 'reason': 'Shows the original scope.'}],
                  'points': [{'claim': 'Accepted', 'evidence_id': 'acceptance', 'quote': 'accepted addendum version 1'},
                             {'claim': 'Ten products', 'evidence_id': SOURCE, 'quote': 'includes ten products'}]}
        result = completed_defense(self.jobs, Repo(), 'owner', JOB, answer)
        self.assertEqual(result['points'][0]['kind'], 'acceptance'); self.assertNotIn('model', result)
        self.assertEqual((result['points'][1]['kind'], result['points'][1]['title']), ('project_document', 'Initial agreement'))
        documents = {d['id']: d for d in result['documents']}
        self.assertTrue(documents[DOC]['recommended'], 'the accepted PDF is always proposed')
        self.assertEqual(documents[OTHER_DOC]['reason'], 'Shows the original scope.'); self.assertTrue(documents[OTHER_DOC]['consulted'])
        self.assertFalse(documents['huge']['sendable']); self.assertFalse(documents['huge']['recommended'])
        unread = completed_defense(self.jobs, Repo(), 'owner', JOB, {**answer, 'documents': [{'document_id': 'huge', 'recommended': True, 'reason': 'Judged by its title.'}]})
        hidden = next(d for d in unread['documents'] if d['id'] == 'huge')
        self.assertEqual((hidden['consulted'], hidden['recommended'], hidden['reason']), (False, False, ''), 'no opinion on a document that was not read')
        for bad, code in (({'points': [{'claim': 'x', 'evidence_id': 'acceptance', 'quote': 'invented'}]}, 'AI_INVALID_CITATION'),
                          ({'points': [{'claim': 'x', 'evidence_id': 'b' * 64, 'quote': 'A summary'}]}, 'AI_INVALID_CITATION'),
                          ({'documents': [{'document_id': 'foreign', 'recommended': True, 'reason': 'x'}]}, 'AI_INVALID_RESPONSE'),
                          ({'recommended_action': 'make_offer'}, 'AI_INVALID_RESPONSE'), ({'dispute_id': 'PP-R-OTHER'}, 'AI_INVALID_RESPONSE')):
            with self.assertRaises(ApiError) as caught: completed_defense(self.jobs, Repo(), 'owner', JOB, {**answer, **bad})
            self.assertEqual(caught.exception.code, code)

    def test_document_tools_accept_this_job_and_still_reject_others(self):
        from unittest.mock import patch
        from trato_api.project_assistant import ProjectAssistant
        row = {'status': 'running', 'execution_id': JOB, 'owner': 'owner', 'input': json.dumps({'workflow': 'dispute_defense', 'owner_id': 'owner', 'project_id': PROJECT, 'client_id': 'client-1'})}
        class Connection:
            def hgetall(_, key): return row
        class Tools:
            def connection(_): return Connection()
        class Server(Repo):
            def project(self, project_id): return {'id': project_id, 'owner_id': 'owner', 'client_id': 'client-1'}
            def rows(self, table, params): return [{'id': 'client-1'}] if table == 'clients' else []
        service = ProjectAssistant(None, jobs=Tools(), gateway=object(), server=Server(), memory=object())
        self.assertEqual(service.active_job(JOB, JOB)[2].__class__, Server)
        row['input'] = json.dumps({'workflow': 'other', 'owner_id': 'owner', 'project_id': PROJECT, 'client_id': 'client-1'})
        with self.assertRaises(ApiError): service.active_job(JOB, JOB)


class EvidenceDateTests(unittest.TestCase):
    def test_evidence_dates_read_in_project_time_not_utc(self):
        from trato_api.disputes import project_time
        self.assertEqual(project_time('2026-11-08T04:12:10.472575+00:00'), '2026-11-07 23:12 Peru time')
        with self.assertRaises(ApiError): project_time(None)


class SendTests(unittest.TestCase):
    def setUp(self):
        from paypal.client import PayPalError
        self.PayPalError = PayPalError
        outer = self
        self.sent = []; self.send_error = None; self.bad_download = False
        class Client(PayPal):
            def send_dispute_message(_, dispute_id, message, files=()):
                if outer.send_error: raise outer.send_error
                outer.sent.append((dispute_id, message, list(files)))
        self.paypal = Client()
        class FileRepo(Repo):
            def document(_, document_id):
                if document_id == 'ffffffff-2222-4333-8444-555555555555': return {'id': document_id, 'project_id': 'another', 'mime_type': 'application/pdf', 'size_bytes': 7}
                return {'id': document_id, 'project_id': PROJECT, 'mime_type': 'application/pdf', 'size_bytes': 7}
            def download(_, document):
                if outer.bad_download: raise ApiError('ORIGINAL_HASH_MISMATCH', 409)
                return b'%PDF-1.'
        app = FastAPI()
        app.include_router(build_dispute_router(None, lambda: 'owner', FileRepo, DisputeReader(self.paypal), jobs=Jobs(), preferences=Preferences(), replies=replies))
        @app.exception_handler(ApiError)
        async def error(_, e): return JSONResponse({'error': {'code': e.code}}, status_code=e.status)
        self.client = TestClient(app)

    def send(self, dispute=DISPUTE, **body):
        return self.client.post(f'/api/v1/projects/{PROJECT}/disputes/{dispute}/messages', json={'message': 'Which part is missing?', 'document_ids': [DOC, OTHER_DOC], **body})

    def test_message_and_verified_documents_go_in_one_request(self):
        self.assertEqual(self.send().json()['data'], {'message_sent': True, 'attachment': 'sent', 'documents_sent': 2, 'documents_total': 2, 'documents_recorded': True})
        self.assertEqual(len(self.sent), 1)
        self.assertEqual(self.sent[0][2][0], ('document-1.pdf', 'application/pdf', b'%PDF-1.'))

    def test_without_documents_only_the_message_is_sent(self):
        self.assertEqual(self.send(document_ids=[]).json()['data']['attachment'], 'none')
        self.assertEqual(self.sent[0][2], [])

    def test_nothing_is_sent_for_foreign_disputes_blank_text_foreign_documents_or_a_bad_hash(self):
        self.assertEqual(self.send(dispute='PP-R-OTHER-1').status_code, 404)
        self.assertEqual(self.send(message='   ').status_code, 422)
        self.assertEqual(self.send(document_ids=['ffffffff-2222-4333-8444-555555555555']).json()['error']['code'], 'DISPUTE_DOCUMENT_INVALID')
        self.assertEqual(self.send(document_ids=[DOC] * 11).status_code, 422)
        self.bad_download = True
        self.assertEqual(self.send().status_code, 409)
        self.assertEqual(self.sent, [])

    def test_failures_are_reported_exactly(self):
        self.send_error = self.PayPalError('PAYPAL_UNAVAILABLE', uncertain=True)
        self.assertEqual(self.send().json()['error']['code'], 'DISPUTE_SEND_UNCERTAIN')
        self.send_error = self.PayPalError('PAYPAL_DISPUTE_ACTION_REJECTED', status=409)
        self.assertEqual(self.send().json()['error']['code'], 'DISPUTE_SEND_REJECTED')

    def test_paypal_requests_follow_the_documented_sample(self):
        from paypal.client import PayPalSandboxClient, Response
        calls = []
        def transport(method, path, headers, body):
            calls.append((method, path, headers.get('Content-Type'), body))
            return Response(200, {'access_token': 'x', 'expires_in': 3600} if 'oauth2' in path else {'links': []})
        client = PayPalSandboxClient('id', 'secret', 'MERCHANT123', transport=transport)
        client.send_dispute_message(DISPUTE, 'Hello')
        self.assertEqual(calls[1][1:], (f'/v1/customer/disputes/{DISPUTE}/send-message', 'application/json', b'{"message": "Hello"}'))
        client.send_dispute_message(DISPUTE, 'Hello', [('document-1.pdf', 'application/pdf', b'%PDF')])
        body = calls[2][3].decode()
        self.assertTrue(calls[2][2].startswith('multipart/form-data; boundary='))
        self.assertIn('name="input"\r\nContent-Type: application/json\r\n\r\n{"message": "Hello"}', body)
        self.assertIn('name="file1"; filename="document-1.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF', body)


class StepTests(unittest.TestCase):
    def setUp(self):
        outer = self
        self.calls = []; self.links = ['escalate', 'provide_evidence', 'require_evidence', 'adjudicate']
        class Client(PayPal):
            def get_dispute(_, dispute_id):
                return {**PayPal.get_dispute(_, dispute_id), 'links': [{'rel': rel} for rel in outer.links]}
            def provide_dispute_evidence(_, dispute_id, notes, files): outer.calls.append(('evidence', notes, len(files)))
            def escalate_dispute(_, dispute_id, note): outer.calls.append(('escalate', note))
            def accept_dispute_claim(_, dispute_id, note): outer.calls.append(('accept', note))
            def sandbox_require_evidence(_, dispute_id): outer.calls.append(('require',))
            def sandbox_adjudicate(_, dispute_id, outcome): outer.calls.append(('adjudicate', outcome))
        class FileRepo(Repo):
            def document(_, document_id): return {'id': document_id, 'project_id': PROJECT, 'mime_type': 'application/pdf', 'size_bytes': 7}
            def download(_, document): return b'%PDF-1.'
        app = FastAPI()
        app.include_router(build_dispute_router(None, lambda: 'owner', FileRepo, DisputeReader(Client()), jobs=Jobs(), preferences=Preferences(), replies=replies))
        @app.exception_handler(ApiError)
        async def error(_, e): return JSONResponse({'error': {'code': e.code}}, status_code=e.status)
        self.client = TestClient(app)

    def post(self, path, body):
        return self.client.post(f'/api/v1/projects/{PROJECT}/disputes/{DISPUTE}/{path}', json=body)

    def test_each_step_reaches_paypal_with_its_input(self):
        self.assertEqual(self.post('evidence', {'notes': 'Delivered.', 'document_ids': [DOC]}).json()['data'], {'done': True, 'documents_sent': 1, 'documents_recorded': True, 'history_saved': True})
        self.post('escalate', {'note': 'Please review.'})
        self.post('sandbox', {'action': 'require_evidence'}); self.post('sandbox', {'action': 'seller_favor'}); self.post('sandbox', {'action': 'buyer_favor'})
        self.assertEqual(self.calls, [('evidence', 'Delivered.', 1), ('escalate', 'Please review.'), ('require',), ('adjudicate', 'SELLER_FAVOR'), ('adjudicate', 'BUYER_FAVOR')])

    def test_accepting_the_claim_needs_paypals_link_and_a_note(self):
        self.links = ['send_message']
        self.assertEqual(self.post('accept', {'note': 'Refund.'}).status_code, 409)
        self.links = ['accept_claim']
        self.assertEqual(self.post('accept', {'note': '  '}).status_code, 422)
        self.assertEqual(self.calls, [])
        self.assertEqual(self.post('accept', {'note': 'Refund.'}).status_code, 200)
        self.assertEqual(self.calls, [('accept', 'Refund.')])

    def test_a_step_needs_paypals_link_on_the_current_dispute_and_valid_input(self):
        self.links = ['send_message']
        for path, body in (('evidence', {'notes': 'x', 'document_ids': [DOC]}), ('escalate', {'note': 'x'}), ('sandbox', {'action': 'seller_favor'})):
            self.assertEqual(self.post(path, body).json()['error']['code'], 'DISPUTE_NOT_ACTIONABLE')
        self.links = ['provide_evidence', 'adjudicate']
        self.assertEqual(self.post('evidence', {'notes': 'x', 'document_ids': []}).status_code, 422)
        self.assertEqual(self.post('evidence', {'notes': '  ', 'document_ids': [DOC]}).status_code, 422)
        self.assertEqual(self.post('sandbox', {'action': 'anything'}).status_code, 422)
        self.assertEqual(self.calls, [])

    def test_evidence_request_follows_the_documented_sample(self):
        from paypal.client import PayPalSandboxClient, Response
        calls = []
        def transport(method, path, headers, body):
            calls.append((path, body))
            return Response(200, {'access_token': 'x', 'expires_in': 3600} if 'oauth2' in path else {'links': []})
        client = PayPalSandboxClient('id', 'secret', 'MERCHANT123', transport=transport)
        client.provide_dispute_evidence(DISPUTE, 'Delivered.', [('document-1.pdf', 'application/pdf', b'%PDF')])
        self.assertEqual(calls[1][0], f'/v1/customer/disputes/{DISPUTE}/provide-evidence')
        self.assertIn('{"evidences": [{"evidence_type": "OTHER", "notes": "Delivered."}]}', calls[1][1].decode())
        client.sandbox_adjudicate(DISPUTE, 'SELLER_FAVOR')
        self.assertEqual(calls[2], (f'/v1/customer/disputes/{DISPUTE}/adjudicate', b'{"adjudication_outcome": "SELLER_FAVOR"}'))


class DocumentLinkTests(unittest.TestCase):
    def setUp(self):
        outer = self
        self.rpcs = []; self.rpc_error = None
        class Client(PayPal):
            def send_dispute_message(_, dispute_id, message, files=()): pass
        class LinkRepo(Repo):
            def rpc(_, name, params):
                if outer.rpc_error: raise outer.rpc_error
                outer.rpcs.append((name, params)); return 1
            def document(_, document_id): return {'id': document_id, 'project_id': PROJECT, 'mime_type': 'application/pdf', 'size_bytes': 7}
            def download(_, document): return b'%PDF-1.'
        app = FastAPI()
        app.include_router(build_dispute_router(None, lambda: 'owner', LinkRepo, DisputeReader(Client()), jobs=Jobs(), preferences=Preferences(), replies=replies))
        @app.exception_handler(ApiError)
        async def error(_, e): return JSONResponse({'error': {'code': e.code}}, status_code=e.status)
        self.client = TestClient(app)

    def test_sending_and_uploading_record_the_link_with_its_role(self):
        sent = self.client.post(f'/api/v1/projects/{PROJECT}/disputes/{DISPUTE}/messages', json={'message': 'Hello', 'document_ids': [DOC]})
        self.assertTrue(sent.json()['data']['documents_recorded'])
        self.assertEqual(self.rpcs[0], ('record_dispute_documents', {'p_project': PROJECT, 'p_dispute': DISPUTE, 'p_documents': [DOC], 'p_role': 'sent'}))
        self.assertEqual(self.client.post(f'/api/v1/projects/{PROJECT}/disputes/{DISPUTE}/documents', json={'document_id': DOC}).json()['data'], {'linked': True})
        self.assertEqual(self.rpcs[1][1]['p_role'], 'uploaded')

    def test_a_failed_link_never_looks_like_a_failed_send_and_foreign_disputes_are_refused(self):
        self.rpc_error = ApiError('RPC_FAILED', 500)
        sent = self.client.post(f'/api/v1/projects/{PROJECT}/disputes/{DISPUTE}/messages', json={'message': 'Hello', 'document_ids': [DOC]})
        self.assertEqual((sent.json()['data']['message_sent'], sent.json()['data']['documents_recorded']), (True, False))
        self.rpc_error = None
        self.assertEqual(self.client.post(f'/api/v1/projects/{PROJECT}/disputes/PP-R-OTHER-1/documents', json={'document_id': DOC}).status_code, 404)
        self.assertEqual(self.client.post(f'/api/v1/projects/{PROJECT}/disputes/{DISPUTE}/documents', json={'document_id': 'nope'}).status_code, 422)
        self.assertEqual(self.rpcs, [])
