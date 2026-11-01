"""On-demand project search. Canonical text/authorization stay in Supabase/processor.

Redis holds durable projection receipts, not agreements or payment states. Search
never repairs an index implicitly, and never presents a partial index as complete.
"""
from hashlib import sha256
import json
import math
import os
from uuid import UUID, NAMESPACE_URL, uuid5

import httpx
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from redis import Redis
from redis.exceptions import RedisError, LockError

from .business_routes import read_bytes
from .errors import ApiError
from .persistence import Repository, uuid
from .vector_contract import PROFILE_ID, digest
from .vector_client import ProcessorVectorClient

POLICY = {'version': 'v1', 'max_chars': 800, 'overlap_chars': 100, 'max_chunks': 512}
PREFIX = 'trato:vector:receipt:'


class SearchInput(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    query: str = Field(min_length=1, max_length=4096)
    limit: int = Field(default=8, ge=1, le=20)


def source(repo, owner, project, file_id):
    value = repo.extraction(uuid(file_id))
    doc, extraction, segments = value['document'], value['extraction'], value['segments']
    if (doc['project_id'] != project['id'] or doc['owner_id'] != owner or project['owner_id'] != owner):
        raise ApiError('DOCUMENT_NOT_FOUND', 404)
    if not extraction or extraction['status'] != 'ready' or not segments:
        raise ApiError('VECTOR_SOURCE_NOT_READY', 409)
    canonical = []
    for segment in segments:
        kind = segment['locator_kind']
        if kind not in ('page', 'paragraph') or type(segment['locator_number']) is not int:
            raise ApiError('VECTOR_SOURCE_INVALID', 502)
        canonical.append({'segment_id': segment['id'], 'locator': {'kind': kind, kind: segment['locator_number']},
                          'text': segment['text']})
    if len({s['segment_id'] for s in canonical}) != len(canonical):
        raise ApiError('VECTOR_SOURCE_INVALID', 502)
    generation = digest([doc['id'], doc['sha256'], extraction['id'], canonical, POLICY, PROFILE_ID])
    return {'document': doc, 'extraction': extraction, 'segments': canonical, 'generation': generation}


class ProcessorChunks:
    def __init__(self, settings, transport=None):
        self.settings, self.transport = settings, transport

    def read_text(self,value):
        from urllib.parse import urlparse
        s=self.settings;p=urlparse(s.processor_url)
        if p.scheme not in ('http','https') or not p.hostname or p.username or p.password or p.query or p.fragment or not s.processor_token:
            raise ApiError('FILE_PROCESSOR_NOT_CONFIGURED',503)
        payload={'schema_version':1,'file_id':value['document']['id'],'source_sha256':value['document']['sha256'],
            'parser':value['extraction']['parser'],'parser_version':value['extraction']['parser_version'],'segments':value['segments']}
        try:
            with httpx.Client(timeout=30,transport=self.transport,follow_redirects=False) as client:
                with client.stream('POST',s.processor_url.rstrip('/')+'/v1/files/prepared-text',
                    headers={'Authorization':'Bearer '+s.processor_token},json=payload) as response:
                    parts=[];size=0
                    for part in response.iter_bytes():
                        size+=len(part)
                        if size>1500000:raise ApiError('INVALID_PROCESSOR_RESPONSE',502)
                        parts.append(part)
                    if response.status_code!=200:raise ApiError('FILE_READING_FAILED',502)
                    result=json.loads(b''.join(parts))['data']
            text='\n\n'.join(seg['text'] for seg in value['segments'])
            expected={k:v for k,v in payload.items() if k!='file_id'}|{'text':text,'text_sha256':sha256(text.encode()).hexdigest()}
            if result!=expected:raise ApiError('INVALID_PROCESSOR_RESPONSE',502)
            return result
        except httpx.HTTPError:raise ApiError('FILE_PROCESSOR_UNAVAILABLE',503) from None
        except (ValueError,KeyError,TypeError):raise ApiError('INVALID_PROCESSOR_RESPONSE',502) from None

    def read(self, value):
        from urllib.parse import urlparse
        settings = self.settings
        parsed = urlparse(settings.processor_url)
        if (parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or
                parsed.password or parsed.query or parsed.fragment or not settings.processor_token):
            raise ApiError('FILE_PROCESSOR_NOT_CONFIGURED', 503)
        payload = {'schema_version': 1, 'file_id': value['document']['id'],
                   'source_fingerprint': value['generation'], 'policy': POLICY, 'segments': value['segments']}
        try:
            with httpx.Client(timeout=30, transport=self.transport, follow_redirects=False) as client:
                with client.stream('POST', settings.processor_url.rstrip('/') + '/v1/files/chunks',
                    headers={'Authorization': 'Bearer ' + settings.processor_token}, json=payload) as response:
                    parts, size = [], 0
                    for chunk in response.iter_bytes():
                        size += len(chunk)
                        if size > 1_500_000:
                            raise ApiError('VECTOR_DOCUMENT_LIMIT', 413)
                        parts.append(chunk)
                    if response.status_code != 200:
                        raise ApiError('VECTOR_CHUNKING_FAILED', 502)
                    result = json.loads(b''.join(parts))['data']
            validate_chunks(value, result)
            return result['chunks']
        except httpx.HTTPError:
            raise ApiError('FILE_PROCESSOR_UNAVAILABLE', 503) from None
        except (ValueError, TypeError, KeyError):
            raise ApiError('VECTOR_CHUNKS_INVALID', 502) from None


def validate_chunks(value, result):
    if (result['schema_version'] != 1 or result['file_id'] != value['document']['id'] or
        result['source_fingerprint'] != value['generation'] or result['policy_fingerprint'] != digest(POLICY) or
        result['offset_unit'] != 'unicode_code_points' or not 1 <= len(result['chunks']) <= 512):
        raise ValueError()
    by_segment = {s['segment_id']: s for s in value['segments']}
    seen, coverage = set(), {key: set() for key in by_segment}
    for chunk in result['chunks']:
        segment = by_segment[chunk['segment_id']]
        a, b, text = chunk['start_char'], chunk['end_char'], chunk['text']
        if (type(a) is not int or type(b) is not int or not 0 <= a < b <= len(segment['text']) or
            text != segment['text'][a:b] or chunk['locator'] != segment['locator'] or
            not text.strip() or len(text.encode()) > 4096 or chunk['chunk_id'] in seen or
            sha256(text.encode()).hexdigest() != chunk['text_sha256']):
            raise ValueError()
        UUID(chunk['chunk_id']); seen.add(chunk['chunk_id'])
        coverage[chunk['segment_id']].update(range(a, b))
    # No silent truncation or loss of non-whitespace source characters.
    for key, segment in by_segment.items():
        if any(not c.isspace() and i not in coverage[key] for i, c in enumerate(segment['text'])):
            raise ValueError()


class VectorGateway:
    def __init__(self, settings, *, store=None, redis=None, processor=None):
        self.store = store if store is not None else ProcessorVectorClient(settings)
        self.redis = redis
        self.processor = processor if processor is not None else ProcessorChunks(settings)

    def connection(self):
        if os.getenv('TRATO_VECTOR_SEARCH_ENABLED') != 'true':
            raise ApiError('VECTOR_NOT_CONFIGURED', 503)
        if self.redis is None:
            url = os.getenv('TRATO_REDIS_URL', '')
            if not url.startswith(('redis://', 'rediss://')):
                raise ApiError('VECTOR_NOT_CONFIGURED', 503)
            self.redis = Redis.from_url(url, decode_responses=True, socket_connect_timeout=5, socket_timeout=10)
        return self.redis

    def receipt_key(self, owner, file_id):
        return PREFIX + owner + ':' + file_id

    def receipt(self, owner, file_id):
        try:
            raw = self.connection().get(self.receipt_key(owner, file_id))
            if not raw:
                return None
            receipt = json.loads(raw)
            if not isinstance(receipt, dict) or receipt.get('status') not in ('ready', 'indexing', 'failed'):
                raise ValueError()
            return receipt
        except RedisError:
            raise ApiError('VECTOR_REGISTRY_UNAVAILABLE', 503) from None
        except ValueError:
            raise ApiError('VECTOR_REGISTRY_INVALID', 502) from None

    def index(self, repo, owner, project_id, file_id):
        owner, project_id, file_id = uuid(owner), uuid(project_id), uuid(file_id)
        project = repo.project(project_id)
        value = source(repo, owner, project, file_id)
        chunks = self.processor.read(value)
        records = []
        for chunk in chunks:
            properties = {'owner_id': owner, 'client_id': project['client_id'], 'project_id': project_id,
                'file_id': file_id, 'generation': value['generation'], 'embedding_identity': PROFILE_ID,
                'segment_id': chunk['segment_id'], 'text_sha256': chunk['text_sha256'],
                'start_char': chunk['start_char'], 'end_char': chunk['end_char'], 'chunk_text': chunk['text']}
            records.append({'id': str(uuid5(NAMESPACE_URL, 'trato:weaviate:' + digest(properties))),
                            'properties': properties})
        try:
            redis = self.connection()
            # Shared across API processes on this installation, with owner-independent capacity guard.
            lock = redis.lock('trato:vector:index-lock', timeout=2400, blocking_timeout=0)
            if not lock.acquire(blocking=False):
                raise ApiError('VECTOR_INDEX_BUSY', 409)
            try:
                redis.set(self.receipt_key(owner, file_id), json.dumps({'status': 'indexing',
                    'generation': value['generation'], 'project_id': project_id}))
                self.store.write(owner, records)
                after = source(repo, owner, repo.project(project_id), file_id)
                if value['generation'] != after['generation'] or not lock.owned():
                    raise ApiError('VECTOR_SOURCE_CHANGED', 409)
                receipt = {'status': 'ready', 'id': file_id, 'project_id': project_id,
                    'generation': value['generation'], 'objects': len(records), 'embedding_identity': PROFILE_ID}
                redis.set(self.receipt_key(owner, file_id), json.dumps(receipt))
                return receipt
            except ApiError as error:
                if lock.owned():
                    redis.set(self.receipt_key(owner, file_id), json.dumps({'status': 'failed',
                        'generation': value['generation'], 'project_id': project_id, 'error_code': error.code}))
                raise
            finally:
                if lock.owned():
                    lock.release()
        except (RedisError, LockError):
            raise ApiError('VECTOR_REGISTRY_UNAVAILABLE', 503) from None

    def snapshot(self, repo, owner, project_id):
        owner, project_id = uuid(owner), uuid(project_id)
        project = repo.project(project_id)
        if project['owner_id'] != owner:
            raise ApiError('PROJECT_NOT_FOUND', 404)
        documents = []
        for offset in range(0, 1001, 100):
            rows = repo.rows('documents', {'select': 'id,title,kind,original_filename,created_at',
                'project_id': 'eq.' + project_id, 'order': 'created_at.desc,id.asc', 'limit': 100, 'offset': offset})
            documents.extend({key: row[key] for key in ('id', 'title', 'kind', 'original_filename', 'created_at')}
                             for row in rows)
            if len(documents) > 1000:
                raise ApiError('VECTOR_INVENTORY_LIMIT', 413)
            if len(rows) < 100:
                break
        files = []
        for doc in documents:
            try:
                value = source(repo, owner, project, doc['id'])
            except ApiError as error:
                if error.code != 'VECTOR_SOURCE_NOT_READY':
                    raise
                files.append({**doc, 'status': 'source_pending', 'generation': None})
                continue
            receipt = self.receipt(owner, doc['id'])
            ready = (receipt and receipt.get('status') == 'ready' and
                     receipt.get('generation') == value['generation'] and receipt.get('embedding_identity') == PROFILE_ID)
            current = receipt if receipt and receipt.get('generation') == value['generation'] else None
            status = ('ready' if ready else 'index_error' if current and current['status'] == 'failed'
                      else 'indexing' if current and current['status'] == 'indexing' else 'index_pending')
            files.append({**doc, 'status': status,
                          **({'error_code': current['error_code']} if status == 'index_error' else {}),
                          'generation': value['generation'], '_source': value})
        return project, files

    def inventory(self, repo, owner, project_id, offset=0, limit=50):
        _, files = self.snapshot(repo, owner, project_id)
        if os.getenv('TRATO_FILE_PROCESSING_ENABLED')=='true':
            for file in files[offset:offset+limit]:file['summary']=self.summary(repo,file)
        return {'files': [{k: v for k, v in f.items() if not k.startswith('_')} for f in files[offset:offset+limit]],
            'total': len(files), 'next_offset': offset+limit if offset+limit < len(files) else None,
            'complete': all(f['status'] == 'ready' for f in files), 'embedding_identity': PROFILE_ID}

    def summary(self,repo,file):
        if not file.get('generation'):return None
        rows=repo.rows('file_processing_artifacts',{'select':'artifact','document_id':'eq.'+file['id'],
            'source_generation':'eq.'+file['generation'],'stage':'eq.summary','order':'created_at.desc','limit':1})
        if not rows:return None
        value=rows[0]['artifact']
        if value.get('summary_fingerprint')!=digest({k:v for k,v in value.items() if k!='summary_fingerprint'}):
            raise ApiError('FILE_SUMMARY_INVALID',502)
        return {k:value[k] for k in ('summary','topics','citations','output_language','model_identity','source_fingerprint')}

    def search(self, repo, owner, project_id, query, limit=8):
        if not isinstance(query, str) or not query.strip() or len(query.encode()) > 4096:
            raise ApiError('EMBEDDING_INPUT_LIMIT', 422)
        project, files = self.snapshot(repo, owner, project_id)
        if not files:
            raise ApiError('VECTOR_NO_SOURCES', 409)
        if any(f['status'] != 'ready' for f in files):
            raise ApiError('VECTOR_INDEX_INCOMPLETE', 409)
        rows = self.store.search(owner, project['client_id'], project_id, files, query, limit)
        if not isinstance(rows, list) or len(rows) > limit:
            raise ApiError('VECTOR_RESULT_INVALID', 502)
        by_file, results = {f['id']: f for f in files}, []
        summaries={}
        for row in rows:
            if (not isinstance(row, dict) or not isinstance(row.get('properties'), dict) or
                not isinstance(row.get('score'), (int, float)) or isinstance(row['score'], bool) or
                not math.isfinite(row['score'])):
                raise ApiError('VECTOR_RESULT_INVALID', 502)
            p = row['properties']
            f = by_file.get(p.get('file_id'))
            if (not f or p.get('owner_id') != owner or p.get('project_id') != project_id or
                p.get('client_id') != project['client_id'] or p.get('generation') != f['generation'] or
                p.get('embedding_identity') != PROFILE_ID):
                raise ApiError('VECTOR_RESULT_INVALID', 502)
            segment = next((s for s in f['_source']['segments'] if s['segment_id'] == p.get('segment_id')), None)
            a, b = p.get('start_char'), p.get('end_char')
            if (not segment or type(a) is not int or type(b) is not int or not 0 <= a < b <= len(segment['text']) or
                p.get('chunk_text') != segment['text'][a:b] or
                p.get('text_sha256') != sha256(segment['text'][a:b].encode()).hexdigest() or
                row.get('id') != str(uuid5(NAMESPACE_URL, 'trato:weaviate:' + digest(p)))):
                raise ApiError('VECTOR_RESULT_INVALID', 502)
            results.append({'file_id': f['id'], 'title': f['title'], 'filename': f['original_filename'],
                'kind': f['kind'], 'generation': f['generation'], 'segment_id': segment['segment_id'],
                'locator': segment['locator'], 'start_char': a, 'end_char': b, 'text': segment['text'][a:b],
                'score': row['score'], 'document_url': '/api/v1/documents/' + f['id'] + '/file'})
            if os.getenv('TRATO_FILE_PROCESSING_ENABLED')=='true':
                if f['id'] not in summaries:summaries[f['id']]=self.summary(repo,f)
                results[-1]['document_summary']=summaries[f['id']]
        # Changes/deletions/archiving during retrieval invalidate the whole answer.
        _, after = self.snapshot(repo, owner, project_id)
        if [(f['id'], f['generation'], f['status']) for f in files] != [(f['id'], f['generation'], f['status']) for f in after]:
            raise ApiError('VECTOR_SOURCE_CHANGED', 409)
        return {'matches': results, 'documents_checked': len(files), 'complete_inventory': True,
                'exhaustive_evidence': False, 'embedding_identity': PROFILE_ID,
                'hybrid_alpha': 0.7, 'fusion': 'relativeScoreFusion'}


def build_vector_router(settings, require_user, repository_factory=None, gateway=None):
    from fastapi import Query
    router = APIRouter(prefix='/api/v1/projects')
    gateway = gateway if gateway is not None else VectorGateway(settings)
    def repository(request: Request, user=Depends(require_user)):
        return (repository_factory or Repository)(settings, request.headers.get('authorization', ''))
    def reply(value):
        return JSONResponse({'data': value}, headers={'Cache-Control': 'no-store'})
    @router.get('/{project_id}/sources')
    def inventory(project_id: str, offset: int = Query(default=0, ge=0, le=1000),
                  limit: int = Query(default=50, ge=1, le=100), user=Depends(require_user), repo=Depends(repository)):
        return reply(gateway.inventory(repo, user, uuid(project_id), offset, limit))
    @router.post('/{project_id}/documents/{file_id}/index')
    def index(project_id: str, file_id: str, user=Depends(require_user), repo=Depends(repository)):
        return reply(gateway.index(repo, user, uuid(project_id), uuid(file_id)))
    @router.post('/{project_id}/sources/search')
    async def search(project_id: str, request: Request, user=Depends(require_user), repo=Depends(repository)):
        from starlette.concurrency import run_in_threadpool
        raw = await read_bytes(request, 18000)
        try:
            item = SearchInput.model_validate_json(raw)
        except (ValueError, ValidationError):
            raise ApiError('INVALID_REQUEST', 422) from None
        return reply(await run_in_threadpool(gateway.search, repo, user, uuid(project_id), item.query, item.limit))
    return router
