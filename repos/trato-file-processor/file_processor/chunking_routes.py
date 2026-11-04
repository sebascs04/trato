"""Private file function; the API must authorize the source before invoking it."""
import json
import secrets
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool
from .chunking import chunk_file


def build_chunking_router(service_token):
    router = APIRouter()

    @router.post('/v1/files/chunks')
    async def chunks(request: Request):
        if not service_token:
            return JSONResponse({'error': {'code': 'SERVICE_NOT_CONFIGURED'}}, status_code=503)
        if not secrets.compare_digest(request.headers.get('authorization', '').encode(), ('Bearer ' + service_token).encode()):
            return JSONResponse({'error': {'code': 'UNAUTHORIZED'}}, status_code=401)
        parts, size = [], 0
        async for part in request.stream():
            size += len(part)
            if size > 1_500_000:
                return JSONResponse({'error': {'code': 'CHUNK_REQUEST_TOO_LARGE'}}, status_code=413)
            parts.append(part)
        try:
            result = await run_in_threadpool(chunk_file, json.loads(b''.join(parts)))
            return JSONResponse({'data': result}, headers={'Cache-Control': 'no-store'})
        except (ValueError, TypeError, RecursionError):
            return JSONResponse({'error': {'code': 'INVALID_CHUNK_REQUEST'}}, status_code=422)
    return router
