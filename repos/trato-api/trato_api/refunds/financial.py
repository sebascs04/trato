"""Explicit financial effects. Durable SQL claims precede every refund POST."""
from datetime import datetime,timedelta,timezone
import os

from paypal.client import PayPalError,PayPalSandboxClient
from paypal.config import SandboxSettings
from ..errors import ApiError
from ..proposals.workflow import BackendStore
from .financial_domain import POLICY,capture_evidence,history_ids,order_unit,provider_id,provider_time,refund_evidence


class RefundFinanceStore(BackendStore):
    def command(self,owner,action,data):
        return self.repo.rpc('refund_finance_backend',{'p_owner':str(owner),'p_action':action,'p_data':data})

    def receipt(self,owner,payment,evidence,attempt=None):
        return self.repo.rpc('refund_receipt_backend',{'p_owner':str(owner),'p_payment':payment,'p_evidence':evidence,'p_attempt':attempt})

    def webhook(self,action,data):
        return self.repo.rpc('refund_webhook_backend',{'p_action':action,'p_data':data})

    def confirm_full_capture_refund(self, owner, payment, capture_id):
        return self.repo.rpc('refund_full_capture_backend', {
            'p_owner': str(owner), 'p_payment': payment, 'p_capture': capture_id,
        })

    def link_dispute_receipt(self, owner, project, receipt_id, dispute_id):
        return self.repo.rpc('link_dispute_refund_backend', {
            'p_owner': str(owner), 'p_project': project, 'p_receipt': receipt_id, 'p_dispute': dispute_id,
        })


class RefundFinance:
    def __init__(self,settings,*,store=None,paypal=None,clock=None,disputes=None):
        self.settings,self.store,self.paypal=settings,store,paypal
        self.clock=clock or (lambda:datetime.now(timezone.utc))
        self.disputes = disputes

    def backend(self):return self.store if self.store is not None else RefundFinanceStore(self.settings)

    def provider(self,*,webhook=False):
        if self.paypal is not None:return self.paypal  # Explicit test dependency, never an error fallback.
        config=SandboxSettings.from_env()
        if config.environment!='sandbox':raise ApiError('LIVE_PAYMENTS_DISABLED',503)
        listener=os.getenv('PAYPAL_REFUND_WEBHOOK_ID','') if webhook else ''
        if webhook and not listener:raise ApiError('PAYPAL_REFUND_WEBHOOK_NOT_CONFIGURED',503)
        return PayPalSandboxClient(config.client_id,config.client_secret,config.merchant_id,listener)

    def context(self,repo,owner,parent,expected=None):
        # User-scoped authorization happens before service-role reads or provider calls.
        item=repo.settlement(parent)
        if item.get('owner_id')!=str(owner):raise ApiError('REFUND_NOT_FOUND',404)
        data={'settlement_id':parent}
        if expected is not None:data['expected_snapshot_id']=expected
        context=self.backend().command(owner,'context',data)
        r=context['settlement']
        if r['id']!=parent or r['owner_id']!=str(owner) or r['project_id']!=item['project_id']:raise ApiError('REFUND_NOT_FOUND',404)
        return context

    @staticmethod
    def allocation(context,payment_id):
        matches=[p for p in context['payments'] if p['payment_id']==payment_id]
        if len(matches)!=1:raise ApiError('REFUND_ALLOCATION_MISMATCH',409)
        return matches[0]

    @staticmethod
    def payment(context,payment_id):
        matches=[p for p in context['received_payments'] if p['id']==payment_id]
        if len(matches)!=1:raise ApiError('REFUND_PAYMENT_CONTEXT_MISMATCH',409)
        return matches[0]

    def observation(self,context,payment_id,client,*,recovery=False):
        pay=self.payment(context,payment_id);frozen=self.allocation(context,payment_id)
        dispute_refunds = self.ensure_not_disputed(pay['capture_id'])
        if recovery:frozen={**frozen,'local_previous_refunds_minor':pay['previous_refunds_minor']}
        capture=client.get_capture(pay['capture_id'])
        order_id=pay.get('order_id')
        if not order_id:
            related=capture.get('supplementary_data',{}) if isinstance(capture,dict) else {}
            related=related.get('related_ids',{}) if isinstance(related,dict) else {}
            order_id=related.get('order_id') if isinstance(related,dict) else None
        if not order_id:raise ApiError('REFUND_ORDER_REFERENCE_REQUIRED',409)
        order=client.get_order(provider_id(order_id));unit=order_unit(order,pay)
        records=[client.get_refund(rid) for rid in history_ids(unit,pay)]
        evidence = capture_evidence(pay,frozen,capture,order,records,client.merchant_id,self.clock())
        # PayPal can report the dispute outcome before its capture and receipts catch up.
        if dispute_refunds is not None and (not dispute_refunds or not dispute_refunds.issubset(evidence['verified_refund_ids'])):
            raise ApiError('REFUND_RECONCILIATION_REQUIRED', 409)
        return evidence

    def ensure_not_disputed(self, capture_id):
        if self.disputes is not None:
            return self.disputes(capture_id)

    def check_intake(self, repo, project_id, data):
        payments = repo.received_payments(project_id, data.get('payment_id'))
        if data['scope'] == 'project_closure' and {p['id'] for p in payments} != set(data['payment_ids']):
            raise ApiError('REFUND_PAYMENTS_CHANGED', 409)
        for payment in payments:
            self.ensure_not_disputed(payment['capture_id'])

    def sync_project(self, repo, owner, project_id):
        payments = repo.received_payments(project_id)
        if not payments:
            return
        client, store, recovery = self.provider(), self.backend(), self.recovery()
        for payment in payments:
            pay, attempts = self.lookup_capture(store, owner, project_id, payment, client.merchant_id)
            recovery.scan(owner, pay, attempts, client)

    @staticmethod
    def lookup_capture(store, owner, project_id, payment, merchant_id):
        lookup = store.webhook('lookup', {'capture_id': payment['capture_id'], 'merchant_id': merchant_id})
        pay = lookup.get('payment', {})
        if (pay.get('id'), pay.get('owner_id'), pay.get('project_id')) != (payment['id'], str(owner), project_id):
            raise ApiError('REFUND_PAYMENT_CONTEXT_MISMATCH', 409)
        return pay, lookup['attempts']

    def sync_dispute(self, owner, project_id, dispute_id, payment, refund_refs):
        client = self.provider()
        pay, attempts = self.lookup_capture(self.backend(), owner, project_id, payment, client.merchant_id)
        self.recovery().scan(owner, pay, attempts, client, expected_dispute_refunds=refund_refs, dispute_id=dispute_id)

    def ensure_no_unresolved_refund(self, owner, project_id, payment):
        client = self.provider()
        _, attempts = self.lookup_capture(self.backend(), owner, project_id, payment, client.merchant_id)
        if any(a['status'] in ('dispatching', 'uncertain', 'pending') for a in attempts):
            raise ApiError('REFUND_PAYMENT_IN_PROGRESS', 409)

    def check(self,repo,owner,parent,snapshot):
        context=self.context(repo,owner,parent,snapshot)
        if context['settlement']['status']!='accepted' or context['snapshot']['breakdown']['refund_minor']<=0:raise ApiError('REFUND_FINANCIAL_AUTHORIZATION_REQUIRED',409)
        client=self.provider()
        try:
            evidence=[self.observation(context,p['payment_id'],client) for p in sorted(context['payments'],key=lambda p:p['payment_id']) if p['refund_minor']>0]
        except PayPalError as error:raise ApiError(error.code,error.status) from None
        return self.backend().command(owner,'save_check',{'settlement_id':parent,'expected_snapshot_id':snapshot,'evidence':evidence,'policy':POLICY})

    @staticmethod
    def error_fields(error):
        result={}
        http_status=getattr(error,'http_status',None)
        if type(http_status) is int and 100<=http_status<=599:result['http_status']=http_status
        issue=getattr(error,'provider_issue',None)
        # The adapter has already selected a machine code from its allowlist.
        if isinstance(issue,str):
            import re
            if re.fullmatch('[A-Z_]{1,80}',issue):result['provider_issue']=issue
        return result

    def _uncertain(self,owner,parent,operation,error_code,details=None,attempt=None):
        try:self.backend().command(owner,'result',{'settlement_id':parent,'operation_id':operation['id'],**({'attempt_id':attempt['id']} if attempt else {}),'status':'uncertain','error_code':error_code,**(details or {})})
        except ApiError:raise ApiError('REFUND_FINANCIAL_RESULT_UNCERTAIN',503) from None
        if error_code in ('PERSISTENCE_UNAVAILABLE','REFUND_FINANCIAL_RESULT_UNCERTAIN'):raise ApiError('REFUND_FINANCIAL_RESULT_UNCERTAIN',503)

    def _canonical(self,owner,parent,operation,attempt,payment,client):
        if client.merchant_id!=payment['merchant_id']:raise ApiError('REFUND_PAYMENT_CONTEXT_MISMATCH',409)
        rid=attempt['provider_refund_id']
        proof=refund_evidence(client.get_refund(rid),payment,expected_id=rid)
        return self.backend().command(owner,'result',{'settlement_id':parent,'operation_id':operation['id'],'attempt_id':attempt['id'],**proof})

    def execute(self,repo,owner,parent,authorization,key):
        context=self.context(repo,owner,parent)
        if not any(a['id']==authorization for a in context['authorizations']):raise ApiError('REFUND_AUTHORIZATION_NOT_FOUND',404)
        store=self.backend()
        run=store.command(owner,'run_claim',{'settlement_id':parent,'authorization_id':authorization,'operation_key':key})
        if not run['acquired']:return {k:v for k,v in run.items() if k!='acquired'}
        run_id=run['run_id']
        try:
            client=self.provider()
            for operation in sorted(run['operations'],key=lambda o:o['sequence_no']):
                if operation['authorization_id']!=authorization:continue
                if operation['status']=='completed':continue
                if operation['status']!='reserved':break
                # Recheck after reservation, outside any DB transaction. SQL checks
                # local reservations once more when acquiring the dispatch claim.
                current=self.context(repo,owner,parent)
                evidence=self.observation(current,operation['payment_id'],client,recovery=sum(a['operation_id']==operation['id'] for a in current['attempts'])>1)
                claim=store.command(owner,'dispatch_claim',{'settlement_id':parent,'operation_id':operation['id'],'run_id':run_id,'evidence':evidence})
                if not claim['acquired']:break
                attempt,payment=claim['attempt'],claim['payment']
                try:
                    response=self.dispatch(client,payment,attempt)
                except PayPalError as error:
                    if error.definitive:
                        store.command(owner,'result',{'settlement_id':parent,'operation_id':operation['id'],'attempt_id':attempt['id'],'status':'failed','definitive_rejection':True,'error_code':error.code,**self.error_fields(error)})
                    else:self._uncertain(owner,parent,operation,error.code,self.error_fields(error),attempt)
                    break
                try:
                    rid=provider_id(response.get('id') if isinstance(response,dict) else None)
                    # Save the reference even if the remaining representation is
                    # incomplete. A reference alone never confirms the money.
                    store.command(owner,'bind',{'settlement_id':parent,'operation_id':operation['id'],'attempt_id':attempt['id'],'refund_id':rid})
                    attempt={**attempt,'provider_refund_id':rid}
                    result=self._canonical(owner,parent,operation,attempt,payment,client)
                except (PayPalError,ApiError) as error:
                    self._uncertain(owner,parent,operation,error.code,self.error_fields(error),attempt)
                    break
                latest=next(o for o in result['operations'] if o['id']==operation['id'])
                if latest['status']!='completed':break
        except PayPalError as error:
            # A read failure before a dispatch leaves that member reserved.
            store.command(owner,'run_finish',{'settlement_id':parent,'authorization_id':authorization,'run_id':run_id})
            raise ApiError(error.code,error.status) from None
        except ApiError:
            store.command(owner,'run_finish',{'settlement_id':parent,'authorization_id':authorization,'run_id':run_id})
            raise
        # Process crashes deliberately have no lease-expiry POST retry. A later
        # explicit request sees the durable running/dispatching state.
        return store.command(owner,'run_finish',{'settlement_id':parent,'authorization_id':authorization,'run_id':run_id})

    def refresh(self,repo,owner,parent,operation_id):
        context=self.context(repo,owner,parent)
        matches=[o for o in context['operations'] if o['id']==operation_id]
        if len(matches)!=1:raise ApiError('REFUND_OPERATION_NOT_FOUND',404)
        operation=matches[0];attempts=sorted([a for a in context['attempts'] if a['operation_id']==operation_id],key=lambda a:a['attempt_no'],reverse=True)[:1]
        if len(attempts)!=1 or not attempts[0].get('provider_refund_id'):raise ApiError('REFUND_REFERENCE_UNCERTAIN',409)
        try:
            return self._canonical(owner,parent,operation,attempts[0],self.payment(context,operation['payment_id']),self.provider())
        except PayPalError as error:raise ApiError(error.code,error.status) from None

    def dispatch(self,client,payment,attempt):
        # Recheck just before every money POST, including a resumed old handler.
        if attempt.get('dispatched_at') and self.clock()-provider_time(attempt['dispatched_at'])>=timedelta(days=44):
            raise ApiError('REFUND_REPLAY_WINDOW_EXPIRED',409)
        return client.refund_capture(payment['capture_id'],attempt['payload'],attempt['request_id'])

    def recovery(self):
        from .reconciliation import RefundRecovery
        return RefundRecovery(self)

    def reconcile(self,*args):return self.recovery().reconcile(*args)
    def replay(self,*args):return self.recovery().replay(*args)
    def recovery_check(self,*args):return self.recovery().check(*args)
    def retry_authorize(self,*args):return self.recovery().consent('retry_authorize',*args)
    def external_apply(self,*args):return self.recovery().consent('external_apply',*args)
