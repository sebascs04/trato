"""PayPal postback-verified refund inbox. Events trigger GETs only."""
from hashlib import sha256
import json
import re
from urllib.parse import urlparse

from fastapi import APIRouter,Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool
from paypal.client import PayPalError
from ..business_routes import read_bytes
from ..errors import ApiError
from .financial_domain import provider_id,refund_evidence
from .reconciliation import RefundRecovery

EVENTS={'PAYMENT.CAPTURE.REFUNDED','PAYMENT.REFUND.PENDING','PAYMENT.REFUND.FAILED','PAYMENT.CAPTURE.REVERSED'}


def decode_event(raw):
    def unique(pairs):
        result={}
        for k,v in pairs:
            if k in result:raise ValueError('Duplicate JSON key')
            result[k]=v
        return result
    try:
        event=json.loads(raw,object_pairs_hook=unique,parse_constant=lambda _:(_ for _ in ()).throw(ValueError()))
        if not isinstance(event,dict) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}',event.get('id','')):raise ValueError()
        if not isinstance(event.get('event_type'),str) or len(event['event_type'])>128:raise ValueError()
        if event['event_type'] in EVENTS:
            if event.get('resource_type') not in ('refund','capture') or event.get('resource_version')!='2.0' or not isinstance(event.get('resource'),dict):raise ValueError()
            provider_id(event['resource'].get('id'))
            if event['event_type']=='PAYMENT.CAPTURE.REVERSED' and event['resource_type']!='capture':raise ValueError()
        return event
    except (ValueError,TypeError,RecursionError,ApiError):raise ApiError('INVALID_REFUND_WEBHOOK',422) from None


def refund_capture_id(record):
    ids=set()
    if not isinstance(record,dict):raise ApiError('REFUND_RESULT_MISMATCH',409)
    related=record.get('supplementary_data',{})
    if isinstance(related,dict) and isinstance(related.get('related_ids'),dict) and related['related_ids'].get('capture_id'):
        ids.add(provider_id(related['related_ids']['capture_id']))
    links=record.get('links',[])
    if not isinstance(links,list):raise ApiError('REFUND_RESULT_MISMATCH',409)
    for link in links:
        if isinstance(link,dict) and link.get('rel')=='up':
            url=urlparse(link.get('href',''))
            if url.scheme!='https' or url.netloc not in ('api-m.sandbox.paypal.com','api.sandbox.paypal.com','api-m.paypal.com','api.paypal.com') or url.query or url.fragment:raise ApiError('REFUND_RESULT_MISMATCH',409)
            match=re.fullmatch(r'/v2/payments/captures/([A-Za-z0-9_-]{1,64})',url.path)
            if match:ids.add(match[1])
    if len(ids)!=1:raise ApiError('REFUND_RESULT_MISMATCH',409)
    return ids.pop()


class RefundWebhook:
    def __init__(self,finance,confirmation=None):self.finance,self.confirmation=finance,confirmation

    def receive(self,raw,headers):
        event=decode_event(raw);flow=self.finance
        try:
            client=flow.provider(webhook=True)
            if not client.verify_webhook(headers,event):raise ApiError('INVALID_PAYPAL_SIGNATURE',401)
            store=flow.backend()
            claim=store.webhook('claim',{'environment':'sandbox','app_id':client.client_id,'listener_id':client.webhook_id,
                'event_id':event['id'],'payload_sha256':sha256(raw).hexdigest(),'payload':event})
            if claim.get('conflict'):raise ApiError('REFUND_WEBHOOK_ID_CONFLICT',409)
            if claim.get('busy'):raise ApiError('REFUND_WEBHOOK_BUSY',503)
            if claim.get('duplicate'):return {'received':True,'duplicate':True}
            try:
                applicable=self.process(event,client,store)
                store.webhook('finish',claim|{'status':'processed' if applicable else 'ignored'})
            except (PayPalError,ApiError) as error:
                # Durable retry marker. If recording the failure also fails, return 503;
                # a read-only claim may be reclaimed after its processing lease.
                try:store.webhook('finish',claim|{'status':'retryable','error_code':error.code})
                except ApiError:pass
                raise ApiError('REFUND_WEBHOOK_PROCESSING_FAILED',503) from None
            return {'received':True}
        except PayPalError as error:raise ApiError(error.code,503) from None

    def process(self,event,client,store):
        if event['event_type'] not in EVENTS:return False
        rid=event['resource']['id'];record=None
        if event['resource_type']=='refund':
            record=client.get_refund(rid);capture_id=refund_capture_id(record)
        else:capture_id=rid
        lookup=store.webhook('lookup',{'capture_id':capture_id,'merchant_id':client.merchant_id})
        if not lookup['found']:return False
        pay=lookup['payment'];recovery=RefundRecovery(self.finance)
        if event['event_type']=='PAYMENT.CAPTURE.REVERSED':
            capture,_=recovery.resources(pay,client)
            if capture.get('status') not in ('REVERSED','DECLINED','FAILED'):raise ApiError('REFUND_REVERSAL_NOT_CONFIRMED',409)
            store.webhook('reversal',{'owner_id':pay['owner_id'],'payment_id':pay['id']});return True
        if record is not None:
            recovery.resources(pay,client)
            proof=refund_evidence(record,pay,expected_id=rid)
            # A second canonical refund with this reference is ambiguous as well.
            # scan checks the order and all known attempt IDs before any attribution.
            recovery.scan(pay['owner_id'],pay,lookup['attempts'],client,hints=[rid])
        else:recovery.scan(pay['owner_id'],pay,lookup['attempts'],client)
        if self.confirmation:self.confirmation.after_confirmation(pay['owner_id'],payment=pay['id'])
        return True


def build_refund_webhook_router(finance,confirmation=None):
    router=APIRouter()
    @router.post('/api/v1/refunds/webhooks/paypal')
    async def receive(request:Request):
        raw=await read_bytes(request,256*1024)
        result=await run_in_threadpool(RefundWebhook(finance,confirmation).receive,raw,dict(request.headers))
        return JSONResponse({'data':result},headers={'Cache-Control':'no-store'})
    return router
