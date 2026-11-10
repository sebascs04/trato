import unittest

from trato_api.errors import ApiError
from trato_api.portal_assistant import agreement_context, validate_answer

WAITING = {'status': 'ready_for_review', 'is_current': True, 'accepted_at': None, 'change_request': None, 'additional_minor': 100}
UNPAID = {'status': 'accepted', 'is_current': True, 'accepted_at': '2026-11-09', 'payment_status': 'pending', 'additional_minor': 100}


def answer(status, sources):
    return {'kind': 'portal_assistant', 'status': status, 'answer': 'ok', 'sources': sources, 'change_request': '', 'problem_report': ''}


class PortalAcceptPayTests(unittest.TestCase):
    def test_context_says_when_accepting_or_paying_is_possible(self):
        self.assertEqual((agreement_context(WAITING)['can_accept'], agreement_context(WAITING)['can_pay']), (True, False))
        self.assertEqual((agreement_context(UNPAID)['can_accept'], agreement_context(UNPAID)['can_pay']), (False, True))
        paid = {**UNPAID, 'payment_status': 'completed'}
        self.assertFalse(agreement_context(paid)['can_pay'])
        self.assertFalse(agreement_context({**UNPAID, 'additional_minor': 0})['can_pay'])

    def test_an_action_the_job_was_not_allowed_is_rejected(self):
        self.assertEqual(validate_answer(answer('confirm_accept', ['scope']), True, accept=True)['status'], 'confirm_accept')
        with self.assertRaises(ApiError):
            validate_answer(answer('confirm_accept', ['scope']), True, accept=False)
        self.assertEqual(validate_answer(answer('confirm_pay', ['amount']), False, pay=True)['status'], 'confirm_pay')
        with self.assertRaises(ApiError):
            validate_answer(answer('confirm_pay', ['amount']), False, pay=False)


if __name__ == '__main__':
    unittest.main()
