from copy import deepcopy
from hashlib import sha256
import unittest
from uuid import uuid4
from fastapi.testclient import TestClient
from file_processor.app import create_app
from file_processor.chunking import chunk_file


def request():
    return {'schema_version': 1, 'file_id': str(uuid4()), 'source_fingerprint': 'a'*64,
            'policy': {'version': 'v1', 'max_chars': 32, 'overlap_chars': 8, 'max_chunks': 100},
            'segments': [{'segment_id': 'page-1', 'locator': {'kind': 'page', 'page': 1},
                          'text': '  Diseño de una página 🎨. Entrega de tres secciones y revisión del cliente.  '}]}


class ChunkingTests(unittest.TestCase):
    def test_unicode_offsets_locators_and_complete_material_coverage(self):
        payload = request(); result = chunk_file(payload); text = payload['segments'][0]['text']
        covered = set()
        for chunk in result['chunks']:
            a,b = chunk['start_char'],chunk['end_char']; covered.update(range(a,b))
            self.assertEqual(chunk['text'], text[a:b])
            self.assertEqual(chunk['locator'], {'kind': 'page', 'page': 1})
            self.assertEqual(chunk['text_sha256'], sha256(text[a:b].encode()).hexdigest())
        self.assertTrue(all(i in covered for i,c in enumerate(text) if not c.isspace()))

    def test_stable_ids_change_with_source_policy_or_file(self):
        original = request(); first = chunk_file(original)
        self.assertEqual(first, chunk_file(original))
        for key,value in [('source_fingerprint','b'*64), ('file_id',str(uuid4()))]:
            modified = deepcopy(original); modified[key] = value
            self.assertNotEqual(first['chunks'][0]['chunk_id'], chunk_file(modified)['chunks'][0]['chunk_id'])
        modified = deepcopy(original); modified['policy']['version'] = 'v2'
        self.assertNotEqual(first['chunks'][0]['chunk_id'], chunk_file(modified)['chunks'][0]['chunk_id'])

    def test_limits_empty_duplicate_and_injected_paths_rejected(self):
        mutations = [lambda p: p['policy'].update(max_chunks=1),
                     lambda p: p['policy'].update(overlap_chars=32),
                     lambda p: p['policy'].update(max_chars=True),
                     lambda p: p['segments'].append(deepcopy(p['segments'][0])),
                     lambda p: p['segments'][0].update(text=' '),
                     lambda p: p.update(path='/private/file'),
                     lambda p: p['segments'][0].update(text='x'*250001)]
        for mutate in mutations:
            payload = request(); mutate(payload)
            with self.subTest(mutate=mutate), self.assertRaises(ValueError): chunk_file(payload)

    def test_private_http_route_auth_errors_and_no_store(self):
        with TestClient(create_app('test-chunker')) as client:
            self.assertEqual(client.post('/v1/files/chunks', content=b'bad').status_code,401)
            headers = {'Authorization': 'Bearer test-chunker'}
            self.assertEqual(client.post('/v1/files/chunks', content=b'bad',headers=headers).status_code,422)
            self.assertEqual(client.post('/v1/files/chunks',content=b'x'*1500001,headers=headers).status_code,413)
            result = client.post('/v1/files/chunks',json=request(),headers=headers)
            self.assertEqual(result.status_code,200)
            self.assertEqual(result.headers['cache-control'],'no-store')
        with TestClient(create_app('')) as client:
            self.assertEqual(client.post('/v1/files/chunks',json=request()).status_code,503)
