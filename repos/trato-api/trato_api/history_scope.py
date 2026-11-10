"""Fetch only the business records of an explicitly opened history group."""
from .errors import ApiError
from .persistence import uuid

def scoped_rows(repo,project,kind,group_id,queries,read):
    data={name:[] for name in queries}
    if kind=='project':
        if group_id!=project['id']:raise ApiError('ACTIVITY_GROUP_NOT_FOUND',404)
        data['initial_sources']=read(*queries['initial_sources'])
        return data
    if kind=='change':
        identifier=uuid(group_id)
        data['requests']=read('documents',{'select':'id,title,created_at','kind':'eq.email_request','deleted_at':'is.null','id':'eq.'+identifier})
        if not data['requests']:raise ApiError('ACTIVITY_GROUP_NOT_FOUND',404)
        data['proposals']=read('change_proposals',{'select':'id,request_document_id','request_document_id':'eq.'+identifier})
        ids=[row['id'] for row in data['proposals']]
        if ids:
            for name in ('revisions','deliveries','acceptances','payments','portal_requests','problems','invoices'):
                table,params=queries[name];data[name]=read(table,{**params,'proposal_id':'in.('+','.join(ids)+')'})
        table,params=queries['closures'];data['closures']=read(table,{**params,'request_document_id':'eq.'+identifier})
        return data
    if kind!='refund':raise ApiError('ACTIVITY_GROUP_INVALID',422)
    if group_id.startswith('payment-'):
        payment=uuid(group_id[8:])
        if not read('project_received_payments',{'select':'id','id':'eq.'+payment}):raise ApiError('ACTIVITY_GROUP_NOT_FOUND',404)
        table,params=queries['refund_receipts'];receipts=read(table,{**params,'payment_id':'eq.'+payment})
        if receipts:
            apps=read('refund_receipt_applications',{'select':'receipt_id','receipt_id':'in.('+','.join(r['id'] for r in receipts)+')'})
            applied={a['receipt_id'] for a in apps};data['refund_receipts']=[r for r in receipts if r['id'] not in applied]
        return data
    identifier=uuid(group_id)
    table,params=queries['refunds'];data['refunds']=read(table,{**params,'id':'eq.'+identifier})
    if not data['refunds']:raise ApiError('ACTIVITY_GROUP_NOT_FOUND',404)
    for name in ('refund_snapshots','refund_deliveries','refund_feedback','refund_acceptances','refund_authorizations','refund_applications'):
        table,params=queries[name];data[name]=read(table,{**params,'settlement_id':'eq.'+identifier})
    ids=[a['receipt_id'] for a in data['refund_applications']]
    if ids:
        table,params=queries['refund_receipts'];data['refund_receipts']=read(table,{**params,'id':'in.('+','.join(ids)+')'})
    return data
