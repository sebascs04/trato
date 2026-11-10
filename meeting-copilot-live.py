import os
import sys
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

PROJECT_ROOT = Path(__file__).resolve().parent
REPO_API_ROOT = PROJECT_ROOT / 'repos' / 'trato-api'
if str(REPO_API_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_API_ROOT))

from trato_api.meeting_copilot import MeetingSessionManager, build_meeting_copilot_router, is_origin_allowed

ALLOWED_ORIGINS = {
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:8000',
    'http://127.0.0.1:8000',
}


def require_user(request: Request):
    authorization = request.headers.get('authorization', '')
    if not authorization.startswith('Bearer ') or not authorization.split(' ', 1)[1].strip():
        from fastapi import HTTPException
        raise HTTPException(status_code=401, detail='Authentication required')
    return authorization.split(' ', 1)[1].strip()


def create_app(provider_factory=None) -> FastAPI:
    app = FastAPI(title='Trato Meeting Copilot Live', version='0.1.0')
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(ALLOWED_ORIGINS),
        allow_credentials=True,
        allow_methods=['*'],
        allow_headers=['Authorization', 'Content-Type', 'Origin', 'X-Meeting-Ticket'],
    )
    app.state.meeting_session_manager = MeetingSessionManager()
    app.include_router(build_meeting_copilot_router(require_user, provider_factory))

    @app.get('/health')
    async def health() -> dict[str, str]:
        return {'service': 'trato-meeting-copilot-live', 'status': 'ok'}

    @app.get('/api/v1/meeting-copilot/health')
    async def meeting_health() -> dict[str, str]:
        return {'service': 'trato-meeting-copilot-live', 'status': 'ok'}

    return app


app = create_app()


if __name__ == '__main__':
    import uvicorn

    uvicorn.run(app, host=os.getenv('TRATO_MEETING_HOST', '127.0.0.1'), port=int(os.getenv('TRATO_MEETING_PORT', '8100')))
