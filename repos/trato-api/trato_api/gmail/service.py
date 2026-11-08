"""Fixed-endpoint OAuth authorization code + PKCE, and Gmail send transport."""
import base64
from email import policy
from dataclasses import dataclass, field
import hashlib
import math
import os
import re
import secrets
import threading
import time
from urllib.parse import urlencode, urlparse, parse_qs

import httpx
from paypal.email import build_payment_email, build_proposal_email, valid_email, EmailDeliveryError
from .vault import GmailError, TokenVault

SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send'
READ_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'
SEND_SCOPES = 'openid email ' + SEND_SCOPE
TOKEN_URL = 'https://oauth2.googleapis.com/token'
USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo'
SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send'
THREADS_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/threads'
ATTACHMENTS_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages'
REVOKE_URL = 'https://oauth2.googleapis.com/revoke'


@dataclass(frozen=True)
class GmailSettings:
    client_id:str = field(default='',repr=False)
    client_secret:str = field(default='',repr=False)
    redirect_uri:str = 'http://localhost:5173/gmail-callback.html'
    encryption_key:str = field(default='',repr=False)
    vault_path:str = '.local/gmail/vault.sqlite3'
    delivery_mode:str = 'personal'
    trato_owner:str = field(default='',repr=False)
    trato_email:str = ''

    @classmethod
    def from_env(cls):
        return cls(os.getenv('GOOGLE_GMAIL_CLIENT_ID',''),os.getenv('GOOGLE_GMAIL_CLIENT_SECRET',''),os.getenv('GOOGLE_GMAIL_REDIRECT_URI','http://localhost:5173/gmail-callback.html'),os.getenv('GMAIL_TOKEN_ENCRYPTION_KEY',''),os.getenv('GMAIL_VAULT_PATH','.local/gmail/vault.sqlite3'),os.getenv('GMAIL_DELIVERY_MODE','personal'),os.getenv('GMAIL_TRATO_ACCOUNT_OWNER',''),os.getenv('GMAIL_TRATO_ACCOUNT_EMAIL',''))

    def configured(self):
        return bool(self.client_id and self.client_secret and self.encryption_key)

    def validate(self):
        if self.delivery_mode not in ('personal','trato'):raise GmailError('INVALID_GMAIL_DELIVERY_MODE')
        if self.delivery_mode=='trato':
            from uuid import UUID
            try:UUID(self.trato_owner)
            except (ValueError,TypeError):raise GmailError('GMAIL_TRATO_ACCOUNT_NOT_CONFIGURED') from None
            if not valid_email(self.trato_email):raise GmailError('GMAIL_TRATO_ACCOUNT_NOT_CONFIGURED')
        parsed=urlparse(self.redirect_uri)
        if not self.configured() or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path!='/gmail-callback.html' or not (parsed.scheme=='https' and parsed.hostname or parsed.scheme=='http' and parsed.hostname in ('localhost','127.0.0.1')):
            raise GmailError('GMAIL_NOT_CONFIGURED')


class GoogleTransport:
    def __init__(self,transport=None):self.transport=transport
    def __call__(self,method,url,**kwargs):
        thread_read=bool(re.fullmatch(r'https://gmail\.googleapis\.com/gmail/v1/users/me/threads/[A-Za-z0-9_-]{1,200}\?format=full',url))
        attachment_read=bool(re.fullmatch(r'https://gmail\.googleapis\.com/gmail/v1/users/me/messages/[A-Za-z0-9_-]{1,256}/attachments/[A-Za-z0-9_-]{1,2048}',url))
        message_read=bool(re.fullmatch(r'https://gmail\.googleapis\.com/gmail/v1/users/me/messages/[A-Za-z0-9_-]{1,256}\?format=full',url))
        parsed=urlparse(url);query=parse_qs(parsed.query)
        refund_search=(parsed.scheme=='https' and parsed.netloc=='gmail.googleapis.com' and parsed.path=='/gmail/v1/users/me/messages'
            and set(query)=={'q','maxResults'} and query['maxResults']==['2'] and len(query['q'])==1
            and bool(re.fullmatch(r'in:sent rfc822msgid:<trato-refund-[a-f0-9-]{36}@(?:[A-Za-z0-9-]+\.)+[A-Za-z0-9-]+>',query['q'][0])))
        if url not in (TOKEN_URL,USERINFO_URL,SEND_URL,REVOKE_URL) and not (method=='GET' and (thread_read or attachment_read or message_read or refund_search)):
            raise GmailError('INVALID_GOOGLE_ENDPOINT')
        try:
            with httpx.Client(timeout=20,follow_redirects=False,transport=self.transport) as client:
                with client.stream(method,url,**kwargs) as response:
                    raw=b''
                    maximum=15*1024*1024 if attachment_read else 4*1024*1024
                    for chunk in response.iter_bytes():
                        raw+=chunk
                        if len(raw)>maximum:raise GmailError('GOOGLE_RESPONSE_TOO_LARGE',uncertain=url==SEND_URL)
                    import json
                    try:body=json.loads(raw) if raw else {}
                    except ValueError:body={}
                    return response.status_code,body
        except httpx.HTTPError:
            raise GmailError('GOOGLE_UNAVAILABLE',uncertain=url==SEND_URL) from None


def reply_text(body):
    """Remove a trailing quoted conversation for display; retain original evidence."""
    # Display-only normalization of escaped mail exports. Original evidence is intact.
    body = re.sub(r'\\(?=\r?\n|$)', '', body)
    body = re.sub(r'\\([<>])', r'\1', body)
    lines = body.splitlines()
    for index in range(1,len(lines)):
        for size in range(1,min(6,len(lines)-index)+1):
            header=' '.join(line.strip() for line in lines[index:index+size])
            if re.fullmatch(r'(?:On\s+.+\s+wrote:|El\s+.+\s+escribi[oó]:)',header,re.IGNORECASE) and any(line.strip() for line in lines[:index]):
                return '\n'.join(lines[:index]).strip()
    end = len(lines)
    while end and not lines[end - 1].strip():
        end -= 1
    start = end
    quoted = False
    while start and (not lines[start - 1].strip() or lines[start - 1].lstrip().startswith('>')):
        quoted = quoted or lines[start - 1].lstrip().startswith('>')
        start -= 1
    if not quoted:
        return body.strip()
    # Gmail wraps attribution headers over several lines (ES and EN).
    for index in range(max(0, start - 6), start):
        header = ' '.join(line.strip() for line in lines[index:start]).strip()
        if re.fullmatch(r'(?:On\s+.+\s+wrote:|El\s+.+\s+escribi[oó]:)', header, re.IGNORECASE):
            start = index
            break
    return '\n'.join(lines[:start]).strip()


def display_reply(body, message):
    """Derive display text from preserved MIME; never alter acceptance evidence."""
    from html.parser import HTMLParser
    class ReplyHTML(HTMLParser):
        def __init__(self):
            super().__init__(convert_charrefs=True);self.frames=[];self.text=[];self.quoted=False
        def hidden(self):return any(skip for _,skip in self.frames)
        def handle_starttag(self,tag,attrs):
            values=dict(attrs);classes=set(values.get('class','').split())
            quote=tag=='blockquote' or bool(classes & {'gmail_quote','gmail_attr','yahoo_quoted','moz-cite-prefix'})
            self.quoted=self.quoted or quote
            if len(self.frames)>250:raise ValueError('HTML nesting limit')
            if tag in ('br','hr'):
                if not self.hidden():self.text.append('\n')
                return
            if tag in ('img','input','meta','link','wbr','source'):return
            if tag in ('div','p','li') and not self.hidden():self.text.append('\n')
            self.frames.append((tag,quote or tag in ('script','style','head')))
        def handle_startendtag(self,tag,attrs):
            self.handle_starttag(tag,attrs);self.handle_endtag(tag)
        def handle_endtag(self,tag):
            for i in range(len(self.frames)-1,-1,-1):
                if self.frames[i][0]==tag:
                    self.frames=self.frames[:i];break
            if tag in ('div','p','li') and not self.hidden():self.text.append('\n')
        def handle_data(self,data):
            if not self.hidden():self.text.append(data)
    def parts(part,depth=0):
        if depth>20 or not isinstance(part,dict):return
        if part.get('mimeType','').lower()=='text/html' and not part.get('filename'):
            encoded=part.get('body',{}).get('data','')
            if isinstance(encoded,str) and len(encoded)<=180000:
                try:
                    raw=base64.urlsafe_b64decode(encoded+'='*((-len(encoded))%4)).decode('utf-8',errors='replace')
                    parser=ReplyHTML();parser.feed(raw);parser.close()
                    text='\n'.join(line.rstrip() for line in ''.join(parser.text).splitlines()).strip()
                    if parser.quoted and text:yield text
                except (ValueError,TypeError):pass
        for child in part.get('parts',[]) or []:yield from parts(child,depth+1)
    text=next(parts(message.get('payload',{}) if isinstance(message,dict) else {}),None)
    if text is not None:return {'reply_text':reply_text(text),'reply_needs_review':False}
    text=reply_text(body)
    uncertain=text==body.strip() and bool(re.search(r'(?im)^(?:>\s*|On .+wrote:|El .+escribi[oó]:|[- ]*(?:Original Message|Mensaje original)[- ]*)',body))
    return {'reply_text':text,'reply_needs_review':uncertain}


class GmailConnectionService:
    def __init__(self,settings,vault=None,transport=None,*,clock=time.time):
        settings.validate()
        self.settings,self.clock=settings,clock
        self.vault=vault or TokenVault(settings.vault_path,settings.encryption_key,clock=clock)
        self.transport=transport or GoogleTransport()
        self.lock=threading.RLock()  # Single API process in local development.

    def validate_mailbox_identity(self,user,profile):
        pass

    def status(self,user):
        item=self.vault.get(user)
        scopes=set(item.get('scope','').split()) if item else set()
        return {'configured':True,'connected':bool(item),'email':item['email'] if item else None,
                'can_send':SEND_SCOPE in scopes,'can_read':READ_SCOPE in scopes}

    def start(self,user,purpose='send'):
        if purpose not in ('send','read','send_read'):raise GmailError('INVALID_GMAIL_PURPOSE',422)
        previous=self.vault.get(user)
        if purpose=='read' and (not previous or SEND_SCOPE not in previous.get('scope','').split()):
            raise GmailError('GMAIL_SEND_CONNECTION_REQUIRED',409)
        state,verifier=secrets.token_urlsafe(32),secrets.token_urlsafe(64)
        challenge=base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')
        self.vault.begin(user,state,verifier,purpose=purpose)
        query={'client_id':self.settings.client_id,'redirect_uri':self.settings.redirect_uri,'response_type':'code',
               'scope':(SEND_SCOPES+' '+READ_SCOPE if purpose=='send_read' else SEND_SCOPES if purpose=='send' else READ_SCOPE),'access_type':'offline',
               'include_granted_scopes':'true','prompt':'consent','state':state,'code_challenge':challenge,'code_challenge_method':'S256'}
        if purpose in ('read','send_read') and previous and previous.get('email'):query['login_hint']=previous['email']
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
        authorization=self.vault.consume_authorization(user,state)
        verifier,purpose=authorization['verifier'],authorization['purpose']
        if error:raise GmailError('GMAIL_AUTHORIZATION_DECLINED',409)
        if not code:raise GmailError('INVALID_AUTHORIZATION_CODE',422)
        with self.lock:
            status,body=self.transport('POST',TOKEN_URL,data={'client_id':self.settings.client_id,'client_secret':self.settings.client_secret,'code':code,'code_verifier':verifier,'redirect_uri':self.settings.redirect_uri,'grant_type':'authorization_code'})
            if status!=200:raise GmailError('GMAIL_AUTHORIZATION_FAILED',409)
            previous=self.vault.get(user) if purpose in ('read','send_read') else None
            tokens=self.token_fields(body,previous)
            granted=set(tokens['scope'].split())
            required={SEND_SCOPE} if purpose=='send' else {SEND_SCOPE,READ_SCOPE}
            if not required.issubset(granted):
                if purpose in ('read','send_read'):raise GmailError('GMAIL_READ_PERMISSION_REQUIRED',409)
                raise GmailError('GMAIL_SEND_PERMISSION_REQUIRED',409)
            status,profile=self.transport('GET',USERINFO_URL,headers={'Authorization':'Bearer '+tokens['access_token']})
            if status!=200 or not isinstance(profile,dict) or profile.get('email_verified') is not True or not valid_email(profile.get('email')) or not isinstance(profile.get('sub'),str) or not profile['sub']:raise GmailError('GMAIL_IDENTITY_NOT_VERIFIED',409)
            if previous and (profile['sub']!=previous.get('subject') or profile['email'].lower()!=previous.get('email','').lower()):
                raise GmailError('GMAIL_ACCOUNT_CHANGED',409)
            self.validate_mailbox_identity(user,profile)
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
        return self._send_built(user,item,notification_id,build_proposal_email if proposal else build_payment_email,expected_sender)

    def send_refund(self,user,item,notification_id,*,expected_sender=None):
        from ..refunds.mail import build_settlement_email
        return self._send_built(user,item,notification_id,build_settlement_email,expected_sender)

    def send_refund_confirmation(self,user,item,notification_id):
        from ..refunds.mail import build_refund_confirmation_email
        return self._send_built(user,item,notification_id,build_refund_confirmation_email,None)

    def _send_built(self,user,item,notification_id,builder,expected_sender):
        try:
            with self.lock:
                connection=self.credentials(user)
                if expected_sender is not None and connection['email'].casefold()!=expected_sender.casefold():raise GmailError('GMAIL_SENDER_CHANGED',409)
                message=builder(connection['email'],item,notification_id)
                # Keep indivisible Message-ID tokens intact and serialize RFC mail with CRLF.
                raw=base64.urlsafe_b64encode(message.as_bytes(policy=policy.SMTP.clone(max_line_length=998))).decode()
                status,result=self.transport('POST',SEND_URL,headers={'Authorization':'Bearer '+connection['access_token']},json={'raw':raw})
            if status!=200:
                if status in (401,403):raise GmailError('GMAIL_SEND_NOT_AUTHORIZED',409)
                raise GmailError('GMAIL_SEND_FAILED',uncertain=status>=500 or status==429)
            if not isinstance(result,dict) or not isinstance(result.get('id'),str) or not result['id']:raise GmailError('INVALID_GMAIL_SEND_RESPONSE',uncertain=True)
            return {'status':'accepted_by_gmail','message_id':result['id'],
                    'thread_id':result.get('threadId') if isinstance(result.get('threadId'),str) else None}
        except GmailError as error:
            raise EmailDeliveryError(error.code,uncertain=error.uncertain) from None

    @staticmethod
    def _header(message,name):
        headers=message.get('payload',{}).get('headers',[])
        if not isinstance(headers,list):return ''
        return next((str(h.get('value','')) for h in headers if isinstance(h,dict) and str(h.get('name','')).lower()==name.lower()),'')

    def find_refund_sent(self,user,delivery_id):
        from uuid import UUID
        try:delivery_id=str(UUID(delivery_id))
        except (ValueError,TypeError):raise GmailError('INVALID_GMAIL_MESSAGE',422) from None
        connection=self.credentials(user)
        if READ_SCOPE not in connection.get('scope','').split():raise GmailError('GMAIL_READ_PERMISSION_REQUIRED',409)
        headers={'Authorization':'Bearer '+connection['access_token']}
        url=ATTACHMENTS_URL+'?'+urlencode({'q':f"in:sent rfc822msgid:<trato-refund-{delivery_id}@{connection['email'].rsplit('@',1)[1]}>",'maxResults':'2'})
        status,result=self.transport('GET',url,headers=headers)
        if status!=200 or not isinstance(result,dict):raise GmailError('GMAIL_READ_FAILED',503)
        messages=result.get('messages',[])
        if not isinstance(messages,list) or len(messages)>1:raise GmailError('REFUND_DELIVERY_AMBIGUOUS',409)
        if not messages:return None
        message_id=messages[0].get('id')
        if not isinstance(message_id,str) or not re.fullmatch('[A-Za-z0-9_-]{1,256}',message_id):raise GmailError('INVALID_GMAIL_MESSAGE',502)
        status,message=self.transport('GET',ATTACHMENTS_URL+'/'+message_id+'?format=full',headers=headers)
        if status!=200 or not isinstance(message,dict) or message.get('id')!=message_id:raise GmailError('GMAIL_READ_FAILED',503)
        return message

    def read_thread(self,user,thread_id):
        if not isinstance(thread_id,str) or not 1<=len(thread_id)<=200 or not thread_id.replace('-','').replace('_','').isalnum():
            raise GmailError('INVALID_GMAIL_THREAD',422)
        connection=self.credentials(user)
        if READ_SCOPE not in connection.get('scope','').split():raise GmailError('GMAIL_READ_PERMISSION_REQUIRED',409)
        status,result=self.transport('GET',THREADS_URL+'/'+thread_id+'?format=full',headers={'Authorization':'Bearer '+connection['access_token']})
        if status in (401,403):raise GmailError('GMAIL_READ_NOT_AUTHORIZED',409)
        if status==404:return {'id':thread_id,'messages':[]}
        if status!=200 or not isinstance(result,dict) or result.get('id')!=thread_id or not isinstance(result.get('messages'),list):
            raise GmailError('GMAIL_READ_FAILED',503)
        if len(result['messages'])>100:raise GmailError('GMAIL_THREAD_TOO_LARGE',413)
        return result

    @staticmethod
    def _body_bytes(value,maximum):
        if not isinstance(value,str) or len(value)>((maximum+2)//3)*4+4:raise GmailError('GMAIL_MESSAGE_TOO_LARGE',413)
        if not re.fullmatch(r'[A-Za-z0-9_-]*={0,2}',value):raise GmailError('INVALID_GMAIL_MESSAGE',502)
        unpadded=value.rstrip('=')
        expected_padding=(4-len(unpadded)%4)%4
        if len(unpadded)%4==1 or len(value)-len(unpadded) not in (0,expected_padding):raise GmailError('INVALID_GMAIL_MESSAGE',502)
        try:raw=base64.urlsafe_b64decode(unpadded+'='*expected_padding)
        except (ValueError,base64.binascii.Error):raise GmailError('INVALID_GMAIL_MESSAGE',502) from None
        if base64.urlsafe_b64encode(raw).decode().rstrip('=')!=unpadded:raise GmailError('INVALID_GMAIL_MESSAGE',502)
        if len(raw)>maximum:raise GmailError('GMAIL_MESSAGE_TOO_LARGE',413)
        return raw

    @staticmethod
    def _safe_filename(value):
        if not isinstance(value,str):return 'attachment.pdf'
        name=value.replace('\\','/').split('/')[-1].strip()
        name=re.sub(r'[^A-Za-z0-9._ -]','_',name)[:120].strip(' .')
        return name or 'attachment.pdf'

    def message_content(self,message):
        payload=message.get('payload')
        if not isinstance(payload,dict):raise GmailError('INVALID_GMAIL_MESSAGE',502)
        text_parts=[];attachments=[];count=0;total=0;parts_seen=0
        def visit(part,depth=0):
            nonlocal count,total,parts_seen
            if depth>20 or parts_seen>=100:raise GmailError('GMAIL_MESSAGE_TOO_COMPLEX',413)
            parts_seen+=1
            if not isinstance(part,dict):raise GmailError('INVALID_GMAIL_MESSAGE',502)
            body=part.get('body') if isinstance(part.get('body'),dict) else {}
            mime=str(part.get('mimeType','')).lower()
            filename=self._safe_filename(part.get('filename'))
            attachment_id=body.get('attachmentId')
            if mime.startswith('image/'):
                headers={str(header.get('name','')).lower():str(header.get('value',''))
                         for header in part.get('headers') or [] if isinstance(header,dict)}
                disposition=headers.get('content-disposition','').split(';',1)[0].strip().lower()
                if (disposition=='inline' or not part.get('filename') or filename.lower()=='noname'
                    or (headers.get('content-id') and disposition!='attachment')):
                    return
            if (bool(part.get('filename')) or attachment_id) and mime not in ('multipart/mixed','multipart/alternative','multipart/related'):
                count+=1
                size=body.get('size')
                if count>5 or type(size) is not int or size<0 or size>10485760:raise GmailError('GMAIL_ATTACHMENT_LIMIT',413)
                total+=size
                if total>15728640:raise GmailError('GMAIL_ATTACHMENT_LIMIT',413)
                if attachment_id:
                    if not isinstance(attachment_id,str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,2048}',attachment_id):raise GmailError('INVALID_GMAIL_ATTACHMENT',422)
                    attachments.append({'attachment_id':attachment_id,'filename':filename,'mime_type':mime,'size_bytes':size,
                                        'supported':mime=='application/pdf' and filename.lower().endswith('.pdf')})
                elif body.get('data'):
                    raw=self._body_bytes(body['data'],10485760)
                    attachments.append({'filename':filename,'mime_type':mime,'size_bytes':len(raw),'supported':False})
                return
            if mime=='text/plain' and body.get('data'):
                raw=self._body_bytes(body['data'],65536)
                total+=len(raw)
                if total>15728640:raise GmailError('GMAIL_MESSAGE_TOO_LARGE',413)
                text_parts.append(raw.decode('utf-8',errors='replace'))
            children=part.get('parts',[])
            if not isinstance(children,list):raise GmailError('INVALID_GMAIL_MESSAGE',502)
            for child in children:visit(child,depth+1)
        visit(payload)
        text='\n\n'.join(x.strip() for x in text_parts if x.strip())
        if len(text.encode('utf-8'))>50000:raise GmailError('GMAIL_MESSAGE_TOO_LARGE',413)
        return {'body_text':text,'attachments':attachments}

    def read_attachment(self,user,message_id,attachment_id,maximum=10485760):
        for value,limit in ((message_id,256),(attachment_id,2048)):
            if not isinstance(value,str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,'+str(limit)+'}',value):
                raise GmailError('INVALID_GMAIL_ATTACHMENT',422)
        connection=self.credentials(user)
        if READ_SCOPE not in connection.get('scope','').split():raise GmailError('GMAIL_READ_PERMISSION_REQUIRED',409)
        url=ATTACHMENTS_URL+'/'+message_id+'/attachments/'+attachment_id
        status,result=self.transport('GET',url,headers={'Authorization':'Bearer '+connection['access_token']})
        if status in (401,403):raise GmailError('GMAIL_READ_NOT_AUTHORIZED',409)
        if status!=200 or not isinstance(result,dict) or not isinstance(result.get('data'),str):raise GmailError('GMAIL_ATTACHMENT_UNAVAILABLE',503)
        raw=self._body_bytes(result['data'],maximum)
        if type(result.get('size')) is int and result['size']!=len(raw):raise GmailError('GMAIL_ATTACHMENT_INVALID',422)
        if not raw.startswith(b'%PDF-'):raise GmailError('GMAIL_ATTACHMENT_UNSUPPORTED',415)
        return raw


class GmailMailer:
    """Bind server-authenticated owner; never choose sender from a browser payload."""
    def __init__(self,service,user):self.service,self.user=service,user
    def send(self,item,notification_id):return self.service.send(self.user,item,notification_id)
    def send_proposal(self,item,notification_id):return self.service.send(self.user,item,notification_id,proposal=True)
