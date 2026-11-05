"""Refund preparation uses persisted relationships, never document classification guesses.

All fixtures are local. These checks do not invoke a model, database or vector service.
"""
from copy import deepcopy
import json
from unittest import TestCase

from trato_api.errors import ApiError
from trato_api.file_processing import purpose_context


OWNER = '10000000-0000-4000-8000-000000000001'
PROJECT = '10000000-0000-4000-8000-000000000002'
CLIENT = '10000000-0000-4000-8000-000000000003'
DOCUMENT = '10000000-0000-4000-8000-000000000004'
CASE = '10000000-0000-4000-8000-000000000005'
SNAPSHOT = '10000000-0000-4000-8000-000000000006'
PAYMENT = '10000000-0000-4000-8000-000000000007'
OTHER = '10000000-0000-4000-8000-000000000008'


class Repo:
    """Small repository double that actually enforces query filters."""
    def __init__(self):
        self.calls = []
        common = {'owner_id': OWNER, 'project_id': PROJECT}
        self.tables = {
            'refund_settlements': [{**common, 'id': CASE, 'payment_id': PAYMENT,
                'scope': 'payment_only', 'reason': 'Client requested project closure',
                'requested_by': 'customer', 'status': 'draft', 'current_snapshot_id': SNAPSHOT,
                'request_evidence': [], 'confirmed_refund_minor': None}],
            'refund_snapshots': [{**common, 'id': SNAPSHOT, 'settlement_id': CASE,
                'version_no': 1, 'draft_sequence': 1, 'terms': {'scope_summary': 'Project closure'},
                'breakdown': {'refund_minor': 12000}, 'payments': [], 'content_sha256': 'c' * 64}],
            'refund_settlement_payments': [{**common, 'settlement_id': CASE, 'payment_id': PAYMENT}],
            'project_received_payments': [{**common, 'id': PAYMENT, 'origin': 'initial',
                'amount_minor': 20000, 'currency': 'USD', 'verified_at': '2026-11-01T12:00:00Z',
                'capture_id': 'private-capture-id', 'merchant_id': 'private-merchant-id'}],
            'refund_artifacts': [], 'refund_sources': [], 'refund_acceptances': [],
            'refund_feedback': [], 'file_processing_options': [],
        }

    def rows(self, table, params):
        self.calls.append((table, deepcopy(params)))
        result = deepcopy(self.tables.get(table, []))
        for key, condition in params.items():
            if key in ('select', 'order', 'limit', 'offset'):
                continue
            def value(row):
                current = row
                for part in key.replace('->>', '->').split('->'):
                    current = current.get(part) if isinstance(current, dict) else None
                return current
            if condition.startswith('eq.'):
                result = [row for row in result if str(value(row)) == condition[3:]]
            elif condition == 'is.null':
                result = [row for row in result if value(row) is None]
            elif condition.startswith('in.('):
                allowed = condition[4:-1].split(',')
                result = [row for row in result if str(value(row)) in allowed]
            elif condition.startswith('cs.'):
                subset = json.loads(condition[3:])
                def contains(current, expected):
                    if isinstance(expected, dict):
                        return isinstance(current, dict) and all(
                            key in current and contains(current[key], entry) for key, entry in expected.items())
                    if isinstance(expected, list):
                        return isinstance(current, list) and all(
                            any(contains(candidate, entry) for candidate in current) for entry in expected)
                    return current == expected
                result = [row for row in result if contains(value(row), subset)]
            else:
                raise AssertionError((key, condition))
        selected = params.get('select', '*')
        if selected != '*':
            result = [{key: row[key] for key in selected.split(',') if key in row} for row in result]
        return result

    def link(self, table, **fields):
        self.tables[table].append({'owner_id': OWNER, 'project_id': PROJECT,
            'settlement_id': CASE, 'snapshot_id': SNAPSHOT, **fields})


class RefundFileContextTests(TestCase):
    def setUp(self):
        self.repo = Repo()
        self.project = {'id': PROJECT, 'owner_id': OWNER, 'client_id': CLIENT}
        self.source = {'document': {'id': DOCUMENT, 'kind': 'reference', 'sha256': 'd' * 64},
            'extraction': {'id': OTHER, 'result_hash': 'e' * 64}, 'generation': 'f' * 64,
            'segments': [{'segment_id': 's1', 'text': 'Refund proposed: USD 120.'}]}

    def context(self):
        return purpose_context(self.repo, OWNER, self.project, self.source)

    def assert_refund_evidence(self, result):
        self.assertEqual(result['purpose'], 'refund_evidence')
        self.assertEqual(result['bindings']['refund_case_id'], CASE)
        self.assertEqual(result['bindings']['payment_id'], PAYMENT)
        self.assertTrue(result['reference_context'].get('case_description'))
        self.assertEqual(result['output_language'], 'es')

    def test_generated_refund_pdf_resolves_case_and_verified_initial_payment(self):
        self.repo.link('refund_artifacts', document_id=DOCUMENT, sha256='d' * 64)
        self.assert_refund_evidence(self.context())
        self.assertIn('project_received_payments', [table for table, _ in self.repo.calls])

    def test_acceptance_and_feedback_documents_keep_refund_context(self):
        for table in ('refund_acceptances', 'refund_feedback'):
            with self.subTest(table=table):
                self.repo = Repo()
                self.repo.link(table, evidence={'document_id': DOCUMENT, 'document_sha256': 'd' * 64})
                self.assert_refund_evidence(self.context())

    def test_request_evidence_uses_refund_request_with_authorized_payment(self):
        self.repo.tables['refund_settlements'][0]['request_evidence'] = [
            {'document_id': DOCUMENT, 'document_sha256': 'd' * 64}]
        result = self.context()
        self.assertEqual(result['purpose'], 'refund_request')
        self.assertEqual(result['bindings']['refund_case_id'], CASE)
        self.assertEqual(result['bindings']['payment_id'], PAYMENT)

    def test_refund_supporting_source_resolves_authorized_case(self):
        self.repo.link('refund_sources', document_id=DOCUMENT, extraction_id=OTHER,
            document_sha256='d' * 64, extraction_result_hash='e' * 64, quote='Refund proposed')
        self.assert_refund_evidence(self.context())

    def test_document_text_alone_does_not_reclassify_as_refund(self):
        result = self.context()
        self.assertEqual(result['purpose'], 'supporting_reference')
        self.assertEqual(result['bindings'], {})

    def test_foreign_project_or_owner_link_does_not_change_document_purpose(self):
        for field in ('project_id', 'owner_id'):
            with self.subTest(field=field):
                self.repo = Repo()
                self.repo.link('refund_artifacts', document_id=DOCUMENT, **{field: OTHER})
                self.assertEqual(self.context()['purpose'], 'supporting_reference')

    def test_linked_refund_with_missing_case_is_rejected(self):
        self.repo.link('refund_artifacts', document_id=DOCUMENT)
        self.repo.tables['refund_settlements'] = []
        with self.assertRaises(ApiError):
            self.context()

    def test_linked_refund_with_missing_payment_is_rejected(self):
        self.repo.link('refund_artifacts', document_id=DOCUMENT)
        self.repo.tables['project_received_payments'] = []
        with self.assertRaises(ApiError):
            self.context()

    def test_linked_refund_cannot_use_payment_without_verification(self):
        self.repo.link('refund_artifacts', document_id=DOCUMENT)
        self.repo.tables['project_received_payments'][0]['verified_at'] = None
        with self.assertRaises(ApiError):
            self.context()

    def test_linked_refund_cannot_use_unrelated_payment(self):
        self.repo.link('refund_artifacts', document_id=DOCUMENT)
        self.repo.tables['refund_settlement_payments'] = []
        with self.assertRaises(ApiError):
            self.context()

    def test_ambiguous_case_links_fail_instead_of_selecting_first_case(self):
        self.repo.link('refund_sources', document_id=DOCUMENT)
        self.repo.link('refund_sources', document_id=DOCUMENT, settlement_id=OTHER)
        other_case = deepcopy(self.repo.tables['refund_settlements'][0])
        other_case['id'] = OTHER
        self.repo.tables['refund_settlements'].append(other_case)
        with self.assertRaisesRegex(ApiError, 'FILE_PURPOSE_CONTEXT_INVALID'):
            self.context()

    def test_refund_context_fingerprint_tracks_authorized_case_description(self):
        self.repo.link('refund_artifacts', document_id=DOCUMENT)
        before = self.context()
        self.repo.tables['refund_settlements'][0]['reason'] = 'Mutually agreed project cancellation'
        after = self.context()
        self.assertNotEqual(before['selection_fingerprint'], after['selection_fingerprint'])

    def test_reused_initial_agreement_retains_original_purpose(self):
        self.source['document']['kind'] = 'initial_agreement'
        self.repo.link('refund_sources', document_id=DOCUMENT, extraction_id=OTHER,
            document_sha256='d' * 64, extraction_result_hash='e' * 64, quote='Project agreement')
        self.assertEqual(self.context()['purpose'], 'initial_agreement')

    def test_project_closure_includes_every_verified_member_payment(self):
        self.repo.link('refund_artifacts', document_id=DOCUMENT)
        self.repo.tables['refund_settlements'][0]['scope'] = 'project_closure'
        self.repo.tables['refund_settlement_payments'].append({
            'owner_id': OWNER, 'project_id': PROJECT, 'settlement_id': CASE, 'payment_id': OTHER})
        self.repo.tables['project_received_payments'].append({
            'owner_id': OWNER, 'project_id': PROJECT, 'id': OTHER, 'origin': 'change',
            'amount_minor': 3000, 'currency': 'USD', 'verified_at': '2026-11-02T12:00:00Z'})
        result = self.context()
        self.assert_refund_evidence(result)
        context = json.loads(result['reference_context']['case_description'])
        self.assertEqual({payment['id'] for payment in context['verified_received_payments']}, {PAYMENT, OTHER})
        self.assertNotIn('private-capture-id', json.dumps(context))
        self.assertNotIn('private-merchant-id', json.dumps(context))
        self.repo.tables['project_received_payments'].pop()
        with self.assertRaises(ApiError):
            self.context()

    def test_explicit_options_cannot_downgrade_canonical_refund_document(self):
        self.repo.link('refund_artifacts', document_id=DOCUMENT)
        self.repo.tables['file_processing_options'] = [{
            'document_id': DOCUMENT, 'output_language': 'es',
            'purpose': 'supporting_reference', 'bindings': {}}]
        with self.assertRaisesRegex(ApiError, 'FILE_PURPOSE_CONTEXT_INVALID'):
            self.context()

    def test_explicit_options_cannot_select_another_cases_payment(self):
        self.repo.link('refund_artifacts', document_id=DOCUMENT)
        self.repo.tables['file_processing_options'] = [{
            'document_id': DOCUMENT, 'output_language': 'es', 'purpose': 'refund_evidence',
            'bindings': {'refund_case_id': CASE, 'payment_id': OTHER}}]
        with self.assertRaisesRegex(ApiError, 'FILE_PURPOSE_CONTEXT_INVALID'):
            self.context()
