"""Authenticated settlement documents and human review; financial execution is separate."""
from typing import Literal
from uuid import UUID
import os

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, Response
from pydantic import ValidationError, Field, field_validator, model_validator
from starlette.concurrency import run_in_threadpool

from ..business_routes import read_bytes
from ..errors import ApiError
from ..persistence import uuid
from .domain import Contract, SettlementRequest, SettlementTerms, Text, Citation, Hash
from .repository import RefundRepository


def prepare_request_evidence(settings, repo, owner, project_id, citations):
    from ..ai_jobs import AIJobs
    from ..file_processing import enqueue_processing
    from ..model_preferences import ModelPreferences
    from ..vector_routes import VectorGateway

    file_ids = sorted({citation['document_id'] for citation in citations})
    _, files = VectorGateway(settings).snapshot(repo, owner, project_id, file_ids=file_ids)
    pending = [file['id'] for file in files if file['status'] != 'ready']
    if pending:
        jobs, model = AIJobs(), ModelPreferences().configuration()[1]
        for file_id in pending:
            # Registration can change the authorized document context while its
            # original processing job is running. Queue the new context once.
            job = enqueue_processing(repo, jobs, owner, project_id, file_id, model)
            if job['status'] == 'failed':
                raise ApiError(job.get('error_code') or 'FILE_PROCESSING_FAILED', 409)


class DraftEdit(Contract):
    expected_snapshot_id: UUID | None  # null is explicit for the first proposal
    terms: SettlementTerms


class PdfInput(Contract):
    language: Literal['es','en']

class Confirmation(Contract):
    expected_snapshot_id: UUID
    confirmed: bool = Field(strict=True)
    notes: Text

    @model_validator(mode='after')
    def checked(self):
        if self.confirmed is not True:raise ValueError('Explicit review required')
        return self

class EmailEvidence(Contract):
    email_id: UUID

class DocumentEvidence(Contract):
    document_id: UUID
    document_sha256: Hash

class FeedbackReview(Confirmation):
    evidence: Citation | EmailEvidence

class AcceptanceReview(Confirmation):
    evidence: DocumentEvidence | EmailEvidence

class EmailNote(Contract):
    note: str = Field(default='', max_length=600)

    @field_validator('note')
    @classmethod
    def clean_note(cls,value):
        value=value.replace('\r\n','\n').strip()
        if any(ord(c)<32 and c!='\n' for c in value):raise ValueError('Invalid note')
        return value


class SendInput(EmailNote):
    digest: Hash
    confirmed: bool = Field(strict=True)

    @model_validator(mode='after')
    def checked(self):
        if self.confirmed is not True:raise ValueError('Explicit send required')
        return self

class InitialInput(Contract):
    order_id: Text
    capture_id: Text
    evidence: tuple[Citation,...] = Field(min_length=1,max_length=20)
    notes: Text
    confirmed: bool = Field(strict=True)

    @model_validator(mode='after')
    def checked(self):
        import re
        if self.confirmed is not True or not all(re.fullmatch('[A-Za-z0-9_-]{1,64}',x) for x in (self.order_id,self.capture_id)):raise ValueError('Explicit capture review required')
        return self

class Close(Contract):
    reason: Literal['rejected', 'withdrawn']
    notes: Text


def build_refund_router(settings, require_user, repository_factory=None, workflow=None, finance=None):
    router = APIRouter(prefix='/api/v1')

    def repository(request: Request, user=Depends(require_user)):
        return (repository_factory or RefundRepository)(settings, request.headers.get('authorization', ''))

    def reply(data):
        return JSONResponse({'data': data}, headers={'Cache-Control': 'no-store'})

    def operation_key(request):
        key = request.headers.get('idempotency-key', '')
        if not 1 <= len(key) <= 128 or any(ord(c) < 33 or ord(c) > 126 for c in key):
            raise ApiError('INVALID_IDEMPOTENCY_KEY', 422)
        return key

    async def read(request,model):
        try:
            item = model.model_validate_json(await read_bytes(request, 2_000_000))
        except (ValidationError, ValueError):
            raise ApiError('INVALID_REQUEST', 422) from None
        return item.model_dump(mode='json')

    async def command(request, repo, action, model, extra):
        key=operation_key(request);data=await read(request,model)
        result = await run_in_threadpool(repo.command, action, {**data, **extra}, key)
        return reply(result)

    @router.get('/projects/{project_id}/refunds')
    def list_settlements(project_id: str, repo=Depends(repository)):
        return reply(repo.list_settlements(uuid(project_id)))

    @router.get('/projects/{project_id}/refund-payments')
    def payments(project_id: str, repo=Depends(repository)):
        return reply(repo.eligible_payments(uuid(project_id)))

    @router.post('/projects/{project_id}/refund-payments/sync')
    def sync_payments(project_id: str, repo=Depends(repository), owner=Depends(require_user)):
        if finance is None:
            raise ApiError('PAYMENTS_NOT_CONFIGURED', 503)
        project_id = uuid(project_id)
        finance.sync_project(repo, owner, project_id)
        return reply(repo.eligible_payments(project_id))

    @router.get('/projects/{project_id}/refund-operations/{key}')
    def operation(project_id: str, key: str, repo=Depends(repository)):
        if not 1 <= len(key) <= 128 or any(ord(c) < 33 or ord(c) > 126 for c in key):
            raise ApiError('INVALID_IDEMPOTENCY_KEY', 422)
        return reply(repo.operation(uuid(project_id), key))

    @router.post('/projects/{project_id}/refunds')
    async def create(project_id: str, request: Request, repo=Depends(repository), owner=Depends(require_user)):
        project_id, key = uuid(project_id), operation_key(request)
        data = await read(request, SettlementRequest)

        def create_request():
            # Preserve idempotent replays, including if PayPal's state changed later.
            if finance is not None and repo.operation(project_id, key)['state'] != 'confirmed':
                finance.check_intake(repo, project_id, data)
            result = repo.command('create', {**data, 'project_id': project_id}, key)
            if os.getenv('TRATO_FILE_PROCESSING_ENABLED') == 'true' and os.getenv('TRATO_VECTOR_SEARCH_ENABLED') == 'true':
                try:
                    prepare_request_evidence(settings, repo, owner, project_id, data['request_evidence'])
                except ApiError as error:
                    return {**result, 'evidence_processing_error': error.code}
            return result

        return reply(await run_in_threadpool(create_request))

    @router.get('/refunds/{settlement_id}')
    def detail(settlement_id: str, repo=Depends(repository)):
        return reply(repo.detail(uuid(settlement_id)))

    @router.get('/refunds/{settlement_id}/snapshots/{snapshot_id}')
    def snapshot(settlement_id: str, snapshot_id: str, repo=Depends(repository)):
        return reply(repo.snapshot(uuid(settlement_id), uuid(snapshot_id)))

    @router.post('/refunds/{settlement_id}/draft')
    async def draft(settlement_id: str, request: Request, repo=Depends(repository)):
        return await command(request, repo, 'edit_draft', DraftEdit, {'settlement_id': uuid(settlement_id)})

    @router.post('/refunds/{settlement_id}/close')
    async def close(settlement_id: str, request: Request, repo=Depends(repository)):
        return await command(request, repo, 'close', Close, {'settlement_id': uuid(settlement_id)})

    @router.post('/projects/{project_id}/initial-payments')
    async def initial(project_id:str,request:Request,repo=Depends(repository),owner=Depends(require_user)):
        key=operation_key(request);data=await read(request,InitialInput)
        return reply(await run_in_threadpool(workflow.register_initial,repo,owner,uuid(project_id),data,key))

    @router.post('/refunds/{settlement_id}/snapshots/{snapshot_id}/pdf')
    async def pdf(settlement_id:str,snapshot_id:str,request:Request,repo=Depends(repository),owner=Depends(require_user)):
        key=operation_key(request);data=await read(request,PdfInput)
        result=await run_in_threadpool(workflow.pdf,repo,owner,uuid(settlement_id),uuid(snapshot_id),data['language'],key)
        document_id=result['artifact']['document_id']
        if os.getenv('TRATO_FILE_PROCESSING_ENABLED')=='true':
            from ..file_processing import remember_options
            document=await run_in_threadpool(repo.document,document_id)
            options=await run_in_threadpool(repo.rows,'file_processing_options',{'select':'document_id',
                'document_id':'eq.'+document_id,'owner_id':'eq.'+owner,'project_id':'eq.'+document['project_id']})
            # Preserve immutable analysis options if this exact artifact was already prepared.
            if not options:await run_in_threadpool(remember_options,settings,repo,document,data['language'])
        # Binding the immutable original precedes reading it. Repeating this route
        # reuses both the exact stored PDF and any existing extraction job.
        await run_in_threadpool(repo.queue_document,document_id)
        return reply(result)

    @router.post('/refunds/{settlement_id}/review')
    async def review(settlement_id:str,request:Request,repo=Depends(repository)):
        return await command(request,repo,'review_pdf',Confirmation,{'settlement_id':uuid(settlement_id)})

    @router.post('/refunds/{settlement_id}/feedback')
    async def feedback(settlement_id:str,request:Request,repo=Depends(repository)):
        return await command(request,repo,'feedback',FeedbackReview,{'settlement_id':uuid(settlement_id)})

    @router.post('/refunds/{settlement_id}/acceptance')
    async def acceptance(settlement_id:str,request:Request,repo=Depends(repository)):
        return await command(request,repo,'accept',AcceptanceReview,{'settlement_id':uuid(settlement_id)})

    @router.get('/refunds/{settlement_id}/snapshots/{snapshot_id}/email-preview')
    def preview(settlement_id:str,snapshot_id:str,repo=Depends(repository),owner=Depends(require_user)):
        return reply(workflow.preview(repo,owner,uuid(settlement_id),uuid(snapshot_id)))

    @router.post('/refunds/{settlement_id}/snapshots/{snapshot_id}/email-preview')
    async def preview_with_note(settlement_id:str,snapshot_id:str,request:Request,repo=Depends(repository),owner=Depends(require_user)):
        data=await read(request,EmailNote)
        return reply(await run_in_threadpool(workflow.preview,repo,owner,uuid(settlement_id),uuid(snapshot_id),data['note']))

    @router.post('/refunds/{settlement_id}/snapshots/{snapshot_id}/email')
    async def send(settlement_id:str,snapshot_id:str,request:Request,repo=Depends(repository),owner=Depends(require_user)):
        key=operation_key(request);data=await read(request,SendInput)
        return reply(await run_in_threadpool(workflow.send,repo,owner,uuid(settlement_id),uuid(snapshot_id),data['digest'],key,**({'note':data['note']} if data['note'] else {})))

    @router.post('/refunds/{settlement_id}/snapshots/{snapshot_id}/email/reconcile')
    def reconcile_email(settlement_id:str,snapshot_id:str,request:Request,repo=Depends(repository),owner=Depends(require_user)):
        return reply(workflow.reconcile_send(repo,owner,uuid(settlement_id),uuid(snapshot_id),operation_key(request)))

    @router.post('/refunds/{settlement_id}/snapshots/{snapshot_id}/responses/sync')
    def sync(settlement_id:str,snapshot_id:str,repo=Depends(repository),owner=Depends(require_user)):
        return reply(workflow.sync(repo,owner,uuid(settlement_id),uuid(snapshot_id)))

    @router.get('/refunds/{settlement_id}/responses/{response_id}/attachments/{index}')
    def attachment(settlement_id:str,response_id:str,index:int,repo=Depends(repository),owner=Depends(require_user)):
        content,filename=workflow.attachment(repo,owner,uuid(settlement_id),uuid(response_id),index)
        return Response(content,media_type='application/pdf',headers={'Cache-Control':'no-store','Content-Disposition':'attachment; filename="attachment.pdf"'})

    @router.post('/refunds/{settlement_id}/responses/{response_id}/attachments/{index}/import')
    def import_attachment(settlement_id:str,response_id:str,index:int,request:Request,repo=Depends(repository),owner=Depends(require_user)):
        return reply(workflow.attachment(repo,owner,uuid(settlement_id),uuid(response_id),index,import_file=True,key=operation_key(request)))

    return router
