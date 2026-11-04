from contextlib import contextmanager
from copy import deepcopy
import json
import os
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from uuid import uuid4

import httpx
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

from trato_api.errors import ApiError
from trato_api.vector_routes import VectorGateway, ProcessorChunks, build_vector_router, source, validate_chunks, POLICY
from trato_api.vector_contract import PROFILE_ID, digest
from trato_api.vector_client import ProcessorVectorClient
from file_processor.chunking import chunk_file

OWNER, CLIENT, PROJECT, FILE, EXTRACTION, SEGMENT = [str(uuid4()) for _ in range(6)]


class Repo:
    def __init__(self, *args):
        self.text = 'El acuerdo incluye dos revisiones. El pago final vence al entregar el video.'
        self.owner = OWNER
        self.document = {'id': FILE, 'project_id': PROJECT, 'owner_id': OWNER, 'sha256': 'a'*64,
            'title': 'Acuerdo', 'original_filename': 'agreement.pdf', 'kind': 'initial_agreement', 'created_at': '2026-11-01'}
    def project(self, project):
        if project != PROJECT:
            raise ApiError('PROJECT_NOT_FOUND', 404)
        return {'id': PROJECT, 'client_id': CLIENT, 'owner_id': self.owner}
    def extraction(self, file):
        if file != FILE:
            raise ApiError('DOCUMENT_NOT_FOUND', 404)
        return {'document': self.document, 'extraction': {'id': EXTRACTION, 'status': 'ready'},
                'segments': [{'id': SEGMENT, 'locator_kind': 'page', 'locator_number': 2, 'text': self.text}]}
    def rows(self, table, params):
        return [self.document] if params['offset'] == 0 else []


class MemoryRedis:
    def __init__(self):
        self.data = {}
    def get(self, key): return self.data.get(key)
    def set(self, key, value): self.data[key] = value
    def lock(self, *args, **kwargs):
        class Lock:
            def acquire(self, **kw): return True
            def owned(self): return True
            def release(self): pass
        return Lock()


class Processor:
    def read(self, value):
        return chunk_file({'schema_version': 1, 'file_id': FILE, 'source_fingerprint': value['generation'],
                           'segments': value['segments'], 'policy': POLICY})['chunks']


class Store:
    def __init__(self): self.records = []; self.failure = None; self.after_search = None
    def write(self, owner, records):
        self.records = deepcopy(records)
        if self.failure: raise ApiError(self.failure, 503)
        return {'objects': len(records), 'embedding_identity': PROFILE_ID}
    def search(self, owner, client, project, files, query, limit):
        result = [{**deepcopy(r), 'score': 0.9} for r in self.records[:limit]]
        if self.after_search: self.after_search()
        return result


@patch.dict(os.environ, {'TRATO_VECTOR_SEARCH_ENABLED': 'true'})
class VectorTests(unittest.TestCase):
    def setUp(self):
        self.repo, self.store, self.redis = Repo(), Store(), MemoryRedis()
        self.gateway = VectorGateway(None, store=self.store, redis=self.redis, processor=Processor())
    def index(self): return self.gateway.index(self.repo, OWNER, PROJECT, FILE)
    def test_index_and_search_reconstruct_exact_source_and_page(self):
        self.index()
        data = self.gateway.search(self.repo, OWNER, PROJECT, '¿Cuántas revisiones incluye?')
        hit = data['matches'][0]
        self.assertEqual(hit['text'], self.repo.text)
        self.assertEqual(hit['locator'], {'kind': 'page', 'page': 2})
        self.assertTrue(data['complete_inventory'])
        self.assertFalse(data['exhaustive_evidence'])
        self.assertEqual(data['hybrid_alpha'], 0.7)
        self.assertTrue(hit['document_url'].endswith('/file'))
    def test_no_implicit_indexing_and_changed_source_requires_explicit_index(self):
        with self.assertRaisesRegex(ApiError, 'VECTOR_INDEX_INCOMPLETE'):
            self.gateway.search(self.repo, OWNER, PROJECT, 'Precio')
        self.assertEqual(self.store.records, [])
        self.index(); self.repo.text += ' Otro término.'
        with self.assertRaisesRegex(ApiError, 'VECTOR_INDEX_INCOMPLETE'):
            self.gateway.search(self.repo, OWNER, PROJECT, 'Precio')
    def test_foreign_owner_and_project_cannot_be_queried_or_indexed(self):
        for action in (lambda: self.gateway.index(self.repo, str(uuid4()), PROJECT, FILE),
                       lambda: self.gateway.search(self.repo, str(uuid4()), PROJECT, 'Texto'),
                       lambda: self.gateway.search(self.repo, OWNER, str(uuid4()), 'Texto')):
            with self.assertRaises(ApiError): action()
        self.assertEqual(self.store.records, [])
    def test_failure_keeps_partial_generation_inactive(self):
        self.index(); self.store.failure = 'VECTOR_BATCH_FAILED'
        with self.assertRaisesRegex(ApiError, 'VECTOR_BATCH_FAILED'): self.index()
        self.assertEqual(self.gateway.receipt(OWNER, FILE)['status'], 'failed')
        with self.assertRaisesRegex(ApiError, 'VECTOR_INDEX_INCOMPLETE'):
            self.gateway.search(self.repo, OWNER, PROJECT, 'Texto')
    def test_stale_result_and_tampered_text_fail_closed(self):
        self.index(); self.store.records[0]['properties']['chunk_text'] = 'Not the source'
        with self.assertRaisesRegex(ApiError, 'VECTOR_RESULT_INVALID'):
            self.gateway.search(self.repo, OWNER, PROJECT, 'Texto')
        self.index(); self.store.after_search = lambda: setattr(self.repo, 'text', 'Changed during query')
        with self.assertRaisesRegex(ApiError, 'VECTOR_SOURCE_CHANGED'):
            self.gateway.search(self.repo, OWNER, PROJECT, 'Texto')
    def test_processor_uses_authorized_text_and_rejects_missing_coverage(self):
        value = source(self.repo, OWNER, self.repo.project(PROJECT), FILE)
        received = []
        def handler(request):
            self.assertEqual(request.headers['Authorization'], 'Bearer internal')
            payload = json.loads(request.content); received.append(payload)
            return httpx.Response(200, json={'data': chunk_file(payload)})
        processor = ProcessorChunks(SimpleNamespace(processor_url='http://processor', processor_token='internal'),
                                    transport=httpx.MockTransport(handler))
        self.assertEqual(processor.read(value)[0]['text'], self.repo.text)
        self.assertEqual(received[0]['file_id'], FILE)
        result = chunk_file(received[0]); result['chunks'][0]['end_char'] -= 1
        with self.assertRaises(ValueError): validate_chunks(value, result)
    def test_api_rejects_browser_filters_and_unbounded_query(self):
        app = FastAPI(); app.include_router(build_vector_router(None, lambda: OWNER, lambda *a:self.repo, self.gateway))
        @app.exception_handler(ApiError)
        async def handle(_, e): return JSONResponse({'error': {'code': e.code}}, status_code=e.status)
        client = TestClient(app)
        path = '/api/v1/projects/' + PROJECT + '/sources/search'
        for body in [{'query':'scope','owner_id':str(uuid4())}, {'query':'scope','limit':True},
                     {'query':'é'*3000}, {'query':'   '}]:
            self.assertEqual(client.post(path, json=body).status_code, 422)
        self.assertEqual(client.post('/api/v1/projects/'+PROJECT+'/documents/'+FILE+'/index').status_code, 200)
        self.assertEqual(client.post(path, json={'query':'scope'}).status_code, 200)
    def test_inventory_is_complete_and_not_a_top_k(self):
        self.assertEqual(self.gateway.inventory(self.repo, OWNER, PROJECT)['files'][0]['status'], 'index_pending')
        self.index()
        data = self.gateway.inventory(self.repo, OWNER, PROJECT)
        self.assertTrue(data['complete']); self.assertEqual(data['total'], 1)
        self.assertNotIn('_source', data['files'][0])
        self.assertNotIn('owner_id', data['files'][0])
    def test_real_backend_processor_contract_roundtrip_without_provider_or_browser(self):
        from file_processor.chunking_routes import build_chunking_router
        from file_processor.vector_routes import build_vector_router as processor_router
        app = FastAPI()
        app.include_router(build_chunking_router('internal'))
        app.include_router(processor_router('internal', self.store))
        fp = TestClient(app)
        requests = []
        def dispatch(request):
            requests.append(request.url.path)
            self.assertEqual(request.headers['authorization'], 'Bearer internal')
            response = fp.request(request.method, request.url.path, content=request.content,
                                  headers=dict(request.headers))
            return httpx.Response(response.status_code, json=response.json())
        settings = SimpleNamespace(processor_url='http://processor', processor_token='internal')
        transport = httpx.MockTransport(dispatch)
        gateway = VectorGateway(settings, redis=self.redis, store=ProcessorVectorClient(settings, transport),
                                processor=ProcessorChunks(settings, transport))
        gateway.index(self.repo, OWNER, PROJECT, FILE)
        result = gateway.search(self.repo, OWNER, PROJECT, 'Revisiones')
        self.assertEqual(result['matches'][0]['text'], self.repo.text)
        self.assertEqual(requests, ['/v1/files/chunks', '/v1/vectors/index', '/v1/vectors/search'])
    def test_malformed_provider_score_and_registry_are_visible_errors(self):
        self.index()
        self.redis.set(self.gateway.receipt_key(OWNER, FILE), '[]')
        with self.assertRaisesRegex(ApiError, 'VECTOR_REGISTRY_INVALID'):
            self.gateway.search(self.repo, OWNER, PROJECT, 'Texto')
        self.index()
        with patch.object(self.store, 'search', return_value=[{'id':'invalid','properties':{},'score':float('nan')}]):
            with self.assertRaisesRegex(ApiError, 'VECTOR_RESULT_INVALID'):
                self.gateway.search(self.repo, OWNER, PROJECT, 'Texto')
