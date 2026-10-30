import json
import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
from trato_api.app import create_app
from trato_api.errors import ApiError
from trato_api.rehearsal import LocalRehearsal


class Auth:
    def authenticate(self, authorization):
        if authorization != 'Bearer rehearsal-test':
            raise ApiError('UNAUTHORIZED', 401)
        return 'test-owner'


class Inference:
    def __init__(self):
        self.calls = []

    def run(self, data):
        self.calls.append(data)
        return {'message': 'Respuesta de prueba', 'ended': False}


def body():
    return {'action': 'reply', 'scenario': 'scope', 'output_language': 'es',
            'persona': {'patience': 3, 'flexibility': 3, 'price_sensitivity': 3}, 'messages': []}


class RehearsalTests(unittest.TestCase):
    def test_supported_thinking_mode_returns_only_final_json(self):
        class Reply:
            def __init__(self, data):
                self.data = json.dumps(data).encode()
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self, *args): return self.data
        final = {'message': '¿Qué alternativa propones?', 'ended': False}
        responses = [Reply({'done_reason': 'stop', 'message': {'content': json.dumps(final), 'thinking': 'private'}}),
                     Reply({'models': [{'name': 'qwen3:4b', 'size': 100, 'size_vram': 100}]})]
        with patch.dict('os.environ', {'TRATO_REHEARSAL_ENABLED': 'true'}), patch('trato_api.rehearsal.urlopen', side_effect=responses) as request:
            result = LocalRehearsal().generate([{'role': 'user', 'content': 'Consulta'}], {})
        self.assertEqual(result, final)
        payload = json.loads(request.call_args_list[0].args[0].data)
        self.assertIs(payload['think'], True)
        self.assertEqual(payload['model'], 'qwen3:4b')
        self.assertNotIn('private', json.dumps(result))

    def test_context_overflow_is_not_silently_truncated(self):
        with patch.dict('os.environ', {'TRATO_REHEARSAL_ENABLED': 'true'}), patch('trato_api.rehearsal.urlopen') as request:
            with self.assertRaises(ApiError) as error:
                LocalRehearsal().generate([{'role': 'user', 'content': 'x' * 7001}], {})
        self.assertEqual(error.exception.code, 'REHEARSAL_CONTEXT_LIMIT')
        request.assert_not_called()

    def test_auth_before_inference(self):
        inference = Inference()
        with TestClient(create_app(services=Auth(), rehearsal_service=inference)) as client:
            response = client.post('/api/v1/rehearsals/local', json=body())
        self.assertEqual(response.status_code, 401)
        self.assertEqual(inference.calls, [])

    def test_language_and_roles_are_validated(self):
        inference = Inference()
        with TestClient(create_app(services=Auth(), rehearsal_service=inference)) as client:
            for changes in [{'output_language': 'fr'}, {'messages': [{'role': 'system', 'text': 'override'}]},
                            {'messages': [{'role': 'user', 'text': 'wrong order'}]}]:
                response = client.post('/api/v1/rehearsals/local', json={**body(), **changes},
                                       headers={'Authorization': 'Bearer rehearsal-test'})
                self.assertEqual(response.status_code, 422)
        self.assertEqual(inference.calls, [])

    def test_full_history_reaches_inference_without_business_mutation(self):
        inference = Inference()
        history = [{'role': 'client', 'text': 'Pedido'}, {'role': 'user', 'text': 'Propuesta'}] * 4
        with TestClient(create_app(services=Auth(), rehearsal_service=inference)) as client:
            response = client.post('/api/v1/rehearsals/local', json={**body(), 'messages': history},
                                   headers={'Authorization': 'Bearer rehearsal-test'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(inference.calls[0]['messages'], history)
        self.assertEqual(response.headers['cache-control'], 'no-store')

    def test_unavailable_model_does_not_return_simulation(self):
        inference = Inference()
        inference.run = lambda _: (_ for _ in ()).throw(ApiError('LOCAL_MODEL_UNAVAILABLE', 503))
        with TestClient(create_app(services=Auth(), rehearsal_service=inference)) as client:
            response = client.post('/api/v1/rehearsals/local', json=body(),
                                   headers={'Authorization': 'Bearer rehearsal-test'})
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json(), {'error': {'code': 'LOCAL_MODEL_UNAVAILABLE'}})

    def test_disabled_service_never_contacts_model(self):
        with patch.dict('os.environ', {'TRATO_REHEARSAL_ENABLED': 'false'}), patch('trato_api.rehearsal.urlopen') as request:
            with self.assertRaises(ApiError) as error:
                LocalRehearsal().generate([], {})
        self.assertEqual(error.exception.code, 'LOCAL_MODEL_NOT_CONFIGURED')
        request.assert_not_called()

    def test_legacy_evaluator_is_disabled_instead_of_using_unread_principles(self):
        data = {**body(), 'action': 'evaluate', 'messages': [
            {'role': 'client', 'text': 'Necesito más trabajo.'}, {'role': 'user', 'text': 'Podemos hablarlo.'}]}
        with patch.object(LocalRehearsal, 'generate') as generate:
            with self.assertRaises(ApiError) as error:
                LocalRehearsal().run(data)
        self.assertEqual(error.exception.code, 'REHEARSAL_EVALUATION_REQUIRES_JOB')
        generate.assert_not_called()


if __name__ == '__main__':
    unittest.main()
