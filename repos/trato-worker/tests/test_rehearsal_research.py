import json
import unittest
from unittest.mock import patch
from trato_worker.rehearsal_research import ReferenceRuntime,TOOLS
from trato_worker.rehearsal_evaluation import evaluate_rehearsal
from trato_worker.source_tools import ToolError
from test_rehearsal_evaluation import Client,data

class ResearchModel:
    name='test-model'
    def __init__(self,no_search=False):self.step=0;self.final_calls=0;self.no_search=no_search
    def generate(self,messages,schema):
        if 'oneOf' in schema:
            original=json.loads(messages[1]['content']);indices=[i for i,m in enumerate(original['messages']) if m['role']=='user'];self.step+=1
            if not self.no_search and self.step<=2:return {'type':'tool_call','tool':TOOLS[0],'params':{'query':['scope boundaries and pricing','clear delivery commitments'][self.step-1]}}
            return {'type':'final','result':{'aspects':[{'aspect':'Scope and timing','message_indices':indices,'rationale':'Investigate the actual request and reply.'}],'unresolved_questions':[]}}
        self.final_calls+=1;payload=json.loads(messages[-1]['content']);guides=payload['guides'];ref=next(iter(next(iter(guides[0]['segments'].values())))) if guides else None
        return {'summary':'Grounded summary','items':{str(i):{'evidence_quote':m['text'],'assessment':'strength' if ref else 'insufficient_evidence','finding':'A supported finding' if ref else 'No relevant evidence returned.','suggestion':None,'why':'A supported explanation' if ref else 'The search returned no relevant passages.','citations':[ref] if ref else []} for i,m in enumerate(payload['messages']) if m['role']=='user'}}

class ResearchTests(unittest.TestCase):
    def test_research_searches_distinct_aspects_before_evaluation(self):
        client=Client();model=ResearchModel()
        with patch('trato_worker.rehearsal_evaluation.audit') as audit:result=evaluate_rehearsal(data(),client,model)
        self.assertEqual(result['retrieval_mode'],'hybrid_weaviate');self.assertEqual(result['tools_used'],[TOOLS[0],TOOLS[0]]);self.assertEqual(model.final_calls,1)
        events=[call for call in audit.call_args_list if call.args[0]=='research_completed'];self.assertEqual(events[0].kwargs['query_count'],2)
    def test_research_cannot_finish_without_executing_a_search(self):
        model=ResearchModel(no_search=True)
        with self.assertRaisesRegex(ToolError,'REFERENCE_SEARCH_REQUIRED'):evaluate_rehearsal(data(),Client(),model)
        self.assertEqual(model.final_calls,0)
    def test_provider_failure_does_not_fall_back_to_full_library_reads(self):
        client=Client();client.reference_execute=lambda _:(_ for _ in ()).throw(ToolError('VECTOR_PROVIDER_UNAVAILABLE'))
        with self.assertRaisesRegex(ToolError,'VECTOR_PROVIDER_UNAVAILABLE'):evaluate_rehearsal(data(),client,ResearchModel())
        self.assertFalse(client.calls)
    def test_empty_results_produce_model_assessed_insufficiency_not_fake_evidence(self):
        client=Client();scope=client.info['scope_id'];client.reference_execute=lambda _:{'schema_version':1,'scope_id':scope,'files':[]}
        result=evaluate_rehearsal(data(),client,ResearchModel());self.assertEqual(result['sources_read'],0);self.assertEqual(result['items'][0]['assessment'],'insufficient_evidence');self.assertEqual(result['items'][0]['citations'],[])
    def test_tool_catalog_is_generic_and_cannot_enable_a_payment_or_foreign_source(self):
        runtime=ReferenceRuntime(Client());definitions=runtime.definitions()
        self.assertEqual({d['name'] for d in definitions},set(TOOLS));self.assertTrue(all(d['description'] and d['when_to_use'] for d in definitions))
        with self.assertRaisesRegex(ToolError,'TOOL_NOT_ALLOWED'):runtime.execute('send_payment',{})
        with self.assertRaisesRegex(ToolError,'SOURCE_NOT_ALLOWED'):runtime.execute(TOOLS[0],{'query':'scope','file_ids':['foreign']})
    def test_changed_scope_after_evaluation_invalidates_the_result(self):
        client=Client();original=client.reference_catalog;calls=0
        def catalog():
            nonlocal calls
            calls+=1;value=original()
            if calls>1:value['scope_id']='b'*64
            return value
        client.reference_catalog=catalog
        with self.assertRaisesRegex(ToolError,'SOURCE_SCOPE_CHANGED'):evaluate_rehearsal(data(),client,ResearchModel())
