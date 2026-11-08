from copy import deepcopy
import json
import unittest
from unittest.mock import patch
from trato_worker.rehearsal_evaluation import evaluate_rehearsal, RehearsalModel, bind_feedback
from trato_worker.source_tools import ToolError
from test_source_tools import Client as BaseClient,source

class Client(BaseClient):
    def reference_catalog(self):
        return {'schema_version':1,'workflow':'rehearsal_feedback','scope_id':self.info['scope_id'],'enabled_tools':['search_reference_passages','read_reference_context'],'documents':[{k:source(i)[k] for k in ('file_id','title','author','url')} for i in self.info['required_file_ids']]}
    def reference_execute(self,call):
        return self.execute({'params':{'file_ids':self.info['required_file_ids']}})



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
        if 'oneOf' in schema:
            original=json.loads(messages[1]['content'])
            if not any('tool_result' in message.get('content','') for message in messages):
                return {'type':'tool_call','tool':'search_reference_passages','params':{'query':'Scope boundaries and clear negotiation commitments'}}
            return {'type':'final','result':{'aspects':[{'aspect':'Scope and commitments','message_indices':[i for i,m in enumerate(original['messages']) if m['role']=='user'],'rationale':'Review the requested additional work and the actual replies.'}],'unresolved_questions':[]}}
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
    def test_hidden_intent_review_is_required_and_its_label_comes_from_the_backend(self):
        hidden=data('en');hidden['case']['client_intent']='You have a launch soon; push for an early date.'
        hidden['client_intent_reveal']={'id':'deadline','label':'Was in a hurry for a deadline'}
        class WithIntent(Model):
            def generate(self,messages,schema):
                result=super().generate(messages,schema)
                if 'type' in result:return result
                assert 'intent_review' in schema['required'] and 'HIDDEN CLIENT INTENT' in messages[0]['content']
                return {**result,'intent_review':{'discovered':True,'comment':'You asked which outcome mattered most.'}}
        with patch('trato_worker.rehearsal_evaluation.audit'):result=evaluate_rehearsal(hidden,Client(),WithIntent())
        self.assertEqual(result['client_intent'],{'id':'deadline','label':'Was in a hurry for a deadline','discovered':True,'comment':'You asked which outcome mattered most.'})
        # Without the review the evaluation is rejected; without an intent nothing extra is asked or returned.
        with patch('trato_worker.rehearsal_evaluation.audit'),self.assertRaises(ToolError):evaluate_rehearsal(hidden,Client(),Model())
        with patch('trato_worker.rehearsal_evaluation.audit'):plain=evaluate_rehearsal(data(),Client(),Model())
        self.assertNotIn('client_intent',plain)

    def test_multiple_relevant_guides_are_allowed_and_logs_exclude_conversation(self):
        class Multiple(Model):
            def generate(self,messages,schema):
                result=super().generate(messages,schema)
                if 'type' in result:return result
                guides=json.loads(messages[-1]['content'])['guides']
                result['items']['1']['citations']=[next(iter(next(iter(f['segments'].values())))) for f in guides[:3]]
                return result
        with patch('trato_worker.rehearsal_evaluation.audit') as audit:
            result=evaluate_rehearsal(data(),Client(),Multiple())
        self.assertEqual(len(result['items'][0]['citations']),3)
        self.assertEqual(sum(source['cited'] for source in result['sources']),3)
        events=[call.args[0] for call in audit.call_args_list]
        self.assertIn('guides_loaded',events);self.assertIn('references_selected',events)
        logged=repr(audit.call_args_list)
        self.assertNotIn(data()['messages'][1]['text'],logged)
        self.assertNotIn(data()['case']['agreement'],logged)


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
                if 'type' in result:return result
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
            self.assertEqual(len(result['sources']), 5)
            self.assertEqual(sum(s['cited'] for s in result['sources']), 1)
            self.assertTrue(all('text_sha256' in s and 'text' not in s for s in result['sources']))
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
        client.reference_catalog = lambda: (_ for _ in ()).throw(ToolError('SOURCE_LIBRARY_UNREADABLE'))
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
        self.assertEqual(refs['r2']['quote'],'Nine ten eleven.')

class CitationSelectionTests(unittest.TestCase):
    def test_repeated_verified_references_are_not_rejected_for_accumulated_word_count(self):
        from trato_worker.rehearsal_evaluation import validate_feedback
        text='One two three four five six seven eight.'
        files={'file-a':{'file_id':'file-a','title':'Guide','author':'Author','url':'https://example.invalid/guide',
                         'segments':[{'segment_id':'p1','text':text,'locator':{'kind':'page','page':1}}]}}
        def item(index):
            return {'message_index':index,'evidence_quote':f'Reply {index}', 'assessment':'improvement',
                    'finding':'A finding','suggestion':None,'why':'A principle',
                    'citations':[{'file_id':'file-a','segment_id':'p1','quote':text}]}
        output={'summary':'Summary','items':[item(i) for i in (1,3,5,7)]}
        validate_feedback(output,{i:f'Reply {i}' for i in (1,3,5,7)},files)
        self.assertEqual(len(output['items']),4)

    def test_passages_have_no_word_budget_metadata(self):
        from trato_worker.rehearsal_evaluation import citation_references,resolve_citations,validate_feedback
        text='One two three four five six seven eight. Nine ten.'
        f={'file_id':'file-a','title':'Guide','author':'Author','url':'https://example.invalid/guide',
           'segments':[{'segment_id':'p1','text':text,'locator':{'kind':'page','page':1}}]}
        guides,refs=citation_references([f])
        self.assertNotIn('citation_word_counts',guides[0]);self.assertNotIn('maximum_quoted_words',guides[0])
        output={'summary':'Summary','items':[{'message_index':i,'evidence_quote':f'Reply {i}',
                 'assessment':'strength','finding':'A finding','suggestion':None,'why':'A principle',
                 'citations':['r1']} for i in (1,3,5)]}
        resolve_citations(output,refs)
        validate_feedback(output,{i:f'Reply {i}' for i in (1,3,5)},{'file-a':f})
        self.assertEqual(len(output['items']),3)

class ContextualReferenceTests(unittest.TestCase):
    def test_all_original_passages_remain_available_for_model_selection(self):
        from trato_worker.rehearsal_evaluation import citation_references,resolve_citations
        texts=['Conditions','Timing adjustments','Explore several options before committing to a solution.']
        f={'file_id':'file','title':'Guide','author':'Author','segments':[
            {'segment_id':f'b{i}','text':text} for i,text in enumerate(texts)]}
        guides,refs=citation_references([f]);guide=guides[0]
        self.assertEqual([''.join(spans.values()) for spans in guide['segments'].values()],texts)
        self.assertEqual(guide['citable_reference_ids'],['r1','r2','r3'])
        output={'items':[{'citations':['r3']}]};resolve_citations(output,refs)
        self.assertEqual(output['items'][0]['citations'][0]['quote'],texts[2])

    def test_sentence_boundaries_preserve_meaning_and_every_original_character(self):
        from trato_worker.rehearsal_evaluation import citation_references
        text='  Explain the original scope before discussing a new price.\nDiscuss timing and conditions together.  '
        guide,refs=citation_references([{'file_id':'f','title':'Guide','author':'Author',
                                       'segments':[{'segment_id':'p','text':text}]}])
        self.assertEqual(''.join(guide[0]['segments']['p'].values()),text)
        self.assertEqual(refs['r1']['quote'],'Explain the original scope before discussing a new price.')
        self.assertEqual(refs['r2']['quote'],'Discuss timing and conditions together.')

class UnboundedVerifiedCitationTests(unittest.TestCase):
    def test_long_original_passages_and_more_than_three_citations_are_accepted(self):
        from trato_worker.rehearsal_evaluation import citation_references,resolve_citations,validate_feedback
        text=' '.join(f'originalword{i}' for i in range(65))+'.'
        f={'file_id':'f','title':'Guide','author':'Author','url':'https://example.invalid/guide',
           'segments':[{'segment_id':'p','text':text,'locator':{'kind':'page','page':1}}]}
        guides,refs=citation_references([f]);self.assertEqual(refs['r1']['quote'],text)
        self.assertEqual(''.join(guides[0]['segments']['p'].values()),text)
        output={'summary':'Summary','items':[{'message_index':1,'evidence_quote':'My reply',
            'assessment':'strength','finding':'A supported finding','suggestion':None,'why':'A supported principle',
            'citations':['r1']*4}]}
        resolve_citations(output,refs);validate_feedback(output,{1:'My reply'},{'f':f})
        self.assertEqual(len(output['items'][0]['citations']),4)
        self.assertEqual(output['items'][0]['citations'][0]['quote'],text)

    def test_removing_word_limits_does_not_allow_forged_quotes(self):
        from trato_worker.rehearsal_evaluation import validate_feedback
        f={'file_id':'f','segments':[{'segment_id':'p','text':'A real original sentence.'}]}
        output={'summary':'Summary','items':[{'message_index':1,'evidence_quote':'My reply',
            'assessment':'strength','finding':'A finding','suggestion':None,'why':'A principle',
            'citations':[{'file_id':'f','segment_id':'p','quote':'A fabricated sentence.'}]}]}
        with self.assertRaisesRegex(ToolError,'REHEARSAL_INVALID_CITATION'):
            validate_feedback(output,{1:'My reply'},{'f':f})


class ClientSideEvaluationTests(unittest.TestCase):
    def test_client_rehearsals_are_coached_in_the_client_role(self):
        from trato_worker.rehearsal_evaluation import validate_rehearsal_input, PROMPT
        seen = {}
        class Capture(Model):
            def generate(self, messages, schema):
                result = super().generate(messages, schema)
                if 'type' not in result and 'summary' in schema['properties']: seen['payload'] = json.loads(messages[1]['content'])
                return result
        client_side = {**data('en'), 'scenario': 'delivery', 'counterpart': 'freelancer'}
        with patch('trato_worker.rehearsal_evaluation.audit'): evaluate_rehearsal(client_side, Client(), Capture())
        self.assertEqual(seen['payload']['counterpart'], 'freelancer')
        self.assertIn('coach the user in their own role', PROMPT)
        for bad in ({'scenario': 'delivery'}, {'scenario': 'scope', 'counterpart': 'freelancer'}):
            with self.assertRaises(ToolError, msg=bad): validate_rehearsal_input({**data(), **bad})
