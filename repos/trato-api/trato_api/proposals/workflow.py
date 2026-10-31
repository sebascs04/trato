"""Gmail and PayPal run directly in the HTTP backend, outside the IA worker."""
from dataclasses import asdict
from hashlib import sha256
from email.utils import getaddresses
import json
import os
import secrets
import threading
import time
from datetime import datetime,timezone
import re
from urllib.parse import urlencode

from paypal.client import PayPalSandboxClient, PaymentInstruction, PayPalError
from paypal.config import SandboxSettings
from paypal.email import ProposalEmail, PaymentEmail, PdfAttachment, EmailDeliveryError, build_proposal_email, build_payment_email
from ..errors import ApiError
from ..persistence import Repository
from ..gmail.service import GmailMailer, reply_text

class BackendStore:
    def __init__(self, settings):
        key=os.getenv('SUPABASE_SERVER_KEY','')
        if not key:raise ApiError('BACKEND_COMMANDS_NOT_CONFIGURED',503)
        if not (key.startswith('sb_secret_') or key.startswith('eyJ')):raise ApiError('INVALID_SERVER_KEY',503)
        self.repo=Repository(settings,'Bearer unused')
        self.repo.headers['apikey']=key
        if key.startswith('sb_secret_'):del self.repo.headers['Authorization']
        else:self.repo.headers['Authorization']='Bearer '+key
    def command(self,owner,action,data):
        return self.repo.rpc('proposal_backend',{'p_owner':owner,'p_action':action,'p_data':data})
    def gmail_inbox(self,owner,action,data):
        return self.repo.rpc('gmail_inbox',{'p_owner':owner,'p_action':action,'p_data':data})

class ProposalWorkflow:
    def __init__(self,settings,gmail,*,store=None,paypal=None):
        self.settings,self.gmail=settings,gmail
        self.store=store
        self.paypal=paypal
        self._gmail_sync_guard=threading.Lock()
        self._gmail_sync_state={}

    def _claim_gmail_sync(self,owner,project_id):
        key=(str(owner),str(project_id));now=time.monotonic();window=30
        with self._gmail_sync_guard:
            for stale,(lock,started) in list(self._gmail_sync_state.items()):
                if now-started>120 and not lock.locked():self._gmail_sync_state.pop(stale,None)
            entry=self._gmail_sync_state.get(key)
            if entry:
                lock,started=entry
                if lock.locked():raise ApiError('GMAIL_SYNC_IN_PROGRESS',409)
                if now-started<window:raise ApiError('GMAIL_SYNC_RATE_LIMITED',429)
            else:lock=threading.Lock()
            if not lock.acquire(blocking=False):raise ApiError('GMAIL_SYNC_IN_PROGRESS',409)
            self._gmail_sync_state[key]=(lock,now)
        return key,lock
    def backend(self):return self.store if self.store is not None else BackendStore(self.settings)
    def provider(self):
        if self.paypal is not None:return self.paypal
        config=SandboxSettings.from_env()
        if config.environment!='sandbox':raise ApiError('LIVE_PAYMENTS_DISABLED',503)
        if not all((config.client_id,config.client_secret,config.merchant_id)):raise ApiError('PAYPAL_SANDBOX_NOT_CONFIGURED',503)
        return PayPalSandboxClient(config.client_id,config.client_secret,config.merchant_id)
    def context(self,repo,proposal_id,revision_id,kind,*,allow_unreviewed=False):
        if not self.gmail:raise ApiError('GMAIL_NOT_CONFIGURED',503)
        snapshot=repo.get_revision(proposal_id,revision_id,collections=('artifacts','reviews')+(('payments',) if kind=='payment' else ()))
        proposal,revision=snapshot['proposal'],snapshot['revision']
        if proposal['current_revision_id']!=revision_id:raise ApiError('PROPOSAL_REVISION_CONFLICT',409)
        if proposal.get('locked_at'):raise ApiError('CHANGE_READ_ONLY',409)
        project=repo.project(proposal['project_id'])
        clients=repo.rows('clients',{'select':'name,contact_email','id':'eq.'+project['client_id']})
        if not clients or not clients[0]['contact_email']:raise ApiError('CLIENT_EMAIL_REQUIRED',409)
        client=clients[0]
        draft_preview=allow_unreviewed and kind=='adenda' and not snapshot['reviews']
        if len(snapshot['artifacts'])!=1 or (len(snapshot['reviews'])!=1 and not draft_preview):raise ApiError('PROPOSAL_REVIEW_REQUIRED',409)
        artifact=snapshot['artifacts'][0]
        doc=repo.document(artifact['document_id'])
        content=repo.download(doc)
        if sha256(content).hexdigest()!=artifact['sha256']:raise ApiError('PROPOSAL_PDF_HASH_MISMATCH',409)
        attachment=PdfAttachment(doc['original_filename'],content,artifact['sha256'])
        amount=f'{revision["additional_minor"]//100}.{revision["additional_minor"]%100:02d}'
        if kind=='adenda':
            if proposal['status']!='ready_for_review' and not (draft_preview and proposal['status']=='draft'):raise ApiError('PROPOSAL_NOT_READY_FOR_EMAIL',409)
            item=ProposalEmail(proposal_id,client['contact_email'],client['name'],project['name'],revision['scope_summary'],amount,'USD',revision['deadline'],attachment)
        elif kind=='payment':
            if proposal['status']!='accepted':raise ApiError('ACCEPTANCE_REQUIRED',409)
            payments=snapshot['payments']
            if not payments or payments[0]['status']!='pending_approval':raise ApiError('PAYMENT_NOT_READY',409)
            pay=payments[0]
            item=PaymentEmail(pay['id'],client['contact_email'],client['name'],project['name'],amount,'USD',pay['approval_url'],attachment)
        else:raise ApiError('INVALID_MAIL_KIND',422)
        return snapshot,item
    def prepare_email(self,repo,owner,proposal_id,revision_id,kind,*,for_preview=False):
        snapshot,item=self.context(repo,proposal_id,revision_id,kind,allow_unreviewed=for_preview)
        status=self.gmail.status(owner)
        if not status['connected']:raise ApiError('GMAIL_NOT_CONNECTED',409)
        sender=status['email']
        message=(build_proposal_email if kind=='adenda' else build_payment_email)(sender,item,'preview')
        canonical=asdict(item);canonical['agreement']={'filename':item.agreement.filename,'sha256':item.agreement.sha256}
        canonical.update(sender=sender,revision_id=revision_id,kind=kind)
        digest=sha256(json.dumps(canonical,sort_keys=True).encode()).hexdigest()
        return item,{'sender':sender,'recipient':item.recipient_email,'subject':str(message['Subject']),'body':message.get_body(preferencelist=('plain',)).get_content(),'document_id':snapshot['artifacts'][0]['document_id'],'filename':item.agreement.filename,'sha256':item.agreement.sha256,'digest':digest}
    def preview(self,repo,owner,proposal_id,revision_id,kind):
        return self.prepare_email(repo,owner,proposal_id,revision_id,kind,for_preview=True)[1]
    def send(self,repo,owner,proposal_id,revision_id,kind,digest):
        item,preview=self.prepare_email(repo,owner,proposal_id,revision_id,kind)
        if not secrets.compare_digest(preview['digest'],digest):raise ApiError('EMAIL_PREVIEW_CHANGED',409)
        store=self.backend()
        data={'proposal_id':proposal_id,'revision_id':revision_id,'kind':kind,'recipient':preview['recipient'],'message_hash':digest}
        claim=store.command(owner,'mail_reserve',data)
        if not claim['acquired']:
            if claim['status']=='accepted_by_gmail':return claim
            raise ApiError('EMAIL_DELIVERY_UNCERTAIN' if claim['status'] in('sending','delivery_uncertain') else 'EMAIL_PREVIOUSLY_FAILED',409)
        try:
            result=self.gmail.send(owner,item,claim['id'],proposal=kind=='adenda',expected_sender=preview['sender'])
        except EmailDeliveryError as error:
            store.command(owner,'mail_finish',{**data,'delivery_id':claim['id'],'status':'delivery_uncertain' if error.uncertain else 'failed','error_code':error.code})
            raise ApiError(error.code,503) from None
        try:
            return store.command(owner,'mail_finish',{**data,'delivery_id':claim['id'],**result})
        except ApiError:
            raise ApiError('EMAIL_DELIVERY_UNCERTAIN',503) from None

    @staticmethod
    def _addresses(value):
        if not isinstance(value,str):return []
        return [address.lower() for _,address in getaddresses([value]) if address and len(address)<=320]

    @staticmethod
    def _normal_message_id(value):
        if not isinstance(value,str):return ''
        return value.strip().strip('<>').lower()

    def sync_gmail_replies(self,repo,owner,project_id):
        if not self.gmail:raise ApiError('GMAIL_NOT_CONFIGURED',503)
        connection=self.gmail.status(owner)
        if not connection['connected']:raise ApiError('GMAIL_NOT_CONNECTED',409)
        if not connection.get('can_read'):raise ApiError('GMAIL_READ_PERMISSION_REQUIRED',409)
        sync_key,sync_lock=self._claim_gmail_sync(owner,project_id)
        try:
            targets=self.backend().gmail_inbox(owner,'targets',{'project_id':project_id})
            synced=0;refreshed=0
            for target in targets[:5]:
                if synced>=25:break
                thread=self.gmail.read_thread(owner,target['provider_thread_id'])
                messages=thread['messages']
                sent=next((message for message in messages if message.get('id')==target['provider_message_id']),None)
                if sent is None or str(sent.get('threadId',''))!=target['provider_thread_id']:
                    continue
                sent_header=self._normal_message_id(self.gmail._header(sent,'Message-ID'))
                if not sent_header:continue
                self.backend().gmail_inbox(owner,'record_sent_header',{'delivery_id':target['delivery_id'],
                    'provider_thread_id':target['provider_thread_id'],'provider_rfc_message_id':sent_header})
                try:sent_at=datetime.fromisoformat(target['sent_at'].replace('Z','+00:00'))
                except (ValueError,TypeError,AttributeError):raise ApiError('GMAIL_DELIVERY_DATE_INVALID',502)
                candidates=[]
                for message in messages:
                    message_id=message.get('id')
                    if not isinstance(message_id,str) or message_id==target['provider_message_id'] or str(message.get('threadId',''))!=target['provider_thread_id']:
                        continue
                    try:received_at=datetime.fromtimestamp(int(message.get('internalDate'))/1000,tz=timezone.utc)
                    except (ValueError,TypeError,OverflowError):continue
                    if received_at<=sent_at:continue
                    from_header=self.gmail._header(message,'From')
                    to_header=' '.join((self.gmail._header(message,'To'),self.gmail._header(message,'Cc')))
                    from_addresses=self._addresses(from_header);to_addresses=self._addresses(to_header)
                    if len(from_addresses)!=1 or from_addresses[0]!=target['client_email'].lower() or connection['email'].lower() not in to_addresses:
                        continue
                    in_reply_to=self.gmail._header(message,'In-Reply-To')[:998]
                    references=' '.join(self.gmail._header(message,'References').split())[:4000]
                    reference_ids={self._normal_message_id(item) for item in re.findall(r'<[^<>\s]{1,500}>',in_reply_to+' '+references)}
                    if sent_header not in reference_ids:continue
                    candidates.append((message,received_at,from_addresses[0],to_addresses,in_reply_to,references))
                known=self.backend().gmail_inbox(owner,'known',{'delivery_id':target['delivery_id'],
                    'provider_message_ids':[candidate[0]['id'] for candidate in candidates]})
                known=set(known if isinstance(known,list) else [])
                for message,received_at,from_email,to_addresses,in_reply_to,references in candidates:
                    if synced>=25:break
                    content=self.gmail.message_content(message)
                    if message['id'] in known and (not content['attachments'] or refreshed>=25):continue
                    if not content['body_text'].strip() and not content['attachments']:continue
                    body=content['body_text']
                    record={'project_id':project_id,'delivery_id':target['delivery_id'],'provider_thread_id':target['provider_thread_id'],
                            'provider_message_id':message['id'],'mailbox_email':connection['email'].lower(),'from_email':from_email,
                            'provider_rfc_message_id':sent_header,
                            'to_emails':sorted(set(to_addresses)),'subject':self.gmail._header(message,'Subject')[:1000],
                            'received_at':received_at.isoformat(),'in_reply_to':in_reply_to,'references_header':references,
                            'body_text':body,'body_sha256':sha256(body.encode('utf-8')).hexdigest(),
                            'attachment_metadata':content['attachments']}
                    self.backend().gmail_inbox(owner,'record',record)
                    if message['id'] in known:refreshed+=1
                    else:synced+=1
            return {'synced':synced}
        finally:
            sync_lock.release()

    def gmail_replies(self,owner,project_id,proposal_id):
        messages=self.backend().gmail_inbox(owner,'list',{'project_id':project_id,'proposal_id':proposal_id})
        return [{**message,'reply_text':reply_text(message['body_text'])} for message in messages]
    @staticmethod
    def instruction(pay):
        return PaymentInstruction(pay['id'],f'{pay["amount_minor"]//100}.{pay["amount_minor"]%100:02d}',pay['currency'],pay['merchant_id'])
    def apply(self,pay,order):
        client=self.provider()
        state=client.validate_order(order,self.instruction(pay))
        if pay.get('order_id') and order['id']!=pay['order_id']:raise ApiError('PAYMENT_EVIDENCE_MISMATCH',409)
        captures=order['purchase_units'][0].get('payments',{}).get('captures',[])
        return self.backend().command(pay['owner_id'],'payment_apply',{'payment_id':pay['id'],'status':state,'order_id':order['id'],'capture_id':captures[0]['id'] if captures else None,'approval_url':client.approval_url(order),'amount_minor':pay['amount_minor'],'currency':pay['currency'],'merchant_id':pay['merchant_id']})
    def prepare_payment(self,repo,owner,proposal_id,revision_id):
        # Resolve owner/revision before making any provider request.
        snapshot=repo.get_revision(proposal_id,revision_id,collections=())
        if snapshot['proposal']['current_revision_id']!=revision_id:raise ApiError('PROPOSAL_REVISION_CONFLICT',409)
        client=self.provider()
        merchant=SandboxSettings.from_env().merchant_id
        pay=self.backend().command(owner,'payment_prepare',{'proposal_id':proposal_id,'revision_id':revision_id,'merchant_id':merchant,'token':secrets.token_urlsafe(32)})
        if not pay['acquired']:
            if not pay['order_id']:raise ApiError('ORDER_REFERENCE_UNCERTAIN',409)
            return pay
        origin=self.settings.web_origin.rstrip('/')
        callback=origin+'/paypal-payment.html?'+urlencode({'checkout':pay['checkout_token']})
        try:
            order=client.create_order(self.instruction(pay),'p-'+pay['id'].replace('-',''),callback+'&result=return',callback+'&result=cancel')
            return self.apply(pay,order)
        except PayPalError as error:
            self.backend().command(owner,'payment_uncertain',{'payment_id':pay['id'],'error_code':error.code})
            raise ApiError(error.code,error.status) from None
    def checkout(self,token,capture=False):
        if not isinstance(token,str) or len(token)!=43:raise ApiError('PAYMENT_NOT_FOUND',404)
        pay=self.backend().command(None,'checkout',{'token':token})
        if pay['status']=='completed':return self.public_payment(pay)
        if not pay['order_id']:raise ApiError('ORDER_REFERENCE_UNCERTAIN',409)
        client=self.provider()
        try:
            pay=self.apply(pay,client.get_order(pay['order_id']))
            if capture and pay['status']=='approved':
                pay=self.backend().command(pay['owner_id'],'capture_claim',{'payment_id':pay['id']})
                client.capture_order(pay['order_id'],'c-'+pay['id'].replace('-',''))
                pay=self.apply(pay,client.get_order(pay['order_id']))
            return self.public_payment(pay)
        except PayPalError as error:
            self.backend().command(pay['owner_id'],'payment_uncertain',{'payment_id':pay['id'],'error_code':error.code})
            raise ApiError(error.code,error.status) from None
    @staticmethod
    def public_payment(pay):
        return {key:pay.get(key) for key in ('id','status','order_id','capture_id','amount_minor','currency')}
