"""Recovery HTTP contracts: server facts, explicit consent and dedicated webhook."""
import json
import os
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

from trato_api.app import create_app
from trato_api.disputes import DisputeReader, build_dispute_router
from trato_api.errors import ApiError
from trato_api.refunds.disputes import ensure_no_open_dispute
from trato_api.refunds.financial import RefundFinance
from trato_api.refunds.financial_domain import refund_evidence
from trato_api.refunds.webhook import decode_event,refund_capture_id
from refund_financial_fixtures import NOW,OWNER,PARENT,SNAPSHOT,uid,payment,refund_record


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


class DisputeRefundIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.pay, _, capture, order = payment()
        self.dispute_id = 'PP-R-TEST-123'
        self.provider = Mock(merchant_id=self.pay['merchant_id'])
        self.provider.get_capture.return_value = {**capture, 'status': 'PARTIALLY_REFUNDED'}
        self.provider.get_order.return_value = order
        self.provider.list_disputes.return_value = {'items': [{'dispute_id': self.dispute_id}]}
        self.details = {
            'dispute_id': self.dispute_id, 'status': 'RESOLVED',
            'disputed_transactions': [{'seller_transaction_id': self.pay['capture_id']}],
            'dispute_outcome': {'outcome_code': 'RESOLVED_BUYER_FAVOUR'},
            'refund_details': {'transactions': [{'id': 'REFUND123'}]},
        }
        self.provider.get_dispute.return_value = self.details
        self.store = Mock()
        self.lookup = {'found': True, 'payment': self.pay, 'attempts': []}
        self.store.webhook.return_value = self.lookup
        self.receipt_id = uid(99)
        self.store.receipt.return_value = {'recorded': True, 'receipt_id': self.receipt_id}
        repo = Mock()
        repo.rows.return_value = [self.pay]
        app = FastAPI()

        @app.exception_handler(ApiError)
        async def handle(_, error):
            return JSONResponse({'error': error.code}, status_code=error.status)

        finance = RefundFinance(None, paypal=self.provider, store=self.store)
        app.include_router(build_dispute_router(None, lambda: OWNER, lambda *_: repo,
                                                DisputeReader(self.provider), refund_finance=finance))
        self.client = TestClient(app)
        self.path = f"/api/v1/projects/{self.pay['project_id']}/disputes"

    def test_dispute_refresh_reconciles_only_a_canonical_refund_on_its_capture(self):
        self.provider.get_refund.return_value = refund_record(self.pay, 1000, status='PENDING')
        dispute = self.client.get(self.path).json()['data']['disputes'][0]
        self.assertEqual(dispute['refund_sync'], 'pending')
        self.assertNotIn('_refund_refs', dispute)
        self.assertEqual(self.store.receipt.call_args.args[2]['status'], 'pending')
        self.store.link_dispute_receipt.assert_not_called()

        self.provider.get_refund.return_value = refund_record(self.pay, 1000)
        dispute = self.client.get(self.path).json()['data']['disputes'][0]
        self.assertEqual(dispute['refund_sync'], 'confirmed')
        self.assertEqual(self.store.receipt.call_args.args[:2], (OWNER, self.pay['id']))
        self.assertEqual(self.store.receipt.call_args.args[2]['amount_minor'], 1000)
        self.store.link_dispute_receipt.assert_called_once_with(OWNER, self.pay['project_id'], self.receipt_id, self.dispute_id)
        self.provider.refund_capture.assert_not_called()
        self.provider.accept_dispute_claim.assert_not_called()

    def test_dispute_cannot_be_accepted_during_an_unresolved_refund_attempt(self):
        self.lookup['attempts'] = [{'status': 'uncertain'}]
        self.provider.get_dispute.return_value = {**self.details, 'status': 'WAITING_FOR_SELLER_RESPONSE',
                                                  'links': [{'rel': 'accept_claim'}]}
        response = self.client.post(f'{self.path}/{self.dispute_id}/accept', json={'note': 'Accept claim'})
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['error'], 'REFUND_PAYMENT_IN_PROGRESS')
        self.provider.accept_dispute_claim.assert_not_called()


class RecoveryEvidenceTests(unittest.TestCase):
    def test_verified_full_refund_without_order_receipts(self):
        pay, _, capture, order = payment()
        provider = Mock(merchant_id=pay['merchant_id'])
        provider.get_order.return_value = order
        store = Mock()
        recovery = RefundFinance(None, store=store).recovery()

        provider.get_capture.return_value = capture
        recovery.scan(OWNER, pay, [], provider)
        store.confirm_full_capture_refund.assert_not_called()

        provider.get_capture.return_value = {**capture, 'status': 'REFUNDED'}
        recovery.scan(OWNER, pay, [], provider)
        store.confirm_full_capture_refund.assert_called_once_with(OWNER, pay['id'], pay['capture_id'])
        store.receipt.assert_not_called()
        provider.refund_capture.assert_not_called()

    def test_dispute_guard_distinguishes_open_and_closed_cases(self):
        capture = 'CAPTURE10'
        dispute_id = 'PP-R-TEST-123'
        reader = Mock()
        client = reader.provider.return_value
        client.list_disputes.return_value = {'items': [{'dispute_id': dispute_id}]}
        details = {'dispute_id': dispute_id, 'disputed_transactions': [{'seller_transaction_id': capture}]}
        client.get_dispute.return_value = {**details, 'status': 'WAITING_FOR_SELLER_RESPONSE'}
        with self.assertRaises(ApiError) as error:
            ensure_no_open_dispute(capture, reader)
        self.assertEqual(error.exception.code, 'REFUND_PAYMENT_IN_DISPUTE')

        client.get_dispute.return_value = {
            **details, 'status': 'RESOLVED', 'dispute_outcome': {'outcome_code': 'RESOLVED_SELLER_FAVOUR'},
        }
        self.assertIsNone(ensure_no_open_dispute(capture, reader))

        client.get_dispute.return_value = {
            **details, 'status': 'RESOLVED', 'dispute_outcome': {'outcome_code': 'RESOLVED_BUYER_FAVOUR'},
            'refund_details': {'transactions': [{'id': 'REFUND123'}]},
        }
        self.assertEqual(ensure_no_open_dispute(capture, reader), {'REFUND123'})

        client.list_disputes.return_value = {'items': [], 'links': [{'rel': 'next'}]}
        with self.assertRaises(ApiError) as error:
            ensure_no_open_dispute(capture, reader)
        self.assertEqual(error.exception.code, 'INVALID_PROVIDER_RESPONSE')

    def test_dispute_refund_must_be_in_verified_balance_before_a_new_refund(self):
        pay, allocation, capture, order = payment()
        provider = Mock(merchant_id=pay['merchant_id'])
        provider.get_capture.return_value = capture
        provider.get_order.return_value = order
        finance = RefundFinance(None, disputes=lambda _: {'REFUND123'}, clock=lambda: NOW)
        context = {'received_payments': [pay], 'payments': [allocation]}

        with self.assertRaises(ApiError) as error:
            finance.observation(context, pay['id'], provider)
        self.assertEqual(error.exception.code, 'REFUND_RECONCILIATION_REQUIRED')
        provider.refund_capture.assert_not_called()

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
