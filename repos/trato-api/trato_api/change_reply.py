"""Read-only AI analysis of a reply bound to the current sent proposal revision."""
from datetime import date
from typing import Literal
from uuid import UUID

from fastapi import Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from starlette.concurrency import run_in_threadpool

from .ai_jobs import AIJobs
from .business_routes import read_bytes
from .errors import ApiError
from .model_preferences import ModelPreferences
from .persistence import uuid


class ReplyRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    revision_id: UUID
    output_language: Literal['es', 'en']


class RevisionDraft(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True, str_strip_whitespace=True)
    scope_summary: str = Field(min_length=1, max_length=12000)
    conditions: str = Field(max_length=12000)
    description: str = Field(min_length=1, max_length=1000)
    estimated_extra_hours: str | None = Field(default=None, pattern=r'^\d{1,4}(\.\d{1,2})?$')
    estimated_extra_minor: int | None = Field(default=None, ge=0, le=99999999999)
    deadline: str | None = Field(default=None, pattern=r'^\d{4}-\d{2}-\d{2}$')
    deadline_basis: Literal['requested', 'estimated', 'unchanged', 'needs_confirmation'] = 'needs_confirmation'


class ReplyAnalysis(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    classification: Literal['acceptance', 'adjustments', 'ambiguous']
    summary: str = Field(min_length=1, max_length=2000)
    quote: str = Field(min_length=1, max_length=1000)
    analysis: str = Field(default='', max_length=3000)
    draft: RevisionDraft | None


def reply_context(repo, workflow, owner, proposal_id, revision_id, message_id):
    snapshot = repo.get_revision(proposal_id, revision_id, collections=('deliveries', 'line_items'))
    proposal, revision = snapshot['proposal'], snapshot['revision']
    if (proposal['owner_id'] != owner or proposal['current_revision_id'] != revision_id
        or proposal['locked_at'] or proposal['status'] != 'ready_for_review'):
        raise ApiError('AI_CONTEXT_CHANGED', 409)
    # The database links each inbound email to the Gmail delivery for this revision.
    delivery_ids = {row['id'] for row in snapshot['deliveries']
                    if row['kind'] == 'adenda' and row['status'] == 'accepted_by_gmail'}
    if not delivery_ids:
        raise ApiError('CHANGE_REPLY_UNAVAILABLE', 409)
    messages = workflow.gmail_replies(owner, proposal['project_id'], proposal_id)
    message = next((row for row in messages if row['id'] == message_id and row['revision_id'] == revision_id
                    and row['delivery_id'] in delivery_ids and not row['used_at']), None)
    if message is None or not message['reply_text'].strip():
        raise ApiError('CHANGE_REPLY_UNAVAILABLE', 409)
    body = message['body_text'].replace('\r\n', '\n').replace('\r', '\n')
    if len(message['reply_text'].encode()) > 120000:
        raise ApiError('AI_CONTEXT_LIMIT', 413)
    return {'reply_text': message['reply_text'], 'original_reply': body,
            'sent_terms': {**{key: revision[key] for key in ('scope_summary', 'conditions', 'additional_minor',
                                                            'currency', 'deadline')},
                           'line_items': snapshot['line_items']}}


def mount_change_reply(router, repository, require_user, workflow, *, jobs=None, preferences=None):
    jobs = jobs if jobs is not None else AIJobs()
    preferences = preferences if preferences is not None else ModelPreferences()

    def result(repo, owner, job_id):
        job = jobs.get(owner, job_id, 'change_reply')
        if job['status'] != 'completed':
            return job
        data = jobs.input(owner, job_id)
        current = reply_context(repo, workflow, owner, data['proposal_id'], data['revision_id'], data['message_id'])
        if current['reply_text'] != data['reply_text'] or current['sent_terms'] != data['sent_terms']:
            raise ApiError('AI_CONTEXT_CHANGED', 409)
        raw = job['result']
        if not isinstance(raw, dict) or raw.get('kind') != 'change_reply':
            raise ApiError('AI_INVALID_RESPONSE', 502)
        try:
            analysis = ReplyAnalysis.model_validate({key: value for key, value in raw.items() if key != 'kind'})
        except ValidationError:
            raise ApiError('AI_INVALID_RESPONSE', 502) from None
        if not analysis.quote.strip() or analysis.quote not in current['reply_text'] or analysis.quote not in current['original_reply']:
            raise ApiError('AI_INVALID_CITATION', 502)
        if not analysis.summary.strip() or (analysis.classification == 'adjustments') != (analysis.draft is not None):
            raise ApiError('AI_INVALID_RESPONSE', 502)
        output = analysis.model_dump()
        if analysis.draft:
            draft = analysis.draft
            if (draft.deadline_basis in ('requested', 'estimated')) != bool(draft.deadline):
                raise ApiError('AI_INVALID_RESPONSE', 502)
            if draft.deadline:
                try:
                    date.fromisoformat(draft.deadline)
                except ValueError:
                    raise ApiError('AI_INVALID_RESPONSE', 502) from None
            base = current['sent_terms']['additional_minor']
            output['base_amount_minor'] = base
            if draft.estimated_extra_minor is not None:
                total = base + draft.estimated_extra_minor
                if total > 99999999999:
                    raise ApiError('AI_INVALID_RESPONSE', 502)
                output['proposed_amount_minor'] = total
            output['proposed_deadline'] = (current['sent_terms']['deadline']
                                           if draft.deadline_basis == 'unchanged' else draft.deadline)
        return {**job, 'result': {**output, **{key: data[key] for key in
                ('proposal_id', 'revision_id', 'message_id')}}}

    @router.post('/proposals/{proposal_id}/gmail-replies/{message_id}/analysis')
    async def start(proposal_id: UUID, message_id: UUID, request: Request,
                    owner=Depends(require_user), repo=Depends(repository)):
        try:
            item = ReplyRequest.model_validate_json(await read_bytes(request, 4000))
        except ValidationError:
            raise ApiError('AI_INVALID_INPUT', 422) from None
        ids = {'proposal_id': str(proposal_id), 'revision_id': str(item.revision_id), 'message_id': str(message_id)}
        context = await run_in_threadpool(reply_context, repo, workflow, owner, *ids.values())
        model = await run_in_threadpool(preferences.for_request, request, owner)
        job_id = uuid(request.headers.get('Idempotency-Key', ''))
        data = {'workflow': 'change_reply', **ids, 'output_language': item.output_language, 'model_id': model,
                'reply_text': context['reply_text'], 'sent_terms': context['sent_terms']}
        job = await run_in_threadpool(jobs.enqueue, owner, job_id, data)
        if job['status'] == 'completed':
            job = await run_in_threadpool(result, repo, owner, job_id)
        return JSONResponse({'data': job}, status_code=202, headers={'Cache-Control': 'no-store'})

    @router.get('/ai/change-replies/{job_id}')
    def poll(job_id: UUID, owner=Depends(require_user), repo=Depends(repository)):
        return JSONResponse({'data': result(repo, owner, str(job_id))}, headers={'Cache-Control': 'no-store'})
