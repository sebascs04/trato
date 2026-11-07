from copy import deepcopy
from unittest import TestCase
from unittest.mock import Mock, patch
from trato_api.vector_receipts import VectorReceipts
from trato_api.vector_routes import VectorGateway
from trato_api.errors import ApiError
from test_vector_routes import Repo, Store, Processor, MemoryRedis, OWNER, PROJECT, FILE


class SharedRepo:
    def __init__(self): self.data = {}
    def rows(self, table, params):
        value = params['document_id']
        ids = value[4:-1].split(',') if value.startswith('in.(') else [value[3:]]
        return [deepcopy(self.data[i]) for i in ids if i in self.data and self.data[i]['owner_id']==params['owner_id'][3:]]
    def call(self, method, path, *, json=None, params=None, headers=None):
        if method=='POST': self.data[json['document_id']] = deepcopy(json)
        elif method=='DELETE':
            row=self.data.get(params['document_id'][3:])
            if row and row['owner_id']==params['owner_id'][3:]: self.data.pop(row['document_id'])


class ReceiptTests(TestCase):
    @patch.dict('os.environ', {'TRATO_VECTOR_SEARCH_ENABLED':'true','TRATO_FILE_PROCESSING_ENABLED':'false'})
    def test_index_ready_survives_different_redis_and_gateway_instances(self):
        shared=SharedRepo();repo=Repo();store=Store()
        first=VectorGateway(None,store=store,redis=MemoryRedis(),processor=Processor(),registry=VectorReceipts(None,repo=shared))
        first.index(repo,OWNER,PROJECT,FILE)
        second=VectorGateway(None,store=store,redis=MemoryRedis(),processor=Processor(),registry=VectorReceipts(None,repo=shared))
        self.assertEqual(second.search(repo,OWNER,PROJECT,'payment')['matches'][0]['text'],repo.text)
        repo.text+=' changed'
        with self.assertRaisesRegex(ApiError,'VECTOR_INDEX_INCOMPLETE'): second.search(repo,OWNER,PROJECT,'payment')

    def test_grouped_receipts_keep_the_owner_filter(self):
        from uuid import uuid4
        registry=VectorReceipts(None,repo=SharedRepo());other=str(uuid4())
        registry.put(OWNER,FILE,{'project_id':PROJECT,'status':'ready'})
        self.assertEqual(registry.get_many(OWNER,[FILE,other]),{FILE:{'project_id':PROJECT,'status':'ready'}})
        self.assertEqual(registry.get_many(str(uuid4()),[FILE]),{})

    def test_receipt_does_not_cross_owner_and_can_be_removed(self):
        from uuid import uuid4
        registry=VectorReceipts(None,repo=SharedRepo())
        registry.put(OWNER,FILE,{'project_id':PROJECT,'status':'ready'})
        self.assertIsNone(registry.get(str(uuid4()),FILE))
        registry.remove(str(uuid4()),FILE)
        self.assertIsNotNone(registry.get(OWNER,FILE))
        registry.remove(OWNER,FILE)
        self.assertIsNone(registry.get(OWNER,FILE))

    def test_database_failure_does_not_use_a_redis_receipt(self):
        repo=Mock();repo.rows.side_effect=ApiError('PERSISTENCE_UNAVAILABLE',503)
        redis=MemoryRedis();redis.set('trato:vector:receipt:'+OWNER+':'+FILE,'{"status":"ready"}')
        gateway=VectorGateway(None,redis=redis,registry=VectorReceipts(None,repo=repo))
        with self.assertRaisesRegex(ApiError,'PERSISTENCE_UNAVAILABLE'): gateway.receipt(OWNER,FILE)
