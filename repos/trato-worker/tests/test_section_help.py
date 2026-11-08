import json
import unittest

from trato_worker.section_help import run_section_help
from trato_worker.source_tools import ToolError

GUIDE = [{'id': 'practice-hidden-intent', 'text': 'The client gets a random private motive.'},
         {'id': 'practice-evaluation', 'text': 'Analyze with AI reviews each reply.'}]


def data(**extra):
    return {'workflow': 'section_help', 'section': 'rehearsals', 'output_language': 'en', 'question': 'Write my reply for me',
            'screen': {'view': 'conversation', 'scenario': 'scope'}, 'history': [], 'guide': GUIDE, **extra}


class Model:
    name = 'test-model'
    def __init__(self, output): self.output = output; self.messages = None
    def generate(self, messages, schema):
        self.messages = messages
        assert schema['properties']['status']['enum'] == ['answered', 'outside_guide']
        return self.output


class SectionHelpWorkerTests(unittest.TestCase):
    def test_answer_cites_known_passages_and_the_prompt_forbids_writing_rehearsal_replies(self):
        model = Model({'status': 'answered', 'answer': 'Ask open questions first.', 'passage_ids': ['practice-hidden-intent']})
        result = run_section_help(data(), model)
        self.assertEqual(result, {'kind': 'section_help', 'section': 'rehearsals', 'model': 'test-model', 'status': 'answered',
                                  'answer': 'Ask open questions first.', 'passage_ids': ['practice-hidden-intent']})
        system, user = model.messages[0]['content'], json.loads(model.messages[1]['content'])
        self.assertIn("never write, rewrite or complete the freelancer's reply", system)
        self.assertIn('output_language', system)
        self.assertEqual(user['guide'], GUIDE)

    def test_unknown_or_missing_citations_and_bad_inputs_are_rejected(self):
        for output in ({'status': 'answered', 'answer': 'x', 'passage_ids': ['rep-usage']},
                       {'status': 'answered', 'answer': 'x', 'passage_ids': []},
                       {'status': 'outside_guide', 'answer': 'x', 'passage_ids': ['practice-evaluation']},
                       {'status': 'answered', 'answer': 'x', 'passage_ids': ['practice-evaluation', 'practice-evaluation']}):
            with self.assertRaises(ToolError, msg=output): run_section_help(data(), Model(output))
        with self.assertRaises(ToolError): run_section_help(data(), Model({'status': 'answered', 'answer': 'x'}))
        for bad in (data(section='projects'), data(output_language='fr'), data(guide=[]), data(question=' ')):
            with self.assertRaises(ToolError): run_section_help(bad, Model({}))
        outside = run_section_help(data(), Model({'status': 'outside_guide', 'answer': 'The guide does not cover that.', 'passage_ids': []}))
        self.assertEqual(outside['passage_ids'], [])
