"""Money and provider evidence, with synthetic data; no provider requests."""
from copy import deepcopy
from datetime import timedelta
from io import BytesIO
from urllib.error import HTTPError
from unittest.mock import patch
import unittest

from paypal.client import PayPalSandboxClient,PayPalError,Response,http_transport
from trato_api.errors import ApiError
from trato_api.refunds.financial_domain import capture_evidence,history_ids,refund_evidence,usd
from refund_financial_fixtures import payment,refund_record,NOW,MERCHANT,uid

class FinancialEvidenceTests(unittest.TestCase):
    def setUp(self):self.p,self.f,self.c,self.order=payment(refund=8000)
    def evidence(self,records=None):return capture_evidence(self.p,self.f,self.c,self.order,records or [],MERCHANT,NOW)
    def test_exact_money_never_rounds_or_interprets_missing_data_as_zero(self):
        self.assertEqual(usd({'currency_code':'USD','value':'0'}),0)
        self.assertEqual(usd({'currency_code':'USD','value':'12.3'}),1230)
        for value in [None,True,12.3,'-1','1e2','1.001','1000000000.00','NaN']:
            with self.subTest(value=value),self.assertRaises(ApiError):usd({'currency_code':'USD','value':value})
    def test_first_capture_keeps_fee_separate_from_exact_refund_allocation(self):
        e=self.evidence();self.assertEqual(e['provider_remaining_minor'],10000)
        self.assertEqual((e['original_fee_minor'],e['original_net_minor']),(100,9900))
        self.assertEqual(self.f['refund_minor'],8000)
    def test_missing_fee_or_date_and_unknown_capture_status_are_visible_failures(self):
        for field in ['fee','date','status','currency','merchant','reference','gross','net','shape']:
            with self.subTest(field=field):
                self.setUp()
                if field=='fee':del self.c['seller_receivable_breakdown']['paypal_fee']
                if field=='date':del self.c['create_time']
                if field=='status':self.c['status']='PENDING'
                if field=='currency':self.c['amount']['currency_code']='EUR'
                if field=='merchant':self.order['purchase_units'][0]['payee']['merchant_id']='FOREIGN'
                if field=='reference':self.order['purchase_units'][0]['custom_id']='diagnostic'
                if field=='gross':self.c['amount']['value']='101.00'
                if field=='net':self.c['seller_receivable_breakdown']['net_amount']['value']='10.00'
                if field=='shape':self.c=[]
                with self.assertRaises(ApiError):self.evidence()
    def test_capture_age_requires_original_timestamp_and_rejects_boundary_and_future(self):
        for date in [NOW-timedelta(days=180),NOW+timedelta(minutes=1)]:
            self.c['create_time']=date.isoformat()
            with self.assertRaises(ApiError):self.evidence()
        self.c['create_time']=(NOW-timedelta(days=179)).isoformat();self.assertTrue(self.evidence()['verified'])
    def test_partial_capture_requires_canonical_cumulative_evidence_matching_agreement(self):
        self.c['status']='PARTIALLY_REFUNDED';self.p['previous_refunds_minor']=2000;self.f['local_previous_refunds_minor']=2000
        self.order['purchase_units'][0]['payments']['refunds']=[{'id':'REFUND123'}]
        e=self.evidence([refund_record(self.p,2000)]);self.assertEqual(e['provider_remaining_minor'],8000)
        record=refund_record(self.p,2000);del record['seller_payable_breakdown']
        with self.assertRaises(ApiError):self.evidence([record])
        self.p['previous_refunds_minor']=0
        with self.assertRaises(ApiError):self.evidence([refund_record(self.p,2000)])
    def test_external_pending_unknown_or_inconsistent_refunds_block_another_post(self):
        self.c['status']='PARTIALLY_REFUNDED';self.order['purchase_units'][0]['payments']['refunds']=[{'id':'REFUND123'}]
        for status in ['PENDING','COMPLETED']:
            with self.assertRaises(ApiError):self.evidence([refund_record(self.p,2000,status=status)])
        self.p['known_refunds']=[{'status':'uncertain','refund_id':None}]
        with self.assertRaises(ApiError):history_ids(self.order['purchase_units'][0],self.p)
    def test_refund_identity_amount_currency_capture_status_and_custom_reference_are_bound(self):
        valid=refund_record(self.p,8000,custom_id='reference')
        for kind in ['id','amount','currency','link','status','custom']:
            with self.subTest(kind=kind):
                r=deepcopy(valid)
                if kind=='id':r['id']='OTHER'
                if kind=='amount':r['amount']['value']='81.00'
                if kind=='currency':r['amount']['currency_code']='EUR'
                if kind=='link':r['links'][0]['href']='https://evil.invalid/v2/payments/captures/'+self.p['capture_id']
                if kind=='status':r['status']='REFUNDED'
                if kind=='custom':r['custom_id']='other'
                with self.assertRaises(ApiError):refund_evidence(r,self.p,expected_id='REFUND123',amount=8000,custom_id='reference')
        self.assertEqual(refund_evidence(valid,self.p,expected_id='REFUND123',amount=8000,custom_id='reference')['status'],'completed')

class RefundAdapterTests(unittest.TestCase):
    def client(self,responses):
        self.calls=[]
        def transport(*args):
            self.calls.append(args);return responses.pop(0)
        c=PayPalSandboxClient('synthetic-client','synthetic-secret',MERCHANT,transport=transport)
        c._token='synthetic-token';c._expires=10**20
        return c
    def payload(self):return {'amount':{'currency_code':'USD','value':'80.00'},'custom_id':'trato-refund-'+uid(30)}
    def test_post_and_get_use_only_fixed_paths_explicit_amount_and_saved_uuid(self):
        c=self.client([Response(201,{'id':'REFUND123'}),Response(200,{'id':'REFUND123'})]);payload=self.payload()
        c.refund_capture('CAPTURE10',payload,uid(40));c.get_refund('REFUND123')
        self.assertEqual(self.calls[0][0:2],('POST','/v2/payments/captures/CAPTURE10/refund'))
        self.assertEqual(self.calls[0][2]['PayPal-Request-Id'],uid(40));self.assertEqual(self.calls[0][2]['Prefer'],'return=representation')
        import json
        self.assertEqual(json.loads(self.calls[0][3]),payload);self.assertEqual(self.calls[1][0:2],('GET','/v2/payments/refunds/REFUND123'))
    def test_missing_amount_arbitrary_url_and_unpersisted_id_are_rejected_before_transport(self):
        c=self.client([])
        for payload in [{},self.payload()|{'note_to_payer':'arbitrary'},self.payload()|{'amount':{'currency_code':'USD','value':'0.00'}}]:
            with self.assertRaises(PayPalError):c.refund_capture('CAPTURE10',payload,uid(40))
        with self.assertRaises(PayPalError):c.get_refund('https://evil.invalid')
        with self.assertRaises(PayPalError):c.refund_capture('CAPTURE10',self.payload(),None)
        self.assertFalse(self.calls)
    def test_only_verified_first_request_rejections_are_definitive(self):
        for status,body,definitive in [(401,{},True),(403,{},True),(400,{'name':'VALIDATION_ERROR'},True),(422,{'name':'REFUND_AMOUNT_EXCEEDED'},False),(409,{},False),(429,{},False),(500,{},False)]:
            with self.subTest(status=status):
                c=self.client([Response(status,body)])
                with self.assertRaises(PayPalError) as error:c.refund_capture('CAPTURE10',self.payload(),uid(40))
                self.assertEqual(error.exception.definitive,definitive);self.assertEqual(error.exception.uncertain,not definitive)
    def test_http_error_body_retains_machine_codes_without_account_text(self):
        raw=b'{"name":"UNPROCESSABLE_ENTITY","details":[{"issue":"REFUND_AMOUNT_EXCEEDED","description":"secret account details"}],"message":"private"}'
        error=HTTPError('https://api-m.sandbox.paypal.com',422,'rejected',{},BytesIO(raw))
        with patch('paypal.client.build_opener') as opener:
            opener.return_value.open.side_effect=error
            response=http_transport('POST','/v2/payments/captures/CAPTURE10/refund',{},b'{}')
        self.assertEqual(response.body['issues'],['REFUND_AMOUNT_EXCEEDED'])
        self.assertNotIn('private',str(response.body));self.assertNotIn('secret',str(response.body))
