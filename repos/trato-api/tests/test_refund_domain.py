"""Pure-domain tests. No credentials, database, model, network or provider doubles."""
from copy import deepcopy
import unittest
from uuid import UUID

from pydantic import ValidationError

from trato_api.errors import ApiError
from trato_api.refunds.domain import (
    Adjustment, CaptureContext, Citation, Percentage, RevisionCommand, SettlementRequest,
    SettlementTerms, Source, calculate_settlement, validate_request, validate_revision,
)


def uid(n):
    return UUID(int=n)


class RefundDomainTests(unittest.TestCase):
    def setUp(self):
        self.capture = dict(owner_id=uid(1), project_id=uid(2), payment_id=uid(3),
                            capture_id='CAPTURE-TEST', merchant_id='MERCHANT-TEST', currency='USD',
                            capture_verified=True, gross_minor=30000, original_fee_minor=1000,
                            previous_refunds_minor=0, provider_remaining_minor=30000,
                            reserved_minor=0, has_open_request=False)
        self.citation = dict(document_id=uid(4), extraction_id=uid(5),
                             document_sha256='a'*64, quote='Cancellation fee: USD 30.')
        self.source = Source(**{k: v for k, v in self.citation.items() if k != 'quote'},
                             owner_id=uid(1), project_id=uid(2), text=self.citation['quote'])
        self.sources = (self.source,)

    def context(self, **updates):
        return CaptureContext(**(self.capture | updates))

    def item(self, amount=12000, **updates):
        return dict(concept_id=uid(10), kind='recognized_work', beneficiary='seller',
                    description='Reviewed work value', amount_minor=amount,
                    evidence=[deepcopy(self.citation)]) | updates

    def terms(self, refund=30000, items=()):
        return SettlementTerms(currency='USD', adjustments=items,
                               proposed_refund_minor=refund, conditions='Payment settlement only.')

    def calculate(self, terms, **updates):
        return calculate_settlement(uid(1), terms, self.context(**updates), self.sources)

    def assert_code(self, code, fn):
        with self.assertRaises(ApiError) as caught:
            fn()
        self.assertEqual(caught.exception.code, code)

    def test_full_partial_and_zero(self):
        self.assertEqual(self.calculate(self.terms()).refund_minor, 30000)
        self.assertEqual(self.calculate(self.terms(18000, [self.item()])).refund_minor, 18000)
        self.assertEqual(self.calculate(self.terms(0, [self.item(30000)])).refund_minor, 0)

    def test_penalty_is_distinct_and_does_not_deduct_paypal_fee(self):
        result = self.calculate(self.terms(15000, [self.item(), self.item(3000,
            concept_id=uid(11), kind='penalty', description='Cancellation clause')]))
        self.assertEqual(result.seller_retention_minor, 15000)
        self.assertEqual(result.original_fee_minor, 1000)
        self.assertEqual(result.original_net_minor, 29000)
        self.assertEqual(result.refund_minor, 15000)

    def test_previous_refund_subtracted_once(self):
        result = self.calculate(self.terms(13000, [self.item()]), previous_refunds_minor=5000,
                                provider_remaining_minor=25000)
        self.assertEqual(result.refund_minor, 13000)

    def test_explicit_customer_credit(self):
        items = [self.item(), self.item(2000, concept_id=uid(11), kind='other', beneficiary='customer')]
        self.assertEqual(self.calculate(self.terms(20000, items)).refund_minor, 20000)

    def test_credit_cannot_exceed_capture(self):
        self.assert_code('REFUND_EXCEEDS_AVAILABLE', lambda: self.calculate(self.terms(31000,
            [self.item(1000, kind='other', beneficiary='customer')])))

    def test_no_negative_refund_or_implicit_collection(self):
        result = self.calculate(self.terms(0, [self.item(31000)]))
        self.assertEqual(result.refund_minor, 0)
        self.assertEqual(result.additional_payment_due_minor, 1000)

    def test_previous_settlement_cannot_be_rewritten(self):
        self.assert_code('REFUND_PRIOR_SETTLEMENT_CONFLICT', lambda: self.calculate(
            self.terms(0, [self.item(30000)]), previous_refunds_minor=5000,
            provider_remaining_minor=25000))

    def test_reservations_constrain_availability_not_entitlement(self):
        self.assert_code('REFUND_EXCEEDS_AVAILABLE', lambda: self.calculate(self.terms(), reserved_minor=1))
        self.assertEqual(self.calculate(self.terms(18000, [self.item()]), reserved_minor=5000).refund_minor, 18000)

    def test_proposed_amount_cannot_hide_a_deduction(self):
        self.assert_code('REFUND_PROPOSAL_AMOUNT_MISMATCH', lambda: self.calculate(self.terms(29999)))

    def test_duplicate_concept_even_under_different_category(self):
        with self.assertRaises(ValidationError):
            self.terms(6000, [self.item(), self.item(kind='expense')])

    def test_penalty_requires_evidence(self):
        for evidence in [[], [self.citation | {'quote':'Invented clause'}]]:
            with self.subTest(evidence=evidence):
                if not evidence:
                    with self.assertRaises(ValidationError):Adjustment(**self.item(3000, kind='penalty', evidence=evidence))
                else:
                    self.assert_code('REFUND_EVIDENCE_MISMATCH', lambda: self.calculate(
                        self.terms(27000, [self.item(3000, kind='penalty', evidence=evidence)])))

    def test_source_owner_project_version_and_hash_must_match(self):
        for update in [dict(owner_id=uid(99)), dict(project_id=uid(99)),
                       dict(extraction_id=uid(99)), dict(document_sha256='b'*64)]:
            with self.subTest(update=update):
                sources=(Source(**(self.source.model_dump() | update)),)
                self.assert_code('REFUND_EVIDENCE_MISMATCH', lambda: calculate_settlement(
                    uid(1), self.terms(18000, [self.item()]), self.context(), sources))

    def test_wrong_actor_is_hidden(self):
        self.assert_code('REFUND_NOT_FOUND', lambda: calculate_settlement(
            uid(99), self.terms(), self.context(), self.sources))

    def test_money_is_strict_integer_and_bounded(self):
        for amount in [True, '10', 1.5, -1, 100_000_000_000]:
            with self.subTest(amount=amount), self.assertRaises(ValidationError):self.terms(amount)

    def test_missing_values_extra_fields_and_currency_rejected(self):
        data=self.terms().model_dump()
        for field in ['adjustments','conditions','proposed_refund_minor']:
            with self.subTest(field=field), self.assertRaises(ValidationError):
                SettlementTerms(**{k:v for k,v in data.items() if k!=field})
        for extra in [dict(currency='EUR'),dict(automatic_penalty=True)]:
            with self.assertRaises(ValidationError):SettlementTerms(**(data | extra))

    def test_percentage_uses_basis_points_and_half_up_rounding(self):
        self.assertEqual(Percentage(base_minor=101, basis_points=5000).amount(), 51)
        Adjustment(**self.item(51, kind='penalty', percentage=dict(base_minor=101,basis_points=5000)))
        with self.assertRaises(ValidationError):
            Adjustment(**self.item(50, percentage=dict(base_minor=101,basis_points=5000)))

    def test_unverified_or_inconsistent_capture_rejected(self):
        for update in [dict(capture_verified=False),dict(capture_verified=1),
                       dict(provider_remaining_minor=20000), dict(original_fee_minor=30001),
                       dict(previous_refunds_minor=30001),dict(reserved_minor=30001)]:
            with self.subTest(update=update), self.assertRaises(ValidationError):self.context(**update)

    def test_request_does_not_close_project_or_bypass_open_request(self):
        request=SettlementRequest(payment_id=uid(3), scope='payment_only', reason='Cancellation',
                                  requested_by='customer', request_evidence=[self.citation])
        validate_request(uid(1), request, self.context(), self.sources)
        self.assert_code('PROJECT_HAS_OPEN_REQUEST', lambda: validate_request(
            uid(1),request,self.context(has_open_request=True),self.sources))
        self.assert_code('REFUND_PAYMENT_MISMATCH', lambda: validate_request(
            uid(1),request,self.context(payment_id=uid(99)),self.sources))

    def test_revision_guard_and_feedback(self):
        def revise(command, **updates):
            return validate_revision(command, **(dict(current_snapshot_id=uid(20), sent=False,
                finalized=False, actor_id=uid(1), context=self.context(), sources=self.sources) | updates))
        cmd=RevisionCommand(expected_snapshot_id=uid(20))
        self.assertEqual(revise(cmd), 'draft_snapshot')
        self.assert_code('REFUND_FEEDBACK_REQUIRED', lambda: revise(cmd, sent=True))
        self.assertEqual(revise(RevisionCommand(expected_snapshot_id=uid(20),feedback=self.citation),sent=True),'new_version')
        self.assert_code('REFUND_SETTLEMENT_READ_ONLY', lambda: revise(cmd,finalized=True))
        self.assert_code('REFUND_REVISION_CONFLICT', lambda: revise(cmd,current_snapshot_id=uid(21)))

    def test_totals_cannot_overflow_storage_bounds(self):
        items=[self.item(99_999_999_999),self.item(1,concept_id=uid(11))]
        self.assert_code('REFUND_AMOUNT_OVERFLOW',lambda:self.calculate(self.terms(0,items)))


if __name__ == '__main__':
    unittest.main()
