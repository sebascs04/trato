"""PayPal disputes on a project's verified payments, shown to the freelancer inside Trato.

The backend authorizes the project with the user's session (RLS), takes the captures PayPal already verified
(project_received_payments) and asks PayPal only about those, through the official PayPal Agent Toolkit. Nothing is sent to PayPal from here."""
import json
import logging
import re
import time
from hashlib import sha256
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from typing import Literal
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from redis.exceptions import RedisError
from starlette.concurrency import run_in_threadpool

from paypal.agent_toolkit import AgentToolkit
from paypal.client import PayPalError, PayPalSandboxClient
from paypal.config import SandboxSettings
from .ai_jobs import AIJobs, PREFIX
from .business_routes import ingestion, read_bytes
from .dispute_history import record_accepted_claim, record_disputes, record_escalation, record_evidence
from .errors import ApiError
from .model_preferences import ModelPreferences
from .persistence import Repository, uuid

ACTIONS = ('send_message', 'make_offer', 'accept_claim', 'escalate', 'provide_evidence', 'appeal',
           'acknowledge_return_item', 'provide_supporting_info', 'require_evidence', 'adjudicate')
CAPTURE = re.compile(r'[A-Za-z0-9]{8,32}')
DEFENSE_ACTIONS = ('send_message', 'make_offer', 'accept_claim', 'escalate', 'provide_evidence')
MAX_REPLIES = 5
MAX_DOCUMENT_BYTES = 10 * 1024 * 1024 - 1  # PayPal: less than 10 MB per file.
MAX_TOTAL_BYTES = 50 * 1024 * 1024
MAX_DOCUMENTS = 10
SENDABLE = {'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif'}
CLIENT_ATTACHMENT_TITLE = 'Client attachment · '  # The defense prompt relies on this prefix to tell the client's word from project records.


def text(value, limit):
    return value[:limit] if isinstance(value, str) else None


def summarize(dispute, payment):
    """Only the fields Trato shows; the raw provider document is never forwarded."""
    if not isinstance(dispute, dict) or not re.fullmatch(r'PP-[A-Z0-9-]{4,40}', dispute.get('dispute_id') or ''):
        raise ApiError('INVALID_PROVIDER_RESPONSE', 502)
    tx = next((t for t in dispute.get('disputed_transactions') or [] if isinstance(t, dict)), {})
    if tx.get('seller_transaction_id') != payment['capture_id']:
        return None  # PayPal returned a dispute for another transaction; never attach it to this project.
    amount = dispute.get('dispute_amount') if isinstance(dispute.get('dispute_amount'), dict) else {}
    messages = [{'by': m.get('posted_by') if m.get('posted_by') in ('BUYER', 'SELLER', 'ARBITER') else 'OTHER',
                 'at': text(m.get('time_posted'), 40), 'text': text(m.get('content'), 4000) or '',
                 'documents': [text(d.get('name'), 120) or 'document' for d in m.get('documents') if isinstance(d, dict)] if isinstance(m.get('documents'), list) else []}
                for m in (dispute.get('messages') or [])[:30] if isinstance(m, dict)]
    actions = sorted({l.get('rel') for l in dispute.get('links') or [] if isinstance(l, dict) and l.get('rel') in ACTIONS})
    return {'dispute_id': dispute['dispute_id'], 'reason': text(dispute.get('reason'), 80), 'status': text(dispute.get('status'), 60),
            'stage': text(dispute.get('dispute_life_cycle_stage'), 40), 'outcome': text((dispute.get('dispute_outcome') or {}).get('outcome_code'), 60),
            'amount': {'value': text(amount.get('value'), 20), 'currency': text(amount.get('currency_code'), 3)},
            'response_due': text(dispute.get('seller_response_due_date'), 40),
            'created_at': text(dispute.get('create_time'), 40), 'updated_at': text(dispute.get('update_time'), 40),
            'messages': messages, 'actions': actions,
            'payment': {k: payment.get(k) for k in ('id', 'origin', 'capture_id', 'amount_minor', 'currency', 'verified_at', 'proposal_payment_id')}}


def dispute_refund_ids(details):
    """Provider references only. Payments v2 still verifies each refund."""
    refund = details.get('refund_details')
    transactions = refund.get('transactions') if isinstance(refund, dict) else None
    if not transactions:
        return set()
    if not isinstance(transactions, list) or len(transactions) > 100:
        raise ApiError('INVALID_PROVIDER_RESPONSE', 502)
    ids = [item.get('id') if isinstance(item, dict) else None for item in transactions]
    if not all(isinstance(rid, str) and re.fullmatch(r'[A-Za-z0-9_-]{1,64}', rid) for rid in ids):
        raise ApiError('INVALID_PROVIDER_RESPONSE', 502)
    return set(ids)


class DisputeReader:
    def __init__(self, paypal=None):
        self.paypal = paypal

    def provider(self):
        if self.paypal is not None:
            return self.paypal  # Explicit test dependency, never an error fallback.
        config = SandboxSettings.from_env()
        if config.environment != 'sandbox':
            raise ApiError('LIVE_PAYMENTS_DISABLED', 503)
        if not all((config.client_id, config.client_secret, config.merchant_id)):
            raise ApiError('PAYPAL_SANDBOX_NOT_CONFIGURED', 503)
        return AgentToolkit(config.client_id, config.client_secret)

    def writer(self):
        if self.paypal is not None:
            return self.paypal
        config = SandboxSettings.from_env()
        if config.environment != 'sandbox':
            raise ApiError('LIVE_PAYMENTS_DISABLED', 503)
        return PayPalSandboxClient(config.client_id, config.client_secret, config.merchant_id)

    def project_disputes(self, repo, project_id, *, include_refund_refs=False):
        repo.project(project_id)  # 404 unless the signed-in freelancer owns this active project.
        payments = repo.rows('project_received_payments', {
            'select': 'id,origin,capture_id,amount_minor,currency,verified_at,proposal_payment_id',
            'project_id': 'eq.' + project_id, 'order': 'verified_at.desc'})
        client = self.provider()

        def read(payment):
            started = time.monotonic()
            listing = client.list_disputes(payment['capture_id'])
            listed = time.monotonic()
            values = []
            for item in listing.get('items') or []:
                if not isinstance(item, dict):
                    continue
                details = client.get_dispute(item.get('dispute_id'))
                dispute = summarize(details, payment)
                if dispute is None:
                    continue
                if include_refund_refs and dispute['status'] == 'RESOLVED' and dispute['outcome'] in ('RESOLVED_BUYER_FAVOUR', 'ACCEPTED'):
                    try:
                        dispute['_refund_refs'] = dispute_refund_ids(details)
                    except ApiError:
                        dispute['refund_sync'] = 'unavailable'
                values.append(dispute)
            # Timing only: no business data or identifiers.
            logging.getLogger(__name__).warning(json.dumps({'event': 'dispute_paypal_read', 'list_ms': round(1000 * (listed - started)),
                'get_ms': round(1000 * (time.monotonic() - listed)), 'disputes': len(values)}))
            return values
        valid = [p for p in payments if isinstance(p.get('capture_id'), str) and CAPTURE.fullmatch(p['capture_id'])]
        # Each payment is its own PayPal call: in parallel, a project with many payments stays about as fast as one with few.
        with ThreadPoolExecutor(max_workers=min(4, len(valid) or 1)) as pool:
            found = [value for values in pool.map(read, valid) for value in values]
        return {'project_id': project_id, 'payments_checked': len(payments), 'disputes': found}

    def open_disputes(self, repo):
        """Open disputes on any of the signed-in freelancer's verified payments, so the home page can warn without opening each project.
        RLS limits payments and projects to this freelancer; a dispute counts only if PayPal ties it to one of those captures."""
        payments = [p for p in repo.rows('project_received_payments', {
            'select': 'id,project_id,origin,capture_id,amount_minor,currency,verified_at,proposal_payment_id', 'order': 'verified_at.desc', 'limit': 200})
            if isinstance(p.get('capture_id'), str) and CAPTURE.fullmatch(p['capture_id'])]
        if not payments:
            return {'payments_checked': 0, 'disputes': []}
        projects = {p['id']: p for p in repo.rows('projects', {'select': 'id,client_id,name', 'deleted_at': 'is.null',
                                                               'id': 'in.(' + ','.join(sorted({p['project_id'] for p in payments})) + ')'})}
        payments = [p for p in payments if p['project_id'] in projects]
        client = self.provider()

        def read(payment):
            # Only a dispute PayPal does not already list as resolved is read in full.
            items = [i for i in client.list_disputes(payment['capture_id']).get('items') or [] if isinstance(i, dict) and i.get('status') != 'RESOLVED']
            return [(payment, value) for value in (summarize(client.get_dispute(i.get('dispute_id')), payment) for i in items) if value and value['status'] != 'RESOLVED']
        with ThreadPoolExecutor(max_workers=min(4, len(payments) or 1)) as pool:
            found = [pair for pairs in pool.map(read, payments) for pair in pairs]
        by_project = {}
        for payment, dispute in found:
            by_project.setdefault(payment['project_id'], []).append(dispute)
        # The same idempotent history the Disputes tab saves; a failure here never hides the warning.
        saved = all([record_disputes(repo, project_id, disputes) for project_id, disputes in by_project.items()])
        return {'payments_checked': len(payments), 'history_saved': saved, 'disputes': sorted([{
            'project_id': payment['project_id'], 'project_name': projects[payment['project_id']]['name'], 'client_id': projects[payment['project_id']]['client_id'],
            **{k: dispute[k] for k in ('dispute_id', 'reason', 'status', 'stage', 'amount', 'response_due')},
            # A dispute PayPal has just opened is already waiting for the freelancer's first answer.
            'your_turn': dispute['status'] in ('OPEN', 'WAITING_FOR_SELLER_RESPONSE') or 'provide_evidence' in dispute['actions']}
            for payment, dispute in found], key=lambda d: (not d['your_turn'], d['response_due'] or '9999'))}


class DefenseRequest(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    output_language: Literal['es', 'en']


class SendRequest(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    message: str = Field(min_length=1, max_length=2000)
    document_ids: list[UUID] = Field(max_length=MAX_DOCUMENTS)


class LinkRequest(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    document_id: UUID


class EvidenceRequest(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    notes: str = Field(min_length=1, max_length=2000)
    document_ids: list[UUID] = Field(min_length=1, max_length=MAX_DOCUMENTS)


class EscalateRequest(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    note: str = Field(min_length=1, max_length=2000)


class SandboxRequest(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    action: Literal['require_evidence', 'seller_favor', 'buyer_favor']


class Point(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    claim: str = Field(min_length=1, max_length=500)
    evidence_id: str = Field(min_length=1, max_length=64)
    quote: str = Field(min_length=1, max_length=1000)


class DocumentChoice(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    document_id: str = Field(min_length=1, max_length=40)
    recommended: bool
    reason: str = Field(min_length=1, max_length=300)


class Defense(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    kind: Literal['dispute_defense']
    dispute_id: str
    model: str | None = None
    assessment: Literal['strong', 'partial', 'weak']
    summary: str = Field(min_length=1, max_length=1500)
    points: list[Point] = Field(max_length=12)
    gaps: list[str] = Field(max_length=8)
    recommended_action: Literal['send_message', 'make_offer', 'accept_claim', 'escalate', 'provide_evidence']
    response_message: str = Field(min_length=1, max_length=2000)
    documents: list[DocumentChoice] = Field(max_length=100)


def money(minor, currency):
    return f'{currency} {minor // 100}.{minor % 100:02d}'


def project_time(value):
    """Records are stored in UTC; Trato's project dates are Peru time, so evidence reads the same as the rest of the app."""
    try:
        return datetime.fromisoformat(value).astimezone(ZoneInfo('America/Lima')).strftime('%Y-%m-%d %H:%M') + ' Peru time'
    except (TypeError, ValueError):
        raise ApiError('DISPUTE_EVIDENCE_UNAVAILABLE', 409) from None


def only_row(rows):
    if len(rows) != 1:
        raise ApiError('DISPUTE_EVIDENCE_UNAVAILABLE', 409)
    return rows[0]


def evidence_pack(repo, replies, owner, project_id, payment):
    """The records of the paid addendum, read with the freelancer's session. Recipient and sender addresses stay out."""
    paid = only_row(repo.rows('proposal_payments', {'select': 'id,proposal_id,revision_id,acceptance_id,status,capture_id,amount_minor,currency',
                                                    'id': 'eq.' + str(payment['proposal_payment_id']), 'project_id': 'eq.' + project_id}))
    if paid['status'] != 'completed' or paid['capture_id'] != payment['capture_id']:
        raise ApiError('DISPUTE_EVIDENCE_UNAVAILABLE', 409)
    scope = {'revision_id': 'eq.' + paid['revision_id'], 'proposal_id': 'eq.' + paid['proposal_id']}
    revision = only_row(repo.rows('proposal_revisions', {'select': 'revision_no,scope_summary,conditions,additional_minor,currency,deadline,created_at',
                                                         'id': 'eq.' + paid['revision_id'], 'proposal_id': 'eq.' + paid['proposal_id']}))
    number = revision['revision_no']
    items = repo.rows('proposal_revision_items', {'select': 'description,quantity,unit_amount_minor', **scope, 'order': 'ordinal.asc'})
    lines = [f'Addendum version {number}', 'Scope: ' + revision['scope_summary'], 'Conditions: ' + (revision['conditions'] or 'none'),
             'Amount: ' + money(revision['additional_minor'], revision['currency']), 'Deadline: ' + str(revision['deadline'] or 'none')]
    lines += [f"Item: {i['description']} (quantity {i['quantity']}, {money(i['unit_amount_minor'], revision['currency'])} each)" for i in items]
    evidence = [{'id': 'agreement', 'kind': 'agreement', 'at': revision['created_at'], 'text': '\n'.join(lines)}]
    for n, row in enumerate(repo.rows('proposal_artifacts', {'select': 'document_id,sha256,created_at', **scope}), 1):
        evidence.append({'id': f'document-{n}', 'kind': 'document', 'at': row['created_at'], 'document_id': row['document_id'], 'text': f"PDF of addendum version {number}, SHA-256 {row['sha256']}"})
    sent = [row for row in repo.rows('proposal_deliveries', {'select': 'kind,status,created_at', **scope, 'order': 'created_at.asc'})
            if row['kind'] == 'adenda' and row['status'] == 'accepted_by_gmail']
    for n, row in enumerate(sent, 1):
        evidence.append({'id': f'delivery-{n}', 'kind': 'delivery', 'at': row['created_at'], 'text': f"Addendum version {number} emailed to the client on {project_time(row['created_at'])}"})
    accepted = only_row(repo.rows('proposal_acceptances', {'select': 'method,created_at', 'id': 'eq.' + str(paid['acceptance_id']), **scope}))
    channel = {'client_portal': "through Trato's client portal"}.get(accepted['method'], 'recorded by the freelancer from the returned document')
    evidence.append({'id': 'acceptance', 'kind': 'acceptance', 'at': accepted['created_at'], 'text': f"The client accepted addendum version {number} {channel} on {project_time(accepted['created_at'])}"})
    evidence.append({'id': 'payment', 'kind': 'payment', 'at': payment.get('verified_at'), 'text': f"PayPal confirmed a payment of {money(paid['amount_minor'], paid['currency'])} for addendum version {number} on {project_time(payment.get('verified_at'))}"})
    messages = [m for m in replies(owner, project_id, paid['proposal_id']) if m.get('revision_id') == paid['revision_id'] and not m.get('mailbox_removed_at') and (m.get('reply_text') or '').strip()]
    for n, row in enumerate(messages[:MAX_REPLIES], 1):
        evidence.append({'id': f'reply-{n}', 'kind': 'client_reply', 'at': row.get('received_at'), 'text': row['reply_text'][:4000]})
    return evidence


def stage_evidence_pack(repo, checkouts, owner, project_id, payment):
    """The records behind a paid plan stage, read with the freelancer's session: what the stage promised, the file
    delivered to the client, the client's approval in Trato and PayPal's capture. Client addresses stay out.
    Stage checkouts are service-role only (checkouts): read after the caller proved ownership, filtered by owner and project."""
    paid = only_row(checkouts.rows('project_initial_checkouts', {'select': 'stage_position,status,capture_id,amount_minor,currency,paid_at',
                                                                'owner_id': 'eq.' + owner, 'project_id': 'eq.' + project_id,
                                                                'capture_id': 'eq.' + payment['capture_id']}))
    position = paid['stage_position']
    if paid['status'] != 'completed' or not isinstance(position, int):
        raise ApiError('DISPUTE_EVIDENCE_UNAVAILABLE', 409)
    stage = only_row(repo.rows('project_start_stages', {'select': 'title,deliverables,payment_condition,amount',
                                                        'project_id': 'eq.' + project_id, 'position': 'eq.' + str(position)}))
    plan = only_row(repo.rows('project_start_plans', {'select': 'summary,created_at', 'project_id': 'eq.' + project_id}))
    lines = [f'Plan stage {position}: {stage["title"]}', 'Deliverables: ' + (stage['deliverables'] or 'none'),
             'Payment condition: ' + (stage['payment_condition'] or 'none'), 'Amount: ' + money(paid['amount_minor'], paid['currency'])]
    if (plan.get('summary') or '').strip():
        lines.append('Project plan: ' + plan['summary'].strip()[:1500])
    evidence = [{'id': 'stage', 'kind': 'stage', 'at': plan['created_at'], 'text': '\n'.join(lines)}]
    titles = {d['id']: d['title'] for d in repo.rows('documents', {'select': 'id,title', 'project_id': 'eq.' + project_id, 'deleted_at': 'is.null', 'limit': 200})}
    shares = repo.rows('project_stage_delivery_shares', {'select': 'document_id,shared_at', 'project_id': 'eq.' + project_id,
                                                         'stage_position': 'eq.' + str(position), 'order': 'shared_at.asc'})
    for n, row in enumerate([r for r in shares if r['document_id'] in titles], 1):
        evidence.append({'id': f'delivery-{n}', 'kind': 'stage_delivery', 'at': row['shared_at'], 'document_id': row['document_id'],
                         'text': f"Delivery file \"{titles[row['document_id']]}\" for stage {position} shared with the client in Trato on {project_time(row['shared_at'])}"})
    reviews = repo.rows('project_stage_reviews', {'select': 'decision,notes,created_at', 'project_id': 'eq.' + project_id,
                                                  'stage_position': 'eq.' + str(position), 'order': 'created_at.asc'})
    for n, row in enumerate(reviews, 1):
        verb = 'approved' if row['decision'] == 'approved' else 'asked for changes to'
        note = f" Client notes: {row['notes'].strip()[:1000]}" if (row.get('notes') or '').strip() else ''
        evidence.append({'id': f'review-{n}', 'kind': 'stage_approval' if row['decision'] == 'approved' else 'stage_review', 'at': row['created_at'],
                         'text': f"The client {verb} the delivery of stage {position} in Trato's client portal on {project_time(row['created_at'])}.{note}"})
    evidence.append({'id': 'payment', 'kind': 'payment', 'at': payment.get('verified_at'),
                     'text': f"PayPal confirmed a payment of {money(paid['amount_minor'], paid['currency'])} for plan stage {position} ({stage['title']}) on {project_time(payment.get('verified_at'))}"})
    return evidence


def documents_to_send(repo, project_id, document_ids):
    """Every file is checked and downloaded before anything goes out; download() rejects a file whose hash no longer matches."""
    files, total = [], 0
    for document_id in dict.fromkeys(str(i) for i in document_ids):
        document = repo.document(document_id)
        if document['project_id'] != project_id or document['mime_type'] not in SENDABLE or document['size_bytes'] > MAX_DOCUMENT_BYTES:
            raise ApiError('DISPUTE_DOCUMENT_INVALID', 409)
        total += document['size_bytes']
        if total > MAX_TOTAL_BYTES:
            raise ApiError('DISPUTE_DOCUMENT_INVALID', 409)
        # The client and the freelancer read this name later; PayPal only accepts plain characters.
        extension = SENDABLE[document['mime_type']]
        stem = re.sub(r'[^A-Za-z0-9._-]+', '-', re.sub(r'\.[A-Za-z0-9]+$', '', document.get('original_filename') or '')).strip('-.')[:70]
        files.append((f'{stem or "document-" + str(len(files) + 1)}.{extension}', document['mime_type'], repo.download(document)))
    return files


def record_documents(repo, project_id, dispute_id, document_ids, role):
    """PayPal already has the files by now, so a failure here is reported, never presented as a failed send."""
    if not document_ids:
        return True
    try:
        repo.rpc('record_dispute_documents', {'p_project': project_id, 'p_dispute': dispute_id, 'p_documents': [str(i) for i in document_ids], 'p_role': role})
    except ApiError:
        return False
    return True


def link_upload(reader, repo, project_id, dispute_id, item):
    if not any(d['dispute_id'] == dispute_id for d in reader.project_disputes(repo, project_id)['disputes']):
        raise ApiError('DISPUTE_NOT_FOUND', 404)
    repo.rpc('record_dispute_documents', {'p_project': project_id, 'p_dispute': dispute_id, 'p_documents': [str(item.document_id)], 'p_role': 'uploaded'})
    return {'linked': True}


def send_response(reader, repo, project_id, dispute_id, item):
    """Runs only after the freelancer confirms in the interface. Authorization and files are checked before anything is sent."""
    if not item.message.strip():
        raise ApiError('AI_INVALID_INPUT', 422)
    dispute = next((d for d in reader.project_disputes(repo, project_id)['disputes'] if d['dispute_id'] == dispute_id), None)
    if dispute is None:
        raise ApiError('DISPUTE_NOT_FOUND', 404)
    if 'send_message' not in dispute['actions']:
        raise ApiError('DISPUTE_NOT_ACTIONABLE', 409)
    files = documents_to_send(repo, project_id, item.document_ids)
    client = reader.writer()
    try:
        client.send_dispute_message(dispute_id, item.message.strip(), files)
    except PayPalError as error:
        raise ApiError('DISPUTE_SEND_UNCERTAIN', 503) if error.uncertain else ApiError('DISPUTE_SEND_REJECTED', 409) from None
    return {'message_sent': True, 'attachment': 'sent' if files else 'none', 'documents_sent': len(files), 'documents_total': len(files),
            'documents_recorded': record_documents(repo, project_id, dispute_id, item.document_ids, 'sent')}


def current_dispute(reader, repo, project_id, dispute_id, link):
    """Authorizes the project and requires PayPal's own link for this action on the dispute as it stands now."""
    dispute = next((d for d in reader.project_disputes(repo, project_id)['disputes'] if d['dispute_id'] == dispute_id), None)
    if dispute is None:
        raise ApiError('DISPUTE_NOT_FOUND', 404)
    if link not in dispute['actions']:
        raise ApiError('DISPUTE_NOT_ACTIONABLE', 409)
    return dispute


def message_document(reader, dispute_id, message_index, document_index):
    """Download one attachment PayPal holds. The caller has already authorized this dispute; its URL never reaches the browser."""
    dispute = reader.provider().get_dispute(dispute_id)
    messages = (dispute.get('messages') or [])[:30]
    if not 0 <= message_index < len(messages):
        raise ApiError('DISPUTE_DOCUMENT_NOT_FOUND', 404)
    documents = messages[message_index].get('documents') or []
    if not 0 <= document_index < len(documents) or not isinstance(documents[document_index], dict):
        raise ApiError('DISPUTE_DOCUMENT_NOT_FOUND', 404)
    try:
        content, content_type = reader.writer().fetch_dispute_document(documents[document_index].get('url'))
    except PayPalError:
        raise ApiError('DISPUTE_DOCUMENT_UNAVAILABLE', 502) from None
    if content_type not in SENDABLE:
        raise ApiError('DISPUTE_DOCUMENT_UNAVAILABLE', 502)
    return content, content_type


def import_client_documents(reader, repo, settings, project_id, disputes, language):
    """Copies the PDFs the client attached in PayPal into the project, once each, so Documents shows them and TeTrato can read them.
    The dispute is still shown when this fails; the next check of PayPal tries again."""
    wanted = [(dispute['dispute_id'], m, d, name, f"{message.get('at')}:{d}") for dispute in disputes
              for m, message in enumerate(dispute['messages']) if message['by'] == 'BUYER'
              for d, name in enumerate(message['documents']) if name.lower().endswith('.pdf')]
    if not wanted:
        return {'imported': 0, 'saved': True}
    from .file_processing import remember_options
    try:
        known = {(row.get('dispute_id'), row.get('source_key')) for row in repo.rows('project_dispute_documents', {
            'select': 'dispute_id,source_key', 'project_id': 'eq.' + project_id, 'role': 'eq.received'})}
    except ApiError:
        return {'imported': 0, 'saved': False}
    imported, saved = 0, True
    for dispute_id, message_index, document_index, name, source_key in [item for item in wanted if (item[0], item[4]) not in known][:MAX_DOCUMENTS]:
        try:
            content, content_type = message_document(reader, dispute_id, message_index, document_index)
            if content_type != 'application/pdf' or not content.startswith(b'%PDF-') or len(content) > MAX_DOCUMENT_BYTES:
                saved = False
                continue
            filename = re.sub(r'[^A-Za-z0-9._-]', '_', name)[-120:]
            reservation = repo.reserve(project_id, (CLIENT_ATTACHMENT_TITLE + name)[:200], 'reference', filename, 'application/pdf', content,
                                       'dispute-client-' + sha256(f'{dispute_id}:{source_key}'.encode()).hexdigest()[:40])
            remember_options(settings, repo, reservation['document'], language, None, {})
            ingestion(repo, None, reservation, content)
            repo.rpc('record_dispute_received_document', {'p_project': project_id, 'p_dispute': dispute_id, 'p_document': reservation['document']['id'], 'p_key': source_key})
            imported += 1
        except (ApiError, PayPalError):
            saved = False
    return {'imported': imported, 'saved': saved}


def document_response(content, content_type):
    return Response(content, media_type=content_type, headers={'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
                                                               'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline'})


def paypal_action(call):
    try:
        call()
    except PayPalError as error:
        raise ApiError('DISPUTE_SEND_UNCERTAIN', 503) if error.uncertain else ApiError('DISPUTE_SEND_REJECTED', 409) from None
    return {'done': True}


def provide_evidence(reader, repo, project_id, dispute_id, item):
    if not item.notes.strip():
        raise ApiError('AI_INVALID_INPUT', 422)
    current_dispute(reader, repo, project_id, dispute_id, 'provide_evidence')
    files = documents_to_send(repo, project_id, item.document_ids)
    client = reader.writer()
    return {**paypal_action(lambda: client.provide_dispute_evidence(dispute_id, item.notes.strip(), files)), 'documents_sent': len(files),
            'documents_recorded': record_documents(repo, project_id, dispute_id, item.document_ids, 'sent'),
            'history_saved': record_evidence(repo, project_id, dispute_id, [f[0] for f in files])}


def escalate(reader, repo, project_id, dispute_id, item):
    if not item.note.strip():
        raise ApiError('AI_INVALID_INPUT', 422)
    current_dispute(reader, repo, project_id, dispute_id, 'escalate')
    client = reader.writer()
    return {**paypal_action(lambda: client.escalate_dispute(dispute_id, item.note.strip())), 'history_saved': record_escalation(repo, project_id, dispute_id)}


def accept_claim(reader, repo, project_id, dispute_id, item, *, before_refund=None):
    """The freelancer closes the dispute in the client's favor: PayPal refunds the client. Only after the freelancer confirms."""
    if not item.note.strip():
        raise ApiError('AI_INVALID_INPUT', 422)
    dispute = current_dispute(reader, repo, project_id, dispute_id, 'accept_claim')
    if before_refund is not None:
        before_refund(dispute['payment'])
    client = reader.writer()
    return {**paypal_action(lambda: client.accept_dispute_claim(dispute_id, item.note.strip())), 'history_saved': record_accepted_claim(repo, project_id, dispute_id)}


def sandbox_step(reader, repo, project_id, dispute_id, item):
    """Demo controls. PayPal only offers these links in Sandbox, and writer() refuses any other environment."""
    current_dispute(reader, repo, project_id, dispute_id, 'require_evidence' if item.action == 'require_evidence' else 'adjudicate')
    client = reader.writer()
    if item.action == 'require_evidence':
        return paypal_action(lambda: client.sandbox_require_evidence(dispute_id))
    return paypal_action(lambda: client.sandbox_adjudicate(dispute_id, 'SELLER_FAVOR' if item.action == 'seller_favor' else 'BUYER_FAVOR'))


def stored_sources(jobs, job_id):
    """Passages the document tools returned in this job: the only document text that can be cited."""
    try:
        return json.loads(jobs.connection().hget(PREFIX + job_id, 'assistant_sources') or '{}')
    except (RedisError, ValueError):
        raise ApiError('AI_QUEUE_UNAVAILABLE', 503) from None


def validate_defense(result, data, sources, documents):
    """Checked again against the job's records and passages, and the project's current documents, before anything is shown."""
    try:
        answer = Defense.model_validate(result)
    except ValidationError:
        raise ApiError('AI_INVALID_RESPONSE', 502) from None
    evidence = {item['id']: item for item in data.get('evidence') or []}
    if (answer.dispute_id != data.get('dispute_id') or answer.recommended_action not in (data.get('dispute') or {}).get('actions', [])
            or not answer.summary.strip() or not answer.response_message.strip() or (answer.assessment != 'weak' and not answer.points)):
        raise ApiError('AI_INVALID_RESPONSE', 502)
    output = answer.model_dump(exclude={'model', 'documents'})
    for point in output['points']:
        record, source = evidence.get(point['evidence_id']), sources.get(point['evidence_id'])
        if source is not None:
            if source.get('source_kind') != 'original' or point['quote'] not in source.get('text', ''):
                raise ApiError('AI_INVALID_CITATION', 502)
            point.update(kind='project_document', title=source.get('title'), at=None)
        elif record is not None and point['quote'] in record['text']:
            point.update(kind=record['kind'], at=record['at'])
        else:
            raise ApiError('AI_INVALID_CITATION', 502)
    choices = {c.document_id: c for c in answer.documents}
    if not set(choices) <= {d['id'] for d in documents}:
        raise ApiError('AI_INVALID_RESPONSE', 502)
    consulted = {s.get('file_id') for s in sources.values()}
    # The exact PDF the client accepted, or the file delivered for the disputed stage.
    required = {item.get('document_id') for item in evidence.values() if item.get('kind') in ('document', 'stage_delivery')}
    # An opinion about a document needs its content: without a passage from it in this job, only the accepted PDF is proposed, with no reason.
    output['documents'] = [{
        'id': d['id'], 'title': d['title'], 'kind': d['kind'], 'created_at': d.get('created_at'), 'consulted': d['id'] in consulted,
        'sendable': d.get('mime_type') in SENDABLE and (d.get('size_bytes') or 0) <= MAX_DOCUMENT_BYTES,
        'recommended': d['id'] in required or (d['id'] in consulted and d['id'] in choices and choices[d['id']].recommended),
        'reason': choices[d['id']].reason if d['id'] in consulted and d['id'] in choices else ''} for d in documents]
    return output


def project_documents(repo, project_id):
    return repo.rows('documents', {'select': 'id,title,kind,mime_type,size_bytes,created_at', 'project_id': 'eq.' + project_id, 'deleted_at': 'is.null', 'order': 'created_at.asc', 'limit': 100})


def completed_defense(jobs, repo, owner, job_id, result):
    data = jobs.input(owner, job_id)
    return validate_defense(result, data, stored_sources(jobs, job_id), project_documents(repo, data['project_id']))


RESOLUTION_CENTER = 'https://www.sandbox.paypal.com/resolutioncenter'


def client_dispute(reader, capture_id):
    """The dispute on a paid addendum as its client sees it: read-only, without the freelancer's internal records."""
    if not isinstance(capture_id, str) or not CAPTURE.fullmatch(capture_id):
        return None
    client = reader.provider()
    started = time.monotonic()
    found = [summarize(client.get_dispute(item.get('dispute_id')), {'capture_id': capture_id})
             for item in client.list_disputes(capture_id).get('items') or [] if isinstance(item, dict)]
    found = [value for value in found if value]
    # Timing and state only: no business data or identifiers.
    logging.getLogger(__name__).warning(json.dumps({'event': 'client_dispute_read', 'paypal_ms': round(1000 * (time.monotonic() - started)),
        'disputes': len(found), 'statuses': sorted({value['status'] for value in found if value['status']})}))
    if not found:
        return None
    current = next((d for d in found if d['status'] != 'RESOLVED'), found[0])
    return {**{key: current[key] for key in ('dispute_id', 'reason', 'status', 'stage', 'outcome', 'amount', 'messages')},
            'reply_url': None if current['status'] == 'RESOLVED' else RESOLUTION_CENTER}


def build_dispute_router(settings, require_user, repository_factory=None, reader=None, *, jobs=None, preferences=None, replies=None, refund_finance=None):
    router = APIRouter(prefix='/api/v1')
    reader = reader or DisputeReader()
    jobs = jobs if jobs is not None else AIJobs()
    preferences = preferences if preferences is not None else ModelPreferences()

    def repository(request):
        return (repository_factory or Repository)(settings, request.headers.get('authorization', ''))

    @router.get('/disputes/attention')
    async def disputes_attention(request: Request, owner=Depends(require_user)):
        data = await run_in_threadpool(reader.open_disputes, repository(request))
        return JSONResponse({'data': data}, headers={'Cache-Control': 'no-store'})

    @router.get('/projects/{project_id}/disputes')
    async def project_disputes(project_id: UUID, request: Request, owner=Depends(require_user)):
        def read():
            repo = repository(request)
            started = time.monotonic()
            data = reader.project_disputes(repo, str(project_id), include_refund_refs=True) if refund_finance else reader.project_disputes(repo, str(project_id))
            read_done = time.monotonic()
            language = 'en' if request.headers.get('accept-language', '').lower().startswith('en') else 'es'
            copied = import_client_documents(reader, repo, settings, str(project_id), data['disputes'], language)
            copied_done = time.monotonic()
            saved = record_disputes(repo, str(project_id), data['disputes'])
            for dispute in data['disputes'] if refund_finance else ():
                refs = dispute.pop('_refund_refs', None)
                if refs is None:
                    continue
                try:
                    refund_finance.sync_dispute(owner, str(project_id), dispute['dispute_id'], dispute['payment'], refs)
                    dispute['refund_sync'] = 'confirmed'
                except (PayPalError, ApiError) as error:
                    dispute['refund_sync'] = 'pending' if error.code == 'REFUND_DISPUTE_PENDING' else 'unavailable'
            # Timing only: no business data or identifiers.
            logging.getLogger(__name__).warning(json.dumps({'event': 'dispute_check_timing', 'paypal_ms': round(1000 * (read_done - started)),
                'copy_documents_ms': round(1000 * (copied_done - read_done)), 'history_ms': round(1000 * (time.monotonic() - copied_done)),
                'payments': data['payments_checked'], 'disputes': len(data['disputes']), 'documents_copied': copied['imported']}))
            return {**data, 'history_saved': saved, 'client_documents_imported': copied['imported'], 'client_documents_saved': copied['saved']}
        data = await run_in_threadpool(read)
        return JSONResponse({'data': data}, headers={'Cache-Control': 'no-store'})

    @router.post('/projects/{project_id}/disputes/{dispute_id}/messages')
    async def send_message(project_id: UUID, dispute_id: str, request: Request, owner=Depends(require_user)):
        try:
            item = SendRequest.model_validate_json(await read_bytes(request, 20000))
        except (ValidationError, ValueError):
            raise ApiError('AI_INVALID_INPUT', 422) from None
        data = await run_in_threadpool(send_response, reader, repository(request), str(project_id), dispute_id, item)
        return JSONResponse({'data': data}, headers={'Cache-Control': 'no-store'})

    @router.get('/projects/{project_id}/disputes/{dispute_id}/messages/{message_index}/documents/{document_index}')
    async def message_document_file(project_id: UUID, dispute_id: str, message_index: int, document_index: int, request: Request, owner=Depends(require_user)):
        def read():
            found = next((d for d in reader.project_disputes(repository(request), str(project_id))['disputes'] if d['dispute_id'] == dispute_id), None)
            if found is None:
                raise ApiError('DISPUTE_NOT_FOUND', 404)
            return message_document(reader, dispute_id, message_index, document_index)
        return document_response(*await run_in_threadpool(read))

    async def parsed(request, model):
        try:
            return model.model_validate_json(await read_bytes(request, 20000))
        except (ValidationError, ValueError):
            raise ApiError('AI_INVALID_INPUT', 422) from None

    @router.post('/projects/{project_id}/disputes/{dispute_id}/evidence')
    async def submit_evidence(project_id: UUID, dispute_id: str, request: Request, owner=Depends(require_user)):
        data = await run_in_threadpool(provide_evidence, reader, repository(request), str(project_id), dispute_id, await parsed(request, EvidenceRequest))
        return JSONResponse({'data': data}, headers={'Cache-Control': 'no-store'})

    @router.post('/projects/{project_id}/disputes/{dispute_id}/documents')
    async def link_document(project_id: UUID, dispute_id: str, request: Request, owner=Depends(require_user)):
        try:
            item = LinkRequest.model_validate_json(await read_bytes(request, 1000), strict=False)
        except (ValidationError, ValueError):
            raise ApiError('AI_INVALID_INPUT', 422) from None
        data = await run_in_threadpool(link_upload, reader, repository(request), str(project_id), dispute_id, item)
        return JSONResponse({'data': data}, headers={'Cache-Control': 'no-store'})

    @router.post('/projects/{project_id}/disputes/{dispute_id}/escalate')
    async def escalate_dispute(project_id: UUID, dispute_id: str, request: Request, owner=Depends(require_user)):
        data = await run_in_threadpool(escalate, reader, repository(request), str(project_id), dispute_id, await parsed(request, EscalateRequest))
        return JSONResponse({'data': data}, headers={'Cache-Control': 'no-store'})

    @router.post('/projects/{project_id}/disputes/{dispute_id}/accept')
    async def accept_dispute_claim(project_id: UUID, dispute_id: str, request: Request, owner=Depends(require_user)):
        def before_refund(payment):
            refund_finance.ensure_no_unresolved_refund(owner, str(project_id), payment)

        data = await run_in_threadpool(accept_claim, reader, repository(request), str(project_id), dispute_id,
                                      await parsed(request, EscalateRequest), before_refund=before_refund if refund_finance else None)
        return JSONResponse({'data': data}, headers={'Cache-Control': 'no-store'})

    @router.post('/projects/{project_id}/disputes/{dispute_id}/sandbox')
    async def sandbox(project_id: UUID, dispute_id: str, request: Request, owner=Depends(require_user)):
        data = await run_in_threadpool(sandbox_step, reader, repository(request), str(project_id), dispute_id, await parsed(request, SandboxRequest))
        return JSONResponse({'data': data}, headers={'Cache-Control': 'no-store'})

    def defense_input(repo, owner, project_id, dispute_id, language):
        dispute = next((d for d in reader.project_disputes(repo, project_id)['disputes'] if d['dispute_id'] == dispute_id), None)
        if dispute is None:
            raise ApiError('DISPUTE_NOT_FOUND', 404)
        actions = [a for a in dispute['actions'] if a in DEFENSE_ACTIONS]
        if dispute['status'] == 'RESOLVED' or not actions:
            raise ApiError('DISPUTE_NOT_ACTIONABLE', 409)
        # Once the freelancer has answered, TeTrato analyzes again only after a new client message or when PayPal asks for evidence.
        messages = dispute['messages']
        if any(m['by'] == 'SELLER' for m in messages) and messages[-1]['by'] != 'BUYER' and 'provide_evidence' not in actions:
            raise ApiError('DISPUTE_ANALYSIS_NOT_NEEDED', 409)
        payment = dispute['payment']
        if payment['origin'] == 'initial' and payment.get('capture_id'):
            from .thread_store import ThreadStore
            repo.project(project_id)  # Ownership first: 404 unless the signed-in freelancer owns this active project.
            evidence = stage_evidence_pack(repo, ThreadStore(settings).repo, owner, project_id, payment)  # Its delivery, approval and payment.
        elif payment['origin'] == 'change' and payment.get('proposal_payment_id') and replies is not None:
            evidence = evidence_pack(repo, replies, owner, project_id, payment)
        else:
            raise ApiError('DISPUTE_EVIDENCE_UNAVAILABLE', 409)
        project = repo.project(project_id)
        return {'workflow': 'dispute_defense', 'owner_id': owner, 'client_id': project['client_id'], 'project_id': project_id, 'dispute_id': dispute_id, 'output_language': language,
                'dispute': {**{k: dispute[k] for k in ('reason', 'status', 'stage', 'amount', 'response_due')}, 'actions': actions,
                            'client_messages': [m['text'] for m in messages if m['by'] == 'BUYER'], 'conversation': messages},
                'evidence': evidence}

    @router.post('/projects/{project_id}/disputes/{dispute_id}/defense')
    async def prepare_defense(project_id: UUID, dispute_id: str, request: Request, owner=Depends(require_user)):
        try:
            item = DefenseRequest.model_validate_json(await read_bytes(request, 1000))
        except (ValidationError, ValueError):
            raise ApiError('AI_INVALID_INPUT', 422) from None
        data = await run_in_threadpool(defense_input, repository(request), owner, str(project_id), dispute_id, item.output_language)
        data['model_id'] = await run_in_threadpool(preferences.for_request, request, owner)
        job_id = uuid(request.headers.get('Idempotency-Key', ''))
        job = await run_in_threadpool(jobs.enqueue, owner, job_id, data)
        if job['status'] == 'completed':
            job['result'] = await run_in_threadpool(completed_defense, jobs, repository(request), owner, job_id, job['result'])
        return JSONResponse({'data': job}, status_code=202, headers={'Cache-Control': 'no-store'})

    return router
