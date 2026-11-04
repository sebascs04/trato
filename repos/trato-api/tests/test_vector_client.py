import json
from types import SimpleNamespace
from unittest import TestCase
import httpx
from trato_api.errors import ApiError
from trato_api.vector_client import ProcessorVectorClient
from trato_api.vector_contract import PROFILE_ID


class VectorClientTests(TestCase):
    def client(self, handler):
        return ProcessorVectorClient(SimpleNamespace(processor_url='http://processor:8101', processor_token='internal'),
                                     httpx.MockTransport(handler))
    def test_backend_sends_only_project_scope_to_processor_without_weaviate_secret(self):
        def handler(request):
            self.assertEqual(request.url.path, '/v1/vectors/search')
            self.assertEqual(request.headers['authorization'], 'Bearer internal')
            body = json.loads(request.content)
            self.assertEqual(body['files'], [{'id':'file','generation':'g'}])
            self.assertNotIn('tenant', body); self.assertNotIn('WEAVIATE_API_KEY', str(body))
            return httpx.Response(200,json={'data': {'embedding_identity':PROFILE_ID, 'matches':[]}})
        self.assertEqual(self.client(handler).search('owner','client','project',[{'id':'file','generation':'g','_source':{'secret':'text'}}],'question',8), [])
    def test_profile_drift_transport_failure_and_incomplete_receipt_do_not_succeed(self):
        for response in [httpx.Response(200,json={'data':{'embedding_identity':'wrong','objects':1}}),
                         httpx.Response(200,json={'data':{'embedding_identity':PROFILE_ID,'objects':0}}),
                         httpx.Response(503,json={'error':{'code':'VECTOR_PROVIDER_UNAVAILABLE'}})]:
            calls=[]
            def handler(request): calls.append(request); return response
            with self.assertRaises(ApiError): self.client(handler).write('owner',[{}])
            self.assertEqual(len(calls),1)
        def unavailable(request): raise httpx.ConnectError('Down')
        with self.assertRaisesRegex(ApiError,'FILE_PROCESSOR_UNAVAILABLE'): self.client(unavailable).write('owner',[{}])
    def test_bad_processor_shape_has_a_visible_error(self):
        with self.assertRaises(ApiError):
            self.client(lambda r:httpx.Response(200,json={'data':None})).write('owner',[{}])
