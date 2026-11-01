"""One thread envelope; server-bound purposes and explicit access boundaries."""
from dataclasses import dataclass
from hashlib import sha256
import json
from typing import Literal
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field, model_validator

Purpose = Literal['initial_agreement', 'change_request', 'addendum_adjustments',
                  'acceptance_evidence', 'generated_addendum', 'reputation_evidence',
                  'refund_request', 'refund_evidence', 'training_material','supporting_reference','delivery_evidence']
PURPOSES = frozenset(Purpose.__args__)


class PipelineError(RuntimeError):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def fingerprint(value):
    return sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def canonical_id(value):
    if str(UUID(value)) != value: raise ValueError('Canonical UUID required.')
    return value


class Strict(BaseModel):
    model_config = ConfigDict(strict=True, extra='forbid')


class Context(Strict):
    owner_id: str
    client_id: str | None = None
    project_id: str | None = None

    @model_validator(mode='after')
    def ids(self):
        for value in (self.owner_id, self.client_id, self.project_id):
            if value is not None: canonical_id(value)
        return self


class Payload(Strict):
    file_id: str
    purpose: Purpose
    source_sha256: str = Field(pattern=r'^[a-f0-9]{64}$')

    @model_validator(mode='after')
    def ids(self):
        canonical_id(self.file_id)
        return self


class FileThread(Strict):
    type: Literal['thread']
    schema_version: int = Field(ge=1, le=1)
    mode: Literal['connected']
    workflow: Literal['process_file']
    action: Literal['start']
    thread_id: str
    event_id: str
    context: Context
    payload: Payload

    @model_validator(mode='after')
    def ids(self):
        canonical_id(self.thread_id); canonical_id(self.event_id)
        return self


class AccessScope(Strict):
    visibility: Literal['project_private', 'reputation_private', 'reputation_published', 'training_library']
    owner_id: str | None = None
    client_id: str | None = None
    project_id: str | None = None
    community_client_id: str | None = None
    review_id: str | None = None
    library_id: str | None = Field(default=None, min_length=1, max_length=128)

    @model_validator(mode='after')
    def boundary(self):
        for value in (self.owner_id, self.client_id, self.project_id, self.community_client_id, self.review_id):
            if value is not None: canonical_id(value)
        if self.visibility in ('project_private', 'reputation_private'):
            if not all((self.owner_id, self.client_id, self.project_id)) or self.library_id:
                raise ValueError('Private files require an owner, client and project.')
        elif self.visibility == 'reputation_published':
            if not self.community_client_id or not self.review_id or any((self.owner_id, self.client_id, self.project_id, self.library_id)):
                raise ValueError('Community projection cannot reveal private project/owner IDs.')
        elif not self.library_id or any((self.owner_id, self.client_id, self.project_id, self.community_client_id, self.review_id)):
            raise ValueError('Training library has its own boundary.')
        return self


class FileManifest(Strict):
    thread_id: str
    event_id: str
    lease_id: str
    context: Context
    file_id: str
    source_sha256: str = Field(pattern=r'^[a-f0-9]{64}$')
    source_version: str = Field(min_length=1, max_length=128)
    selection_fingerprint: str = Field(pattern=r'^[a-f0-9]{64}$')
    purpose: Purpose
    access: AccessScope
    filename: str = Field(min_length=1, max_length=255)
    output_language: Literal['es', 'en']
    bindings: dict[str, str] = Field(default_factory=dict)
    reference_context: dict[str, str] = Field(default_factory=dict)

    @model_validator(mode='after')
    def metadata(self):
        for value in (self.thread_id, self.event_id, self.lease_id, self.file_id): canonical_id(value)
        if any(c in self.filename for c in ('/', '\\', '\0', '\r', '\n')):
            raise ValueError('No arbitrary file paths.')
        if not set(self.bindings).issubset({'request_id', 'revision_id', 'payment_id', 'refund_case_id'}):
            raise ValueError('Unknown subject binding.')
        for value in self.bindings.values(): canonical_id(value)
        if not set(self.reference_context).issubset({'project_brief', 'baseline_summary', 'experience_description', 'case_description'}):
            raise ValueError('Unknown reference context.')
        if any(not value.strip() or len(value.encode()) > 64000 for value in self.reference_context.values()):
            raise ValueError('Invalid reference context size.')
        if self.purpose == 'training_material':
            if self.access.visibility != 'training_library': raise ValueError('Training access mismatch.')
        elif self.purpose == 'reputation_evidence':
            if self.access.visibility not in ('reputation_private', 'reputation_published'): raise ValueError('Reputation access mismatch.')
        elif self.access.visibility != 'project_private':
            raise ValueError('Project access required.')
        if self.access.visibility in ('project_private', 'reputation_private') and (
            self.access.owner_id != self.context.owner_id or self.access.client_id != self.context.client_id or self.access.project_id != self.context.project_id):
            raise ValueError('File access does not match the job context.')
        return self

    def matches(self, thread):
        return (self.thread_id == thread.thread_id and self.event_id == thread.event_id
                and self.context == thread.context and self.file_id == thread.payload.file_id
                and self.purpose == thread.payload.purpose and self.source_sha256 == thread.payload.source_sha256)

    def input_fingerprint(self):
        # Lease/event are execution metadata, not content-version cache keys.
        return fingerprint({'file_id': self.file_id, 'source_sha256': self.source_sha256,
                            'source_version': self.source_version, 'selection': self.selection_fingerprint,
                            'reference_context': self.reference_context})


@dataclass(frozen=True)
class PurposePolicy:
    handler: str
    required_bindings: tuple[str, ...] = ()


POLICIES = {
    'initial_agreement': PurposePolicy('initial_agreement'),
    'change_request': PurposePolicy('change_request'),
    'addendum_adjustments': PurposePolicy('addendum_adjustments', ('request_id', 'revision_id')),
    'acceptance_evidence': PurposePolicy('acceptance_evidence', ('revision_id',)),
    'generated_addendum': PurposePolicy('generated_addendum', ('revision_id',)),
    'reputation_evidence': PurposePolicy('reputation_evidence'),
    'refund_request': PurposePolicy('refund_request', ('payment_id',)),
    'refund_evidence': PurposePolicy('refund_evidence', ('payment_id', 'refund_case_id')),
    'training_material': PurposePolicy('training_material'),
    'supporting_reference': PurposePolicy('supporting_reference'),
    'delivery_evidence': PurposePolicy('delivery_evidence'),
}


class SummaryContent(Strict):
    summary: str = Field(min_length=1, max_length=1800)
    topics: list[str] = Field(min_length=1, max_length=8)
    citations: list[dict[str, str]] = Field(min_length=1, max_length=5)

    @model_validator(mode='after')
    def text(self):
        if not self.summary.strip() or any(not x.strip() or len(x) > 120 for x in self.topics):
            raise ValueError('Invalid summary text.')
        for ref in self.citations:
            if set(ref) != {'chunk_id', 'quote'} or not ref['quote'].strip() or len(ref['quote']) > 240:
                raise ValueError('Invalid summary citation.')
            canonical_id(ref['chunk_id'])
        return self


class Evidence(Strict):
    segment_id: str = Field(min_length=1, max_length=100)
    quote: str = Field(min_length=1, max_length=240)

    @model_validator(mode='after')
    def material(self):
        if not self.quote.strip(): raise ValueError('Empty evidence.')
        return self


class Observation(Strict):
    text: str = Field(min_length=1, max_length=600)
    evidence: list[Evidence] = Field(min_length=1, max_length=3)


class Assessment(Strict):
    detected_category: Literal['agreement', 'change_request', 'addendum_adjustments', 'acceptance_document',
                               'generated_addendum', 'experience_evidence', 'refund_request', 'refund_evidence',
                               'training_material','supporting_reference','delivery_evidence', 'other', 'unclear']
    relevance: Literal['supported', 'unclear', 'unrelated']
    reason: str = Field(min_length=1, max_length=2000)
    evidence: list[Evidence] = Field(min_length=1, max_length=5)
    observations: list[Observation] = Field(max_length=12)
    clarification_questions: list[str] = Field(max_length=4)

    @model_validator(mode='after')
    def material(self):
        texts = [self.reason, *(o.text for o in self.observations), *self.clarification_questions]
        if any(not s.strip() for s in texts) or any(len(s)>600 for s in self.clarification_questions):
            raise ValueError('Invalid assessment text.')
        if (self.relevance == 'unclear') != bool(self.clarification_questions):
            raise ValueError('Unclear assessment requires clarification questions.')
        return self


class Treatment(Strict):
    decision: Literal['continue', 'needs_clarification', 'rejected']
    reason: str = Field(min_length=1, max_length=2000)
    human_review_required: Literal[True]
    assessment: Assessment
    model_identity: str = Field(min_length=1, max_length=200)
    prompt_fingerprint: str = Field(pattern=r'^[a-f0-9]{64}$')
    coverage: dict

    @model_validator(mode='after')
    def decision_matches_assessment(self):
        expected = {'supported': 'continue', 'unclear': 'needs_clarification', 'unrelated': 'rejected'}
        if self.decision != expected[self.assessment.relevance] or self.reason != self.assessment.reason:
            raise ValueError('Treatment contradicts assessment.')
        return self
