import json,unittest
from trato_worker.change_proposal import proposal_schema
class ChangeSchemaTests(unittest.TestCase):
 def test_dispatcher_nested_result_does_not_have_dangling_root_refs(self):
  schema=proposal_schema();encoded=json.dumps(schema)
  self.assertNotIn('"$ref"',encoded);self.assertNotIn('"$defs"',encoded)
  self.assertEqual(schema['properties']['proposal']['properties']['suggested_deadline']['type'],'null')
  self.assertIn('reference_id',schema['properties']['citations']['items']['properties'])
