"""A one-step refund sends its record PDF to processing, so TeTrato's questions and the map never wait for it."""
import os
import unittest
from unittest import mock

from trato_api.refunds.financial_routes import queued_refund_pdf


class Repo:
    def __init__(self):
        self.queued = []

    def queue_document(self, document_id):
        self.queued.append(document_id)
        return {'status': 'queued'}

    def document(self, document_id):
        return {'id': document_id, 'project_id': 'project-1'}

    def rows(self, table, params):
        return [{'document_id': 'doc-1'}]  # options already remembered


class QueuedRefundPdfTests(unittest.TestCase):
    def test_the_saved_record_pdf_is_queued_for_processing(self):
        saved = []
        def save(repo, owner, settlement, snapshot, language, key):
            saved.append((settlement, snapshot, language, key))
            return {'artifact': {'document_id': 'doc-1'}}
        repo = Repo()
        with mock.patch.dict(os.environ, {'TRATO_FILE_PROCESSING_ENABLED': 'false'}):
            result = queued_refund_pdf(None, save)(repo, 'owner-1', 'settlement-1', 'snapshot-1', 'en', 'key-pdf')
        self.assertEqual(saved, [('settlement-1', 'snapshot-1', 'en', 'key-pdf')])
        self.assertEqual(repo.queued, ['doc-1'])
        self.assertEqual(result['artifact']['document_id'], 'doc-1')

    def test_with_file_processing_known_options_are_kept_and_the_pdf_is_still_queued(self):
        repo = Repo()
        save = lambda *args: {'artifact': {'document_id': 'doc-1'}}
        with mock.patch.dict(os.environ, {'TRATO_FILE_PROCESSING_ENABLED': 'true'}), \
             mock.patch('trato_api.file_processing.remember_options') as remember:
            queued_refund_pdf(None, save)(repo, 'owner-1', 'settlement-1', 'snapshot-1', 'en', 'key-pdf')
        remember.assert_not_called()
        self.assertEqual(repo.queued, ['doc-1'])

    def test_a_failed_save_queues_nothing(self):
        repo = Repo()
        def save(*args):
            raise RuntimeError('REFUND_PDF_LANGUAGE_LOCKED')
        with self.assertRaises(RuntimeError):
            queued_refund_pdf(None, save)(repo, 'owner-1', 'settlement-1', 'snapshot-1', 'en', 'key-pdf')
        self.assertEqual(repo.queued, [])


if __name__ == '__main__':
    unittest.main()
