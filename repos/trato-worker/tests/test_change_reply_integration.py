"""Exercise the proposal-scoped reply job from HTTP through the model contract."""
import json
import unittest
from types import SimpleNamespace
from uuid import uuid4

from fastapi import APIRouter, FastAPI
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

from trato_api.change_reply import mount_change_reply
from trato_api.errors import ApiError
from trato_worker.change_reply import run_change_reply
from trato_worker.source_tools import ToolError

from change_proposal_test_support import Jobs, OWNER, OTHER, PROJECT, PROPOSAL, REVISION


class ChangeReplyTests(unittest.TestCase):
    def setUp(self):
        self.owner = OWNER
        self.jobs = Jobs()
        self.message = {'id': str(uuid4()), 'revision_id': REVISION, 'delivery_id': str(uuid4()),
                        'reply_text': 'Please deliver on November 25.',
                        'body_text': 'Please deliver on November 25.\n\n> Earlier proposal', 'used_at': None}
        self.snapshot = {
            'proposal': {'owner_id': OWNER, 'project_id': PROJECT, 'current_revision_id': REVISION,
                         'locked_at': None, 'status': 'ready_for_review'},
            'revision': {'scope_summary': 'Payment button', 'conditions': 'Sandbox only',
                         'additional_minor': 6000, 'currency': 'USD', 'deadline': '2026-11-30'},
            'deliveries': [{'kind': 'adenda', 'status': 'accepted_by_gmail', 'id': self.message['delivery_id']}],
            'line_items': [{'description': 'Payment button', 'quantity': 1, 'unit_amount_minor': 6000}],
        }
        self.output = {'classification': 'adjustments', 'summary': 'The client asked for an earlier delivery.',
                       'quote': 'Please deliver on November 25.', 'analysis': 'The same button must be ready five days earlier.', 'draft': {
                           'scope_summary': 'Payment button', 'conditions': 'Sandbox only', 'description': 'Payment button',
                           'estimated_extra_hours': '0', 'estimated_extra_minor': 0, 'deadline': '2026-11-25', 'deadline_basis': 'requested'}}
        self.path = f'/api/v1/proposals/{PROPOSAL}/gmail-replies/{self.message["id"]}/analysis'
        app = FastAPI()
        router = APIRouter(prefix='/api/v1')
        repo = SimpleNamespace(get_revision=lambda *args, **kw: self.snapshot)
        workflow = SimpleNamespace(gmail_replies=lambda *args: [self.message])
        preferences = SimpleNamespace(for_request=lambda *args: 'test-model')
        mount_change_reply(router, lambda: repo, lambda: self.owner, workflow, jobs=self.jobs, preferences=preferences)
        app.include_router(router)

        @app.exception_handler(ApiError)
        async def error(_, exc):
            return JSONResponse({'error': exc.code}, status_code=exc.status)

        self.client = TestClient(app)

    def enqueue(self):
        return self.client.post(self.path, json={'revision_id': REVISION, 'output_language': 'en'},
                                headers={'Idempotency-Key': str(uuid4())})

    def poll(self, job_id):
        return self.client.get('/api/v1/ai/change-replies/' + job_id)

    def complete(self):
        response = self.enqueue()
        self.assertEqual(response.status_code, 202, response.text)
        job_id = response.json()['data']['id']

        def generate(messages, schema):
            payload = json.loads(messages[-1]['content'])
            self.assertEqual(payload['reply_text'], self.message['reply_text'])
            self.assertEqual(payload['sent_terms']['additional_minor'], 6000)
            self.assertEqual(payload['output_language'], 'en')
            self.assertEqual(set(payload), {'reply_text', 'sent_terms', 'output_language'})
            return self.output

        self.jobs.finish(job_id, run_change_reply(self.jobs.input(OWNER, job_id),
                                                  SimpleNamespace(generate=generate)))
        return job_id

    def test_adjustments_include_exact_quote_and_editable_terms(self):
        response = self.poll(self.complete())
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()['data']['result']
        self.assertEqual(result['classification'], 'adjustments')
        self.assertEqual(result['quote'], self.message['reply_text'])
        self.assertEqual(result['message_id'], self.message['id'])
        self.assertEqual(result['draft']['scope_summary'], 'Payment button')
        self.assertNotIn('additional_minor', result['draft'])
        self.assertEqual(result['base_amount_minor'], 6000)
        self.assertEqual(result['proposed_amount_minor'], 6000)
        self.assertEqual(result['proposed_deadline'], '2026-11-25')
        self.assertIn('five days earlier', result['analysis'])

    def test_estimated_new_work_is_added_to_the_sent_total(self):
        self.output['draft'].update(estimated_extra_hours='1.50', estimated_extra_minor=1800)
        response = self.poll(self.complete())
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['data']['result']['proposed_amount_minor'], 7800)

    def test_acceptance_and_ambiguity_are_advisory_without_draft(self):
        for classification, body in [('acceptance', 'I accept this version.'), ('ambiguous', 'See attached.')]:
            with self.subTest(classification=classification):
                self.message.update(reply_text=body, body_text=body)
                self.output.update(classification=classification, quote=body, draft=None)
                result = self.poll(self.complete()).json()['data']['result']
                self.assertEqual(result['classification'], classification)
                self.assertIsNone(result['draft'])

    def test_foreign_or_mismatched_delivery_is_rejected_before_inference(self):
        self.owner = OTHER
        self.assertEqual(self.enqueue().status_code, 409)
        self.owner = OWNER
        self.message['delivery_id'] = str(uuid4())
        self.assertEqual(self.enqueue().status_code, 409)
        self.assertFalse(self.jobs.records)

    def test_fabricated_quote_and_stale_revision_are_rejected(self):
        job_id = self.complete()
        data = self.jobs.input(OWNER, job_id)
        fabricated = {**self.output, 'quote': 'I approve this price.'}
        with self.assertRaisesRegex(ToolError, 'AI_INVALID_CITATION'):
            run_change_reply(data, SimpleNamespace(generate=lambda *_: fabricated))
        self.jobs.finish(job_id, {'kind': 'change_reply', **fabricated})
        self.assertEqual(self.poll(job_id).status_code, 502)
        self.snapshot['proposal']['current_revision_id'] = str(uuid4())
        self.assertEqual(self.poll(job_id).status_code, 409)
