"""TeTrato outside projects: answers how Ensayos and Reputación work, grounded only in data/section-guides.json.

The conversation lives in the browser session; no project, client or rehearsal data is read here."""
import json
from functools import lru_cache
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from starlette.concurrency import run_in_threadpool

from .ai_jobs import AIJobs
from .business_routes import read_bytes
from .errors import ApiError
from .model_preferences import ModelPreferences
from .persistence import uuid

ROOT = Path(__file__).resolve().parents[3]
SCENARIOS = ('scope', 'payment', 'refund', 'change', 'deadline', 'delivery')


@lru_cache(maxsize=1)
def section_guides():
    guides = json.loads((ROOT / 'data/section-guides.json').read_text(encoding='utf-8'))
    if guides.get('version') != 1 or set(guides.get('sections', {})) != {'rehearsals', 'reputation'}:
        raise ApiError('SECTION_GUIDE_INVALID', 500)
    return guides['sections']


def guide_passages(section, language):
    return [{'id': p['id'], 'text': p[language]} for p in section_guides()[section]['passages']]


class Turn(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    role: Literal['user', 'assistant']
    text: str = Field(min_length=1, max_length=4000)


class Screen(BaseModel):
    """What is on screen: only labels the interface already shows, never the hidden client intent."""
    model_config = ConfigDict(extra='forbid', strict=True)
    view: str = Field(pattern=r'^[a-z_]{1,30}$')
    scenario: Literal['scope', 'payment', 'refund', 'change', 'deadline', 'delivery'] | None = None
    case_theme: str | None = Field(default=None, max_length=120)


class SectionQuestion(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    section: Literal['rehearsals', 'reputation']
    question: str = Field(min_length=1, max_length=1000)
    output_language: Literal['es', 'en']
    screen: Screen
    history: list[Turn] = Field(default_factory=list, max_length=12)


class Answer(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    kind: Literal['section_help']
    section: Literal['rehearsals', 'reputation']
    status: Literal['answered', 'outside_guide']
    answer: str = Field(min_length=1, max_length=4000)
    passage_ids: list[str] = Field(max_length=8)
    model: str | None = None


def validate_answer(result, section, language):
    """The worker already validated; check again against the current guide before showing it."""
    if section not in ('rehearsals', 'reputation') or language not in ('es', 'en'):
        raise ApiError('AI_JOB_INVALID', 502)
    try:
        answer = Answer.model_validate(result)
    except ValidationError:
        raise ApiError('AI_INVALID_RESPONSE', 502) from None
    known = {p['id'] for p in section_guides()[section]['passages']}
    if answer.section != section or not answer.answer.strip() or any(i not in known for i in answer.passage_ids) \
            or len(set(answer.passage_ids)) != len(answer.passage_ids) or (answer.status == 'answered') != bool(answer.passage_ids):
        raise ApiError('AI_INVALID_CITATION', 502)
    # The browser shows the exact cited passages from our guide, in the conversation's language.
    texts = {p['id']: p['text'] for p in guide_passages(section, language)}
    return {**answer.model_dump(exclude={'model'}), 'passages': [{'id': i, 'text': texts[i]} for i in answer.passage_ids]}


def build_section_help_router(require_user, jobs=None, preferences=None):
    router = APIRouter(prefix='/api/v1/ai')
    jobs = jobs if jobs is not None else AIJobs()
    preferences = preferences if preferences is not None else ModelPreferences()

    @router.post('/section-questions')
    async def ask(request: Request, owner=Depends(require_user)):
        try:
            item = SectionQuestion.model_validate_json(await read_bytes(request, 80000))
        except (ValidationError, ValueError):
            raise ApiError('AI_INVALID_INPUT', 422) from None
        guide = section_guides()[item.section]
        if item.screen.view not in guide['views'] or not item.question.strip():
            raise ApiError('AI_INVALID_INPUT', 422)
        if item.section != 'rehearsals' and (item.screen.scenario or item.screen.case_theme):
            raise ApiError('AI_INVALID_INPUT', 422)
        if any(turn.role != ('user' if i % 2 == 0 else 'assistant') for i, turn in enumerate(item.history)):
            raise ApiError('AI_INVALID_INPUT', 422)
        data = {'workflow': 'section_help', 'section': item.section, 'output_language': item.output_language,
                'question': item.question.strip(), 'screen': item.screen.model_dump(exclude_none=True),
                'history': [t.model_dump() for t in item.history],
                'guide': guide_passages(item.section, item.output_language),
                'model_id': await run_in_threadpool(preferences.for_request, request, owner)}
        job_id = uuid(request.headers.get('Idempotency-Key', ''))
        job = await run_in_threadpool(jobs.enqueue, owner, job_id, data)
        if job['status'] == 'completed':
            job['result'] = validate_answer(job['result'], item.section, item.output_language)
        return JSONResponse({'data': job}, status_code=202, headers={'Cache-Control': 'no-store'})

    # Polling goes through GET /api/v1/ai/jobs/{id}, which calls completed_result below.
    return router


def completed_result(jobs, owner, job_id, result):
    """The section comes from the stored job input, never from the model's output."""
    data = jobs.input(owner, job_id)
    return validate_answer(result, data.get('section'), data.get('output_language'))
