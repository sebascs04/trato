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
    @router.get('/initial-checkout/{token}')
    def checkout(token:str):return reply(service.checkout(token))
    @router.post('/initial-checkout/{token}/capture')
    def capture(token:str):return reply(service.checkout(token,capture=True))
    return router
