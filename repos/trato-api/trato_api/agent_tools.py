"""Worker-only tools for a curated training library, never private project files."""
import json
import os
import re
import secrets
from hashlib import sha256
from pathlib import Path
from urllib.parse import urlparse
from uuid import UUID

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool
from .errors import ApiError

SOURCE_KEYS = frozenset({'active_listening', 'principled_negotiation', 'difficult_conversations',
                         'commitments', 'micro_skills'})
TOOL = 'search_text_file_id'
WORKFLOW = 'rehearsal_feedback'
MAX_REQUEST = 8000
MAX_SOURCE = 500_000
MAX_BUNDLE = 1_500_000
MAX_RESPONSE = 3_000_000


def read_json(path, maximum):
    try:
        with path.open('rb') as stream:
            raw = stream.read(maximum + 1)
        if len(raw) > maximum:
            raise ValueError()
        return raw, json.loads(raw)
    except (OSError, ValueError, RecursionError):
        raise ApiError('SOURCE_LIBRARY_UNREADABLE', 503) from None


class SourceLibrary:
    """Admin-configured immutable extracted files; model IDs cannot become paths."""
    def __init__(self, manifest=None):
        self.manifest = manifest if manifest is not None else os.environ.get('TRATO_REHEARSAL_SOURCE_MANIFEST', '')

    def load(self):
        if not self.manifest:
            raise ApiError('SOURCE_LIBRARY_NOT_CONFIGURED', 503)
        path = Path(self.manifest).resolve()
        raw, manifest = read_json(path, 16000)
        try:
            if (set(manifest) != {'schema_version', 'workflow', 'sources'} or
                type(manifest['schema_version']) is not int or manifest['schema_version'] != 1 or
                manifest['workflow'] != WORKFLOW or not isinstance(manifest['sources'], list) or
                len(manifest['sources']) != 5):
                raise ValueError()
            files, keys, ids, size = [], set(), set(), 0
            for item in manifest['sources']:
                if set(item) != {'key', 'file_id', 'filename', 'sha256'}:
                    raise ValueError()
                key, file_id = item['key'], item['file_id']
                if key not in SOURCE_KEYS or key in keys or file_id in ids or str(UUID(file_id)) != file_id:
                    raise ValueError()
                if not re.fullmatch(r'[a-f0-9]{64}', item['sha256']):
                    raise ValueError()
                # Fixed canonical basename, not an arbitrary path supplied by an agent.
                if item['filename'] != file_id + '.json':
                    raise ValueError()
                file = path.parent / item['filename']
                if file.is_symlink() or file.resolve().parent != path.parent:
                    raise ValueError()
                data, source = read_json(file, MAX_SOURCE)
                if sha256(data).hexdigest() != item['sha256']:
                    raise ApiError('SOURCE_LIBRARY_HASH_MISMATCH', 503)
                if source['file_id'] != file_id:
                    raise ValueError()
                files.append(source); keys.add(key); ids.add(file_id); size += len(data)
            if size > MAX_BUNDLE:
                raise ApiError('SOURCE_BUNDLE_TOO_LARGE', 413)
            return {'scope_id': sha256(raw).hexdigest(), 'files': files}
        except (KeyError, TypeError, ValueError, AttributeError):
            raise ApiError('SOURCE_LIBRARY_INVALID', 503) from None


class ProcessorSourceReader:
    def __init__(self, settings, transport=None):
        self.settings, self.transport = settings, transport

    def read(self, files):
        s = self.settings
        url = urlparse(s.processor_url)
        if (not s.processor_token or url.scheme not in ('http', 'https') or not url.hostname or
            url.username or url.password or url.query or url.fragment):
            raise ApiError('FILE_PROCESSOR_NOT_CONFIGURED', 503)
        try:
            with httpx.Client(timeout=25, follow_redirects=False, transport=self.transport) as client:
                with client.stream('POST', s.processor_url.rstrip('/') + '/v1/source-text/read',
                                   headers={'Authorization': 'Bearer ' + s.processor_token},
                                   json={'schema_version': 1, 'files': files}) as response:
                    parts, size = [], 0
                    for part in response.iter_bytes():
                        size += len(part)
                        if size > MAX_RESPONSE:
                            raise ApiError('INVALID_PROCESSOR_RESPONSE', 502)
                        parts.append(part)
                    if response.status_code != 200:
                        raise ApiError('SOURCE_READING_FAILED', 502)
                    result = json.loads(b''.join(parts))['data']
            # No omissions, replacements, invented metadata, or rewritten source text.
            expected = []
            for source in files:
                text = '\n\n'.join(segment['text'] for segment in source['segments'])
                expected.append({**source, 'text': text, 'text_sha256': sha256(text.encode()).hexdigest()})
            if result != {'schema_version': 1, 'files': expected}:
                raise ApiError('INVALID_PROCESSOR_RESPONSE', 502)
            return result
        except httpx.HTTPError:
            raise ApiError('FILE_PROCESSOR_UNAVAILABLE', 503) from None
        except (ValueError, KeyError, TypeError, RecursionError):
            raise ApiError('INVALID_PROCESSOR_RESPONSE', 502) from None


class AgentTools:
    def __init__(self, settings, library=None, reader=None):
        self.library = library if library is not None else SourceLibrary()
        self.reader = reader if reader is not None else ProcessorSourceReader(settings)

    def catalog(self):
        bundle = self.library.load()
        return {'schema_version': 1, 'workflow': WORKFLOW, 'scope_id': bundle['scope_id'],
                'enabled_tools': [TOOL], 'required_file_ids': [f['file_id'] for f in bundle['files']]}

    def execute(self, call):
        try:
            if set(call) != {'workflow', 'scope_id', 'tool', 'params'} or call['workflow'] != WORKFLOW:
                raise ValueError()
            if call['tool'] != TOOL:
                raise ApiError('TOOL_NOT_ALLOWED', 403)
            params = call['params']
            ids = params['file_ids']
            if (set(params) != {'file_ids'} or not isinstance(ids, list) or not 1 <= len(ids) <= 5 or
                any(not isinstance(i, str) for i in ids) or len(set(ids)) != len(ids)):
                raise ValueError()
        except (KeyError, ValueError, TypeError):
            raise ApiError('INVALID_TOOL_CALL', 422) from None
        bundle = self.library.load()
        if call['scope_id'] != bundle['scope_id']:
            raise ApiError('SOURCE_SCOPE_CHANGED', 409)
        by_id = {f['file_id']: f for f in bundle['files']}
        if any(i not in by_id for i in ids):
            raise ApiError('SOURCE_NOT_ALLOWED', 403)
        result = self.reader.read([by_id[i] for i in ids])
        return {**result, 'scope_id': bundle['scope_id']}


def build_agent_tools_router(settings, service=None):
    router = APIRouter(prefix='/internal/agent-tools')
    service = service if service is not None else AgentTools(settings)

    def authorize(request):
        token = os.environ.get('TRATO_WORKER_TOKEN', '')
        if not token:
            raise ApiError('WORKER_NOT_CONFIGURED', 503)
        if not secrets.compare_digest(request.headers.get('authorization', '').encode(), ('Bearer ' + token).encode()):
            raise ApiError('UNAUTHORIZED', 401)

    @router.get('/rehearsal-feedback/catalog')
    async def catalog(request: Request):
        authorize(request)
        result = await run_in_threadpool(service.catalog)
        return JSONResponse({'data': result}, headers={'Cache-Control': 'no-store'})

    @router.post('/execute')
    async def execute(request: Request):
        authorize(request)
        parts, size = [], 0
        async for chunk in request.stream():
            size += len(chunk)
            if size > MAX_REQUEST:
                raise ApiError('INVALID_TOOL_CALL', 413)
            parts.append(chunk)
        try:
            call = json.loads(b''.join(parts))
            if not isinstance(call, dict):
                raise ValueError()
        except (ValueError, RecursionError):
            raise ApiError('INVALID_TOOL_CALL', 422) from None
        result = await run_in_threadpool(service.execute, call)
        return JSONResponse({'data': result}, headers={'Cache-Control': 'no-store'})

    return router
