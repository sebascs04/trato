"""Framework-neutral payment operations. P2 supplies durable transactional repository."""
import hashlib
import json
from .client import PayPalError, PaymentInstruction, exact_amount
from .repository import VerifiedOrder


class PaymentService:
    def __init__(self,client,repository,*,return_url,cancel_url):
        self.client,self.repo=client,repository
        self.return_url,self.cancel_url=return_url,cancel_url

    @staticmethod
    def _instruction(record):
        a=record.acceptance
        if a.mode!='connected':raise PayPalError('ACCEPTANCE_NOT_PAYABLE',status=422)
        return PaymentInstruction(record.id,a.amount,a.currency,a.merchant_id)

    def _normalise(self,record,order)->VerifiedOrder:
        state=self.client.validate_order(order,self._instruction(record))
        if record.provider_order_id and order['id']!=record.provider_order_id:
            raise PayPalError('PAYMENT_EVIDENCE_MISMATCH',status=409,uncertain=True)
        captures=order['purchase_units'][0].get('payments',{}).get('captures',[])
        return {'status':state,'order_id':order['id'],'capture_id':captures[0]['id'] if captures else None,
            'approval_url':self.client.approval_url(order),'amount':record.acceptance.amount,'currency':record.acceptance.currency,
            'merchant_id':record.acceptance.merchant_id,
            'evidence_key':hashlib.sha256(json.dumps([order['id'],captures[0]['id'] if captures else None,state],separators=(',',':')).encode()).hexdigest()}

    def create(self,user_id,acceptance_id,idempotency_key):
        if not isinstance(idempotency_key,str) or not 1<=len(idempotency_key)<=128 or any(ord(c)<33 or ord(c)>126 for c in idempotency_key):
            raise PayPalError('INVALID_IDEMPOTENCY_KEY',status=422)
        acceptance=self.repo.resolve_payable_acceptance(user_id,acceptance_id)
        if acceptance.owner_id!=user_id or acceptance.acceptance_id!=acceptance_id:raise PayPalError('PAYMENT_NOT_FOUND',status=404)
        if acceptance.mode!='connected':raise PayPalError('ACCEPTANCE_NOT_PAYABLE',status=422)
        if acceptance.amount=='0.00':raise PayPalError('PAYMENT_NOT_REQUIRED',status=422)
        exact_amount(acceptance.amount)
        command=json.dumps({'acceptance_id':acceptance_id,'revision':acceptance.proposal_revision_id,'amount':acceptance.amount,'currency':acceptance.currency,'merchant':acceptance.merchant_id},sort_keys=True)
        claim=self.repo.reserve_payment(user_id,acceptance,idempotency_key,hashlib.sha256(command.encode()).hexdigest())
        record=claim.record
        if not claim.acquired:return record
        if not claim.lease_token:raise PayPalError("INVALID_OPERATION_LEASE",status=503)
        try:
            order=self.client.create_order(self._instruction(record),record.create_request_id,self.return_url,self.cancel_url)
            result=self._normalise(record,order)
            return self.repo.apply_provider_order(record.id,None,result,expected_revision=record.revision,lease_token=claim.lease_token)
        except PayPalError as error:
            # Reservation is retained even for definite failures: never mint another ID after a timeout.
            self.repo.mark_uncertain(record.id,'create',error.code,expected_revision=record.revision,lease_token=claim.lease_token)
            raise

    def get(self,user_id,payment_id):
        record=self.repo.get_payment(user_id,payment_id)
        if record.id!=payment_id or record.acceptance.owner_id!=user_id:raise PayPalError('PAYMENT_NOT_FOUND',status=404)
        return record

    def reconcile(self,user_id,payment_id):
        record=self.get(user_id,payment_id)
        self._instruction(record)
        if not record.provider_order_id:
            raise PayPalError('ORDER_REFERENCE_UNCERTAIN',status=409,uncertain=True)
        order=self.client.get_order(record.provider_order_id)
        result=self._normalise(record,order)
        return self.repo.apply_provider_order(record.id,record.provider_order_id,result,expected_revision=record.revision)

    def capture(self,user_id,payment_id):
        record=self.get(user_id,payment_id)
        if record.status=='completed':return record
        self._instruction(record)
        if not record.provider_order_id:raise PayPalError('ORDER_NOT_READY',status=409)
        # A callback query parameter cannot assert buyer approval. Read PayPal first.
        order=self.client.get_order(record.provider_order_id)
        result=self._normalise(record,order)
        record=self.repo.apply_provider_order(record.id,record.provider_order_id,result,expected_revision=record.revision)
        if record.status in ('completed','pending'):return record
        if result['status']!='approved':raise PayPalError('BUYER_APPROVAL_REQUIRED',status=409)
        claim=self.repo.claim_capture(user_id,payment_id)
        record=claim.record
        if not claim.acquired:return record
        if not claim.lease_token:raise PayPalError("INVALID_OPERATION_LEASE",status=503)
        try:
            self.client.capture_order(record.provider_order_id,record.capture_request_id)
            # Canonical order representation is checked for amount/merchant/reference/capture.
            order=self.client.get_order(record.provider_order_id)
            result=self._normalise(record,order)
            return self.repo.apply_provider_order(record.id,record.provider_order_id,result,expected_revision=record.revision,lease_token=claim.lease_token)
        except PayPalError as error:
            self.repo.mark_uncertain(record.id,'capture',error.code,expected_revision=record.revision,lease_token=claim.lease_token)
            raise

    def webhook(self,headers,event):
        if not isinstance(event,dict) or not isinstance(event.get('id'),str) or not isinstance(event.get('event_type'),str):
            raise PayPalError('INVALID_WEBHOOK',status=400)
        if not self.client.verify_webhook(headers,event):raise PayPalError('INVALID_WEBHOOK_SIGNATURE',status=400)
        kind=event['event_type']
        if kind not in ('CHECKOUT.ORDER.APPROVED','PAYMENT.CAPTURE.COMPLETED','PAYMENT.CAPTURE.PENDING','PAYMENT.CAPTURE.DENIED'):
            return {'received':True,'handled':False}
        resource=event.get('resource',{})
        if not isinstance(resource,dict):raise PayPalError('INVALID_WEBHOOK',status=400)
        supplementary=resource.get('supplementary_data',{})
        if not isinstance(supplementary,dict) or not isinstance(supplementary.get('related_ids',{}),dict):raise PayPalError('INVALID_WEBHOOK',status=400)
        order_id=resource.get('id') if kind=='CHECKOUT.ORDER.APPROVED' else supplementary.get('related_ids',{}).get('order_id')
        if not order_id:raise PayPalError('WEBHOOK_ORDER_MISSING',status=422)
        record=self.repo.find_by_provider_order(order_id)
        if record is None:raise PayPalError('WEBHOOK_ORDER_NOT_READY',status=503)
        claim=self.repo.reserve_webhook(event['id'],kind,order_id)
        if claim.state=='processed':return {'received':True,'duplicate':True}
        if claim.state!='acquired' or not claim.lease_token:raise PayPalError('WEBHOOK_IN_PROGRESS',status=503)
        try:
            # A verified event triggers reconciliation, not blind trust in the event's status/amount.
            order=self.client.get_order(order_id)
            result=self._normalise(record,order)
            self.repo.apply_provider_order(record.id,order_id,result,expected_revision=record.revision)
            self.repo.finish_webhook(event['id'],True,lease_token=claim.lease_token)
            return {'received':True,'handled':True}
        except Exception:
            self.repo.finish_webhook(event['id'],False,lease_token=claim.lease_token)
            raise
