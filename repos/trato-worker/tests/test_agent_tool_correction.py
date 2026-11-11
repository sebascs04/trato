"""A call to an allowed tool with malformed parameters goes back to the model to correct, within the same call budget.
A forbidden tool or a failure after a tool ran still stops the job."""
import json
import unittest

from trato_worker.source_tools import ToolError, run_tool_agent

TOOL = {'name': 'search_document_text', 'description': 'Search the project documents.', 'when_to_use': 'To find passages.',
        'parameters': {'type': 'object', 'additionalProperties': False, 'required': ['query'], 'properties': {'query': {'type': 'string'}}}}


class Runtime:
    enabled_tools = ('search_document_text',)

    def __init__(self, failure='AI_TOOL_INVALID'):
        self.failure, self.calls = failure, []

    def definitions(self):
        return [dict(TOOL)]

    def execute(self, tool, params):
        self.calls.append(params)
        if 'query' not in params:
            raise ToolError(self.failure)
        return {'sources': []}


class Model:
    def __init__(self, replies):
        self.replies, self.seen = list(replies), []

    def generate(self, history, schema):
        self.seen.append(history[-1]['content'])
        return self.replies.pop(0)


BAD = {'type': 'tool_call', 'tool': 'search_document_text', 'params': {'text': 'stage 2'}}
GOOD = {'type': 'tool_call', 'tool': 'search_document_text', 'params': {'query': 'stage 2'}}
FINAL = {'type': 'final', 'result': {'answer': 'ok'}}


class ToolCorrectionTests(unittest.TestCase):
    def run_agent(self, model, runtime, calls=4):
        return run_tool_agent(model, runtime, [{'role': 'user', 'content': '{}'}], {'type': 'object'},
                              maximum_context_bytes=200000, max_tool_calls=calls)

    def test_a_malformed_call_is_returned_to_the_model_and_corrected(self):
        model, runtime = Model([BAD, GOOD, FINAL]), Runtime()
        self.assertEqual(self.run_agent(model, runtime), {'answer': 'ok'})
        self.assertEqual(runtime.calls, [{'text': 'stage 2'}, {'query': 'stage 2'}])
        error = json.loads(model.seen[1])['tool_error']
        self.assertEqual((error['error_code'], error['tools'][0]['name']), ('AI_TOOL_INVALID', 'search_document_text'))

    def test_corrections_count_toward_the_call_limit(self):
        with self.assertRaises(ToolError) as caught:
            self.run_agent(Model([BAD, BAD, BAD]), Runtime(), calls=2)
        self.assertEqual(caught.exception.code, 'TOOL_CALL_LIMIT')

    def test_a_forbidden_tool_still_stops_the_job(self):
        with self.assertRaises(ToolError) as caught:
            self.run_agent(Model([BAD, FINAL]), Runtime('TOOL_NOT_ALLOWED'))
        self.assertEqual(caught.exception.code, 'TOOL_NOT_ALLOWED')

    def test_failures_after_a_tool_ran_still_stop_the_job(self):
        with self.assertRaises(ToolError) as caught:
            self.run_agent(Model([BAD, FINAL]), Runtime('INVALID_TOOL_RESPONSE'))
        self.assertEqual(caught.exception.code, 'INVALID_TOOL_RESPONSE')


if __name__ == '__main__':
    unittest.main()
