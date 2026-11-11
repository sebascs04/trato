"""Authenticated financial actions. The client cannot provide provider facts."""
import json
import os

from fastapi import APIRouter,Depends,Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from starlette.concurrency import run_in_threadpool

from ..business_routes import read_bytes
from ..errors import ApiError
from ..persistence import uuid
from .domain import Contract
from .financial_domain import FinancialCheckInput,FinancialAuthorizationInput,FinancialExecutionInput,RecoveryConsentInput,ExternalReceiptInput,RetryAuthorizationInput
from .repository import RefundRepository


def queued_refund_pdf(settings,save):
    """The one-step refunds save the record PDF like the PDF route does, and also send it to processing: an unread
    project document would keep TeTrato's questions and the project map waiting for it."""
    def run(repo,owner,settlement_id,snapshot_id,language,key):
        result=save(repo,owner,settlement_id,snapshot_id,language,key)
        document_id=result['artifact']['document_id']
        if os.getenv('TRATO_FILE_PROCESSING_ENABLED')=='true':
            from ..file_processing import remember_options
            document=repo.document(document_id)
            options=repo.rows('file_processing_options',{'select':'document_id','document_id':'eq.'+document_id,
                'owner_id':'eq.'+owner,'project_id':'eq.'+document['project_id']})
            if not options:remember_options(settings,repo,document,language)
        repo.queue_document(document_id)
        return result
    return run


def build_refund_financial_router(settings,require_user,repository_factory=None,workflow=None,confirmation=None,pdf_backend=None):
    router=APIRouter(prefix='/api/v1/refunds')
    def repository(request:Request,owner=Depends(require_user)):
        return (repository_factory or RefundRepository)(settings,request.headers.get('authorization',''))
    def reply(data):return JSONResponse({'data':data},headers={'Cache-Control':'no-store'})
    def key(request):
        value=request.headers.get('idempotency-key','')
        if not 1<=len(value)<=128 or any(ord(c)<33 or ord(c)>126 for c in value):raise ApiError('INVALID_IDEMPOTENCY_KEY',422)
        return value
    async def read(request,model):
        try:return model.model_validate_json(await read_bytes(request,2_000_000)).model_dump(mode='json')
        except (ValidationError,ValueError):raise ApiError('INVALID_REQUEST',422) from None

    def complete(action,repo,owner,parent,*args):
        result=action(repo,owner,parent,*args)
        if confirmation and result.get('settlement',{}).get('status')=='completed':
            email=confirmation.after_confirmation(owner,settlement=parent)
            if email is not None:result={**result,'confirmation_email':email}
        return result

    @router.post('/{settlement_id}/financial-checks')
    async def check(settlement_id:str,request:Request,repo=Depends(repository),owner=Depends(require_user)):
        data=await read(request,FinancialCheckInput)
        return reply(await run_in_threadpool(workflow.check,repo,owner,uuid(settlement_id),data['expected_snapshot_id']))

    @router.post('/{settlement_id}/financial-authorizations')
    async def authorize(settlement_id:str,request:Request,repo=Depends(repository)):
        operation_key=key(request);data=await read(request,FinancialAuthorizationInput)
        return reply(await run_in_threadpool(repo.financial_authorize,{'settlement_id':uuid(settlement_id),**data},operation_key))

    @router.post('/{settlement_id}/financial-authorizations/{authorization_id}/execute')
    async def execute(settlement_id:str,authorization_id:str,request:Request,repo=Depends(repository),owner=Depends(require_user)):
        operation_key=key(request);await read(request,FinancialExecutionInput)
        return reply(await run_in_threadpool(complete,workflow.execute,repo,owner,uuid(settlement_id),uuid(authorization_id),operation_key))

    @router.post('/client-requests/{request_id}')
    async def refund_client_request(request_id:str,request:Request,repo=Depends(repository),owner=Depends(require_user)):
        # One click for a full refund the client asked for; see client_request.py. The button itself is the confirmation.
        from .client_request import refund_client_request as run
        from .pdf import RefundPdfService
        from .workflow import RefundBackendStore
        operation_key=key(request)
        try:data=json.loads(await read_bytes(request,1000) or b'{}')
        except ValueError:raise ApiError('INVALID_REQUEST',422) from None
        if not isinstance(data,dict) or data.get('confirmed') is not True or not isinstance(data.get('project_id'),str):raise ApiError('INVALID_REQUEST',422)
        language='en' if request.headers.get('accept-language','').lower().startswith('en') else 'es'
        pdf=queued_refund_pdf(settings,RefundPdfService(pdf_backend or (lambda:RefundBackendStore(settings))).save)
        return reply(await run_in_threadpool(run,repo,owner,data['project_id'],uuid(request_id),operation_key,finance=workflow,pdf=pdf,complete=complete,language=language))

    @router.post('/{settlement_id}/refund')
    async def refund_settlement(settlement_id:str,request:Request,repo=Depends(repository),owner=Depends(require_user)):
        # Manual flow, last step: one click refunds the saved proposal (see client_request.py).
        from .client_request import refund_settlement as run
        from .pdf import RefundPdfService
        from .workflow import RefundBackendStore
        operation_key=key(request)
        try:data=json.loads(await read_bytes(request,1000) or b'{}')
        except ValueError:raise ApiError('INVALID_REQUEST',422) from None
        if not isinstance(data,dict) or data.get('confirmed') is not True or not isinstance(data.get('expected_snapshot_id'),str):raise ApiError('INVALID_REQUEST',422)
        language='en' if request.headers.get('accept-language','').lower().startswith('en') else 'es'
        pdf=queued_refund_pdf(settings,RefundPdfService(pdf_backend or (lambda:RefundBackendStore(settings))).save)
        return reply(await run_in_threadpool(run,repo,owner,uuid(settlement_id),uuid(data['expected_snapshot_id']),operation_key,finance=workflow,pdf=pdf,complete=complete,language=language))

    @router.get('/{settlement_id}/financial')
    def financial(settlement_id:str,repo=Depends(repository)):
        return reply(repo.financial(uuid(settlement_id)))

    @router.post('/{settlement_id}/confirmation-email')
    def retry_confirmation(settlement_id:str,repo=Depends(repository),owner=Depends(require_user)):
        parent=uuid(settlement_id)
        settlement=repo.settlement(parent)
        if settlement['owner_id']!=str(owner) or settlement['status']!='completed':
            raise ApiError('REFUND_CONFIRMATION_NOT_FOUND',404)
        if confirmation is None:
            raise ApiError('REFUND_CONFIRMATION_UNAVAILABLE',503)
        confirmation.dispatch(owner,settlement=parent,retry=True)
        return reply(repo.financial(parent))

    @router.post('/{settlement_id}/financial-operations/{operation_id}/refresh')
    async def refresh(settlement_id:str,operation_id:str,request:Request,repo=Depends(repository),owner=Depends(require_user)):
        raw=await read_bytes(request,1000)
        try:Contract.model_validate_json(raw or b'{}')
        except (ValidationError,ValueError):raise ApiError('INVALID_REQUEST',422) from None
        return reply(await run_in_threadpool(complete,workflow.refresh,repo,owner,uuid(settlement_id),uuid(operation_id)))
    @router.post('/{settlement_id}/financial-operations/{operation_id}/reconcile')
    async def reconcile(settlement_id:str,operation_id:str,request:Request,repo=Depends(repository),owner=Depends(require_user)):
        raw=await read_bytes(request,1000)
        try:Contract.model_validate_json(raw or b'{}')
        except (ValidationError,ValueError):raise ApiError('INVALID_REQUEST',422) from None
        return reply(await run_in_threadpool(complete,workflow.reconcile,repo,owner,uuid(settlement_id),uuid(operation_id)))

    @router.post('/{settlement_id}/financial-operations/{operation_id}/retry-checks')
    async def recovery_check(settlement_id:str,operation_id:str,request:Request,repo=Depends(repository),owner=Depends(require_user)):
        data=await read(request,FinancialCheckInput)
        return reply(await run_in_threadpool(workflow.recovery_check,repo,owner,uuid(settlement_id),uuid(operation_id),data['expected_snapshot_id']))

    def recovery_route(suffix,model,method):
        @router.post('/{settlement_id}/financial-operations/{operation_id}/'+suffix)
        async def action(settlement_id:str,operation_id:str,request:Request,repo=Depends(repository),owner=Depends(require_user)):
            operation_key=key(request);data=await read(request,model)
            return reply(await run_in_threadpool(complete,getattr(workflow,method),repo,owner,uuid(settlement_id),uuid(operation_id),data,operation_key))
    recovery_route('replay',RecoveryConsentInput,'replay')
    recovery_route('external-receipts',ExternalReceiptInput,'external_apply')
    recovery_route('retry-authorizations',RetryAuthorizationInput,'retry_authorize')
    return router
