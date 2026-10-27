import unittest
from unittest.mock import patch
import httpx
from fastapi.testclient import TestClient
from trato_api.app import ApiError, Services, Settings, create_app


class FakeServices:
    def __init__(self):
        self.extractions = 0

    def authenticate(self, authorization):
        if authorization != 'Bearer test-user':
            raise ApiError('UNAUTHORIZED', 401)
        return '6ba7b810-9dad-11d1-80b4-00c04fd430c8'

    def extract(self, data, filename, content_type):
        self.extractions += 1
        return {'schema_version': 1, 'text': 'Contenido', 'segments': [], 'format': 'pdf'}


class ApiTests(unittest.TestCase):
    def test_unauthorized_request_never_reaches_processor(self):
        services = FakeServices()
        with TestClient(create_app(services=services)) as client:
            response = client.post('/api/v1/documents/extract?filename=test.pdf', content=b'%PDF-')
        self.assertEqual(response.status_code, 401)
        self.assertEqual(services.extractions, 0)

    def test_gateway_returns_explicit_unpersisted_preview(self):
        with TestClient(create_app(services=FakeServices())) as client:
            response = client.post('/api/v1/documents/extract?filename=test.pdf', content=b'%PDF-',
                                   headers={'Authorization': 'Bearer test-user', 'Content-Type': 'application/pdf'})
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()['persisted'])
        self.assertNotIn('processor_token', response.text)

    def test_oversized_request_never_reaches_processor(self):
        services = FakeServices()
        with TestClient(create_app(services=services)) as client:
            response = client.post('/api/v1/documents/extract?filename=test.pdf', content=b'x' * (10 * 1024 * 1024 + 1),
                                   headers={'Authorization': 'Bearer test-user'})
        self.assertEqual(response.status_code, 413)
        self.assertEqual(services.extractions, 0)

    def test_supabase_rejects_invalid_token_without_trusting_claims(self):
        service = Services(Settings(supabase_url='https://example.supabase.co', supabase_key='public-test'))
        # The real code calls Supabase Auth; it never decodes an unverified JWT for identity.
        with patch('trato_api.app.httpx.Client') as constructor:
            constructor.return_value.__enter__.return_value.get.return_value = httpx.Response(401)
            with self.assertRaises(ApiError) as error:
                service.authenticate('Bearer forged-jwt')
        self.assertEqual(error.exception.code, 'UNAUTHORIZED')


if __name__ == '__main__':
    unittest.main()
