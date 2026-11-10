"""The project's own record of its PayPal disputes, shown as a group in the project history.

Every event comes from what PayPal returned for a dispute on this project's verified payments, so the record cannot claim
anything PayPal did not report. Saving is idempotent: reading the same dispute again adds only what is new."""
from datetime import datetime, timezone

from .errors import ApiError

KINDS = {'BUYER': 'client_message', 'SELLER': 'freelancer_message'}


def dispute_events(dispute):
    opened = dispute.get('created_at') or next((m['at'] for m in dispute['messages'] if m.get('at')), None)
    events = []
    payment = dispute.get('payment') or {}
    if opened:
        events.append({'event_key': 'opened', 'kind': 'dispute_opened', 'happened_at': opened,
                       'details': {'reason': dispute.get('reason'), 'amount': dispute.get('amount'),
                                   'proposal_payment_id': payment.get('proposal_payment_id'), 'received_payment_id': payment.get('id')}})
    for index, message in enumerate(dispute['messages']):
        if message.get('at'):
            events.append({'event_key': f'message:{index}', 'kind': KINDS.get(message['by'], 'paypal_message'), 'happened_at': message['at'],
                           'details': {'text': message['text'][:500], 'documents': message.get('documents') or []}})
    status, stage = dispute.get('status'), dispute.get('stage')
    # Waiting for one side is everyday back and forth, and PayPal reports "under review" for a moment after a message while
    # still in the inquiry stage. Only a new stage or a resolution is a milestone.
    if dispute.get('updated_at') and (stage != 'INQUIRY' or status == 'RESOLVED'):
        # One event per stage: within a stage, PayPal's status only says whose turn it is.
        key = f'status:{status}:{stage}' if status == 'RESOLVED' else f'stage:{stage}'
        events.append({'event_key': key[:120], 'kind': 'dispute_status', 'happened_at': dispute['updated_at'],
                       'details': {'status': status, 'stage': stage, 'outcome': dispute.get('outcome')}})
    return events


def record_disputes(repo, project_id, disputes):
    """False if the history could not be saved: the dispute itself is still shown, and the interface says so."""
    try:
        for dispute in disputes:
            repo.rpc('record_dispute_events', {'p_project': project_id, 'p_dispute': dispute['dispute_id'], 'p_events': dispute_events(dispute)})
    except ApiError:
        return False
    return True


def record_step(repo, project_id, dispute_id, event_key, kind, details):
    """A step PayPal just accepted from the freelancer. PayPal's own record does not always show it, and it has already happened,
    so a failure here is reported and never undoes it."""
    event = {'event_key': event_key, 'kind': kind, 'happened_at': datetime.now(timezone.utc).isoformat(), 'details': details}
    try:
        repo.rpc('record_dispute_events', {'p_project': project_id, 'p_dispute': dispute_id, 'p_events': [event]})
    except ApiError:
        return False
    return True


def record_escalation(repo, project_id, dispute_id):
    # PayPal keeps reporting the inquiry stage right after an escalation.
    return record_step(repo, project_id, dispute_id, 'escalated', 'dispute_status', {'escalated': True})


def record_evidence(repo, project_id, dispute_id, documents):
    # Evidence can be requested more than once, so each submission is its own event.
    return record_step(repo, project_id, dispute_id, 'evidence:' + datetime.now(timezone.utc).isoformat(), 'freelancer_message', {'evidence': True, 'documents': documents})


def record_accepted_claim(repo, project_id, dispute_id):
    return record_step(repo, project_id, dispute_id, 'accepted_claim', 'freelancer_message', {'accepted': True})


def dispute_rows(repo, project_id, dispute_id=None):
    params = {'select': 'id,dispute_id,kind,details,happened_at', 'project_id': 'eq.' + project_id, 'order': 'happened_at.asc,event_key.asc', 'limit': 1000}
    if dispute_id is not None:
        params['dispute_id'] = 'eq.' + dispute_id
    events = repo.rows('project_dispute_events', params)
    if not events:
        return events
    case_ids = {event['dispute_id'] for event in events}
    receipts = repo.rows('refund_provider_receipts', {
        'select': 'id,dispute_id,amount_minor,currency,confirmed_at',
        'project_id': 'eq.' + project_id, 'status': 'eq.completed',
        'dispute_id': 'eq.' + dispute_id if dispute_id is not None else 'not.is.null',
        'order': 'confirmed_at.asc,id.asc', 'limit': 1000,
    })
    return events + [
        {'id': row['id'], 'dispute_id': row['dispute_id'], 'kind': 'dispute_refund_confirmed',
         'happened_at': row['confirmed_at'], 'details': {'amount_minor': row['amount_minor'], 'currency': row['currency']}}
        for row in receipts if row['confirmed_at'] and row['dispute_id'] in case_ids
    ]


def with_dispute_groups(repo, project_id, groups):
    """Adds one history group per dispute and keeps the list newest first, as the other groups are."""
    found = {}
    for row in dispute_rows(repo, project_id):
        group = found.setdefault(row['dispute_id'], {'group_kind': 'dispute', 'group_id': row['dispute_id'], 'group_title': row['dispute_id'], 'event_count': 0, 'last_at': row['happened_at']})
        group['event_count'] += 1
        group['last_at'] = max(group['last_at'], row['happened_at'])
    if not found:
        return groups
    return sorted([*groups, *found.values()], key=lambda group: group['last_at'], reverse=True)


def dispute_activity(repo, project_id, dispute_id):
    # Newest first, as the other history groups. The opening stays at the very start of the story even when its first message has the same time.
    rows = sorted(dispute_rows(repo, project_id, dispute_id), key=lambda row: (row['happened_at'], row['kind'] != 'dispute_opened'), reverse=True)
    if not rows:
        raise ApiError('ACTIVITY_GROUP_NOT_FOUND', 404)
    return [{**(row.get('details') or {}), 'id': row['id'], 'kind': row['kind'], 'created_at': row['happened_at'],
             'group_kind': 'dispute', 'group_id': dispute_id, 'group_title': dispute_id} for row in rows]
