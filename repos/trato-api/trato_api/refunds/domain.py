"""Pure settlement contract: no AI, persistence, provider or mail operations.

Trusted context must be assembled by the future repository, never from HTTP input.
Amounts are integer USD cents. Citations substantiate review, not legal validity.
"""
from enum import Enum
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_validator

from ..errors import ApiError

MAX_MINOR = 99_999_999_999
Money = Annotated[int, Field(strict=True, ge=0, le=MAX_MINOR)]
PositiveMoney = Annotated[int, Field(strict=True, gt=0, le=MAX_MINOR)]
Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)]
Hash = Annotated[str, StringConstraints(pattern=r'^[a-f0-9]{64}$')]


class Contract(BaseModel):
    model_config = ConfigDict(extra='forbid', frozen=True)


class SettlementStatus(str, Enum):
    DRAFT = 'draft'
    AWAITING_RESPONSE = 'awaiting_response'
    ADJUSTMENTS_REQUESTED = 'adjustments_requested'
    ACCEPTED = 'accepted'
    REFUND_PENDING = 'refund_pending'
    COMPLETED = 'completed'
    CLOSED_WITHOUT_REFUND = 'closed_without_refund'
    REJECTED = 'rejected'
    WITHDRAWN = 'withdrawn'


class RefundStatus(str, Enum):
    RESERVED = 'reserved'
    UNCERTAIN = 'uncertain'
    PENDING = 'pending'
    COMPLETED = 'completed'
    FAILED = 'failed'
    CANCELLED = 'cancelled'


class Citation(Contract):
    document_id: UUID
    extraction_id: UUID
    document_sha256: Hash
    quote: Text


class Source(Contract):
    """Authorized, ready extraction loaded by the repository."""
    document_id: UUID
    extraction_id: UUID
    document_sha256: Hash
    owner_id: UUID
    project_id: UUID
    text: Annotated[str, StringConstraints(min_length=1, max_length=2_000_000)]


class Percentage(Contract):
    base_minor: PositiveMoney
    basis_points: int = Field(strict=True, ge=1, le=10000)

    def amount(self) -> int:
        # Half up to a cent, without binary floating point.
        return (self.base_minor * self.basis_points + 5000) // 10000


class Adjustment(Contract):
    # Stable identity of the underlying economic concept, including across revisions.
    concept_id: UUID
    kind: Literal['recognized_work', 'expense', 'penalty', 'other']
    beneficiary: Literal['seller', 'customer']
    description: Text
    amount_minor: PositiveMoney
    percentage: Percentage | None = None
    evidence: tuple[Citation, ...] = Field(min_length=1, max_length=20)

    @model_validator(mode='after')
    def consistent_amount(self):
        if self.kind == 'recognized_work' and self.beneficiary != 'seller':
            raise ValueError('Recognized work is a seller retention')
        if self.percentage and self.percentage.amount() != self.amount_minor:
            raise ValueError('Percentage and rounded amount disagree')
        return self


class SettlementRequest(Contract):
    payment_id: UUID | None = None
    payment_ids: tuple[UUID, ...] | None = None
    payments_reviewed: bool | None = Field(default=None, strict=True)
    scope: Literal['payment_only', 'project_closure']
    reason: Text
    requested_by: Literal['customer', 'seller', 'mutual']
    request_evidence: tuple[Citation, ...] = Field(min_length=1, max_length=20)

    @model_validator(mode='after')
    def selected_payments(self):
        if self.scope == 'payment_only':
            if self.payment_id is None or self.payment_ids is not None:
                raise ValueError('One payment is required')
        elif self.payments_reviewed is not True or self.payment_id is not None or not self.payment_ids or len(self.payment_ids) > 100 or len(set(self.payment_ids)) != len(self.payment_ids):
            raise ValueError('Distinct project payments are required')
        return self


class Allocation(Contract):
    payment_id: UUID
    refund_minor: Money


class SettlementTerms(Contract):
    currency: Literal['USD']
    # Empty is explicit: no deductions. Missing adjustments must fail validation.
    adjustments: tuple[Adjustment, ...] = Field(max_length=100)
    proposed_refund_minor: Money
    conditions: Text
    allocations: tuple[Allocation, ...] | None = Field(default=None, max_length=100)

    @model_validator(mode='after')
    def distinct_concepts(self):
        ids = [item.concept_id for item in self.adjustments]
        if len(ids) != len(set(ids)):
            raise ValueError('Duplicate economic concept')
        return self


class CaptureContext(Contract):
    """Server-only financial evidence. Not an input DTO for a browser."""
    owner_id: UUID
    project_id: UUID
    payment_id: UUID
    capture_id: Text
    merchant_id: Text
    currency: Literal['USD']
    capture_verified: Literal[True]
    gross_minor: PositiveMoney
    original_fee_minor: Money
    previous_refunds_minor: Money
    provider_remaining_minor: Money
    reserved_minor: Money
    has_open_request: bool = Field(strict=True)

    @field_validator('capture_verified', mode='before')
    @classmethod
    def verified_boolean(cls, value):
        if value is not True:
            raise ValueError('Verified capture evidence is required')
        return value

    @model_validator(mode='after')
    def consistent_balances(self):
        if self.original_fee_minor > self.gross_minor:
            raise ValueError('Invalid original fee')
        if self.previous_refunds_minor > self.gross_minor:
            raise ValueError('Refunded amount exceeds capture')
        if self.provider_remaining_minor != self.gross_minor - self.previous_refunds_minor:
            raise ValueError('Local and provider balances require reconciliation')
        if self.reserved_minor > self.provider_remaining_minor:
            raise ValueError('Reservations exceed remaining capture')
        return self


class Breakdown(Contract):
    currency: Literal['USD'] = 'USD'
    gross_minor: Money
    original_fee_minor: Money
    original_net_minor: Money
    seller_retention_minor: Money
    customer_credit_minor: Money
    previous_refunds_minor: Money
    available_minor: Money
    refund_minor: Money
    additional_payment_due_minor: Money


class DraftBreakdown(Contract):
    """Recorded local facts only; not permission or evidence to move money."""
    currency: Literal['USD'] = 'USD'
    gross_minor: PositiveMoney
    local_previous_refunds_minor: Money
    seller_retention_minor: Money
    customer_credit_minor: Money
    refund_minor: Money
    additional_payment_due_minor: Money
    original_fee_minor: None = None
    provider_remaining_minor: None = None
    provider_verified: Literal[False] = False
    financial_execution_ready: Literal[False] = False


def prepare_settlement(terms: SettlementTerms, gross_minor: int,
                       local_previous_refunds_minor: int) -> DraftBreakdown:
    """Mirror the SQL draft calculation; both inputs are repository facts.

    Evidence/ownership are checked separately against the DB, never by this arithmetic.
    External refunds are unknown until future provider reconciliation.
    """
    # Validate trusted caller programming mistakes as well as the public terms.
    DraftBreakdown(gross_minor=gross_minor, local_previous_refunds_minor=local_previous_refunds_minor,
                   seller_retention_minor=0, customer_credit_minor=0, refund_minor=0,
                   additional_payment_due_minor=0)
    if local_previous_refunds_minor > gross_minor:
        raise ApiError('REFUND_PRIOR_SETTLEMENT_CONFLICT', 409)
    retained = sum(x.amount_minor for x in terms.adjustments if x.beneficiary == 'seller')
    credit = sum(x.amount_minor for x in terms.adjustments if x.beneficiary == 'customer')
    if max(retained, credit) > MAX_MINOR:
        raise ApiError('REFUND_AMOUNT_OVERFLOW', 422)
    entitlement = gross_minor - retained + credit
    if local_previous_refunds_minor and entitlement < local_previous_refunds_minor:
        raise ApiError('REFUND_PRIOR_SETTLEMENT_CONFLICT', 409)
    refund = max(entitlement - local_previous_refunds_minor, 0)
    if refund > gross_minor - local_previous_refunds_minor:
        raise ApiError('REFUND_EXCEEDS_AVAILABLE', 409)
    if terms.proposed_refund_minor != refund:
        raise ApiError('REFUND_PROPOSAL_AMOUNT_MISMATCH', 409)
    return DraftBreakdown(gross_minor=gross_minor, local_previous_refunds_minor=local_previous_refunds_minor,
                          seller_retention_minor=retained, customer_credit_minor=credit,
                          refund_minor=refund, additional_payment_due_minor=max(-entitlement, 0))


def check_evidence(citations: tuple[Citation, ...], sources: tuple[Source, ...], context: CaptureContext):
    for citation in citations:
        match = next((source for source in sources
                      if source.document_id == citation.document_id
                      and source.extraction_id == citation.extraction_id
                      and source.document_sha256 == citation.document_sha256
                      and source.owner_id == context.owner_id
                      and source.project_id == context.project_id
                      and citation.quote in source.text), None)
        if match is None:
            raise ApiError('REFUND_EVIDENCE_MISMATCH', 409)


def check_owner(actor_id: UUID, context: CaptureContext):
    if actor_id != context.owner_id:
        raise ApiError('REFUND_NOT_FOUND', 404)


def validate_request(actor_id: UUID, request: SettlementRequest, context: CaptureContext,
                     sources: tuple[Source, ...]):
    check_owner(actor_id, context)
    if request.payment_id != context.payment_id:
        raise ApiError('REFUND_PAYMENT_MISMATCH', 409)
    if context.has_open_request:
        raise ApiError('PROJECT_HAS_OPEN_REQUEST', 409)
    check_evidence(request.request_evidence, sources, context)


def calculate_settlement(actor_id: UUID, terms: SettlementTerms, context: CaptureContext,
                         sources: tuple[Source, ...]) -> Breakdown:
    """Review a payment's entire settlement, not just its remaining tasks.

    Previous refunds are deducted exactly once from the customer's total entitlement.
    Reservations constrain availability, not the agreed value of the work.
    """
    check_owner(actor_id, context)
    for item in terms.adjustments:
        check_evidence(item.evidence, sources, context)
    retained = sum(item.amount_minor for item in terms.adjustments if item.beneficiary == 'seller')
    credit = sum(item.amount_minor for item in terms.adjustments if item.beneficiary == 'customer')
    if retained > MAX_MINOR or credit > MAX_MINOR:
        raise ApiError('REFUND_AMOUNT_OVERFLOW', 422)
    entitlement = context.gross_minor - retained + credit
    refund = max(entitlement - context.previous_refunds_minor, 0)
    if entitlement < context.previous_refunds_minor and context.previous_refunds_minor:
        # Do not silently reclassify money already returned as another collectible debt.
        raise ApiError('REFUND_PRIOR_SETTLEMENT_CONFLICT', 409)
    available = context.provider_remaining_minor - context.reserved_minor
    if refund > available:
        raise ApiError('REFUND_EXCEEDS_AVAILABLE', 409)
    if terms.proposed_refund_minor != refund:
        raise ApiError('REFUND_PROPOSAL_AMOUNT_MISMATCH', 409)
    return Breakdown(gross_minor=context.gross_minor, original_fee_minor=context.original_fee_minor,
                     original_net_minor=context.gross_minor - context.original_fee_minor,
                     seller_retention_minor=retained, customer_credit_minor=credit,
                     previous_refunds_minor=context.previous_refunds_minor, available_minor=available,
                     refund_minor=refund, additional_payment_due_minor=max(-entitlement, 0))


class RevisionCommand(Contract):
    expected_snapshot_id: UUID
    feedback: Citation | None = None


def validate_revision(command: RevisionCommand, *, current_snapshot_id: UUID,
                      sent: bool, finalized: bool, actor_id: UUID,
                      context: CaptureContext, sources: tuple[Source, ...]):
    """Future repository must call under lock; a draft keeps its public version."""
    check_owner(actor_id, context)
    if finalized:
        raise ApiError('REFUND_SETTLEMENT_READ_ONLY', 409)
    if command.expected_snapshot_id != current_snapshot_id:
        raise ApiError('REFUND_REVISION_CONFLICT', 409)
    if sent and command.feedback is None:
        raise ApiError('REFUND_FEEDBACK_REQUIRED', 409)
    if command.feedback is not None:
        check_evidence((command.feedback,), sources, context)
    return 'new_version' if sent else 'draft_snapshot'
