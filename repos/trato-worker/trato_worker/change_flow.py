"""Explicit simulation of a change lifecycle, with persisted human interrupts."""
from copy import deepcopy
from datetime import date, datetime, timezone
from hashlib import sha256
import json
from typing import Annotated, Literal, TypedDict
from uuid import UUID, uuid4
import operator

from langchain_core.runnables import RunnableLambda
from langgraph.graph import END, START, StateGraph
from langgraph.types import interrupt
from pydantic import Field, model_validator
from .ingestion import StrictModel


class ChangeInput(StrictModel):
    request_id: str
    project_brief: str = Field(min_length=3, max_length=2000)
    fixture_id: Literal['extra', 'included', 'unclear', 'unrelated']
    baseline_reviewed: bool

    @model_validator(mode='after')
    def identifier(self):
        if str(UUID(self.request_id)) != self.request_id:
            raise ValueError('Solicitud inválida.')
        return self


class Review(StrictModel):
    action: Literal['approve_proposal']
    scope: str = Field(min_length=1, max_length=4000)
    amount_cents: int = Field(ge=0, le=100000000)
    currency: Literal['USD']
    due_date: str
    terms: str = Field(min_length=1, max_length=4000)

    @model_validator(mode='after')
    def valid_date(self):
        date.fromisoformat(self.due_date)
        if len(self.due_date) != 10:
            raise ValueError('Fecha inválida.')
        return self


class EditDraft(Review):
    action: Literal['edit_draft']


class Decision(StrictModel):
    action: Literal['accept', 'request_revision', 'reject']
    feedback_notes: str = Field(default='', max_length=4000)
    feedback_document_id: str | None = None

    @model_validator(mode='after')
    def feedback_required(self):
        if self.action == 'request_revision' and (not self.feedback_notes.strip() or not self.feedback_document_id):
            raise ValueError('La revisión necesita comentarios y el documento de respuesta del cliente.')
        if self.feedback_document_id is not None and str(UUID(self.feedback_document_id)) != self.feedback_document_id:
            raise ValueError('La fuente de respuesta requiere un UUID canónico.')
        return self


class ChangeState(TypedDict, total=False):
    context: dict
    document: dict  # Generic dispatcher input slot; this workflow holds ChangeInput here.
    steps: Annotated[list[str], operator.add]
    status: str
    sources: list
    analysis: dict
    proposal: dict
    revisions: list
    draft_snapshots: list
    editing_draft: bool
    events: list
    feedback: str
    feedback_document_id: str | None
    decision: dict
    baseline_reviewed: bool


def now():
    return datetime.now(timezone.utc).isoformat()


def validate_resume(stage, payload):
    """Check before resuming so invalid input never poisons an interrupt checkpoint."""
    if stage == 'review_proposal':
        return Review.model_validate(payload).model_dump()
    if stage == 'client_decision':
        return Decision.model_validate(payload).model_dump()
    if stage == 'send_revision' and isinstance(payload, dict) and payload.get('action') == 'edit_draft':
        return EditDraft.model_validate(payload).model_dump()
    required = {'review_baseline': 'confirm_baseline', 'send_revision': 'simulate_send',
                'confirm_payment': 'simulate_verified_payment'}
    if stage not in required or payload != {'action': required[stage]}:
        raise ValueError('La acción no corresponde al paso pendiente.')
    return payload


def simulate_analysis(state):
    case = state['document']['fixture_id']
    sources = state['sources']
    classification = {'extra': 'possible_extra', 'included': 'included',
                      'unclear': 'ambiguous', 'unrelated': 'unrelated'}[case]
    return {'mode': 'simulation', 'classification': classification,
            'new_request': sources[1]['text'],
            'baseline_scope': sources[0]['text'],
            'recommendation': ('Aclarar qué parte corresponde al proyecto.' if case in ('unclear', 'unrelated')
                               else 'Revisar alcance, precio y fecha antes de redactar la adenda.'),
            'client_feedback': state.get('feedback', ''),
            'feedback_document_id': state.get('feedback_document_id'),
            'human_review_required': True,
            'evidence': [{'source_id': s['id'], 'quote': s['text']} for s in sources]}


def build_change_flow(checkpointer):
    analysis_chain = RunnableLambda(simulate_analysis)

    def initialize(state):
        ChangeInput.model_validate(state['document'])
        request = {'extra': 'Añadir tienda y versión en inglés.',
                   'included': 'Completar las cinco secciones en español acordadas.',
                   'unclear': 'Quiero que agregues eso que hablamos.',
                   'unrelated': 'Revisar el mantenimiento de mi motocicleta.'}[state['document']['fixture_id']]
        return {'sources': [{'id': 'simulation-agreement', 'kind': 'agreement',
                             'text': 'Web en español con cinco secciones. No incluye tienda ni otros idiomas.'},
                            {'id': 'simulation-request', 'kind': 'request', 'text': request}],
                'baseline_reviewed': state['document']['baseline_reviewed'],
                'revisions': [], 'draft_snapshots': [], 'editing_draft': False,
                'events': [], 'feedback': '', 'feedback_document_id': None, 'status': 'processing',
                'steps': ['register_request']}

    def baseline(state):
        if not state['baseline_reviewed']:
            interrupt({'stage': 'review_baseline', 'message': 'Revisa y confirma el acuerdo inicial antes de comparar el pedido.',
                       'sources': state['sources'][:1], 'allowed_actions': ['confirm_baseline']})
        return {'baseline_reviewed': True, 'steps': ['baseline_reviewed']}

    def analyze(state):
        result = analysis_chain.invoke(state)
        for item in result['evidence']:
            if not any(s['id'] == item['source_id'] and item['quote'] in s['text'] for s in state['sources']):
                raise ValueError('El análisis no tiene evidencia válida.')
        return {'analysis': result, 'status': 'processing', 'steps': ['analyze_request']}

    def hold(state):
        return {'status': 'not_relevant' if state['analysis']['classification'] == 'unrelated' else 'needs_clarification',
                'steps': ['hold_request']}

    def review(state):
        result = interrupt({'stage': 'review_proposal', 'analysis': state['analysis'],
                            'previous_revision': state['revisions'][-1] if state['revisions'] else None,
                            'allowed_actions': ['approve_proposal'],
                            'required_fields': ['scope', 'amount_cents', 'currency', 'due_date', 'terms']})
        return {'proposal': Review.model_validate(result).model_dump(exclude={'action'}),
                'editing_draft': False,
                'steps': ['review_proposal']}

    def draft(state):
        editing = state.get('editing_draft', False)
        previous = state['revisions'][-1] if state['revisions'] else None
        if editing:
            if previous is None or any(event['revision_id'] == previous['revision_id'] and event['event'] == 'revision_sent'
                                       for event in state['events']):
                raise ValueError('Sólo se puede editar un borrador aún no enviado.')
        elif previous is not None:
            if (state.get('decision', {}).get('action') != 'request_revision'
                    or not state.get('feedback_document_id')
                    or not any(event['revision_id'] == previous['revision_id'] and event['event'] == 'revision_sent'
                               for event in state['events'])):
                raise ValueError('Una nueva versión exige envío anterior y ajustes respaldados por la respuesta del cliente.')
        number = previous['version'] if editing else len(state['revisions']) + 1
        sequence = previous['draft_sequence'] + 1 if editing else 1
        proposal = deepcopy(state['proposal'])
        # This is a snapshot of simulated content, not a generated/stored PDF artifact.
        text = json.dumps({'version': number, 'proposal': proposal}, ensure_ascii=False, sort_keys=True)
        revision = {'revision_id': previous['revision_id'] if editing else str(uuid4()),
                    'version': number, 'draft_sequence': sequence, 'snapshot_id': str(uuid4()),
                    'created_at': previous['created_at'] if editing else now(), 'saved_at': now(),
                    'proposal': proposal, 'content': text, 'content_sha256': sha256(text.encode()).hexdigest(),
                    'source_refs': deepcopy(state['analysis']['evidence']),
                    'client_feedback': state.get('feedback', ''), 'feedback_document_id': state.get('feedback_document_id'),
                    'mode': 'simulation', 'pdf_generated': False}
        event = {'event': 'draft_updated' if editing else 'revision_saved', 'revision_id': revision['revision_id'],
                 'snapshot_id': revision['snapshot_id'], 'draft_sequence': sequence,
                 'internal': editing, 'at': now(), 'mode': 'simulation'}
        revisions = [*state['revisions'][:-1], revision] if editing else [*state['revisions'], revision]
        return {'revisions': revisions, 'draft_snapshots': [*state['draft_snapshots'], deepcopy(revision)],
                'editing_draft': False, 'events': [*state['events'], event],
                'status': 'processing', 'steps': ['save_revision']}

    def send(state):
        revision = state['revisions'][-1]
        command = interrupt({'stage': 'send_revision', 'revision': revision,
                             'allowed_actions': ['edit_draft', 'simulate_send'],
                             'edit_required_fields': ['scope', 'amount_cents', 'currency', 'due_date', 'terms']})
        if command['action'] == 'edit_draft':
            return {'proposal': EditDraft.model_validate(command).model_dump(exclude={'action'}),
                    'editing_draft': True, 'steps': ['edit_draft']}
        return {'events': [*state['events'], {'event': 'revision_sent', 'revision_id': revision['revision_id'],
                                             'snapshot_id': revision['snapshot_id'], 'content_sha256': revision['content_sha256'],
                                             'at': now(), 'mode': 'simulation'}],
                'editing_draft': False,
                'steps': ['send_revision']}

    def client(state):
        revision = state['revisions'][-1]
        result = interrupt({'stage': 'client_decision', 'revision_id': revision['revision_id'],
                            'allowed_actions': ['accept', 'request_revision', 'reject']})
        decision = Decision.model_validate(result).model_dump()
        event = {'event': {'accept': 'revision_accepted', 'reject': 'revision_rejected',
                           'request_revision': 'revision_changes_requested'}[decision['action']],
                 'revision_id': revision['revision_id'], 'snapshot_id': revision['snapshot_id'],
                 'feedback_notes': decision['feedback_notes'], 'feedback_document_id': decision['feedback_document_id'],
                 'at': now(), 'mode': 'simulation'}
        return {'decision': decision, 'feedback': decision['feedback_notes'],
                'feedback_document_id': decision['feedback_document_id'], 'events': [*state['events'], event],
                'steps': ['client_decision']}

    def payment(state):
        revision = state['revisions'][-1]
        if revision['proposal']['amount_cents'] > 0:
            interrupt({'stage': 'confirm_payment', 'revision_id': revision['revision_id'],
                       'amount_cents': revision['proposal']['amount_cents'],
                       'allowed_actions': ['simulate_verified_payment'],
                       'message': 'El cambio sigue pendiente hasta confirmar el pago; salir del checkout no crea otro estado.'})
            return {'events': [*state['events'], {'event': 'payment_confirmed', 'revision_id': revision['revision_id'],
                                                 'snapshot_id': revision['snapshot_id'],
                                                 'at': now(), 'mode': 'simulation', 'provider_verified': False}],
                    'steps': ['payment_confirmed']}
        return {'steps': ['no_additional_payment']}

    def finish(state):
        return {'status': 'ready', 'steps': ['finalize_change']}

    def reject(state):
        return {'status': 'rejected', 'steps': ['close_rejected_change']}

    graph = StateGraph(ChangeState)
    for name, fn in [('register_request', initialize), ('baseline', baseline), ('analyze_request', analyze),
                     ('hold_request', hold), ('review_proposal', review), ('save_revision', draft),
                     ('send_revision', send), ('client_decision', client), ('payment', payment),
                     ('finalize_change', finish), ('close_rejected_change', reject)]:
        graph.add_node(name, fn)
    graph.add_edge(START, 'register_request')
    graph.add_edge('register_request', 'baseline')
    graph.add_edge('baseline', 'analyze_request')
    graph.add_conditional_edges('analyze_request', lambda s: 'hold_request' if s['analysis']['classification'] in ('ambiguous', 'unrelated') else 'review_proposal')
    graph.add_edge('hold_request', END)
    graph.add_edge('review_proposal', 'save_revision')
    graph.add_edge('save_revision', 'send_revision')
    graph.add_conditional_edges('send_revision', lambda s: 'save_revision' if s.get('editing_draft') else 'client_decision')
    graph.add_conditional_edges('client_decision', lambda s: {'accept': 'payment', 'request_revision': 'analyze_request', 'reject': 'close_rejected_change'}[s['decision']['action']])
    graph.add_edge('payment', 'finalize_change')
    graph.add_edge('finalize_change', END)
    graph.add_edge('close_rejected_change', END)
    return graph.compile(checkpointer=checkpointer)
