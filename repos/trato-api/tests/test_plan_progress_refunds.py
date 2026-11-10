import unittest
from trato_api.initial_payments.routes import with_stage_refunds


class Repo:
    def __init__(self, payments): self.payments, self.calls = payments, []
    def rpc(self, name, data):
        self.calls.append((name, data))
        return self.payments


class StageRefundsTest(unittest.TestCase):
    def test_paid_stage_carries_the_refund_paypal_confirmed(self):
        progress = {"stages": [{"position": 1, "status": "completed", "payment_id": "pay-1"}, {"position": 2, "status": "pending_approval", "payment_id": "pay-2"}]}
        repo = Repo([{"id": "pay-1", "amount_minor": 18000, "local_previous_refunds_minor": 5000}, {"id": "pay-2", "amount_minor": 30000, "local_previous_refunds_minor": 0}])
        stages = with_stage_refunds(repo, "project", progress)["stages"]
        self.assertEqual((stages[0]["paid_minor"], stages[0]["refunded_minor"]), (18000, 5000))
        self.assertNotIn("refunded_minor", stages[1])  # Not paid: nothing to refund.
        self.assertEqual(repo.calls, [("refund_payments", {"p_project_id": "project"})])

    def test_refund_never_exceeds_the_payment(self):
        progress = {"stages": [{"position": 1, "status": "completed", "payment_id": "pay-1"}]}
        stage = with_stage_refunds(Repo([{"id": "pay-1", "amount_minor": 100, "local_previous_refunds_minor": 900}]), "p", progress)["stages"][0]
        self.assertEqual(stage["refunded_minor"], 100)

    def test_no_paid_stage_reads_nothing_more(self):
        repo = Repo([])
        self.assertEqual(with_stage_refunds(repo, "p", {"stages": [{"position": 1, "status": None}]})["stages"][0], {"position": 1, "status": None})
        self.assertEqual(repo.calls, [])
