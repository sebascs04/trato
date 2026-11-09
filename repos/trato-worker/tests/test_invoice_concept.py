import unittest

from trato_worker.invoice_concept import run_invoice_concept
from trato_worker.source_tools import ToolError


class Model:
    name = 'test-model'

    def __init__(self, answer):
        self.answer, self.calls = answer, []

    def generate(self, messages, schema):
        self.calls.append(messages)
        return self.answer


DATA = {'workflow': 'invoice_concept', 'target': 'stage', 'output_language': 'en', 'project_name': 'Café Aurora Website',
        'facts': {'deliverable_number': 1, 'title': 'Planning and Initial UI Design', 'client_approved_on': '2026-11-09'}}


class InvoiceConceptTest(unittest.TestCase):
    def test_concept_comes_back_validated_and_without_extra_spaces(self):
        model = Model({'concept': '  Planning and initial UI design,   approved on Nov 9 '})
        result = run_invoice_concept(dict(DATA), model)
        self.assertEqual(result, {'kind': 'invoice_concept', 'target': 'stage', 'model': 'test-model',
                                  'concept': 'Planning and initial UI design, approved on Nov 9'})
        self.assertIn('Planning and Initial UI Design', model.calls[0][1]['content'])

    def test_amounts_never_reach_the_model(self):
        model = Model({'concept': 'Planning'})
        run_invoice_concept(dict(DATA), model)
        self.assertNotIn('amount', model.calls[0][1]['content'])

    def test_invalid_answers_and_inputs_are_errors(self):
        for answer in ({'concept': ''}, {'concept': 'x' * 201}, {'text': 'Planning'}):
            with self.assertRaises(ToolError):
                run_invoice_concept(dict(DATA), Model(answer))
        with self.assertRaises(ToolError):
            run_invoice_concept({**DATA, 'target': 'refund'}, Model({'concept': 'x'}))
        with self.assertRaises(ToolError):
            run_invoice_concept({**DATA, 'facts': {}}, Model({'concept': 'x'}))


if __name__ == '__main__':
    unittest.main()
