"""What PayPal says now about this project's payments: the tool behind "why hasn't this payment gone through?".

Read-only. The backend scopes the payments to the owner and project; the agent only decides when to look.
Orders and disputes are read through the PayPal Agent Toolkit. The toolkit has no capture read, so that one uses our client."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import json

from paypal.client import PayPalError

from .errors import ApiError
from .vector_contract import digest

PAYMENTS_TOOL = {
    'name': 'read_paypal_payments',
    'description': "Asks PayPal now for the live state of this project's payment requests: order status, capture status and its reason, seller protection and disputes, next to what Trato has recorded.",
    'when_to_use': 'Use when the user asks why a payment has not arrived, is stuck or pending, whether the client has paid or approved it, or what to do about a payment.',
    'parameters': {'type': 'object', 'additionalProperties': False, 'required': [], 'properties': {}},
}
LIMIT = 12


def order_facts(order):
    # Never the toolkit's own "message": it says "successfully captured" for every order, captured or not.
    raw = order.get('raw')
    raw = raw if isinstance(raw, dict) else {}
    return {'status': order.get('status'), 'created_at': raw.get('create_time'), 'updated_at': raw.get('update_time'),
            'client_approved_in_paypal': bool(raw.get('payer'))}


def capture_facts(capture):
    details = capture.get('status_details')
    protection = capture.get('seller_protection')
    return {'status': capture.get('status'), 'reason': details.get('reason') if isinstance(details, dict) else None,
            'seller_protection': protection.get('status') if isinstance(protection, dict) else None,
            'updated_at': capture.get('update_time')}


def dispute_facts(listing):
    return [{'status': item.get('status'), 'reason': item.get('reason')} for item in listing.get('items') or [] if isinstance(item, dict)]


def error_code(error):
    return getattr(error, 'code', None) or 'PAYPAL_REQUEST_FAILED'


def live_state(toolkit, client, row):
    """A failed read stays visible as that read's error; it is never reported as a state."""
    state = {'order': None, 'capture': None, 'disputes': None, 'paypal_errors': []}
    reads = [('order', lambda: order_facts(toolkit.get_order(row['order_id'])))] if row.get('order_id') else []
    if row.get('capture_id'):
        reads += [('capture', lambda: capture_facts(client.get_capture(row['capture_id']))),
                  ('disputes', lambda: dispute_facts(toolkit.list_disputes(row['capture_id'])))]
    for name, read in reads:
        try:
            state[name] = read()
        except (PayPalError, ApiError) as error:
            state['paypal_errors'].append({'read': name, 'code': error_code(error)})
    return state


def payment_rows(repo, owner, project):
    common = {'owner_id': 'eq.' + owner, 'project_id': 'eq.' + project['id']}
    changes = repo.rows('proposal_payments', {'select': 'proposal_id,revision_id,amount_minor,currency,status,order_id,capture_id,created_at,updated_at', **common, 'order': 'created_at.desc', 'limit': LIMIT})
    stages = repo.rows('project_initial_checkouts', {'select': 'stage_position,amount_minor,currency,status,order_id,capture_id,created_at,updated_at,paid_at', **common, 'order': 'created_at.desc', 'limit': LIMIT})
    versions = {r['id']: r['revision_no'] for r in repo.rows('proposal_revisions', {'select': 'id,revision_no', **common, 'limit': 1000})} if changes else {}
    titles = {s['position']: s['title'] for s in repo.rows('project_start_stages', {'select': 'position,title', **common})} if stages else {}
    rows = [{**row, 'what': {'kind': 'addendum', 'version': versions.get(row['revision_id'])}} for row in changes]
    rows += [{**row, 'what': {'kind': 'deliverable', 'number': row['stage_position'], 'title': titles.get(row['stage_position'])}} for row in stages]
    return sorted(rows, key=lambda row: row.get('created_at') or '', reverse=True)[:LIMIT]


def payments_source(repo, owner, project, reader=None):
    rows = payment_rows(repo, owner, project)
    if rows:
        from .disputes import DisputeReader
        reader = reader if reader is not None else DisputeReader()
        toolkit, client = reader.provider(), reader.writer()
        with ThreadPoolExecutor(max_workers=4) as pool:
            states = list(pool.map(lambda row: live_state(toolkit, client, row), rows))
    else:
        states = []
    value = {'consulted_at': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'environment': 'PayPal Sandbox',
             'payments': [{'for': row['what'], 'amount_minor': row['amount_minor'], 'currency': row['currency'], 'trato_status': row['status'],
                           'requested_at': row.get('created_at'), 'paypal_order_created': bool(row.get('order_id')), **state}
                          for row, state in zip(rows, states)]}
    record = {'file_id': project['id'], 'title': 'PayPal payments', 'source_kind': 'paypal', 'generation': digest(value),
              'text': json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))}
    record['source_id'] = digest(record)
    return record
