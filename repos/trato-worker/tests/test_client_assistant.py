import unittest

from trato_worker.client_assistant import AccountAnswer, coherent, run_client_assistant
from trato_worker.source_tools import ToolError

REFS = {'S1': {'type': 'stage'}, 'A1': {'type': 'addendum'}}


class Model:
    name = 'test-model'

    def __init__(self, result):
        self.result = result

    def generate(self, messages, schema):
        return self.result


def data(**extra):
    return {'workflow': 'client_account_assistant', 'output_language': 'en', 'question': 'How much have I paid?', 'history': [],
            'projects': [{'project': 'Café Aurora Website', 'paid': 'USD 181.00', 'items': []}], 'refs': REFS, **extra}


class ClientAssistantWorkerTests(unittest.TestCase):
    def test_answer_cites_known_items(self):
        result = run_client_assistant(data(), Model({'status': 'answered', 'answer': 'USD 181.00', 'sources': ['S1', 'A1']}))
        self.assertEqual(result['sources'], ['S1', 'A1'])

    def test_unknown_or_missing_citations_are_errors(self):
        for sources in (['S7'], []):
            with self.assertRaises(ToolError):
                run_client_assistant(data(), Model({'status': 'answered', 'answer': 'x', 'sources': sources}))
        self.assertTrue(coherent(AccountAnswer(status='outside_account', answer='Ask your freelancer.', sources=[]), REFS))

    def test_wrong_input_is_rejected(self):
        with self.assertRaises(ToolError):
            run_client_assistant(data(workflow='portal_assistant'), Model({}))


if __name__ == '__main__':
    unittest.main()
