"""Only the worker can access job-bound originals. Never exposed by /config."""
import os
import secrets
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response
from starlette.concurrency import run_in_threadpool
from .errors import ApiError
from .persistence import uuid
from .thread_store import ThreadStore


def build_thread_router(settings, store_factory=None):
    router = APIRouter(prefix='/internal/threads')

    def store(request):
        token = os.environ.get('TRATO_WORKER_TOKEN', '')
        if not token:
            raise ApiError('WORKER_NOT_CONFIGURED', 503)
        if not secrets.compare_digest(request.headers.get('authorization', ''), 'Bearer ' + token):
            raise ApiError('UNAUTHORIZED', 401)
        return (store_factory or ThreadStore)(settings)

    @router.post('/claim')
    async def claim(request: Request):
        backend = store(request)
        parts=[];size=0
        async for chunk in request.stream():
            size+=len(chunk)
            if size>16000:raise ApiError('INVALID_THREAD',422)
            parts.append(chunk)
        raw=b''.join(parts)
        import json
        try:
            message = json.loads(raw)
            if not isinstance(message, dict):
                raise ValueError()
        except ValueError:
            raise ApiError('INVALID_THREAD', 422)
        result = await run_in_threadpool(backend.command, 'claim', {'message': message})
        if not result['terminal'] and 'document' in result:
            result['document'] = {k: v for k,v in result['document'].items()
                                  if k in ('id','project_id','kind','original_filename','mime_type','size_bytes','sha256')}
        return JSONResponse({'data': result}, headers={'Cache-Control': 'no-store'})

    @router.get('/{thread_id}/original')
    async def original(thread_id: str, lease_id: str, request: Request):
        backend = store(request)
        value = await run_in_threadpool(backend.original, uuid(thread_id), uuid(lease_id))
        return Response(value, media_type='application/pdf', headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'})

    @router.get('/{thread_id}/graph-input')
    async def graph_input(thread_id: str, lease_id: str, request: Request):
        backend=store(request)
        value=await run_in_threadpool(backend.command,'graph_input',{'message':{'thread_id':uuid(thread_id)},'lease_id':uuid(lease_id)})
        return JSONResponse({'data':value},headers={'Cache-Control':'no-store'})

    return router
