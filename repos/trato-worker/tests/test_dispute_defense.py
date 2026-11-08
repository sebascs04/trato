import json
import unittest

from trato_worker.dispute_defense import run_dispute_defense, PROMPT
from trato_worker.source_tools import ToolError

EVIDENCE = [{'id': 'agreement', 'kind': 'agreement', 'at': '2026-11-07', 'text': 'Addendum version 1\nScope: Online store module'},
            {'id': 'acceptance', 'kind': 'acceptance', 'at': '2026-11-08', 'text': 'The client accepted addendum version 1 on 2026-11-08'}]
ORIGINAL = 'a' * 64
SUMMARY = 'b' * 64
TOOL = {'name': 'search_document_text', 'description': 'Search original passages.', 'when_to_use': 'To cite documents.',
        'parameters': {'type': 'object', 'additionalProperties': False, 'required': ['query'], 'properties': {'query': {'type': 'string'}}}}


class Runtime:
    def __init__(self):
        self.enabled_tools = ['search_document_text']; self.calls = []
        self.catalog = {'documents': [{'id': 'doc-1', 'title': 'Initial agreement', 'kind': 'initial_agreement'}, {'id': 'doc-2', 'title': 'Notes', 'kind': 'other'}]}
        self.sources = {}
    def definitions(self): return [TOOL]
    def execute(self, tool, params):
        self.calls.append((tool, params))
        self.sources[ORIGINAL] = {'source_kind': 'original', 'file_id': 'doc-1', 'text': 'The store includes ten products.'}
        self.sources[SUMMARY] = {'source_kind': 'summary', 'file_id': 'doc-2', 'text': 'A summary of the notes.'}
        return {'sources': list(self.sources.values())}


def data(**extra):
    return {'workflow': 'dispute_defense', 'dispute_id': 'PP-R-1', 'project_id': 'p', 'output_language': 'en', 'evidence': EVIDENCE,
            'dispute': {'reason': 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED', 'status': 'WAITING_FOR_SELLER_RESPONSE', 'stage': 'INQUIRY',
                        'amount': {'value': '120.00', 'currency': 'USD'}, 'actions': ['send_message', 'make_offer'], 'client_messages': ['Not as described']}, **extra}


def answer(**extra):
    return {'assessment': 'partial', 'summary': 'The record shows acceptance, not delivery.', 'gaps': ['No proof of delivery.'], 'recommended_action': 'send_message',
            'response_message': 'Could you tell me what is missing?', 'documents': [{'document_id': 'doc-1', 'recommended': True, 'reason': 'Defines the scope.'}],
            'points': [{'claim': 'The client accepted it.', 'evidence_id': 'acceptance', 'quote': 'accepted addendum version 1'}], **extra}


class Model:
    name = 'test-model'
    def __init__(self, *outputs): self.outputs = list(outputs); self.messages = None
    def generate(self, messages, schema):
        self.messages = messages
        return self.outputs.pop(0)


def final(value): return {'type': 'final', 'result': value}
SEARCH = {'type': 'tool_call', 'tool': 'search_document_text', 'params': {'query': 'store scope'}}


def run(model, runtime=None, value=None):
    return run_dispute_defense(value or data(), model, None, 'job', 'exec', runtime=runtime or Runtime())


class DisputeDefenseTests(unittest.TestCase):
    def test_draft_cites_literal_evidence_and_says_what_is_missing(self):
        model = Model(final(answer()))
        result = run(model)
        self.assertEqual((result['kind'], result['dispute_id'], result['gaps']), ('dispute_defense', 'PP-R-1', ['No proof of delivery.']))
        payload = json.loads(model.messages[1]['content'])
        self.assertEqual(payload['evidence'], EVIDENCE)
        self.assertEqual([d['id'] for d in payload['documents']], ['doc-1', 'doc-2'])
        self.assertIn('None of these proves the work was delivered', PROMPT)
        self.assertIn('You may read any document in the project', PROMPT)
        self.assertIn('address response_message to the PayPal reviewer', PROMPT)

    def test_agent_reads_project_documents_and_cites_their_original_passages(self):
        runtime = Runtime()
        cited = answer(points=[{'claim': 'Ten products.', 'evidence_id': ORIGINAL, 'quote': 'includes ten products'}])
        result = run(Model(SEARCH, final(cited)), runtime)
        self.assertEqual(runtime.calls, [('search_document_text', {'query': 'store scope'})])
        self.assertEqual(result['points'][0]['evidence_id'], ORIGINAL)

    def test_a_line_break_in_the_pdf_text_does_not_reject_a_true_quote_and_the_original_is_kept(self):
        class Wrapped(Runtime):
            def execute(self, tool, params):
                result = super().execute(tool, params)
                self.sources[ORIGINAL]['text'] = 'The store includes\nten   products.'
                return result
        def quoted(quote):
            return run(Model(SEARCH, final(answer(points=[{'claim': 'Ten products.', 'evidence_id': ORIGINAL, 'quote': quote}]))), Wrapped())['points'][0]['quote']
        self.assertEqual(quoted('includes ten products'), 'includes\nten   products')
        for changed in ('includes twenty products', 'include s ten products', 'includesten products', '   '):
            with self.assertRaises(ToolError, msg=changed): quoted(changed)

    def test_summaries_and_passages_never_returned_cannot_be_cited(self):
        for evidence_id, quote in ((SUMMARY, 'A summary of the notes'), ('c' * 64, 'includes ten products')):
            with self.assertRaises(ToolError):
                run(Model(SEARCH, final(answer(points=[{'claim': 'x', 'evidence_id': evidence_id, 'quote': quote}]))))

    def test_invented_citations_unknown_documents_and_actions_paypal_does_not_allow_are_rejected(self):
        for bad in (answer(points=[{'claim': 'x', 'evidence_id': 'acceptance', 'quote': 'delivered everything'}]),
                    answer(points=[{'claim': 'x', 'evidence_id': 'unknown', 'quote': 'accepted'}]),
                    answer(recommended_action='escalate'), answer(points=[]), answer(response_message=' '),
                    answer(documents=[{'document_id': 'other-project', 'recommended': True, 'reason': 'x'}]),
                    answer(documents=[{'document_id': 'doc-1', 'recommended': True, 'reason': 'x'}, {'document_id': 'doc-1', 'recommended': False, 'reason': 'y'}])):
            with self.assertRaises(ToolError, msg=bad): run(Model(final(bad)))
        with self.assertRaises(ToolError): run(Model(final({'assessment': 'strong'})))
        self.assertEqual(run(Model(final(answer(assessment='weak', points=[]))))['points'], [])

    def test_schema_keeps_array_limits_gemini_accepts(self):
        from trato_worker.dispute_defense import SCHEMA
        self.assertLessEqual(max(p.get('maxItems', 0) for p in SCHEMA['properties'].values()), 12)

    def test_bad_inputs_never_reach_the_model(self):
        model = Model(final(answer()))
        for bad in (data(output_language='fr'), data(evidence=[]), data(dispute={'actions': ['appeal']}), data(workflow='other')):
            with self.assertRaises(ToolError): run(model, value=bad)
        self.assertIsNone(model.messages)
