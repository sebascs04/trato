"""Orders v2 sandbox only. Never trusts a browser redirect as payment evidence."""
import base64
import hashlib
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
DISPUTE_DOCUMENT_LIMIT=10*1024*1024


class PayPalError(Exception):
    def __init__(self, code, *, status=502, uncertain=False, http_status=None, provider_issue=None, definitive=False):
        super().__init__(code)
        self.code, self.status, self.uncertain=code,status,uncertain
        self.http_status,self.provider_issue,self.definitive=http_status,provider_issue,definitive


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
        # Preserve only machine-readable error codes, never free text or account data.
        try:
            raw=error.read(1024*1024+1)
            body=json.loads(raw) if len(raw)<=1024*1024 else {}
            if not isinstance(body,dict):body={}
            safe=lambda value:value if isinstance(value,str) and re.fullmatch('[A-Z_]{1,80}',value) else None
            details=body.get('details',[])
            issues=[safe(d.get('issue')) for d in details[:20] if isinstance(d,dict)] if isinstance(details,list) else []
            return Response(error.code,{'name':safe(body.get('name')),'issues':[i for i in issues if i]})
        except (ValueError,OSError):return Response(error.code,{})
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

    def _request(self,method,path,payload=None,request_id=None,*,refund=False):
        headers={'Authorization':'Bearer '+self._access_token(),'Content-Type':'application/json','Prefer':'return=representation'}
        if request_id:
            if not re.fullmatch(r'[A-Za-z0-9_-]{1,38}',request_id): raise PayPalError('INVALID_PROVIDER_REQUEST_ID',status=422)
            headers['PayPal-Request-Id']=request_id
        response=self.transport(method,path,headers,json.dumps(payload).encode() if payload is not None else None)
        if not 200<=response.status<300:
            if refund:
                body=response.body if isinstance(response.body,dict) else {}
                names={'INVALID_REQUEST','VALIDATION_ERROR','AUTHENTICATION_FAILURE','NOT_AUTHORIZED','PERMISSION_DENIED',
                       'REFUND_AMOUNT_EXCEEDED','CAPTURE_FULLY_REFUNDED','REFUND_TIME_LIMIT_EXCEEDED','REFUND_NOT_ALLOWED','INSUFFICIENT_FUNDS'}
                issue=body.get('name') if body.get('name') in names else None
                issues=body.get('issues',[])
                if isinstance(issues,list):issue=next((i for i in issues if isinstance(i,str) and i in names),issue)
                definitive=response.status in (401,403) or response.status==400 and issue in ('INVALID_REQUEST','VALIDATION_ERROR')
                code=('PAYPAL_REFUND_AUTH_REJECTED' if response.status in (401,403) else 'PAYPAL_REFUND_REQUEST_REJECTED') if definitive else 'PAYPAL_REFUND_RECONCILIATION_REQUIRED'
                raise PayPalError(code,status=409 if definitive else 503,uncertain=not definitive,http_status=response.status,provider_issue=issue,definitive=definitive)
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
            'payment_source':{'paypal':{'experience_context':{'brand_name':'Trato','return_url':return_url,'cancel_url':cancel_url,'user_action':'PAY_NOW','shipping_preference':'NO_SHIPPING'}}}}
        order=self._request('POST','/v2/checkout/orders',payload,request_id)
        self.validate_order(order,item)
        return order

    # Disputes: reads go through paypal/agent_toolkit.py; the toolkit has no way to answer, so these use the REST API directly.
    # Called only after the freelancer confirms. PayPal documents no idempotency for them, so an uncertain result is never retried here.
    def _dispute_post(self,dispute_id,action,body,content_type):
        if not isinstance(dispute_id,str) or not re.fullmatch(r'[A-Za-z0-9-]{1,255}',dispute_id):raise PayPalError('INVALID_DISPUTE_ID',status=422)
        headers={'Authorization':'Bearer '+self._access_token(),'Content-Type':content_type}
        response=self.transport('POST',f'/v1/customer/disputes/{dispute_id}/{action}',headers,body)
        if not 200<=response.status<300:
            uncertain=response.status>=500 or response.status in (408,429)
            raise PayPalError('PAYPAL_REQUEST_FAILED' if uncertain else 'PAYPAL_DISPUTE_ACTION_REJECTED',status=503 if uncertain else 409,uncertain=uncertain,http_status=response.status)

    def _dispute_multipart(self,dispute_id,action,payload,files):
        # PayPal's documented shape: part `input` (JSON) plus `file1`, `file2`...
        encoded=json.dumps(payload).encode()
        boundary='trato'+hashlib.sha256(b''.join(f[2] for f in files)+encoded).hexdigest()[:24]
        body=f'--{boundary}\r\nContent-Disposition: form-data; name="input"\r\nContent-Type: application/json\r\n\r\n'.encode()+encoded+b'\r\n'
        for number,(filename,content_type,content) in enumerate(files,1):
            if not re.fullmatch(r'[A-Za-z0-9._-]{1,80}',filename) or content_type not in ('application/pdf','image/jpeg','image/png','image/gif'):raise PayPalError('INVALID_DISPUTE_DOCUMENT',status=422)
            body+=f'--{boundary}\r\nContent-Disposition: form-data; name="file{number}"; filename="{filename}"\r\nContent-Type: {content_type}\r\n\r\n'.encode()+content+b'\r\n'
        self._dispute_post(dispute_id,action,body+f'--{boundary}--\r\n'.encode(),'multipart/form-data; boundary='+boundary)

    def send_dispute_message(self,dispute_id,message,files=()):
        if files:self._dispute_multipart(dispute_id,'send-message',{'message':message},files)
        else:self._dispute_post(dispute_id,'send-message',json.dumps({'message':message}).encode(),'application/json')

    def provide_dispute_evidence(self,dispute_id,notes,files):
        self._dispute_multipart(dispute_id,'provide-evidence',{'evidences':[{'evidence_type':'OTHER','notes':notes}]},files)

    def escalate_dispute(self,dispute_id,note):
        self._dispute_post(dispute_id,'escalate',json.dumps({'note':note}).encode(),'application/json')

    def accept_dispute_claim(self,dispute_id,note):
        # PayPal closes the dispute for the client and refunds them from the merchant's account. Its documented body is multipart.
        self._dispute_multipart(dispute_id,'accept-claim',{'note':note},())

    # PayPal documents these two as Sandbox only; the hard-coded base URL of this client is already Sandbox.
    def sandbox_require_evidence(self,dispute_id):
        self._dispute_post(dispute_id,'require-evidence',json.dumps({'action':'SELLER_EVIDENCE'}).encode(),'application/json')

    def sandbox_adjudicate(self,dispute_id,outcome):
        if outcome not in ('BUYER_FAVOR','SELLER_FAVOR'):raise PayPalError('INVALID_DISPUTE_OUTCOME',status=422)
        self._dispute_post(dispute_id,'adjudicate',json.dumps({'adjudication_outcome':outcome}).encode(),'application/json')

    def fetch_dispute_document(self,url):
        parsed=urlparse(url) if isinstance(url,str) else None
        if not parsed or parsed.scheme!='https' or parsed.netloc!=urlparse(BASE_URL).netloc or parsed.query or not re.fullmatch(r'/v2/content/documents/[A-Za-z0-9_-]+/files/[0-9]+/download',parsed.path):raise PayPalError('INVALID_DISPUTE_DOCUMENT',status=422)
        try:
            with build_opener(NoRedirect()).open(Request(url,headers={'Authorization':'Bearer '+self._access_token()}),timeout=30) as response:
                content=response.read(DISPUTE_DOCUMENT_LIMIT+1)
                if len(content)>DISPUTE_DOCUMENT_LIMIT:raise PayPalError('PROVIDER_RESPONSE_TOO_LARGE')
                return content,response.headers.get('Content-Type','').split(';',1)[0].strip().lower()
        except HTTPError:raise PayPalError('PAYPAL_REQUEST_FAILED') from None
        except (URLError,TimeoutError,OSError):raise PayPalError('PAYPAL_UNAVAILABLE',status=503) from None

    def get_capture(self,capture_id):
        if not isinstance(capture_id,str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,64}',capture_id):raise PayPalError('INVALID_CAPTURE_ID',status=422)
        return self._request('GET','/v2/payments/captures/'+capture_id)

    def refund_capture(self,capture_id,payload,request_id):
        if not isinstance(capture_id,str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,64}',capture_id):raise PayPalError('INVALID_CAPTURE_ID',status=422)
        if not isinstance(payload,dict) or set(payload)!={'amount','custom_id'} or not isinstance(payload['amount'],dict) or set(payload['amount'])!={'currency_code','value'}:
            raise PayPalError('INVALID_REFUND_INSTRUCTION',status=422)
        exact_amount(payload['amount'].get('value'))
        if payload['amount']['currency_code']!='USD' or not isinstance(payload['custom_id'],str) or not re.fullmatch(r'trato-refund-[a-f0-9-]{36}',payload['custom_id']):raise PayPalError('INVALID_REFUND_INSTRUCTION',status=422)
        if not isinstance(request_id,str) or not re.fullmatch(r'[a-f0-9-]{36}',request_id):raise PayPalError('INVALID_PROVIDER_REQUEST_ID',status=422)
        return self._request('POST','/v2/payments/captures/'+capture_id+'/refund',payload,request_id,refund=True)

    def get_refund(self,refund_id):
        if not isinstance(refund_id,str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,64}',refund_id):raise PayPalError('INVALID_REFUND_ID',status=422)
        return self._request('GET','/v2/payments/refunds/'+refund_id)

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
        if cert.scheme!='https' or cert.netloc not in ('api.sandbox.paypal.com','api-m.sandbox.paypal.com','api.paypal.com') or cert.query or cert.fragment or cert.username or cert.password or not cert.path.startswith('/v1/notifications/certs/'):
            return False
        payload={'auth_algo':h['paypal-auth-algo'],'cert_url':h['paypal-cert-url'],'transmission_id':h['paypal-transmission-id'],
            'transmission_sig':h['paypal-transmission-sig'],'transmission_time':h['paypal-transmission-time'],'webhook_id':self.webhook_id,'webhook_event':event}
        response=self._request('POST','/v1/notifications/verify-webhook-signature',payload)
        return response.get('verification_status')=='SUCCESS'
