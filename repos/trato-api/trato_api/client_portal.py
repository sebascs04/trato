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
        return self.repo.rpc('client_portal_view', {'p_token_hash': digest})

    # Client accounts. The database checks the client role, the verified email and the saved client record.
    def agreements(self, user):
        return self.repo.rpc('client_account_agreements', {'p_user': uuid(user)})

    def link_hash(self, user, proposal_id):
        digest = self.repo.rpc('client_account_link_hash', {'p_user': uuid(user), 'p_proposal': proposal_id})
        if not isinstance(digest, str) or not SHA256.fullmatch(digest):
            raise ApiError('AGREEMENT_NOT_FOUND', 404)
        return digest

    def request_changes(self, digest, notes):
        return self.repo.rpc('client_portal_request_changes', {'p_token_hash': digest, 'p_notes': notes})

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
            'payment_required', 'payment_status', 'change_request')
    return {key: view.get(key) for key in keys}


PAYPAL_APPROVAL = re.compile(r'^https://www\.sandbox\.paypal\.com/[^\s"<>]+$')


def build_client_portal_router(settings, store=None, payments=None, require_user=None, disputes=None, jobs=None, preferences=None):
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
        return reply(public_view(await run_in_threadpool(backend().view, digest)))

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
        return reply({'status': result.get('status'), 'approval_url': url})

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

    async def assistant_by(digest, data):
        from .portal_assistant import ask
        queue, models = assistant_services()
        item = await run_in_threadpool(backend().view, digest)
        return reply(await run_in_threadpool(ask, queue, models, digest, item, data))

    async def assistant_status_by(digest, data):
        from .portal_assistant import status
        # The view call first: a revoked or expired link stops reading its answers too.
        await run_in_threadpool(backend().view, digest)
        return reply(await run_in_threadpool(status, assistant_services()[0], digest, data))

    actions = {'view': lambda digest, data: view_by(digest), 'dispute': lambda digest, data: dispute_by(digest), 'dispute-document': dispute_document_by, 'document': lambda digest, data: document_by(digest),
               'accept': accept_by, 'pay': lambda digest, data: pay_by(digest), 'request-changes': request_changes_by,
               'assistant': assistant_by, 'assistant-status': assistant_status_by}

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

    @router.get('/account/disputes')
    async def account_disputes(user=Depends(require_user)):
        # Asked apart from the agreements so PayPal's response time never delays the client's overview.
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
            with ThreadPoolExecutor(max_workers=4) as pool:
                rows = [row for row in pool.map(one, paid) if row] if paid else []
            return {proposal_id: {'dispute_id': found['dispute_id'], 'status': found['status'], 'reason': found['reason']} for proposal_id, found in rows}
        return reply(await run_in_threadpool(read))

    @router.post('/account/agreements/{proposal_id}/{action}')
    async def by_account(proposal_id: str, action: str, request: Request, user=Depends(require_user)):
        if action not in actions:
            raise ApiError('RESOURCE_NOT_FOUND', 404)
        data = await body(request)
        digest = await run_in_threadpool(backend().link_hash, user, uuid(proposal_id))
        return await actions[action](digest, data)

    return router
