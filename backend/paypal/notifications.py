"""Separate proposed outbox protocol. P2 owns its persistent implementation."""
from dataclasses import dataclass
import hashlib
import json
from typing import Protocol
from .email import PaymentEmail, EmailDeliveryError
from .repository import PaymentRecord


@dataclass(frozen=True)
class NotificationContext:
    payment:PaymentRecord
    recipient_email:str
    recipient_name:str
    project_name:str


@dataclass(frozen=True)
class NotificationClaim:
    notification_id:str
    state:str  # acquired / accepted_by_smtp / in_progress / delivery_uncertain
    lease_token:str|None=None
    revision:int=0


class NotificationRepository(Protocol):
    def resolve_email_context(self,user_id:str,payment_id:str)->NotificationContext:
        """Authorize owner and resolve current designated client contact from DB.
        Payment must be connected, pending_approval and have a provider approval URL.
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
        if p.acceptance.owner_id!=user_id:raise EmailDeliveryError('PAYMENT_NOT_FOUND')
        if p.acceptance.mode!='connected' or p.status!='pending_approval' or not p.approval_url:raise EmailDeliveryError('PAYMENT_NOT_READY_FOR_EMAIL')
        item=PaymentEmail(p.id,context.recipient_email,context.recipient_name,context.project_name,p.acceptance.amount,p.acceptance.currency,p.approval_url)
        command=json.dumps(item.__dict__,sort_keys=True)
        claim=self.repo.reserve_notification(user_id,p.id,key,hashlib.sha256(command.encode()).hexdigest())
        if claim.state=='accepted_by_smtp':return {'status':'accepted_by_smtp','duplicate':True,'notification_id':claim.notification_id}
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
