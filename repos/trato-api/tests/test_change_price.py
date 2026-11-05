"""User-confirmed pricing is exact and never invokes an AI provider."""
from unittest import TestCase
from trato_api.change_proposal import calculate_price
from trato_api.errors import ApiError
class ChangePriceTests(TestCase):
 def test_half_minor_unit_rounds_up(self):
  self.assertEqual(calculate_price(101,'0.5')['additional_minor'],51)
 def test_explicit_zero_rate_preserves_no_additional(self):
  self.assertEqual(calculate_price(0,'2.75')['additional_minor'],0)
 def test_invalid_effort_or_non_integer_rate_is_not_coerced(self):
  for rate,hours in [(True,'2'),(1.5,'2'),(-1,'2'),(100,'0'),(100,'NaN'),(100,'1.001'),(100,'1e4'),(100,'10001')]:
   with self.subTest(rate=rate,hours=hours),self.assertRaises(ApiError):calculate_price(rate,hours)
 def test_maximum_amount_is_enforced(self):
  with self.assertRaises(ApiError):calculate_price(99999999999,'10000')
