import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from trato_worker.analysis import SCHEMA, analyze
from trato_worker.gemini import GeminiConfig, GeminiConfigurationError, GeminiLangChainModel, GeminiUnavailableError
from trato_worker.models import configured_model

SOURCES = [{'id': 'a:1', 'kind': 'agreement', 'text': 'Solo web en español.'},
           {'id': 'r:1', 'kind': 'request', 'text': 'Agregar inglés.'}]
RESULT = {'relation': 'matches', 'classification': 'possible_extra', 'summary': 'Revisar el inglés.',
          'sources': [{'source_id': 'a:1', 'quote': 'web en español'}, {'source_id': 'r:1', 'quote': 'Agregar inglés'}]}


class StubClient:
    def __init__(self, result=None, fail=False, **kwargs):
        self.kwargs, self.calls, self.fail = kwargs, 0, fail
        self.response = result if result is not None else {
            'parsed': RESULT, 'parsing_error': None,
            'raw': SimpleNamespace(usage_metadata={'input_tokens': 30, 'output_tokens': 20, 'total_tokens': 50})}

    def with_structured_output(self, **kwargs):
        self.structured = kwargs
        return self

    def invoke(self, messages):
        self.calls += 1
        if self.fail:
            raise RuntimeError('provider accidentally includes synthetic-secret')
        return self.response


class GeminiTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, {}, clear=True)
        self.environment.start()
        self.addCleanup(self.environment.stop)

    def config(self, backend='developer'):
        return GeminiConfig(backend, 'gemini-test-model', 'synthetic-secret')

    def test_model_and_provider_are_never_selected_implicitly(self):
        with self.assertRaises(GeminiConfigurationError):
            GeminiLangChainModel(client_factory=StubClient)
        os.environ['OLLAMA_MODEL'] = 'installed-example'
        with self.assertRaises(ValueError):
            configured_model()

    def test_developer_and_express_backends_are_explicit(self):
        for backend, vertex in [('developer', False), ('vertex_express', True)]:
            model = GeminiLangChainModel(self.config(backend), client_factory=StubClient)
            self.assertIs(model._client.kwargs['vertexai'], vertex)
            self.assertEqual(model._client.kwargs['max_retries'], 0)
            self.assertNotIn('project', model._client.kwargs)

    def test_shared_sdk_configuration_cannot_change_backend_or_key(self):
        for name in ['GOOGLE_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_GENAI_USE_VERTEXAI', 'GOOGLE_CLOUD_PROJECT', 'GOOGLE_VERTEX_BASE_URL']:
            with patch.dict(os.environ, {name: 'unexpected'}):
                with self.assertRaises(GeminiConfigurationError):
                    GeminiLangChainModel(self.config(), client_factory=StubClient)

    def test_configuration_does_not_expose_key_in_repr(self):
        self.assertNotIn('synthetic-secret', repr(self.config()))

    def test_vertex_requires_its_own_explicit_project_and_credentials(self):
        with self.assertRaises(GeminiConfigurationError):
            GeminiLangChainModel(self.config('vertex'), client_factory=StubClient)

    def test_analysis_still_validates_citations_and_requires_review(self):
        model = GeminiLangChainModel(self.config(), client_factory=StubClient)
        output = analyze(SOURCES, model, output_language='es')
        self.assertTrue(output['human_review_required'])
        self.assertEqual(model._client.structured['method'], 'json_schema')
        self.assertEqual(model._client.structured['schema'], SCHEMA)
        self.assertEqual(model.last_usage['total_tokens'], 50)
        model._client.response['parsed'] = {**RESULT, 'sources': [{'source_id': 'outside:tenant', 'quote': 'invented'}]}
        with self.assertRaises(ValueError):
            analyze(SOURCES, model, output_language='es')

    def test_provider_error_is_not_retried_or_exposed_or_replaced(self):
        model = GeminiLangChainModel(self.config(), client_factory=lambda **kw: StubClient(fail=True, **kw))
        with self.assertRaises(GeminiUnavailableError) as caught:
            model.generate([], SCHEMA)
        self.assertEqual(model._client.calls, 1)
        self.assertNotIn('synthetic-secret', str(caught.exception))
        self.assertIsNone(model.last_usage)

    def test_refusal_or_truncated_output_never_becomes_an_analysis(self):
        for response in [{'parsed': None, 'parsing_error': None}, {'parsed': RESULT, 'parsing_error': ValueError('bad schema')}]:
            model = GeminiLangChainModel(self.config(), client_factory=lambda **kw: StubClient(result=response, **kw))
            with self.assertRaises(GeminiUnavailableError):
                model.generate([], SCHEMA)

    def test_installed_sdk_can_construct_and_bind_schema_without_network(self):
        with patch('socket.socket.connect', side_effect=AssertionError('No network in this test')):
            model = GeminiLangChainModel(self.config())
            try:
                self.assertFalse(model._client.client._api_client.vertexai)
                model._client.with_structured_output(SCHEMA, method='json_schema', include_raw=True)
            finally:
                model.close()


if __name__ == '__main__':
    unittest.main()
