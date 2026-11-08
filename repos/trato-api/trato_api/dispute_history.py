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
        events.append({'event_key': f'status:{status}:{stage}'[:120], 'kind': 'dispute_status', 'happened_at': dispute['updated_at'],
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


def record_escalation(repo, project_id, dispute_id):
    """PayPal keeps reporting the inquiry stage after an escalation, so the record comes from the escalation PayPal just accepted."""
    event = {'event_key': 'escalated', 'kind': 'dispute_status', 'happened_at': datetime.now(timezone.utc).isoformat(), 'details': {'escalated': True}}
    try:
        repo.rpc('record_dispute_events', {'p_project': project_id, 'p_dispute': dispute_id, 'p_events': [event]})
    except ApiError:
        return False
    return True


def dispute_rows(repo, project_id, dispute_id=None):
    params = {'select': 'id,dispute_id,kind,details,happened_at', 'project_id': 'eq.' + project_id, 'order': 'happened_at.asc,event_key.asc', 'limit': 1000}
    if dispute_id is not None:
        params['dispute_id'] = 'eq.' + dispute_id
    return repo.rows('project_dispute_events', params)


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
    # Stable by time; a dispute's opening comes first even when its first message carries the same timestamp.
    rows = sorted(dispute_rows(repo, project_id, dispute_id), key=lambda row: (row['happened_at'], row['kind'] != 'dispute_opened'))
    if not rows:
        raise ApiError('ACTIVITY_GROUP_NOT_FOUND', 404)
    return [{**(row.get('details') or {}), 'id': row['id'], 'kind': row['kind'], 'created_at': row['happened_at'],
             'group_kind': 'dispute', 'group_id': dispute_id, 'group_title': dispute_id} for row in rows]
