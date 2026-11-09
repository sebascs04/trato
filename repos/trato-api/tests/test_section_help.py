import unittest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from fastapi.responses import JSONResponse
from trato_api.errors import ApiError
from trato_api.section_help import build_section_help_router, completed_result, section_guides

JOB = '11111111-2222-4333-8444-555555555555'


class Preferences:
    def for_request(self, request, owner): return 'gemini-3.8-flash'


class Jobs:
    def __init__(self): self.data = None; self.result = None
    def enqueue(self, owner, id, data): self.data = data; return {'id': id, 'status': 'queued'}
    def input(self, owner, id): return self.data


def body(**extra):
    return {'section': 'rehearsals', 'question': '¿Qué es la intención oculta?', 'output_language': 'es',
            'screen': {'view': 'setup', 'scenario': 'scope', 'case_theme': 'Web de una cafetería'}, 'history': [], **extra}


class SectionHelpTests(unittest.TestCase):
    def setUp(self):
        self.jobs = Jobs(); app = FastAPI()
        app.include_router(build_section_help_router(lambda: 'owner', self.jobs, Preferences()))
        @app.exception_handler(ApiError)
        async def error(_, e): return JSONResponse({'error': {'code': e.code}}, status_code=e.status)
        self.client = TestClient(app)

    def ask(self, payload):
        return self.client.post('/api/v1/ai/section-questions', json=payload, headers={'Idempotency-Key': JOB})

    def test_guide_is_bilingual_and_ids_are_unique(self):
        for name, section in section_guides().items():
            ids = [p['id'] for p in section['passages']]
            self.assertEqual(len(ids), len(set(ids)), name)
            for p in section['passages']: self.assertTrue(p['es'].strip() and p['en'].strip(), p['id'])

    def test_question_is_queued_with_only_the_section_guide_in_the_chosen_language(self):
        response = self.ask(body(history=[{'role': 'user', 'text': 'Hola'}, {'role': 'assistant', 'text': 'Hola, ¿en qué te ayudo?'}]))
        self.assertEqual(response.status_code, 202)
        data = self.jobs.data
        self.assertEqual((data['workflow'], data['section'], data['model_id']), ('section_help', 'rehearsals', 'gemini-3.8-flash'))
        self.assertEqual({p['id'] for p in data['guide']}, {p['id'] for p in section_guides()['rehearsals']['passages']})
        self.assertEqual(data['guide'][0]['text'], section_guides()['rehearsals']['passages'][0]['es'])
        self.assertEqual(data['screen'], {'view': 'setup', 'scenario': 'scope', 'case_theme': 'Web de una cafetería'})
        self.assertNotIn('client_intent', str(data))

    def test_invalid_screens_and_histories_are_rejected(self):
        for bad in (body(screen={'view': 'client_profile'}), body(section='reputation'),
                    body(screen={'view': 'setup', 'client_intent': 'deadline'}),
                    body(history=[{'role': 'assistant', 'text': 'Hola'}]), body(question='   '), body(section='projects')):
            self.assertEqual(self.ask(bad).status_code, 422, bad)
        self.assertEqual(self.ask(body(section='reputation', screen={'view': 'client_profile'})).status_code, 202)

    def test_completed_answers_are_checked_against_the_guide_and_carry_the_cited_text(self):
        self.ask(body(output_language='en'))
        answer = {'kind': 'section_help', 'section': 'rehearsals', 'status': 'answered', 'answer': 'It is a private motive.',
                  'passage_ids': ['practice-hidden-intent'], 'model': 'gemini-3.8-flash'}
        result = completed_result(self.jobs, 'owner', JOB, answer)
        self.assertEqual(result['passages'][0]['text'], next(p['en'] for p in section_guides()['rehearsals']['passages'] if p['id'] == 'practice-hidden-intent'))
        self.assertNotIn('model', result)
        for bad in ({**answer, 'passage_ids': ['rep-usage']}, {**answer, 'passage_ids': []},
                    {**answer, 'status': 'outside_guide'}, {**answer, 'section': 'reputation'}, {**answer, 'answer': '  '}):
            with self.assertRaises(ApiError, msg=bad): completed_result(self.jobs, 'owner', JOB, bad)
        outside = completed_result(self.jobs, 'owner', JOB, {**answer, 'status': 'outside_guide', 'passage_ids': []})
        self.assertEqual(outside['passages'], [])
