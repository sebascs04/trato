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

    def test_project_creation_key_reuses_only_the_same_creation_command(self):
        import json
        stored = {}
        def handler(request):
            if request.url.path.endswith('/clients'):return httpx.Response(200,json=[{'id':CLIENT}])
            if request.method=='POST':
                data=json.loads(request.content)
                self.assertNotIn('owner_id',data)
                self.assertEqual(data['id'],PROJECT)
                if stored:return httpx.Response(409,json={'code':'23505'})
                stored.update(data);return httpx.Response(201,json=[dict(stored)])
            return httpx.Response(200,json=[dict(stored)])
        repo=self.repo(handler)
        self.assertEqual(repo.create_project(CLIENT,'Project',PROJECT)['id'],PROJECT)
        self.assertEqual(repo.create_project(CLIENT,'Project',PROJECT)['id'],PROJECT)
        with self.assertRaises(ApiError) as error:repo.create_project(CLIENT,'Different project',PROJECT)
        self.assertEqual(error.exception.code,'PROJECT_CREATION_CONFLICT')

    def test_project_creation_key_cannot_read_foreign_conflicts(self):
        def handler(request):
            if request.url.path.endswith('/clients'):return httpx.Response(200,json=[{'id':CLIENT}])
            if request.method=='POST':return httpx.Response(409,json={'code':'23505'})
            return httpx.Response(200,json=[])
        with self.assertRaises(ApiError) as error:self.repo(handler).create_project(CLIENT,'Project',PROJECT)
        self.assertEqual(error.exception.status,404)

    def test_project_creation_network_failure_is_not_treated_as_success(self):
        calls=[]
        def handler(request):
            calls.append(request.method)
            if request.url.path.endswith('/clients'):return httpx.Response(200,json=[{'id':CLIENT}])
            raise httpx.ConnectError('unavailable')
        with self.assertRaises(ApiError) as error:self.repo(handler).create_project(CLIENT,'Project',PROJECT)
        self.assertEqual(error.exception.status,503)
        self.assertEqual(calls,['GET','POST'])

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
                return httpx.Response(200, json=[{'id': PROJECT, 'client_id': CLIENT, 'owner_id':'owner-a'}])
            if request.url.path.rsplit('/', 1)[-1] in ('document_upload_contexts','project_dispute_documents','refund_settlements','file_processing_artifacts'):
                self.assertEqual(request.url.params['owner_id'],'eq.owner-a')
                self.assertEqual(request.url.params['project_id'],'eq.'+PROJECT)
                return httpx.Response(200,json=[])
            if request.url.path.rsplit('/', 1)[-1] in ('refund_artifacts', 'refund_acceptances', 'refund_feedback'):
                key='document_id' if request.url.path.endswith('/refund_artifacts') else 'evidence->>document_id'
                self.assertEqual(request.url.params[key],'in.(pdf,returned,feedback,unlinked)')
                return httpx.Response(200, json=[])
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
        self.assertEqual(len(calls), 9)
        for index, role in enumerate(('addendum', 'acceptance', 'feedback')):
            self.assertEqual(result[index]['request_links'], [{'request_document_id': DOC, 'revision_no': 2, 'role': role}])
        self.assertEqual(result[0]['proposal_artifacts'], [{'revision_id': 'revision-2'}])
        self.assertEqual(result[3]['request_links'], [])
        self.assertNotIn('acceptances', result[1])

    def test_document_reads_that_only_need_the_documents_run_at_the_same_time(self):
        import threading
        together=('document_upload_contexts','project_dispute_documents','file_processing_artifacts','refund_artifacts','refund_acceptances','refund_feedback','refund_settlements')
        # The barrier opens only if all seven are in flight at once; one after another it times out and fails.
        barrier=threading.Barrier(len(together),timeout=5)
        def handler(request):
            table=request.url.path.rsplit('/',1)[-1]
            if table=='projects':return httpx.Response(200,json=[{'id':PROJECT,'client_id':CLIENT,'owner_id':'owner-a'}])
            if table=='documents':return httpx.Response(200,json=[{'id':DOC,'kind':'reference'}])
            self.assertIn(table,together)
            barrier.wait()
            return httpx.Response(200,json=[])
        self.assertEqual(self.repo(handler).list_documents(PROJECT)[0]['id'],DOC)

    def test_a_failed_document_read_is_an_error_and_never_a_partial_list(self):
        def handler(request):
            table=request.url.path.rsplit('/',1)[-1]
            if table=='projects':return httpx.Response(200,json=[{'id':PROJECT,'client_id':CLIENT,'owner_id':'owner-a'}])
            if table=='documents':return httpx.Response(200,json=[{'id':DOC,'kind':'reference'}])
            return httpx.Response(500 if table=='refund_feedback' else 200,json=[])
        with self.assertRaises(ApiError) as error:
            self.repo(handler).list_documents(PROJECT)
        self.assertEqual(error.exception.code,'PERSISTENCE_UNAVAILABLE')

    def test_refund_documents_keep_their_own_version_and_do_not_become_paid_addenda(self):
        def handler(request):
            self.assertEqual(request.headers['authorization'], 'Bearer user-a')
            table=request.url.path.rsplit('/',1)[-1]
            data={
                'projects':[{'id':PROJECT,'client_id':CLIENT,'owner_id':'owner-a'}],
                'documents':[{'id':DOC,'project_id':PROJECT,'kind':'addendum'}],
                'refund_artifacts':[{'document_id':DOC,'snapshot_id':'snapshot-v2','settlement_id':'refund'}],
                'project_dispute_documents':[], 'refund_acceptances':[], 'refund_feedback':[], 'document_upload_contexts':[], 'refund_settlements':[{'id':'refund','request_evidence':[],'created_at':'2026-11-02T12:00:00Z'}], 'file_processing_artifacts':[],
                'refund_snapshots':[{'id':'snapshot-v2','version_no':2}],
            }
            if table.startswith('refund_') and table!='refund_settlements':
                self.assertNotIn('body_text',request.url.params['select'])
                self.assertIn('in.',str(request.url.params))
            return httpx.Response(200,json=data[table])
        result=self.repo(handler).list_documents(PROJECT)
        self.assertEqual(result[0]['request_links'],[])
        self.assertEqual(result[0]['refund_links'],[{'settlement_id':'refund','snapshot_id':'snapshot-v2','version_no':2,'role':'proposal','case_created_at':'2026-11-02T12:00:00Z'}])

    def test_uploaded_adjustments_are_grouped_before_the_next_revision_is_saved(self):
        def handler(request):
            table=request.url.path.rsplit('/',1)[-1]
            data={
                'projects':[{'id':PROJECT,'client_id':CLIENT,'owner_id':'owner-a'}],
                'documents':[{'id':DOC,'kind':'reference','feedback':[]}],
                'project_dispute_documents':[],
                'document_upload_contexts':[{'document_id':DOC,'project_id':PROJECT,'owner_id':'owner-a',
                    'purpose':'addendum_adjustments','request_document_id':'request-a','revision_id':'revision-v1'}],
                'proposal_revisions':[{'id':'revision-v1','revision_no':1}],
                'refund_artifacts':[],'refund_acceptances':[],'refund_feedback':[],'refund_settlements':[], 'file_processing_artifacts':[],
            }
            return httpx.Response(200,json=data[table])
        result=self.repo(handler).list_documents(PROJECT)
        self.assertEqual(result[0]['request_links'],[{'request_document_id':'request-a','revision_no':1,'role':'feedback'}])
        self.assertNotIn('owner_id',result[0]['upload_context'])

    def test_reservation_sends_structural_context_in_the_same_rpc_without_owner_claims(self):
        def handler(request):
            import json
            if request.url.path.endswith('/projects'):
                return httpx.Response(200,json=[{'id':PROJECT,'client_id':CLIENT,'owner_id':'owner-a'}])
            self.assertTrue(request.url.path.endswith('/rpc/reserve_document_with_context'))
            data=json.loads(request.content)
            self.assertEqual(data['p_context'],{'purpose':'addendum_adjustments','revision_id':'rev-a'})
            self.assertNotIn('owner_id',data)
            self.assertEqual(request.headers['authorization'],'Bearer user-a')
            return httpx.Response(200,json={'document':{'id':DOC}})
        self.repo(handler).reserve(PROJECT,'Adjustments','reference','a.pdf','application/pdf',b'%PDF-','idempotent-a',
            context={'purpose':'addendum_adjustments','revision_id':'rev-a'})

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
                return httpx.Response(200, json=[{'id': PROJECT, 'client_id': CLIENT, 'owner_id':'owner-a'}])
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
