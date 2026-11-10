"""Refunds of payments charged with a PayPal invoice: the order PayPal created carries Trato's invoice, not Trato's reference."""
import unittest

from trato_api.errors import ApiError
from trato_api.refunds.financial import RefundFinance
from trato_api.refunds.financial_domain import capture_evidence
from refund_financial_fixtures import payment, NOW, MERCHANT

INVOICE = 'INV2-AAAA-BBBB-CCCC-DDDD'


def invoice_order():
    p, f, c, order = payment(refund=8000)
    unit = order['purchase_units'][0]
    unit['reference_id'] = 'default'
    unit.pop('custom_id', None)
    unit['invoice_id'] = INVOICE
    return p, f, c, order


class InvoiceOrderTests(unittest.TestCase):
    def test_accepted_only_with_the_invoice_trato_issued_for_this_payment(self):
        p, f, c, order = invoice_order()
        self.assertTrue(capture_evidence({**p, 'invoice_id': INVOICE}, f, c, order, [], MERCHANT, NOW)['verified'])
        with self.assertRaises(ApiError):
            capture_evidence({**p, 'invoice_id': 'INV2-OTHER-INVOICE'}, f, c, order, [], MERCHANT, NOW)
        with self.assertRaises(ApiError):  # Without Trato's invoice for this payment: rejected, as before.
            capture_evidence(p, f, c, order, [], MERCHANT, NOW)

    def test_invoice_does_not_skip_merchant_or_amount(self):
        for change in ('merchant', 'amount'):
            with self.subTest(change=change):
                p, f, c, order = invoice_order()
                unit = order['purchase_units'][0]
                if change == 'merchant':
                    unit['payee']['merchant_id'] = 'SOMEONEELSE'
                else:
                    unit['amount'] = {**unit['amount'], 'value': '1.00'}
                with self.assertRaises(ApiError):
                    capture_evidence({**p, 'invoice_id': INVOICE}, f, c, order, [], MERCHANT, NOW)

    def test_trato_orders_still_need_trato_reference(self):
        p, f, c, order = payment(refund=8000)
        order['purchase_units'][0]['reference_id'] = 'default'
        with self.assertRaises(ApiError):
            capture_evidence(p, f, c, order, [], MERCHANT, NOW)


class WithInvoiceTests(unittest.TestCase):
    """RefundFinance.with_invoice reads Trato's invoice only for an order PayPal created for an invoice."""
    def finance(self, rows):
        calls = []

        class Repo:
            def rows(_, table, params):
                calls.append((table, params))
                return rows

        class Store:
            repo = Repo()
        return RefundFinance(None, store=Store()), calls

    def test_trato_order_reads_nothing(self):
        finance, calls = self.finance([])
        pay = {'origin': 'change', 'proposal_payment_id': 'pp-1'}
        self.assertIs(finance.with_invoice(pay, {'purchase_units': [{'reference_id': 'pp-1'}]}), pay)
        self.assertEqual(calls, [])

    def test_invoice_order_gets_the_invoice_of_this_payment(self):
        finance, calls = self.finance([{'invoice_id': 'INV2-1'}])
        result = finance.with_invoice({'origin': 'change', 'proposal_payment_id': 'pp-1'}, {'purchase_units': [{'invoice_id': 'INV2-1'}]})
        self.assertEqual(result['invoice_id'], 'INV2-1')
        self.assertEqual((calls[0][0], calls[0][1]['id'], calls[0][1]['method']), ('proposal_payments', 'eq.pp-1', 'eq.invoice'))
        finance, calls = self.finance([{'invoice_id': 'INV2-9'}])
        result = finance.with_invoice({'origin': 'initial', 'id': 'ck-1'}, {'purchase_units': [{'invoice_id': 'INV2-9'}]})
        self.assertEqual((result['invoice_id'], calls[0][0]), ('INV2-9', 'project_initial_checkouts'))

    def test_no_invoice_of_trato_leaves_the_payment_as_it_was(self):
        finance, _ = self.finance([])
        pay = {'origin': 'change', 'proposal_payment_id': 'pp-1'}
        self.assertNotIn('invoice_id', finance.with_invoice(pay, {'purchase_units': [{'invoice_id': 'INV2-1'}]}))


if __name__ == '__main__':
    unittest.main()
