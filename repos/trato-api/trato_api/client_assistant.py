"""TeTrato for the client across their account: answers about their own projects from what My projects already shows.

The facts are built here from the same RPCs the client's views use (agreements and Work plan), with totals already
computed so the model never adds money up. Each item has a short reference (A1, S1) that the answer must cite.
It only answers: accepting, paying and sending stay on the addendum and deliverable views."""
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError
from redis.exceptions import RedisError

from .ai_jobs import PREFIX
from .errors import ApiError
from .persistence import uuid
from .portal_assistant import Turn

WORKFLOW = 'client_account_assistant'
DAILY_QUESTIONS = 40
MAX_ITEMS = 60


class Question(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    question: str = Field(min_length=1, max_length=1000)
    output_language: Literal['es', 'en']
    history: list[Turn] = Field(default_factory=list, max_length=12)


class Answer(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    kind: Literal['client_account_assistant']
    status: Literal['answered', 'outside_account']
    answer: str = Field(min_length=1, max_length=4000)
    sources: list[str] = Field(max_length=8)
    model: str | None = None


def job_owner(user):
    return 'client-account:' + uuid(user)


def minor(value):
    """A Work plan amount is in dollars (an int, a float or a string) and becomes integer cents."""
    if type(value) is bool:
        return 0
    try:
        return int((Decimal(str(value)) * 100).to_integral_value())
    except (InvalidOperation, ValueError, TypeError):
        return 0


def money(cents, currency='USD'):
    return f'{currency} {cents // 100}.{cents % 100:02d}'


def text(value, size):
    value = ' '.join(str(value or '').split())
    return value if len(value) <= size else value[:size - 1] + '…'


def addendum_state(item):
    status, paid = item.get('status'), item.get('payment_status') == 'completed'
    refunded = item.get('refunded_minor') or 0
    if status == 'accepted' and paid:
        total = item.get('additional_minor') or 0
        return 'refunded' if total and refunded >= total else 'partially refunded' if refunded else 'paid'
    if status == 'accepted':
        return 'accepted, waiting for your payment' if (item.get('additional_minor') or 0) > 0 else 'accepted'
    if item.get('change_requested'):
        return 'you asked for changes; waiting for a new version'
    if status == 'ready_for_review':
        return 'waiting for your answer'
    return 'closed'


def stage_state(item):
    if item.get('payment_status') == 'completed':
        refunded, paid = item.get('refunded_minor') or 0, item.get('paid_minor') or minor(item.get('amount'))
        state = 'refunded' if paid and refunded >= paid else 'partially refunded' if refunded else 'paid'
    elif item.get('pay_url'):
        state = 'payment requested, waiting for your payment'
    else:
        state = 'not charged yet'
    delivery = ('approved by you' if item.get('review_decision') == 'approved' else
                'you asked for changes' if item.get('review_decision') == 'changes_requested' else
                'delivered, waiting for your review' if item.get('delivery_document_id') else 'not delivered yet')
    return state, delivery


def account_facts(agreements, plans):
    """Only what the client already sees, grouped by project, with per-project totals in cents."""
    projects, refs = {}, {}
    def project(item):
        key = item.get('project_id') or item.get('project_name')
        return projects.setdefault(key, {'project': text(item.get('project_name'), 120), 'freelancer': text(item.get('freelancer_email'), 120),
                                         'items': [], 'paid': 0, 'to_pay': 0, 'refunded': 0})
    count = {'A': 0, 'S': 0}
    for item in (plans or [])[:MAX_ITEMS]:
        if not isinstance(item, dict):
            continue
        group, state = project(item), stage_state(item)
        count['S'] += 1
        ref = f"S{count['S']}"
        amount = minor(item.get('amount'))
        if state[0] in ('paid', 'partially refunded', 'refunded'):
            group['paid'] += item.get('paid_minor') or amount
            group['refunded'] += item.get('refunded_minor') or 0
        elif state[0].startswith('payment requested'):
            group['to_pay'] += amount
        group['items'].append({'ref': ref, 'type': 'deliverable', 'title': f"Deliverable {item.get('position')} · {text(item.get('title'), 120)}",
                               'amount': money(amount), 'payment': state[0], 'delivery': state[1],
                               'paid_on': text(item.get('paid_at'), 10) or None})
        refs[ref] = {'type': 'stage', 'project_id': item.get('project_id'), 'position': item.get('position'),
                     'label': f"{group['project']} · Deliverable {item.get('position')}"}
    for item in (agreements or [])[:MAX_ITEMS]:
        if not isinstance(item, dict) or item.get('status') == 'superseded':
            continue
        group, state = project(item), addendum_state(item)
        count['A'] += 1
        ref = f"A{count['A']}"
        amount = item.get('additional_minor') or 0
        if state in ('paid', 'partially refunded', 'refunded'):
            group['paid'] += amount
            group['refunded'] += item.get('refunded_minor') or 0
        elif state.startswith('accepted, waiting'):
            group['to_pay'] += amount
        group['items'].append({'ref': ref, 'type': 'addendum', 'title': f"Addendum v{item.get('revision_no')}",
                               'what_changes': text(item.get('scope_summary'), 240), 'amount': money(amount, item.get('currency') or 'USD'),
                               'state': state, 'due': text(item.get('deadline'), 10) or None})
        refs[ref] = {'type': 'addendum', 'proposal_id': item.get('proposal_id'), 'project_id': item.get('project_id'),
                     'label': f"{group['project']} · Addendum v{item.get('revision_no')}"}
    facts = [{**group, 'paid': money(group['paid']), 'to_pay': money(group['to_pay']), 'refunded': money(group['refunded'])}
             for group in projects.values()]
    return facts, refs


def reserve_question(jobs, user, job_id):
    try:
        redis = jobs.connection()
        if redis.exists(PREFIX + job_id):
            return
        key = 'trato:client:assistant:' + uuid(user) + ':' + datetime.now(timezone.utc).strftime('%Y%m%d')
        used = redis.incr(key)
        redis.expire(key, 172800)
    except RedisError:
        raise ApiError('AI_QUEUE_UNAVAILABLE', 503) from None
    if used > DAILY_QUESTIONS:
        raise ApiError('PORTAL_ASSISTANT_LIMIT', 429)


def ask(jobs, preferences, user, agreements, plans, data):
    job_id = uuid(data.get('job_id'))
    project = data.get('project_id')
    if project is not None:
        # Inside one project: the same facts, only that project's. It must be one of this client's projects.
        project = uuid(project)
        agreements = [item for item in agreements or [] if isinstance(item, dict) and item.get('project_id') == project]
        plans = [item for item in plans or [] if isinstance(item, dict) and item.get('project_id') == project]
        if not agreements and not plans:
            raise ApiError('PROJECT_NOT_FOUND', 404)
    try:
        item = Question.model_validate({key: data.get(key) for key in ('question', 'output_language', 'history') if key in data})
    except ValidationError:
        raise ApiError('AI_INVALID_INPUT', 422) from None
    if not item.question.strip() or any(turn.role != ('user' if index % 2 == 0 else 'assistant') for index, turn in enumerate(item.history)):
        raise ApiError('AI_INVALID_INPUT', 422)
    facts, refs = account_facts(agreements, plans)
    payload = {'workflow': WORKFLOW, 'output_language': item.output_language, 'question': item.question.strip(),
               'history': [turn.model_dump() for turn in item.history], 'projects': facts, 'refs': refs,
               'today': datetime.now(timezone.utc).strftime('%Y-%m-%d'), 'model_id': preferences.configuration()[1]}
    reserve_question(jobs, user, job_id)
    return public_job(jobs.enqueue(job_owner(user), job_id, payload), refs)


def status(jobs, user, data):
    owner, job_id = job_owner(user), uuid(data.get('job_id'))
    job = jobs.get(owner, job_id, WORKFLOW)
    return public_job(job, jobs.input(owner, job_id).get('refs') or {})


def validate_answer(result, refs):
    try:
        answer = Answer.model_validate(result)
    except ValidationError:
        raise ApiError('AI_INVALID_RESPONSE', 502) from None
    sources = answer.sources
    valid = answer.answer.strip() and len(set(sources)) == len(sources) and all(ref in refs for ref in sources) and (
        (answer.status == 'answered' and sources) or (answer.status == 'outside_account' and not sources))
    if not valid:
        raise ApiError('AI_INVALID_CITATION', 502)
    # Each cited item goes back with what the page needs to open it; never another client's id.
    return {'status': answer.status, 'answer': answer.answer, 'sources': [{'ref': ref, **refs[ref]} for ref in sources]}


def public_job(job, refs):
    reply = {'id': job['id'], 'status': job['status']}
    if job['status'] == 'completed':
        reply['result'] = validate_answer(job['result'], refs)
    if job['status'] == 'failed':
        reply['error_code'] = job.get('error_code')
    return reply
