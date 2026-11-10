"""TeTrato for the client in the portal. The link or session authorizes one addendum; the model only receives what the portal already shows.

It answers and drafts. It never accepts, pays or sends: the client does that with the portal's own actions."""
from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError
from redis.exceptions import RedisError

from .ai_jobs import PREFIX
from .errors import ApiError
from .persistence import uuid

# Each question spends the model and the link needs no account, so one link has a daily allowance.
DAILY_QUESTIONS = 30


class Turn(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    role: Literal['user', 'assistant']
    text: str = Field(min_length=1, max_length=4000)


class Question(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    question: str = Field(min_length=1, max_length=1000)
    output_language: Literal['es', 'en']
    history: list[Turn] = Field(default_factory=list, max_length=12)


class Answer(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    kind: Literal['portal_assistant']
    status: Literal['answered', 'outside_agreement', 'draft_change', 'draft_problem', 'confirm_accept', 'confirm_pay']
    answer: str = Field(min_length=1, max_length=4000)
    sources: list[Literal['scope', 'conditions', 'amount', 'deadline', 'status']] = Field(max_length=5)
    change_request: str = Field(max_length=4000)
    # Default only for answers stored before problem reports existed.
    problem_report: str = Field(default='', max_length=4000)
    model: str | None = None


def job_owner(digest):
    # A link's jobs can only be read with that same link; no user id can match this value.
    return 'portal:' + digest


def can_request_changes(view):
    # A request already sent stays as it is until the freelancer answers with a new version.
    return view.get('status') == 'ready_for_review' and bool(view.get('is_current')) and not view.get('accepted_at') and not view.get('change_request')


def can_report_problem(view, has_report):
    # Paid and verified by PayPal, with no report yet. The database checks it again when the client sends it.
    return view.get('status') == 'accepted' and view.get('payment_status') == 'completed' and not has_report


def can_accept(view):
    # The same moment the portal shows Accept addendum.
    return can_request_changes(view)


def can_pay(view):
    # Accepted with an amount PayPal has not verified yet: the portal shows its pay button.
    return (view.get('status') == 'accepted' and view.get('payment_status') != 'completed'
            and type(view.get('additional_minor')) is int and view['additional_minor'] > 0)


def agreement_context(view, can_report=False):
    """Only fields the client already sees. Internal ids, rates, notes and other documents never reach the model."""
    request = view.get('change_request')
    return {'project_name': view.get('project_name'), 'client_name': view.get('client_name'), 'version': view.get('revision_no'),
            'scope': view.get('scope_summary'), 'conditions': view.get('conditions'), 'amount_minor': view.get('additional_minor'),
            'currency': view.get('currency'), 'deadline': view.get('deadline'), 'status': view.get('status'),
            'payment_status': view.get('payment_status'), 'can_request_changes': can_request_changes(view),
            'pending_change_request': request.get('notes') if isinstance(request, dict) else None,
            'can_report_problem': bool(can_report), 'can_accept': can_accept(view), 'can_pay': can_pay(view)}


def validate_answer(result, can_request, can_report=False, accept=False, pay=False):
    """The worker already validated; check again before the client sees it."""
    try:
        answer = Answer.model_validate(result)
    except ValidationError:
        raise ApiError('AI_INVALID_RESPONSE', 502) from None
    valid = answer.answer.strip() and len(set(answer.sources)) == len(answer.sources) and (
        (answer.status == 'answered' and answer.sources and not answer.change_request and not answer.problem_report)
        or (answer.status == 'draft_change' and can_request and answer.change_request.strip() and not answer.sources and not answer.problem_report)
        or (answer.status == 'draft_problem' and can_report and answer.problem_report.strip() and not answer.sources and not answer.change_request)
        or (answer.status == 'outside_agreement' and not answer.sources and not answer.change_request and not answer.problem_report)
        or (answer.status == 'confirm_accept' and accept and answer.sources and not answer.change_request and not answer.problem_report)
        or (answer.status == 'confirm_pay' and pay and 'amount' in answer.sources and not answer.change_request and not answer.problem_report))
    if not valid:
        raise ApiError('AI_INVALID_CITATION', 502)
    return answer.model_dump(exclude={'model', 'kind'})


def reserve_question(jobs, digest, job_id):
    # A retry of the same question is free; only new questions count.
    try:
        redis = jobs.connection()
        if redis.exists(PREFIX + job_id):
            return
        key = 'trato:portal:assistant:' + digest + ':' + datetime.now(timezone.utc).strftime('%Y%m%d')
        used = redis.incr(key)
        redis.expire(key, 172800)
    except RedisError:
        raise ApiError('AI_QUEUE_UNAVAILABLE', 503) from None
    if used > DAILY_QUESTIONS:
        raise ApiError('PORTAL_ASSISTANT_LIMIT', 429)


def ask(jobs, preferences, digest, view, data, can_report=False):
    """Queue a question about this addendum. `can_report` comes from the database: paid, and no report yet."""
    if view.get('status') == 'superseded' or (not view.get('is_current') and view.get('status') != 'accepted'):
        raise ApiError('PROPOSAL_REVISION_CONFLICT', 409)
    job_id = uuid(data.get('job_id'))
    try:
        item = Question.model_validate({key: data.get(key) for key in ('question', 'output_language', 'history') if key in data})
    except ValidationError:
        raise ApiError('AI_INVALID_INPUT', 422) from None
    if not item.question.strip() or any(turn.role != ('user' if index % 2 == 0 else 'assistant') for index, turn in enumerate(item.history)):
        raise ApiError('AI_INVALID_INPUT', 422)
    context = agreement_context(view, can_report)
    # No account means no personal model preference: always the configured default.
    payload = {'workflow': 'portal_assistant', 'output_language': item.output_language, 'question': item.question.strip(),
               'history': [turn.model_dump() for turn in item.history], 'agreement': context, 'model_id': preferences.configuration()[1]}
    reserve_question(jobs, digest, job_id)
    return public_job(jobs.enqueue(job_owner(digest), job_id, payload), context['can_request_changes'], context['can_report_problem'],
                      context['can_accept'], context['can_pay'])


def status(jobs, digest, data):
    """Poll a question. The answer is checked against what the job was asked, not against the model's output."""
    owner, job_id = job_owner(digest), uuid(data.get('job_id'))
    job = jobs.get(owner, job_id, 'portal_assistant')
    agreement = jobs.input(owner, job_id)['agreement']
    return public_job(job, bool(agreement.get('can_request_changes')), agreement.get('can_report_problem') is True,
                      agreement.get('can_accept') is True, agreement.get('can_pay') is True)


def public_job(job, can_request, can_report=False, accept=False, pay=False):
    reply = {'id': job['id'], 'status': job['status']}
    if job['status'] == 'completed':
        reply['result'] = validate_answer(job['result'], can_request, can_report, accept, pay)
    if job['status'] == 'failed':
        reply['error_code'] = job.get('error_code')
    return reply
