"""PayPal tells Trato that a client approved or paid, so the payment is confirmed even if the client never returns to Trato.

On its own listener (PAYPAL_PAYMENT_WEBHOOK_ID). The event is only a signal: it runs the same check as the client's return page
and Verify payment (checkout with capture), which reads the order back from PayPal and records only what PayPal confirms."""
import os
import re

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from paypal.client import PayPalError, PayPalSandboxClient
from paypal.config import SandboxSettings
from .business_routes import read_bytes
from .errors import ApiError
from .initial_payments.workflow import InitialPayments
from .proposals.workflow import BackendStore, ProposalWorkflow
from .refunds.webhook import decode_event

EVENTS = {'CHECKOUT.ORDER.APPROVED', 'PAYMENT.CAPTURE.COMPLETED', 'PAYMENT.CAPTURE.PENDING', 'PAYMENT.CAPTURE.DENIED'}
# A paid PayPal invoice: only a signal, the invoice and its capture are read back from PayPal before anything is recorded.
INVOICE_PAID = 'INVOICING.INVOICE.PAID'
ORDER = re.compile(r'[A-Z0-9]{8,32}')
INVOICE = re.compile(r'INV2(?:-[A-Z0-9]{4}){4}')
# Where each kind of Trato payment lives, and the checkout that confirms it.
TABLES = (('change', 'proposal_payments'), ('initial', 'project_initial_checkouts'))


def order_id(event):
    resource = event.get('resource') if isinstance(event.get('resource'), dict) else {}
    if event['event_type'] == 'CHECKOUT.ORDER.APPROVED':
        value = resource.get('id')
    else:
        related = (resource.get('supplementary_data') or {}).get('related_ids') if isinstance(resource.get('supplementary_data'), dict) else None
        value = related.get('order_id') if isinstance(related, dict) else None
    return value if isinstance(value, str) and ORDER.fullmatch(value) else None


def invoice_id(event):
    resource = event.get('resource') if isinstance(event.get('resource'), dict) else {}
    nested = resource.get('invoice') if isinstance(resource.get('invoice'), dict) else {}
    for value in (resource.get('id'), nested.get('id')):
        if isinstance(value, str) and INVOICE.fullmatch(value):
            return value
    return None


class PaymentWebhook:
    def __init__(self, settings, *, paypal=None, store=None, checkouts=None, invoices=None):
        self.settings, self.paypal, self.store = settings, paypal, store
        self.checkouts, self.invoices = checkouts, invoices

    def provider(self):
        if self.paypal is not None:
            return self.paypal  # Explicit test dependency, never an error fallback.
        config = SandboxSettings.from_env()
        if config.environment != 'sandbox':
            raise ApiError('LIVE_PAYMENTS_DISABLED', 503)
        listener = os.getenv('PAYPAL_PAYMENT_WEBHOOK_ID', '')
        if not listener:
            raise ApiError('PAYPAL_PAYMENT_WEBHOOK_NOT_CONFIGURED', 503)
        return PayPalSandboxClient(config.client_id, config.client_secret, config.merchant_id, listener)

    def confirm(self, kind, token):
        if self.checkouts is not None:
            return self.checkouts[kind](token)
        if kind == 'change':
            return ProposalWorkflow(self.settings, None).checkout(token, capture=True)
        return InitialPayments(self.settings).checkout(token, capture=True)

    def find(self, order):
        repo = (self.store or BackendStore(self.settings)).repo
        for kind, table in TABLES:
            rows = repo.rows(table, {'select': 'checkout_token', 'order_id': 'eq.' + order, 'limit': 2})
            if len(rows) == 1:
                return kind, rows[0]['checkout_token']
        return None, None

    def confirm_invoice(self, invoice):
        repo = (self.store or BackendStore(self.settings)).repo
        # An invoice collects either an addendum or a Work plan deliverable.
        for kind, table in TABLES:
            rows = repo.rows(table, {
                'select': 'id,owner_id,method,status,invoice_id,invoice_number,amount_minor,currency,merchant_id',
                'invoice_id': 'eq.' + invoice, 'method': 'eq.invoice', 'limit': 2})
            if len(rows) == 1:
                if self.invoices is not None:
                    return self.invoices(rows[0])
                service = ProposalWorkflow(self.settings, None) if kind == 'change' else InitialPayments(self.settings)
                return service.invoices().verify(rows[0])
        return None  # Not an invoice Trato issued: nothing to confirm.

    def receive(self, raw, headers):
        event = decode_event(raw)
        try:
            if not self.provider().verify_webhook(headers, event):
                raise ApiError('INVALID_PAYPAL_SIGNATURE', 401)
        except PayPalError as error:
            raise ApiError(error.code, 503) from None
        if event['event_type'] == INVOICE_PAID:
            invoice = invoice_id(event)
            if invoice is None:
                return {'received': True, 'applied': False}
            try:
                # Idempotent: a completed invoice payment returns as it is.
                result = self.confirm_invoice(invoice)
            except ApiError:
                raise ApiError('PAYMENT_WEBHOOK_PROCESSING_FAILED', 503) from None
            if result is None:
                return {'received': True, 'applied': False}
            return {'received': True, 'applied': True, 'kind': 'invoice', 'status': result.get('status')}
        if event['event_type'] not in EVENTS:
            return {'received': True, 'applied': False}
        order = order_id(event)
        if order is None:
            return {'received': True, 'applied': False}
        kind, token = self.find(order)
        if kind is None:
            return {'received': True, 'applied': False}  # Not an order Trato created: nothing to confirm.
        try:
            # Idempotent: a completed payment returns as it is, and capture runs only once under the backend's claim.
            status = self.confirm(kind, token).get('status')
        except ApiError:
            # PayPal sends the event again later; the payment keeps its last verified state meanwhile.
            raise ApiError('PAYMENT_WEBHOOK_PROCESSING_FAILED', 503) from None
        return {'received': True, 'applied': True, 'kind': kind, 'status': status}


def build_payment_webhook_router(settings, *, webhook=None):
    router = APIRouter()

    @router.post('/api/v1/payments/webhooks/paypal')
    async def receive(request: Request):
        raw = await read_bytes(request, 256 * 1024)
        result = await run_in_threadpool((webhook or PaymentWebhook(settings)).receive, raw, dict(request.headers))
        return JSONResponse({'data': result}, headers={'Cache-Control': 'no-store'})
    return router
