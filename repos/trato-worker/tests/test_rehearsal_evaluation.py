from copy import deepcopy
import json
import unittest
from unittest.mock import patch
from trato_worker.rehearsal_evaluation import evaluate_rehearsal, RehearsalModel, bind_feedback
from trato_worker.source_tools import ToolError
from test_source_tools import Client


def data(language='es'):
    return {'output_language': language, 'scenario': 'scope',
            'persona': {'patience': 3, 'flexibility': 3, 'price_sensitivity': 3},
            'case': {'agreement': 'A video.', 'request': 'An extra.'},
            'messages': [{'role': 'client', 'text': 'Can you add an extra?'},
                         {'role': 'user', 'text': 'Which outcome matters most?'}]}


class Model:
    name = 'test-model'
    def __init__(self, mutation=None): self.calls = []; self.mutation = mutation
    def generate(self, messages, schema):
        self.calls.append(messages)
        payload = json.loads(messages[-1]['content']); f = payload['guides'][0]
        segment_id, spans = next(iter(f['segments'].items())); ref, text = next(iter(spans.items()))
        result = {'summary': 'A specific observation.', 'items': [{'message_index': 1,
                  'evidence_quote': payload['messages'][1]['text'], 'assessment': 'strength',
                  'finding': 'You clarified the desired outcome.', 'suggestion': None,
                  'why': 'The question explores the actual need.',
                  'citations': [ref]}]}
        if self.mutation: self.mutation(result)
        return {'summary':result['summary'],'items':{str(item['message_index']):{k:v for k,v in item.items() if k!='message_index'} for item in result['items']}}


class EvaluatorTests(unittest.TestCase):
    def test_model_cannot_omit_duplicate_or_reassign_message_slots(self):
        for items in ({'1': {}}, {'1': {}, '3': {}, '7': {}}, [], {'1': {'message_index': 5}, '3': {}, '5': {}}):
            with self.subTest(items=items), self.assertRaises(ToolError):
                bind_feedback({'summary':'Summary','items':items},{1:'a',3:'b',5:'c'})

    def test_every_user_turn_is_evaluated_and_no_fixed_three_turn_limit_is_added(self):
        payload=data()
        payload['messages']=sum(([{'role':'client','text':f'Question {i}'},
                                  {'role':'user','text':f'Original reply {i}'}] for i in range(4)),[])
        class EveryTurn(Model):
            def generate(self,messages,schema):
                result=super().generate(messages,schema)
                item=result['items']['1']
                result['items']={str(i):{**deepcopy(item),'evidence_quote':m['text']}
                                 for i,m in enumerate(payload['messages']) if m['role']=='user'}
                return result
        result=evaluate_rehearsal(payload,Client(),EveryTurn())
        self.assertEqual([i['message_index'] for i in result['items']],[1,3,5,7])

    def test_all_five_guides_real_citation_metadata_and_original_history(self):
        for language in ('es', 'en'):
            model = Model(); client = Client()
            result = evaluate_rehearsal(data(language), client, model)
            self.assertEqual(result['sources_read'], 5)
            self.assertEqual(result['output_language'], language)
            payload = json.loads(model.calls[0][-1]['content'])
            self.assertEqual(payload['messages'], data(language)['messages'])
            self.assertEqual(len(payload['guides']), 5)
            self.assertNotIn('text', payload['guides'][0])  # No duplicated concatenated text.
            citation = result['items'][0]['citations'][0]
            self.assertEqual(citation['locator'], {'kind': 'page', 'page': 1})
            self.assertEqual(citation['url'], 'https://example.invalid/guide')

    def test_forged_source_quote_message_and_missing_items_are_rejected(self):
        mutations = [lambda r: r['items'][0].update(citations=[{'quote':'Invented quote'}]),
                     lambda r: r['items'][0].update(citations=['unknown']),
                     lambda r: r['items'][0].update(evidence_quote='Not said'),
                     lambda r: r['items'][0].update(citations=[]),
                     lambda r: r.update(items=[])]
        for mutate in mutations:
            with self.subTest(mutate=mutate), self.assertRaises(ToolError):
                evaluate_rehearsal(data(), Client(), Model(mutate))

    def test_missing_source_never_calls_model(self):
        client = Client(); model = Model()
        client.execute = lambda _: (_ for _ in ()).throw(ToolError('SOURCE_LIBRARY_UNREADABLE'))
        with self.assertRaisesRegex(ToolError, 'SOURCE_LIBRARY_UNREADABLE'):
            evaluate_rehearsal(data(), client, model)
        self.assertEqual(model.calls, [])

    def test_no_history_truncation_or_cpu_model_substitution(self):
        model = RehearsalModel('http://127.0.0.1:11435')
        with patch.object(model, 'request') as request:
            with self.assertRaisesRegex(ToolError, 'EVALUATION_CONTEXT_LIMIT'):
                model.generate([{'role': 'user', 'content': 'x' * 40001}], {})
            request.assert_not_called()
        responses = [{}, {'models': [{'name': model.name, 'size': 100, 'size_vram': 50}]}]
        with patch.object(model, 'request', side_effect=responses) as request:
            with self.assertRaisesRegex(ToolError, 'LOCAL_MODEL_GPU_REQUIRED'):
                model.generate([{'role': 'user', 'content': 'test'}], {})
            self.assertEqual(request.call_count, 2)

    def test_incomplete_thinking_output_is_not_published(self):
        model = RehearsalModel('http://127.0.0.1:11435')
        responses = [{}, {'models': [{'name': model.name, 'size': 100, 'size_vram': 100}]},
                     {'done_reason': 'length', 'message': {'content': '{}', 'thinking': 'private'}}]
        with patch.object(model, 'request', side_effect=responses):
            with self.assertRaisesRegex(ToolError, 'LOCAL_MODEL_INCOMPLETE'):
                model.generate([{'role': 'user', 'content': 'test'}], {})

class SourceSpanTests(unittest.TestCase):
    def test_reference_ids_preserve_every_character_and_bind_original_quote(self):
        from trato_worker.rehearsal_evaluation import citation_references,resolve_citations
        original='  One two three four five six seven eight.\nNine ten eleven.  '
        files=[{'file_id':'file','title':'Guide','author':'Author','segments':[{'segment_id':'page-1','text':original}]}]
        guides,refs=citation_references(files)
        self.assertEqual(''.join(guides[0]['segments']['page-1'].values()),original)
        output={'items':[{'citations':['r1']}]};resolve_citations(output,refs)
        self.assertEqual(output['items'][0]['citations'][0]['quote'],'One two three four five six seven eight.')
        self.assertTrue(all(len(r['quote'].split())<=8 for r in refs.values()))
