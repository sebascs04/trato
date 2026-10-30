from copy import deepcopy
import unittest
from uuid import uuid4
from fastapi.testclient import TestClient
from file_processor.app import create_app
from file_processor.source_text import search_text_file_id


def source():
    return {'file_id': str(uuid4()), 'title': 'Training fixture', 'author': 'Test author',
            'url': 'https://example.invalid/guide', 'segments': [
                {'segment_id': 'page-1', 'locator': {'kind': 'page', 'page': 1}, 'text': 'A source sentence.'},
                {'segment_id': 'section-close', 'locator': {'kind': 'section', 'section': 'Close'}, 'text': 'Another sentence.'}]}


class SourceTextTests(unittest.TestCase):
    def test_preserves_text_and_real_locators_without_extraction(self):
        file = source()
        result = search_text_file_id({'schema_version': 1, 'files': [file]})['files'][0]
        self.assertEqual(result['segments'], file['segments'])
        self.assertEqual(result['text'], 'A source sentence.\n\nAnother sentence.')
        self.assertEqual(len(result['text_sha256']), 64)

    def test_missing_empty_duplicate_and_fake_locator_rejected(self):
        for mutate in [lambda f: f.update(segments=[]), lambda f: f['segments'][0].update(text=' '),
                       lambda f: f['segments'].append(deepcopy(f['segments'][0])),
                       lambda f: f['segments'][0].update(locator={'kind': 'page', 'page': True}),
                       lambda f: f.update(path='/private/file')]:
            file = source(); mutate(file)
            with self.subTest(file=file), self.assertRaises(ValueError):
                search_text_file_id({'schema_version': 1, 'files': [file]})

    def test_internal_endpoint_rejects_before_reading_and_never_fetches_urls(self):
        with TestClient(create_app('processor-test')) as client:
            self.assertEqual(client.post('/v1/source-text/read', content=b'bad').status_code, 401)
            response = client.post('/v1/source-text/read', json={'schema_version': 1, 'files': [source()]},
                                   headers={'Authorization': 'Bearer processor-test'})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers['cache-control'], 'no-store')

    def test_bad_json_and_unconfigured_service_return_errors(self):
        with TestClient(create_app('processor-test')) as client:
            self.assertEqual(client.post('/v1/source-text/read', content=b'bad',
                headers={'Authorization': 'Bearer processor-test'}).status_code, 422)
        with TestClient(create_app('')) as client:
            self.assertEqual(client.post('/v1/source-text/read', json={}).status_code, 503)
