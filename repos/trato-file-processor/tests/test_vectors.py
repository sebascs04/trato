from copy import deepcopy
from hashlib import sha256
import json
import os
from unittest import TestCase
from unittest.mock import patch
from uuid import NAMESPACE_URL, uuid4, uuid5

from fastapi import FastAPI
from fastapi.testclient import TestClient
from file_processor.vector_contract import digest, PROFILE_ID
from file_processor.vector_routes import build_vector_router
from file_processor.vector_store import WeaviateStore, VectorError

OWNER, CLIENT, PROJECT, FILE = [str(uuid4()) for _ in range(4)]


def record():
    text = 'El trabajo incluye dos revisiones.'
    props = {'owner_id': OWNER, 'client_id': CLIENT, 'project_id': PROJECT, 'file_id': FILE,
        'generation': 'a'*64, 'embedding_identity': PROFILE_ID, 'segment_id': str(uuid4()),
        'text_sha256': sha256(text.encode()).hexdigest(), 'chunk_text': text, 'start_char': 0, 'end_char': len(text)}
    return {'id': str(uuid5(NAMESPACE_URL, 'trato:weaviate:' + digest(props))), 'properties': props}


class Store:
    def __init__(self): self.calls = []; self.error = None
    def write(self, owner, records):
        self.calls.append(('index', owner, records))
        if self.error: raise VectorError(self.error, 503)
        return {'objects': len(records), 'embedding_identity': PROFILE_ID}
    def search(self, *args): self.calls.append(('search', *args)); return []
    def write_public(self,profile,records):self.calls.append(('public-index',profile,records));return {'objects':len(records),'embedding_identity':PROFILE_ID}
    def search_public(self,*args):self.calls.append(('public-search',*args));return []
    def prune_public(self,*args):self.calls.append(('public-prune',*args));return {'pruned':True,'embedding_identity':PROFILE_ID}


@patch.dict(os.environ, {'TRATO_VECTOR_SEARCH_ENABLED': 'true'})
class VectorRoutesTests(TestCase):
    def setUp(self):
        self.store = Store(); app = FastAPI(); app.include_router(build_vector_router('processor-token', self.store))
        self.client = TestClient(app); self.headers = {'Authorization': 'Bearer processor-token'}
        self.index = {'schema_version': 1, 'embedding_identity': PROFILE_ID, 'owner_id': OWNER, 'records': [record()]}
        self.search = {'schema_version': 1, 'embedding_identity': PROFILE_ID, 'owner_id': OWNER,
            'client_id': CLIENT, 'project_id': PROJECT, 'files': [{'id': FILE, 'generation': 'a'*64}],
            'query': '¿Qué revisiones incluye?', 'limit': 8}
    def test_functions_require_service_credential_not_a_user_jwt(self):
        for headers in ({}, {'Authorization':'Bearer user-jwt'}):
            self.assertEqual(self.client.post('/v1/vectors/search', json=self.search, headers=headers).status_code, 401)
        self.assertEqual(self.store.calls, [])
    def test_all_scopes_are_required_and_tenant_is_not_an_input(self):
        for field in ('owner_id', 'client_id', 'project_id', 'files', 'embedding_identity'):
            body = deepcopy(self.search); del body[field]
            self.assertEqual(self.client.post('/v1/vectors/search', json=body, headers=self.headers).status_code, 422)
        self.assertEqual(self.client.post('/v1/vectors/search', json={**self.search, 'tenant':'other'}, headers=self.headers).status_code, 422)
        self.assertEqual(self.store.calls, [])
    def test_processor_executes_index_and_search_with_exact_server_scope(self):
        result = self.client.post('/v1/vectors/index', json=self.index, headers=self.headers)
        self.assertEqual(result.status_code, 200); self.assertEqual(result.json()['data']['objects'], 1)
        self.assertEqual(self.client.post('/v1/vectors/search', json=self.search, headers=self.headers).status_code, 200)
        self.assertEqual(self.store.calls[-1][1:4], (OWNER, CLIENT, PROJECT))
        self.assertEqual(self.store.calls[-1][4], self.search['files'])
    def test_index_rejects_forged_identity_mixed_scopes_and_invalid_text_hash(self):
        cases = []
        body = deepcopy(self.index); body['records'][0]['id'] = str(uuid4()); cases.append(body)
        body = deepcopy(self.index); body['owner_id'] = str(uuid4()); cases.append(body)
        body = deepcopy(self.index); body['records'][0]['properties']['chunk_text'] = 'Modified'; cases.append(body)
        body = deepcopy(self.index); body['records'].append(deepcopy(body['records'][0])); cases.append(body)
        for body in cases:
            self.assertEqual(self.client.post('/v1/vectors/index', json=body, headers=self.headers).status_code, 422)
        self.assertEqual(self.store.calls, [])
    def test_provider_failure_is_visible_with_no_second_attempt(self):
        self.store.error = 'VECTOR_QUOTA_EXCEEDED'
        result = self.client.post('/v1/vectors/index', json=self.index, headers=self.headers)
        self.assertEqual(result.status_code, 503)
        self.assertEqual(result.json()['error']['code'], 'VECTOR_QUOTA_EXCEEDED')
        self.assertEqual(len(self.store.calls), 1)
    def test_private_tenant_is_shared_but_scope_remains_mandatory(self):
        self.assertEqual(WeaviateStore.tenant(OWNER), 'projects_private')
        self.assertEqual(WeaviateStore.tenant(str(uuid4())), 'projects_private')
        self.assertNotEqual(self.search['owner_id'], str(uuid4()))
    def test_public_routes_reject_private_identifiers_and_preserve_public_version_scope(self):
        original=record()['properties'];profile=str(uuid4())
        props={k:original[k] for k in ('generation','embedding_identity','segment_id','text_sha256','chunk_text','start_char','end_char')}
        props.update(community_client_id=profile,review_id=FILE,review_version='2')
        public={'id':str(uuid5(NAMESPACE_URL,'trato:weaviate:public:'+digest(props))),'properties':props}
        body={'schema_version':1,'embedding_identity':PROFILE_ID,'profile_id':profile,'records':[public]}
        self.assertEqual(self.client.post('/v1/vectors/public-index',json=body,headers=self.headers).status_code,200)
        bad=deepcopy(body);bad['records'][0]['properties']['owner_id']=OWNER
        self.assertEqual(self.client.post('/v1/vectors/public-index',json=bad,headers=self.headers).status_code,422)
        search={'schema_version':1,'embedding_identity':PROFILE_ID,'profile_id':profile,
                'files':[{'id':FILE,'generation':'a'*64}],'query':'terms','limit':3,'expected_chunks':1}
        self.assertEqual(self.client.post('/v1/vectors/public-search',json=search,headers=self.headers).status_code,200)
        self.assertEqual(self.store.calls[-1][1],profile)
