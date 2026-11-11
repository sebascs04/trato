"""A dispute on a plan stage payment gets the same TeTrato response as an addendum payment, built from the stage's own
records: what it promised, the file delivered, the client's approval in Trato and PayPal's capture."""
import unittest

from trato_api.disputes import stage_evidence_pack, validate_defense
from trato_api.errors import ApiError

OWNER = '33333333-3333-4333-8333-333333333333'
PROJECT = '44444444-4444-4444-8444-444444444444'
DELIVERED = '55555555-5555-4555-8555-555555555555'
PAYMENT = {'origin': 'initial', 'capture_id': 'CAPTURE300', 'verified_at': '2026-11-10T23:16:00+00:00'}


class Repo:
    def __init__(self, tables):
        self.tables, self.calls = tables, []

    def rows(self, table, params):
        self.calls.append((table, params))
        return [dict(r) for r in self.tables.get(table, [])]


def freelancer(**changes):
    tables = {
        'project_start_stages': [{'title': 'Website Development', 'deliverables': 'Five responsive sections',
                                  'payment_condition': 'Payable when the client approves the staging site', 'amount': '300.00'}],
        'project_start_plans': [{'summary': 'Website for Café Aurora in three stages.', 'created_at': '2026-11-10T20:00:00+00:00'}],
        'documents': [{'id': DELIVERED, 'title': 'Deliverable 2 acknowledgment'}],
        'project_stage_delivery_shares': [{'document_id': DELIVERED, 'shared_at': '2026-11-10T23:13:00+00:00'}],
        'project_stage_reviews': [{'decision': 'approved', 'notes': '', 'created_at': '2026-11-10T23:14:00+00:00'}]}
    tables.update(changes)
    return Repo(tables)


def checkouts(status='completed'):
    return Repo({'project_initial_checkouts': [{'stage_position': 2, 'status': status, 'capture_id': 'CAPTURE300',
                                                'amount_minor': 30000, 'currency': 'USD', 'paid_at': '2026-11-10T23:16:00+00:00'}]})


class StageDefenseTests(unittest.TestCase):
    def test_evidence_covers_promise_delivery_approval_and_payment(self):
        server = checkouts()
        evidence = stage_evidence_pack(freelancer(), server, OWNER, PROJECT, PAYMENT)
        self.assertEqual([e['kind'] for e in evidence], ['stage', 'stage_delivery', 'stage_approval', 'payment'])
        self.assertIn('Payment condition: Payable when the client approves the staging site', evidence[0]['text'])
        self.assertEqual(evidence[1]['document_id'], DELIVERED)
        self.assertIn('2026-11-10 18:14 Peru time', evidence[2]['text'])
        self.assertIn('USD 300.00 for plan stage 2', evidence[3]['text'])
        # The service-role read is always scoped to the signed-in owner, the project and the disputed capture.
        params = server.calls[0][1]
        self.assertEqual((params['owner_id'], params['project_id'], params['capture_id']),
                         ('eq.' + OWNER, 'eq.' + PROJECT, 'eq.CAPTURE300'))

    def test_client_contact_details_never_enter_the_evidence(self):
        repo = freelancer(project_stage_reviews=[{'decision': 'changes_requested', 'notes': 'Fix the menu', 'created_at': '2026-11-10T23:14:00+00:00',
                                                  'client_email': 'client@example.com'}])
        evidence = stage_evidence_pack(repo, checkouts(), OWNER, PROJECT, PAYMENT)
        self.assertNotIn('client@example.com', ' '.join(e['text'] for e in evidence))
        self.assertEqual(evidence[2]['kind'], 'stage_review')
        self.assertIn('Client notes: Fix the menu', evidence[2]['text'])

    def test_unpaid_or_unknown_stage_is_not_defended(self):
        for server in (checkouts('pending'), Repo({'project_initial_checkouts': []})):
            with self.subTest(server=server.tables):
                with self.assertRaises(ApiError) as caught:
                    stage_evidence_pack(freelancer(), server, OWNER, PROJECT, PAYMENT)
                self.assertEqual(caught.exception.code, 'DISPUTE_EVIDENCE_UNAVAILABLE')

    def test_withdrawn_delivery_files_are_left_out(self):
        evidence = stage_evidence_pack(freelancer(documents=[]), checkouts(), OWNER, PROJECT, PAYMENT)
        self.assertNotIn('stage_delivery', [e['kind'] for e in evidence])

    def test_the_delivered_file_is_recommended_for_sending(self):
        evidence = stage_evidence_pack(freelancer(), checkouts(), OWNER, PROJECT, PAYMENT)
        data = {'dispute_id': 'PP-R-1', 'dispute': {'actions': ['send_message']}, 'evidence': evidence}
        result = {'kind': 'dispute_defense', 'dispute_id': 'PP-R-1', 'assessment': 'strong', 'summary': 'The client approved this delivery.',
                  'recommended_action': 'send_message', 'response_message': 'Hello, you approved stage 2 in Trato.',
                  'points': [{'claim': 'The client approved it', 'evidence_id': 'review-1',
                              'quote': "The client approved the delivery of stage 2"}],
                  'gaps': [], 'documents': [], 'model': 'test'}
        documents = [{'id': DELIVERED, 'title': 'Deliverable 2 acknowledgment', 'kind': 'delivery', 'mime_type': 'application/pdf', 'size_bytes': 1000}]
        output = validate_defense(result, data, {}, documents)
        self.assertEqual(output['points'][0]['kind'], 'stage_approval')
        self.assertTrue(output['documents'][0]['recommended'])


if __name__ == '__main__':
    unittest.main()
