"""Business milestones for the existing project activity feed (no technical retries)."""
from ..errors import ApiError

QUERIES={
    'refunds':('refund_settlements',{'select':'id,reason,status,created_at,closed_at'}),
    'refund_snapshots':('refund_snapshots',{'select':'id,settlement_id,version_no'}),
    'refund_deliveries':('refund_deliveries',{'select':'id,settlement_id,snapshot_id,updated_at','status':'eq.accepted_by_gmail'}),
    'refund_feedback':('refund_feedback',{'select':'settlement_id,snapshot_id,created_at','order':'snapshot_id.asc'}),
    'refund_acceptances':('refund_acceptances',{'select':'settlement_id,snapshot_id,created_at','order':'snapshot_id.asc'}),
    'refund_authorizations':('refund_financial_authorizations',{'select':'id,settlement_id,snapshot_id,created_at'}),
    'refund_receipts':('refund_provider_receipts',{'select':'id,payment_id,amount_minor,currency,confirmed_at','status':'eq.completed'}),
    'refund_applications':('refund_receipt_applications',{'select':'id,receipt_id,settlement_id'}),
}


def milestones(data):
    parents={r['id']:r for r in data['refunds']};snapshots={s['id']:s for s in data['refund_snapshots']}
    applications={a['receipt_id']:a for a in data['refund_applications']};events=[]
    def add(id,kind,timestamp,parent=None,**extra):
        if not timestamp:raise ApiError('ACTIVITY_TIMESTAMP_MISSING',502)
        events.append({'id':id,'kind':kind,'created_at':timestamp,'group_kind':'refund','group_id':parent['id'] if parent else 'payment-'+extra['payment_id'],
            'group_title':parent['reason'] if parent else None,'request_document_id':None,'request_title':None,**extra})
    def parent(row):
        result=parents.get(row['settlement_id'])
        if result is None:raise ApiError('ACTIVITY_CONTEXT_MISSING',502)
        return result
    def version(row):
        snap=snapshots.get(row['snapshot_id'])
        if snap is None or snap['settlement_id']!=row['settlement_id']:raise ApiError('ACTIVITY_CONTEXT_MISSING',502)
        return snap['version_no']
    for r in parents.values():
        add('refund-request-'+r['id'],'refund_requested',r['created_at'],r)
        if r['status'] in ('completed','closed_without_refund','rejected','withdrawn'):
            add('refund-closure-'+r['id'],'refund_closed',r['closed_at'],r,closure_status=r['status'])
    for row in data['refund_deliveries']:add('refund-send-'+row['id'],'refund_proposal_sent',row['updated_at'],parent(row),revision_no=version(row))
    for row in data['refund_feedback']:add('refund-feedback-'+row['snapshot_id'],'refund_feedback_reviewed',row['created_at'],parent(row),revision_no=version(row))
    for row in data['refund_acceptances']:add('refund-acceptance-'+row['snapshot_id'],'refund_acceptance_recorded',row['created_at'],parent(row),revision_no=version(row))
    for row in data['refund_authorizations']:add('refund-authorization-'+row['id'],'refund_financial_authorized',row['created_at'],parent(row),revision_no=version(row))
    for row in data['refund_receipts']:
        application=applications.get(row['id'])
        add('refund-money-'+row['id'],'refund_completed',row['confirmed_at'],parent(application) if application else None,
            payment_id=row['payment_id'],receipt_id=row['id'],amount_minor=row['amount_minor'],currency=row['currency'])
    return events
