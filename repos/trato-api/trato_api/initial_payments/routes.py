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
        return reply(repository.rpc('project_plan_progress',{'p_project':uuid(project_id)}))
    @router.get('/projects/{project_id}/stages/{position}/evidence-withdrawals')
    def evidence_pending(project_id:str,position:int,repository=Depends(repo),owner=Depends(require_user)):
        if not 1<=position<=8:raise ApiError('PLAN_STAGE_INVALID',422)
        from .evidence import StageEvidence
        return reply(StageEvidence(settings).pending(repository,owner,uuid(project_id),position))
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
