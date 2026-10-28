"""Read scheduling must keep authorization, revision scope and provider states intact."""
import threading
import unittest
import httpx
from trato_api.app import Settings
from trato_api.errors import ApiError
from trato_api.proposals.repository import ProposalRepository

PROPOSAL='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
REVISION='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
PROJECT='cccccccc-cccc-4ccc-8ccc-cccccccccccc'

class ProposalLoadingTests(unittest.TestCase):
    def repo(self, handler):
        return ProposalRepository(Settings(supabase_url='https://tests.supabase.invalid',supabase_key='sb_publishable_test'),
            'Bearer same-user',transport=httpx.MockTransport(handler))

    def test_revision_reads_overlap_in_bounded_batches_and_never_load_other_versions(self):
        barrier=threading.Barrier(4,timeout=3)
        lock=threading.Lock();calls=[];active=0;peak=0
        def handle(request):
            nonlocal active,peak
            self.assertEqual(request.headers['authorization'],'Bearer same-user')
            table=request.url.path.split('/')[-1]
            with lock:calls.append(request)
            if table=='change_proposals':return httpx.Response(200,json=[{'id':PROPOSAL,'project_id':PROJECT}])
            if table=='proposal_revisions':
                self.assertEqual(request.url.params['id'],'eq.'+REVISION)
                return httpx.Response(200,json=[{'id':REVISION,'additional_minor':10}])
            self.assertEqual(request.url.params['revision_id'],'eq.'+REVISION)
            self.assertEqual(request.url.params['proposal_id'],'eq.'+PROPOSAL)
            with lock:active+=1;peak=max(peak,active)
            try:barrier.wait()
            finally:
                with lock:active-=1
            return httpx.Response(200,json=[{'status':'completed'}] if table=='proposal_payments' else [])
        result=self.repo(handle).get_revision(PROPOSAL,REVISION)
        self.assertEqual(len(calls),10)
        self.assertEqual(peak,4)
        self.assertEqual(result['payments'],[{'status':'completed'}])
        self.assertTrue(result['payment_required'])
        self.assertEqual(sum(r.url.path.endswith('/proposal_revisions') for r in calls),1)

    def test_unauthorized_parent_stops_before_any_revision_or_parallel_read(self):
        calls=[]
        def handle(request):calls.append(request);return httpx.Response(200,json=[])
        with self.assertRaises(ApiError):self.repo(handle).get_revision(PROPOSAL,REVISION)
        self.assertEqual(len(calls),1)
        self.assertTrue(calls[0].url.path.endswith('/change_proposals'))

    def test_operation_reads_only_its_requested_collections(self):
        calls=[]
        def handle(request):
            table=request.url.path.split('/')[-1];calls.append(table)
            self.assertEqual(request.headers['authorization'],'Bearer same-user')
            if table=='change_proposals':return httpx.Response(200,json=[{'id':PROPOSAL,'project_id':PROJECT}])
            if table=='proposal_revisions':return httpx.Response(200,json=[{'id':REVISION,'additional_minor':10}])
            return httpx.Response(200,json=[])
        result=self.repo(handle).get_revision(PROPOSAL,REVISION,collections=('artifacts','reviews'))
        self.assertCountEqual(calls,['change_proposals','proposal_revisions','proposal_artifacts','proposal_reviews'])
        self.assertNotIn('sources',result);self.assertNotIn('payments',result)
        calls.clear()
        base=self.repo(handle).get_revision(PROPOSAL,REVISION,collections=())
        self.assertEqual(calls,['change_proposals','proposal_revisions'])
        self.assertTrue(base['payment_required'])

    def test_version_picker_does_not_fetch_terms_or_internal_snapshot_payloads(self):
        def handle(request):
            if request.url.path.endswith('/change_proposals'):
                return httpx.Response(200,json=[{'id':PROPOSAL,'project_id':PROJECT}])
            self.assertEqual(request.url.params['select'],'id,revision_no,draft_sequence,additional_minor,deadline')
            return httpx.Response(200,json=[{'id':REVISION,'revision_no':1,'draft_sequence':2},
                {'id':'old-draft','revision_no':1,'draft_sequence':1}])
        result=self.repo(handle).get_proposal(PROPOSAL,summary=True)
        self.assertEqual([row['id'] for row in result['revisions']],[REVISION])
        self.assertNotIn('snapshots',result)

    def test_failed_child_read_is_visible_without_partial_success(self):
        def handle(request):
            table=request.url.path.split('/')[-1]
            if table=='change_proposals':return httpx.Response(200,json=[{'id':PROPOSAL,'project_id':PROJECT}])
            if table=='proposal_revisions':return httpx.Response(200,json=[{'id':REVISION,'additional_minor':10}])
            return httpx.Response(503,json={}) if table=='proposal_payments' else httpx.Response(200,json=[])
        with self.assertRaises(ApiError) as error:self.repo(handle).get_revision(PROPOSAL,REVISION)
        self.assertEqual(error.exception.code,'PERSISTENCE_UNAVAILABLE')

if __name__=='__main__':unittest.main()
