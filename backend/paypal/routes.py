"""FastAPI router factory. App/auth/repository mounting remains owned by P2."""
from functools import partial
import json
from uuid import UUID, uuid4
from fastapi import APIRouter, Request, Depends
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool
from .client import PayPalError
from .email import EmailDeliveryError


def public_payment(record):
    a=record.acceptance
    return {'id':record.id,'project_id':a.project_id,'acceptance_id':a.acceptance_id,
        'amount':a.amount,'currency':a.currency,'status':record.status,
        'provider':'paypal','environment':'sandbox','approval_url':record.approval_url,'updated_at':record.updated_at}


def build_router(payment_service,notification_service,require_user):
    """P2 injects configured services and its FastAPI require_user(request) dependency.
    None payment_service leaves a visible 503; never substitutes a fake repository.
    """
    def get_payment_service():
        if payment_service is None:raise PayPalError('PAYPAL_SANDBOX_NOT_CONFIGURED',status=503)
        return payment_service
    get_notification_service=(lambda:notification_service) if notification_service is not None else None
    router=APIRouter(prefix='/api/v1')

    def response(data,status=200):return JSONResponse({'data':data},status_code=status,headers={'Cache-Control':'no-store'})
    def failure(error):
        code=getattr(error,'code','PAYMENT_OPERATION_FAILED')
        status=getattr(error,'status',503)
        if isinstance(error,EmailDeliveryError):
            status=409 if code in ('PAYMENT_NOT_READY_FOR_EMAIL','EMAIL_DELIVERY_UNCERTAIN','EMAIL_IN_PROGRESS') else 404 if code=='PAYMENT_NOT_FOUND' else 422 if code.startswith('INVALID_') else 503
        # Translate known codes at the UI; do not leak exception/provider payloads.
        return JSONResponse({'error':{'code':code,'message':{'BUYER_APPROVAL_REQUIRED':'El cliente todavía no aprobó el pago.','PAYMENT_NOT_REQUIRED':'Este acuerdo no requiere un cobro adicional.','INVALID_REQUEST':'Revisa los datos de la solicitud.','EMAIL_DELIVERY_UNCERTAIN':'No se pudo confirmar el envío. Revisa antes de reenviar.','PAYPAL_SANDBOX_NOT_CONFIGURED':'Falta configurar PayPal sandbox.'}.get(code,'No se pudo completar la operación.'),'request_id':str(uuid4())}},status_code=status,headers={'Cache-Control':'no-store'})
    def identity(value):
        if not isinstance(value,str):raise PayPalError('INVALID_REQUEST',status=422)
        try:return str(UUID(value))
        except (ValueError,TypeError,AttributeError):raise PayPalError('INVALID_REQUEST',status=422)
    async def body(request,max_bytes=8192,empty_allowed=False):
        chunks=[];size=0
        async for chunk in request.stream():
            size+=len(chunk)
            if size>max_bytes:raise PayPalError('REQUEST_TOO_LARGE',status=413)
            chunks.append(chunk)
        raw=b''.join(chunks)
        if not raw and empty_allowed:return {}
        try:value=json.loads(raw)
        except (ValueError,UnicodeError):raise PayPalError('INVALID_REQUEST',status=422)
        if not isinstance(value,dict):raise PayPalError('INVALID_REQUEST',status=422)
        return value
    def key(request):
        value=request.headers.get('idempotency-key','')
        if not 1<=len(value)<=128 or any(ord(c)<33 or ord(c)>126 for c in value):raise PayPalError('INVALID_IDEMPOTENCY_KEY',status=422)
        return value

    @router.post('/payments')
    async def create(request:Request,user:str=Depends(require_user)):
        try:
            payload=await body(request)
            if set(payload)!={'acceptance_id'}:raise PayPalError('INVALID_REQUEST',status=422)
            service=get_payment_service()
            record=await run_in_threadpool(partial(service.create,user,identity(payload['acceptance_id']),key(request)))
            return response(public_payment(record))
        except (PayPalError,EmailDeliveryError) as error:return failure(error)

    @router.get('/payments/{payment_id}')
    async def show(payment_id:str,request:Request,user:str=Depends(require_user)):
        try:
            record=await run_in_threadpool(get_payment_service().get,user,identity(payment_id))
            return response(public_payment(record))
        except PayPalError as error:return failure(error)

    @router.post('/payments/{payment_id}/capture')
    async def capture(payment_id:str,request:Request,user:str=Depends(require_user)):
        try:
            if await body(request,empty_allowed=True):raise PayPalError('INVALID_REQUEST',status=422)
            record=await run_in_threadpool(get_payment_service().capture,user,identity(payment_id))
            return response(public_payment(record))
        except PayPalError as error:return failure(error)

    @router.post('/payments/{payment_id}/reconcile')
    async def reconcile(payment_id:str,request:Request,user:str=Depends(require_user)):
        try:
            if await body(request,empty_allowed=True):raise PayPalError('INVALID_REQUEST',status=422)
            record=await run_in_threadpool(get_payment_service().reconcile,user,identity(payment_id))
            return response(public_payment(record))
        except PayPalError as error:return failure(error)

    @router.post('/payments/{payment_id}/notifications/email')
    async def email(payment_id:str,request:Request,user:str=Depends(require_user)):
        try:
            if await body(request,empty_allowed=True):raise PayPalError('INVALID_REQUEST',status=422)
            if get_notification_service is None:raise PayPalError('EMAIL_NOT_CONFIGURED',status=503)
            result=await run_in_threadpool(get_notification_service().send,user,identity(payment_id),key(request))
            return response(result)
        except (PayPalError,EmailDeliveryError) as error:return failure(error)

    @router.post('/webhooks/paypal')
    async def webhook(request:Request):
        try:
            event=await body(request,max_bytes=256*1024)
            result=await run_in_threadpool(get_payment_service().webhook,dict(request.headers),event)
            return response(result)
        except PayPalError as error:return failure(error)

    return router
