from copy import deepcopy
from hashlib import sha256
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from uuid import uuid4

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient
from fastapi.responses import JSONResponse
from trato_api.agent_tools import (AgentTools, SourceLibrary, ProcessorSourceReader,
                                  SOURCE_KEYS, build_agent_tools_router)
from trato_api.errors import ApiError


def make_library(root):
    entries, files = [], []
    for key in sorted(SOURCE_KEYS):
        file_id = str(uuid4())
        file = {'file_id': file_id, 'title': key, 'author': 'Test author',
                'url': 'https://example.invalid/guide', 'segments': [
                    {'segment_id': 'section-1', 'locator': {'kind': 'section', 'section': 'Training'},
                     'text': 'Synthetic training source.'}]}
        raw = json.dumps(file).encode()
        (root / (file_id + '.json')).write_bytes(raw)
        entries.append({'key': key, 'file_id': file_id, 'filename': file_id + '.json',
                        'sha256': sha256(raw).hexdigest()})
        files.append(file)
    path = root / 'manifest.json'
    path.write_text(json.dumps({'schema_version': 1, 'workflow': 'rehearsal_feedback', 'sources': entries}))
    return path, entries, files


def app(service):
    a = FastAPI(); a.include_router(build_agent_tools_router(None, service))
    @a.exception_handler(ApiError)
    async def error(_, e):
        return JSONResponse({'error': {'code': e.code}}, status_code=e.status)
    return a


class AgentToolsTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.path, self.entries, self.files = make_library(self.root)

    def test_unconfigured_library_fails_and_does_not_choose_other_files(self):
        with self.assertRaises(ApiError) as error:
            SourceLibrary('').load()
        self.assertEqual(error.exception.code, 'SOURCE_LIBRARY_NOT_CONFIGURED')

    def test_all_five_files_hashes_and_paths_are_required(self):
        for change in ('missing', 'hash', 'path', 'duplicate'):
            with self.subTest(change=change):
                path, entries, _ = make_library(self.root)
                if change == 'missing': (self.root / entries[0]['filename']).unlink()
                if change == 'hash': (self.root / entries[0]['filename']).write_text('{}')
                if change == 'path': entries[0]['filename'] = '../private.json'
                if change == 'duplicate': entries[1] = entries[0]
                if change in ('path', 'duplicate'):
                    path.write_text(json.dumps({'schema_version': 1, 'workflow': 'rehearsal_feedback', 'sources': entries}))
                with self.assertRaises(ApiError): SourceLibrary(str(path)).load()

    def test_backend_rejects_extra_permissions_unknown_tools_and_foreign_ids(self):
        service = AgentTools(None, library=SourceLibrary(str(self.path)), reader=object())
        catalog = service.catalog()
        base = {'workflow': 'rehearsal_feedback', 'scope_id': catalog['scope_id'],
                'tool': 'search_text_file_id', 'params': {'file_ids': catalog['required_file_ids']}}
        for mutate, code in [(lambda c: c.update(owner_id='other'), 'INVALID_TOOL_CALL'),
                             (lambda c: c.update(tool='send_payment'), 'TOOL_NOT_ALLOWED'),
                             (lambda c: c['params'].update(file_ids=[str(uuid4())]), 'SOURCE_NOT_ALLOWED'),
                             (lambda c: c.update(scope_id='a' * 64), 'SOURCE_SCOPE_CHANGED')]:
            call = deepcopy(base); mutate(call)
            with self.subTest(code=code), self.assertRaises(ApiError) as error: service.execute(call)
            self.assertEqual(error.exception.code, code)

    def test_worker_credential_required_before_loading_library(self):
        service = AgentTools(None, library=SourceLibrary(''), reader=object())
        with patch.dict(os.environ, {'TRATO_WORKER_TOKEN': 'worker-test'}), TestClient(app(service)) as client:
            self.assertEqual(client.get('/internal/agent-tools/rehearsal-feedback/catalog',
                headers={'Authorization': 'Bearer user-jwt'}).status_code, 401)
            self.assertEqual(client.post('/internal/agent-tools/execute', content=b'bad').status_code, 401)
            self.assertEqual(client.get('/internal/agent-tools/rehearsal-feedback/catalog',
                headers={'Authorization': 'Bearer worker-test'}).status_code, 503)

    def test_no_partial_or_rewritten_processor_result_is_accepted(self):
        settings = SimpleNamespace(processor_url='http://processor.invalid', processor_token='processor-only')
        def transport(request):
            self.assertEqual(request.headers['authorization'], 'Bearer processor-only')
            return httpx.Response(200, json={'data': {'schema_version': 1, 'files': []}})
        reader = ProcessorSourceReader(settings, httpx.MockTransport(transport))
        with self.assertRaises(ApiError) as error: reader.read(self.files)
        self.assertEqual(error.exception.code, 'INVALID_PROCESSOR_RESPONSE')

    def test_unavailable_processor_is_not_a_read_success(self):
        settings = SimpleNamespace(processor_url='http://processor.invalid', processor_token='processor-only')
        def fail(request): raise httpx.ConnectError('private detail', request=request)
        with self.assertRaises(ApiError) as error:
            ProcessorSourceReader(settings, httpx.MockTransport(fail)).read(self.files)
        self.assertEqual(error.exception.code, 'FILE_PROCESSOR_UNAVAILABLE')

    def test_catalog_does_not_expose_paths_or_credentials(self):
        service = AgentTools(None, library=SourceLibrary(str(self.path)), reader=object())
        with patch.dict(os.environ, {'TRATO_WORKER_TOKEN': 'worker-test'}), TestClient(app(service)) as client:
            response = client.get('/internal/agent-tools/rehearsal-feedback/catalog', headers={'Authorization': 'Bearer worker-test'})
        self.assertEqual(response.status_code, 200)
        self.assertNotIn(self.temp.name, response.text)
        self.assertNotIn('worker-test', response.text)
        self.assertEqual(len(response.json()['data']['required_file_ids']), 5)
