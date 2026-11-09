import unittest
from trato_api.proposals.repository import ProposalRepository

PROJECT, REVISION = 'project-1', 'revision-1'


class Store(ProposalRepository):
    def __init__(self, status='ready_for_review', requests=(), locked=None):
        self.status, self.requests, self.locked = status, list(requests), locked
    def project(self, project_id): return {'id': project_id}
    def rows(self, table, params):
        return [{'id': 'proposal-1', 'project_id': PROJECT, 'request_document_id': 'doc', 'current_revision_id': REVISION, 'status': self.status, 'locked_at': self.locked, 'created_at': 'x'}]
    def _read_parallel(self, queries):
        self.queries = queries
        return {'revisions': [{'id': REVISION, 'revision_no': 1, 'additional_minor': 100}], 'placements': [], 'artifacts': [{'revision_id': REVISION}],
                'deliveries': [{'revision_id': REVISION, 'kind': 'adenda', 'status': 'accepted_by_gmail'}], 'closures': [], 'portal_requests': self.requests}


class BusinessStatusTests(unittest.TestCase):
    def status(self, *args, **kwargs):
        return Store(*args, **kwargs).list_proposals(PROJECT)[0]['business_status']

    def test_a_sent_addendum_waits_for_the_client(self):
        self.assertEqual(self.status(), 'Esperando respuesta')

    def test_once_the_client_asked_for_changes_it_is_the_freelancers_turn(self):
        self.assertEqual(self.status(requests=[{'revision_id': REVISION}]), 'Cambios pedidos por el cliente')

    def test_a_request_on_another_version_does_not_count(self):
        self.assertEqual(self.status(requests=[{'revision_id': 'older'}]), 'Esperando respuesta')

    def test_only_requests_no_version_has_answered_are_read(self):
        store = Store()
        store.list_proposals(PROJECT)
        self.assertEqual(store.queries['portal_requests'][1]['used_at'], 'is.null')

    def test_later_states_win(self):
        self.assertEqual(self.status(status='accepted', requests=[{'revision_id': REVISION}]), 'Pendiente de pago')
        self.assertEqual(self.status(locked='2026-11-08', requests=[{'revision_id': REVISION}]), 'Finalizado')
