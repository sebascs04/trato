"""Separate proposed outbox protocol. P2 owns its persistent implementation."""
from dataclasses import dataclass
import hashlib
import json
from typing import Protocol
from .email import PaymentEmail, PdfAttachment, EmailDeliveryError, validate_pdf_attachment
from .repository import PaymentRecord
from .client import exact_amount, PayPalError


@dataclass(frozen=True)
class AgreementEmailDocument:
    document_id:str
    owner_id:str
    project_id:str
    acceptance_id:str
    agreement_version_id:str
    attachment:PdfAttachment


@dataclass(frozen=True)
class NotificationContext:
    payment:PaymentRecord
    recipient_email:str
    recipient_name:str
    project_name:str
    agreement:AgreementEmailDocument|None=None


@dataclass(frozen=True)
class NotificationClaim:
    notification_id:str
    state:str  # acquired / accepted_by_smtp / accepted_by_gmail / in_progress / delivery_uncertain
    lease_token:str|None=None
    revision:int=0


class NotificationRepository(Protocol):
    def resolve_email_context(self,user_id:str,payment_id:str)->NotificationContext:
        """Authorize owner and resolve current designated client contact from DB.
        Payment must be connected, pending_approval and have a provider approval URL.
        Optional agreement must be the authorized immutable PDF for this exact acceptance.
        Download from private storage server-side; never accept a browser URL/path.
        """
    def reserve_notification(self,user_id:str,payment_id:str,idempotency_key:str,message_hash:str)->NotificationClaim:
        """Atomic outbox reservation + payload hash + fenced lease. Different message on
        same key is conflict. Never reclaim a delivery_uncertain lease for blind resend.
        """
    def start_delivery(self,notification_id:str,*,lease_token:str,expected_revision:int)->NotificationClaim:
        """Fence and persist sending BEFORE SMTP, returning the updated revision.
        Expired sending lease is delivery_uncertain, not eligible for automatic resend.
        Crash before SMTP may require manual review; prefer that to duplicate delivery.
        """
    def finish_notification(self,notification_id:str,result:dict,*,lease_token:str,expected_revision:int)->None:
        """CAS/fence and append history in a transaction. accepted_by_smtp does NOT mean
        delivered/read. Lost connection after DATA => delivery_uncertain, review first.
        """


class PaymentNotificationService:
    def __init__(self,repository,mailer):self.repo,self.mailer=repository,mailer
    def send(self,user_id,payment_id,key):
        if not isinstance(key,str) or not 1<=len(key)<=128 or any(ord(c)<33 or ord(c)>126 for c in key):raise EmailDeliveryError('INVALID_IDEMPOTENCY_KEY')
        context=self.repo.resolve_email_context(user_id,payment_id)
        p=context.payment
        if p.acceptance.owner_id!=user_id or p.id!=payment_id:raise EmailDeliveryError('PAYMENT_NOT_FOUND')
        if p.acceptance.mode!='connected' or p.status!='pending_approval' or not p.approval_url:raise EmailDeliveryError('PAYMENT_NOT_READY_FOR_EMAIL')
        try:exact_amount(p.acceptance.amount)
        except PayPalError:raise EmailDeliveryError('PAYMENT_NOT_REQUIRED' if p.acceptance.amount=='0.00' else 'INVALID_AMOUNT')
        document=context.agreement
        if document is not None:
            if (document.owner_id,document.project_id,document.acceptance_id,document.agreement_version_id)!=(user_id,p.acceptance.project_id,p.acceptance.acceptance_id,p.acceptance.agreement_version_id):raise EmailDeliveryError('AGREEMENT_DOCUMENT_MISMATCH')
            validate_pdf_attachment(document.attachment)
        item=PaymentEmail(p.id,context.recipient_email,context.recipient_name,context.project_name,p.acceptance.amount,p.acceptance.currency,p.approval_url,document.attachment if document else None)
        command={k:v for k,v in item.__dict__.items() if k!='agreement'}
        command['agreement']={'document_id':document.document_id,'version_id':document.agreement_version_id,'filename':document.attachment.filename,'sha256':document.attachment.sha256} if document else None
        command=json.dumps(command,sort_keys=True)
        claim=self.repo.reserve_notification(user_id,p.id,key,hashlib.sha256(command.encode()).hexdigest())
        if claim.state in ('accepted_by_smtp','accepted_by_gmail'):return {'status':claim.state,'duplicate':True,'notification_id':claim.notification_id}
        if claim.state=='delivery_uncertain':raise EmailDeliveryError('EMAIL_DELIVERY_UNCERTAIN',uncertain=True)
        if claim.state!='acquired' or not claim.lease_token:raise EmailDeliveryError('EMAIL_IN_PROGRESS')
        claim=self.repo.start_delivery(claim.notification_id,lease_token=claim.lease_token,expected_revision=claim.revision)
        if not claim.lease_token:raise EmailDeliveryError('EMAIL_LEASE_LOST')
        try:
            result=self.mailer.send(item,claim.notification_id)
        except EmailDeliveryError as error:
            self.repo.finish_notification(claim.notification_id,{'status':'delivery_uncertain' if error.uncertain else 'failed','code':error.code},lease_token=claim.lease_token,expected_revision=claim.revision)
            raise
        self.repo.finish_notification(claim.notification_id,result,lease_token=claim.lease_token,expected_revision=claim.revision)
        return {**result,'notification_id':claim.notification_id}
