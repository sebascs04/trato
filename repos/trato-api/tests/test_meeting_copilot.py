import unittest
import asyncio
from unittest.mock import patch

from fastapi import FastAPI, WebSocketDisconnect
from fastapi.testclient import TestClient

from trato_api.meeting_copilot import (
    TICKET_TTL_SECONDS,
    MeetingSessionManager,
    build_meeting_copilot_router,
    is_origin_allowed,
)
from trato_api.meeting_copilot_provider import (
    DEFAULT_ANALYSIS_MODEL,
    LIVE_TRANSCRIPTION_MODEL,
    GeminiMeetingProvider,
    MeetingProviderError,
    build_suggestion_prompt,
    gemini_live_config,
)


class LocalTestProvider:
    provider = 'local-test-provider'
    configured = True

    def __init__(self):
        self.events = asyncio.Queue()
        self.audio_frames = 0

    async def start(self, **_kwargs):
        return None

    async def receive(self):
        return await self.events.get()

    async def send_audio(self, pcm, *, sample_rate=16_000):
        self.audio_frames += 1
        await self.events.put({
            'type': 'transcription',
            'phase': 'final',
            'text': 'Transcripción local de prueba',
            'source': 'microphone',
        })

    async def end_audio_stream(self):
        return None

    async def suggest(self, **_kwargs):
        return {
            'question_detected': True,
            'objection_detected': False,
            'reply': 'Respuesta contextual del proveedor local de prueba.',
            'recommended_question': '¿Qué prioridad tiene este requisito?',
            'rationale': 'El evento actual contiene una pregunta.',
        }

    async def summarize(self, **_kwargs):
        return {
            'title': 'Resumen local de prueba',
            'decisions': ['No se registraron decisiones reales.'],
            'action_items': ['Validar el proveedor real.'],
            'risks': [],
            'next_steps': ['Probar con Gemini autorizado.'],
            'closing': 'Resumen generado por el doble local de prueba.',
        }

    async def close(self):
        await self.events.put(None)


class MeetingCopilotAuthTests(unittest.TestCase):
    def setUp(self):
        self.app = FastAPI()
        self.app.state.meeting_session_manager = MeetingSessionManager()
        self.app.include_router(build_meeting_copilot_router(lambda request: 'owner-1', LocalTestProvider))
        self.client = TestClient(self.app)

    def test_session_ticket_requires_authorization_and_valid_origin(self):
        response = self.client.post(
            '/api/v1/meeting-copilot/sessions',
            json={'session_id': 'session-001', 'source': 'microphone'},
            headers={'Authorization': 'Bearer token', 'Origin': 'http://localhost:5173'},
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()['data']
        self.assertEqual(body['session_id'], 'session-001')
        self.assertIn('ticket', body)

        blocked = self.client.post(
            '/api/v1/meeting-copilot/sessions',
            json={'session_id': 'session-002', 'source': 'screen'},
            headers={'Authorization': 'Bearer token', 'Origin': 'https://evil.example'},
        )
        self.assertEqual(blocked.status_code, 403)

        no_auth = self.client.post(
            '/api/v1/meeting-copilot/sessions',
            json={'session_id': 'session-003', 'source': 'microphone'},
            headers={'Origin': 'http://localhost:5173'},
        )
        self.assertEqual(no_auth.status_code, 401)

    def test_websocket_rejects_missing_ticket_and_accepts_valid_session(self):
        create = self.client.post(
            '/api/v1/meeting-copilot/sessions',
            json={'session_id': 'session-web', 'source': 'microphone'},
            headers={'Authorization': 'Bearer token', 'Origin': 'http://localhost:5173'},
        )
        ticket = create.json()['data']['ticket']

        with self.assertRaises(WebSocketDisconnect):
            with self.client.websocket_connect(
                '/api/v1/meeting-copilot/ws/copilot?sessionId=session-web',
                headers={'origin': 'http://localhost:5173'},
            ):
                self.fail('A WebSocket without a ticket must not be accepted')

        with self.client.websocket_connect(
            f'/api/v1/meeting-copilot/ws/copilot?sessionId=session-web&ticket={ticket}',
            headers={'origin': 'http://localhost:5173'},
        ) as websocket:
            message = websocket.receive_json()
            self.assertEqual(message['type'], 'config-ack')
            websocket.send_json({
                'type': 'audio-raw',
                'pcm': [0, 1, -1],
                'source': 'microphone',
                'sampleRate': 16_000,
            })
            transcript = websocket.receive_json()
            self.assertEqual(transcript['type'], 'transcription')
            self.assertEqual(transcript['phase'], 'final')
            self.assertEqual(transcript['source'], 'microphone')
            websocket.send_json({'type': 'transcript-context', 'transcript': [{'speaker': 'Cliente', 'text': '¿Podemos incluirlo?'}], 'mode': 'requirements', 'language': 'es'})
            websocket.send_json({'type': 'suggestion-request', 'kind': 'what-reply'})
            suggestion = websocket.receive_json()
            self.assertEqual(suggestion['type'], 'suggestion')
            self.assertTrue(suggestion['result']['question_detected'])
            websocket.send_json({'type': 'summary-request'})
            summary = websocket.receive_json()
            self.assertEqual(summary['type'], 'summary')
            self.assertIn('action_items', summary['result'])

        with self.assertRaises(WebSocketDisconnect):
            with self.client.websocket_connect(
                f'/api/v1/meeting-copilot/ws/copilot?sessionId=session-web&ticket={ticket}',
                headers={'origin': 'http://localhost:5173'},
            ):
                self.fail('A consumed WebSocket ticket must not be reusable')

    def test_expired_invalid_and_wrong_origin_tickets_are_rejected(self):
        manager = self.app.state.meeting_session_manager
        with patch('trato_api.meeting_copilot.time.time', return_value=100):
            ticket = manager.create_ticket('session-expired', 'microphone', 'http://localhost:5173', 'owner-1')

        self.assertIsNone(manager.validate('session-expired', 'invalid-ticket', 'http://localhost:5173'))
        self.assertIsNone(manager.validate('session-expired', ticket, 'https://evil.example'))
        with patch('trato_api.meeting_copilot.time.time', return_value=100 + TICKET_TTL_SECONDS + 1):
            self.assertIsNone(manager.validate('session-expired', ticket, 'http://localhost:5173'))
        self.assertIsNone(manager.validate('session-expired', ticket, 'http://localhost:5173'))

    def test_websocket_rejects_invalid_ticket_and_untrusted_origins(self):
        for path, origin in (
            ('/api/v1/meeting-copilot/ws/copilot?sessionId=missing&ticket=bad', 'http://localhost:5173'),
            ('/api/v1/meeting-copilot/ws/copilot?sessionId=missing&ticket=bad', 'https://evil.example'),
        ):
            with self.subTest(origin=origin), self.assertRaises(WebSocketDisconnect):
                with self.client.websocket_connect(path, headers={'origin': origin}):
                    self.fail('An invalid WebSocket handshake must be rejected')

    def test_origin_parser_rejects_lookalike_local_hosts_and_missing_origin(self):
        self.assertTrue(is_origin_allowed('http://localhost:5173'))
        self.assertFalse(is_origin_allowed('http://localhost.attacker.example'))
        self.assertFalse(is_origin_allowed(''))


class MeetingCopilotProviderTests(unittest.IsolatedAsyncioTestCase):
    def test_selected_models_and_live_config_match_official_transcription_contract(self):
        from google.genai import types

        self.assertEqual(LIVE_TRANSCRIPTION_MODEL, 'gemini-3.5-transcribe-live')
        self.assertEqual(DEFAULT_ANALYSIS_MODEL, 'gemini-3.8-flash')
        config = types.LiveConnectConfig(**gemini_live_config('es'))
        self.assertEqual(config.response_modalities, ['TEXT'])
        self.assertEqual(config.input_audio_transcription.language_codes, ['es-419'])
        english = gemini_live_config('en')['input_audio_transcription']['language_codes']
        self.assertEqual(english, ['en-US'])

    async def test_missing_credentials_are_gated_without_creating_a_provider_client(self):
        provider = GeminiMeetingProvider(api_key='')
        self.assertFalse(provider.configured)
        with self.assertRaises(MeetingProviderError) as error:
            await provider.start(language='es')
        self.assertEqual(error.exception.code, 'PROVIDER_NOT_CONFIGURED')
        self.assertIsNone(provider.client)

    def test_suggestion_prompt_contains_mode_context_and_recent_transcript(self):
        prompt = build_suggestion_prompt(
            transcript=[{'speaker': 'Cliente', 'text': '¿Podemos cambiar la fecha?'}],
            kind='what-reply',
            mode='negotiation',
            context={'project': 'Portal'},
            language='es',
        )
        self.assertIn('Mode: negotiation', prompt)
        self.assertIn('Portal', prompt)
        self.assertIn('¿Podemos cambiar la fecha?', prompt)
        self.assertIn('objection_detected', prompt)

    async def test_suggestion_and_summary_validate_provider_json_without_network(self):
        class FakeResponse:
            def __init__(self, value):
                self.text = value

        class FakeModels:
            def __init__(self):
                self.responses = [
                    FakeResponse('{"question_detected":true,"objection_detected":false,"reply":"Aclaramos el alcance.","recommended_question":"¿Qué va primero?","rationale":"Pregunta detectada."}'),
                    FakeResponse('{"title":"Reunión","decisions":[],"action_items":[],"risks":[],"next_steps":[],"closing":"Seguimiento pendiente."}'),
                ]

            def generate_content(self, **_kwargs):
                return self.responses.pop(0)

        class FakeClient:
            def __init__(self):
                self.models = FakeModels()

        provider = GeminiMeetingProvider(api_key='test-only-placeholder')
        provider.client = FakeClient()
        suggestion = await provider.suggest(
            transcript=[{'speaker': 'Cliente', 'text': '¿Y la fecha?'}],
            kind='what-reply',
            mode='general',
            context={},
            language='es',
        )
        summary = await provider.summarize(transcript=[], context={}, mode='general', language='es')
        self.assertTrue(suggestion['question_detected'])
        self.assertEqual(summary['title'], 'Reunión')
        self.assertEqual(provider.analysis_model, DEFAULT_ANALYSIS_MODEL)


if __name__ == '__main__':
    unittest.main()
