"""Read-only discovery, explicit same-identity replay and consented recovery.

Canonical observations remain valid even when the coordinating handler is fenced.
No amount/date matching and no money POST from discovery or a webhook.
"""
from ..errors import ApiError
from paypal.client import PayPalError
from .financial_domain import order_unit,provider_id,refund_evidence,usd


class RefundRecovery:
    def __init__(self,finance):self.finance=finance

    @staticmethod
    def operation(context,oid):
        rows=[o for o in context['operations'] if o['id']==oid]
        if len(rows)!=1:raise ApiError('REFUND_OPERATION_NOT_FOUND',404)
        return rows[0]

    @staticmethod
    def latest(context,oid):
        rows=[a for a in context['attempts'] if a['operation_id']==oid]
        if not rows:raise ApiError('REFUND_ATTEMPT_NOT_FOUND',404)
        return max(rows,key=lambda a:a['attempt_no'])

    def resources(self,pay,client):
        if client.merchant_id!=pay['merchant_id']:raise ApiError('REFUND_PAYMENT_CONTEXT_MISMATCH',409)
        capture=client.get_capture(pay['capture_id'])
        if not isinstance(capture,dict) or capture.get('id')!=pay['capture_id'] or usd(capture.get('amount'))!=pay['amount_minor']:
            raise ApiError('REFUND_PAYMENT_CONTEXT_MISMATCH',409)
        payee=capture.get('payee')
        if payee is not None and (not isinstance(payee,dict) or payee.get('merchant_id')!=client.merchant_id):raise ApiError('REFUND_PAYMENT_CONTEXT_MISMATCH',409)
        supplementary=capture.get('supplementary_data',{})
        if not isinstance(supplementary,dict) or not isinstance(supplementary.get('related_ids',{}),dict):raise ApiError('REFUND_PAYMENT_CONTEXT_MISMATCH',409)
        related=supplementary.get('related_ids',{})
        oid=pay.get('order_id') or related.get('order_id')
        order=client.get_order(provider_id(oid));pay=self.finance.with_invoice(pay,order);unit=order_unit(order,pay)
        if related.get('order_id') is not None and related['order_id']!=order['id']:raise ApiError('REFUND_PAYMENT_CONTEXT_MISMATCH',409)
        return capture,unit

    @staticmethod
    def match(record,proof,attempt):
        if not attempt.get('dispatched_at') or attempt.get('amount_minor')!=proof['amount_minor']:return False
        known=attempt.get('provider_refund_id')
        if known is not None:
            return known==proof['refund_id'] and record.get('custom_id',attempt['payload']['custom_id'])==attempt['payload']['custom_id']
        return record.get('custom_id')==attempt['payload']['custom_id']

    def scan(self,owner,pay,attempts,client,*,hints=(),expected_dispute_refunds=None,dispute_id=None):
        capture,unit=self.resources(pay,client)
        fully_refunded = capture.get('status') == 'REFUNDED'
        store=self.finance.backend()
        if fully_refunded:
            # The verified capture establishes the total independently of individual receipts.
            store.confirm_full_capture_refund(owner, pay['id'], capture['id'])
        entries=unit['payments'].get('refunds',[])
        if not isinstance(entries,list) or len(entries)>100:raise ApiError('REFUND_RECONCILIATION_REQUIRED',409)
        ids={provider_id(x.get('id')) for x in entries if isinstance(x,dict)}
        if len(entries) and any(not isinstance(x,dict) for x in entries):raise ApiError('REFUND_RECONCILIATION_REQUIRED',409)
        ids.update(provider_id(a['provider_refund_id']) for a in attempts if a.get('provider_refund_id'))
        ids.update(provider_id(i) for i in hints)
        if expected_dispute_refunds:
            ids.update(provider_id(i) for i in expected_dispute_refunds)
        if len(ids)>100:raise ApiError('REFUND_RECONCILIATION_REQUIRED',409)
        observations=[]
        for rid in sorted(ids):
            record=client.get_refund(rid)
            proof=refund_evidence(record,pay,expected_id=rid)
            observations.append((record,proof))
        mapping={a['id']:[proof['refund_id'] for record,proof in observations if self.match(record,proof,a)] for a in attempts}
        # Save every real movement, even if multiple candidates prevent attribution.
        for record,proof in observations:
            matches=[a for a in attempts if a.get('provider_refund_id')==proof['refund_id'] or mapping[a['id']]==[proof['refund_id']]]
            attempt=matches[0] if len(matches)==1 else None
            result = store.receipt(owner,pay['id'],proof,attempt['id'] if attempt else None)
            if expected_dispute_refunds is not None and not result['recorded']:
                raise ApiError('REFUND_RECONCILIATION_REQUIRED', 409)
            if dispute_id and proof['status']=='completed' and proof['refund_id'] in expected_dispute_refunds:
                store.link_dispute_receipt(owner, pay['project_id'], result['receipt_id'], dispute_id)
        if expected_dispute_refunds is not None and not fully_refunded:
            completed = {proof['refund_id'] for _, proof in observations if proof['status'] == 'completed'}
            if not expected_dispute_refunds or not expected_dispute_refunds.issubset(completed):
                raise ApiError('REFUND_DISPUTE_PENDING', 409)
        return mapping

    def reconcile(self,repo,owner,parent,oid):
        flow=self.finance;context=flow.context(repo,owner,parent);op=self.operation(context,oid)
        claim=flow.backend().command(owner,'reconcile_claim',{'settlement_id':parent,'operation_id':oid})
        attempt=claim['attempt'];pay=flow.payment(context,op['payment_id'])
        try:
            client=flow.provider()
            import os
            hints=flow.backend().webhook('candidates',{'owner_id':str(owner),'payment_id':pay['id'],'app_id':getattr(client,'client_id',''), 'listener_id':os.getenv('PAYPAL_REFUND_WEBHOOK_ID','')})['refund_ids']
            mapping=self.scan(owner,pay,[a for a in claim['attempts'] if a['operation_id'] in {o['id'] for o in claim['operations'] if o['payment_id']==pay['id']}],client,hints=hints)
        except PayPalError as error:raise ApiError(error.code,error.status) from None
        current=flow.context(repo,owner,parent)
        candidates=mapping.get(attempt['id'],[])
        return current|{'reconciliation':{'attempt_id':attempt['id'],'candidate_count':len(candidates),'attribution':'exact_reference' if len(candidates)==1 else 'ambiguous' if candidates else 'unresolved'}}

    def check(self,repo,owner,parent,oid,snapshot):
        flow=self.finance;context=flow.context(repo,owner,parent,snapshot);op=self.operation(context,oid)
        try:evidence=flow.observation(context,op['payment_id'],flow.provider(),recovery=True)
        except PayPalError as error:raise ApiError(error.code,error.status) from None
        return flow.backend().command(owner,'save_recovery_check',{'settlement_id':parent,'expected_snapshot_id':snapshot,'operation_id':oid,'evidence':evidence})

    def consent(self,action,repo,owner,parent,oid,data,key):
        flow=self.finance;context=flow.context(repo,owner,parent,data['expected_snapshot_id']);op=self.operation(context,oid)
        if action=='external_apply':
            receipt=next((r for r in context['receipts'] if r['id']==data['receipt_id'] and r['payment_id']==op['payment_id']),None)
            if not receipt:raise ApiError('REFUND_RECEIPT_NOT_APPLICABLE',409)
            pay=flow.payment(context,op['payment_id'])
            try:
                client=flow.provider();self.resources(pay,client)
                proof=refund_evidence(client.get_refund(receipt['refund_id']),pay,expected_id=receipt['refund_id'])
                flow.backend().receipt(owner,pay['id'],proof)
            except PayPalError as error:raise ApiError(error.code,error.status) from None
        return flow.backend().command(owner,action,{'settlement_id':parent,'operation_id':oid,**data,'operation_key':key})

    def replay(self,repo,owner,parent,oid,data,key):
        flow=self.finance;context=flow.context(repo,owner,parent,data['expected_snapshot_id']);op=self.operation(context,oid)
        # Same-key replay returns current evidence and never sends another POST.
        prior=next((c for c in context.get('recovery_consents',[]) if c['operation_key']==key),None)
        if prior:return flow.backend().command(owner,'replay_claim',{'settlement_id':parent,'operation_id':oid,**data,'operation_key':key})
        try:
            client=flow.provider();pay=flow.payment(context,op['payment_id'])
            dispute_refunds = flow.ensure_not_disputed(pay['capture_id'])
            self.scan(owner,pay,[a for a in context['attempts'] if a['operation_id']==oid],client)
            if dispute_refunds is not None:
                # Same-identity replay can run without a new balance check. Reconcile
                # the dispute's money before allowing any newly authorized attempt.
                raise ApiError('REFUND_RECONCILIATION_REQUIRED', 409)
            claim=flow.backend().command(owner,'replay_claim',{'settlement_id':parent,'operation_id':oid,**data,'operation_key':key})
            if not claim['acquired']:return claim
            attempt=claim['attempt']
            try:response=flow.dispatch(client,pay,attempt)
            except PayPalError as error:
                # A rejection of this replay cannot prove the original POST failed.
                flow._uncertain(owner,parent,op,error.code,flow.error_fields(error),attempt)
                return flow.context(repo,owner,parent)
            rid=provider_id(response.get('id') if isinstance(response,dict) else None)
            flow.backend().command(owner,'bind',{'settlement_id':parent,'operation_id':oid,'attempt_id':attempt['id'],'refund_id':rid})
            return flow._canonical(owner,parent,op,attempt|{'provider_refund_id':rid},pay,client)
        except PayPalError as error:raise ApiError(error.code,error.status) from None
