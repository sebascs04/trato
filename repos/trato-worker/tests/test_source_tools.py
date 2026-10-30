from copy import deepcopy
from hashlib import sha256
import json
import importlib.util
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from uuid import uuid4

import httpx
from trato_worker.source_tools import (ToolRuntime, ToolError, WORKFLOW_TOOLS, WORKFLOW,
                                      prepare_rehearsal_sources, run_tool_agent, with_rehearsal_sources,
                                      BackendToolClient)


def source(file_id):
    text = 'Test source text.'
    return {'file_id': file_id, 'title': 'Test', 'author': 'Test author', 'url': 'https://example.invalid/guide',
            'segments': [{'segment_id': 'p1', 'locator': {'kind': 'page', 'page': 1}, 'text': text}],
            'text': text, 'text_sha256': sha256(text.encode()).hexdigest()}


class Client:
    def __init__(self):
        self.calls = []
        self.info = {'schema_version': 1, 'workflow': WORKFLOW, 'scope_id': 'a' * 64,
                     'enabled_tools': ['search_text_file_id'], 'required_file_ids': [str(uuid4()) for _ in range(5)]}
    def catalog(self): return deepcopy(self.info)
    def execute(self, call):
        self.calls.append(call)
        return {'schema_version': 1, 'scope_id': self.info['scope_id'],
                'files': [source(i) for i in call['params']['file_ids']]}


class SourceToolsTests(unittest.TestCase):
    def test_required_node_reads_all_five_without_an_llm(self):
        client = Client()
        runtime, bundle = prepare_rehearsal_sources(client)
        self.assertEqual(len(bundle['files']), 5)
        self.assertEqual(client.calls[0]['params']['file_ids'], client.info['required_file_ids'])
        self.assertEqual(runtime.definitions()[0]['parameters']['properties']['file_ids']['items']['enum'],
                         client.info['required_file_ids'])

    def test_disabled_tool_and_unknown_id_never_reach_backend(self):
        client = Client()
        runtime = ToolRuntime(client, client.catalog(), enabled_tools=())
        self.assertEqual(runtime.definitions(), [])
        with self.assertRaisesRegex(ToolError, 'TOOL_NOT_ALLOWED'):
            runtime.execute('search_text_file_id', {'file_ids': client.info['required_file_ids']})
        runtime = ToolRuntime(client, client.catalog(), enabled_tools=WORKFLOW_TOOLS[WORKFLOW])
        with self.assertRaisesRegex(ToolError, 'SOURCE_NOT_ALLOWED'):
            runtime.execute('search_text_file_id', {'file_ids': [str(uuid4())]})
        self.assertEqual(client.calls, [])

    def test_incomplete_or_changed_source_response_stops_before_evaluator(self):
        for mutate in [lambda b: b['files'].pop(), lambda b: b['files'][0].update(text='Changed'),
                       lambda b: b.update(scope_id='b' * 64)]:
            client = Client(); original = client.execute
            def execute(call):
                bundle = original(call); mutate(bundle); return bundle
            client.execute = execute
            calls = []
            with self.subTest(mutate=mutate), self.assertRaisesRegex(ToolError, 'INVALID_TOOL_RESPONSE'):
                with_rehearsal_sources(client, lambda *a: calls.append(a),
                    context={'output_language': 'es', 'messages': []}, maximum_context_bytes=10000)
            self.assertEqual(calls, [])

    def test_read_failure_and_context_limit_do_not_become_an_evaluation(self):
        client = Client(); calls = []
        def fail(_): raise ToolError('SOURCE_READING_FAILED')
        client.execute = fail
        with self.assertRaisesRegex(ToolError, 'SOURCE_READING_FAILED'):
            with_rehearsal_sources(client, lambda *a: calls.append(a),
                context={'output_language': 'en'}, maximum_context_bytes=10000)
        with self.assertRaisesRegex(ToolError, 'EVALUATION_CONTEXT_LIMIT'):
            with_rehearsal_sources(Client(), lambda *a: calls.append(a),
                context={'output_language': 'en', 'messages': ['x' * 1000]}, maximum_context_bytes=100)
        self.assertEqual(calls, [])

    def test_both_languages_and_original_messages_reach_evaluator(self):
        for language in ('es', 'en'):
            context = {'output_language': language, 'messages': [{'id': 'm1', 'text': 'Texto original'}]}
            def evaluate(inputs, runtime):
                self.assertEqual(inputs['messages'], context['messages'])
                self.assertEqual(inputs['output_language'], language)
                self.assertEqual(len(inputs['source_bundle']['files']), 5)
                return 'validated gate'
            self.assertEqual(with_rehearsal_sources(Client(), evaluate, context=context,
                maximum_context_bytes=10000), 'validated gate')

    def test_agent_request_executes_and_returns_result_before_model_continues(self):
        client = Client(); runtime, _ = prepare_rehearsal_sources(client)
        class Model:
            def __init__(self): self.calls = []
            def generate(self, messages, schema):
                self.calls.append(deepcopy(messages))
                if len(self.calls) == 1:
                    return {'type': 'tool_call', 'tool': 'search_text_file_id',
                            'params': {'file_ids': [client.info['required_file_ids'][0]]}}
                self.result = json.loads(messages[-1]['content'])['tool_result']['data']
                return {'type': 'final', 'result': {'ok': True}}
        model = Model()
        result = run_tool_agent(model, runtime, [{'role': 'user', 'content': 'A question'}], {'type': 'object'}, maximum_context_bytes=20000)
        self.assertEqual(result, {'ok': True})
        self.assertEqual(len(model.result['files']), 1)
        self.assertEqual(len(client.calls), 2)

    def test_document_or_model_cannot_enable_payment_tool_and_loops_are_bounded(self):
        client = Client(); runtime, _ = prepare_rehearsal_sources(client)
        class Model:
            def generate(self, messages, schema):
                return {'type': 'tool_call', 'tool': 'send_payment', 'params': {}}
        with self.assertRaisesRegex(ToolError, 'TOOL_NOT_ALLOWED'):
            run_tool_agent(Model(), runtime, [], {}, maximum_context_bytes=20000)
        class Loop:
            def generate(self, messages, schema):
                return {'type': 'tool_call', 'tool': 'search_text_file_id',
                        'params': {'file_ids': [client.info['required_file_ids'][0]]}}
        with self.assertRaisesRegex(ToolError, 'TOOL_CALL_LIMIT'):
            run_tool_agent(Loop(), runtime, [], {}, maximum_context_bytes=20000, max_tool_calls=1)

    def test_tool_result_context_is_checked_before_the_next_model_call(self):
        client = Client(); runtime, _ = prepare_rehearsal_sources(client)
        class Model:
            def __init__(self): self.calls = 0
            def generate(self, messages, schema):
                self.calls += 1
                return {'type': 'tool_call', 'tool': 'search_text_file_id',
                        'params': {'file_ids': client.info['required_file_ids']}}
        model = Model()
        # Determine the first-call serialized size, then allow no space for a source result.
        sizes = []
        class SizeModel:
            def generate(self, messages, schema):
                sizes.append(len(json.dumps({'messages': messages, 'schema': schema}, ensure_ascii=False).encode()))
                return {'type': 'final', 'result': {}}
        run_tool_agent(SizeModel(), runtime, [], {}, maximum_context_bytes=20000)
        with self.assertRaisesRegex(ToolError, 'EVALUATION_CONTEXT_LIMIT'):
            run_tool_agent(model, runtime, [], {}, maximum_context_bytes=sizes[0])
        self.assertEqual(model.calls, 1)

    def test_http_errors_preserve_code_without_private_details(self):
        transport = httpx.MockTransport(lambda _: httpx.Response(503, json={'error': {'code': 'SOURCE_LIBRARY_UNREADABLE'}}))
        with self.assertRaisesRegex(ToolError, 'SOURCE_LIBRARY_UNREADABLE'):
            BackendToolClient('http://api.invalid', 'worker-only', transport=transport).catalog()

    @unittest.skipUnless(importlib.util.find_spec('fastapi'), 'Integration test requires API/processor test dependencies; see docs/herramientas-archivos-agentes.md')
    def test_real_worker_api_and_processor_with_pdf_extraction_no_network_or_model(self):
        # Integration uses real FastAPI routes and processor function, in-process HTTP transports.
        # The temporary library is explicit test data, never a runtime fallback or the five guides.
        repos = Path(__file__).resolve().parents[2]
        sys.path[:0] = [str(repos / 'trato-api'), str(repos / 'trato-file-processor')]
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from fastapi.responses import JSONResponse
        from file_processor.app import create_app
        from file_processor.extraction import extract_document
        from trato_api.agent_tools import AgentTools, SourceLibrary, ProcessorSourceReader, SOURCE_KEYS, build_agent_tools_router
        from trato_api.errors import ApiError
        import shutil
        if not shutil.which('pdftotext'): self.skipTest('Poppler required for real PDF extraction')
        extracted = extract_document((repos / 'trato-file-processor/tests/fixtures/request.pdf').read_bytes(), 'request.pdf', 'application/pdf')
        with TemporaryDirectory() as directory, TestClient(create_app('processor-only')) as processor:
            root = Path(directory); entries = []
            for key in sorted(SOURCE_KEYS):
                file_id = str(uuid4())
                file = {'file_id': file_id, 'title': key, 'author': 'Test author', 'url': 'https://example.invalid/guide',
                        'segments': [{'segment_id': str(s['index']), 'locator': s['locator'], 'text': s['text']}
                                     for s in extracted['segments']]}
                raw = json.dumps(file).encode(); (root / (file_id + '.json')).write_bytes(raw)
                entries.append({'key': key, 'file_id': file_id, 'filename': file_id + '.json', 'sha256': sha256(raw).hexdigest()})
            manifest = root / 'manifest.json'
            manifest.write_text(json.dumps({'schema_version': 1, 'workflow': WORKFLOW, 'sources': entries}))
            processor_requests = []
            def processor_http(request):
                processor_requests.append(request)
                response = processor.post(request.url.path, content=request.content, headers=dict(request.headers))
                return httpx.Response(response.status_code, json=response.json())
            settings = SimpleNamespace(processor_url='http://processor.invalid', processor_token='processor-only')
            service = AgentTools(settings, SourceLibrary(str(manifest)),
                                 ProcessorSourceReader(settings, httpx.MockTransport(processor_http)))
            api_app = FastAPI(); api_app.include_router(build_agent_tools_router(settings, service))
            @api_app.exception_handler(ApiError)
            async def error(_, exc): return JSONResponse({'error': {'code': exc.code}}, status_code=exc.status)
            with patch.dict('os.environ', {'TRATO_WORKER_TOKEN': 'worker-only'}), TestClient(api_app) as api:
                def api_http(request):
                    response = api.request(request.method, request.url.path, content=request.content, headers=dict(request.headers))
                    return httpx.Response(response.status_code, json=response.json())
                client = BackendToolClient('http://api.invalid', 'worker-only', transport=httpx.MockTransport(api_http))
                _, bundle = prepare_rehearsal_sources(client)
                self.assertEqual(len(bundle['files']), 5)
                self.assertIn('Correo de solicitud', bundle['files'][0]['text'])
                self.assertEqual(len(processor_requests), 1)
                self.assertEqual(processor_requests[0].headers['authorization'], 'Bearer processor-only')
                (root / entries[-1]['filename']).unlink()
                with self.assertRaisesRegex(ToolError, 'SOURCE_LIBRARY_UNREADABLE'):
                    prepare_rehearsal_sources(client)
                self.assertEqual(len(processor_requests), 1)
