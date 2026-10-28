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
        self.assertTrue(analyze(SOURCES, FakeModel(), output_language='es')['human_review_required'])

    def test_model_cannot_invent_citations(self):
        with self.assertRaises(ValueError):
            analyze(SOURCES, FakeModel(forged=True), output_language='es')

    def test_agreement_is_required(self):
        with self.assertRaises(ValueError):
            analyze(SOURCES[1:], FakeModel(), output_language='es')

    def test_ollama_cannot_be_redirected_to_arbitrary_host(self):
        with self.assertRaises(ValueError):
            OllamaModel('example-model', 'https://other.example')


if __name__ == '__main__':
    unittest.main()

class OutputLanguageTests(unittest.TestCase):
    def test_language_parameter_changes_data_not_the_canonical_instructions(self):
        import json
        captured=[]
        class CaptureModel(FakeModel):
            def generate(self,messages,schema):
                captured.append(messages)
                result=super().generate(messages,schema)
                result['summary']='Review scope.' if json.loads(messages[-1]['content'])['output_language']=='en' else 'Revisa el alcance.'
                return result
        results=[analyze(SOURCES,CaptureModel(),output_language=lang) for lang in ('es','en')]
        self.assertEqual(captured[0][:2],captured[1][:2])
        self.assertIn('Write summary directly in output_language',captured[0][1]['content'])
        self.assertEqual([r['output_language'] for r in results],['es','en'])
        self.assertEqual(results[1]['analysis']['summary'],'Review scope.')
        for result in results:
            self.assertEqual(result['sources'],SOURCES)
            self.assertEqual(result['analysis']['sources'][1]['quote'],'versión vertical')

    def test_unsupported_or_missing_language_never_calls_model(self):
        class NoCalls:
            def generate(self,*args):raise AssertionError('Model must not be called')
        for language in ('fr','',None,True):
            with self.assertRaises(ValueError):analyze(SOURCES,NoCalls(),output_language=language)
        with self.assertRaises(TypeError):analyze(SOURCES,NoCalls())

    def test_translated_quotation_is_rejected(self):
        class TranslatedQuote(FakeModel):
            def generate(self,messages,schema):
                value=super().generate(messages,schema)
                value['sources'][1]['quote']='vertical version'
                return value
        with self.assertRaises(ValueError):analyze(SOURCES,TranslatedQuote(),output_language='en')

    def test_document_language_does_not_override_output_language(self):
        import json
        english_sources=[{'id':'agreement:en','kind':'agreement','text':'One horizontal video is included.'},
                         {'id':'request:en','kind':'request','text':'Add a vertical version.'}]
        class SourceModel:
            def generate(self,messages,schema):
                payload=json.loads(messages[-1]['content'])
                self.payload=payload
                return {'relation':'matches','classification':'possible_extra',
                        'summary':'Revisar el alcance.' if payload['output_language']=='es' else 'Review scope.',
                        'sources':[{'source_id':s['id'],'quote':s['text']} for s in payload['sources']]}
        for sources in (SOURCES,english_sources):
            for language in ('es','en'):
                model=SourceModel();result=analyze(sources,model,output_language=language)
                self.assertEqual(model.payload['sources'],sources)
                self.assertEqual(result['analysis']['summary'],'Revisar el alcance.' if language=='es' else 'Review scope.')
                self.assertEqual([c['quote'] for c in result['analysis']['sources']],[s['text'] for s in sources])
