import unittest
from unittest.mock import patch

from trato_api.errors import ApiError
from trato_api.initial_payments import stages
from trato_api.initial_payments.stages import StagePayments

PROJECT, FILE, OWNER = 'project-1', 'file-1', 'owner-1'


class Repo:
    def __init__(self, approved):
        self.approved, self.queries = approved, []

    def project(self, project):
        return {'id': project, 'owner_id': OWNER}

    def rows(self, table, query):
        self.queries.append((table, query))
        if table == 'project_start_stages':
            return [{'position': 1, 'title': 'Build', 'amount': '10.00', 'payment_condition': 'After approval'}]
        if table == 'document_upload_contexts':
            return [{'stage_position': 1, 'purpose': 'delivery_evidence'}]
        if table == 'project_stage_reviews':
            return [{'decision': 'approved'}] if self.approved else []
        return []


class Gateway:
    # Trato's own reading of the PDF is not ready (for example, it asked for clarification).
    def receipt(self, owner, file_id):
        return None

    def summary(self, repo, file):
        return None


class ApprovedEvidenceTests(unittest.TestCase):
    """The client's approval of a delivery is enough to charge it, even when Trato's reading of the PDF is not ready."""

    def payments(self):
        item = StagePayments.__new__(StagePayments)
        item.position, item.gateway = 1, Gateway()
        return item

    def prepare(self, repo):
        data = {'evidence_document_id': FILE, 'output_language': 'en'}
        with patch.object(stages, 'source', lambda *args: {'generation': 'g1'}), \
             patch.object(stages.InitialPayments, 'prepare', lambda self, repo, owner, project, data, key: data):
            return self.payments().prepare_stage(repo, OWNER, PROJECT, data, 'key')

    def test_unread_evidence_is_refused_without_the_clients_approval(self):
        with self.assertRaises(ApiError) as caught:
            self.prepare(Repo(approved=False))
        self.assertEqual(caught.exception.code, 'PLAN_EVIDENCE_NOT_READY')

    def test_the_delivery_the_client_approved_can_be_charged(self):
        repo = Repo(approved=True)
        prepared = self.prepare(repo)
        self.assertEqual(prepared['evidence_document_id'], FILE)
        self.assertEqual(prepared['amount_minor'], 1000)
        table, query = repo.queries[-1]
        self.assertEqual(table, 'project_stage_reviews')
        self.assertEqual((query['document_id'], query['stage_position'], query['decision']), ('eq.' + FILE, 'eq.1', 'eq.approved'))


if __name__ == '__main__':
    unittest.main()
