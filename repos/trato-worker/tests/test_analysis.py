import unittest
from trato_worker.analysis import OllamaModel, analyze

SOURCES = [{'id': 'agreement:1:p1', 'kind': 'agreement', 'text': 'Se incluye un video horizontal.'},
           {'id': 'request:1:p1', 'kind': 'request', 'text': 'Agregar una versión vertical.'}]


class FakeModel:
    def __init__(self, forged=False):
        self.forged = forged

    def generate(self, messages, schema):
        return {'relation': 'matches', 'classification': 'possible_extra', 'summary': 'Revisar el alcance con el profesional.',
                'sources': [{'source_id': 'agreement:1:p1', 'quote': 'Contenido inventado' if self.forged else 'un video horizontal'},
                            {'source_id': 'request:1:p1', 'quote': 'versión vertical'}]}


class AnalysisTests(unittest.TestCase):
    def test_valid_sources_still_require_human_review(self):
        self.assertTrue(analyze(SOURCES, FakeModel())['human_review_required'])

    def test_model_cannot_invent_citations(self):
        with self.assertRaises(ValueError):
            analyze(SOURCES, FakeModel(forged=True))

    def test_agreement_is_required(self):
        with self.assertRaises(ValueError):
            analyze(SOURCES[1:], FakeModel())

    def test_ollama_cannot_be_redirected_to_arbitrary_host(self):
        with self.assertRaises(ValueError):
            OllamaModel('example-model', 'https://other.example')


if __name__ == '__main__':
    unittest.main()
