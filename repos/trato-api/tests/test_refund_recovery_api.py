"""Recovery HTTP contracts: server facts, explicit consent and dedicated webhook."""
import json
import os
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient

from trato_api.app import create_app
from trato_api.errors import ApiError
from trato_api.refunds.financial import RefundFinance
from trato_api.refunds.financial_domain import refund_evidence
from trato_api.refunds.webhook import decode_event,refund_capture_id
from refund_financial_fixtures import OWNER,PARENT,SNAPSHOT,uid,payment,refund_record


class Services:
    def authenticate(self,token):
        if token!='Bearer owner':raise ApiError('UNAUTHORIZED',401)
        return OWNER

class RecoveryHttpTests(unittest.TestCase):
    def setUp(self):
        self.calls=[]
        def action(name):
            def run(*args):self.calls.append((name,args));return {'verified_test_result':True}
            return run
        flow=SimpleNamespace(**{n:action(n) for n in ['reconcile','replay','recovery_check','external_apply','retry_authorize']})
        with patch('trato_api.app.RefundFinance',return_value=flow):
            self.client=TestClient(create_app(services=Services(),refund_repository_factory=lambda *_:object()))
        self.client.__enter__();self.addCleanup(self.client.__exit__,None,None,None)
        self.base=f'/api/v1/refunds/{PARENT}/financial-operations/{uid(70)}'
        self.headers={'Authorization':'Bearer owner','Idempotency-Key':'explicit-key'}
        self.body={'expected_snapshot_id':SNAPSHOT,'attempt_id':uid(71),'expected_revision':2,'confirmed':True,'notes':'Explicitly reviewed'}

    def test_new_routes_authenticate_before_work(self):
        for suffix in ['reconcile','retry-checks','replay','external-receipts','retry-authorizations']:
            self.assertEqual(self.client.post(self.base+'/'+suffix).status_code,401)
        self.assertFalse(self.calls)

    def test_readonly_reconciliation_accepts_no_financial_facts(self):
        r=self.client.post(self.base+'/reconcile',headers=self.headers,json={})
        self.assertEqual(r.status_code,200,r.text);self.assertEqual(self.calls[-1][0],'reconcile')
        self.assertEqual(self.calls[-1][1][1:],(OWNER,PARENT,uid(70)))
        self.assertEqual(self.client.post(self.base+'/reconcile',headers=self.headers,json={'refund_id':'FORGED'}).status_code,422)

    def test_all_recovery_effects_require_strict_consent_and_no_client_money(self):
        for suffix,extra in [('replay',{}),('external-receipts',{'receipt_id':uid(72)}),('retry-authorizations',{'check_id':uid(73),'digest':'a'*64})]:
            good=self.body|extra
            for delta in [{'confirmed':False},{'confirmed':'true'},{'confirmed':1},{'expected_revision':True},{'expected_revision':-1},{'amount_minor':1},{'owner_id':uid(99)},{'request_id':uid(98)}]:
                self.assertEqual(self.client.post(self.base+'/'+suffix,headers=self.headers,json=good|delta).status_code,422,(suffix,delta))
            self.assertEqual(self.client.post(self.base+'/'+suffix,headers={'Authorization':'Bearer owner'},json=good).status_code,422)
            r=self.client.post(self.base+'/'+suffix,headers=self.headers,json=good);self.assertEqual(r.status_code,200,r.text)
            self.assertEqual(self.calls[-1][1][1:],(OWNER,PARENT,uid(70),good,'explicit-key'))

    def test_retry_check_requires_snapshot_but_cannot_execute(self):
        r=self.client.post(self.base+'/retry-checks',headers=self.headers,json={'expected_snapshot_id':SNAPSHOT})
        self.assertEqual(r.status_code,200,r.text);self.assertEqual(self.calls[-1][0],'recovery_check')

    def test_webhook_route_is_separate_from_unavailable_checkout_route_and_needs_no_jwt(self):
        with patch('trato_api.refunds.webhook.RefundWebhook.receive',return_value={'received':True}) as handler:
            response=self.client.post('/api/v1/refunds/webhooks/paypal',content=b'{}')
            self.assertEqual(response.status_code,200,response.text);self.assertEqual(handler.call_args.args[0],b'{}')
            self.assertEqual(response.headers['cache-control'],'no-store')
            response=self.client.post('/api/v1/refunds/webhooks/paypal',content=b'x'*(256*1024+1))
            self.assertEqual(response.status_code,413);self.assertEqual(handler.call_count,1)


class RecoveryEvidenceTests(unittest.TestCase):
    def test_missing_id_recovery_requires_exact_custom_reference(self):
        pay,*_=payment();record=refund_record(pay,1000)
        with self.assertRaises(ApiError):refund_evidence(record,pay,custom_id='saved',require_custom_id=True)
        record['custom_id']='saved'
        self.assertEqual(refund_evidence(record,pay,custom_id='saved',require_custom_id=True)['custom_id'],'saved')
        # An already known ID can still be queried when the representation lacks custom_id.
        del record['custom_id'];self.assertEqual(refund_evidence(record,pay,expected_id='REFUND123')['refund_id'],'REFUND123')

    def test_webhook_requires_explicit_dedicated_listener_and_never_checkout_listener_fallback(self):
        with patch.dict(os.environ,{'PAYPAL_ENVIRONMENT':'sandbox','PAYPAL_CLIENT_ID':'test','PAYPAL_CLIENT_SECRET':'test','PAYPAL_MERCHANT_ID':'TESTMERCHANT123','PAYPAL_WEBHOOK_ID':'checkout-only','PAYPAL_REFUND_WEBHOOK_ID':''},clear=True):
            with self.assertRaises(ApiError) as e:RefundFinance(None).provider(webhook=True)
            self.assertEqual(e.exception.code,'PAYPAL_REFUND_WEBHOOK_NOT_CONFIGURED')
            os.environ['PAYPAL_REFUND_WEBHOOK_ID']='dedicated-refunds'
            self.assertEqual(RefundFinance(None).provider(webhook=True).webhook_id,'dedicated-refunds')

    def test_invalid_or_ambiguous_resource_schemas_fail_before_verification(self):
        base={'id':'EVENT','event_type':'PAYMENT.CAPTURE.REFUNDED','resource_type':'refund','resource_version':'2.0','resource':{'id':'REFUND'}}
        for change in [{'resource_version':'1.0'},{'resource_type':'sale'},{'resource':[]},{'id':'../bad'}]:
            with self.assertRaises(ApiError):decode_event(json.dumps(base|change).encode())
        for raw in [b'{"id":"A","id":"B"}',b'[]',b'NaN',b'{']:
            with self.assertRaises(ApiError):decode_event(raw)
        self.assertEqual(decode_event(json.dumps(base).encode())['resource_type'],'refund')

    def test_capture_discovery_never_follows_arbitrary_links_or_payload_owners(self):
        pay,*_=payment();record=refund_record(pay,1000)
        self.assertEqual(refund_capture_id(record),pay['capture_id'])
        record['links'][0]['href']='https://evil.invalid/v2/payments/captures/'+pay['capture_id']
        with self.assertRaises(ApiError):refund_capture_id(record)

    def test_excess_canonical_money_is_evidence_for_ledger_incident_not_silently_discarded(self):
        pay,*_=payment();record=refund_record(pay,11000,total=11000)
        self.assertEqual(refund_evidence(record,pay)['amount_minor'],11000)
