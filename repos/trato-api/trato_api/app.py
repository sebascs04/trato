import os
from dataclasses import dataclass, replace
from functools import partial
from urllib.parse import urlparse
from uuid import UUID

import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool
from paypal.routes import build_router
from paypal.email import EmailDeliveryError
from paypal.client import PayPalError
from .errors import ApiError
from .business_routes import build_business_router
from .thread_routes import build_thread_router
from .rehearsal_routes import build_rehearsal_router
from .graph_routes import build_graph_router
from .reputation_routes import build_reputation_router
from .proposals.routes import build_proposal_router
from .proposals.workflow import ProposalWorkflow
from .gmail.service import GmailSettings, GmailConnectionService
from .gmail.routes import build_gmail_router
from .sandbox_payment import SandboxPaymentTest
from .sandbox_payment_routes import build_sandbox_payment_router
from paypal.config import SandboxSettings

MAX_BYTES = 10 * 1024 * 1024


@dataclass(frozen=True)
class Settings:
    supabase_url: str = ''
    supabase_key: str = ''
    processor_url: str = 'http://127.0.0.1:8101'
    processor_token: str = ''
    web_origin: str = 'http://localhost:5174'

    @classmethod
    def from_env(cls):
        return cls(os.getenv('SUPABASE_URL', ''), os.getenv('SUPABASE_PUBLISHABLE_KEY', ''),
                   os.getenv('FILE_PROCESSOR_URL', 'http://127.0.0.1:8101'),
                   os.getenv('FILE_PROCESSOR_TOKEN', ''), os.getenv('WEB_ORIGIN', 'http://localhost:5174'))


class Services:
    def __init__(self, settings):
        self.settings = settings

    def authenticate(self, authorization):
        s = self.settings
        if not authorization.startswith('Bearer ') or not authorization[7:].strip():
            raise ApiError('UNAUTHORIZED', 401)
        if not s.supabase_url or not s.supabase_key:
            raise ApiError('AUTH_NOT_CONFIGURED', 503)
        if urlparse(s.supabase_url).scheme != 'https':
            raise ApiError('AUTH_NOT_CONFIGURED', 503)
        try:
            with httpx.Client(timeout=10, follow_redirects=False) as client:
                response = client.get(s.supabase_url.rstrip('/') + '/auth/v1/user',
                                      headers={'apikey': s.supabase_key, 'Authorization': authorization})
            if response.status_code in (401, 403):
                raise ApiError('UNAUTHORIZED', 401)
            if response.status_code != 200:
                raise ApiError('AUTH_UNAVAILABLE', 503)
            user_id = str(UUID(response.json()['id']))
            return user_id
        except (httpx.HTTPError, KeyError, ValueError, TypeError, AttributeError):
            raise ApiError('AUTH_UNAVAILABLE', 503)

    def extract(self, data, filename, content_type):
        s = self.settings
        if not s.processor_token:
            raise ApiError('FILE_PROCESSOR_NOT_CONFIGURED', 503)
        parsed = urlparse(s.processor_url)
        if parsed.username or parsed.password or parsed.scheme not in ('http', 'https'):
            raise ApiError('FILE_PROCESSOR_NOT_CONFIGURED', 503)
        try:
            with httpx.Client(timeout=20, follow_redirects=False) as client:
                with client.stream('POST', s.processor_url.rstrip('/') + '/v1/extractions',
                                   params={'filename': filename}, content=data,
                                   headers={'Authorization': 'Bearer ' + s.processor_token,
                                            'Content-Type': content_type}) as response:
                    # Text is represented twice (full text and segments); cap gateway memory too.
                    chunks, size = [], 0
                    for chunk in response.iter_bytes():
                        size += len(chunk)
                        if size > 4 * 1024 * 1024:
                            raise ApiError('INVALID_PROCESSOR_RESPONSE', 502)
                        chunks.append(chunk)
                    import json
                    body = json.loads(b''.join(chunks))
            if response.status_code in (413, 415, 422):
                raise ApiError(body.get('error', {}).get('code', 'EXTRACTION_FAILED'), response.status_code)
            if response.status_code != 200:
                raise ApiError('FILE_PROCESSOR_UNAVAILABLE', 503)
            result = body['data']
            if result.get('schema_version') != 1 or not isinstance(result.get('segments'), list):
                raise ApiError('INVALID_PROCESSOR_RESPONSE', 502)
            return result
        except (httpx.HTTPError, ValueError, KeyError, TypeError, AttributeError):
            raise ApiError('FILE_PROCESSOR_UNAVAILABLE', 503)


def require_user(request: Request):
    """Reusable FastAPI dependency for P1's payment router; runs in its thread pool."""
    return request.app.state.services.authenticate(request.headers.get('authorization', ''))


def create_app(settings=None, services=None, repository_factory=None, *, gmail_service=None, sandbox_test_service=None, proposal_repository_factory=None, graph_reader=None, rehearsal_service=None):
    settings = settings or Settings.from_env()
    services = services or Services(settings)
    app = FastAPI(title='Trato API', version='0.1.0')
    app.state.services = services
    gmail_settings = GmailSettings.from_env()
    if gmail_service is None and gmail_settings.configured():
        gmail_service = GmailConnectionService(gmail_settings)
    app.state.gmail = gmail_service
    if sandbox_test_service is None and os.getenv('TRATO_PAYPAL_TEST_ENABLED') == 'true':
        test_settings = replace(SandboxSettings.from_env(), return_url=os.environ['PAYPAL_TEST_RETURN_URL'], cancel_url=os.environ['PAYPAL_TEST_CANCEL_URL'])
        sandbox_test_service = SandboxPaymentTest(test_settings, os.environ['PAYPAL_TEST_STORE'])
    app.state.sandbox_test = sandbox_test_service
    app.add_middleware(CORSMiddleware, allow_origins=[settings.web_origin],
                       allow_methods=['GET', 'POST'], allow_headers=['Authorization', 'Content-Type', 'Idempotency-Key'])
    # No fake repository: payment routes stay explicitly unavailable until persistence is ready.
    app.include_router(build_router(None, None, require_user))
    app.include_router(build_gmail_router(gmail_service, require_user))
    app.include_router(build_sandbox_payment_router(sandbox_test_service, require_user))
    app.include_router(build_business_router(settings, services, require_user, repository_factory))
    app.include_router(build_thread_router(settings))
    app.include_router(build_rehearsal_router(require_user,rehearsal_service))
    app.include_router(build_graph_router(settings,require_user,repository_factory,graph_reader))
    app.include_router(build_reputation_router(settings,require_user,repository_factory))
    app.include_router(build_proposal_router(settings, require_user, proposal_repository_factory, ProposalWorkflow(settings,gmail_service)))

    @app.exception_handler(ApiError)
    async def error_handler(request, error):
        return JSONResponse({'error': {'code': error.code}}, status_code=error.status,
                            headers={'Cache-Control': 'no-store'})

    @app.exception_handler(EmailDeliveryError)
    async def email_error(request,error):
        return JSONResponse({'error':{'code':error.code}},status_code=503 if error.uncertain else 422,headers={'Cache-Control':'no-store'})

    @app.exception_handler(PayPalError)
    async def payment_error(request,error):
        return JSONResponse({'error':{'code':error.code}},status_code=error.status,headers={'Cache-Control':'no-store'})

    @app.get('/health')
    def health():
        return {'service': 'trato-api', 'status': 'ok',
                'persistence_configured': bool(settings.supabase_url and settings.supabase_key),
                'persistence_health_checked': False}

    @app.post('/api/v1/documents/extract')
    async def extract(request: Request, filename: str):
        # Authenticate before reading file bytes. The service credential never reaches the browser.
        await run_in_threadpool(services.authenticate, request.headers.get('authorization', ''))
        if not 1 <= len(filename) <= 255:
            raise ApiError('INVALID_FILENAME', 422)
        chunks, size = [], 0
        async for chunk in request.stream():
            size += len(chunk)
            if size > MAX_BYTES:
                raise ApiError('FILE_TOO_LARGE', 413)
            chunks.append(chunk)
        result = await run_in_threadpool(partial(services.extract, b''.join(chunks), filename,
                                                 request.headers.get('content-type', '')))
        return JSONResponse({'data': result, 'persisted': False}, headers={'Cache-Control': 'no-store'})

    return app


app = create_app()
