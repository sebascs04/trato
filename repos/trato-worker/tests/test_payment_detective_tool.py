from hashlib import sha256
import json
import unittest

from trato_worker.project_assistant import PROMPT, ProjectTools, validate_answer

PROJECT = 'project-a'


def paypal_row(text):
    row = {'file_id': PROJECT, 'title': 'PayPal payments', 'source_kind': 'paypal', 'generation': 'g', 'text': text}
    row['source_id'] = sha256(json.dumps(row, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()
    return row


def definition(name):
    return {'name': name, 'description': 'd', 'when_to_use': 'w', 'parameters': {'type': 'object', 'additionalProperties': False, 'required': [], 'properties': {} if name != 'search_document_summaries' else {'query': {}}}}


class Backend:
    def __init__(self, with_paypal=True): self.with_paypal, self.calls = with_paypal, []
    def request(self, method, path, **kwargs):
        tool = kwargs['json']['tool']
        self.calls.append(tool)
        if tool == 'catalog':
            names = ['search_document_summaries', 'read_document_summary', 'search_document_text', 'search_conversation_history', 'read_project_plan', 'read_project_status'] + (['read_paypal_payments'] if self.with_paypal else [])
            return {'workflow': 'project_assistant', 'project_id': PROJECT, 'tools': [definition(n) for n in names], 'documents': []}
        return {'sources': [paypal_row('{"status":"PAYER_ACTION_REQUIRED"}')]}


def data():
    return {'project_id': PROJECT, 'memory': {'revision': 0}}


class PaymentDetectiveToolTests(unittest.TestCase):
    def test_the_agent_can_read_paypal_and_cite_it(self):
        tools = ProjectTools(Backend(), 'job', 'exec', data())
        result = tools.execute('read_paypal_payments', {})
        self.assertEqual(result['sources'][0]['source_kind'], 'paypal')
        answer = validate_answer({'status': 'answered', 'answer_basis': 'documents', 'answer': 'The client has not approved it yet.',
                                  'citations': [{'source_id': result['sources'][0]['source_id'], 'quote': 'PAYER_ACTION_REQUIRED'}], 'missing_information': []}, tools)
        self.assertEqual(answer['status'], 'answered')

    def test_the_tool_only_exists_when_the_backend_offers_it(self):
        tools = ProjectTools(Backend(with_paypal=False), 'job', 'exec', data())
        self.assertNotIn('read_paypal_payments', tools.enabled_tools)
        with self.assertRaises(Exception):
            tools.execute('read_paypal_payments', {})

    def test_the_prompt_forbids_inventing_causes_or_acting(self):
        self.assertIn('Never state a cause PayPal did not return', PROMPT)
        self.assertIn('You cannot send, charge, capture, refund or change anything', PROMPT)
