"""Authenticated, fixed-value diagnostic; no buyer credentials or fake acceptance."""
from fastapi import APIRouter,Depends,Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool
from paypal.client import PayPalError


def build_sandbox_payment_router(service,require_user):
    router=APIRouter(prefix='/api/v1/sandbox/paypal-test')
    def reply(data):return JSONResponse({'data':data},headers={'Cache-Control':'no-store'})
    def configured():
        if service is None:raise PayPalError('SANDBOX_TEST_NOT_CONFIGURED',status=503)
        return service
    async def empty(request):
        body=b''
        async for chunk in request.stream():
            body+=chunk
            if len(body)>1024:raise PayPalError('REQUEST_TOO_LARGE',status=413)
        if body.strip() not in (b'',b'{}'):raise PayPalError('INVALID_REQUEST',status=422)
    def failure(error):
        return JSONResponse({'error':{'code':error.code,'message':{
            'BUYER_APPROVAL_REQUIRED':'Aprueba el pago desde la cuenta Personal sandbox.',
            'CAPTURE_RECONCILIATION_REQUIRED':'La captura ya se intentó. Consulta el estado antes de continuar.',
            'ORDER_REFERENCE_UNCERTAIN':'No se pudo confirmar la creación. Revisa la orden en PayPal antes de repetirla.',
            'SANDBOX_TEST_NOT_CONFIGURED':'La prueba de PayPal todavía no está configurada.',
        }.get(error.code,'No se pudo completar la operación de PayPal sandbox.')}},status_code=error.status,headers={'Cache-Control':'no-store'})
    @router.get('')
    def status(user=Depends(require_user)):
        try:
            payment=service.latest(user) if service else None
            return reply({'configured':service is not None,'amount':'0.10','currency':'USD','environment':'sandbox','payment':service.public(payment) if payment else None})
        except PayPalError as error:return failure(error)
    @router.post('')
    async def create(request:Request,user=Depends(require_user)):
        try:
            await empty(request)
            result=await run_in_threadpool(configured().create,user,request.headers.get('idempotency-key',''))
            return reply(service.public(result))
        except PayPalError as error:return failure(error)
    @router.post('/{id}/capture')
    async def capture(id:str,request:Request,user=Depends(require_user)):
        try:
            await empty(request)
            result=await run_in_threadpool(configured().capture,user,id)
            return reply(service.public(result))
        except PayPalError as error:return failure(error)
    @router.post('/{id}/reconcile')
    async def reconcile(id:str,request:Request,user=Depends(require_user)):
        try:
            await empty(request)
            result=await run_in_threadpool(configured().reconcile,user,id)
            return reply(service.public(result))
        except PayPalError as error:return failure(error)
    return router
