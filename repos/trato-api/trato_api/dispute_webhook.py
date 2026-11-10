"""PayPal tells Trato a dispute changed, so the project history stays current without anyone opening Disputes.

Reuses the signed inbox of refunds, on its own listener (PAYPAL_DISPUTE_WEBHOOK_ID). The event is only a signal: every fact
comes from reading the dispute back from PayPal, and it is saved only for a project whose verified payment it contests."""
import os
import re

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from paypal.client import PayPalSandboxClient
from paypal.config import SandboxSettings
from .business_routes import read_bytes
from .dispute_history import dispute_events
from .disputes import DisputeReader, summarize
from .errors import ApiError
from .refunds.financial import RefundFinance, RefundFinanceStore
from .refunds.webhook import RefundWebhook

EVENTS = {'CUSTOMER.DISPUTE.CREATED', 'CUSTOMER.DISPUTE.UPDATED', 'CUSTOMER.DISPUTE.RESOLVED'}
DISPUTE_ID = re.compile(r'PP-[A-Z0-9-]{4,40}')


class DisputeWebhookStore(RefundFinanceStore):
    def record(self, owner, project, dispute, events):
        return self.repo.rpc('dispute_webhook_record', {'p_owner': owner, 'p_project': project, 'p_dispute': dispute, 'p_events': events})


class DisputeListener(RefundFinance):
    """The refund flow's backend and provider, pointed at the disputes listener."""
    def backend(self):
        return self.store if self.store is not None else DisputeWebhookStore(self.settings)

    def provider(self, *, webhook=False):
        if self.paypal is not None:
            return self.paypal  # Explicit test dependency, never an error fallback.
        config = SandboxSettings.from_env()
        if config.environment != 'sandbox':
            raise ApiError('LIVE_PAYMENTS_DISABLED', 503)
        listener = os.getenv('PAYPAL_DISPUTE_WEBHOOK_ID', '')
        if not listener:
            raise ApiError('PAYPAL_DISPUTE_WEBHOOK_NOT_CONFIGURED', 503)
        return PayPalSandboxClient(config.client_id, config.client_secret, config.merchant_id, listener)


class DisputeWebhook(RefundWebhook):
    def __init__(self, finance, reader=None, alerts=None):
        super().__init__(finance)
        self.reader, self.alerts = reader or DisputeReader(), alerts

    def process(self, event, client, store):
        if event['event_type'] not in EVENTS or not isinstance(event.get('resource'), dict):
            return False
        dispute_id = event['resource'].get('dispute_id')
        if not isinstance(dispute_id, str) or not DISPUTE_ID.fullmatch(dispute_id):
            return False
        dispute = self.reader.provider().get_dispute(dispute_id)
        captures = {t.get('seller_transaction_id') for t in dispute.get('disputed_transactions') or [] if isinstance(t, dict)} - {None}
        for capture in captures:
            lookup = store.webhook('lookup', {'capture_id': capture, 'merchant_id': client.merchant_id})
            if not lookup['found']:
                continue
            payment = lookup['payment']
            summary = summarize(dispute, payment)
            if summary:
                store.record(payment['owner_id'], payment['project_id'], summary['dispute_id'], dispute_events(summary))
                if self.alerts is not None:
                    # The history is saved; the freelancer's email is best effort and sent once per dispute.
                    try:
                        self.alerts.notify(payment['owner_id'], payment['project_id'], summary)
                    except (ApiError, KeyError, TypeError):
                        pass
                return True
        return False  # Not about a payment Trato knows: nothing to save.


def build_dispute_webhook_router(settings, *, finance=None, reader=None, gmail=None):
    router = APIRouter()

    @router.post('/api/v1/disputes/webhooks/paypal')
    async def receive(request: Request):
        raw = await read_bytes(request, 256 * 1024)
        flow = finance or DisputeListener(settings)
        from .dispute_alerts import DisputeAlerts
        hook = DisputeWebhook(flow, reader, DisputeAlerts(settings, flow.backend(), gmail) if gmail is not None else None)
        result = await run_in_threadpool(hook.receive, raw, dict(request.headers))
        return JSONResponse({'data': result}, headers={'Cache-Control': 'no-store'})
    return router
