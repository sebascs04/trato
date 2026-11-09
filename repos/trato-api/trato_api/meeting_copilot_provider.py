import asyncio
import json
import os
import time
from collections import deque
from typing import Any

LIVE_TRANSCRIPTION_MODEL = 'gemini-3.5-transcribe-live'
DEFAULT_ANALYSIS_MODEL = 'gemini-3.8-flash'
MAX_AUDIO_CHUNK_BYTES = 64 * 1024
MAX_TRANSCRIPT_CHARS = 24_000
MAX_LIVE_SECONDS = 10 * 60
SUGGESTION_LIMIT = 10
SUGGESTION_WINDOW_SECONDS = 60
SUPPORTED_MODES = {'general', 'sales', 'negotiation', 'requirements', 'support'}

MODE_GUIDANCE = {
    'general': 'Balance scope, goals, risks, and the relationship.',
    'sales': 'Clarify value, fit, priorities, and the next buying decision.',
    'negotiation': 'Identify interests, constraints, trade-offs, and commitments.',
    'requirements': 'Clarify user needs, acceptance criteria, dependencies, and open questions.',
    'support': 'Diagnose the issue, confirm impact, and propose the next verifiable step.',
}


class MeetingProviderError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def gemini_live_config(language: str = 'es') -> dict[str, Any]:
    language_code = {'es': 'es-419', 'en': 'en-US'}.get(language)
    transcription = {'language_codes': [language_code]} if language_code else {'language_codes': []}
    return {
        'response_modalities': ['TEXT'],
        'input_audio_transcription': transcription,
    }


def build_suggestion_prompt(
    *, transcript: list[dict[str, str]], kind: str, mode: str, context: dict[str, Any], language: str
) -> str:
    safe_mode = mode if mode in SUPPORTED_MODES else 'general'
    transcript_text = '\n'.join(
        f"{item.get('speaker', 'Speaker')}: {item.get('text', '')}"
        for item in transcript[-40:]
        if isinstance(item.get('text'), str)
    )[-MAX_TRANSCRIPT_CHARS:]
    context_text = json.dumps(context, ensure_ascii=False)[:8_000]
    return (
        'You are Trato Copilot, an in-call assistant for a freelancer. Analyze only the supplied meeting context. '
        'Do not invent contract terms, commitments, project facts, or client intent. Give a concise response in '
        f"{'Spanish' if language == 'es' else 'English'}. Mode: {safe_mode}. "
        f'Mode guidance: {MODE_GUIDANCE[safe_mode]} '
        'Detect whether the latest client turn contains a question or objection. Return one JSON object with exactly '
        'these fields: question_detected (boolean), objection_detected (boolean), reply (string), '
        'recommended_question (string), rationale (string). Use empty strings when no response/question is useful. '
        f'Action: {kind}. Context: {context_text}\nRecent transcript:\n{transcript_text}'
    )


class GeminiMeetingProvider:
    provider = 'gemini-live'

    def __init__(self, *, live_model: str | None = None, analysis_model: str | None = None, api_key: str | None = None):
        self.live_model = live_model or os.getenv('TRATO_GEMINI_LIVE_MODEL', LIVE_TRANSCRIPTION_MODEL)
        self.analysis_model = analysis_model or os.getenv('TRATO_GEMINI_ANALYSIS_MODEL', DEFAULT_ANALYSIS_MODEL)
        self.api_key = api_key if api_key is not None else os.getenv('TRATO_GEMINI_API_KEY', '')
        self.client = None
        self.live_context = None
        self.live_session = None
        self.events: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue(maxsize=128)
        self.reader_task: asyncio.Task | None = None
        self.started_at = 0.0
        self.transcript: deque[dict[str, str]] = deque(maxlen=200)
        self.closed = False

    @property
    def configured(self) -> bool:
        return bool(self.api_key and self.live_model and self.analysis_model)

    async def start(self, *, language: str = 'es', **_context: Any) -> None:
        if not self.api_key:
            raise MeetingProviderError('PROVIDER_NOT_CONFIGURED', 'Gemini credentials are not configured.')
        try:
            from google import genai
            from google.genai import types

            self.client = genai.Client(api_key=self.api_key)
            self.live_context = self.client.aio.live.connect(
                model=self.live_model,
                config=types.LiveConnectConfig(**gemini_live_config(language)),
            )
            self.live_session = await self.live_context.__aenter__()
            self.started_at = time.monotonic()
            self.reader_task = asyncio.create_task(self._receive_live_events())
        except MeetingProviderError:
            raise
        except Exception as error:
            await self.close()
            raise MeetingProviderError('PROVIDER_CONNECTION_FAILED', 'Gemini Live could not establish a session.') from error

    async def _receive_live_events(self) -> None:
        try:
            async for response in self.live_session.receive():
                content = getattr(response, 'server_content', None)
                if content is None:
                    continue
                for field, phase in (('interim_input_transcription', 'partial'), ('input_transcription', 'final')):
                    value = getattr(content, field, None)
                    text = getattr(value, 'text', '') if value else ''
                    if not text:
                        continue
                    event = {'type': 'transcription', 'phase': phase, 'text': text}
                    if phase == 'final':
                        self.transcript.append({'speaker': 'Audio capturado', 'text': text})
                    await self._put_event(event)
                usage = getattr(response, 'usage_metadata', None)
                if usage is not None:
                    await self._put_event({
                        'type': 'usage',
                        'total_tokens': getattr(usage, 'total_token_count', None),
                    })
        except asyncio.CancelledError:
            raise
        except Exception as error:
            await self._put_event({'type': 'error', 'code': 'PROVIDER_STREAM_FAILED', 'message': 'Gemini Live stream ended unexpectedly.'})
            await self._put_event(None)

    async def _put_event(self, event: dict[str, Any]) -> None:
        try:
            self.events.put_nowait(event)
        except asyncio.QueueFull:
            if event.get('type') == 'transcription' and event.get('phase') == 'partial':
                return
            await self.events.put(event)

    async def receive(self) -> dict[str, Any] | None:
        return await self.events.get()

    async def send_audio(self, pcm: bytes, *, sample_rate: int = 16_000) -> None:
        if self.closed or self.live_session is None:
            raise MeetingProviderError('PROVIDER_DISCONNECTED', 'Gemini Live session is not connected.')
        if time.monotonic() - self.started_at > MAX_LIVE_SECONDS:
            raise MeetingProviderError('LIVE_SESSION_LIMIT', 'The live transcription session reached its 10-minute limit.')
        if not pcm or len(pcm) > MAX_AUDIO_CHUNK_BYTES or len(pcm) % 2:
            raise MeetingProviderError('INVALID_AUDIO_FRAME', 'Audio frame is outside the accepted PCM limits.')
        try:
            from google.genai import types

            await self.live_session.send_realtime_input(
                audio=types.Blob(data=pcm, mime_type=f'audio/pcm;rate={sample_rate}')
            )
        except Exception as error:
            raise MeetingProviderError('PROVIDER_SEND_FAILED', 'Gemini Live could not accept an audio frame.') from error

    async def end_audio_stream(self) -> None:
        if self.live_session is None or self.closed:
            return
        try:
            await self.live_session.send_realtime_input(audio_stream_end=True)
        except Exception as error:
            raise MeetingProviderError('PROVIDER_SEND_FAILED', 'Gemini Live could not pause the audio stream.') from error

    async def _generate_json(self, prompt: str, *, max_output_tokens: int) -> dict[str, Any]:
        if self.client is None:
            raise MeetingProviderError('PROVIDER_NOT_CONFIGURED', 'Gemini credentials are not configured.')
        try:
            from google.genai import types

            response = await asyncio.to_thread(
                self.client.models.generate_content,
                model=self.analysis_model,
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type='application/json',
                    max_output_tokens=max_output_tokens,
                    temperature=0.2,
                ),
            )
            value = json.loads(response.text or '')
            if not isinstance(value, dict):
                raise ValueError('Expected JSON object')
            return value
        except MeetingProviderError:
            raise
        except Exception as error:
            raise MeetingProviderError('ANALYSIS_FAILED', 'Gemini could not analyze the current meeting context.') from error

    async def suggest(self, *, transcript: list[dict[str, str]], kind: str, mode: str, context: dict[str, Any], language: str) -> dict[str, Any]:
        value = await self._generate_json(
            build_suggestion_prompt(transcript=transcript, kind=kind, mode=mode, context=context, language=language),
            max_output_tokens=350,
        )
        required = ('question_detected', 'objection_detected', 'reply', 'recommended_question', 'rationale')
        if any(key not in value for key in required) or not isinstance(value['question_detected'], bool) or not isinstance(value['objection_detected'], bool):
            raise MeetingProviderError('INVALID_ANALYSIS_RESPONSE', 'Gemini returned an invalid suggestion contract.')
        if any(not isinstance(value[key], str) or len(value[key]) > 2_000 for key in required[2:]):
            raise MeetingProviderError('INVALID_ANALYSIS_RESPONSE', 'Gemini returned an invalid suggestion contract.')
        self.transcript = deque(transcript[-200:], maxlen=200)
        return value

    async def summarize(self, *, transcript: list[dict[str, str]], context: dict[str, Any], mode: str, language: str) -> dict[str, Any]:
        prompt = (
            f"Create a factual meeting summary in {'Spanish' if language == 'es' else 'English'} for a freelancer. "
            f'Mode: {mode if mode in SUPPORTED_MODES else "general"}. Context: '
            f"{json.dumps(context, ensure_ascii=False)[:8_000]}. Transcript: "
            f"{json.dumps(transcript[-80:], ensure_ascii=False)[:MAX_TRANSCRIPT_CHARS]}. "
            'Return JSON with title, decisions, action_items, risks, next_steps, closing. Use arrays of strings. '
            'Do not infer agreements or facts absent from the transcript.'
        )
        value = await self._generate_json(prompt, max_output_tokens=800)
        required_arrays = ('decisions', 'action_items', 'risks', 'next_steps')
        if not isinstance(value.get('title'), str) or not isinstance(value.get('closing'), str) or any(
            not isinstance(value.get(key), list) or any(not isinstance(item, str) for item in value[key])
            for key in required_arrays
        ):
            raise MeetingProviderError('INVALID_SUMMARY_RESPONSE', 'Gemini returned an invalid summary contract.')
        return value

    async def close(self) -> None:
        if self.closed:
            return
        self.closed = True
        if self.reader_task and self.reader_task is not asyncio.current_task():
            self.reader_task.cancel()
            await asyncio.gather(self.reader_task, return_exceptions=True)
        if self.live_context is not None:
            try:
                await self.live_context.__aexit__(None, None, None)
            except Exception:
                pass
        if self.client is not None:
            close = getattr(self.client, 'aclose', None)
            if close:
                try:
                    await close()
                except Exception:
                    pass
