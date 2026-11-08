import json
import unittest

from trato_worker.portal_assistant import run_portal_assistant
from trato_worker.source_tools import ToolError

AGREEMENT = {'project_name': 'Website', 'client_name': 'Aurora', 'version': 2, 'scope': 'Online store with five products', 'conditions': '',
             'amount_minor': 18000, 'currency': 'USD', 'deadline': '2026-11-20', 'status': 'ready_for_review', 'payment_status': None,
             'can_request_changes': True, 'pending_change_request': None}


def data(**extra):
    return {'workflow': 'portal_assistant', 'output_language': 'en', 'question': 'What is included?', 'history': [], 'agreement': AGREEMENT, **extra}


def output(**extra):
    return {'status': 'answered', 'answer': 'A store with five products.', 'sources': ['scope'], 'change_request': '', **extra}


class Model:
    name = 'test-model'
    def __init__(self, value): self.value = value; self.messages = None
    def generate(self, messages, schema):
        self.messages = messages
        assert schema['properties']['status']['enum'] == ['answered', 'outside_agreement', 'draft_change']
        return self.value


class PortalAssistantWorkerTests(unittest.TestCase):
    def test_answers_from_the_agreement_with_only_what_the_backend_sent(self):
        model = Model(output())
        result = run_portal_assistant({**data(), 'owner_id': 'internal', 'model_id': 'internal'}, model)
        self.assertEqual(result, {'kind': 'portal_assistant', 'model': 'test-model', **output()})
        sent = json.loads(model.messages[1]['content'])
        self.assertEqual(set(sent), {'output_language', 'agreement', 'history', 'question'})

    def test_drafts_a_change_only_when_the_client_can_still_request_it(self):
        draft = output(status='draft_change', answer='Review it and send it.', sources=[], change_request='Could we move the date to the 22nd?')
        self.assertEqual(run_portal_assistant(data(), Model(draft))['change_request'], draft['change_request'])
        closed = {**AGREEMENT, 'can_request_changes': False, 'status': 'accepted'}
        with self.assertRaises(ToolError) as error:
            run_portal_assistant(data(agreement=closed), Model(draft))
        self.assertEqual(error.exception.code, 'AI_INVALID_CITATION')

    def test_incoherent_answers_are_errors_and_never_shown(self):
        for bad in (output(sources=[]), output(change_request='Hidden draft'), output(status='outside_agreement'),
                    output(status='draft_change', sources=[], change_request='   '), output(answer='   '), output(sources=['scope', 'scope'])):
            with self.assertRaises(ToolError, msg=bad):
                run_portal_assistant(data(), Model(bad))
        for bad in (output(sources=['rates']), {**output(), 'extra': 1}, {'status': 'answered'}):
            with self.assertRaises(ToolError, msg=bad) as error:
                run_portal_assistant(data(), Model(bad))
            self.assertEqual(error.exception.code, 'AI_INVALID_RESPONSE')

    def test_invalid_input_never_reaches_the_model(self):
        model = Model(output())
        for bad in (data(workflow='section_help'), data(question='  '), data(output_language='fr'), data(history=None), data(agreement={'scope': 'x'})):
            with self.assertRaises(ToolError):
                run_portal_assistant(bad, model)
        self.assertIsNone(model.messages)
