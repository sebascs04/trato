"""Private HTTP service; only the API holds the service token."""
import os
import secrets
from functools import partial

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from .extraction import ExtractionError, MAX_FILE_BYTES, extract_document
from .source_text import search_text_file_id, MAX_BUNDLE_BYTES
from .chunking_routes import build_chunking_router
from .vector_routes import build_vector_router
from .prepared_text import build_prepared_router
from pydantic import ValidationError
import json


def create_app(token=None):
    app = FastAPI(title='Trato File Processor', version='0.1.0', docs_url=None, redoc_url=None)
    service_token = token if token is not None else os.environ.get('FILE_PROCESSOR_TOKEN', '')
    app.include_router(build_chunking_router(service_token))
    app.include_router(build_vector_router(service_token))
    app.include_router(build_prepared_router(service_token))

    @app.get('/health')
    def health():
        return {'service': 'trato-file-processor', 'status': 'ok', 'formats': ['pdf', 'docx']}

    @app.post('/v1/extractions')
    async def extraction(request: Request, filename: str):
        if not service_token:
            return JSONResponse({'error': {'code': 'SERVICE_NOT_CONFIGURED'}}, status_code=503)
        if not secrets.compare_digest(request.headers.get('authorization', '').encode(), ('Bearer ' + service_token).encode()):
            return JSONResponse({'error': {'code': 'UNAUTHORIZED'}}, status_code=401)
        if not 1 <= len(filename) <= 255:
            return JSONResponse({'error': {'code': 'INVALID_FILENAME'}}, status_code=422)
        chunks, size = [], 0
        async for chunk in request.stream():
            size += len(chunk)
            if size > MAX_FILE_BYTES:
                return JSONResponse({'error': {'code': 'FILE_TOO_LARGE'}}, status_code=413)
            chunks.append(chunk)
        try:
            result = await run_in_threadpool(partial(extract_document, b''.join(chunks), filename,
                                                     request.headers.get('content-type', '')))
            return JSONResponse({'data': result}, headers={'Cache-Control': 'no-store'})
        except ExtractionError as error:
            return JSONResponse({'error': {'code': error.code, 'message': str(error)}}, status_code=error.status)

    @app.post('/v1/source-text/read')
    async def source_text(request: Request):
        if not service_token:
            return JSONResponse({'error': {'code': 'SERVICE_NOT_CONFIGURED'}}, status_code=503)
        if not secrets.compare_digest(request.headers.get('authorization', '').encode(), ('Bearer ' + service_token).encode()):
            return JSONResponse({'error': {'code': 'UNAUTHORIZED'}}, status_code=401)
        parts, size = [], 0
        async for chunk in request.stream():
            size += len(chunk)
            if size > MAX_BUNDLE_BYTES:
                return JSONResponse({'error': {'code': 'SOURCE_BUNDLE_TOO_LARGE'}}, status_code=413)
            parts.append(chunk)
        try:
            result = await run_in_threadpool(search_text_file_id, json.loads(b''.join(parts)))
            return JSONResponse({'data': result}, headers={'Cache-Control': 'no-store'})
        except (ValueError, TypeError, ValidationError, RecursionError):
            return JSONResponse({'error': {'code': 'INVALID_SOURCE_BUNDLE'}}, status_code=422)

    return app


app = create_app()
