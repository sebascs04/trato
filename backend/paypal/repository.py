"""Transactional contract shared with P2. No in-memory production repository."""
from dataclasses import dataclass
from typing import Literal, Protocol, TypedDict


@dataclass(frozen=True)
class PayableAcceptance:
    owner_id:str
    project_id:str
    acceptance_id:str
    proposal_revision_id:str
    agreement_version_id:str
    amount:str
    currency:str
    merchant_id:str
    mode:str


@dataclass(frozen=True)
class PaymentRecord:
    id:str
    acceptance:PayableAcceptance
    status:str
    create_request_id:str
    capture_request_id:str
    provider_order_id:str|None=None
    provider_capture_id:str|None=None
    approval_url:str|None=None
    updated_at:str=''
    revision:int=0


@dataclass(frozen=True)
class OperationClaim:
    record:PaymentRecord
    acquired:bool
    lease_token:str|None=None
    expires_at:str|None=None


@dataclass(frozen=True)
class WebhookClaim:
    state:Literal['acquired','processed','in_progress']
    lease_token:str|None=None


class VerifiedOrder(TypedDict):
    status:str
    order_id:str
    capture_id:str|None
    approval_url:str|None
    amount:str
    currency:str
    merchant_id:str
    evidence_key:str


class PaymentRepository(Protocol):
    def resolve_payable_acceptance(self,user_id:str,acceptance_id:str)->PayableAcceptance:
        """Verify owner, exact immutable revision and valid acceptance/signature evidence.
        Simulated evidence never authorizes payment. Zero additional => PAYMENT_NOT_REQUIRED.
        """
    def reserve_payment(self,user_id:str,acceptance:PayableAcceptance,idempotency_key:str,command_hash:str)->OperationClaim:
        """Atomic unique reservation by owner/key and acceptance/purpose, with fencing lease.
        Reject another hash on same key. Persist stable provider request IDs and retry deadline.
        Expired create lease may be reclaimed using SAME create_request_id ONLY within the
        provider's documented/configured retention window. Outside it: manual reconciliation,
        never another order. No SQL transaction is held across HTTP.
        """
    def get_payment(self,user_id:str,payment_id:str)->PaymentRecord:
        """404 for missing/not owned; includes persisted updated_at and revision."""
    def claim_capture(self,user_id:str,payment_id:str)->OperationClaim:
        """Fenced lease only for APPROVED with no known capture. PENDING => reconcile,
        never initiate a new capture. An uncertain retry reuses the SAME capture request ID.
        """
    def apply_provider_order(self,payment_id:str,expected_order_id:str|None,verified_result:VerifiedOrder,*,expected_revision:int,lease_token:str|None=None)->PaymentRecord:
        """CAS revision/order reference and fence token when leased; failed CAS => conflict.
        Persist result plus unique history fact keyed by evidence_key in one transaction.
        completed never regresses to approved/pending/uncertain. Reconciliation without a
        lease still requires expected_revision and cannot overwrite newer operations.
        """
    def mark_uncertain(self,payment_id:str,operation:str,code:str,*,expected_revision:int,lease_token:str)->PaymentRecord:
        """Only matching active operation lease/revision; never downgrade completed."""
    def find_by_provider_order(self,order_id:str)->PaymentRecord|None:
        """Private provider lookup, no public arbitrary-owner query."""
    def reserve_webhook(self,event_id:str,event_type:str,order_id:str)->WebhookClaim:
        """Persistent dedupe and fenced lease: processed is acknowledged, in_progress retries."""
    def finish_webhook(self,event_id:str,processed:bool,*,lease_token:str)->None:
        """Fence completion/release. Payment/history already dedupe by evidence_key, so
        crash after apply and before finish can retry without duplicate history/effects.
        """
