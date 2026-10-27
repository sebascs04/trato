import copy
import json
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from uuid import uuid4
from trato_worker.ingestion import chunk_segments
from trato_worker.threads import ThreadWorker

ROOT = Path(__file__).resolve().parent.parent
EXAMPLE = json.loads((ROOT / 'examples/document-upload.thread.json').read_text())

class IngestionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'simulation.sqlite'
        self.worker = ThreadWorker(self.path, mode='simulation')
        self.message = copy.deepcopy(EXAMPLE)

    def test_graph_without_model_or_network_keeps_every_source_reference(self):
        with patch.object(socket.socket, 'connect', side_effect=AssertionError('No network')):
            result = self.worker.handle(self.message)
        self.assertEqual(result['mode'], 'simulation')
        self.assertEqual(result['action'], 'completed')
        self.assertEqual(result['result']['steps'], ['validate_context', 'extract_text', 'validate_relevance', 'prepare_chunks', 'ready'])
        self.assertEqual(result['result']['chunk_count'], 2)
        self.assertEqual(result['result']['index_status'], 'not_indexed')
        self.assertFalse(result['result']['identity_verified'])
        for chunk in result['result']['chunks']:
            for key, value in self.message['context'].items(): self.assertEqual(chunk[key], value)
            self.assertEqual(chunk['document_id'], self.message['payload']['document_id'])
            self.assertEqual(chunk['extraction_id'], self.message['payload']['extraction_id'])
            self.assertEqual(chunk['locator']['kind'], 'page')

    def test_unreadable_keeps_reference_without_becoming_ready(self):
        self.message['payload']['fixture_id'] = 'unreadable'
        result = self.worker.handle(self.message)
        self.assertEqual(result['action'], 'failed')
        self.assertEqual(result['result']['error_code'], 'UNREADABLE_FILE')
        self.assertEqual(result['result']['steps'], ['validate_context'])
        self.assertNotIn('chunks', result['result'])
        self.assertEqual(result['result']['document']['document_id'], self.message['payload']['document_id'])

    def test_word_uses_paragraphs(self):
        self.message['payload']['filename'] = 'conversacion.docx'
        result = self.worker.handle(self.message)
        self.assertTrue(all(c['locator']['kind'] == 'paragraph' for c in result['result']['chunks']))

    def test_duplicate_command_does_not_extract_again_after_restart(self):
        from trato_worker.ingestion import simulate_extraction
        with patch('trato_worker.ingestion.simulate_extraction', wraps=simulate_extraction) as extract:
            first = self.worker.handle(self.message)
            second = ThreadWorker(self.path, mode='simulation').handle(self.message)
            self.assertEqual(first, second)
            self.message['event_id'] = str(uuid4())
            third = ThreadWorker(self.path, mode='simulation').handle(self.message)
            self.assertEqual(first['result'], third['result'])
            self.assertEqual(extract.call_count, 1)

    def test_thread_cannot_move_to_another_owner_client_or_project(self):
        self.worker.handle(self.message)
        for key in ('owner_id', 'client_id', 'project_id'):
            other = copy.deepcopy(self.message)
            other.update(action='get', event_id=str(uuid4()), payload={})
            other['context'][key] = str(uuid4())
            with self.assertRaises(PermissionError): self.worker.handle(other)

    def test_ids_cannot_replace_payload(self):
        self.worker.handle(self.message)
        self.message['payload']['document_id'] = str(uuid4())
        with self.assertRaises(ValueError): self.worker.handle(self.message)
        self.message['event_id'] = str(uuid4())
        with self.assertRaises(ValueError): self.worker.handle(self.message)

    def test_invalid_mode_handler_or_metadata_does_not_execute(self):
        for key, value in [('mode', 'real'), ('workflow', '__import__'), ('action', 'execute_python')]:
            invalid = copy.deepcopy(self.message); invalid[key] = value
            with self.assertRaises(ValueError): self.worker.handle(invalid)
        invalid = copy.deepcopy(self.message); invalid['payload']['filename'] = '../secrets.pdf'
        with self.assertRaises(ValueError): self.worker.handle(invalid)
        self.assertFalse(self.path.exists())
        with self.assertRaises(ValueError): ThreadWorker(self.path, mode='real')

    def test_chunks_have_exact_offsets_and_stable_ids(self):
        text = 'ábcde ' * 400
        extraction = {'segments': [{'index': 3, 'locator': {'kind': 'page', 'page': 3}, 'text': text}]}
        chunks = chunk_segments(extraction, self.message['payload'], self.message['context'])
        self.assertGreater(len(chunks), 2)
        self.assertEqual(chunks, chunk_segments(extraction, self.message['payload'], self.message['context']))
        for chunk in chunks:
            self.assertEqual(chunk['text'], text[chunk['start_char']:chunk['end_char']])
            self.assertEqual(chunk['locator']['page'], 3)
        self.assertEqual(chunks[-1]['end_char'], len(text))

    def test_process_restart_reads_the_same_persisted_thread(self):
        command = [sys.executable, '-m', 'trato_worker.ingest', '--mode', 'simulation', '--transport', 'stdio', '--database', str(self.path)]
        def invoke(message):
            run = subprocess.run(command, input=json.dumps(message), text=True, capture_output=True, cwd=ROOT, timeout=20, check=True)
            return json.loads(run.stdout)['data']
        first = invoke(self.message)
        self.message.update(action='get', event_id=str(uuid4()), payload={})
        second = invoke(self.message)
        self.assertEqual(first['result'], second['result'])

    def test_unrelated_or_unclear_document_is_held_before_chunking(self):
        for fixture, status in [('unrelated_document', 'not_relevant'), ('unclear_document', 'needs_clarification')]:
            message = copy.deepcopy(self.message)
            message.update(thread_id=str(uuid4()), event_id=str(uuid4()))
            message['payload']['fixture_id'] = fixture
            result = self.worker.handle(message)
            self.assertEqual(result['action'], 'held')
            self.assertEqual(result['result']['status'], status)
            self.assertEqual(result['result']['chunk_count'], 0)
            self.assertNotIn('prepare_chunks', result['result']['steps'])
            self.assertNotIn('ready', result['result']['steps'])
            evidence = result['result']['relevance']['evidence'][0]
            self.assertIn(evidence['quote'], result['result']['extraction']['segments'][0]['text'])
            self.assertEqual(result['context'], message['context'])

    def test_valid_first_request_is_saved_but_requires_baseline_before_analysis(self):
        self.message['payload'].update(fixture_id='new_request', kind='email_request')
        result = self.worker.handle(self.message)['result']
        self.assertEqual(result['status'], 'ready')
        self.assertEqual(result['relevance']['detected_kind'], 'email_request')
        self.assertIn('provide_initial_agreement_before_analysis', result['relevance']['follow_up'])
        self.assertGreater(result['chunk_count'], 0)

    def test_change_mislabeled_as_initial_source_is_not_silently_reclassified(self):
        self.message['payload']['fixture_id'] = 'new_request'
        result = self.worker.handle(self.message)['result']
        self.assertEqual(result['status'], 'needs_clarification')
        self.assertIn('confirm_document_kind', result['relevance']['needs'])
        self.assertEqual(result['document']['kind'], 'initial_agreement')
        self.assertEqual(result['chunk_count'], 0)

    def test_change_with_reference_and_correct_kind_can_continue(self):
        self.message['payload'].update(fixture_id='new_request', kind='email_request', baseline_revision_id=str(uuid4()))
        result = self.worker.handle(self.message)['result']
        self.assertEqual(result['status'], 'ready')
        self.assertEqual(result['relevance']['verdict'], 'accepted')
