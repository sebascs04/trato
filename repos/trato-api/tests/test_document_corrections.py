import unittest

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

from trato_api.document_corrections import DocumentCorrections, build_document_corrections_router
from trato_api.errors import ApiError

OWNER = '11111111-1111-4111-8111-111111111111'
PROJECT = '22222222-2222-4222-8222-222222222222'
DOC = '33333333-3333-4333-8333-333333333333'


class Repo:
    def __init__(self, owner=OWNER):
        self.owner, self.calls = owner, []

    def project(self, project):
        return {'id': project, 'owner_id': self.owner}

    def rpc(self, name, data):
        self.calls.append((name, data))
        if name == 'project_document_backend':
            if data['p_document'] == 'in-use':
                raise ApiError('DOCUMENT_IN_USE', 409)
            if data['p_action'] == 'withdraw':
                return {'file_id': data['p_document'], 'client_id': 'client', 'cleanup_status': 'pending'}
            if data['p_action'] == 'cleaned':
                return {'file_id': data['p_document'], 'client_id': 'client', 'cleanup_status': 'complete'}
            return {'file_id': data['p_document'], 'kind': data['p_kind']}
        return None


class Lock:
    def acquire(self, blocking=False):
        return True

    def owned(self):
        return True

    def release(self):
        pass


class Gateway:
    def __init__(self):
        self.removed = []
        self.store = self
        self.registry = self

    def connection(self):
        return self

    def lock(self, *args, **kwargs):
        return Lock()

    def delete(self, key):
        self.removed.append(('receipt', key))

    def receipt_key(self, owner, file_id):
        return owner + ':' + file_id

    def remove_file(self, owner, client, project, document):
        self.removed.append(('vectors', document))

    def remove(self, owner, document):
        self.removed.append(('registry', document))


class DocumentCorrectionTests(unittest.TestCase):
    def client(self, repo, gateway):
        service = DocumentCorrections(None, store=type('S', (), {'repo': repo})(), gateway=gateway)
        app = FastAPI()
        app.include_router(build_document_corrections_router(None, lambda: OWNER, lambda *args: repo, service))

        @app.exception_handler(ApiError)
        async def error(_, e):
            return JSONResponse({'error': {'code': e.code}}, status_code=e.status)
        return TestClient(app)

    def test_removing_purges_search_and_resyncs_the_map(self):
        repo, gateway = Repo(), Gateway()
        response = self.client(repo, gateway).delete(f'/api/v1/projects/{PROJECT}/documents/{DOC}')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['data']['cleanup_status'], 'complete')
        self.assertEqual({kind for kind, _ in gateway.removed}, {'vectors', 'registry', 'receipt'})
        self.assertIn(('project_graph', {'p_project_id': PROJECT, 'p_action': 'sync'}), repo.calls)

    def test_role_change_is_validated_and_resyncs_the_map(self):
        repo = Repo()
        client = self.client(repo, Gateway())
        self.assertEqual(client.patch(f'/api/v1/projects/{PROJECT}/documents/{DOC}', json={'kind': 'contract'}).status_code, 422)
        response = client.patch(f'/api/v1/projects/{PROJECT}/documents/{DOC}', json={'kind': 'reference'})
        self.assertEqual(response.json()['data']['kind'], 'reference')
        self.assertIn(('project_graph', {'p_project_id': PROJECT, 'p_action': 'sync'}), repo.calls)

    def test_another_owner_and_used_documents_are_refused(self):
        stranger = Repo(owner='someone-else')
        self.assertEqual(self.client(stranger, Gateway()).delete(f'/api/v1/projects/{PROJECT}/documents/{DOC}').status_code, 404)
        self.assertFalse(any(name == 'project_document_backend' for name, _ in stranger.calls))


if __name__ == '__main__':
    unittest.main()
