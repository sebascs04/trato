"""One click refund, for the client's own request and for the freelancer's manual flow.

Deciding to refund is the confirmation, so there is no proposal email to wait for and no separate authorization step.
Every step is an existing one (the version's PDF saved in the project, the PayPal check, the authorization and the
execution), chained on the server and safe to repeat: each resumes from the settlement's saved status, so a cut
connection never refunds twice.
- The client's request (refund_client_request): only for everything still refundable on that payment, no deductions;
  the authenticated request is the client's acceptance.
- The manual flow (refund_settlement): the freelancer registered the request with its evidence and saved the proposal;
  that registration is the agreement.
"""
from ..errors import ApiError
from ..persistence import uuid

NOTE = 'Full refund the client requested from their Trato space.'
MANUAL_NOTE = 'Refund registered and agreed by the freelancer.'


def _finish(repo, owner, parent, snapshot, key, *, finance, pdf, complete, language, accept, note):
    settlement = repo.settlement(parent)
    if settlement['status'] in ('draft', 'awaiting_response'):
        # The record of what was agreed stays in the project's documents; it is not emailed to the client.
        try:
            pdf(repo, owner, parent, snapshot, language, f'{key}-pdf')
        except ApiError as error:
            # This version already has its PDF, in the other language: that one is the record.
            if error.code != 'REFUND_PDF_LANGUAGE_LOCKED':
                raise
        accept()
        settlement = repo.settlement(parent)
    if settlement['status'] == 'accepted':
        check = finance.check(repo, owner, parent, snapshot)['check']
        repo.financial_authorize({'settlement_id': parent, 'expected_snapshot_id': snapshot, 'check_id': check['id'],
                                  'digest': check['digest'], 'confirmed': True, 'notes': note}, f'{key}-authorize-{check["id"]}')
        settlement = repo.settlement(parent)
    if settlement['status'] == 'refund_pending':
        view = repo.financial(parent)
        authorizations = [a for a in view.get('authorizations', []) if a.get('snapshot_id') == snapshot]
        if len(authorizations) != 1:
            raise ApiError('REFUND_AUTHORIZATION_NOT_FOUND', 409)
        complete(finance.execute, repo, owner, parent, authorizations[0]['id'], f'{key}-execute')
    return {'settlement': repo.settlement(parent), 'financial': repo.financial(parent)}


def refund_client_request(repo, owner, project_id, request_id, key, *, finance, pdf, complete, language):
    rows = repo.rows('client_refund_requests', {'select': 'id,project_id,received_payment_id,requested_minor,status,settlement_id',
                                                'id': 'eq.' + uuid(request_id), 'project_id': 'eq.' + uuid(project_id)})
    if len(rows) != 1:
        raise ApiError('REFUND_REQUEST_NOT_FOUND', 404)
    item = rows[0]
    if item['status'] == 'open':
        # Same intake guard as the usual form: never while PayPal holds a dispute on this payment.
        finance.check_intake(repo, item['project_id'], {'scope': 'payment_only', 'payment_id': item['received_payment_id']})
    created = repo.rpc('client_refund_request_settle', {'p_request': item['id']})
    parent, snapshot = created['settlement']['id'], created['snapshot']['id']
    return _finish(repo, owner, parent, snapshot, key, finance=finance, pdf=pdf, complete=complete, language=language, note=NOTE,
                   accept=lambda: repo.rpc('client_refund_request_accept', {'p_request': item['id']}))


def refund_settlement(repo, owner, settlement_id, snapshot_id, key, *, finance, pdf, complete, language):
    settlement = repo.settlement(settlement_id)
    if settlement.get('owner_id') != str(owner):
        raise ApiError('REFUND_NOT_FOUND', 404)
    if settlement['current_snapshot_id'] != snapshot_id:
        raise ApiError('REFUND_REVISION_CONFLICT', 409)
    parent = settlement['id']
    return _finish(repo, owner, parent, snapshot_id, key, finance=finance, pdf=pdf, complete=complete, language=language, note=MANUAL_NOTE,
                   accept=lambda: repo.rpc('refund_freelancer_accept', {'p_settlement': parent, 'p_snapshot': snapshot_id}))
