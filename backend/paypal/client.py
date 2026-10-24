"""Orders v2 sandbox only. Never trusts a browser redirect as payment evidence."""
import base64
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
import json
import math
import re
import time
from typing import Callable
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse
from urllib.request import Request, build_opener, HTTPRedirectHandler

BASE_URL='https://api-m.sandbox.paypal.com'


class PayPalError(Exception):
    def __init__(self, code, *, status=502, uncertain=False):
        super().__init__(code)
        self.code, self.status, self.uncertain=code,status,uncertain


@dataclass(frozen=True)
class Response:
    status:int
    body:dict


@dataclass(frozen=True)
class PaymentInstruction:
    payment_id:str
    amount:str
    currency:str
    merchant_id:str


def exact_amount(value):
    if not isinstance(value,str) or not re.fullmatch(r'\d{1,9}\.\d{2}',value):
        raise PayPalError('INVALID_AMOUNT',status=422)
    try: result=Decimal(value)
    except InvalidOperation: raise PayPalError('INVALID_AMOUNT',status=422)
    if not result.is_finite() or result<=0: raise PayPalError('INVALID_AMOUNT',status=422)
    return result


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl):
        return None


def http_transport(method,path,headers,body):
    request=Request(BASE_URL+path,data=body,headers=headers,method=method)
    try:
        with build_opener(NoRedirect()).open(request,timeout=15) as response:
            raw=response.read(1024*1024+1)
            if len(raw)>1024*1024: raise PayPalError('PROVIDER_RESPONSE_TOO_LARGE',uncertain=method=='POST')
            return Response(response.status,json.loads(raw))
    except HTTPError as error:
        # Deliberately do not log bodies/headers or expose provider account details.
        return Response(error.code,{})
    except (URLError,TimeoutError,OSError):
        raise PayPalError('PAYPAL_UNAVAILABLE',uncertain=method=='POST')
    except (ValueError,UnicodeError):
        raise PayPalError('INVALID_PROVIDER_RESPONSE',uncertain=method=='POST')


class PayPalSandboxClient:
    def __init__(self,client_id,client_secret,merchant_id,webhook_id='',*,transport:Callable=http_transport,clock=time.monotonic):
        if not client_id or not client_secret or not re.fullmatch(r'[A-Z0-9]{8,32}',merchant_id or ''):
            raise PayPalError('PAYPAL_SANDBOX_NOT_CONFIGURED',status=503)
        self.client_id,self.client_secret,self.merchant_id,self.webhook_id=client_id,client_secret,merchant_id,webhook_id
        self.transport,self.clock=transport,clock
        self._token=None;self._expires=0

    def _access_token(self):
        if self._token and self.clock()<self._expires:return self._token
        credentials=base64.b64encode(f'{self.client_id}:{self.client_secret}'.encode()).decode()
        result=self.transport('POST','/v1/oauth2/token',{'Authorization':'Basic '+credentials,'Content-Type':'application/x-www-form-urlencoded'},urlencode({'grant_type':'client_credentials'}).encode())
        if result.status!=200 or not isinstance(result.body,dict) or not isinstance(result.body.get('access_token'),str) or not result.body['access_token']:
            raise PayPalError('PAYPAL_AUTHENTICATION_FAILED',status=503)
        try: lifetime=float(result.body['expires_in'])
        except (KeyError,ValueError,TypeError):raise PayPalError('INVALID_PROVIDER_RESPONSE')
        if not math.isfinite(lifetime) or lifetime<=0:raise PayPalError('INVALID_PROVIDER_RESPONSE')
        self._token=result.body['access_token'];self._expires=self.clock()+max(0,lifetime-60)
        return self._token

    def _request(self,method,path,payload=None,request_id=None):
        headers={'Authorization':'Bearer '+self._access_token(),'Content-Type':'application/json','Prefer':'return=representation'}
        if request_id:
            if not re.fullmatch(r'[A-Za-z0-9_-]{1,38}',request_id): raise PayPalError('INVALID_PROVIDER_REQUEST_ID',status=422)
            headers['PayPal-Request-Id']=request_id
        response=self.transport(method,path,headers,json.dumps(payload).encode() if payload is not None else None)
        if not 200<=response.status<300:
            raise PayPalError('PAYPAL_REQUEST_FAILED',status=503 if response.status==429 else 502,uncertain=method=='POST' and (response.status>=500 or response.status in (408,429)))
        if not isinstance(response.body,dict):raise PayPalError('INVALID_PROVIDER_RESPONSE',uncertain=method=='POST')
        return response.body

    def _instruction(self,item):
        exact_amount(item.amount)
        if item.currency!='USD':raise PayPalError('UNSUPPORTED_CURRENCY',status=422)
        if item.merchant_id!=self.merchant_id:raise PayPalError('MERCHANT_MISMATCH',status=422)
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,64}',item.payment_id):raise PayPalError('INVALID_PAYMENT_REFERENCE',status=422)

    def create_order(self,item:PaymentInstruction,request_id,return_url,cancel_url):
        self._instruction(item)
        # URLs must come from application configuration, never from request bodies.
        for url in (return_url,cancel_url):
            parsed=urlparse(url)
            if parsed.username or parsed.password or not parsed.netloc or parsed.scheme not in ('http','https') or (parsed.scheme=='http' and parsed.hostname not in ('localhost','127.0.0.1')):
                raise PayPalError('INVALID_RETURN_URL',status=503)
        payload={'intent':'CAPTURE','purchase_units':[{'reference_id':item.payment_id,'custom_id':item.payment_id,
            'amount':{'currency_code':item.currency,'value':item.amount},'payee':{'merchant_id':self.merchant_id}}],
            'payment_source':{'paypal':{'experience_context':{'return_url':return_url,'cancel_url':cancel_url,'user_action':'PAY_NOW','shipping_preference':'NO_SHIPPING'}}}}
        order=self._request('POST','/v2/checkout/orders',payload,request_id)
        self.validate_order(order,item)
        return order

    def get_order(self,order_id):
        self._order_id(order_id)
        return self._request('GET',f'/v2/checkout/orders/{order_id}')

    def capture_order(self,order_id,request_id):
        self._order_id(order_id)
        return self._request('POST',f'/v2/checkout/orders/{order_id}/capture',{},request_id)

    @staticmethod
    def _order_id(value):
        if not isinstance(value,str) or not re.fullmatch(r'[A-Z0-9]{8,32}',value):raise PayPalError('INVALID_ORDER_ID',status=422)

    def validate_order(self,order,item):
        self._instruction(item)
        try:
            self._order_id(order['id'])
            if order['intent']!='CAPTURE' or len(order['purchase_units'])!=1:raise ValueError()
            unit=order['purchase_units'][0]
            if unit['reference_id']!=item.payment_id or unit['custom_id']!=item.payment_id:raise ValueError()
            if unit['amount']['currency_code']!=item.currency or exact_amount(unit['amount']['value'])!=exact_amount(item.amount):raise ValueError()
            if unit['payee']['merchant_id']!=item.merchant_id:raise ValueError()
            captures=unit.get('payments',{}).get('captures',[])
            if len(captures)>1:raise ValueError()
            for capture in captures:
                if capture['amount']['currency_code']!=item.currency or exact_amount(capture['amount']['value'])!=exact_amount(item.amount):raise ValueError()
                self._order_id(capture['id'])
        except (KeyError,TypeError,ValueError,PayPalError):
            raise PayPalError('PAYMENT_EVIDENCE_MISMATCH',status=409,uncertain=True)
        return self.order_state(order)

    @staticmethod
    def order_state(order):
        try:captures=order['purchase_units'][0].get('payments',{}).get('captures',[])
        except (KeyError,IndexError,TypeError):raise PayPalError('INVALID_PROVIDER_RESPONSE')
        if captures:
            status=captures[0].get('status')
            if status=='COMPLETED':return 'completed'
            if status=='PENDING':return 'pending'
            if status in ('DECLINED','FAILED','DENIED'):return 'failed'
            return 'reconciliation_required'
        return {'CREATED':'pending_approval','PAYER_ACTION_REQUIRED':'pending_approval','APPROVED':'approved','VOIDED':'cancelled'}.get(order.get('status'),'reconciliation_required')

    @staticmethod
    def approval_url(order):
        for link in order.get('links',[]):
            if link.get('rel') in ('payer-action','approve'):
                url=link.get('href','');parsed=urlparse(url)
                if parsed.scheme=='https' and parsed.hostname in ('www.sandbox.paypal.com','sandbox.paypal.com') and not parsed.username and not parsed.password:
                    return url
        return None

    def verify_webhook(self,headers,event):
        if not self.webhook_id:raise PayPalError('PAYPAL_WEBHOOK_NOT_CONFIGURED',status=503)
        h={key.lower():value for key,value in headers.items()}
        required=['paypal-auth-algo','paypal-cert-url','paypal-transmission-id','paypal-transmission-sig','paypal-transmission-time']
        if any(not isinstance(h.get(key),str) or not h[key] or len(h[key])>8192 for key in required):return False
        cert=urlparse(h['paypal-cert-url'])
        if cert.scheme!='https' or cert.hostname not in ('api.sandbox.paypal.com','api-m.sandbox.paypal.com','api.paypal.com') or cert.username or cert.password or not cert.path.startswith('/v1/notifications/certs/'):
            return False
        payload={'auth_algo':h['paypal-auth-algo'],'cert_url':h['paypal-cert-url'],'transmission_id':h['paypal-transmission-id'],
            'transmission_sig':h['paypal-transmission-sig'],'transmission_time':h['paypal-transmission-time'],'webhook_id':self.webhook_id,'webhook_event':event}
        response=self._request('POST','/v1/notifications/verify-webhook-signature',payload)
        return response.get('verification_status')=='SUCCESS'
