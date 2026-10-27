"""First mail: send a reviewed proposal, without creating acceptance or payment.

Persistence and OAuth are injected by the API; this module has no in-memory fallback.
"""
from dataclasses import dataclass
import hashlib
import json
from typing import Protocol
from .email import ProposalEmail, EmailDeliveryError, validate_proposal_email
from .notifications import NotificationClaim


@dataclass(frozen=True)
class ProposalNotificationContext:
    proposal_id:str
    revision_id:str
    owner_id:str
    project_id:str
    mode:str
    status:str  # ready_for_review: reviewed by freelancer and awaiting client review
    document_id:str
    document_owner_id:str
    document_project_id:str
    document_revision_id:str
    email:ProposalEmail


class ProposalNotificationRepository(Protocol):
    def resolve_proposal_email_context(self,user_id:str,proposal_id:str)->ProposalNotificationContext:
        """Authorize owner; resolve immutable reviewed proposal, client and private PDF."""
    def reserve_proposal_notification(self,user_id:str,proposal_id:str,revision_id:str,idempotency_key:str,message_hash:str)->NotificationClaim:
        """Atomically recheck owner/current revision/status and reserve a proposal email.
        Separate namespace from payment notifications. Same key with different hash
        conflicts. Never reclaim an uncertain send for automatic redelivery.
        """
    def start_delivery(self,notification_id:str,*,lease_token:str,expected_revision:int)->NotificationClaim:
        """Fence lease and persist sending before transport; same outbox rules as payments."""
    def finish_notification(self,notification_id:str,result:dict,*,lease_token:str,expected_revision:int)->None:
        """Persist transport result/history with CAS. Sending never accepts the proposal."""


class ProposalNotificationService:
    def __init__(self,repository,mailer):self.repo,self.mailer=repository,mailer

    def send(self,user_id,proposal_id,key):
        if not isinstance(key,str) or not 1<=len(key)<=128 or any(ord(c)<33 or ord(c)>126 for c in key):raise EmailDeliveryError('INVALID_IDEMPOTENCY_KEY')
        context=self.repo.resolve_proposal_email_context(user_id,proposal_id)
        if context.owner_id!=user_id or context.proposal_id!=proposal_id:raise EmailDeliveryError('PROPOSAL_NOT_FOUND')
        if context.mode!='connected' or context.status!='ready_for_review':raise EmailDeliveryError('PROPOSAL_NOT_READY_FOR_EMAIL')
        if context.email.proposal_id!=proposal_id or (context.document_owner_id,context.document_project_id,context.document_revision_id)!=(user_id,context.project_id,context.revision_id):raise EmailDeliveryError('PROPOSAL_DOCUMENT_MISMATCH')
        item=context.email
        validate_proposal_email(item)
        command={k:v for k,v in item.__dict__.items() if k!='agreement'}
        command.update(kind='proposal_for_review',revision_id=context.revision_id,document_id=context.document_id,filename=item.agreement.filename,sha256=item.agreement.sha256)
        digest=hashlib.sha256(json.dumps(command,sort_keys=True).encode()).hexdigest()
        claim=self.repo.reserve_proposal_notification(user_id,proposal_id,context.revision_id,key,digest)
        if claim.state in ('accepted_by_smtp','accepted_by_gmail'):return {'status':claim.state,'duplicate':True,'notification_id':claim.notification_id}
        if claim.state=='delivery_uncertain':raise EmailDeliveryError('EMAIL_DELIVERY_UNCERTAIN',uncertain=True)
        if claim.state!='acquired' or not claim.lease_token:raise EmailDeliveryError('EMAIL_IN_PROGRESS')
        claim=self.repo.start_delivery(claim.notification_id,lease_token=claim.lease_token,expected_revision=claim.revision)
        if not claim.lease_token:raise EmailDeliveryError('EMAIL_LEASE_LOST')
        try:
            result=self.mailer.send_proposal(item,claim.notification_id)
        except EmailDeliveryError as error:
            self.repo.finish_notification(claim.notification_id,{'status':'delivery_uncertain' if error.uncertain else 'failed','code':error.code},lease_token=claim.lease_token,expected_revision=claim.revision)
            raise
        self.repo.finish_notification(claim.notification_id,result,lease_token=claim.lease_token,expected_revision=claim.revision)
        return {**result,'notification_id':claim.notification_id}
