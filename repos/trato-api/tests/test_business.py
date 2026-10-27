from hashlib import sha256
import unittest
from fastapi.testclient import TestClient

from trato_api.app import ApiError, Settings, create_app

PROJECT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
DOCUMENT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'


class Services:
    def authenticate(self, token):
        if token != 'Bearer user-a':
            raise ApiError('UNAUTHORIZED', 401)
        return 'user-a'

    def extract(self, data, filename, mime):
        return {'schema_version': 1, 'sha256': sha256(data).hexdigest(), 'segments': []}


class Repo:
    def __init__(self):
        self.calls = []

    def request_status(self,project_id):
        self.calls.append(('status',project_id));return {'can_register':False,'active_request':{'id':DOCUMENT},'closures':[]}

    def close_request(self,request_id,reason,notes):
        self.calls.append(('close',request_id,reason,notes));return {'request_document_id':request_id,'reason':reason}

    def soft_delete_client(self, client_id):
        self.calls.append(('delete-client',client_id))
        if client_id!=PROJECT:raise ApiError('CLIENT_NOT_FOUND',404)
        return {'id':client_id,'deleted_at':'2026-10-26T00:00:00Z'}

    def project(self, project_id):
        self.calls.append('authorize')
        if project_id != PROJECT:
            raise ApiError('PROJECT_NOT_FOUND', 404)

    def reserve(self, *args):
        self.calls.append('reserve')
        return {'document': {'id': DOCUMENT, 'original_filename': 'correo.pdf', 'mime_type': 'application/pdf'},
                'extraction': {'status': 'queued'}}

    def upload(self, document, data):
        self.calls.append('upload')

    def complete(self, document_id, result):
        self.calls.append('complete')

    def queue_document(self, document_id):
        self.calls.append('queue')
        return {'thread_id': DOCUMENT, 'status': 'queued'}

    def extraction(self, document_id):
        self.calls.append('read')
        return {'document': {'id': document_id}, 'extraction': {'status': 'ready'}, 'segments': []}


class BusinessTests(unittest.TestCase):
    def client(self, repo):
        return TestClient(create_app(services=Services(), repository_factory=lambda settings, token: repo))

    def test_upload_authorizes_persists_original_then_queues_without_extracting(self):
        repo = Repo()
        with self.client(repo) as client:
            response = client.post(f'/api/v1/projects/{PROJECT}/documents?filename=correo.pdf&title=Correo&kind=email_request',
                content=b'%PDF-', headers={'Authorization': 'Bearer user-a', 'Content-Type': 'application/pdf', 'Idempotency-Key': 'upload-1'})
        self.assertEqual(response.status_code, 202)
        self.assertTrue(response.json()['persisted'])
        self.assertEqual(repo.calls, ['authorize', 'reserve', 'upload', 'queue'])

    def test_foreign_project_is_rejected_before_reservation_or_upload(self):
        repo = Repo()
        with self.client(repo) as client:
            response = client.post(f'/api/v1/projects/{DOCUMENT}/documents?filename=correo.pdf&title=Correo',
                content=b'%PDF-', headers={'Authorization': 'Bearer user-a', 'Content-Type': 'application/pdf', 'Idempotency-Key': 'upload-1'})
        self.assertEqual(response.status_code, 404)
        self.assertEqual(repo.calls, ['authorize'])

    def test_upload_without_identity_never_reaches_repository(self):
        repo = Repo()
        with self.client(repo) as client:
            response = client.post(f'/api/v1/projects/{PROJECT}/documents?filename=correo.pdf&title=Correo')
        self.assertEqual(response.status_code, 401)
        self.assertFalse(repo.calls)

    def test_client_cannot_inject_owner(self):
        with self.client(Repo()) as client:
            response = client.post('/api/v1/clients', json={'name': 'Ana', 'owner_id': 'another-owner'},
                                   headers={'Authorization': 'Bearer user-a'})
        self.assertEqual(response.status_code, 422)

    def test_public_config_refuses_admin_key(self):
        with TestClient(create_app(Settings(supabase_key='sb_secret_private'))) as client:
            response = client.get('/api/v1/config')
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('sb_secret', response.text)


if __name__ == '__main__':
    unittest.main()


class DeleteClientTests(unittest.TestCase):
    def client(self,repo):
        return TestClient(create_app(services=Services(),repository_factory=lambda settings,token:repo))
    def test_authentication_and_uuid_precede_mutation(self):
        repo=Repo()
        with self.client(repo) as client:
            self.assertEqual(client.post(f'/api/v1/clients/{PROJECT}/delete').status_code,401)
            self.assertEqual(client.post('/api/v1/clients/invalid/delete',headers={'Authorization':'Bearer user-a'}).status_code,422)
        self.assertEqual(repo.calls,[])
    def test_deletion_uses_authenticated_repository_and_returns_persisted_time(self):
        repo=Repo()
        with self.client(repo) as client:
            result=client.post(f'/api/v1/clients/{PROJECT}/delete',headers={'Authorization':'Bearer user-a'})
        self.assertEqual(result.status_code,200)
        self.assertEqual(result.json()['data']['id'],PROJECT)
        self.assertEqual(repo.calls,[('delete-client',PROJECT)])
    def test_foreign_client_is_not_found(self):
        with self.client(Repo()) as client:
            self.assertEqual(client.post(f'/api/v1/clients/{DOCUMENT}/delete',headers={'Authorization':'Bearer user-a'}).status_code,404)


class RequestLifecycleTests(unittest.TestCase):
    def client(self,repo):return TestClient(create_app(services=Services(),repository_factory=lambda settings,token:repo))
    def test_status_requires_session_and_valid_project_id(self):
        repo=Repo()
        with self.client(repo) as client:
            self.assertEqual(client.get(f'/api/v1/projects/{PROJECT}/request-status').status_code,401)
            self.assertEqual(client.get('/api/v1/projects/bad/request-status',headers={'Authorization':'Bearer user-a'}).status_code,422)
            result=client.get(f'/api/v1/projects/{PROJECT}/request-status',headers={'Authorization':'Bearer user-a'})
        self.assertEqual(repo.calls,[('status',PROJECT)])
        self.assertFalse(result.json()['data']['can_register'])
    def test_closure_needs_explicit_reason_and_notes(self):
        repo=Repo()
        with self.client(repo) as client:
            for data in [{'reason':'paid','notes':'x'},{'reason':'rejected','notes':''},{'reason':'withdrawn','notes':'x','owner_id':'foreign'}]:
                self.assertEqual(client.post(f'/api/v1/requests/{DOCUMENT}/close',headers={'Authorization':'Bearer user-a'},json=data).status_code,422)
            self.assertEqual(repo.calls,[])
            result=client.post(f'/api/v1/requests/{DOCUMENT}/close',headers={'Authorization':'Bearer user-a'},json={'reason':'withdrawn','notes':'El cliente retiró el pedido'})
        self.assertEqual(result.status_code,200)
        self.assertEqual(repo.calls,[('close',DOCUMENT,'withdrawn','El cliente retiró el pedido')])
