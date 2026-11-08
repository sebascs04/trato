from hashlib import sha256
import unittest

from fastapi.testclient import TestClient

from trato_api.app import create_app
from trato_api.client_portal import build_client_portal_router
from trato_api.errors import ApiError
from trato_api.portal_assistant import DAILY_QUESTIONS

TOKEN = 'a' * 64
OTHER = 'b' * 64
DIGEST = sha256(TOKEN.encode()).hexdigest()
JOB = '11111111-1111-4111-8111-111111111111'
JOB2 = '22222222-2222-4222-8222-222222222222'


class Store:
    def __init__(self, status='ready_for_review', is_current=True):
        self.status, self.is_current, self.requests = status, is_current, []

    def view(self, digest):
        if digest not in (DIGEST, sha256(OTHER.encode()).hexdigest()):
            raise ApiError('PORTAL_LINK_NOT_FOUND', 404)
        return {'link_id': 'internal-link', 'owner_id': 'internal-owner', 'proposal_id': 'internal-proposal', 'addendum_document_id': 'internal-doc',
                'project_name': 'Website', 'client_name': 'Aurora', 'revision_id': 'r', 'revision_no': 2, 'is_current': self.is_current,
                'scope_summary': 'Five products', 'conditions': '', 'currency': 'USD', 'additional_minor': 18000, 'deadline': '2026-11-20',
                'status': self.status, 'accepted_at': '2026-11-08' if self.status == 'accepted' else None, 'payment_status': None, 'change_request': None}

    def request_changes(self, digest, notes):
        self.requests.append(notes)


class Redis:
    def __init__(self): self.counts, self.keys = {}, set()
    def exists(self, key): return key in self.keys
    def incr(self, key): self.counts[key] = self.counts.get(key, 0) + 1; return self.counts[key]
    def expire(self, key, seconds): pass


class Jobs:
    def __init__(self): self.redis, self.rows = Redis(), {}
    def connection(self): return self.redis
    def enqueue(self, owner, job_id, data):
        self.rows[job_id] = {'owner': owner, 'input': data, 'status': 'queued'}
        self.redis.keys.add('trato:ai:job:' + job_id)
        return self.get(owner, job_id)
    def get(self, owner, job_id, action=None):
        row = self.rows.get(job_id)
        if row is None or row['owner'] != owner or (action and row['input']['workflow'] != action):
            raise ApiError('AI_NOT_FOUND', 404)
        return {'id': job_id, 'status': row['status'], **({'result': row['result']} if 'result' in row else {}), **({'error_code': row['error_code']} if 'error_code' in row else {})}
    def input(self, owner, job_id):
        self.get(owner, job_id)
        return self.rows[job_id]['input']


class Preferences:
    def configuration(self): return ['default-model'], 'default-model'


def result(**extra):
    return {'kind': 'portal_assistant', 'status': 'answered', 'answer': 'Five products.', 'sources': ['scope'], 'change_request': '', 'model': 'm', **extra}


class PortalAssistantRouteTests(unittest.TestCase):
    def setUp(self):
        self.store, self.jobs = Store(), Jobs()

    def client(self):
        app = create_app()
        app.router.routes = [r for r in app.router.routes if not getattr(r, 'path', '').startswith('/api/v1/portal')]
        app.include_router(build_client_portal_router(None, self.store, jobs=self.jobs, preferences=Preferences()))
        return TestClient(app)

    def ask(self, client, token=TOKEN, job=JOB, **extra):
        return client.post('/api/v1/portal/assistant', json={'token': token, 'job_id': job, 'question': 'What is included?', 'output_language': 'en', **extra})

    def test_the_model_only_receives_what_the_client_already_sees(self):
        with self.client() as client:
            response = self.ask(client)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['data'], {'id': JOB, 'status': 'queued'})
        sent = self.jobs.rows[JOB]
        self.assertEqual(sent['owner'], 'portal:' + DIGEST)
        self.assertEqual(sent['input']['workflow'], 'portal_assistant')
        self.assertEqual(sent['input']['model_id'], 'default-model')
        self.assertEqual(sent['input']['agreement']['scope'], 'Five products')
        self.assertTrue(sent['input']['agreement']['can_request_changes'])
        text = str(sent['input'])
        for hidden in ('internal-link', 'internal-owner', 'internal-proposal', 'internal-doc', TOKEN):
            self.assertNotIn(hidden, text)

    def test_only_the_same_link_reads_its_answer(self):
        with self.client() as client:
            self.ask(client)
            self.jobs.rows[JOB].update(status='completed', result=result())
            mine = client.post('/api/v1/portal/assistant-status', json={'token': TOKEN, 'job_id': JOB})
            other = client.post('/api/v1/portal/assistant-status', json={'token': OTHER, 'job_id': JOB})
        self.assertEqual(mine.status_code, 200)
        data = mine.json()['data']['result']
        self.assertEqual(data['answer'], 'Five products.')
        self.assertNotIn('model', data)
        self.assertEqual(other.status_code, 404)

    def test_an_invalid_link_cannot_ask_or_read(self):
        with self.client() as client:
            self.assertEqual(self.ask(client, token='c' * 64).status_code, 404)
            self.assertEqual(client.post('/api/v1/portal/assistant-status', json={'token': 'c' * 64, 'job_id': JOB}).status_code, 404)
        self.assertEqual(self.jobs.rows, {})

    def test_a_draft_is_rejected_once_the_addendum_cannot_change_and_nothing_is_sent(self):
        self.store.status = 'accepted'
        draft = result(status='draft_change', sources=[], change_request='Change the date')
        with self.client() as client:
            self.ask(client)
            self.assertFalse(self.jobs.rows[JOB]['input']['agreement']['can_request_changes'])
            self.jobs.rows[JOB].update(status='completed', result=draft)
            response = client.post('/api/v1/portal/assistant-status', json={'token': TOKEN, 'job_id': JOB})
        self.assertEqual(response.status_code, 502)
        self.assertEqual(self.store.requests, [])

    def test_a_valid_draft_reaches_the_client_but_is_never_sent_by_itself(self):
        draft = result(status='draft_change', sources=[], change_request='Change the date')
        with self.client() as client:
            self.ask(client)
            self.jobs.rows[JOB].update(status='completed', result=draft)
            response = client.post('/api/v1/portal/assistant-status', json={'token': TOKEN, 'job_id': JOB})
        self.assertEqual(response.json()['data']['result']['change_request'], 'Change the date')
        self.assertEqual(self.store.requests, [])

    def test_failures_stay_visible(self):
        with self.client() as client:
            self.ask(client)
            self.jobs.rows[JOB].update(status='failed', error_code='MODEL_REQUEST_FAILED')
            response = client.post('/api/v1/portal/assistant-status', json={'token': TOKEN, 'job_id': JOB})
        self.assertEqual(response.json()['data'], {'id': JOB, 'status': 'failed', 'error_code': 'MODEL_REQUEST_FAILED'})

    def test_invalid_questions_are_rejected_before_counting(self):
        with self.client() as client:
            for extra in ({'question': '   '}, {'question': 'x' * 1001}, {'output_language': 'fr'}, {'history': [{'role': 'assistant', 'text': 'x'}]}, {'history': 'x'}):
                self.assertEqual(self.ask(client, **extra).status_code, 422, extra)
        self.assertEqual(self.jobs.redis.counts, {})

    def test_a_superseded_version_gets_no_answers(self):
        self.store.status, self.store.is_current = 'superseded', False
        with self.client() as client:
            self.assertEqual(self.ask(client).status_code, 409)

    def test_daily_limit_counts_new_questions_only(self):
        with self.client() as client:
            self.ask(client)
            self.assertEqual(self.ask(client).status_code, 200)
            self.assertEqual(list(self.jobs.redis.counts.values()), [1])
            key = next(iter(self.jobs.redis.counts))
            self.jobs.redis.counts[key] = DAILY_QUESTIONS
            response = self.ask(client, job=JOB2)
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.json()['error']['code'], 'PORTAL_ASSISTANT_LIMIT')
        self.assertNotIn(JOB2, self.jobs.rows)
