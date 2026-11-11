"""Client portal: the client reviews and accepts an addendum through a signed link, without a Trato account.

The backend is the validator: it turns the token into its hash and calls service-role-only database functions,
which check expiry, revocation, revision and the reviewed PDF hash. The token itself is never stored.
"""
from hashlib import sha256
import hmac
import os
import re

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, Response
from starlette.concurrency import run_in_threadpool

from .errors import ApiError
from .persistence import Repository, uuid

TOKEN = re.compile(r'^[0-9a-f]{64}$')
SHA256 = re.compile(r'^[0-9a-f]{64}$')
LINK_DAYS = 60
PROBLEM_REASONS = ('not_received', 'not_as_agreed', 'quality', 'other')


def portal_token(revision_id):
    # Derived, not random: the emailed link must be identical in the preview and in the real send.
    secret = os.getenv('PORTAL_LINK_SECRET', '')
    if len(secret) < 32:
        raise ApiError('PORTAL_NOT_CONFIGURED', 503)
    if not isinstance(revision_id, str) or not revision_id:
        raise ApiError('INVALID_ID', 422)
    return hmac.new(secret.encode(), ('trato-portal:' + revision_id).encode(), sha256).hexdigest()


def token_hash(token):
    if not isinstance(token, str) or not TOKEN.fullmatch(token):
        raise ApiError('PORTAL_LINK_NOT_FOUND', 404)
    return sha256(token.encode()).hexdigest()


def portal_url(settings, token):
    return settings.web_origin.rstrip('/') + '/portal.html#t=' + token


class PortalStore:
    """Service-role access, used only after the backend has validated the token format."""

    def __init__(self, settings):
        key = os.getenv('SUPABASE_SERVER_KEY', '')
        if not key:
            raise ApiError('BACKEND_COMMANDS_NOT_CONFIGURED', 503)
        if not (key.startswith('sb_secret_') or key.startswith('eyJ')):
            raise ApiError('INVALID_SERVER_KEY', 503)
        self.repo = Repository(settings, 'Bearer unused')
        self.repo.headers['apikey'] = key
        if key.startswith('sb_secret_'):
            del self.repo.headers['Authorization']
        else:
            self.repo.headers['Authorization'] = 'Bearer ' + key

    def view(self, digest):
        view = self.repo.rpc('client_portal_view', {'p_token_hash': digest})
        # Tell the client when the freelancer collects this addendum with a PayPal invoice, by its number.
        if isinstance(view, dict) and view.get('payment_required') and view.get('revision_id'):
            rows = self.repo.rows('proposal_payments', {'select': 'id,owner_id,method,status,invoice_id,invoice_number,amount_minor,currency,merchant_id',
                                                        'revision_id': 'eq.' + uuid(view['revision_id'])})
            if len(rows) == 1 and rows[0].get('method') == 'invoice' and rows[0].get('invoice_number'):
                # The row itself travels only to the router below (public_view drops it), so it can verify the invoice.
                view = {**view, 'payment_method': 'invoice', 'invoice_number': rows[0]['invoice_number'], '_invoice_payment': rows[0]}
        return view

    # Client accounts. The database checks the client role, the verified email and the saved client record.
    def agreements(self, user):
        items = self.repo.rpc('client_account_agreements', {'p_user': uuid(user)})
        # Mark addenda the freelancer collects with a PayPal invoice, so the overview says so before opening them.
        pending = [item['proposal_id'] for item in items or [] if isinstance(item, dict) and item.get('proposal_id')
                   and item.get('status') == 'accepted' and item.get('payment_status') != 'completed']
        if pending:
            rows = self.repo.rows('proposal_payments', {'select': 'proposal_id', 'method': 'eq.invoice',
                                                         'proposal_id': 'in.(' + ','.join(uuid(x) for x in pending) + ')'})
            invoiced = {row['proposal_id'] for row in rows}
            items = [{**item, 'payment_method': 'invoice'} if isinstance(item, dict) and item.get('proposal_id') in invoiced else item for item in items]
        return items

    def plans(self, user):
        # Work plan deliverables of the client's projects, read-only; the database authorizes by verified email.
        return self.repo.rpc('client_account_project_plans', {'p_user': uuid(user)})

    def stage_delivery(self, user, project_id, position):
        # Only the latest processed delivery of a stage of the client's own project.
        doc = self.repo.rpc('client_stage_delivery', {'p_user': uuid(user), 'p_project': uuid(project_id), 'p_position': position})
        return doc, self.repo.download(doc)

    def stage_review(self, user, project_id, position, document_id, decision, notes):
        return self.repo.rpc('client_stage_review', {'p_user': uuid(user), 'p_project': uuid(project_id), 'p_position': position,
                                                     'p_document': uuid(document_id), 'p_decision': decision, 'p_notes': notes})

    def refund_request(self, user, project_id, stage, proposal_id, amount_minor, reason):
        # A request, never a refund: the database checks the project, the paid stage or addendum and what is left to refund.
        return self.repo.rpc('client_refund_request_create', {'p_user': uuid(user), 'p_project': uuid(project_id), 'p_stage': stage,
                                                              'p_proposal': uuid(proposal_id) if proposal_id else None,
                                                              'p_amount': amount_minor, 'p_reason': reason})

    def refund_requests(self, user):
        return self.repo.rpc('client_refund_requests_for', {'p_user': uuid(user)})

    def refund_request_message(self, user, request_id, text):
        return self.repo.rpc('client_refund_request_client_message', {'p_user': uuid(user), 'p_request': uuid(request_id), 'p_body': text})

    def refund_request_withdraw(self, user, request_id):
        # Also the first step when the client reports a problem on the same payment: one open path at a time.
        return self.repo.rpc('client_refund_request_withdraw', {'p_user': uuid(user), 'p_request': uuid(request_id)})

    def meetings(self, user):
        # Upcoming meetings of the client's projects; same authorization as the agreements.
        return self.repo.rpc('client_account_meetings', {'p_user': uuid(user)})

    def link_hash(self, user, proposal_id):
        digest = self.repo.rpc('client_account_link_hash', {'p_user': uuid(user), 'p_proposal': proposal_id})
        if not isinstance(digest, str) or not SHA256.fullmatch(digest):
            raise ApiError('AGREEMENT_NOT_FOUND', 404)
        return digest

    def request_changes(self, digest, notes):
        return self.repo.rpc('client_portal_request_changes', {'p_token_hash': digest, 'p_notes': notes})

    # Report a problem: the database checks the link and, to open a report, the payment PayPal verified.
    def problem(self, digest):
        return self.repo.rpc('client_portal_problem', {'p_token_hash': digest})

    def report_problem(self, digest, reason, notes):
        return self.repo.rpc('client_portal_report_problem', {'p_token_hash': digest, 'p_reason': reason, 'p_notes': notes})

    def problem_message(self, digest, body):
        return self.repo.rpc('client_portal_problem_message', {'p_token_hash': digest, 'p_body': body})

    def close_problem(self, digest, status):
        return self.repo.rpc('client_portal_close_problem', {'p_token_hash': digest, 'p_status': status})

    def payment_context(self, digest):
        return self.repo.rpc('client_portal_payment_context', {'p_token_hash': digest})

    def accept(self, digest, revision_id, addendum_sha256):
        return self.repo.rpc('client_portal_accept', {'p_token_hash': digest, 'p_revision': revision_id,
                                                      'p_addendum_sha256': addendum_sha256})

    def capture(self, revision_id):
        rows = self.repo.rows('proposal_payments', {'select': 'capture_id', 'revision_id': 'eq.' + uuid(revision_id), 'status': 'eq.completed'})
        return rows[0].get('capture_id') if len(rows) == 1 else None

    def document(self, view):
        rows = self.repo.rows('documents', {'select': 'id,project_id,storage_path,size_bytes,sha256,original_filename,mime_type',
                                            'id': 'eq.' + uuid(view['addendum_document_id'])})
        if len(rows) != 1:
            raise ApiError('PORTAL_DOCUMENT_NOT_FOUND', 404)
        return rows[0], self.repo.download(rows[0])


def public_view(view):
    # Only what the client needs to decide; internal ids stay on the server except the revision being accepted.
    keys = ('project_name', 'client_name', 'revision_id', 'revision_no', 'is_current', 'scope_summary', 'conditions',
            'currency', 'additional_minor', 'deadline', 'addendum_sha256', 'status', 'accepted_at', 'expires_at',
            'payment_required', 'payment_status', 'refunded_minor', 'change_request', 'payment_method', 'invoice_number')
    return {key: view.get(key) for key in keys}


def client_plans(items, web_origin):
    # The client pays a deliverable from the link already sent to them: the PayPal invoice page, or the emailed
    # checkout page. The checkout token itself never leaves the server except inside that link.
    from urllib.parse import urlencode
    keys = ('project_id', 'project_name', 'freelancer_email', 'position', 'title', 'amount', 'payment_condition',
            'payment_status', 'payment_method', 'paid_at', 'invoice_number',
            'delivery_document_id', 'delivery_title', 'review_decision', 'review_notes', 'reviewed_at',
            'paid_minor', 'refunded_minor')
    result = []
    for item in items or []:
        if not isinstance(item, dict):
            continue
        value = {key: item.get(key) for key in keys}
        if item.get('invoice_url'):
            value['pay_url'] = item['invoice_url']
        elif item.get('checkout_token'):
            value['pay_url'] = web_origin.rstrip('/') + '/initial-payment.html?' + urlencode(
                {'checkout': item['checkout_token'], 'lang': item.get('output_language') or 'en'})
        result.append(value)
    return result


PAYPAL_APPROVAL = re.compile(r'^https://www\.sandbox\.paypal\.com/[^\s"<>]+$')


def paypal_order_id(value):
    # Only a well-formed PayPal order id reaches the page.
    return value if isinstance(value, str) and re.fullmatch(r'[A-Z0-9]{10,24}', value) else None


def build_client_portal_router(settings, store=None, payments=None, require_user=None, disputes=None, jobs=None, preferences=None, gmail=None):
    router = APIRouter(prefix='/api/v1/portal')

    def backend():
        return store if store is not None else PortalStore(settings)

    def assistant_services():
        from .ai_jobs import AIJobs
        from .model_preferences import ModelPreferences
        return jobs if jobs is not None else AIJobs(), preferences if preferences is not None else ModelPreferences()

    async def body(request):
        try:
            data = await request.json()
        except ValueError:
            raise ApiError('INVALID_JSON', 422) from None
        if not isinstance(data, dict):
            raise ApiError('INVALID_JSON', 422)
        return data

    def reply(data):
        # No caching anywhere: the link grants access to a private document.
        return JSONResponse({'data': data}, headers={'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer'})

    async def view_by(digest):
        service = backend()
        view = await run_in_threadpool(service.view, digest)
        pay = view.pop('_invoice_payment', None) if isinstance(view, dict) else None
        if pay and payments is not None and pay.get('status') != 'completed' and pay.get('invoice_id'):
            # The client just paid in PayPal: read the invoice back so the view does not still say "to pay".
            # Only PayPal's verified capture completes it; if PayPal cannot be read now, the last verified state stays.
            try:
                await run_in_threadpool(payments.invoices().verify, pay)
                view = await run_in_threadpool(service.view, digest)
                view.pop('_invoice_payment', None)
            except ApiError:
                pass
        return reply(public_view(view))

    async def document_by(digest):
        service = backend()
        item = await run_in_threadpool(service.view, digest)
        doc, content = await run_in_threadpool(service.document, item)
        if sha256(content).hexdigest() != item.get('addendum_sha256') or doc.get('sha256') != item.get('addendum_sha256'):
            raise ApiError('PORTAL_DOCUMENT_CHANGED', 409)
        return Response(content, media_type='application/pdf', headers={
            'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
            'Content-Disposition': 'inline; filename="adenda.pdf"'})

    async def accept_by(digest, data):
        revision = uuid(data.get('revision_id'))
        addendum = data.get('addendum_sha256')
        if not isinstance(addendum, str) or not SHA256.fullmatch(addendum):
            raise ApiError('INVALID_PORTAL_ACCEPTANCE', 422)
        await run_in_threadpool(backend().accept, digest, revision, addendum)
        return await view_by(digest)

    async def pay_by(digest):
        # Same verified checkout as the freelancer's payment email; PayPal's result is confirmed on the return page.
        if payments is None:
            raise ApiError('PAYMENTS_NOT_CONFIGURED', 503)
        service = backend()
        item = await run_in_threadpool(service.view, digest)
        if item.get('status') != 'accepted':
            raise ApiError('ACCEPTANCE_REQUIRED', 409)
        if not item.get('payment_required'):
            raise ApiError('PAYMENT_NOT_REQUIRED', 409)
        context = await run_in_threadpool(service.payment_context, digest)
        result = await run_in_threadpool(payments.create_payment, context['owner_id'], context['proposal_id'], context['revision_id'])
        if result.get('status') == 'completed':
            return reply({'status': 'completed'})
        url = result.get('approval_url')
        if not isinstance(url, str) or not PAYPAL_APPROVAL.fullmatch(url):
            raise ApiError('PAYMENT_NOT_READY', 409)
        order = paypal_order_id(result.get('order_id'))
        return reply({'status': result.get('status'), 'approval_url': url, **({'order_id': order} if order else {})})

    async def pay_capture_by(digest):
        # After the client approves in PayPal's window: the same capture and verification as the return page,
        # found through the link or session. The checkout token stays on the server.
        if payments is None:
            raise ApiError('PAYMENTS_NOT_CONFIGURED', 503)
        service = backend()
        item = await run_in_threadpool(service.view, digest)
        if item.get('status') != 'accepted' or not item.get('payment_required'):
            raise ApiError('PAYMENT_NOT_REQUIRED', 409)
        context = await run_in_threadpool(service.payment_context, digest)
        pay = await run_in_threadpool(payments.create_payment, context['owner_id'], context['proposal_id'], context['revision_id'])
        if pay.get('status') != 'completed':
            token = pay.get('checkout_token')
            if not isinstance(token, str) or len(token) != 43:
                raise ApiError('PAYMENT_NOT_READY', 409)
            await run_in_threadpool(payments.checkout, token, True)
        return await view_by(digest)

    async def request_changes_by(digest, data):
        # The client's words reach the freelancer as feedback for a new version; nothing changes the addendum itself.
        notes = data.get('notes')
        if not isinstance(notes, str) or not 1 <= len(notes.strip()) <= 4000:
            raise ApiError('CHANGE_REQUEST_NOTES_REQUIRED', 422)
        await run_in_threadpool(backend().request_changes, digest, notes.strip())
        return await view_by(digest)

    async def dispute_by(digest):
        # Read-only. The link or session already authorized this addendum; the dispute is found through its own verified payment.
        from .disputes import DisputeReader, client_dispute
        service = backend()
        item = await run_in_threadpool(service.view, digest)
        if item.get('payment_status') != 'completed':
            return reply(None)
        capture = await run_in_threadpool(service.capture, item['revision_id'])
        return reply(await run_in_threadpool(client_dispute, disputes or DisputeReader(), capture))

    async def dispute_document_by(digest, data):
        from .disputes import DisputeReader, client_dispute, document_response, message_document
        message, document = data.get('message'), data.get('document')
        if type(message) is not int or type(document) is not int:
            raise ApiError('DISPUTE_DOCUMENT_NOT_FOUND', 404)
        service, reader = backend(), disputes or DisputeReader()
        item = await run_in_threadpool(service.view, digest)
        if item.get('payment_status') != 'completed':
            raise ApiError('DISPUTE_DOCUMENT_NOT_FOUND', 404)
        capture = await run_in_threadpool(service.capture, item['revision_id'])
        current = await run_in_threadpool(client_dispute, reader, capture)
        if current is None:
            raise ApiError('DISPUTE_DOCUMENT_NOT_FOUND', 404)
        return document_response(*await run_in_threadpool(message_document, reader, current['dispute_id'], message, document))

    def problem_text(data, field, code):
        value = data.get(field)
        if not isinstance(value, str) or not 1 <= len(value.strip()) <= 4000:
            raise ApiError(code, 422)
        return value.strip()

    async def problem_by(digest):
        return reply(await run_in_threadpool(backend().problem, digest))

    async def report_problem_by(digest, data):
        reason = data.get('reason')
        if reason not in PROBLEM_REASONS:
            raise ApiError('PROBLEM_REASON_REQUIRED', 422)
        notes = problem_text(data, 'notes', 'PROBLEM_NOTES_REQUIRED')
        service = backend()
        result = await run_in_threadpool(service.report_problem, digest, reason, notes)
        if gmail is not None and getattr(service, 'repo', None) is not None:
            # The report is saved; the freelancer's email is best effort and never changes the client's answer.
            from .problem_alerts import ProblemAlerts
            try:
                await run_in_threadpool(ProblemAlerts(settings, service.repo, gmail).notify, digest)
            except (ApiError, KeyError, TypeError):
                pass
        return reply(result)

    async def problem_message_by(digest, data):
        return reply(await run_in_threadpool(backend().problem_message, digest, problem_text(data, 'body', 'PROBLEM_MESSAGE_REQUIRED')))

    async def close_problem_by(digest, data):
        # Only the client closes its report: resolved, or still unresolved (then PayPal is its next step).
        status = data.get('status')
        if status not in ('resolved', 'unresolved'):
            raise ApiError('PROBLEM_STATUS_INVALID', 422)
        return reply(await run_in_threadpool(backend().close_problem, digest, status))

    async def assistant_by(digest, data):
        from .portal_assistant import ask, can_report_problem
        queue, models = assistant_services()
        service = backend()
        item = await run_in_threadpool(service.view, digest)
        # Only a paid addendum can have a report, so the database is asked only then.
        paid = item.get('status') == 'accepted' and item.get('payment_status') == 'completed'
        can_report = paid and can_report_problem(item, await run_in_threadpool(service.problem, digest) is not None)
        return reply(await run_in_threadpool(ask, queue, models, digest, item, data, can_report))

    async def assistant_status_by(digest, data):
        from .portal_assistant import status
        # The view call first: a revoked or expired link stops reading its answers too.
        await run_in_threadpool(backend().view, digest)
        return reply(await run_in_threadpool(status, assistant_services()[0], digest, data))

    actions = {'view': lambda digest, data: view_by(digest), 'dispute': lambda digest, data: dispute_by(digest), 'dispute-document': dispute_document_by, 'document': lambda digest, data: document_by(digest),
               'accept': accept_by, 'pay': lambda digest, data: pay_by(digest), 'pay-capture': lambda digest, data: pay_capture_by(digest),
               'request-changes': request_changes_by,
               'assistant': assistant_by, 'assistant-status': assistant_status_by,
               'problem': lambda digest, data: problem_by(digest), 'report-problem': report_problem_by,
               'problem-message': problem_message_by, 'close-problem': close_problem_by}

    # What PayPal's JavaScript SDK needs to draw its buttons: the app's public client id, Sandbox only. Never a secret.
    @router.get('/paypal-sdk')
    async def paypal_sdk():
        from paypal.config import SandboxSettings
        config = SandboxSettings.from_env()
        if config.environment != 'sandbox' or not re.fullmatch(r'[A-Za-z0-9_-]{20,120}', config.client_id or ''):
            raise ApiError('PAYPAL_SANDBOX_NOT_CONFIGURED', 503)
        return JSONResponse({'data': {'client_id': config.client_id, 'currency': 'USD', 'environment': 'sandbox'}},
                            headers={'Cache-Control': 'no-store'})

    # 1. With the emailed link: no account needed.
    @router.post('/{action}')
    async def by_link(action: str, request: Request):
        if action not in actions:
            raise ApiError('RESOURCE_NOT_FOUND', 404)
        data = await body(request)
        return await actions[action](token_hash(data.get('token')), data)

    if require_user is None:
        return router

    # 2. Signed-in client account: addenda sent to its verified email, opened with the session.
    @router.get('/account/agreements')
    async def agreements(user=Depends(require_user)):
        return reply(await run_in_threadpool(backend().agreements, user))

    @router.get('/account/plans')
    async def plans(user=Depends(require_user)):
        return reply(client_plans(await run_in_threadpool(backend().plans, user), settings.web_origin))

    def stage_position(position):
        if not 1 <= position <= 8:
            raise ApiError('PLAN_STAGE_INVALID', 422)
        return position

    @router.get('/account/projects/{project_id}/stages/{position}/delivery')
    async def stage_delivery(project_id: str, position: int, user=Depends(require_user)):
        doc, content = await run_in_threadpool(backend().stage_delivery, user, uuid(project_id), stage_position(position))
        if sha256(content).hexdigest() != doc.get('sha256'):
            raise ApiError('PORTAL_DOCUMENT_CHANGED', 409)
        return Response(content, media_type='application/pdf', headers={
            'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
            'Content-Disposition': 'inline; filename="delivery.pdf"'})

    @router.post('/account/projects/{project_id}/stages/{position}/review')
    async def stage_review(project_id: str, position: int, request: Request, user=Depends(require_user)):
        # The client approves the delivery they saw or asks for changes; the database records it once per document.
        data = await body(request)
        decision, notes = data.get('decision'), data.get('notes')
        if decision not in ('approved', 'changes_requested') or notes is not None and not isinstance(notes, str):
            raise ApiError('INVALID_STAGE_REVIEW', 422)
        if decision == 'changes_requested' and not (notes or '').strip():
            raise ApiError('CHANGE_REQUEST_NOTES_REQUIRED', 422)
        await run_in_threadpool(backend().stage_review, user, uuid(project_id), stage_position(position),
                                uuid(data.get('document_id')), decision, (notes or '').strip()[:4000] or None)
        return reply(client_plans(await run_in_threadpool(backend().plans, user), settings.web_origin))

    # Report a problem on a paid Work plan deliverable: same rules as on an addendum, authorized by the client account.
    def stage_args(user, project_id, position):
        return {'p_user': uuid(user), 'p_project': uuid(project_id), 'p_position': stage_position(position)}

    @router.get('/account/projects/{project_id}/stages/{position}/problem')
    async def stage_problem(project_id: str, position: int, user=Depends(require_user)):
        return reply(await run_in_threadpool(backend().repo.rpc, 'client_account_stage_problem', stage_args(user, project_id, position)))

    @router.post('/account/projects/{project_id}/stages/{position}/problem')
    async def report_stage_problem(project_id: str, position: int, request: Request, user=Depends(require_user)):
        data = await body(request)
        reason = data.get('reason')
        if reason not in PROBLEM_REASONS:
            raise ApiError('PROBLEM_REASON_REQUIRED', 422)
        notes = problem_text(data, 'notes', 'PROBLEM_NOTES_REQUIRED')
        service = backend()
        result = await run_in_threadpool(service.repo.rpc, 'client_account_report_stage_problem',
                                         {**stage_args(user, project_id, position), 'p_reason': reason, 'p_notes': notes})
        if gmail is not None and isinstance(result, dict) and result.get('report_id'):
            # Same freelancer email as an addendum report, best effort: the report is already saved.
            from .problem_alerts import ProblemAlerts
            try:
                await run_in_threadpool(ProblemAlerts(settings, service.repo, gmail).notify_report, result['report_id'])
            except (ApiError, KeyError, TypeError):
                pass
        return reply(result.get('problem') if isinstance(result, dict) else result)

    @router.post('/account/projects/{project_id}/stages/{position}/problem/message')
    async def stage_problem_message(project_id: str, position: int, request: Request, user=Depends(require_user)):
        text = problem_text(await body(request), 'body', 'PROBLEM_MESSAGE_REQUIRED')
        return reply(await run_in_threadpool(backend().repo.rpc, 'client_account_stage_problem_message',
                                             {**stage_args(user, project_id, position), 'p_body': text}))

    @router.post('/account/projects/{project_id}/stages/{position}/problem/close')
    async def close_stage_problem(project_id: str, position: int, request: Request, user=Depends(require_user)):
        status = (await body(request)).get('status')
        if status not in ('resolved', 'unresolved'):
            raise ApiError('PROBLEM_STATUS_INVALID', 422)
        return reply(await run_in_threadpool(backend().repo.rpc, 'client_account_close_stage_problem',
                                             {**stage_args(user, project_id, position), 'p_status': status}))

    @router.get('/account/refund-requests')
    async def refund_requests(user=Depends(require_user)):
        return reply(await run_in_threadpool(backend().refund_requests, user))

    @router.post('/account/projects/{project_id}/refund-requests')
    async def refund_request(project_id: str, request: Request, user=Depends(require_user)):
        # The client asks for money back on a paid stage or addendum; the freelancer decides in Refunds.
        data = await body(request)
        stage, proposal, amount, reason = data.get('stage_position'), data.get('proposal_id'), data.get('amount_minor'), data.get('reason')
        if (stage is None) == (proposal is None) or stage is not None and (type(stage) is not int or not 1 <= stage <= 8):
            raise ApiError('REFUND_REQUEST_TARGET_INVALID', 422)
        if type(amount) is not int or not 0 < amount <= 99999999999:
            raise ApiError('REFUND_REQUEST_AMOUNT_INVALID', 422)
        if not isinstance(reason, str) or not 1 <= len(reason.strip()) <= 4000:
            raise ApiError('REFUND_REQUEST_REASON_REQUIRED', 422)
        service = backend()
        created = await run_in_threadpool(service.refund_request, user, uuid(project_id), stage, proposal, amount, reason.strip())
        if gmail is not None and getattr(service, 'repo', None) is not None and isinstance(created, dict) and created.get('id'):
            # The request is saved; the freelancer's email is best effort and never changes the client's answer.
            from .refund_request_alerts import RefundRequestAlerts
            try:
                await run_in_threadpool(RefundRequestAlerts(settings, service.repo, gmail).notify, created['id'])
            except (ApiError, KeyError, TypeError):
                pass
        return reply(await run_in_threadpool(service.refund_requests, user))

    @router.post('/account/refund-requests/{request_id}/messages')
    async def refund_request_message(request_id: str, request: Request, user=Depends(require_user)):
        text = (await body(request)).get('body')
        if not isinstance(text, str) or not 1 <= len(text.strip()) <= 4000:
            raise ApiError('REFUND_REQUEST_MESSAGE_REQUIRED', 422)
        return reply(await run_in_threadpool(backend().refund_request_message, user, request_id, text.strip()))

    @router.post('/account/refund-requests/{request_id}/withdraw')
    async def refund_request_withdraw(request_id: str, user=Depends(require_user)):
        return reply(await run_in_threadpool(backend().refund_request_withdraw, user, request_id))

    # TeTrato across the client's account: built from the same agreements and Work plan the client sees.
    @router.post('/account/assistant')
    async def account_assistant(request: Request, user=Depends(require_user)):
        from .client_assistant import ask
        data = await body(request)
        queue, models = assistant_services()
        service = backend()
        agreements = await run_in_threadpool(service.agreements, user)
        plans = client_plans(await run_in_threadpool(service.plans, user), settings.web_origin)
        return reply(await run_in_threadpool(ask, queue, models, user, agreements, plans, data))

    @router.post('/account/assistant-status')
    async def account_assistant_status(request: Request, user=Depends(require_user)):
        from .client_assistant import status
        return reply(await run_in_threadpool(status, assistant_services()[0], user, await body(request)))

    @router.get('/account/meetings')
    async def account_meetings(user=Depends(require_user)):
        return reply(await run_in_threadpool(backend().meetings, user))

    @router.get('/account/problems')
    async def account_problems(user=Depends(require_user)):
        # State of each report in Trato, by addendum, for the client's lists. Only paid addenda can have one.
        service = backend()

        def read():
            found = {}
            for item in service.agreements(user):
                if item.get('payment_status') != 'completed':
                    continue
                report = service.problem(service.link_hash(user, item['proposal_id']))
                if isinstance(report, dict) and report.get('status') in ('open', 'resolved', 'unresolved'):
                    # request_paid: the fix was registered and paid, so only the client's closing is missing.
                    found[item['proposal_id']] = {'status': report['status'], 'request_paid': report.get('request_paid') is True}
            # Reports on paid Work plan deliverables, keyed so they never collide with an addendum id.
            if getattr(service, 'repo', None) is not None:
                for row in service.repo.rpc('client_account_stage_problems', {'p_user': uuid(user)}) or []:
                    found[f"stage:{row['project_id']}:{row['position']}"] = {'status': row['status'], 'request_paid': row.get('request_paid') is True}
            return found
        return reply(await run_in_threadpool(read))

    @router.get('/account/disputes')
    async def account_disputes(user=Depends(require_user)):
        # Asked apart from the agreements so PayPal's response time never delays the client's overview.
        import json, logging, time
        from concurrent.futures import ThreadPoolExecutor
        from .disputes import DisputeReader, client_dispute
        service, reader = backend(), disputes or DisputeReader()

        def read():
            paid = [item['proposal_id'] for item in service.agreements(user) if item.get('payment_status') == 'completed']

            def one(proposal_id):
                # The database authorizes each addendum for this verified account before PayPal is asked.
                view = service.view(service.link_hash(user, proposal_id))
                found = client_dispute(reader, service.capture(view['revision_id']))
                return (proposal_id, found) if found else None
            # Paid deliverables too: client_account_project_plans already limits them to this verified account's projects,
            # and each capture is read for exactly that project and stage. Keyed like the client's stage problems.
            stages = [(s['project_id'], s['position']) for s in service.plans(user) or [] if s.get('payment_status') == 'completed']

            def stage(key):
                project, position = key
                rows = service.repo.rows('project_initial_checkouts', {'select': 'capture_id', 'project_id': 'eq.' + project,
                                                                        'stage_position': 'eq.' + str(position), 'status': 'eq.completed'})
                found = client_dispute(reader, rows[0]['capture_id']) if len(rows) == 1 and rows[0].get('capture_id') else None
                return (f'stage:{project}:{position}', found) if found else None
            started = time.monotonic()
            with ThreadPoolExecutor(max_workers=4) as pool:
                rows = [row for row in pool.map(one, paid) if row] if paid else []
                rows += [row for row in pool.map(stage, stages) if row] if stages else []
            # Timing and counts only: no business data or identifiers.
            logging.getLogger(__name__).warning(json.dumps({'event': 'client_account_disputes', 'ms': round(1000 * (time.monotonic() - started)), 'paid_agreements': len(paid), 'paid_stages': len(stages), 'disputes': len(rows)}))
            return {proposal_id: {'dispute_id': found['dispute_id'], 'status': found['status'], 'reason': found['reason'], 'outcome': found['outcome']} for proposal_id, found in rows}
        return reply(await run_in_threadpool(read))

    @router.post('/account/agreements/{proposal_id}/{action}')
    async def by_account(proposal_id: str, action: str, request: Request, user=Depends(require_user)):
        if action not in actions:
            raise ApiError('RESOURCE_NOT_FOUND', 404)
        data = await body(request)
        digest = await run_in_threadpool(backend().link_hash, user, uuid(proposal_id))
        return await actions[action](digest, data)

    return router
