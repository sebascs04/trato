from copy import deepcopy
from unittest import TestCase
from uuid import uuid4
from trato_api.errors import ApiError
from trato_api.reputation_vector import PublicVector,canonical_snapshot,published_snapshot
from file_processor.chunking import chunk_file
from trato_api.vector_routes import POLICY
from trato_api.vector_contract import PROFILE_ID

PROFILE,REVIEW=str(uuid4()),str(uuid4())
class Repo:
    def __init__(self):
        self.reviews=[{'id':REVIEW,'version':1,'body':'The client asked for more time and confirmed clear deliverables.'}]
        self.generation=1;self.receipt=None
    def rpc(self,name,data):
        if name=='reputation_vector_source':return {'profile_id':PROFILE,'reviews':deepcopy(self.reviews),'generation':self.generation}
        if name=='reputation_vector_receipt':
            if data['p_receipt'] is not None:self.receipt=deepcopy(data['p_receipt'])
            return deepcopy(self.receipt)
        if name=='community_reputation':
            if not self.reviews:raise ApiError('REPUTATION_NOT_FOUND',404)
            return {'client':{'id':PROFILE},'reviews':deepcopy(self.reviews),'next_offset':None}
        raise AssertionError(name)
class Chunks:
    def read(self,v):return chunk_file({'schema_version':1,'file_id':v['document']['id'],'source_fingerprint':v['generation'],
        'segments':v['segments'],'policy':POLICY})['chunks']
class Processor:
    def __init__(self):self.records=[];self.calls=[];self.failure=False;self.after=None
    def write_public(self,profile,records):
        if self.failure:raise ApiError('VECTOR_BATCH_FAILED',503)
        self.calls.append(('write',profile));self.records=deepcopy(records)
        return {'objects':len(records),'embedding_identity':PROFILE_ID}
    def prune_public(self,profile,files):
        self.calls.append(('prune',profile));keep={(f['id'],f['generation']) for f in files}
        self.records=[r for r in self.records if (r['properties']['review_id'],r['properties']['generation']) in keep]
        return {'pruned':True,'embedding_identity':PROFILE_ID}
    def search_public(self,profile,files,query,limit,expected_chunks):
        self.calls.append(('search',profile))
        rows=[{**deepcopy(r),'score':0.9} for r in self.records[:limit]]
        if self.after:self.after()
        return rows

class PublicVectorTests(TestCase):
    def setUp(self):
        self.repo=Repo();self.fp=Processor();self.service=PublicVector(None,server=self.repo,processor=self.fp,chunks=Chunks())
    def test_full_publication_index_and_literal_result_contains_no_private_identifiers(self):
        self.assertEqual(self.service.sync(PROFILE)['status'],'ready')
        for record in self.fp.records:
            self.assertTrue({'owner_id','project_id','client_id','storage_path'}.isdisjoint(record['properties']))
        value=self.service.search(self.repo,PROFILE,'deliverables')
        self.assertEqual(value['matches'][0]['quote'],self.repo.reviews[0]['body'])
        self.assertEqual(value['matches'][0]['version'],1)
    def test_edit_or_withdrawal_immediately_prevents_stale_retrieval(self):
        self.service.sync(PROFILE);old_calls=len(self.fp.calls)
        self.repo.reviews[0]['version']=2;self.repo.reviews[0]['body']='Updated experience with different project circumstances.'
        with self.assertRaisesRegex(ApiError,'REPUTATION_VECTOR_INDEX_INCOMPLETE'):self.service.search(self.repo,PROFILE,'time')
        self.assertEqual(len(self.fp.calls),old_calls)
        self.service.sync(PROFILE);self.repo.reviews=[];self.repo.generation+=1
        with self.assertRaises(ApiError):self.service.search(self.repo,PROFILE,'time')
        self.service.sync(PROFILE);self.assertEqual(self.fp.records,[])
    def test_withdrawal_during_search_and_provider_failure_are_not_substituted(self):
        self.service.sync(PROFILE);self.fp.after=lambda:self.repo.reviews.clear()
        with self.assertRaises(ApiError):self.service.search(self.repo,PROFILE,'time')
        self.fp.failure=True;self.repo.reviews=[{'id':REVIEW,'version':3,'body':'A newly published experience with clear terms.'}]
        with self.assertRaisesRegex(ApiError,'VECTOR_BATCH_FAILED'):self.service.sync(PROFILE)
        self.assertEqual(self.repo.receipt['state'],'failed')
    def test_bad_chunk_and_duplicates_are_rejected(self):
        self.service.sync(PROFILE);self.fp.records[0]['properties']['review_version']='99'
        with self.assertRaisesRegex(ApiError,'REPUTATION_VECTOR_RESULT_INVALID'):self.service.search(self.repo,PROFILE,'time')
        with self.assertRaises(ApiError):canonical_snapshot(PROFILE,self.repo.reviews*2)
