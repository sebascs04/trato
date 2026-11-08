"""Human-reviewed settlement documents. External effects require explicit HTTP actions."""
from dataclasses import replace
from datetime import datetime, timezone
from email.utils import getaddresses
from hashlib import sha256
import json
import os
import secrets
import threading

from paypal.client import exact_amount, PayPalError
from paypal.email import PdfAttachment, EmailDeliveryError, valid_email
from ..errors import ApiError
from ..gmail.vault import GmailError
from ..proposals.workflow import BackendStore, ProposalWorkflow
from .mail import SettlementEmail, build_settlement_email
from .pdf import RefundPdfService


class RefundBackendStore(BackendStore):
    def command(self,owner,action,data):
        return self.repo.rpc('refund_backend',{'p_owner':str(owner),'p_action':action,'p_data':data})


class RefundWorkflow:
    def __init__(self,settings,gmail,*,store=None,paypal=None):
        self.settings,self.gmail,self.store,self.paypal=settings,gmail,store,paypal
        self._sync=threading.Lock()

    def backend(self):return self.store if self.store is not None else RefundBackendStore(self.settings)

    def gmail_call(self,name,*args):
        if self.gmail is None:raise ApiError('GMAIL_NOT_CONNECTED',409)
        try:return getattr(self.gmail,name)(*args)
        except GmailError as error:raise ApiError(error.code,error.status) from None

    def pdf(self,repo,owner,parent,snapshot,language,key):
        return RefundPdfService(self.backend).save(repo,owner,parent,snapshot,language,key)

    def register_initial(self,repo,owner,project_id,data,key):
        project=repo.project(project_id)
        clients=repo.rows('clients',{'select':'contact_email','id':'eq.'+project['client_id']})
        if len(clients)!=1 or not clients[0].get('contact_email'):raise ApiError('REFUND_PAYER_MISMATCH',409)
        expected_payer=clients[0]['contact_email']
        # Explicit private test identity, scoped to a server-authenticated owner.
        # Communication addresses remain unchanged. Never enable this for live.
        bindings=os.getenv('TRATO_SANDBOX_INITIAL_PAYER_BINDINGS','')
        if bindings:
            try:
                mapping=json.loads(bindings)
                if os.getenv('PAYPAL_ENVIRONMENT')!='sandbox' or not isinstance(mapping,dict):raise ValueError()
                if any(not isinstance(email,str) or not valid_email(email) for email in mapping.values()):raise ValueError()
            except (ValueError,TypeError):
                raise ApiError('REFUND_SANDBOX_BINDING_INVALID',503) from None
            if str(owner) in mapping:expected_payer=mapping[str(owner)]
        client=self.paypal or ProposalWorkflow(self.settings,None).provider()
        try:
            order=client.get_order(data['order_id']);capture=client.get_capture(data['capture_id'])
        except PayPalError as error:
            raise ApiError(error.code,error.status) from None
        if not isinstance(order,dict) or not isinstance(capture,dict) or order.get('status')!='COMPLETED':
            raise ApiError('REFUND_PAYMENT_CONTEXT_MISMATCH',409)
        reference='initial-'+project_id
        units=order.get('purchase_units')
        if not isinstance(units,list):raise ApiError('REFUND_PAYMENT_CONTEXT_MISMATCH',409)
        matches=[]
        for candidate in units:
            if not isinstance(candidate,dict) or not isinstance(candidate.get('payments'),dict):continue
            captures=candidate['payments'].get('captures')
            if isinstance(captures,list) and any(isinstance(c,dict) and c.get('id')==data['capture_id'] for c in captures):matches.append(candidate)
        unit=matches[0] if len(matches)==1 else None
        if order.get('id')!=data['order_id'] or not unit or unit.get('custom_id')!=reference or unit.get('reference_id')!=reference:
            raise ApiError('REFUND_INITIAL_REFERENCE_REQUIRED',409)
        payee=unit.get('payee');money=capture.get('amount');payer=order.get('payer')
        if capture.get('id')!=data['capture_id'] or capture.get('status')!='COMPLETED' or not isinstance(payee,dict) or payee.get('merchant_id')!=client.merchant_id or not isinstance(money,dict) or money.get('currency_code')!='USD':
            raise ApiError('REFUND_PAYMENT_CONTEXT_MISMATCH',409)
        if not isinstance(payer,dict) or not isinstance(payer.get('email_address'),str) or payer['email_address'].lower()!=expected_payer.lower():raise ApiError('REFUND_PAYER_MISMATCH',409)
        try:amount=int(exact_amount(money.get('value'))*100)
        except PayPalError:raise ApiError('REFUND_PAYMENT_CONTEXT_MISMATCH',409) from None
        return self.backend().command(owner,'register_initial',{
            'project_id':project_id,'capture_id':data['capture_id'],'order_id':data['order_id'],
            'amount_minor':amount,'merchant_id':client.merchant_id,'notes':data['notes'],
            'evidence':data['evidence'],'operation_key':key})

    def context(self,repo,parent,snapshot,*,data=None):
        if data is None:data=repo.snapshot(parent,snapshot)
        if data['settlement']['current_snapshot_id']!=snapshot:raise ApiError('REFUND_REVISION_CONFLICT',409)
        if len(data['artifacts'])!=1 or not data['artifacts'][0]['document_id']:raise ApiError('REFUND_PDF_REQUIRED',409)
        artifact=data['artifacts'][0];document=repo.document(artifact['document_id']);content=repo.download(document)
        if sha256(content).hexdigest()!=artifact['sha256']:raise ApiError('REFUND_PDF_HASH_MISMATCH',409)
        project=repo.project(data['settlement']['project_id']);clients=repo.rows('clients',{'select':'contact_email','id':'eq.'+project['client_id']})
        if len(clients)!=1:raise ApiError('CLIENT_NOT_FOUND',404)
        if self.gmail is None:raise ApiError('GMAIL_NOT_CONNECTED',409)
        status=self.gmail_call('status',data['settlement']['owner_id'])
        if not status.get('connected'):raise ApiError('GMAIL_NOT_CONNECTED',409)
        item=SettlementEmail(clients[0]['contact_email'],artifact['render_context']['project_name'],data['snapshot']['version_no'],artifact['language'],data['snapshot']['breakdown']['refund_minor'],PdfAttachment(document['original_filename'],content,artifact['sha256']))
        return data,item,status['email']

    @staticmethod
    def prepared_preview(data,item,sender,snapshot):
        message=build_settlement_email(sender,item,'00000000-0000-4000-8000-000000000000')
        preview={'sender':sender,'recipient':item.recipient_email,'subject':str(message['Subject']),
                 'body':message.get_body(preferencelist=('plain',)).get_content(),'document_id':data['artifacts'][0]['document_id'],
                 'filename':item.agreement.filename,'sha256':item.agreement.sha256,'snapshot_id':snapshot}
        if item.note:preview['note']=item.note
        preview['digest']=sha256(json.dumps(preview,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
        return preview

    def preview(self,repo,owner,parent,snapshot,note=''):
        data,item,sender=self.context(repo,parent,snapshot)
        return self.prepared_preview(data,replace(item,note=note),sender,snapshot)

    def send(self,repo,owner,parent,snapshot,digest,key,note=''):
        data=repo.snapshot(parent,snapshot)
        existing=next((m for m in data['deliveries'] if m['operation_key']==key),None)
        if existing:
            if not secrets.compare_digest(existing['message_hash'],digest):raise ApiError('EMAIL_PREVIEW_CHANGED',409)
            return self.recorded_send(repo,parent,existing)
        data,item,sender=self.context(repo,parent,snapshot,data=data)
        item=replace(item,note=note)
        preview=self.prepared_preview(data,item,sender,snapshot)
        if not secrets.compare_digest(preview['digest'],digest):raise ApiError('EMAIL_PREVIEW_CHANGED',409)
        command={'settlement_id':parent,'snapshot_id':snapshot,'operation_key':key,'recipient':preview['recipient'],'sender':sender,'message_hash':digest,'preview':preview}
        claim=self.backend().command(owner,'mail_reserve',command)
        if not claim['acquired']:return self.recorded_send(repo,parent,claim)
        try:result=self.gmail.send_refund(owner,item,claim['id'],expected_sender=sender)
        except EmailDeliveryError as error:
            try:
                self.backend().command(owner,'mail_finish',{'settlement_id':parent,'snapshot_id':snapshot,'delivery_id':claim['id'],'status':'delivery_uncertain' if error.uncertain else 'failed','error_code':error.code})
            except ApiError:raise ApiError('EMAIL_DELIVERY_UNCERTAIN',503) from None
            if error.uncertain:raise ApiError('EMAIL_DELIVERY_UNCERTAIN',503) from None
            raise ApiError(error.code,409) from None
        try:delivery=self.backend().command(owner,'mail_finish',{'settlement_id':parent,'snapshot_id':snapshot,'delivery_id':claim['id'],**result})
        except ApiError:raise ApiError('EMAIL_DELIVERY_UNCERTAIN',503) from None
        return {'settlement':repo.settlement(parent),'delivery':delivery}

    @staticmethod
    def recorded_send(repo,parent,delivery):
        if delivery['status']=='accepted_by_gmail':return {'settlement':repo.settlement(parent),'delivery':delivery}
        if delivery['status']=='failed':raise ApiError(delivery.get('error_code') or 'GMAIL_SEND_FAILED',409)
        raise ApiError('EMAIL_DELIVERY_UNCERTAIN',409)

    def reconcile_send(self,repo,owner,parent,snapshot,key):
        data=repo.snapshot(parent,snapshot)
        delivery=next((m for m in data['deliveries'] if m['operation_key']==key),None)
        if not delivery:raise ApiError('REFUND_DELIVERY_NOT_FOUND',404)
        if delivery['status'] in ('accepted_by_gmail','failed'):
            return {'state':'confirmed','result':{'settlement':repo.settlement(parent),'delivery':delivery}}
        data,item,sender=self.context(repo,parent,snapshot,data=data)
        if sender.lower()!=delivery['sender'].lower():raise ApiError('GMAIL_SENDER_CHANGED',409)
        message=self.gmail_call('find_refund_sent',owner,delivery['id'])
        if message is None:return {'state':'unconfirmed'}
        expected=build_settlement_email(delivery['sender'],replace(item,recipient_email=delivery['recipient'],note=delivery.get('message_preview',{}).get('note','')),delivery['id'])
        address=lambda name:{email.lower() for _,email in getaddresses([self.gmail._header(message,name)])}
        content=self.gmail_call('message_content',message)
        from email.header import decode_header,make_header
        subject=str(make_header(decode_header(self.gmail._header(message,'Subject'))))
        if self.gmail._header(message,'Message-ID')!=str(expected['Message-ID']) or subject!=str(expected['Subject']) or address('From')!={delivery['sender'].lower()} or address('To')!={delivery['recipient'].lower()} or content['body_text'].replace('\r\n','\n').strip()!=expected.get_body(preferencelist=('plain',)).get_content().replace('\r\n','\n').strip():
            raise ApiError('REFUND_EVIDENCE_MISMATCH',409)
        attachments=content['attachments']
        if len(attachments)!=1 or not attachments[0].get('supported') or attachments[0]['filename']!=item.agreement.filename:raise ApiError('REFUND_EVIDENCE_MISMATCH',409)
        raw=self.gmail_call('read_attachment',owner,message['id'],attachments[0]['attachment_id'])
        if sha256(raw).hexdigest()!=item.agreement.sha256:raise ApiError('REFUND_PDF_HASH_MISMATCH',409)
        result=self.backend().command(owner,'mail_finish',{'settlement_id':parent,'snapshot_id':snapshot,'delivery_id':delivery['id'],'status':'accepted_by_gmail','message_id':message['id'],'thread_id':message.get('threadId')})
        return {'state':'confirmed','result':{'settlement':repo.settlement(parent),'delivery':result}}

    def sync(self,repo,owner,parent,snapshot):
        if self.gmail is None:raise ApiError('GMAIL_NOT_CONNECTED',409)
        if not self._sync.acquire(blocking=False):raise ApiError('GMAIL_SYNC_IN_PROGRESS',409)
        try:
            data=repo.snapshot(parent,snapshot);known={r['provider_message_id'] for r in data['responses']};count=0
            for delivery in data['deliveries']:
                if delivery['status']!='accepted_by_gmail':continue
                if not delivery['provider_thread_id']:raise ApiError('REFUND_THREAD_UNAVAILABLE',409)
                if self.gmail_call('status',owner).get('email','').lower()!=delivery['sender'].lower():raise ApiError('GMAIL_SENDER_CHANGED',409)
                thread=self.gmail_call('read_thread',owner,delivery['provider_thread_id'])
                import re
                sent=[m for m in thread['messages'] if m.get('id')==delivery.get('provider_message_id') and m.get('threadId')==delivery['provider_thread_id']]
                if len(sent)!=1:raise ApiError('REFUND_SENT_MESSAGE_UNAVAILABLE',409)
                sent_addresses=lambda name:{email.lower() for _,email in getaddresses([self.gmail._header(sent[0],name)])}
                expected=self.gmail._header(sent[0],'Message-ID').strip()
                if not re.fullmatch(r'<[^<>\s]{1,500}>',expected) or sent_addresses('From')!={delivery['sender'].lower()} or sent_addresses('To')!={delivery['recipient'].lower()}:
                    raise ApiError('REFUND_SENT_MESSAGE_UNAVAILABLE',409)
                for message in thread['messages']:
                    if message.get('id') in known or message.get('threadId')!=delivery['provider_thread_id']:continue
                    addresses=lambda name:{email.lower() for _,email in getaddresses([self.gmail._header(message,name)])}
                    immediate=re.findall(r'<[^<>\s]{1,500}>',self.gmail._header(message,'In-Reply-To'))
                    references=re.findall(r'<[^<>\s]{1,500}>',self.gmail._header(message,'References'))
                    if (immediate!=[expected] if immediate else not references or references[-1]!=expected) or addresses('From')!={delivery['recipient'].lower()} or addresses('To')!={delivery['sender'].lower()}:continue
                    try:received=datetime.fromtimestamp(int(message['internalDate'])/1000,timezone.utc)
                    except (KeyError,ValueError,OverflowError,TypeError):continue
                    if received<datetime.fromisoformat(delivery['created_at'].replace('Z','+00:00')):continue
                    content=self.gmail_call('message_content',message)
                    if not content['body_text'].strip() and not content['attachments']:continue
                    self.backend().command(owner,'response_record',{'settlement_id':parent,'snapshot_id':snapshot,'delivery_id':delivery['id'],
                        'provider_message_id':message['id'],'from_email':delivery['recipient'],'body_text':content['body_text'],
                        'received_at':received.isoformat(),'attachments':content['attachments'],'raw_message':message})
                    known.add(message['id']);count+=1
                    if count>=25:return {'synced':count}
            return {'synced':count}
        finally:self._sync.release()

    def attachment(self,repo,owner,parent,response_id,index,*,import_file=False,key=None):
        data=repo.detail(parent)
        rows=repo.rows('refund_client_responses',{'select':'*','settlement_id':'eq.'+parent,'id':'eq.'+response_id})
        if not rows:raise ApiError('REFUND_EVIDENCE_MISMATCH',404)
        response=rows[0]
        deliveries=repo.rows('refund_deliveries',{'select':'sender','settlement_id':'eq.'+parent,'id':'eq.'+response['delivery_id']})
        if len(deliveries)!=1:raise ApiError('REFUND_EVIDENCE_MISMATCH',409)
        if self.gmail_call('status',owner).get('email','').lower()!=deliveries[0]['sender'].lower():raise ApiError('GMAIL_SENDER_CHANGED',409)
        if not 0<=index<len(response['attachments']):raise ApiError('GMAIL_ATTACHMENT_NOT_FOUND',404)
        metadata=response['attachments'][index]
        if not metadata.get('supported'):raise ApiError('GMAIL_ATTACHMENT_UNSUPPORTED',415)
        if self.gmail is None:raise ApiError('GMAIL_NOT_CONNECTED',409)
        content=self.gmail_call('read_attachment',owner,response['provider_message_id'],metadata['attachment_id'])
        if not import_file:return content,metadata['filename']
        document=repo.reserve(data['settlement']['project_id'],f"Gmail refund {response_id} {index+1}",'reference',metadata['filename'],'application/pdf',content,'refund-attachment-'+response_id+'-'+str(index),
            context={'purpose':'refund_evidence','refund_case_id':parent,'snapshot_id':response['snapshot_id']})['document']
        repo.upload(document,content);repo.queue_document(document['id'])
        return {'document_id':document['id'],'sha256':document['sha256']}
