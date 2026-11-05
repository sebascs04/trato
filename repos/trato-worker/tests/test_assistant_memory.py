import json,unittest
from trato_worker.assistant_memory import compact_memory
from trato_worker.source_tools import ToolError
class Model:
 def __init__(self,value):self.value=value;self.calls=[]
 def generate(self,messages,schema):self.calls.append((messages,schema));return self.value
class MemoryTests(unittest.TestCase):
 def memory(self,n=12):return {'revision':n,'summary':'Earlier preference: Spanish.','summarized_through':0,'messages':[{'position':i,'question':'x'*4000,'answer':'Answer '+str(i)} for i in range(1,n+1)]}
 def test_small_history_does_not_call_a_model(self):
  value=self.memory(1);model=Model(None);self.assertEqual(compact_memory(value,model,'es'),value);self.assertEqual(model.calls,[])
 def test_compaction_keeps_recent_messages_exact_and_does_not_modify_originals(self):
  value=self.memory();before=json.dumps(value);model=Model({'summary':'User prefers Spanish. Messages 1 to 6 summarized.'})
  result=compact_memory(value,model,'es')
  self.assertEqual(result['summarized_through'],6);self.assertEqual(result['messages'],value['messages'][6:]);self.assertEqual(json.dumps(value),before)
  payload=json.loads(model.calls[0][0][1]['content']);self.assertEqual(payload['previous_summary'],value['summary']);self.assertEqual(payload['older_messages'],value['messages'][:6])
 def test_empty_or_invalid_summary_is_an_error_not_a_replacement(self):
  for response in ({'summary':' '},{'unexpected':'summary'},'free text'):
   with self.assertRaises(ToolError):compact_memory(self.memory(),Model(response),'en')
