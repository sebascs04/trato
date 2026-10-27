"""Explicit refund simulation: cited sources, human pauses, immutable snapshots.

No provider, mail, Storage or business-database calls. Money is integer USD cents.
"""
from copy import deepcopy
from datetime import date
from hashlib import sha256
import json
from pathlib import Path
from typing import Literal, TypedDict
from uuid import UUID, uuid4

from langchain_core.runnables import RunnableLambda
from langgraph.graph import END, START, StateGraph
from langgraph.types import interrupt
from pydantic import Field, model_validator
from .ingestion import StrictModel
from .change_flow import Decision, now

POLICIES = json.loads((Path(__file__).parent / 'data/paypal_refund_sources.json').read_text())


class RefundInput(StrictModel):
    request_id: str
    fixture_id: Literal['partial', 'unclear', 'expired', 'previous_refund']

    @model_validator(mode='after')
    def identifier(self):
        if str(UUID(self.request_id)) != self.request_id:
            raise ValueError('Solicitud inválida.')
        return self


class RefundReview(StrictModel):
    action: Literal['approve_refund_proposal']
    recognized_work_minor: int = Field(ge=0, le=30000)
    terms: str = Field(min_length=3, max_length=4000)


class RefundEdit(RefundReview):
    action: Literal['edit_draft']


class Clarification(StrictModel):
    action: Literal['provide_clarification']
    recognized_work_minor: int = Field(ge=0, le=30000)
    notes: str = Field(min_length=3, max_length=2000)


def validate_refund_resume(stage, value):
    if stage == 'review_refund':
        return RefundReview.model_validate(value).model_dump()
    if stage == 'clarify_refund':
        return Clarification.model_validate(value).model_dump()
    if stage == 'refund_client_decision':
        return Decision.model_validate(value).model_dump()
    if stage == 'send_refund' and isinstance(value, dict) and value.get('action') == 'edit_draft':
        return RefundEdit.model_validate(value).model_dump()
    commands = {'review_refund_case': {'confirm_case'}, 'send_refund': {'simulate_send'},
                'authorize_refund': {'authorize_simulated_refund'},
                'refund_provider_result': {'simulate_pending', 'simulate_completed', 'simulate_failed'}}
    if stage not in commands or not isinstance(value, dict) or set(value) != {'action'} or value['action'] not in commands[stage]:
        raise ValueError('La acción no corresponde al paso pendiente.')
    return value


class RefundState(TypedDict, total=False):
    context: dict
    document: dict
    status: str
    business_status: str
    steps: list
    case: dict
    sources: list
    policy_sources: list
    analysis: dict
    calculation: dict
    proposal: dict
    revisions: list
    draft_snapshots: list
    events: list
    refund: dict | None
    blocked_reason: str | None
    decision: dict
    editing_draft: bool
    feedback: str
    feedback_document_id: str | None


def calculate(case, work):
    remaining = case['gross_minor'] - case['previous_refunds_minor']
    refund = max(case['gross_minor'] - work - case['previous_refunds_minor'], 0)
    if not 0 <= refund <= remaining:
        raise ValueError('El importe supera el saldo reembolsable.')
    return {'currency': 'USD', 'gross_minor': case['gross_minor'], 'original_fee_minor': case['fee_minor'],
            'original_net_minor': case['gross_minor'] - case['fee_minor'],
            'previous_refunds_minor': case['previous_refunds_minor'], 'remaining_refundable_minor': remaining,
            'recognized_work_minor': work, 'proposed_refund_minor': refund,
            'net_after_refund_minor': case['gross_minor'] - case['fee_minor'] - case['previous_refunds_minor'] - refund,
            'fee_treatment': 'merchant_cost_not_deducted_from_customer_refund'}


def analysis(state):
    case = state['case']
    return {'mode': 'simulation', 'inference_performed': False,
            'summary': 'El cliente solicita cancelar y recuperar la parte del anticipo no reconocida como trabajo realizado.',
            'client_feedback': state.get('feedback', ''),
            'evidence': [{'source_id': s['id'], 'quote': s['text']} for s in state['sources']],
            'policy_refs': [p['id'] for p in POLICIES],
            'needs': ['Confirmar el valor del trabajo reconocido antes de proponer un importe.'] if case['recognized_work_minor'] is None else [],
            'unknowns': ['No se estima conversión a otra moneda ni fecha de abono al comprador.'],
            'days_since_payment': (date.fromisoformat(case['as_of']) - date.fromisoformat(case['paid_on'])).days,
            'cost_note': 'La comisión pertenece al costo del vendedor; no se resta automáticamente de lo que se propone devolver.'}


def build_refund_flow(checkpointer):
    chain = RunnableLambda(analysis)

    def initialize(state):
        params = RefundInput.model_validate(state['document'])
        case = {'client': 'Estudio Norte', 'project': 'Identidad visual', 'country': 'PE',
                'payment_type': 'goods_and_services', 'capture_id': 'SIM-CAPTURE-REFUND',
                'payment_status': 'COMPLETED', 'gross_minor': 30000, 'fee_minor': 1000,
                'previous_refunds_minor': 5000 if params.fixture_id == 'previous_refund' else 0,
                'recognized_work_minor': None if params.fixture_id == 'unclear' else 20000,
                'paid_on': '2026-01-01' if params.fixture_id == 'expired' else '2026-10-20', 'as_of': '2026-10-26'}
        sources = [{'id': 'sim-agreement', 'kind': 'agreement', 'title': 'Acuerdo inicial · ejemplo', 'text': 'Proyecto de USD 600 con anticipo de USD 300. El cierre deberá reconocer el trabajo acordado por ambas partes.'},
                   {'id': 'sim-request', 'kind': 'request', 'title': 'Correo del cliente · ejemplo', 'text': 'Necesito cancelar el proyecto. Quisiera revisar la devolución de la parte del anticipo que no se utilizó.'},
                   {'id': 'sim-work', 'kind': 'delivery', 'title': 'Respuesta sobre el trabajo · ejemplo', 'text': 'Falta acordar el valor de lo realizado.' if params.fixture_id == 'unclear' else 'Reconocemos USD 200 por las primeras propuestas de identidad visual.'}]
        return {'case': case, 'sources': sources, 'policy_sources': deepcopy(POLICIES), 'events': [],
                'revisions': [], 'draft_snapshots': [], 'editing_draft': False, 'feedback': '',
                'feedback_document_id': None, 'refund': None, 'status': 'processing',
                'business_status': 'Solicitud registrada', 'steps': ['register_refund_request']}

    def review_case(state):
        interrupt({'stage': 'review_refund_case', 'case': state['case'], 'sources': state['sources'], 'allowed_actions': ['confirm_case']})
        return {'steps': [*state['steps'], 'case_reviewed']}

    def analyze(state):
        result = chain.invoke(state)
        for citation in result['evidence']:
            if not any(s['id'] == citation['source_id'] and citation['quote'] in s['text'] for s in state['sources']):
                raise ValueError('Cita sin respaldo.')
        return {'analysis': result, 'business_status': 'Propuesta en preparación', 'steps': [*state['steps'], 'analyze_refund']}

    def hold(state):
        return {'status': 'blocked', 'business_status': 'Requiere revisión', 'blocked_reason': 'REFUND_WINDOW_EXCEEDED',
                'steps': [*state['steps'], 'refund_window_exceeded']}

    def clarify(state):
        value = interrupt({'stage': 'clarify_refund', 'needs': state['analysis']['needs'], 'allowed_actions': ['provide_clarification']})
        answer = Clarification.model_validate(value)
        case = {**state['case'], 'recognized_work_minor': answer.recognized_work_minor}
        source = {'id': 'sim-clarification-' + str(uuid4()), 'kind': 'clarification', 'title': 'Aclaración aportada · ejemplo', 'text': answer.notes}
        return {'case': case, 'sources': [*state['sources'], source], 'steps': [*state['steps'], 'clarification_recorded']}

    def review(state):
        value = interrupt({'stage': 'review_refund', 'analysis': state['analysis'],
                           'calculation': calculate(state['case'], state['case']['recognized_work_minor']),
                           'allowed_actions': ['approve_refund_proposal']})
        approved = RefundReview.model_validate(value)
        calculation = calculate(state['case'], approved.recognized_work_minor)
        proposal = {'recognized_work_minor': approved.recognized_work_minor, 'terms': approved.terms,
                    'refund_minor': calculation['proposed_refund_minor'], 'currency': 'USD'}
        return {'proposal': proposal, 'calculation': calculation, 'steps': [*state['steps'], 'refund_proposal_reviewed']}

    def draft(state):
        previous = state['revisions'][-1] if state['revisions'] else None
        editing = state.get('editing_draft', False)
        if editing and (not previous or any(e['event'] == 'revision_sent' and e['snapshot_id'] == previous['snapshot_id'] for e in state['events'])):
            raise ValueError('No se puede editar una propuesta enviada.')
        if previous and not editing and (state.get('decision', {}).get('action') != 'request_revision' or not state.get('feedback_document_id')):
            raise ValueError('La nueva versión requiere una respuesta del cliente.')
        proposal = deepcopy(state['proposal'])
        version = previous['version'] if editing else len(state['revisions']) + 1
        text = json.dumps({'version': version, 'proposal': proposal}, sort_keys=True, ensure_ascii=False)
        revision = {'revision_id': previous['revision_id'] if editing else str(uuid4()), 'snapshot_id': str(uuid4()),
                    'version': version, 'draft_sequence': previous['draft_sequence'] + 1 if editing else 1,
                    'proposal': proposal, 'calculation': deepcopy(state['calculation']), 'content_sha256': sha256(text.encode()).hexdigest(),
                    'content': text, 'source_refs': deepcopy(state['analysis']['evidence']), 'policy_refs': deepcopy(state['policy_sources']),
                    'feedback_notes': state.get('feedback', ''), 'feedback_document_id': state.get('feedback_document_id'),
                    'created_at': now(), 'mode': 'simulation', 'pdf_generated': False}
        revisions = [*state['revisions'][:-1], revision] if editing else [*state['revisions'], revision]
        event = {'event': 'draft_updated' if editing else 'revision_saved', 'snapshot_id': revision['snapshot_id'], 'revision_id': revision['revision_id'], 'at': now(), 'internal': editing, 'mode': 'simulation'}
        return {'revisions': revisions, 'draft_snapshots': [*state['draft_snapshots'], deepcopy(revision)],
                'events': [*state['events'], event], 'editing_draft': False, 'business_status': 'Propuesta en borrador'}

    def send(state):
        revision = state['revisions'][-1]
        command = interrupt({'stage': 'send_refund', 'revision': revision, 'allowed_actions': ['edit_draft', 'simulate_send']})
        if command['action'] == 'edit_draft':
            value = RefundEdit.model_validate(command)
            calculation = calculate(state['case'], value.recognized_work_minor)
            return {'proposal': {'recognized_work_minor': value.recognized_work_minor, 'terms': value.terms, 'refund_minor': calculation['proposed_refund_minor'], 'currency': 'USD'}, 'calculation': calculation, 'editing_draft': True}
        event = {'event': 'revision_sent', 'snapshot_id': revision['snapshot_id'], 'content_sha256': revision['content_sha256'], 'at': now(), 'mode': 'simulation'}
        return {'events': [*state['events'], event], 'business_status': 'Esperando respuesta', 'editing_draft': False}

    def client(state):
        revision = state['revisions'][-1]
        command = interrupt({'stage': 'refund_client_decision', 'revision': revision, 'allowed_actions': ['accept', 'request_revision', 'reject']})
        decision = Decision.model_validate(command).model_dump()
        event = {'event': 'client_' + decision['action'], 'snapshot_id': revision['snapshot_id'], 'at': now(), 'mode': 'simulation'}
        sources=state['sources']
        if decision['action']=='request_revision':
            sources=[*sources, {'id': decision['feedback_document_id'], 'kind': 'feedback', 'title': 'Ajustes del cliente · ejemplo', 'text': decision['feedback_notes']}]
        return {'decision': decision, 'feedback': decision['feedback_notes'], 'feedback_document_id': decision['feedback_document_id'], 'sources': sources, 'events': [*state['events'], event]}

    def authorize(state):
        if state['proposal']['refund_minor'] == 0:
            return {'business_status': 'Cierre acordado · sin devolución'}
        interrupt({'stage': 'authorize_refund', 'revision': state['revisions'][-1], 'calculation': state['calculation'], 'allowed_actions': ['authorize_simulated_refund']})
        return {'business_status': 'Reembolso pendiente', 'events': [*state['events'], {'event': 'refund_authorized', 'snapshot_id': state['revisions'][-1]['snapshot_id'], 'at': now(), 'mode': 'simulation'}]}

    def provider(state):
        if state['proposal']['refund_minor'] == 0:
            return {'status': 'ready', 'business_status': 'Cierre acordado · sin devolución'}
        answer = interrupt({'stage': 'refund_provider_result', 'refund': state.get('refund'), 'allowed_actions': ['simulate_pending', 'simulate_completed', 'simulate_failed']})
        status = {'simulate_pending': 'PENDING', 'simulate_completed': 'COMPLETED', 'simulate_failed': 'FAILED'}[answer['action']]
        refund = {'id': 'SIM-REFUND-' + state['document']['request_id'], 'capture_id': state['case']['capture_id'],
                  'snapshot_id': state['revisions'][-1]['snapshot_id'], 'amount_minor': state['proposal']['refund_minor'],
                  'currency': 'USD', 'status': status, 'mode': 'simulation', 'provider_verified': False}
        return {'refund': refund, 'status': 'ready' if status == 'COMPLETED' else 'refund_failed' if status == 'FAILED' else 'processing',
                'business_status': 'Devolución completada' if status == 'COMPLETED' else 'No se completó el reembolso' if status == 'FAILED' else 'Reembolso pendiente'}

    def reject(state):
        return {'status': 'rejected', 'business_status': 'Propuesta rechazada'}

    graph = StateGraph(RefundState)
    for name, fn in [('register_refund', initialize), ('review_case', review_case), ('analyze_refund', analyze), ('hold_refund', hold), ('clarify_refund', clarify), ('review_refund', review), ('save_refund_revision', draft), ('send_refund', send), ('refund_client', client), ('authorize_refund', authorize), ('refund_result', provider), ('reject_refund', reject)]:
        graph.add_node(name, fn)
    graph.add_edge(START, 'register_refund'); graph.add_edge('register_refund', 'review_case'); graph.add_edge('review_case', 'analyze_refund')
    graph.add_conditional_edges('analyze_refund', lambda s: 'hold_refund' if s['analysis']['days_since_payment'] > 180 else 'clarify_refund' if s['analysis']['needs'] else 'review_refund')
    graph.add_edge('clarify_refund', 'analyze_refund'); graph.add_edge('hold_refund', END)
    graph.add_edge('review_refund', 'save_refund_revision'); graph.add_edge('save_refund_revision', 'send_refund')
    graph.add_conditional_edges('send_refund', lambda s: 'save_refund_revision' if s.get('editing_draft') else 'refund_client')
    graph.add_conditional_edges('refund_client', lambda s: {'accept': 'authorize_refund', 'request_revision': 'analyze_refund', 'reject': 'reject_refund'}[s['decision']['action']])
    graph.add_edge('authorize_refund', 'refund_result')
    graph.add_conditional_edges('refund_result', lambda s: 'refund_result' if s['status'] == 'processing' else END)
    graph.add_edge('reject_refund', END)
    return graph.compile(checkpointer=checkpointer)
