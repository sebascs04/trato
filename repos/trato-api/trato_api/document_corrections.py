"""Correct a project document uploaded by mistake: remove it, or change its role.

The database decides (project_document_backend): only the owner, and only while no addendum, payment, delivery the
client saw, dispute, problem report or refund proposal has used the document. A removed document keeps its record
(deleted_at) and is purged from TeTrato's search the same way a withdrawn deliverable evidence is."""
from typing import Literal

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, ValidationError
from redis.exceptions import RedisError

from .errors import ApiError
from .persistence import Repository, uuid


class RoleInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    kind: Literal['initial_agreement', 'email_request', 'addendum', 'delivery', 'reference']


class DocumentCorrections:
    def __init__(self, settings, *, store=None, gateway=None):
        if store is None:
            from .proposals.workflow import BackendStore
            store = BackendStore(settings)
        if gateway is None:
            from .vector_routes import VectorGateway
            gateway = VectorGateway(settings)
        self.store, self.gateway = store, gateway

    def command(self, owner, project, document, action, kind=None):
        return self.store.repo.rpc('project_document_backend', {'p_owner': owner, 'p_project': project, 'p_document': document,
                                                                'p_action': action, 'p_kind': kind})

    @staticmethod
    def authorize(repo, owner, project):
        if repo.project(project)['owner_id'] != owner:
            raise ApiError('PROJECT_NOT_FOUND', 404)

    def remove(self, repo, owner, project, document):
        self.authorize(repo, owner, project)
        record = self.command(owner, project, document, 'withdraw')
        lock = None
        acquired = False
        try:
            connection = self.gateway.connection()
            lock = connection.lock('trato:vector:index-lock', timeout=2400, blocking_timeout=0)
            acquired = lock.acquire(blocking=False)
            if not acquired:
                return {**record, 'cleanup_error': 'VECTOR_INDEX_BUSY'}
            self.gateway.store.remove_file(owner, record['client_id'], project, document)
            self.gateway.registry.remove(owner, document)
            connection.delete(self.gateway.receipt_key(owner, document))
            return self.command(owner, project, document, 'cleaned')
        except ApiError as error:
            # The document is already out of the project; its search copy is purged on the next cleanup.
            return {**record, 'cleanup_error': error.code}
        except RedisError:
            return {**record, 'cleanup_error': 'VECTOR_REGISTRY_UNAVAILABLE'}
        finally:
            if acquired and lock.owned():
                lock.release()

    def set_role(self, repo, owner, project, document, kind):
        self.authorize(repo, owner, project)
        return self.command(owner, project, document, 'set_kind', kind)


def build_document_corrections_router(settings, require_user, repository_factory=None, corrections=None):
    router = APIRouter(prefix='/api/v1')

    def repository(request: Request):
        return (repository_factory or Repository)(settings, request.headers.get('authorization', ''))

    def service():
        return corrections if corrections is not None else DocumentCorrections(settings)

    def reply(data):
        return JSONResponse({'data': data}, headers={'Cache-Control': 'no-store'})

    def sync_graph(repo, project):
        try:
            repo.rpc('project_graph', {'p_project_id': project, 'p_action': 'sync'})
        except ApiError:
            pass

    @router.delete('/projects/{project_id}/documents/{document_id}')
    def remove_document(project_id: str, document_id: str, request: Request, owner=Depends(require_user)):
        repo = repository(request)
        value = service().remove(repo, owner, uuid(project_id), uuid(document_id))
        sync_graph(repo, uuid(project_id))
        return reply(value)

    @router.patch('/projects/{project_id}/documents/{document_id}')
    async def change_role(project_id: str, document_id: str, request: Request, owner=Depends(require_user)):
        try:
            item = RoleInput.model_validate_json(await request.body())
        except (ValidationError, ValueError):
            raise ApiError('INVALID_DOCUMENT_KIND', 422) from None
        repo = repository(request)
        value = service().set_role(repo, owner, uuid(project_id), uuid(document_id), item.kind)
        sync_graph(repo, uuid(project_id))
        return reply(value)

    return router
