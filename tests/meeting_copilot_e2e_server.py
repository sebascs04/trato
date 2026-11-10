import asyncio
import sys
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

API_ROOT = Path(__file__).resolve().parents[1] / 'repos' / 'trato-api'
sys.path.insert(0, str(API_ROOT))

from trato_api.meeting_copilot import MeetingSessionManager, build_meeting_copilot_router


class LocalE2EProvider:
    provider = 'local-e2e-provider'
    configured = True

    def __init__(self):
        self.events = asyncio.Queue()
        self.sent_audio = False

    async def start(self, **_kwargs):
        return None

    async def receive(self):
        return await self.events.get()

    async def send_audio(self, pcm: bytes, *, sample_rate: int):
        if self.sent_audio:
            return
        self.sent_audio = True
        await self.events.put({'type': 'transcription', 'phase': 'partial', 'text': 'El cliente pregunta'})
        await self.events.put({'type': 'transcription', 'phase': 'final', 'text': 'El cliente pregunta por el alcance y la fecha.'})

    async def end_audio_stream(self):
        return None

    async def suggest(self, **_kwargs):
        context = _kwargs.get('context', {})
        project_name = context.get('project_name', 'sin proyecto seleccionado')
        document_count = len(context.get('documents', []))
        return {
            'question_detected': True,
            'objection_detected': True,
            'reply': 'Podemos confirmar primero qué entrega y fecha quedaron acordadas.',
            'recommended_question': '¿Qué parte del alcance necesitan priorizar?',
            'rationale': f'Audio local de prueba; contexto autorizado: {project_name}; documentos: {document_count}.',
        }

    async def summarize(self, **_kwargs):
        return {
            'title': 'Resumen local de la llamada de prueba',
            'decisions': ['No se registraron decisiones reales.'],
            'action_items': ['Validar el proveedor Gemini autorizado.'],
            'risks': ['Confirmar alcance y fecha con el cliente.'],
            'next_steps': ['Probar una llamada con credenciales aprobadas.'],
            'closing': 'Este resultado fue generado por el proveedor de prueba local.',
        }

    async def close(self):
        await self.events.put(None)


app = FastAPI(title='Trato Copilot E2E Test Provider')
app.state.meeting_session_manager = MeetingSessionManager()


def require_test_user(request: Request) -> str:
    authorization = request.headers.get('authorization', '')
    if not authorization.startswith('Bearer ') or not authorization[7:].strip():
        raise HTTPException(status_code=401, detail='Authentication required')
    return 'local-e2e-user'


app.include_router(build_meeting_copilot_router(require_test_user, LocalE2EProvider))


@app.get('/api/v1/clients')
async def test_clients():
    return {'data': [{'id': '00000000-0000-4000-8000-000000000001', 'name': 'Cliente E2E'}]}


@app.get('/api/v1/projects')
async def test_projects(client_id: str | None = None):
    if client_id != '00000000-0000-4000-8000-000000000001':
        return {'data': []}
    return {'data': [{
        'id': '00000000-0000-4000-8000-000000000002',
        'client_id': client_id,
        'name': 'Portal Web',
        'status': 'in_progress',
    }]}


@app.get('/api/v1/projects/{project_id}/documents')
async def test_documents(project_id: str):
    if project_id != '00000000-0000-4000-8000-000000000002':
        return {'data': []}
    return {'data': [{
        'id': '00000000-0000-4000-8000-000000000003',
        'title': 'Acuerdo inicial',
        'kind': 'initial_agreement',
        'document_extractions': [{'status': 'ready'}],
    }]}


@app.get('/health')
async def health():
    return {'service': 'trato-copilot-e2e-test', 'status': 'ok', 'provider': 'local-e2e-provider'}


@app.get('/api/v1/config')
async def config():
    return JSONResponse({'data': {
        'supabase_url': 'https://meeting-copilot-test.supabase.co',
        'publishable_key': 'sb_publishable_meeting_copilot_test_key',
    }}, headers={'Cache-Control': 'no-store'})


if __name__ == '__main__':
    import uvicorn

    uvicorn.run(app, host='127.0.0.1', port=8100, log_level='warning')