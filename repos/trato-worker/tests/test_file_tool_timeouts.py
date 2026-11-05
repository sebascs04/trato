"""Transport deadlines match the tools they coordinate; no external calls."""
import json
import unittest
import httpx
from trato_worker.source_tools import BackendToolClient, ToolError
from trato_worker.file_pipeline.backend import BackendFileClient


class FileToolTimeoutTests(unittest.TestCase):
    def setUp(self):
        self.requests = []
        def handler(request):
            self.requests.append(request)
            return httpx.Response(200, json={'data': {'stored': True}})
        self.client = BackendToolClient('http://api.invalid', 'private-worker-token', transport=httpx.MockTransport(handler))
        self.backend = BackendFileClient(self.client)
        self.manifest = {'thread_id': 'job', 'lease_id': 'lease'}

    def assert_timeout(self, timeout):
        self.assertEqual(self.requests[-1].extensions['timeout'],
            {'connect': 5, 'read': timeout, 'write': timeout, 'pool': timeout})

    def test_index_waits_for_both_processor_writes_and_authorization(self):
        result = self.backend.publish_projection(self.manifest, {'file_id': 'file'})
        self.assertEqual(result, {'stored': True})
        self.assert_timeout(480)
        self.assertEqual(json.loads(self.requests[-1].content)['tool'], 'index_file_chunks')
        self.assertEqual(len(self.requests), 1)

    def test_regular_file_tools_keep_short_deadline(self):
        self.backend.revalidate(self.manifest)
        self.assert_timeout(30)
        self.backend.load_artifact(self.manifest, 'summary', 'cache-key')
        self.assert_timeout(30)

    def test_reference_tools_apply_their_existing_explicit_deadline(self):
        self.client.reference_execute({'tool': 'search_reference_passages', 'params': {}})
        self.assert_timeout(120)
        self.assertEqual(str(self.requests[-1].url), 'http://api.invalid/internal/reference-tools/execute')

    def test_transport_timeout_still_fails_without_retry_or_success(self):
        calls = []
        def handler(request):
            calls.append(request)
            raise httpx.ReadTimeout('synthetic timeout', request=request)
        client = BackendToolClient('http://api.invalid', 'private-worker-token', transport=httpx.MockTransport(handler))
        with self.assertRaisesRegex(ToolError, 'TOOL_SERVICE_UNAVAILABLE'):
            BackendFileClient(client).publish_projection(self.manifest, {})
        self.assertEqual(len(calls), 1)
