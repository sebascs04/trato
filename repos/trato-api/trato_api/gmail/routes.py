"""Authenticated Gmail account connection; never accepts arbitrary email sends."""
from functools import partial
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from starlette.concurrency import run_in_threadpool
from .vault import GmailError


class CallbackInput(BaseModel):
    model_config=ConfigDict(extra='forbid')
    state:str=Field(min_length=20,max_length=200)
    code:str|None=Field(default=None,min_length=1,max_length=4096)
    error:str|None=Field(default=None,max_length=100)

class ConnectInput(BaseModel):
    model_config=ConfigDict(extra='forbid')
    purpose:str=Field(default='send',pattern='^(send|read)$')


def build_gmail_router(service,require_user):
    router=APIRouter(prefix='/api/v1/integrations/gmail')

    def reply(data):return JSONResponse({'data':data},headers={'Cache-Control':'no-store'})
    def configured():
        if service is None:raise GmailError('GMAIL_NOT_CONFIGURED')
        return service
    async def payload(request):
        raw=b''
        async for chunk in request.stream():
            raw+=chunk
            if len(raw)>8192:raise GmailError('REQUEST_TOO_LARGE',413)
        return raw
    async def empty(request):
        if (await payload(request)).strip() not in (b'',b'{}'):raise GmailError('INVALID_REQUEST',422)
    def failure(error):
        return JSONResponse({'error':{'code':error.code,'message':{
            'GMAIL_NOT_CONFIGURED':'El envío desde Gmail todavía no está habilitado.',
            'GMAIL_AUTHORIZATION_EXPIRED':'La autorización caducó. Vuelve a conectar Gmail.',
            'GMAIL_AUTHORIZATION_DECLINED':'No se autorizó el envío desde Gmail.',
            'GMAIL_SEND_PERMISSION_REQUIRED':'Autoriza el permiso de envío para conectar Gmail.',
        }.get(error.code,'No se pudo completar la conexión con Gmail.')}},status_code=error.status,headers={'Cache-Control':'no-store'})

    @router.get('')
    def status(user=Depends(require_user)):
        try:return reply(service.status(user) if service else {'configured':False,'connected':False,'email':None})
        except GmailError as error:return failure(error)

    @router.post('/connect')
    async def start(request:Request,user=Depends(require_user)):
        try:
            try:item=ConnectInput.model_validate_json(await payload(request))
            except (ValidationError,ValueError):raise GmailError('INVALID_REQUEST',422)
            return reply(await run_in_threadpool(configured().start,user,item.purpose))
        except GmailError as error:return failure(error)

    @router.post('/complete')
    async def complete(request:Request,user=Depends(require_user)):
        try:
            try:item=CallbackInput.model_validate_json(await payload(request))
            except (ValidationError,ValueError):raise GmailError('INVALID_REQUEST',422)
            if bool(item.code)==bool(item.error):raise GmailError('INVALID_REQUEST',422)
            return reply(await run_in_threadpool(partial(configured().complete,user,item.state,code=item.code,error=item.error)))
        except GmailError as error:return failure(error)

    @router.post('/disconnect')
    async def disconnect(request:Request,user=Depends(require_user)):
        try:
            await empty(request)
            return reply(await run_in_threadpool(configured().disconnect,user))
        except GmailError as error:return failure(error)

    return router
