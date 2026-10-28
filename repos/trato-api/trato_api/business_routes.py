import json
from typing import Annotated

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, ValidationError
from starlette.concurrency import run_in_threadpool

from .errors import ApiError
from .persistence import DOCX, Repository, uuid

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]


class ClientInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    name: Name
    contact_email: str | None = Field(default=None, min_length=3, max_length=254)


class CloseRequestInput(BaseModel):
    model_config=ConfigDict(extra='forbid')
    reason:Annotated[str,StringConstraints(pattern='^(rejected|withdrawn)$')]
    notes:Annotated[str,StringConstraints(strip_whitespace=True,min_length=1,max_length=4000)]


class ProjectInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    client_id: str
    name: Name


async def read_bytes(request, maximum):
    chunks, size = [], 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > maximum:
            raise ApiError('REQUEST_TOO_LARGE', 413)
        chunks.append(chunk)
    return b''.join(chunks)


async def read_model(request, model):
    raw = await read_bytes(request, 4096)
    try:
        return model.model_validate_json(raw)
    except (ValidationError, ValueError):
        raise ApiError('INVALID_REQUEST', 422)


def ingestion(repo, services, reservation, data):
    doc = reservation['document']
    if reservation['extraction']['status'] == 'ready':
        return {'thread_id': reservation['extraction'].get('worker_thread_id'), 'status': 'ready'}
    repo.upload(doc, data)
    # The work and its outbox entry are committed together after the original is durable.
    # Redis availability does not determine whether the upload can be accepted.
    return repo.queue_document(doc['id'])


def build_business_router(settings, services, require_user, repository_factory=None):
    router = APIRouter(prefix='/api/v1')

    def repository(request: Request, user=Depends(require_user)):
        factory = repository_factory or Repository
        return factory(settings, request.headers.get('authorization', ''))

    def reply(data, status=200):
        return JSONResponse({'data': data}, status_code=status, headers={'Cache-Control': 'no-store'})

    @router.get('/config')
    def configuration():
        # Deliberately reject legacy/admin keys from this browser-facing endpoint.
        if not settings.supabase_key.startswith('sb_publishable_'):
            raise ApiError('PUBLIC_AUTH_NOT_CONFIGURED', 503)
        return reply({'supabase_url': settings.supabase_url, 'publishable_key': settings.supabase_key})

    @router.get('/session')
    def session(user=Depends(require_user)):
        return reply({'user_id': user})

    @router.get('/clients')
    def clients(repo=Depends(repository)):
        return reply(repo.list_clients())

    @router.post('/clients')
    async def create_client(request: Request, repo=Depends(repository)):
        item = await read_model(request, ClientInput)
        data = await run_in_threadpool(repo.create_client, item.name, item.contact_email)
        return reply(data, 201)

    @router.post('/clients/{client_id}/delete')
    def delete_client(client_id:str,repo=Depends(repository)):
        return reply(repo.soft_delete_client(uuid(client_id)))

    @router.get('/projects')
    def projects(client_id:str|None=None,repo=Depends(repository)):
        return reply(repo.list_projects(uuid(client_id)) if client_id is not None else repo.list_projects())

    @router.post('/projects')
    async def create_project(request: Request, repo=Depends(repository)):
        item = await read_model(request, ProjectInput)
        data = await run_in_threadpool(repo.create_project, item.client_id, item.name)
        return reply(data, 201)

    @router.get('/projects/{project_id}/activity')
    def activity(project_id:str,repo=Depends(repository)):
        return reply(repo.activity(uuid(project_id)))

    @router.get('/projects/{project_id}/request-status')
    def request_status(project_id:str,repo=Depends(repository)):
        return reply(repo.request_status(uuid(project_id)))

    @router.post('/requests/{request_id}/close')
    async def close_request(request_id:str,request:Request,repo=Depends(repository)):
        request_id=uuid(request_id)
        try:value=CloseRequestInput.model_validate_json(await read_bytes(request,20000))
        except (ValidationError,ValueError):raise ApiError('INVALID_REQUEST',422)
        return reply(await run_in_threadpool(repo.close_request,request_id,value.reason,value.notes))

    @router.get('/projects/{project_id}/documents')
    def documents(project_id: str, repo=Depends(repository)):
        return reply(repo.list_documents(uuid(project_id)))

    @router.post('/projects/{project_id}/documents')
    async def upload(project_id: str, request: Request, filename: str, title: str,
                     kind: str = 'reference', repo=Depends(repository)):
        project_id = uuid(project_id)
        key = request.headers.get('idempotency-key', '')
        if not 1 <= len(key) <= 128 or any(ord(c) < 33 or ord(c) > 126 for c in key):
            raise ApiError('INVALID_IDEMPOTENCY_KEY', 422)
        filename, title = filename.strip(), title.strip()
        if not 1 <= len(filename) <= 255 or not 1 <= len(title) <= 200 or kind not in ('initial_agreement', 'email_request', 'reference', 'addendum', 'delivery'):
            raise ApiError('INVALID_DOCUMENT_METADATA', 422)
        mime = request.headers.get('content-type', '').split(';', 1)[0].strip().lower()
        if (filename.lower().endswith('.pdf') and mime == 'application/pdf'):
            expected_magic = b'%PDF-'
        elif filename.lower().endswith('.docx') and mime == DOCX:
            raise ApiError('PDF_CONVERSION_REQUIRED', 422)
        else:
            raise ApiError('UNSUPPORTED_FORMAT', 415)
        # Authorize before accepting the body or storing an original.
        await run_in_threadpool(repo.project, project_id)
        data = await read_bytes(request, 10485760)
        if not data.startswith(expected_magic):
            raise ApiError('FORMAT_MISMATCH', 422)
        reservation = await run_in_threadpool(repo.reserve, project_id, title, kind, filename, mime, data, key)
        result = await run_in_threadpool(ingestion, repo, services, reservation, data)
        return JSONResponse({'data': result, 'persisted': True}, status_code=200 if result['status']=='ready' else 202, headers={'Cache-Control': 'no-store'})

    @router.get('/documents/{document_id}/extraction')
    def extraction(document_id: str, repo=Depends(repository)):
        return reply(repo.extraction(uuid(document_id)))

    @router.get('/documents/{document_id}/file')
    def original(document_id: str, repo=Depends(repository)):
        doc = repo.document(uuid(document_id))
        # Authenticated proxy avoids durable share links and never serves a public bucket URL.
        return Response(repo.download(doc), media_type=doc['mime_type'], headers={
            'Cache-Control': 'no-store', 'Content-Disposition': 'attachment', 'X-Content-Type-Options': 'nosniff'})

    @router.post('/documents/{document_id}/retry')
    def retry(document_id: str, repo=Depends(repository)):
        doc = repo.document(uuid(document_id))
        current = repo.extraction(doc['id'])
        if current['extraction']['status'] == 'ready':
            return reply(current)
        result = repo.queue_document(doc['id'])
        return reply(result, 202)

    @router.get('/threads/{thread_id}')
    def thread_status(thread_id: str, repo=Depends(repository)):
        return reply(repo.thread_status(uuid(thread_id)))

    @router.get('/projects/{project_id}/events')
    def events(project_id: str, repo=Depends(repository)):
        return reply(repo.events(uuid(project_id)))

    return router
