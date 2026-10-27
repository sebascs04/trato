"""Fixed-endpoint OAuth authorization code + PKCE, and Gmail send transport."""
import base64
from dataclasses import dataclass, field
import hashlib
import math
import os
import secrets
import threading
import time
from urllib.parse import urlencode, urlparse

import httpx
from paypal.email import build_payment_email, build_proposal_email, valid_email, EmailDeliveryError
from .vault import GmailError, TokenVault

SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send'
SCOPES = 'openid email ' + SEND_SCOPE
TOKEN_URL = 'https://oauth2.googleapis.com/token'
USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo'
SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send'
REVOKE_URL = 'https://oauth2.googleapis.com/revoke'


@dataclass(frozen=True)
class GmailSettings:
    client_id:str = field(default='',repr=False)
    client_secret:str = field(default='',repr=False)
    redirect_uri:str = 'http://localhost:5173/gmail-callback.html'
    encryption_key:str = field(default='',repr=False)
    vault_path:str = '.local/gmail/vault.sqlite3'

    @classmethod
    def from_env(cls):
        return cls(os.getenv('GOOGLE_GMAIL_CLIENT_ID',''),os.getenv('GOOGLE_GMAIL_CLIENT_SECRET',''),os.getenv('GOOGLE_GMAIL_REDIRECT_URI','http://localhost:5173/gmail-callback.html'),os.getenv('GMAIL_TOKEN_ENCRYPTION_KEY',''),os.getenv('GMAIL_VAULT_PATH','.local/gmail/vault.sqlite3'))

    def configured(self):
        return bool(self.client_id and self.client_secret and self.encryption_key)

    def validate(self):
        parsed=urlparse(self.redirect_uri)
        if not self.configured() or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path!='/gmail-callback.html' or not (parsed.scheme=='https' and parsed.hostname or parsed.scheme=='http' and parsed.hostname in ('localhost','127.0.0.1')):
            raise GmailError('GMAIL_NOT_CONFIGURED')


class GoogleTransport:
    def __init__(self,transport=None):self.transport=transport
    def __call__(self,method,url,**kwargs):
        if url not in (TOKEN_URL,USERINFO_URL,SEND_URL,REVOKE_URL):raise GmailError('INVALID_GOOGLE_ENDPOINT')
        try:
            with httpx.Client(timeout=20,follow_redirects=False,transport=self.transport) as client:
                with client.stream(method,url,**kwargs) as response:
                    raw=b''
                    for chunk in response.iter_bytes():
                        raw+=chunk
                        if len(raw)>1024*1024:raise GmailError('GOOGLE_RESPONSE_TOO_LARGE',uncertain=url==SEND_URL)
                    import json
                    try:body=json.loads(raw) if raw else {}
                    except ValueError:body={}
                    return response.status_code,body
        except httpx.HTTPError:
            raise GmailError('GOOGLE_UNAVAILABLE',uncertain=url==SEND_URL) from None


class GmailConnectionService:
    def __init__(self,settings,vault=None,transport=None,*,clock=time.time):
        settings.validate()
        self.settings,self.clock=settings,clock
        self.vault=vault or TokenVault(settings.vault_path,settings.encryption_key,clock=clock)
        self.transport=transport or GoogleTransport()
        self.lock=threading.RLock()  # Single API process in local development.

    def status(self,user):
        item=self.vault.get(user)
        return {'configured':True,'connected':bool(item),'email':item['email'] if item else None}

    def start(self,user):
        state,verifier=secrets.token_urlsafe(32),secrets.token_urlsafe(64)
        challenge=base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')
        self.vault.begin(user,state,verifier)
        query={'client_id':self.settings.client_id,'redirect_uri':self.settings.redirect_uri,'response_type':'code','scope':SCOPES,'access_type':'offline','prompt':'consent','state':state,'code_challenge':challenge,'code_challenge_method':'S256'}
        return {'authorization_url':'https://accounts.google.com/o/oauth2/v2/auth?'+urlencode(query)}

    def token_fields(self,body,previous=None):
        if not isinstance(body,dict):raise GmailError('INVALID_GOOGLE_TOKEN_RESPONSE')
        token=body.get('access_token');refresh=body.get('refresh_token') or (previous or {}).get('refresh_token')
        try:expires=float(body.get('expires_in',0))
        except (ValueError,TypeError):raise GmailError('INVALID_GOOGLE_TOKEN_RESPONSE') from None
        if not isinstance(token,str) or not token or any(ord(c)<33 or ord(c)>126 for c in token) or not isinstance(refresh,str) or not refresh or any(ord(c)<33 or ord(c)>126 for c in refresh) or not isinstance(body.get('token_type'),str) or body['token_type'].lower()!='bearer' or not math.isfinite(expires) or expires<=0:
            raise GmailError('INVALID_GOOGLE_TOKEN_RESPONSE')
        scope=body.get('scope') or (previous or {}).get('scope','')
        if not isinstance(scope,str) or SEND_SCOPE not in scope.split():raise GmailError('GMAIL_SEND_PERMISSION_REQUIRED',409)
        return {'access_token':token,'refresh_token':refresh,'expires_at':self.clock()+expires,'scope':body.get('scope') or previous['scope']}

    def complete(self,user,state,code=None,error=None):
        verifier=self.vault.consume(user,state)
        if error:raise GmailError('GMAIL_AUTHORIZATION_DECLINED',409)
        if not code:raise GmailError('INVALID_AUTHORIZATION_CODE',422)
        with self.lock:
            status,body=self.transport('POST',TOKEN_URL,data={'client_id':self.settings.client_id,'client_secret':self.settings.client_secret,'code':code,'code_verifier':verifier,'redirect_uri':self.settings.redirect_uri,'grant_type':'authorization_code'})
            if status!=200:raise GmailError('GMAIL_AUTHORIZATION_FAILED',409)
            tokens=self.token_fields(body)
            status,profile=self.transport('GET',USERINFO_URL,headers={'Authorization':'Bearer '+tokens['access_token']})
            if status!=200 or not isinstance(profile,dict) or profile.get('email_verified') is not True or not valid_email(profile.get('email')) or not isinstance(profile.get('sub'),str) or not profile['sub']:raise GmailError('GMAIL_IDENTITY_NOT_VERIFIED',409)
            self.vault.save(user,{**tokens,'email':profile['email'],'subject':profile['sub']})
        return self.status(user)

    def credentials(self,user):
        with self.lock:
            saved=self.vault.get(user)
            if not saved:raise GmailError('GMAIL_NOT_CONNECTED',409)
            if saved['expires_at']>self.clock()+60:return saved
            status,body=self.transport('POST',TOKEN_URL,data={'client_id':self.settings.client_id,'client_secret':self.settings.client_secret,'refresh_token':saved['refresh_token'],'grant_type':'refresh_token'})
            if status in (400,401):
                self.vault.delete(user)
                raise GmailError('GMAIL_RECONNECT_REQUIRED',409)
            if status!=200:raise GmailError('GOOGLE_UNAVAILABLE')
            refreshed={**saved,**self.token_fields(body,saved)}
            self.vault.save(user,refreshed)
            return refreshed

    def disconnect(self,user):
        with self.lock:
            saved=self.vault.get(user)
            self.vault.delete(user)
            revoked=not bool(saved)
            if saved:
                try:revoked=self.transport('POST',REVOKE_URL,data={'token':saved['refresh_token']})[0] in (200,400)
                except GmailError:revoked=False
        return {'configured':True,'connected':False,'email':None,'revoked':revoked}

    def send(self,user,item,notification_id,*,proposal=False,expected_sender=None):
        try:
            with self.lock:
                connection=self.credentials(user)
                if expected_sender is not None and connection['email']!=expected_sender:raise GmailError('GMAIL_SENDER_CHANGED',409)
                builder=build_proposal_email if proposal else build_payment_email
                message=builder(connection['email'],item,notification_id)
                raw=base64.urlsafe_b64encode(message.as_bytes()).decode()
                status,result=self.transport('POST',SEND_URL,headers={'Authorization':'Bearer '+connection['access_token']},json={'raw':raw})
            if status!=200:
                if status in (401,403):raise GmailError('GMAIL_SEND_NOT_AUTHORIZED',409)
                raise GmailError('GMAIL_SEND_FAILED',uncertain=status>=500 or status==429)
            if not isinstance(result,dict) or not isinstance(result.get('id'),str) or not result['id']:raise GmailError('INVALID_GMAIL_SEND_RESPONSE',uncertain=True)
            return {'status':'accepted_by_gmail','message_id':result['id']}
        except GmailError as error:
            raise EmailDeliveryError(error.code,uncertain=error.uncertain) from None


class GmailMailer:
    """Bind server-authenticated owner; never choose sender from a browser payload."""
    def __init__(self,service,user):self.service,self.user=service,user
    def send(self,item,notification_id):return self.service.send(self.user,item,notification_id)
    def send_proposal(self,item,notification_id):return self.service.send(self.user,item,notification_id,proposal=True)
