"""Durable index commands, bound to server-owned source context, without an LLM."""
import json
import os
import secrets
from uuid import NAMESPACE_URL, uuid5
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool
from redis.exceptions import RedisError
from .ai_jobs import AIJobs, PREFIX
from .business_routes import read_bytes
from .errors import ApiError
from .persistence import uuid
from .thread_store import ThreadStore
from .vector_routes import VectorGateway, source


def enqueue_index(repo, jobs, owner, project_id, file_id, job_id=None):
    owner, project_id, file_id = uuid(owner), uuid(project_id), uuid(file_id)
    project = repo.project(project_id)
    value = source(repo, owner, project, file_id)
    data = {'workflow': 'index_document', 'owner_id': owner, 'client_id': project['client_id'],
            'project_id': project_id, 'file_id': file_id, 'generation': value['generation']}
    job_id = uuid(job_id) if job_id else str(uuid5(NAMESPACE_URL, 'trato:index-job:' + owner + ':' + file_id + ':' + value['generation']))
    return jobs.enqueue(owner, job_id, data)


class IndexJobs:
    def __init__(self, settings, *, jobs=None, repository=None, gateway=None):
        self.settings, self.jobs = settings, jobs if jobs is not None else AIJobs()
        self.repository = repository
        self.gateway = gateway if gateway is not None else VectorGateway(settings)

    def after_extraction(self, store, thread_id):
        rows = store.repo.rows('worker_threads', {'select': 'owner_id,project_id,subject_id,status,workflow',
                              'id': 'eq.' + uuid(thread_id)})
        if not rows or rows[0]['status'] != 'ready' or rows[0]['workflow'] != 'ingest_document':
            return
        row = rows[0]
        if os.getenv('TRATO_FILE_PROCESSING_ENABLED')=='true':
            from .file_processing import enqueue_processing
            from .model_preferences import ModelPreferences
            enqueue_processing(store.repo,self.jobs,row['owner_id'],row['project_id'],row['subject_id'],ModelPreferences().configuration()[1])
        else:
            enqueue_index(store.repo, self.jobs, row['owner_id'], row['project_id'], row['subject_id'])

    def execute(self, job_id, execution_id):
        job_id, execution_id = uuid(job_id), uuid(execution_id)
        try:
            row = self.jobs.connection().hgetall(PREFIX + job_id)
        except RedisError:
            raise ApiError('VECTOR_REGISTRY_UNAVAILABLE', 503) from None
        if not row or row.get('status') != 'running' or row.get('execution_id') != execution_id:
            raise ApiError('VECTOR_JOB_NOT_ACTIVE', 409)
        try:
            data = json.loads(row['input'])
            if data.get('workflow') == 'index_reputation':
                from .reputation_vector import PublicVector
                return PublicVector(self.settings,server=self.repository).sync(uuid(data['profile_id']))
            if data['workflow'] != 'index_document' or data['owner_id'] != row['owner']:
                raise ValueError()
            owner, project_id, file_id = (uuid(data[k]) for k in ('owner_id', 'project_id', 'file_id'))
        except (ValueError, KeyError, TypeError):
            raise ApiError('VECTOR_JOB_INVALID', 422) from None
        repo = self.repository if self.repository is not None else ThreadStore(self.settings).repo
        project = repo.project(project_id)
        clients = repo.rows('clients', {'select': 'id', 'id': 'eq.' + project['client_id'],
                           'owner_id': 'eq.' + owner, 'deleted_at': 'is.null'})
        if not clients or project['client_id'] != data['client_id']:
            raise ApiError('PROJECT_NOT_FOUND', 404)
        value = source(repo, owner, project, file_id)
        if value['generation'] != data['generation']:
            raise ApiError('VECTOR_SOURCE_CHANGED', 409)
        result = self.gateway.index(repo, owner, project_id, file_id)
        return {'kind': 'document_index', **result}


def build_vector_job_router(settings, service=None):
    router = APIRouter(prefix='/internal/vector-jobs')
    service = service if service is not None else IndexJobs(settings)
    @router.post('/{job_id}/execute')
    async def execute(job_id: str, request: Request):
        token = os.getenv('TRATO_WORKER_TOKEN', '')
        if not token:
            raise ApiError('WORKER_NOT_CONFIGURED', 503)
        if not secrets.compare_digest(request.headers.get('authorization', '').encode(), ('Bearer ' + token).encode()):
            raise ApiError('UNAUTHORIZED', 401)
        try:
            body = json.loads(await read_bytes(request, 4096))
            if not isinstance(body, dict) or set(body) != {'execution_id'}:
                raise ValueError()
        except (ValueError, TypeError):
            raise ApiError('INVALID_REQUEST', 422) from None
        result = await run_in_threadpool(service.execute, job_id, body['execution_id'])
        return JSONResponse({'data': result}, headers={'Cache-Control': 'no-store'})
    return router
