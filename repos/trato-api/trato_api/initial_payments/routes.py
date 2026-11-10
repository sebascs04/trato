"""Small HTTP surface for reviewed initial checkout actions."""
from typing import Literal
from uuid import UUID
from fastapi import APIRouter,Depends,Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel,ConfigDict,Field,ValidationError,field_validator
from starlette.concurrency import run_in_threadpool
from ..persistence import Repository,uuid
from ..business_routes import read_bytes
from ..errors import ApiError
from .workflow import InitialPayments
from .stages import StagePayments

def with_stage_refunds(repository,project_id,progress):
    """A paid stage also says how much of it PayPal confirmed as refunded: the same total Refunds and the client's Work plan use."""
    stages=progress.get('stages') if isinstance(progress,dict) else None
    paid=[s for s in stages or [] if isinstance(s,dict) and s.get('status')=='completed' and s.get('payment_id')]
    if not paid:return progress
    payments={p['id']:p for p in repository.rpc('refund_payments',{'p_project_id':project_id}) or [] if isinstance(p,dict)}
    for stage in paid:
        payment=payments.get(str(stage['payment_id']))
        if payment:
            stage['paid_minor']=payment['amount_minor']
            stage['refunded_minor']=min(payment['amount_minor'],payment.get('local_previous_refunds_minor') or 0)
    # The client's own refund request on a paid stage, so the freelancer's tag says it like the client's does. Optional.
    try:
        rows=repository.rows('client_refund_requests',{'select':'stage_position,status,settlement_id,created_at','project_id':'eq.'+str(project_id),'stage_position':'not.is.null','order':'created_at.asc'})
        open_ids=[r['settlement_id'] for r in rows if r.get('settlement_id')]
        done={s['id'] for s in repository.rows('refund_settlements',{'select':'id','id':'in.('+','.join(open_ids)+')','status':'in.(completed,closed_without_refund,rejected,withdrawn)'})} if open_ids else set()
        for stage in paid:
            asked=[r for r in rows if r['stage_position']==stage.get('position') and (r['status']=='open' or r['status']=='registered' and r['settlement_id'] not in done)]
            if asked:stage['refund_request']=asked[-1]['status']
    except Exception:  # noqa: BLE001 - the plan still shows without it
        pass
    return progress

class PaymentInput(BaseModel):
    model_config=ConfigDict(extra='forbid')
    amount_minor:int=Field(strict=True,ge=1,le=99999999999)
    conditions:str=Field(min_length=1,max_length=2000)
    output_language:Literal['es','en']
    confirmed:bool=Field(strict=True)
    @field_validator('confirmed')
    @classmethod
    def review_required(cls,value):
        if value is not True:raise ValueError('Explicit review required')
        return value
    @field_validator('conditions')
    @classmethod
    def trimmed(cls,value):
        if not value.strip():raise ValueError('Conditions required')
        return value.strip()
class SendInput(BaseModel):
    model_config=ConfigDict(extra='forbid')
    digest:str=Field(pattern='^[a-f0-9]{64}$')
    confirmed:bool=Field(strict=True)
    @field_validator('confirmed')
    @classmethod
    def review_required(cls,value):
        if value is not True:raise ValueError('Explicit send required')
        return value

class StagePaymentInput(BaseModel):
    model_config=ConfigDict(extra='forbid')
    evidence_document_id:UUID
    output_language:Literal['es','en']
    confirmed:bool=Field(strict=True)
    @field_validator('confirmed')
    @classmethod
    def reviewed(cls,value):
        if value is not True:raise ValueError('Explicit review required')
        return value

class InvoiceInput(BaseModel):
    model_config=ConfigDict(extra='forbid')
    concept:str=Field(min_length=1,max_length=200)
    confirmed:bool=Field(strict=True)
    @field_validator('confirmed')
    @classmethod
    def reviewed(cls,value):
        if value is not True:raise ValueError('Explicit send required')
        return value

def build_initial_payment_router(settings,require_user,*,workflow=None,repository_factory=None,gmail=None):
    router=APIRouter(prefix='/api/v1');service=workflow or InitialPayments(settings,gmail)
    def repo(request:Request,user=Depends(require_user)):
        return (repository_factory or Repository)(settings,request.headers.get('authorization',''))
    def reply(data):return JSONResponse({'data':data},headers={'Cache-Control':'no-store'})
    async def read(request,model):
        try:return model.model_validate_json(await read_bytes(request,12000)).model_dump(mode='json')
        except ValidationError:raise ApiError('INITIAL_PAYMENT_INVALID',422) from None
    @router.get('/projects/{project_id}/initial-checkout')
    def detail(project_id:str,repository=Depends(repo),owner=Depends(require_user)):
        return reply(service.get(repository,owner,uuid(project_id)))
    @router.post('/projects/{project_id}/initial-checkout')
    async def prepare(project_id:str,request:Request,repository=Depends(repo),owner=Depends(require_user)):
        key=uuid(request.headers.get('idempotency-key',''))
        data=await read(request,PaymentInput);data.pop('confirmed')
        return reply(await run_in_threadpool(service.prepare,repository,owner,uuid(project_id),data,key))
    @router.post('/projects/{project_id}/initial-checkout/reconcile')
    def reconcile(project_id:str,repository=Depends(repo),owner=Depends(require_user)):
        return reply(service.reconcile(repository,owner,uuid(project_id)))
    @router.get('/projects/{project_id}/initial-checkout/email-preview')
    def preview(project_id:str,repository=Depends(repo),owner=Depends(require_user)):
        return reply(service.preview(repository,owner,uuid(project_id))[2])
    @router.post('/projects/{project_id}/initial-checkout/email')
    async def send(project_id:str,request:Request,repository=Depends(repo),owner=Depends(require_user)):
        data=await read(request,SendInput)
        return reply(await run_in_threadpool(service.send,repository,owner,uuid(project_id),data['digest']))
    def stage_service(position):
        if not 1<=position<=8:raise ApiError('PLAN_STAGE_INVALID',422)
        return StagePayments(settings,gmail,position)
    @router.get('/projects/{project_id}/plan-progress')
    def progress(project_id:str,repository=Depends(repo),owner=Depends(require_user)):
        repository.project(uuid(project_id))
        return reply(with_stage_refunds(repository,uuid(project_id),repository.rpc('project_plan_progress',{'p_project':uuid(project_id)})))
    @router.get('/projects/{project_id}/stages/{position}/evidence-withdrawals')
    def evidence_pending(project_id:str,position:int,repository=Depends(repo),owner=Depends(require_user)):
        if not 1<=position<=8:raise ApiError('PLAN_STAGE_INVALID',422)
        from .evidence import StageEvidence
        return reply(StageEvidence(settings).pending(repository,owner,uuid(project_id),position))
    @router.get('/projects/{project_id}/stages/{position}/evidence')
    def stage_evidence(project_id:str,position:int,repository=Depends(repo),owner=Depends(require_user)):
        if not 1<=position<=8:raise ApiError('PLAN_STAGE_INVALID',422)
        from .evidence import StageEvidence
        return reply(StageEvidence(settings).inventory(repository,owner,uuid(project_id),position))
    @router.delete('/projects/{project_id}/stages/{position}/evidence/{file_id}')
    def remove_evidence(project_id:str,position:int,file_id:str,repository=Depends(repo),owner=Depends(require_user)):
        if not 1<=position<=8:raise ApiError('PLAN_STAGE_INVALID',422)
        from .evidence import StageEvidence
        value=StageEvidence(settings).remove(repository,owner,uuid(project_id),position,uuid(file_id))
        repository.rpc('project_graph',{'p_project_id':uuid(project_id),'p_action':'sync'})
        return reply(value)
    @router.get('/projects/{project_id}/stages/{position}/checkout')
    def stage_detail(project_id:str,position:int,repository=Depends(repo),owner=Depends(require_user)):
        return reply(stage_service(position).get(repository,owner,uuid(project_id)))
    @router.post('/projects/{project_id}/stages/{position}/checkout')
    async def stage_prepare(project_id:str,position:int,request:Request,repository=Depends(repo),owner=Depends(require_user)):
        data=await read(request,StagePaymentInput);data.pop('confirmed')
        return reply(await run_in_threadpool(stage_service(position).prepare_stage,repository,owner,uuid(project_id),data,uuid(request.headers.get('Idempotency-Key',''))))
    @router.post('/projects/{project_id}/stages/{position}/checkout/reconcile')
    def stage_reconcile(project_id:str,position:int,repository=Depends(repo),owner=Depends(require_user)):
        return reply(stage_service(position).reconcile(repository,owner,uuid(project_id)))
    def latest_delivery(repository,project,position):
        rows=repository.rows('document_upload_contexts',{'select':'document_id','project_id':'eq.'+project,
            'stage_position':'eq.'+str(position),'purpose':'eq.delivery_evidence','order':'created_at.desc','limit':20})
        if not rows:return None
        live={d['id'] for d in repository.rows('documents',{'select':'id','id':'in.('+','.join(r['document_id'] for r in rows)+')','deleted_at':'is.null'})}
        return next((r['document_id'] for r in rows if r['document_id'] in live),None)
    @router.get('/projects/{project_id}/stage-client-status')
    def stage_client_status(project_id:str,repository=Depends(repo),owner=Depends(require_user)):
        # Per deliverable: the last delivery sent to the client and their answer to it, for the plan list.
        project=uuid(project_id);repository.project(project)
        shares=repository.rows('project_stage_delivery_shares',{'select':'document_id,stage_position,shared_at','project_id':'eq.'+project,'order':'shared_at.desc'})
        reviews={r['document_id']:r for r in repository.rows('project_stage_reviews',{'select':'document_id,decision,created_at','project_id':'eq.'+project})}
        result={}
        for share in shares:
            key=str(share['stage_position'])
            if key in result:continue
            review=reviews.get(share['document_id'])
            result[key]={'shared_at':share['shared_at'],'decision':review['decision'] if review else None}
        return reply(result)
    @router.get('/projects/{project_id}/stages/{position}/client-delivery')
    def stage_client_delivery(project_id:str,position:int,repository=Depends(repo),owner=Depends(require_user)):
        # Whether the latest uploaded delivery was sent to the client for review, and when.
        if not 1<=position<=8:raise ApiError('PLAN_STAGE_INVALID',422)
        project=uuid(project_id);repository.project(project)
        document=latest_delivery(repository,project,position)
        if not document:return reply(None)
        shared=repository.rows('project_stage_delivery_shares',{'select':'shared_at','document_id':'eq.'+document})
        return reply({'document_id':document,'shared_at':shared[0]['shared_at'] if shared else None})
    @router.post('/projects/{project_id}/stages/{position}/client-delivery')
    def stage_send_delivery(project_id:str,position:int,repository=Depends(repo),owner=Depends(require_user)):
        # Sending is explicit: the client sees the delivery only after the freelancer sends it.
        if not 1<=position<=8:raise ApiError('PLAN_STAGE_INVALID',422)
        project=uuid(project_id);repository.project(project)
        from ..proposals.workflow import BackendStore
        value=BackendStore(settings).repo.rpc('stage_delivery_share',{'p_owner':owner,'p_project':project,'p_position':position})
        return reply({'document_id':value['document_id'],'shared_at':value['shared_at']})
    @router.get('/projects/{project_id}/stages/{position}/client-review')
    def stage_client_review(project_id:str,position:int,repository=Depends(repo),owner=Depends(require_user)):
        # The client's latest answer to this deliverable's delivery (approved or changes requested), read under the owner's session.
        if not 1<=position<=8:raise ApiError('PLAN_STAGE_INVALID',422)
        repository.project(uuid(project_id))
        rows=repository.rows('project_stage_reviews',{'select':'document_id,decision,notes,created_at','project_id':'eq.'+uuid(project_id),
            'stage_position':'eq.'+str(position),'order':'created_at.desc','limit':1})
        return reply(rows[0] if rows else None)
    @router.post('/projects/{project_id}/stages/{position}/checkout/invoice')
    async def stage_invoice(project_id:str,position:int,request:Request,repository=Depends(repo),owner=Depends(require_user)):
        # TeTrato issues the deliverable's PayPal invoice only after the freelancer confirms it.
        data=await read(request,InvoiceInput);service=stage_service(position)
        await run_in_threadpool(service.invoices().send,repository,owner,uuid(project_id),data['concept'])
        return reply(service.get(repository,owner,uuid(project_id)))
    @router.get('/projects/{project_id}/stages/{position}/checkout/email-preview')
    def stage_preview(project_id:str,position:int,repository=Depends(repo),owner=Depends(require_user)):
        return reply(stage_service(position).preview(repository,owner,uuid(project_id))[2])
    @router.post('/projects/{project_id}/stages/{position}/checkout/email')
    async def stage_send(project_id:str,position:int,request:Request,repository=Depends(repo),owner=Depends(require_user)):
        data=await read(request,SendInput)
        return reply(await run_in_threadpool(stage_service(position).send,repository,owner,uuid(project_id),data['digest']))
    @router.get('/initial-checkout/{token}')
    def checkout(token:str):return reply(service.checkout(token))
    @router.post('/initial-checkout/{token}/capture')
    def capture(token:str):return reply(service.checkout(token,capture=True))
    return router
