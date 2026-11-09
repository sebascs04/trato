import unittest
from pydantic import ValidationError
from trato_api.change_proposal import Draft

BASE = {'scope_summary': 'Scope', 'conditions': 'Terms', 'description': 'Work', 'estimated_hours': '4.00'}


class RequestedDateTests(unittest.TestCase):
    def test_a_real_date_is_kept(self):
        self.assertEqual(Draft.model_validate({**BASE, 'suggested_deadline': '2026-11-13'}).suggested_deadline, '2026-11-13')

    def test_missing_stays_empty(self):
        self.assertIsNone(Draft.model_validate(BASE).suggested_deadline)

    def test_anything_else_is_rejected(self):
        for value in ('Friday', '2026-13-40', '13/11/2026'):
            with self.assertRaises((ValidationError, ValueError)):
                Draft.model_validate({**BASE, 'suggested_deadline': value})
