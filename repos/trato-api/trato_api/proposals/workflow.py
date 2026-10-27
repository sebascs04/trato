"""Gmail and PayPal run directly in the HTTP backend, outside the IA worker."""
from dataclasses import asdict
from hashlib import sha256
import json
import os
import secrets
from urllib.parse import urlencode

from paypal.client import PayPalSandboxClient, PaymentInstruction, PayPalError
from paypal.config import SandboxSettings
from paypal.email import ProposalEmail, PaymentEmail, PdfAttachment, EmailDeliveryError, build_proposal_email, build_payment_email
from ..errors import ApiError
from ..persistence import Repository
from ..gmail.service import GmailMailer

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

class ProposalWorkflow:
    def __init__(self,settings,gmail,*,store=None,paypal=None):
        self.settings,self.gmail=settings,gmail
        self.store=store
        self.paypal=paypal
    def backend(self):return self.store if self.store is not None else BackendStore(self.settings)
    def provider(self):
        if self.paypal is not None:return self.paypal
        config=SandboxSettings.from_env()
        if config.environment!='sandbox':raise ApiError('LIVE_PAYMENTS_DISABLED',503)
        if not all((config.client_id,config.client_secret,config.merchant_id)):raise ApiError('PAYPAL_SANDBOX_NOT_CONFIGURED',503)
        return PayPalSandboxClient(config.client_id,config.client_secret,config.merchant_id)
    def context(self,repo,proposal_id,revision_id,kind):
        if not self.gmail:raise ApiError('GMAIL_NOT_CONFIGURED',503)
        snapshot=repo.get_revision(proposal_id,revision_id)
        proposal,revision=snapshot['proposal'],snapshot['revision']
        if proposal['current_revision_id']!=revision_id:raise ApiError('PROPOSAL_REVISION_CONFLICT',409)
        if proposal.get('locked_at'):raise ApiError('CHANGE_READ_ONLY',409)
        project=repo.project(proposal['project_id'])
        clients=repo.rows('clients',{'select':'name,contact_email','id':'eq.'+project['client_id']})
        if not clients or not clients[0]['contact_email']:raise ApiError('CLIENT_EMAIL_REQUIRED',409)
        client=clients[0]
        if len(snapshot['artifacts'])!=1 or len(snapshot['reviews'])!=1:raise ApiError('PROPOSAL_REVIEW_REQUIRED',409)
        artifact=snapshot['artifacts'][0]
        doc=repo.document(artifact['document_id'])
        content=repo.download(doc)
        if sha256(content).hexdigest()!=artifact['sha256']:raise ApiError('PROPOSAL_PDF_HASH_MISMATCH',409)
        attachment=PdfAttachment(doc['original_filename'],content,artifact['sha256'])
        amount=f'{revision["additional_minor"]//100}.{revision["additional_minor"]%100:02d}'
        if kind=='adenda':
            if proposal['status']!='ready_for_review':raise ApiError('PROPOSAL_NOT_READY_FOR_EMAIL',409)
            item=ProposalEmail(proposal_id,client['contact_email'],client['name'],project['name'],revision['scope_summary'],amount,'USD',revision['deadline'],attachment)
        elif kind=='payment':
            if proposal['status']!='accepted':raise ApiError('ACCEPTANCE_REQUIRED',409)
            payments=snapshot['payments']
            if not payments or payments[0]['status']!='pending_approval':raise ApiError('PAYMENT_NOT_READY',409)
            pay=payments[0]
            item=PaymentEmail(pay['id'],client['contact_email'],client['name'],project['name'],amount,'USD',pay['approval_url'],attachment)
        else:raise ApiError('INVALID_MAIL_KIND',422)
        return snapshot,item
    def prepare_email(self,repo,owner,proposal_id,revision_id,kind):
        snapshot,item=self.context(repo,proposal_id,revision_id,kind)
        status=self.gmail.status(owner)
        if not status['connected']:raise ApiError('GMAIL_NOT_CONNECTED',409)
        sender=status['email']
        message=(build_proposal_email if kind=='adenda' else build_payment_email)(sender,item,'preview')
        canonical=asdict(item);canonical['agreement']={'filename':item.agreement.filename,'sha256':item.agreement.sha256}
        canonical.update(sender=sender,revision_id=revision_id,kind=kind)
        digest=sha256(json.dumps(canonical,sort_keys=True).encode()).hexdigest()
        return item,{'sender':sender,'recipient':item.recipient_email,'subject':str(message['Subject']),'body':message.get_body(preferencelist=('plain',)).get_content(),'document_id':snapshot['artifacts'][0]['document_id'],'filename':item.agreement.filename,'sha256':item.agreement.sha256,'digest':digest}
    def preview(self,repo,owner,proposal_id,revision_id,kind):
        return self.prepare_email(repo,owner,proposal_id,revision_id,kind)[1]
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
        snapshot=repo.get_revision(proposal_id,revision_id)
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
