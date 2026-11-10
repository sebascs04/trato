import asyncio
import inspect
import os
import struct
import time
import uuid
from typing import Any
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from .meeting_copilot_provider import (
    GeminiMeetingProvider,
    MeetingProviderError,
    SUPPORTED_MODES,
)

class LiveMeetingMarker:
    """While a live meeting is open, a short-lived Redis key says so; a restart or deploy can wait for it to end.

    Best effort: without Redis the meeting works the same. The key expires by itself if the API stops abruptly.
    """
    PREFIX, TTL, EVERY = 'trato:meeting:live:', 45, 15

    def __init__(self, session_id: str):
        self.key = self.PREFIX + (session_id or 'unknown')[:80]
        url = os.getenv('TRATO_REDIS_URL', '').strip().strip('"')
        self.redis = None
        if url:
            try:
                from redis import Redis
                self.redis = Redis.from_url(url, socket_connect_timeout=2, socket_timeout=2)
            except Exception:
                self.redis = None

    async def beat(self) -> None:
        while self.redis is not None:
            try:
                await run_in_threadpool(self.redis.set, self.key, '1', ex=self.TTL)
            except Exception:
                pass
            await asyncio.sleep(self.EVERY)

    async def clear(self) -> None:
        if self.redis is not None:
            try:
                await run_in_threadpool(self.redis.delete, self.key)
            except Exception:
                pass


ALLOWED_ORIGINS = {
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:8000',
    'http://127.0.0.1:8000',
}

MAX_MESSAGE_BYTES = 64 * 1024
TICKET_TTL_SECONDS = 60 * 15
MAX_CONNECTIONS_PER_SESSION = 1


def normalize_origin(value: str | None) -> str:
    text = (value or '').strip().rstrip('/')
    return text


def is_origin_allowed(origin: str | None) -> bool:
    origin = normalize_origin(origin)
    if not origin:
        return False
    configured_origins = {
        normalize_origin(value)
        for value in os.getenv('TRATO_MEETING_ALLOWED_ORIGINS', '').split(',')
        if value.strip()
    }
    if origin in ALLOWED_ORIGINS or origin in configured_origins:
        return True
    try:
        parsed = urlsplit(origin)
        return (
            parsed.scheme in {'http', 'https'}
            and parsed.hostname in {'localhost', '127.0.0.1'}
            and parsed.username is None
            and parsed.password is None
            and parsed.path == ''
            and not parsed.query
            and not parsed.fragment
            and (parsed.port is None or 1 <= parsed.port <= 65535)
        )
    except ValueError:
        return False


class MeetingSessionManager:
    def __init__(self):
        self._sessions: dict[str, dict[str, Any]] = {}

    def create_ticket(self, session_id: str, source: str, origin: str, owner_id: str) -> str:
        ticket = uuid.uuid4().hex
        self._sessions[ticket] = {
            'session_id': session_id,
            'source': source,
            'origin': normalize_origin(origin),
            'owner_id': owner_id,
            'issued_at': time.time(),
            'status': 'ready',
            'connections': 0,
            'consumed': False,
            'last_seen': time.time(),
        }
        return ticket

    def validate(self, session_id: str, ticket: str, origin: str | None) -> dict[str, Any] | None:
        session = self._sessions.get(ticket)
        if session is None:
            return None
        if time.time() - float(session.get('issued_at', 0)) > TICKET_TTL_SECONDS:
            self.close(ticket)
            return None
        if session['session_id'] != session_id:
            return None
        if not is_origin_allowed(origin):
            return None
        if session['origin'] and normalize_origin(origin) and session['origin'] != normalize_origin(origin):
            return None
        session['last_seen'] = time.time()
        return session

    def register_connection(self, ticket: str) -> bool:
        session = self._sessions.get(ticket)
        if session is None:
            return False
        if session.get('consumed') or session.get('connections', 0) >= MAX_CONNECTIONS_PER_SESSION:
            return False
        session['connections'] = int(session.get('connections', 0)) + 1
        session['consumed'] = True
        session['status'] = 'connected'
        return True

    def release_connection(self, ticket: str) -> None:
        session = self._sessions.get(ticket)
        if session is None:
            return
        session['connections'] = max(0, int(session.get('connections', 0)) - 1)
        if session['connections'] <= 0:
            session['status'] = 'idle'

    def close(self, ticket: str) -> None:
        self._sessions.pop(ticket, None)


def build_meeting_copilot_router(require_user, provider_factory=None):
    router = APIRouter(prefix='/api/v1/meeting-copilot')

    async def auth_dependency(request: Request):
        authorization = request.headers.get('authorization', '')
        if not authorization.startswith('Bearer ') or not authorization[7:].strip():
            raise HTTPException(status_code=401, detail='Authentication required')
        if inspect.iscoroutinefunction(require_user):
            return await require_user(request)
        result = await run_in_threadpool(require_user, request)
        return await result if inspect.isawaitable(result) else result

    @router.post('/sessions')
    async def create_session(request: Request, owner_id: str = Depends(auth_dependency)):
        payload = await request.json()
        session_id = str(payload.get('session_id') or uuid.uuid4().hex)
        source = str(payload.get('source') or 'microphone')
        origin = normalize_origin(str(payload.get('origin') or request.headers.get('origin') or ''))
        if source not in {'microphone', 'screen'}:
            raise HTTPException(status_code=400, detail='Unsupported source')
        if not is_origin_allowed(origin):
            raise HTTPException(status_code=403, detail='Origin not allowed')
        ticket = request.app.state.meeting_session_manager.create_ticket(session_id, source, origin, owner_id)
        # The language of the transcription, from Trato's language; Spanish when not given.
        if payload.get('language') in {'es', 'en'}:
            request.app.state.meeting_session_manager._sessions[ticket]['language'] = payload['language']
        from .meeting_copilot_provider import vertex_settings
        provider_configured = vertex_settings() is not None
        provider_name = 'gemini-live' if provider_configured else 'not-configured'
        return JSONResponse({
            'data': {
                'session_id': session_id,
                'source': source,
                'ticket': ticket,
                'origin': origin,
                'provider': provider_name,
                'status': 'ready' if provider_configured else 'not-configured',
                'message': 'Session ticket created; provider connections require explicit Gemini configuration.'
            }
        }, headers={'Cache-Control': 'no-store'})

    @router.post('/sessions/{session_id}/close')
    async def close_session(request: Request, session_id: str, owner_id: str = Depends(auth_dependency)):
        ticket = request.headers.get('X-Meeting-Ticket') or request.headers.get('X-Meeting-Session') or ''
        if not ticket:
            raise HTTPException(status_code=400, detail='Missing session ticket')
        session = request.app.state.meeting_session_manager.validate(session_id, ticket, request.headers.get('origin'))
        if session is None or session['owner_id'] != owner_id:
            raise HTTPException(status_code=403, detail='Session not authorized')
        request.app.state.meeting_session_manager.close(ticket)
        return JSONResponse({'data': {'session_id': session_id, 'status': 'closed'}}, headers={'Cache-Control': 'no-store'})

    @router.get('/sessions/{session_id}/status')
    async def session_status(request: Request, session_id: str, owner_id: str = Depends(auth_dependency)):
        ticket = request.headers.get('X-Meeting-Ticket') or ''
        session = request.app.state.meeting_session_manager.validate(session_id, ticket, request.headers.get('origin')) if ticket else None
        if session is None or session['owner_id'] != owner_id:
            raise HTTPException(status_code=403, detail='Session not available')
        return JSONResponse({'data': {'session_id': session_id, 'status': session['status'], 'source': session['source']}}, headers={'Cache-Control': 'no-store'})

    @router.websocket('/ws/copilot')
    async def meeting_websocket(websocket: WebSocket):
        origin = websocket.headers.get('origin', '')
        ticket = websocket.query_params.get('ticket') or websocket.headers.get('x-meeting-ticket') or ''
        session_id = websocket.query_params.get('sessionId', '')
        if not is_origin_allowed(origin):
            await websocket.close(code=1008)
            return
        if not ticket or not session_id:
            await websocket.close(code=1008)
            return
        manager = getattr(websocket.app.state, 'meeting_session_manager', None)
        if manager is None:
            await websocket.close(code=1011)
            return
        session = manager.validate(session_id, ticket, origin)
        if session is None:
            await websocket.close(code=1008)
            return
        if not manager.register_connection(ticket):
            await websocket.close(code=1013)
            return
        provider = provider_factory() if provider_factory else GeminiMeetingProvider()
        if not getattr(provider, 'configured', False):
            manager.release_connection(ticket)
            await websocket.close(code=1013)
            return
        await websocket.accept()
        sender_task = None
        heartbeat_task = None
        send_lock = asyncio.Lock()
        live_marker = LiveMeetingMarker(session_id)

        async def send(payload: dict[str, Any]) -> None:
            async with send_lock:
                await websocket.send_json(payload)

        try:
            # The transcription starts in the language the browser gave when it created the session.
            start_language = session.get('language') if session.get('language') in {'es', 'en'} else 'es'
            await provider.start(language=start_language)
            heartbeat_task = asyncio.create_task(live_marker.beat())
            await send({
                'type': 'config-ack',
                'provider': provider.provider,
                'status': 'ready',
                'session_id': session_id,
                'source': session['source'],
            })

            async def forward_provider_events() -> None:
                while True:
                    event = await provider.receive()
                    if event is None:
                        return
                    event.setdefault('source', session['source'])
                    await send(event)

            sender_task = asyncio.create_task(forward_provider_events())
            recent_suggestions: list[float] = []
            transcript: list[dict[str, str]] = []
            context: dict[str, Any] = {}
            mode = 'general'
            language = start_language
            while True:
                payload = await websocket.receive_json()
                if len(str(payload).encode('utf-8')) > MAX_MESSAGE_BYTES:
                    await websocket.close(code=1009)
                    break
                message_type = payload.get('type')
                if message_type == 'session-open':
                    mode = payload.get('mode') if payload.get('mode') in SUPPORTED_MODES else 'general'
                    language = payload.get('language') if payload.get('language') in {'es', 'en'} else 'es'
                    context = payload.get('context') if isinstance(payload.get('context'), dict) else {}
                    await send({'type': 'status', 'provider': provider.provider, 'status': 'accepted', 'source': session['source']})
                elif message_type == 'audio-raw':
                    pcm = payload.get('pcm')
                    source = payload.get('source')
                    sample_rate = payload.get('sampleRate', 16_000)
                    if (
                        not isinstance(pcm, list)
                        or not pcm
                        or len(pcm) > 32_000
                        or any(type(sample) is not int or sample < -32768 or sample > 32767 for sample in pcm)
                        or source != session['source']
                        or type(sample_rate) is not int
                        or not 8_000 <= sample_rate <= 96_000
                    ):
                        await websocket.close(code=1009)
                        break
                    audio_bytes = struct.pack(f'<{len(pcm)}h', *pcm)
                    try:
                        await provider.send_audio(audio_bytes, sample_rate=sample_rate)
                    except MeetingProviderError as error:
                        await send({'type': 'error', 'code': error.code, 'message': str(error)})
                        break
                elif message_type == 'transcript-context':
                    incoming = payload.get('transcript')
                    if not isinstance(incoming, list) or len(incoming) > 200:
                        await websocket.close(code=1009)
                        break
                    transcript = [
                        {'speaker': str(item.get('speaker', '')), 'text': str(item.get('text', ''))[:2_000]}
                        for item in incoming
                        if isinstance(item, dict) and isinstance(item.get('text'), str)
                    ][-80:]
                    mode = payload.get('mode') if payload.get('mode') in SUPPORTED_MODES else 'general'
                    language = payload.get('language') if payload.get('language') in {'es', 'en'} else 'es'
                    context = payload.get('context') if isinstance(payload.get('context'), dict) else context
                elif message_type == 'suggestion-request':
                    now = time.monotonic()
                    recent_suggestions = [value for value in recent_suggestions if now - value < 60]
                    if len(recent_suggestions) >= 10:
                        await send({'type': 'error', 'code': 'SUGGESTION_RATE_LIMIT', 'message': 'Suggestion limit reached. Wait before requesting another.'})
                        continue
                    kind = payload.get('kind')
                    if kind not in {'what-reply', 'brief', 'ask', 'objection'}:
                        await send({'type': 'error', 'code': 'INVALID_SUGGESTION_KIND', 'message': 'Unsupported suggestion action.'})
                        continue
                    recent_suggestions.append(now)
                    try:
                        result = await provider.suggest(
                            transcript=transcript,
                            kind=kind,
                            mode=mode,
                            context=context,
                            language=language,
                        )
                        await send({'type': 'suggestion', 'kind': kind, 'result': result})
                    except MeetingProviderError as error:
                        await send({'type': 'error', 'code': error.code, 'message': str(error)})
                elif message_type == 'summary-request':
                    try:
                        result = await provider.summarize(
                            transcript=transcript,
                            context=context,
                            mode=mode,
                            language=language,
                        )
                        await send({'type': 'summary', 'result': result})
                    except MeetingProviderError as error:
                        await send({'type': 'error', 'code': error.code, 'message': str(error)})
                elif message_type in {'pause', 'resume'}:
                    if message_type == 'pause':
                        try:
                            await provider.end_audio_stream()
                        except MeetingProviderError as error:
                            await send({'type': 'error', 'code': error.code, 'message': str(error)})
                    await send({'type': 'status', 'provider': provider.provider, 'status': message_type})
                else:
                    await send({'type': 'error', 'code': 'INVALID_MESSAGE', 'message': 'Unsupported meeting message.'})
        except WebSocketDisconnect:
            pass
        except MeetingProviderError as error:
            try:
                await send({'type': 'error', 'code': error.code, 'message': str(error)})
            except Exception:
                pass
        finally:
            for task in (sender_task, heartbeat_task):
                if task:
                    task.cancel()
                    await asyncio.gather(task, return_exceptions=True)
            await live_marker.clear()
            await provider.close()
            manager.release_connection(ticket)

    return router
