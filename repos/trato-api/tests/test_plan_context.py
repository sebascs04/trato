import json,unittest
from unittest.mock import Mock
from trato_api.plan_context import plan_source
class PlanContextTests(unittest.TestCase):
 def test_plan_source_is_owner_scoped_canonical_and_changes_with_confirmed_stage(self):
  repo=Mock();repo.rpc.return_value={'completed_at':None,'stages':[]};value={'brief':'Website','budget':'600.00','currency':'USD','target_date':'2026-11-20','stages':[{'position':1,'title':'Design','deliverables':'Design','percent':100,'payment_condition':'After approval','amount':'600.00'}]};repo.rows.return_value=[value]
  first=plan_source(repo,'owner',{'id':'project'});self.assertEqual(repo.rows.call_args.args[1]['owner_id'],'eq.owner');self.assertEqual(repo.rows.call_args.args[1]['project_id'],'eq.project')
  self.assertEqual(first['source_kind'],'plan');self.assertEqual(json.loads(first['text'])['stages'][0]['payment_condition'],'After approval')
  value['stages'][0]['payment_condition']='After delivery';second=plan_source(repo,'owner',{'id':'project'});self.assertNotEqual(first['source_id'],second['source_id'])
 def test_absent_plan_is_not_replaced_with_fabricated_terms(self):
  repo=Mock();repo.rows.return_value=[];self.assertIsNone(plan_source(repo,'owner',{'id':'project'}))
