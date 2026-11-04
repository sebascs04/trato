"""Strict provider evidence for a fixed, already accepted allocation. No transport here."""
from datetime import datetime, timedelta, timezone
import re
from urllib.parse import urlparse
from uuid import UUID

from pydantic import Field, model_validator
from ..errors import ApiError
from .domain import Contract, Hash, Text, MAX_MINOR

POLICY = {
    'environment':'sandbox','product':'checkout_payments_v2','currency':'USD','max_capture_age_days':180,
    'reference_country':'PE','country_policy_applied_to_other_accounts':False,
    'sources':[
        {'url':'https://developer.paypal.com/checkout/refund-payment','consulted_on':'2026-11-02','scope':'Payments v2 capture refunds'},
        {'url':'https://developer.paypal.com/api/rest/requests/','consulted_on':'2026-11-02','scope':'Refund idempotency; up to 45 days; no automatic retry'},
        {'url':'https://www.paypal.com/pe/cshelp/article/how-do-i-issue-a-refund-help101','consulted_on':'2026-11-02','scope':'PE goods/services reference; original fee not automatically deducted'},
    ],
}

class FinancialCheckInput(Contract):
    expected_snapshot_id: UUID

class FinancialAuthorizationInput(FinancialCheckInput):
    check_id: UUID
    digest: Hash
    confirmed: bool = Field(strict=True)
    notes: Text

    @model_validator(mode='after')
    def explicit(self):
        if self.confirmed is not True:raise ValueError('Explicit financial authorization required')
        return self

class FinancialExecutionInput(Contract):
    confirmed: bool = Field(strict=True)

    @model_validator(mode='after')
    def explicit(self):
        if self.confirmed is not True:raise ValueError('Explicit execution required')
        return self


def fail(code='REFUND_PAYMENT_CONTEXT_MISMATCH'):
    raise ApiError(code,409)


def usd(money,*,positive=False):
    if not isinstance(money,dict) or money.get('currency_code')!='USD':fail()
    value=money.get('value')
    if not isinstance(value,str) or not re.fullmatch(r'\d{1,9}(?:\.\d{1,2})?',value):fail()
    whole,_,decimal=value.partition('.')
    amount=int(whole)*100+int(decimal.ljust(2,'0') or '0')
    if amount>MAX_MINOR or positive and amount==0:fail()
    return amount


def provider_id(value):
    if not isinstance(value,str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,64}',value):fail('REFUND_RESULT_MISMATCH')
    return value


def provider_time(value):
    if not isinstance(value,str):fail('REFUND_CAPTURE_DATE_REQUIRED')
    try:result=datetime.fromisoformat(value.replace('Z','+00:00'))
    except ValueError:fail('REFUND_CAPTURE_DATE_REQUIRED')
    if result.tzinfo is None:fail('REFUND_CAPTURE_DATE_REQUIRED')
    return result.astimezone(timezone.utc)


def order_unit(order,payment):
    if not isinstance(order,dict) or order.get('intent')!='CAPTURE' or order.get('status')!='COMPLETED':fail()
    provider_id(order.get('id'))
    if payment.get('order_id') and order['id']!=payment['order_id']:fail()
    units=order.get('purchase_units')
    if not isinstance(units,list):fail()
    matched=[]
    for unit in units:
        if not isinstance(unit,dict) or not isinstance(unit.get('payments'),dict):continue
        captures=unit['payments'].get('captures')
        if isinstance(captures,list) and any(isinstance(c,dict) and c.get('id')==payment['capture_id'] for c in captures):matched.append(unit)
    if len(matched)!=1:fail()
    unit=matched[0]
    # Current Trato checkouts capture a single payment per purchase unit.
    if len(unit['payments']['captures'])!=1 or unit.get('reference_id')!=payment['expected_reference'] or unit.get('custom_id')!=payment['expected_reference']:fail()
    if not isinstance(unit.get('payee'),dict) or unit['payee'].get('merchant_id')!=payment['merchant_id']:fail()
    if usd(unit.get('amount'),positive=True)!=payment['amount_minor']:fail()
    return unit


def history_ids(unit,payment):
    entries=unit['payments'].get('refunds',[])
    known=payment.get('known_refunds')
    if not isinstance(entries,list) or not isinstance(known,list) or len(entries)>100 or len(known)>100:fail('REFUND_RECONCILIATION_REQUIRED')
    ids=set()
    for entry in entries:
        if not isinstance(entry,dict):fail('REFUND_RECONCILIATION_REQUIRED')
        ids.add(provider_id(entry.get('id')))
    for entry in known:
        if not isinstance(entry,dict):fail('REFUND_RECONCILIATION_REQUIRED')
        if entry.get('status') in ('dispatching','uncertain','pending'):fail('REFUND_RECONCILIATION_REQUIRED')
        if entry.get('refund_id'):ids.add(provider_id(entry['refund_id']))
        elif entry.get('status')=='completed':fail('REFUND_RECONCILIATION_REQUIRED')
    return sorted(ids)


def refund_evidence(refund,payment,*,expected_id=None,amount=None,custom_id=None,require_custom_id=False):
    if not isinstance(refund,dict):fail('REFUND_RESULT_MISMATCH')
    rid=provider_id(refund.get('id'))
    if expected_id is not None and rid!=expected_id:fail('REFUND_RESULT_MISMATCH')
    actual=usd(refund.get('amount'),positive=True)
    if amount is not None and actual!=amount:fail('REFUND_RESULT_MISMATCH')
    status=refund.get('status')
    if status not in ('COMPLETED','PENDING','FAILED','CANCELLED'):fail('REFUND_RESULT_MISMATCH')
    if require_custom_id and (custom_id is None or refund.get('custom_id')!=custom_id):fail('REFUND_REFERENCE_UNCERTAIN')
    if custom_id is not None and refund.get('custom_id') is not None and refund['custom_id']!=custom_id:fail('REFUND_RESULT_MISMATCH')
    links=refund.get('links',[])
    if not isinstance(links,list):fail('REFUND_RESULT_MISMATCH')
    captures=set()
    for link in links:
        if not isinstance(link,dict) or link.get('rel')!='up':continue
        href=link.get('href')
        if not isinstance(href,str):fail('REFUND_RESULT_MISMATCH')
        url=urlparse(href)
        if url.scheme!='https' or url.netloc not in ('api-m.sandbox.paypal.com','api.sandbox.paypal.com','api-m.paypal.com','api.paypal.com') or url.query or url.fragment:fail('REFUND_RESULT_MISMATCH')
        match=re.fullmatch(r'/v2/payments/captures/([A-Za-z0-9_-]{1,64})',url.path)
        if match:captures.add(match[1])
    related=refund.get('supplementary_data',{});
    if isinstance(related,dict) and isinstance(related.get('related_ids'),dict) and related['related_ids'].get('capture_id'):
        captures.add(provider_id(related['related_ids']['capture_id']))
    if captures!={payment['capture_id']}:fail('REFUND_RESULT_MISMATCH')
    total=None;breakdown=refund.get('seller_payable_breakdown')
    if breakdown is not None:
        if not isinstance(breakdown,dict):fail('REFUND_RESULT_MISMATCH')
        if 'gross_amount' in breakdown and usd(breakdown['gross_amount'])!=actual:fail('REFUND_RESULT_MISMATCH')
        if 'total_refunded_amount' in breakdown:
            total=usd(breakdown['total_refunded_amount'])
            if status=='COMPLETED' and total<actual:fail('REFUND_RESULT_MISMATCH')
    return {'refund_id':rid,'capture_id':payment['capture_id'],'amount_minor':actual,'currency':'USD','status':status.lower(),'canonical':True,
            'provider_total_refunded_minor':total,**({'custom_id':refund['custom_id']} if isinstance(refund.get('custom_id'),str) else {})}


def capture_evidence(payment,frozen,capture,order,refunds,merchant,now):
    if merchant!=payment['merchant_id'] or payment['currency']!='USD':fail()
    if any(frozen.get(k)!=payment.get(v) for k,v in [('payment_id','id'),('capture_id','capture_id'),('merchant_id','merchant_id'),('amount_minor','amount_minor'),('currency','currency')]):fail()
    if not isinstance(capture,dict) or capture.get('id')!=payment['capture_id']:fail()
    unit=order_unit(order,payment)
    related=capture.get('supplementary_data')
    if isinstance(related,dict) and isinstance(related.get('related_ids'),dict) and related['related_ids'].get('order_id')!=order['id']:fail()
    payee=capture.get('payee')
    if payee is not None and (not isinstance(payee,dict) or payee.get('merchant_id')!=merchant):fail()
    gross=usd(capture.get('amount'),positive=True)
    if gross!=payment['amount_minor']:fail()
    date=provider_time(capture.get('create_time'))
    if date>now+timedelta(seconds=30) or now-date>=timedelta(days=180):fail('REFUND_CAPTURE_EXPIRED')
    status=capture.get('status')
    details=capture.get('status_details')
    if status not in ('COMPLETED','PARTIALLY_REFUNDED') or details is not None and (not isinstance(details,dict) or details.get('reason')):fail('REFUND_CAPTURE_NOT_ELIGIBLE')
    breakdown=capture.get('seller_receivable_breakdown')
    if not isinstance(breakdown,dict):fail('REFUND_FINANCIAL_DATA_REQUIRED')
    if not all(k in breakdown for k in ('gross_amount','paypal_fee','net_amount')):fail('REFUND_FINANCIAL_DATA_REQUIRED')
    fee=usd(breakdown['paypal_fee']);net=usd(breakdown['net_amount'])
    if usd(breakdown['gross_amount'])!=gross or fee+net!=gross:fail()
    expected_ids=history_ids(unit,payment)
    if not isinstance(refunds,list) or len(refunds)!=len(expected_ids):fail('REFUND_RECONCILIATION_REQUIRED')
    records=[refund_evidence(r,payment) for r in refunds]
    if sorted(r['refund_id'] for r in records)!=expected_ids:fail('REFUND_RECONCILIATION_REQUIRED')
    if any(r['status']=='pending' for r in records):fail('REFUND_RECONCILIATION_REQUIRED')
    completed=[r for r in records if r['status']=='completed'];previous=sum(r['amount_minor'] for r in completed)
    totals=[r['provider_total_refunded_minor'] for r in completed if r['provider_total_refunded_minor'] is not None]
    if previous and (not totals or max(totals)!=previous) or status=='PARTIALLY_REFUNDED' and previous==0 or status=='COMPLETED' and previous>0:fail('REFUND_RECONCILIATION_REQUIRED')
    if previous!=payment['previous_refunds_minor'] or previous!=frozen['local_previous_refunds_minor']:fail('REFUND_RECONCILIATION_REQUIRED')
    return {'payment_id':payment['id'],'capture_id':payment['capture_id'],'merchant_id':merchant,'currency':'USD','verified':True,
            'capture_status':status,'capture_created_at':date.isoformat(),'gross_minor':gross,'original_fee_minor':fee,'original_net_minor':net,
            'previous_refunds_minor':previous,'provider_remaining_minor':gross-previous,'observed_at':now.isoformat(),
            'verified_refund_ids':[r['refund_id'] for r in completed]}


class RecoveryConsentInput(FinancialCheckInput,FinancialExecutionInput):
    attempt_id: UUID
    expected_revision: int = Field(strict=True,ge=0)
    notes: Text

class ExternalReceiptInput(RecoveryConsentInput):
    receipt_id: UUID

class RetryAuthorizationInput(RecoveryConsentInput):
    check_id: UUID
    digest: Hash
