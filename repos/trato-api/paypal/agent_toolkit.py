"""Read-only PayPal tools from the official PayPal Agent Toolkit, used by the backend.

The toolkit has no request timeout of its own, so every call runs under one here. It only exposes reads we allow below;
actions it lacks (answering a dispute, submitting evidence) go through paypal/client.py after the freelancer approves them."""
import json
import time
from queue import Empty, Queue
from threading import Lock, Thread

from .client import PayPalError

READ_ONLY_TOOLS = frozenset({'list_disputes', 'get_dispute', 'get_order_details'})
# Invoice tools, a separate explicit list: the backend calls them only after the freelancer confirms the invoice.
INVOICE_TOOLS = frozenset({'create_invoice', 'send_invoice', 'get_invoice', 'search_invoicing'})
TOKEN_SECONDS = 1800  # PayPal tokens last hours; the toolkit asks for a new one on every call, which costs ~1 s each.
_shared_lock = Lock()
_shared_api = {}


def reuse_token(api, *, clock=time.monotonic):
    """The toolkit (pinned version) reads its token through this one method."""
    client = api._paypal_client
    fetch, lock, cached = client.get_access_token, Lock(), {}

    def token():
        with lock:
            if not cached or clock() >= cached['until']:
                cached.update(value=fetch(), until=clock() + TOKEN_SECONDS)
            return cached['value']
    client.get_access_token = token
    return api


def default_api(client_id, client_secret):
    from paypal_agent_toolkit.shared.api import PayPalAPI
    from paypal_agent_toolkit.shared.configuration import Context
    with _shared_lock:
        key = (client_id, client_secret)
        if key not in _shared_api:
            _shared_api.clear()
            _shared_api[key] = reuse_token(PayPalAPI(client_id=client_id, secret=client_secret, context=Context(sandbox=True, source='Trato')))
        return _shared_api[key]


class AgentToolkit:
    def __init__(self, client_id, client_secret, *, api=None, timeout=20):
        if api is None and (not client_id or not client_secret):
            raise PayPalError('PAYPAL_SANDBOX_NOT_CONFIGURED', status=503)
        self.client_id, self.client_secret, self.api, self.timeout = client_id, client_secret, api, timeout

    def _run(self, tool, params, allowed=READ_ONLY_TOOLS):
        if tool not in allowed:
            raise PayPalError('PAYPAL_TOOL_NOT_ALLOWED', status=422)
        results = Queue(maxsize=1)

        def call():
            try:
                api = self.api if self.api is not None else default_api(self.client_id, self.client_secret)
                results.put(('ok', api.run(tool, params)))
            except Exception as error:  # Crosses the thread boundary; classified below, details are never returned.
                results.put(('error', error))
        # A daemon thread cannot block a restart if PayPal never answers.
        Thread(target=call, daemon=True).start()
        try:
            status, value = results.get(timeout=self.timeout)
        except Empty:
            raise PayPalError('PAYPAL_UNAVAILABLE', status=503) from None
        if status == 'error':
            raise PayPalError('PAYPAL_REQUEST_FAILED') from None
        try:
            data = json.loads(value) if isinstance(value, str) else value
        except ValueError:
            raise PayPalError('INVALID_PROVIDER_RESPONSE') from None
        if not isinstance(data, dict):
            raise PayPalError('INVALID_PROVIDER_RESPONSE')
        return data

    def list_disputes(self, transaction_id):
        return self._run('list_disputes', {'disputed_transaction_id': transaction_id})

    def get_order(self, order_id):
        return self._run('get_order_details', {'order_id': order_id})

    def get_dispute(self, dispute_id):
        return self._run('get_dispute', {'dispute_id': dispute_id})

    def create_invoice(self, params):
        return self._run('create_invoice', params, INVOICE_TOOLS)

    def send_invoice(self, invoice_id):
        return self._run('send_invoice', {'invoice_id': invoice_id, 'send_to_recipient': True}, INVOICE_TOOLS)

    def get_invoice(self, invoice_id):
        return self._run('get_invoice', {'invoice_id': invoice_id}, INVOICE_TOOLS)

    def search_invoices(self, invoice_number):
        return self._run('search_invoicing', {'resource_type': 'invoice', 'page_size': 5,
                                              'invoice_filters': {'invoice_number': invoice_number}}, INVOICE_TOOLS)
