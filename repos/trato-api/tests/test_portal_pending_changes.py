import unittest
from trato_api.portal_assistant import can_request_changes


class PendingChangesTests(unittest.TestCase):
    def test_a_request_already_sent_cannot_be_drafted_again(self):
        view = {'status': 'ready_for_review', 'is_current': True, 'accepted_at': None, 'change_request': None}
        self.assertTrue(can_request_changes(view))
        self.assertFalse(can_request_changes({**view, 'change_request': {'notes': 'Move the date'}}))
