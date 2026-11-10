"""Authorized read context and reviewable suggestions for TeTrato in refunds."""
from datetime import datetime, timezone
import json
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .errors import ApiError
from .gmail.service import display_reply
from .vector_contract import digest

REPLY_SEPARATOR = '\n\nClient reply (literal):\n'

REFUND_TOOL = {
    'name': 'read_refund_status',
    'description': 'Reads the selected refund, proposal, verified payments, refund confirmations, payment incidents, and recorded client replies. Before registration it reads verified project payments and refund statuses.',
    'when_to_use': 'Use first on every refund turn. Explain the current step and rely on these records for status and amounts.',
    'parameters': {'type': 'object', 'additionalProperties': False, 'required': [], 'properties': {}},
}


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid')


class RefundFocus(Strict):
    step: int = Field(strict=True, ge=1, le=6)
    conversation_id: UUID | None = None
    settlement_id: UUID | None = None
    snapshot_id: UUID | None = None
    response_id: UUID | None = None
    support_document_id: UUID | None = None
    scope: Literal['payment_only', 'project_closure'] | None = None
    payment_id: UUID | None = None
    evidence_ids: list[UUID] = Field(default_factory=list, max_length=20)
    task: Literal['guide', 'intake', 'request', 'proposal', 'email', 'reply'] = 'guide'

    @model_validator(mode='after')
    def valid_context(self):
        if self.settlement_id is None:
            if self.step != 1 or self.snapshot_id or self.response_id or self.support_document_id or self.task not in ('guide', 'intake', 'request'):
                raise ValueError('invalid request focus')
        elif self.payment_id or self.scope or self.evidence_ids or self.task in ('intake', 'request'):
            raise ValueError('invalid settlement focus')
        if self.task == 'proposal' and self.step != 2:
            raise ValueError('invalid proposal focus')
        if self.task == 'email' and (self.step != 3 or not self.snapshot_id):
            raise ValueError('invalid email focus')
        if self.task == 'reply' and (self.step != 4 or not (self.response_id or self.support_document_id)):
            raise ValueError('invalid reply focus')
        if (self.response_id or self.support_document_id) and (not self.snapshot_id or self.step != 4 or self.response_id and self.support_document_id):
            raise ValueError('invalid response focus')
        return self


class Concept(Strict):
    model_config = ConfigDict(strict=True)
    kind: Literal['recognized_work', 'expense', 'penalty', 'other']
    beneficiary: Literal['seller', 'customer']
    description: str = Field(min_length=1, max_length=600)
    citation_indices: list[int] = Field(min_length=1, max_length=6)


class Intake(Strict):
    scope: Literal['payment_only', 'project_closure']
    payment_id: UUID | None
    requested_by: Literal['customer', 'seller', 'mutual']
    reason: str = Field(min_length=1, max_length=600)


class Guidance(Strict):
    next_step: str = Field(max_length=280)
    reason: str | None = Field(max_length=600)
    conditions: str | None = Field(max_length=1200)
    email_note: str | None = Field(default=None, max_length=600)
    concepts: list[Concept] = Field(max_length=6)
    intake: Intake | None = None


def project_refund_summary(repo, owner, project):
    return repo.rows('refund_settlements', {
        'select': 'status,scope,confirmed_refund_minor,created_at,closed_at',
        'owner_id': 'eq.' + owner, 'project_id': 'eq.' + project['id'],
        'order': 'created_at.desc,id.asc', 'limit': 20,
    })


def financial_facts(lookup, owner, project, parent, payments):
    view = lookup('refund_finance_backend', {
        'p_owner': owner, 'p_action': 'context', 'p_data': {'settlement_id': parent['id']},
    })
    item = view['settlement']
    if (item['owner_id'], item['project_id'], item['id'], item['current_snapshot_id'], item['status']) != (
        owner, project['id'], parent['id'], parent['current_snapshot_id'], parent['status'],
    ):
        raise ApiError('REFUND_REVISION_CONFLICT', 409)

    payment_ids = {p['id'] for p in payments}
    receipts = {r['id']: r for r in view['receipts'] if r['payment_id'] in payment_ids and r['status']=='completed'}
    applied = {}
    for link in view['applications']:
        if link['settlement_id']==parent['id'] and link['receipt_id'] in receipts:
            applied.setdefault(link['operation_id'], []).append(receipts[link['receipt_id']])
    operations = []
    for operation in view['operations']:
        if operation['payment_id'] not in payment_ids:
            raise ApiError('REFUND_PAYMENT_CONTEXT_MISMATCH', 409)
        confirmed = [r for r in applied.get(operation['id'], []) if r['payment_id']==operation['payment_id']]
        operations.append({
            **{key: operation[key] for key in ('payment_id', 'status', 'amount_minor')},
            'confirmed_minor': sum(receipt['amount_minor'] for receipt in confirmed),
            'confirmed_at': max((receipt['confirmed_at'] for receipt in confirmed if receipt['confirmed_at']), default=None),
            'confirmed_environments': sorted({receipt['environment'] for receipt in confirmed}),
        })
    return {
        'operations': operations,
        'confirmed_minor': sum(op['confirmed_minor'] for op in operations),
        'recorded_completed_minor': parent['confirmed_refund_minor'] or 0,
        'payment_incidents': [
            {key: incident[key] for key in ('payment_id', 'code', 'created_at')}
            for incident in view['incidents'] if incident['payment_id'] in payment_ids
        ],
        'provider_disputes_available': False,
    }


def context(repo, owner, project, focus, *, financial_lookup=None):
    scope = {'owner_id': 'eq.' + owner, 'project_id': 'eq.' + project['id']}
    def rows(table, select, **filters):
        result = repo.rows(table, {'select': select, **scope, **filters, 'limit': 101})
        if len(result) > 100:
            raise ApiError('AI_CONTEXT_LIMIT', 413)
        return result

    settlement_id = focus['settlement_id']
    record = {'project_status': project['status'], 'step_viewed': focus['step']}
    linked = set(focus['evidence_ids'])
    if not settlement_id:
        payments = rows('project_received_payments', 'id,origin,amount_minor,currency,verified_at',
                        verified_at='not.is.null', order='id.asc')
        if focus['payment_id'] and not any(p['id'] == focus['payment_id'] for p in payments):
            raise ApiError('REFUND_NOT_FOUND', 404)
        bindings=rows('document_upload_contexts','document_id,refund_case_id',
                      document_id='in.('+','.join(sorted(linked))+')') if linked else []
        if any(row['refund_case_id'] for row in bindings):
            raise ApiError('REFUND_EVIDENCE_MISMATCH',409)
        record.update(payments=payments, selected_payment=focus['payment_id'], requested_scope=focus['scope'],
                      recent_refunds=project_refund_summary(repo,owner,project),
                      open_refunds=rows('refund_settlements', 'id,status,scope',
                                        status='not.in.(completed,closed_without_refund,rejected,withdrawn)', order='id.asc'),
                      open_change=bool({row['id'] for row in rows('documents', 'id', kind='eq.email_request', deleted_at='is.null')} - closed_requests(rows)))
    else:
        parent_scope = {'settlement_id': 'eq.' + settlement_id}
        parents = rows('refund_settlements', 'id,status,scope,reason,requested_by,request_evidence,current_snapshot_id,confirmed_refund_minor',
                       id='eq.' + settlement_id)
        if len(parents) != 1:
            raise ApiError('REFUND_NOT_FOUND', 404)
        parent = parents[0]
        linked.update(ref['document_id'] for ref in parent['request_evidence'])
        uploaded=rows('document_upload_contexts','document_id,snapshot_id',refund_case_id='eq.'+settlement_id)
        linked.update(row['document_id'] for row in uploaded if row['snapshot_id'] in (None, focus['snapshot_id']))
        snapshot_id = focus['snapshot_id']
        if snapshot_id is None and parent['current_snapshot_id'] is not None:
            raise ApiError('AI_CONTEXT_INVALID', 409)
        record.update(settlement=parent, viewed_is_current=snapshot_id == parent['current_snapshot_id'])
        if focus['task'] == 'email' and (not record['viewed_is_current'] or parent['status'] != 'draft'):
            raise ApiError('AI_CONTEXT_INVALID', 409)
        if focus['task'] == 'proposal' and (not record['viewed_is_current'] or parent['status'] not in ('draft', 'adjustments_requested')):
            raise ApiError('AI_CONTEXT_INVALID', 409)

        members = rows('refund_settlement_payments', 'payment_id', **parent_scope, order='payment_id.asc')
        ids = [item['payment_id'] for item in members]
        record['payments'] = rows('project_received_payments', 'id,origin,amount_minor,currency,verified_at',
                                  id='in.(' + ','.join(ids) + ')', order='id.asc') if ids else []
        revisions=rows('proposal_payments','revision_id',id='in.('+','.join(
            p['id'] for p in record['payments'] if p['origin']=='change')+')') if any(
            p['origin']=='change' for p in record['payments']) else []
        if revisions:
            linked.update(row['document_id'] for row in rows('proposal_artifacts','document_id',
                revision_id='in.('+','.join(sorted({item['revision_id'] for item in revisions}))+')'))
        if focus['task']=='guide' and parent['status'] in ('accepted', 'refund_pending', 'completed'):
            record['finance'] = financial_facts(financial_lookup or repo.rpc, owner, project, parent, record['payments'])

        if snapshot_id:
            snap_scope = {**parent_scope, 'snapshot_id': 'eq.' + snapshot_id}
            snapshots = rows('refund_snapshots', 'id,version_no,terms,breakdown,content_sha256,feedback',
                             **parent_scope, id='eq.' + snapshot_id)
            if len(snapshots) != 1:
                raise ApiError('REFUND_SNAPSHOT_NOT_FOUND', 404)
            record['proposal'] = snapshots[0]
            linked.update(row['document_id'] for row in rows('refund_sources', 'document_id', **snap_scope))
            artifacts = rows('refund_artifacts', 'document_id', **snap_scope)
            linked.update(row['document_id'] for row in artifacts if row['document_id'])
            record['pdf_ready'] = any(row['document_id'] for row in artifacts)
            support = focus['support_document_id']
            if support:
                docs = rows('documents', 'id,kind,mime_type', id='eq.'+support, deleted_at='is.null')
                if (len(docs)!=1 or docs[0]['kind'] not in ('reference','delivery') or docs[0]['mime_type']!='application/pdf'
                    or support in {row['document_id'] for row in artifacts}):
                    raise ApiError('REFUND_EVIDENCE_MISMATCH', 409)
                from .refund_file_context import document_refund_link
                link = document_refund_link(repo,owner,project,docs[0])
                if link and link['bindings']['refund_case_id'] != settlement_id:
                    raise ApiError('REFUND_EVIDENCE_MISMATCH', 409)
                linked.add(support)
                record['selected_reply_document_id'] = support
            record['pdf_reviewed'] = bool(rows('refund_reviews', 'snapshot_id', **snap_scope))
            deliveries=rows('refund_deliveries','status',**snap_scope,order='created_at.desc,id.asc')
            record['delivery_status']=deliveries[0]['status'] if deliveries else None
            record['sent']=any(item['status']=='accepted_by_gmail' for item in deliveries)
            if focus['step']==4:
                responses=repo.rows('refund_client_responses',{'select':'received_at',**scope,**snap_scope,
                    'order':'received_at.desc,id.asc','limit':1})
                record['latest_response_received_at']=responses[0]['received_at'] if responses else None
            record['acceptance_recorded'] = bool(rows('refund_acceptances', 'snapshot_id', **snap_scope))
            record['authorization_recorded'] = bool(rows('refund_financial_authorizations', 'id', **snap_scope))
            if focus['step'] >= 5:
                checks=repo.rows('refund_financial_checks', {'select':'created_at,expires_at,evidence',**scope,
                    **snap_scope,'order':'created_at.desc,id.asc','limit':1})
                if checks:
                    check=checks[0]
                    record['check']={**{key:check[key] for key in ('created_at','expires_at')},
                        'unexpired':datetime.fromisoformat(check['expires_at']) > datetime.now(timezone.utc),
                        'payments':[{key:item[key] for key in ('payment_id','provider_remaining_minor','previous_refunds_minor','original_fee_minor','original_net_minor')}
                                    for item in check['evidence']]}
            feedback = rows('refund_feedback', 'evidence', **snap_scope)
            feedback_evidence = feedback[0]['evidence'] if feedback else snapshots[0]['feedback'] or {}
            if feedback_evidence.get('document_id'):
                linked.add(feedback_evidence['document_id'])
            reply_id = focus['response_id'] or feedback_evidence.get('email_id')
            if reply_id:
                reply_scope={**parent_scope,'snapshot_id':'eq.'+(snapshot_id if focus['response_id'] else feedback_evidence['snapshot_id'])}
                replies = rows('refund_client_responses', 'id,body_text,raw_message,attachments', **reply_scope, id='eq.' + reply_id)
                if len(replies) != 1:
                    raise ApiError('REFUND_EVIDENCE_MISMATCH', 409)
                reply = replies[0]
                shown = display_reply(reply['body_text'], reply['raw_message'])
                record['reply'] = {'id': reply['id'], 'text': shown['reply_text'],
                                   'needs_review': shown.get('reply_needs_review', False),
                                   'has_attachments': bool(reply['attachments'])}
                if len(record['reply']['text']) > 24000:
                    raise ApiError('AI_CONTEXT_LIMIT', 413)

    if focus['task'] in ('intake', 'guide'):
        payment_ids = {p['id'] for p in record['payments']}
        if focus['payment_id']:
            payment_ids &= {focus['payment_id']}
        events = rows('project_dispute_events', 'dispute_id,kind,details,happened_at',
                      kind='in.(dispute_opened,dispute_status)', order='happened_at.asc,event_key.asc')
        disputes = {}
        for event in events:
            details = event['details']
            if event['kind'] == 'dispute_opened' and details.get('received_payment_id') in payment_ids:
                disputes[event['dispute_id']] = {
                    'case_id': event['dispute_id'], 'payment_id': details['received_payment_id'],
                    'reason': details.get('reason'), 'amount': details.get('amount'),
                    'opened_at': event['happened_at'], 'last_recorded_status': None,
                }
        for event in events:
            dispute = disputes.get(event['dispute_id'])
            details = event['details']
            if dispute is not None and event['kind'] == 'dispute_status' and details.get('status'):
                dispute.update(last_recorded_status=details['status'], status_recorded_at=event['happened_at'],
                               outcome=details.get('outcome'))
        record['recorded_disputes'] = list(disputes.values())

    serialized=record
    reply_text=''
    if 'reply' in record:
        reply_text=record['reply']['text']
        serialized={**record,'reply':{key:value for key,value in record['reply'].items() if key!='text'}}
    text = json.dumps(serialized, ensure_ascii=False, sort_keys=True)
    if reply_text:text+=REPLY_SEPARATOR+reply_text
    if len(text.encode()) > 170000:
        raise ApiError('AI_CONTEXT_LIMIT', 413)
    evidence = {'file_id': project['id'], 'title': 'Refund record', 'generation': digest([record,sorted(linked)]),
                'source_kind': 'refund_status', 'text': text}
    evidence['source_id'] = digest(evidence)
    return evidence, linked


def closed_requests(rows):
    closed = {r['request_document_id'] for r in rows('request_closures', 'request_document_id')}
    for change in rows('change_proposals', 'request_document_id,locked_at'):
        if change['locked_at'] is not None:
            closed.add(change['request_document_id'])
    return closed


def refund_documents(documents, linked, focus):
    if focus['task']=='request':
        return [doc for doc in documents if doc['id'] in linked]
    return [doc for doc in documents if doc['id'] in linked or doc['kind'] in ('initial_agreement', 'delivery')]


def materialize(focus, result, citations, stored, checked, record):
    try:
        guidance = Guidance.model_validate(result.get('refund')).model_dump(mode='json')
    except ValueError:
        raise ApiError('AI_INVALID_RESPONSE', 502) from None
    intake=guidance['intake']
    if intake is not None:
        if focus['task']!='intake' or result['status']!='answered':
            raise ApiError('AI_INVALID_RESPONSE',502)
        facts=json.loads(record['text'])
        # Intake is a local draft. The existing refund command checks the open-request
        # gate under the project lock when the user actually registers it.
        if facts['project_status']=='closed' or not facts['payments']:
            raise ApiError('AI_CONTEXT_INVALID',409)
        if not intake['reason'].strip() or (intake['scope']=='payment_only')!=bool(intake['payment_id']):
            raise ApiError('AI_INVALID_RESPONSE',502)
        if intake['payment_id'] and not any(payment['id']==intake['payment_id'] for payment in facts['payments']):
            raise ApiError('REFUND_NOT_FOUND',404)
    if len(result['answer'])>640 or len(result['missing_information'])>3:
        raise ApiError('AI_INVALID_RESPONSE',502)
    for name in ('reason','conditions','email_note'):
        if guidance[name] is not None:
            guidance[name]=guidance[name].strip()
            if not guidance[name]:raise ApiError('AI_INVALID_RESPONSE',502)
    if guidance['email_note'] and any(ord(c)<32 and c!='\n' for c in guidance['email_note']):
        raise ApiError('AI_INVALID_RESPONSE',502)
    if (guidance['reason'] is not None and focus['task'] != 'request' or
        (guidance['conditions'] is not None or guidance['concepts']) and focus['task'] != 'proposal' or
        guidance['email_note'] is not None and focus['task'] != 'email' or
        result['status'] != 'answered' and (guidance['reason'] is not None or guidance['conditions'] is not None or guidance['email_note'] is not None or guidance['concepts'])):
        raise ApiError('AI_INVALID_RESPONSE', 502)
    if (guidance['reason'] or guidance['conditions']) and not any(c['source_kind'] == 'original' for c in citations):
        raise ApiError('AI_INVALID_CITATION', 502)
    if focus['task'] in ('email','reply') and result['status']=='answered':
        if not any(c['source_kind']=='refund_status' for c in citations):raise ApiError('AI_INVALID_CITATION',502)
        if focus['support_document_id'] and not any(c['source_kind']=='original' and c['file_id']==focus['support_document_id'] for c in citations):
            raise ApiError('AI_INVALID_CITATION',502)
        if focus['response_id'] and not any(
            item['quote'] in stored[item['source_id']]['text'].partition(REPLY_SEPARATOR)[2]
            for item,entry in zip(result['citations'],citations) if entry['source_kind']=='refund_status'
        ):
            raise ApiError('AI_INVALID_CITATION',502)
    for item in guidance['concepts']:
        if item['kind'] == 'recognized_work' and item['beneficiary'] != 'seller':
            raise ApiError('AI_INVALID_RESPONSE', 502)
        refs = []
        for index in item.pop('citation_indices'):
            if type(index) is not int or not 0 <= index < len(citations) or citations[index]['source_kind'] != 'original':
                raise ApiError('AI_INVALID_CITATION', 502)
            citation = result['citations'][index]
            entry = citations[index]
            original = checked[entry['file_id']]
            if original['generation'] != entry['generation'] or not any(
                seg['segment_id'] == stored[citation['source_id']].get('segment_id') and citation['quote'] in seg['text']
                for seg in original['segments']
            ):
                raise ApiError('AI_INVALID_CITATION', 502)
            refs.append({'document_id': entry['file_id'], 'extraction_id': original['extraction']['id'],
                         'document_sha256': original['document']['sha256'], 'quote': citation['quote']})
        item['evidence'] = refs
    return guidance
