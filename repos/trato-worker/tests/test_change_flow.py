import copy
import json
from pathlib import Path
import socket
import tempfile
import unittest
from unittest.mock import patch
from uuid import uuid4
from trato_worker.threads import ThreadWorker

ROOT = Path(__file__).resolve().parent.parent

class ChangeFlowTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'changes.sqlite'
        self.worker = ThreadWorker(self.path, mode='simulation')
        self.message = json.loads((ROOT / 'examples/document-upload.thread.json').read_text())
        self.message.update(workflow='manage_change', thread_id=str(uuid4()), event_id=str(uuid4()))
        self.message['payload'] = {'request_id': str(uuid4()), 'fixture_id': 'extra',
                                   'project_brief': 'Web de presentación en español.', 'baseline_reviewed': True}
        self.review = {'action': 'approve_proposal', 'scope': 'Tienda y versión en inglés.',
                       'amount_cents': 45000, 'currency': 'USD', 'due_date': '2026-11-13',
                       'terms': 'El adicional corresponde al alcance revisado.'}

    def start(self):
        self.response = self.worker.handle(self.message)
        return self.response['result']

    def resume(self, action):
        message = copy.deepcopy(self.message)
        message.update(action='resume', event_id=str(uuid4()), payload={
            'interrupt_id': self.response['result']['pending']['interrupt_id'], 'input': action})
        self.response = self.worker.handle(message)
        return self.response['result']

    def draft(self):
        self.start()
        return self.resume(self.review)

    def test_existing_project_pauses_before_drafting_and_payment_requires_confirmation(self):
        with patch.object(socket.socket, 'connect', side_effect=AssertionError('No network')):
            result = self.start()
            self.assertEqual(result['pending']['stage'], 'review_proposal')
            self.assertEqual(result['analysis']['new_request'], 'Añadir tienda y versión en inglés.')
            self.assertEqual(result['revisions'], [])
            result = self.resume(self.review)
            self.assertEqual(result['pending']['stage'], 'send_revision')
            result = self.resume({'action': 'simulate_send'})
            self.assertEqual(result['pending']['stage'], 'client_decision')
            result = self.resume({'action': 'accept'})
            self.assertEqual(result['pending']['stage'], 'confirm_payment')
            self.assertFalse(result['read_only'])
            result = self.resume({'action': 'simulate_verified_payment'})
            self.assertEqual(result['status'], 'ready')
            self.assertTrue(result['read_only'])
            self.assertFalse(result['provider_verified'])
            self.assertNotIn('cancelled', json.dumps(result))
            self.assertFalse(result['revisions'][0]['pdf_generated'])

    def test_new_project_requires_baseline_review_before_analysis(self):
        self.message['payload']['baseline_reviewed'] = False
        result = self.start()
        self.assertEqual(result['pending']['stage'], 'review_baseline')
        self.assertIsNone(result['analysis'])
        result = self.resume({'action': 'confirm_baseline'})
        self.assertEqual(result['pending']['stage'], 'review_proposal')

    def test_client_feedback_creates_new_revision_without_inheriting_send_or_acceptance(self):
        result = self.draft()
        original = copy.deepcopy(result['revisions'][0])
        self.resume({'action': 'simulate_send'})
        result = self.resume({'action': 'request_revision', 'feedback_notes': 'Sólo tienda, sin inglés.', 'feedback_document_id': str(uuid4())})
        self.assertEqual(result['analysis']['client_feedback'], 'Sólo tienda, sin inglés.')
        self.assertEqual(result['pending']['stage'], 'review_proposal')
        adjusted = {**self.review, 'scope': 'Sólo tienda.', 'amount_cents': 25000}
        result = self.resume(adjusted)
        self.assertEqual(result['pending']['stage'], 'send_revision')
        self.assertEqual(result['revisions'][0], original)
        self.assertEqual([r['version'] for r in result['revisions']], [1, 2])
        self.assertNotEqual(result['revisions'][1]['content_sha256'], original['content_sha256'])
        newest = result['revisions'][1]['revision_id']
        self.assertFalse(any(e['revision_id'] == newest and e['event'] in ('revision_sent','revision_accepted') for e in result['events']))

    def test_restart_and_redelivery_do_not_duplicate_drafts(self):
        result = self.draft()
        expected = result['revisions']
        self.worker = ThreadWorker(self.path, mode='simulation')
        self.message['event_id'] = str(uuid4())
        result = self.start()
        self.assertEqual(result['revisions'], expected)
        self.assertEqual(result['pending']['stage'], 'send_revision')
        message = copy.deepcopy(self.message)
        message.update(action='resume', event_id=str(uuid4()), payload={
            'interrupt_id': result['pending']['interrupt_id'], 'input': {'action': 'simulate_send'}})
        first = self.worker.handle(message)
        second = ThreadWorker(self.path, mode='simulation').handle(message)
        self.assertEqual(first, second)

    def test_invalid_and_stale_approval_do_not_advance_checkpoint(self):
        result = self.start()
        old_id = result['pending']['interrupt_id']
        with self.assertRaises(ValueError): self.resume({'action': 'simulate_verified_payment'})
        self.resume(self.review)
        stale = copy.deepcopy(self.message)
        stale.update(action='resume', event_id=str(uuid4()), payload={'interrupt_id': old_id, 'input': self.review})
        with self.assertRaises(ValueError): self.worker.handle(stale)
        self.assertEqual(self.resume({'action': 'simulate_send'})['pending']['stage'], 'client_decision')

    def test_paid_request_cannot_resume_or_restart_in_another_thread(self):
        self.draft(); self.resume({'action': 'simulate_send'}); self.resume({'action': 'accept'})
        self.resume({'action': 'simulate_verified_payment'})
        message = copy.deepcopy(self.message)
        message.update(action='resume', event_id=str(uuid4()), payload={'interrupt_id': 'old', 'input': self.review})
        with self.assertRaises(ValueError): self.worker.handle(message)
        message = copy.deepcopy(self.message)
        message.update(thread_id=str(uuid4()), event_id=str(uuid4()))
        with self.assertRaises(ValueError): self.worker.handle(message)

    def test_zero_additional_and_rejection_are_separate_endings(self):
        self.start(); self.resume({**self.review, 'amount_cents': 0})
        self.resume({'action': 'simulate_send'})
        result = self.resume({'action': 'accept'})
        self.assertEqual(result['status'], 'ready')
        self.assertFalse(any(e['event'] == 'payment_confirmed' for e in result['events']))
        self.message.update(thread_id=str(uuid4()), event_id=str(uuid4()))
        self.message['payload']['request_id'] = str(uuid4())
        self.draft(); self.resume({'action': 'simulate_send'})
        self.assertEqual(self.resume({'action': 'reject', 'feedback_notes': 'No continuar.'})['status'], 'rejected')

    def test_ambiguous_and_unrelated_do_not_generate_a_proposal(self):
        for case, status in [('unclear','needs_clarification'), ('unrelated','not_relevant')]:
            self.message.update(thread_id=str(uuid4()), event_id=str(uuid4()))
            self.message['payload'].update(request_id=str(uuid4()), fixture_id=case)
            result = self.start()
            self.assertEqual(result['status'], status)
            self.assertEqual(result['revisions'], [])

    def test_unsent_draft_edits_keep_version_and_preserve_internal_snapshots(self):
        first = self.draft()
        original = copy.deepcopy(first['revisions'][0])
        result = self.resume({**self.review, 'action': 'edit_draft', 'amount_cents': 39000})
        self.assertEqual(result['pending']['stage'], 'send_revision')
        self.assertEqual(len(result['revisions']), 1)
        latest = result['revisions'][0]
        self.assertEqual((latest['version'], latest['draft_sequence']), (1, 2))
        self.assertEqual(latest['revision_id'], original['revision_id'])
        self.assertNotEqual(latest['snapshot_id'], original['snapshot_id'])
        self.assertEqual(result['draft_snapshots'][0], original)
        self.assertEqual([s['proposal']['amount_cents'] for s in result['draft_snapshots']], [45000, 39000])
        self.assertTrue(result['events'][-1]['internal'])
        result = self.resume({**self.review, 'action': 'edit_draft', 'amount_cents': 35000})
        self.assertEqual(result['revisions'][0]['draft_sequence'], 3)
        self.assertEqual(len(result['revisions']), 1)
        self.assertEqual(len(result['draft_snapshots']), 3)
        result = self.resume({'action': 'simulate_send'})
        self.assertEqual(result['events'][-1]['snapshot_id'], result['revisions'][0]['snapshot_id'])
        self.assertEqual(result['events'][-1]['content_sha256'], result['revisions'][0]['content_sha256'])

    def test_client_revision_requires_notes_and_document_before_advancing(self):
        self.draft(); self.resume({'action': 'simulate_send'})
        for payload in ({'action': 'request_revision', 'feedback_notes': 'Cambiar precio.'},
                        {'action': 'request_revision', 'feedback_document_id': str(uuid4())},
                        {'action': 'request_revision', 'feedback_notes': 'Cambiar precio.', 'feedback_document_id': 'wrong'}):
            with self.assertRaises(ValueError): self.resume(payload)
        feedback_id = str(uuid4())
        result = self.resume({'action': 'request_revision', 'feedback_notes': 'Sólo tienda.', 'feedback_document_id': feedback_id})
        self.assertEqual(result['analysis']['feedback_document_id'], feedback_id)
        result = self.resume({**self.review, 'scope': 'Sólo tienda.'})
        self.assertEqual(result['revisions'][-1]['version'], 2)
        self.assertEqual(result['revisions'][-1]['feedback_document_id'], feedback_id)

    def test_sent_draft_cannot_be_edited_in_client_or_payment_stages(self):
        self.draft(); self.resume({'action': 'simulate_send'})
        with self.assertRaises(ValueError): self.resume({**self.review, 'action': 'edit_draft'})
        self.resume({'action': 'accept'})
        with self.assertRaises(ValueError): self.resume({**self.review, 'action': 'edit_draft'})
        result = self.resume({'action': 'simulate_verified_payment'})
        self.assertEqual(len(result['draft_snapshots']), 1)
        self.assertTrue(result['read_only'])

    def test_unsent_edit_is_idempotent_across_restart_and_rejects_stale_send(self):
        result = self.draft()
        old_id = result['pending']['interrupt_id']
        message = copy.deepcopy(self.message)
        message.update(action='resume', event_id=str(uuid4()), payload={
            'interrupt_id': old_id, 'input': {**self.review, 'action': 'edit_draft', 'amount_cents': 37000}})
        first = self.worker.handle(message)
        self.worker = ThreadWorker(self.path, mode='simulation')
        self.assertEqual(self.worker.handle(message), first)
        self.assertEqual(len(first['result']['draft_snapshots']), 2)
        stale = copy.deepcopy(message)
        stale.update(event_id=str(uuid4()), payload={'interrupt_id': old_id, 'input': {'action': 'simulate_send'}})
        with self.assertRaises(ValueError): self.worker.handle(stale)
        self.response = first
        result = self.resume({'action': 'simulate_send'})
        self.assertEqual(result['events'][-1]['snapshot_id'], first['result']['revisions'][0]['snapshot_id'])

    def test_editing_v2_preserves_sent_v1_and_only_replaces_v2_head(self):
        initial = self.draft()['revisions'][0]
        self.resume({'action': 'simulate_send'})
        self.resume({'action': 'request_revision', 'feedback_notes': 'Menos alcance.', 'feedback_document_id': str(uuid4())})
        self.resume({**self.review, 'scope': 'Sólo tienda.'})
        result = self.resume({**self.review, 'action': 'edit_draft', 'scope': 'Tienda sin productos cargados.', 'amount_cents': 25000})
        self.assertEqual(result['revisions'][0], initial)
        self.assertEqual([(r['version'],r['draft_sequence']) for r in result['revisions']], [(1,1),(2,2)])
        self.assertEqual([r['version'] for r in result['draft_snapshots']], [1,2,2])
