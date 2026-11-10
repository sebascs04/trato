"""PayPal invoice for an accepted addendum, issued with the official PayPal Agent Toolkit once the freelancer confirms.

The backend sets amount, currency and recipient from the accepted revision; the freelancer only writes the concept.
An invoice counts as paid only when PayPal shows it PAID through one PayPal transaction whose capture, read back,
is COMPLETED for the same amount and belongs to this invoice. Marked-as-paid or external payments never complete it."""
import json
import os
import re
import secrets

from paypal.agent_toolkit import AgentToolkit
from paypal.client import PayPalError, exact_amount
from paypal.config import SandboxSettings
from paypal.email import valid_email
from ..errors import ApiError
from .workflow import BackendStore

INVOICE_ID = re.compile(r'INV2(?:-[A-Z0-9]{4}){4}')
INVOICE_URL = re.compile(r'https://www\.sandbox\.paypal\.com/invoice/p/#[A-Za-z0-9-]{1,64}')
NUMBER_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
# States in which PayPal already delivered the invoice to the client.
DELIVERED = frozenset({'SENT', 'UNPAID', 'PAYMENT_PENDING', 'PAID'})
CONCEPT_LIMIT = 200  # PayPal's limit for an item name.


def invoice_number():
    # PayPal rejects a repeated number (DUPLICATE_INVOICE_NUMBER) and accepts fewer than 25 characters.
    return 'TR-' + ''.join(secrets.choice(NUMBER_CHARS) for _ in range(10))


def money(minor):
    return f'{minor // 100}.{minor % 100:02d}'


def mismatch():
    return ApiError('PAYMENT_EVIDENCE_MISMATCH', 409)


class InvoiceStore(BackendStore):
    def command(self, owner, action, data):
        return self.repo.rpc('proposal_invoice_backend', {'p_owner': owner, 'p_action': action, 'p_data': data})


class StageInvoiceStore(BackendStore):
    def command(self, owner, action, data):
        return self.repo.rpc('stage_invoice_backend', {'p_owner': owner, 'p_action': action, 'p_data': data})


class PayPalInvoices:
    """Issues and verifies one PayPal invoice for a payment row; each kind of payment brings its own store."""
    STORE = InvoiceStore

    def __init__(self, workflow, *, store=None, toolkit=None):
        self.workflow, self.store, self.toolkit = workflow, store, toolkit

    def backend(self):
        return self.store if self.store is not None else self.STORE(self.workflow.settings)

    def agent(self):
        if self.toolkit is not None:
            return self.toolkit  # Explicit test dependency, never an error fallback.
        config = SandboxSettings.from_env()
        if config.environment != 'sandbox':
            raise ApiError('LIVE_PAYMENTS_DISABLED', 503)
        if not all((config.client_id, config.client_secret, config.merchant_id)):
            raise ApiError('PAYPAL_SANDBOX_NOT_CONFIGURED', 503)
        return AgentToolkit(config.client_id, config.client_secret)

    def payer(self, repo, owner, project_id):
        # Same recipient rule as the other PayPal requests: the client's registered email, or the Sandbox buyer bound
        # to this freelancer while testing.
        project = repo.project(project_id)
        clients = repo.rows('clients', {'select': 'contact_email', 'id': 'eq.' + project['client_id'], 'owner_id': 'eq.' + owner,
                                        'deleted_at': 'is.null'})
        if len(clients) != 1 or not valid_email(clients[0].get('contact_email', '')):
            raise ApiError('CLIENT_EMAIL_REQUIRED', 409)
        payer = clients[0]['contact_email']
        bindings = os.getenv('TRATO_SANDBOX_INITIAL_PAYER_BINDINGS', '')
        if bindings:
            try:
                values = json.loads(bindings)
                if os.getenv('PAYPAL_ENVIRONMENT') != 'sandbox' or not isinstance(values, dict) or any(not valid_email(x) for x in values.values()):
                    raise ValueError()
                payer = values.get(owner, payer)
            except (ValueError, TypeError):
                raise ApiError('REFUND_SANDBOX_BINDING_INVALID', 503) from None
        return payer, project.get('name') or ''

    @staticmethod
    def concept(value):
        value = ' '.join(str(value or '').split())
        if not 1 <= len(value) <= CONCEPT_LIMIT:
            raise ApiError('INVOICE_CONCEPT_REQUIRED', 422)
        return value

    def issue(self, pay, payer, concept, project_name):
        agent = self.agent()
        try:
            invoice_id = pay.get('invoice_id') or self.find(agent, pay['invoice_number'])
            if not invoice_id:
                created = agent.create_invoice({
                    'currency_code': pay['currency'], 'invoice_number': pay['invoice_number'],
                    'note': project_name[:500] if project_name else None,
                    'primary_recipients': [{'billing_info': {'email_address': payer}}],
                    'items': [{'name': concept, 'quantity': '1',
                               'unit_amount': {'currency_code': pay['currency'], 'value': money(pay['amount_minor'])}}],
                    'allow_partial_payment': False})
                found = INVOICE_ID.search(str(created.get('href') or created.get('id') or ''))
                if not found:
                    raise PayPalError('INVALID_PROVIDER_RESPONSE', uncertain=True)
                invoice_id = found.group(0)
            invoice = self.check(agent.get_invoice(invoice_id), pay, invoice_id)
            if invoice.get('status') == 'DRAFT':
                agent.send_invoice(invoice_id)
                invoice = self.check(agent.get_invoice(invoice_id), pay, invoice_id)
            if invoice.get('status') not in DELIVERED:
                raise PayPalError('INVOICE_NOT_SENT', status=409)
            url = ((invoice.get('detail') or {}).get('metadata') or {}).get('recipient_view_url')
            if not isinstance(url, str) or not INVOICE_URL.fullmatch(url):
                raise PayPalError('INVALID_PROVIDER_RESPONSE')
            pay = self.backend().command(pay['owner_id'], 'record', {'payment_id': pay['id'], 'invoice_id': invoice_id, 'invoice_url': url})
        except (PayPalError, ApiError) as error:
            # The invoice number stays reserved, so a retry finds this invoice instead of creating another one.
            self.backend().command(pay['owner_id'], 'uncertain', {'payment_id': pay['id'], 'error_code': error.code})
            if isinstance(error, ApiError):
                raise
            raise ApiError(error.code, error.status) from None
        return self.verify(pay)

    @staticmethod
    def find(agent, number):
        found = agent.search_invoices(number)
        items = [item for item in (found.get('items') or []) if isinstance(item, dict)
                 and (item.get('detail') or {}).get('invoice_number') == number]
        if len(items) > 1:
            raise mismatch()
        if not items:
            return None
        if not INVOICE_ID.fullmatch(str(items[0].get('id') or '')):
            raise PayPalError('INVALID_PROVIDER_RESPONSE')
        return items[0]['id']

    @staticmethod
    def check(invoice, pay, invoice_id):
        # The invoice PayPal returns must be ours: same id, number, currency and total.
        amount = invoice.get('amount') or {}
        try:
            same_total = exact_amount(amount.get('value')) == exact_amount(money(pay['amount_minor']))
        except PayPalError:
            same_total = False
        if (invoice.get('id') != invoice_id or (invoice.get('detail') or {}).get('invoice_number') != pay['invoice_number']
                or amount.get('currency_code') != pay['currency'] or not same_total):
            raise mismatch()
        return invoice

    def verify(self, pay):
        """Reads the invoice back and completes the change only with PayPal's verified capture."""
        if pay.get('method') != 'invoice' or pay.get('status') == 'completed' or not pay.get('invoice_id'):
            return pay
        try:
            invoice = self.check(self.agent().get_invoice(pay['invoice_id']), pay, pay['invoice_id'])
            if invoice.get('status') != 'PAID':
                return pay
            total = money(pay['amount_minor'])
            payments = invoice.get('payments') or {}
            paid = payments.get('paid_amount') or {}
            transactions = payments.get('transactions') or []
            if ((invoice.get('due_amount') or {}).get('value') != '0.00'
                    or paid.get('currency_code') != pay['currency'] or exact_amount(paid.get('value')) != exact_amount(total)
                    or len(transactions) != 1):
                raise mismatch()
            transaction = transactions[0]
            if (transaction.get('type') != 'PAYPAL' or transaction.get('method') != 'PAYPAL'
                    or transaction.get('transaction_status') != 'SUCCESS'):
                raise mismatch()
            capture = self.workflow.provider().get_capture(transaction.get('payment_id'))
            captured = capture.get('amount') or {}
            if (capture.get('id') != transaction.get('payment_id') or capture.get('status') != 'COMPLETED'
                    or capture.get('invoice_id') != pay['invoice_id'] or captured.get('currency_code') != pay['currency']
                    or exact_amount(captured.get('value')) != exact_amount(total)):
                raise mismatch()
        except PayPalError as error:
            raise ApiError(error.code, error.status) from None
        return self.backend().command(pay['owner_id'], 'apply', {
            'payment_id': pay['id'], 'invoice_id': pay['invoice_id'], 'capture_id': capture['id'],
            'amount_minor': pay['amount_minor'], 'currency': pay['currency'], 'merchant_id': pay['merchant_id']})


class AddendumInvoices(PayPalInvoices):
    def send(self, repo, owner, proposal_id, revision_id, concept):
        concept = self.concept(concept)
        snapshot = repo.get_revision(proposal_id, revision_id, collections=('payments',))  # Only the owner reads it.
        if snapshot['proposal']['current_revision_id'] != revision_id:
            raise ApiError('PROPOSAL_REVISION_CONFLICT', 409)
        existing = (snapshot.get('payments') or [None])[0]
        if existing and existing.get('order_id') and existing.get('status') != 'completed' and not existing.get('capture_attempted'):
            # Read the order back first: one the client already approved can no longer be replaced by an invoice.
            try:
                self.workflow.apply({**existing, 'owner_id': owner}, self.workflow.provider().get_order(existing['order_id']))
            except PayPalError as error:
                raise ApiError(error.code, error.status) from None
        payer, project_name = self.payer(repo, owner, snapshot['proposal']['project_id'])
        pay = self.backend().command(owner, 'claim', {
            'proposal_id': proposal_id, 'revision_id': revision_id, 'merchant_id': SandboxSettings.from_env().merchant_id,
            'token': secrets.token_urlsafe(32), 'invoice_number': invoice_number()})
        if not pay.get('acquired'):
            return self.verify(pay)
        return self.issue(pay, payer, concept, project_name)


class StageInvoices(PayPalInvoices):
    """Invoice for a Work plan deliverable. Its payment is prepared first (delivery evidence and the plan's amount);
    the invoice then replaces its order."""
    STORE = StageInvoiceStore

    def send(self, repo, owner, project_id, concept):
        concept = self.concept(concept)
        pay = self.workflow.get(repo, owner, project_id)  # Only the owner reads it.
        if pay is None:
            raise ApiError('INITIAL_PAYMENT_NOT_FOUND', 404)
        if pay.get('method') != 'invoice' and pay.get('order_id') and pay.get('status') != 'completed':
            self.workflow.reconcile(repo, owner, project_id)  # Read the order back: an approved one is not replaced.
        payer, project_name = self.payer(repo, owner, project_id)
        claim = self.backend().command(owner, 'claim', {
            'project_id': project_id, 'stage_position': self.workflow.position, 'invoice_number': invoice_number()})
        if not claim.get('acquired'):
            return self.verify(claim)
        return self.issue(claim, payer, concept, project_name)
