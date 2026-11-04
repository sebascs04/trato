"""Synthetic financial fixtures, only for explicitly selected unit-test transports."""
from copy import deepcopy
from datetime import datetime,timezone
from uuid import UUID

def uid(n):return str(UUID(int=n))
OWNER,PARENT,SNAPSHOT,PROJECT,AUTH,RUN=[uid(i) for i in range(1,7)]
NOW=datetime(2026,11,2,12,tzinfo=timezone.utc)
MERCHANT='TESTMERCHANT123'

def payment(n=10,amount=10000,refund=None):
    p={'id':uid(n),'owner_id':OWNER,'project_id':PROJECT,'origin':'change','capture_id':'CAPTURE'+str(n),'order_id':'ORDER123'+str(n),
       'expected_reference':uid(n),'merchant_id':MERCHANT,'currency':'USD','amount_minor':amount,'previous_refunds_minor':0,'reserved_minor':0,'known_refunds':[]}
    f={'payment_id':p['id'],'origin':'change','capture_id':p['capture_id'],'merchant_id':MERCHANT,'currency':'USD','amount_minor':amount,'local_previous_refunds_minor':0,'refund_minor':amount if refund is None else refund}
    def money(v):return {'currency_code':'USD','value':f'{v//100}.{v%100:02d}'}
    capture={'id':p['capture_id'],'status':'COMPLETED','create_time':'2026-11-01T12:00:00Z','amount':money(amount),
             'seller_receivable_breakdown':{'gross_amount':money(amount),'paypal_fee':money(100),'net_amount':money(amount-100)}}
    order={'id':p['order_id'],'status':'COMPLETED','intent':'CAPTURE','purchase_units':[{'reference_id':p['expected_reference'],'custom_id':p['expected_reference'],
            'amount':money(amount),'payee':{'merchant_id':MERCHANT},'payments':{'captures':[{'id':p['capture_id']}]}}]}
    return p,f,capture,order

def refund_record(p,amount,rid='REFUND123',status='COMPLETED',total=None,custom_id=None):
    record={'id':rid,'status':status,'amount':{'currency_code':'USD','value':f'{amount//100}.{amount%100:02d}'},
      'links':[{'rel':'up','href':'https://api-m.sandbox.paypal.com/v2/payments/captures/'+p['capture_id']}],
      'seller_payable_breakdown':{'total_refunded_amount':{'currency_code':'USD','value':f'{(total if total is not None else amount)/100:.2f}'}}}
    if custom_id is not None:record['custom_id']=custom_id
    return record
