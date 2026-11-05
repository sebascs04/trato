"""Resolve documentary refund context from authorized records, never from file text."""
import json
from .errors import ApiError
from .persistence import uuid


def document_refund_link(repo, owner, project, document):
    common = {'owner_id': 'eq.' + owner, 'project_id': 'eq.' + project['id']}
    links = []
    for table, field, role in (
        ('refund_artifacts', 'document_id', 'proposal'),
        ('refund_acceptances', 'evidence->>document_id', 'acceptance'),
        ('refund_feedback', 'evidence->>document_id', 'feedback'),
    ):
        rows = repo.rows(table, {'select': 'settlement_id,snapshot_id', field: 'eq.' + document['id'], **common})
        links.extend({**row, 'role': role} for row in rows)
    # A contract or change request reused as evidence keeps its original purpose.
    if not links and document['kind'] == 'reference':
        requests = repo.rows('refund_settlements', {'select': 'id', **common,
            'request_evidence': 'cs.' + json.dumps([{'document_id': document['id']}], separators=(',', ':'))})
        links.extend({'settlement_id': row['id'], 'snapshot_id': None, 'role': 'request'} for row in requests)
        if not links:
            rows = repo.rows('refund_sources', {'select': 'settlement_id,snapshot_id',
                'document_id': 'eq.' + document['id'], **common, 'order': 'settlement_id.asc,snapshot_id.asc', 'limit': 101})
            if len(rows) > 100: raise ApiError('FILE_PURPOSE_CONTEXT_INVALID', 409)
            links.extend({**row, 'role': 'evidence'} for row in rows)
    if not links: return None
    cases = {row['settlement_id'] for row in links}
    if len(cases) != 1: raise ApiError('FILE_PURPOSE_CONTEXT_INVALID', 409)
    snapshots = sorted({row['snapshot_id'] for row in links if row['snapshot_id']})
    bindings = {'refund_case_id': next(iter(cases))}
    if len(snapshots) == 1: bindings['snapshot_id'] = snapshots[0]
    return {'purpose': 'refund_request' if all(row['role'] == 'request' for row in links) else 'refund_evidence',
            'bindings': bindings, 'links': sorted(links, key=lambda row: (row['role'], row['snapshot_id'] or ''))}


def refund_context(repo, owner, project, bindings, link=None):
    common = {'owner_id': 'eq.' + owner, 'project_id': 'eq.' + project['id']}
    bindings = dict(bindings)
    case_id = bindings.get('refund_case_id')
    proof = []
    context = {}
    if case_id:
        cases = repo.rows('refund_settlements', {'select': 'id,payment_id,scope,reason,requested_by,request_evidence',
            'id': 'eq.' + uuid(case_id), **common})
        if len(cases) != 1: raise ApiError('FILE_PURPOSE_CONTEXT_INVALID', 409)
        case = cases[0]
        if bindings.get('payment_id') and bindings['payment_id'] != case['payment_id']:
            raise ApiError('FILE_PURPOSE_CONTEXT_INVALID', 409)
        bindings.update(refund_case_id=case['id'], payment_id=case['payment_id'])
        members = repo.rows('refund_settlement_payments', {'select': 'payment_id',
            'settlement_id': 'eq.' + case['id'], **common, 'order': 'payment_id.asc', 'limit': 101})
        if not members or len(members) > 100 or case['payment_id'] not in {row['payment_id'] for row in members}:
            raise ApiError('FILE_PURPOSE_CONTEXT_INVALID', 409)
        payment_ids = sorted({row['payment_id'] for row in members})
        context['refund_case'] = case
        proof.extend([case, members])
        if bindings.get('snapshot_id'):
            snapshots = repo.rows('refund_snapshots', {'select': 'id,settlement_id,version_no,content_sha256',
                'id': 'eq.' + uuid(bindings['snapshot_id']), 'settlement_id': 'eq.' + case['id'], **common})
            if len(snapshots) != 1: raise ApiError('FILE_PURPOSE_CONTEXT_INVALID', 409)
            context['snapshot'] = snapshots[0]; proof.extend(snapshots)
        if link:
            context['document_roles'] = sorted({row['role'] for row in link['links']})
            proof.append(link['links'])
    else:
        if not bindings.get('payment_id'): raise ApiError('FILE_PAYMENT_BINDING_REQUIRED', 422)
        payment_ids = [uuid(bindings['payment_id'])]
    payments = repo.rows('project_received_payments', {'select': 'id,origin,amount_minor,currency,verified_at',
        'id': 'in.(' + ','.join(payment_ids) + ')', **common, 'order': 'id.asc', 'limit': 101})
    if ({row['id'] for row in payments} != set(payment_ids) or
        any(not row.get('verified_at') for row in payments)):
        raise ApiError('FILE_PAYMENT_NOT_CONFIRMED', 409)
    context['verified_received_payments'] = payments
    proof.extend(payments)
    return bindings, {'case_description': json.dumps(context, ensure_ascii=False, sort_keys=True)}, proof
