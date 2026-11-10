import unittest

from trato_worker.portal_assistant import coherent


class AcceptPayTests(unittest.TestCase):
    def test_accept_only_when_the_portal_offers_it(self):
        self.assertTrue(coherent('confirm_accept', 'You would accept v1.', ['scope', 'amount'], '', False, can_accept=True))
        self.assertFalse(coherent('confirm_accept', 'You would accept v1.', ['scope', 'amount'], '', False, can_accept=False))
        self.assertFalse(coherent('confirm_accept', 'You would accept v1.', [], '', False, can_accept=True))

    def test_pay_names_the_amount_and_only_when_unpaid(self):
        self.assertTrue(coherent('confirm_pay', 'USD 1.00 in PayPal.', ['amount'], '', False, can_pay=True))
        self.assertFalse(coherent('confirm_pay', 'USD 1.00 in PayPal.', ['scope'], '', False, can_pay=True))
        self.assertFalse(coherent('confirm_pay', 'USD 1.00 in PayPal.', ['amount'], '', False, can_pay=False))

    def test_an_action_never_carries_a_draft(self):
        self.assertFalse(coherent('confirm_accept', 'x', ['scope'], 'move the date', True, can_accept=True))


if __name__ == '__main__':
    unittest.main()
