"""TeTrato drafts the concept of a PayPal invoice, for an accepted addendum or a Work plan deliverable.

The backend authorizes the owner and reads the facts itself; the browser only says which addendum or deliverable.
The freelancer reviews the concept before the invoice is sent; amount and recipient never come from the model."""
from typing import Literal

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator
from starlette.concurrency import run_in_threadpool

from .ai_jobs import AIJobs
from .business_routes import read_bytes
from .errors import ApiError
from .model_preferences import ModelPreferences
from .persistence import uuid
from .proposals.repository import ProposalRepository

CONCEPT_LIMIT = 200


class ConceptRequest(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    target: Literal['addendum', 'stage']
    output_language: Literal['es', 'en']
    proposal_id: str | None = None
    revision_id: str | None = None
    project_id: str | None = None
    position: int | None = Field(default=None, ge=1, le=8)

    @model_validator(mode='after')
    def one_target(self):
        if self.target == 'addendum' and not (self.proposal_id and self.revision_id):
            raise ValueError('addendum needs proposal and revision')
        if self.target == 'stage' and not (self.project_id and self.position):
            raise ValueError('stage needs project and position')
        return self


def clip(value, limit=1500):
    value = ' '.join(str(value or '').split())
    return value[:limit]


def addendum_facts(repo, proposal_id, revision_id):
    snapshot = repo.get_revision(proposal_id, revision_id, collections=('line_items',))  # Only the owner reads it.
    if snapshot['proposal']['current_revision_id'] != revision_id:
        raise ApiError('PROPOSAL_REVISION_CONFLICT', 409)
    revision, items = snapshot['revision'], snapshot.get('line_items') or []
    project = repo.project(snapshot['proposal']['project_id'])
    facts = {'title': clip(items[0]['description'] if items else '', 300), 'scope': clip(revision.get('scope_summary')),
             'version': revision.get('revision_no')}
    return project.get('name') or '', facts


MONTHS = {'en': ('January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'),
          'es': ('enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre')}


def readable_date(value, language):
    # The concept reads like a sentence for the client, so the date is written out in their language.
    year, month, day = (int(part) for part in value[:10].split('-'))
    name = MONTHS[language][month - 1]
    return f'{day} de {name} de {year}' if language == 'es' else f'{name} {day}, {year}'


def stage_facts(repo, project_id, position, language='en'):
    project = repo.project(project_id)
    rows = repo.rows('project_start_stages', {'select': 'title,deliverables', 'project_id': 'eq.' + project_id, 'position': 'eq.' + str(position)})
    if len(rows) != 1:
        raise ApiError('PLAN_STAGE_INVALID', 404)
    approved = repo.rows('project_stage_reviews', {'select': 'created_at', 'project_id': 'eq.' + project_id, 'stage_position': 'eq.' + str(position),
                                                   'decision': 'eq.approved', 'order': 'created_at.desc', 'limit': 1})
    facts = {'deliverable_number': position, 'title': clip(rows[0]['title'], 300), 'deliverables': clip(rows[0].get('deliverables'))}
    if approved:
        facts['client_approved_on'] = readable_date(approved[0]['created_at'], language)
    return project.get('name') or '', facts


def validate_concept(result):
    concept = ' '.join(str((result or {}).get('concept') or '').split())
    if (result or {}).get('kind') != 'invoice_concept' or not 1 <= len(concept) <= CONCEPT_LIMIT:
        raise ApiError('AI_INVALID_RESPONSE', 502)
    return {'kind': 'invoice_concept', 'target': result.get('target'), 'concept': concept}


def build_invoice_concept_router(settings, require_user, jobs=None, preferences=None, repository_factory=None):
    router = APIRouter(prefix='/api/v1/ai')
    jobs = jobs if jobs is not None else AIJobs()
    preferences = preferences if preferences is not None else ModelPreferences()

    @router.post('/invoice-concepts')
    async def draft(request: Request, owner=Depends(require_user)):
        try:
            item = ConceptRequest.model_validate_json(await read_bytes(request, 4000))
        except (ValidationError, ValueError):
            raise ApiError('AI_INVALID_INPUT', 422) from None
        repo = (repository_factory or ProposalRepository)(settings, request.headers.get('authorization', ''))
        if item.target == 'addendum':
            name, facts = await run_in_threadpool(addendum_facts, repo, uuid(item.proposal_id), uuid(item.revision_id))
        else:
            name, facts = await run_in_threadpool(stage_facts, repo, uuid(item.project_id), item.position, item.output_language)
        data = {'workflow': 'invoice_concept', 'target': item.target, 'output_language': item.output_language,
                'project_name': name, 'facts': facts, 'model_id': await run_in_threadpool(preferences.for_request, request, owner)}
        job = await run_in_threadpool(jobs.enqueue, owner, uuid(request.headers.get('Idempotency-Key', '')), data)
        if job['status'] == 'completed':
            job['result'] = validate_concept(job['result'])
        return JSONResponse({'data': job}, status_code=202, headers={'Cache-Control': 'no-store'})

    return router
