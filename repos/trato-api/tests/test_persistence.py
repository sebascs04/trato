from hashlib import sha256
import unittest
import httpx

from trato_api.app import Settings
from trato_api.errors import ApiError
from trato_api.persistence import Repository

DOC = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
PROJECT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
CLIENT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'


class PersistenceTests(unittest.TestCase):
    def repo(self, handler):
        return Repository(Settings(supabase_url='https://test.supabase.co', supabase_key='sb_publishable_test'),
                          'Bearer user-a', transport=httpx.MockTransport(handler))

    def test_all_requests_keep_user_identity_and_do_not_use_admin_key(self):
        def handler(request):
            self.assertEqual(request.headers['authorization'], 'Bearer user-a')
            self.assertEqual(request.headers['apikey'], 'sb_publishable_test')
            return httpx.Response(200, json=[])
        self.assertEqual(self.repo(handler).list_clients(), [])

    def test_project_directory_is_filtered_to_the_selected_client(self):
        def handler(request):
            self.assertEqual(request.url.params['client_id'], 'eq.'+CLIENT)
            self.assertEqual(request.headers['authorization'], 'Bearer user-a')
            return httpx.Response(200,json=[])
        self.assertEqual(self.repo(handler).list_projects(CLIENT), [])

    def test_absent_or_foreign_document_is_404(self):
        with self.assertRaises(ApiError) as error:
            self.repo(lambda request: httpx.Response(200, json=[])).document(DOC)
        self.assertEqual(error.exception.status, 404)

    def test_document_groups_use_database_links_without_loading_text_or_other_projects(self):
        calls = []
        def handler(request):
            calls.append(request)
            self.assertEqual(request.headers['authorization'], 'Bearer user-a')
            if request.url.path.endswith('/projects'):
                return httpx.Response(200, json=[{'id': PROJECT, 'client_id': CLIENT}])
            self.assertEqual(request.url.params['project_id'], 'eq.' + PROJECT)
            selection = request.url.params['select']
            self.assertIn('request_document_id', selection)
            self.assertIn('proposal_acceptances_returned_document_id', selection)
            self.assertNotIn('segments', selection)
            revision = {'revision_no': 2, 'proposal': {'request_document_id': DOC}}
            return httpx.Response(200, json=[
                {'id': 'pdf', 'proposal_artifacts': [{'revision_id': 'revision-2', 'revision': revision}]},
                {'id': 'returned', 'acceptances': [{'review': {'revision': revision}}]},
                {'id': 'feedback', 'feedback': [revision]},
                {'id': 'unlinked', 'proposal_artifacts': []}])
        result = self.repo(handler).list_documents(PROJECT)
        self.assertEqual(len(calls), 2)
        for index, role in enumerate(('addendum', 'acceptance', 'feedback')):
            self.assertEqual(result[index]['request_links'], [{'request_document_id': DOC, 'revision_no': 2, 'role': role}])
        self.assertEqual(result[0]['proposal_artifacts'], [{'revision_id': 'revision-2'}])
        self.assertEqual(result[3]['request_links'], [])
        self.assertNotIn('acceptances', result[1])

    def test_owner_is_not_inserted_from_browser_or_app_claims(self):
        def handler(request):
            import json
            body = json.loads(request.content)
            self.assertEqual(set(body), {'name', 'contact_email'})
            return httpx.Response(201, json=[{'id': CLIENT, **body}])
        self.assertEqual(self.repo(handler).create_client('Ana', None)['id'], CLIENT)

    def test_source_context_derives_client_from_project_and_paginates(self):
        offsets = []
        def handler(request):
            path = request.url.path
            if path.endswith('/documents'):
                return httpx.Response(200, json=[{'id': DOC, 'project_id': PROJECT, 'owner_id': 'user-a', 'sha256': 'a'*64}])
            if path.endswith('/projects'):
                return httpx.Response(200, json=[{'id': PROJECT, 'client_id': CLIENT}])
            if path.endswith('/document_extractions'):
                return httpx.Response(200, json=[{'id': 'extraction-1', 'status': 'ready'}])
            offset = int(request.url.params['offset']); offsets.append(offset)
            count = 1000 if offset == 0 else 1
            return httpx.Response(200, json=[{'id': f'segment-{offset+i}', 'ordinal': offset+i+1,
                'locator_kind': 'paragraph', 'locator_number': offset+i+1, 'text': 'Contenido'} for i in range(count)])
        result = self.repo(handler).extraction(DOC)
        self.assertEqual(len(result['segments']), 1001)
        self.assertEqual(offsets, [0, 1000])
        context = result['segments'][-1]['source_context']
        self.assertEqual(context['client_id'], CLIENT)
        self.assertEqual(context['project_id'], PROJECT)
        self.assertEqual(context['document_revision'], 'a'*64)

    def test_duplicate_upload_checks_bytes_and_never_upserts(self):
        original = b'%PDF-'
        document = {'storage_path': 'owner/project/source.pdf', 'mime_type': 'application/pdf',
                    'sha256': sha256(original).hexdigest(), 'size_bytes': len(original)}
        def handler(request):
            if request.method == 'POST':
                self.assertEqual(request.headers['x-upsert'], 'false')
                return httpx.Response(409, json={'message': 'Already exists'})
            return httpx.Response(200, content=original)
        self.repo(handler).upload(document, original)

    def test_download_validates_original_hash(self):
        doc = {'storage_path': 'owner/project/source.pdf', 'sha256': 'a'*64, 'size_bytes': 5}
        with self.assertRaises(ApiError) as error:
            self.repo(lambda request: httpx.Response(200, content=b'%PDF-')).download(doc)
        self.assertEqual(error.exception.code, 'ORIGINAL_HASH_MISMATCH')


if __name__ == '__main__':
    unittest.main()
