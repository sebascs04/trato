"""Compact provider references retain host-bound original citations."""
from copy import deepcopy
import json
import unittest
from test_file_pipeline import BackendDouble, ModelDouble
from trato_worker.file_pipeline.contracts import FileManifest, PipelineError
from trato_worker.file_pipeline.evidence import reference_catalog, reference_schema, resolve_reference
from trato_worker.file_pipeline.treatment import PurposeAgent
from trato_worker.file_pipeline.summarize import FileSummarizer


class CompactEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.backend = BackendDouble()
        self.manifest = FileManifest.model_validate(self.backend.manifest)

    def test_source_text_length_does_not_expand_the_provider_schema(self):
        short = reference_catalog([{'segment_id': 'page-1', 'quote': 'Short.'}], 'segment_id')
        long = reference_catalog([{'segment_id': 'page-1', 'quote': 'Long original text ' * 10000}], 'segment_id')
        self.assertEqual(reference_schema(short), reference_schema(long))
        self.assertEqual(resolve_reference({'reference_id': 'r1'}, long, 'segment_id', 'INVALID'),
                         {'segment_id': 'page-1', 'quote': 'Long original text ' * 10000})

    def test_reference_binds_a_quote_to_its_exact_source(self):
        records = [{'segment_id': 'page-1', 'quote': 'Same words.'},
                   {'segment_id': 'page-2', 'quote': 'Same words.'}]
        catalog = reference_catalog(records + [records[0]], 'segment_id')
        self.assertEqual(len(catalog), 2)
        self.assertEqual(resolve_reference({'reference_id': 'r2'}, catalog, 'segment_id', 'INVALID'), records[1])
        for forged in [{'reference_id': 'r3'}, {'reference_id': 'r1', 'segment_id': 'page-2'},
                       {'reference_id': 'r1', 'quote': 'Invented'}, {'reference_id': []}, 'r1']:
            with self.assertRaisesRegex(PipelineError, 'INVALID'):
                resolve_reference(forged, catalog, 'segment_id', 'INVALID')

    def test_treatment_schema_contains_short_refs_and_host_restores_original_quotes(self):
        calls = []
        class Model(ModelDouble):
            def generate(_, messages, schema):
                payload = json.loads(messages[-1]['content']); calls.append((payload, deepcopy(schema)))
                return super().generate(messages, schema)
        result = PurposeAgent(Model(), model_identity='test', maximum_input_bytes=30000).assess(self.manifest, self.backend.extraction)
        payload, schema = calls[0]
        evidence = schema['$defs']['Evidence']
        self.assertEqual(set(evidence['properties']), {'reference_id'})
        self.assertEqual(evidence['properties']['reference_id']['enum'], [r['reference_id'] for r in payload['source_catalog']])
        for record in payload['source_catalog']:
            self.assertNotIn(record['quote'], json.dumps(schema))
        restored = result['assessment']['evidence'][0]
        self.assertEqual(restored['segment_id'], 'page-1')
        self.assertIn(restored['quote'], self.backend.extraction['text'])
        self.assertNotIn('reference_id', restored)

    def test_observation_reference_is_validated_before_accepting_treatment(self):
        class Model(ModelDouble):
            calls = 0
            def generate(self, messages, schema):
                self.calls += 1
                value = super().generate(messages, schema)
                value['observations'] = [{'text': 'Forged claim', 'evidence': [{'reference_id': 'not-a-reference'}]}]
                return value
        model = Model()
        with self.assertRaisesRegex(PipelineError, 'TREATMENT_INVALID_CITATION'):
            PurposeAgent(model, model_identity='test', maximum_input_bytes=30000).assess(self.manifest, self.backend.extraction)
        self.assertEqual(model.calls, 1)

    def test_summary_catalog_is_map_or_reduce_scoped_and_resolves_originals(self):
        summarizer = FileSummarizer(ModelDouble(), model_identity='test', maximum_input_bytes=30000)
        units = [{'chunk_id': 'c1', 'text': 'First source.', 'locator': {'kind': 'page', 'page': 1}},
                 {'chunk_id': 'c2', 'text': 'Second source.', 'locator': {'kind': 'page', 'page': 2}}]
        messages, schema = summarizer.request(self.manifest, 'map', units)
        catalog = json.loads(messages[-1]['content'])['source_catalog']
        self.assertEqual(set(schema['properties']['citations']['items']['properties']), {'reference_id'})
        self.assertNotIn('First source.', json.dumps(schema))
        self.assertEqual(resolve_reference({'reference_id': 'r2'}, catalog, 'chunk_id', 'INVALID'),
                         {'chunk_id': 'c2', 'quote': 'Second source.'})
        reduced = [{'summary': 'Orientation', 'topics': ['Sources'],
                    'citations': [{'chunk_id': 'c2', 'quote': 'Second source.'}]}]
        reduce_messages, _ = summarizer.request(self.manifest, 'reduce', reduced)
        reduce_catalog = json.loads(reduce_messages[-1]['content'])['source_catalog']
        self.assertEqual(reduce_catalog, [{'reference_id': 'r1', 'chunk_id': 'c2', 'quote': 'Second source.'}])

    def test_summary_rejects_fabricated_reference_without_another_model_call(self):
        class Model:
            calls = 0
            def generate(self, messages, schema):
                self.calls += 1
                return {'summary': 'Unsupported', 'topics': ['Topic'], 'citations': [{'reference_id': 'unknown'}]}
        model = Model()
        chunks = {'source_fingerprint': 'a'*64, 'policy_fingerprint': 'b'*64,
                  'chunks': [{'chunk_id': 'c1', 'text': 'Original text.', 'locator': {'kind': 'page', 'page': 1}}]}
        with self.assertRaisesRegex(PipelineError, 'SUMMARY_INVALID_CITATION'):
            FileSummarizer(model, model_identity='test', maximum_input_bytes=30000).summarize(self.manifest, chunks)
        self.assertEqual(model.calls, 1)

    def test_changed_purpose_criteria_preserve_previous_treatment_artifact(self):
        from unittest.mock import patch
        from trato_worker.file_pipeline.treatment import CRITERIA
        agent = PurposeAgent(ModelDouble(), model_identity='test', maximum_input_bytes=30000)
        before = agent.assess(self.manifest, self.backend.extraction)
        with patch.dict(CRITERIA, {self.manifest.purpose: CRITERIA[self.manifest.purpose] + ' Revised rule.'}):
            after = agent.assess(self.manifest, self.backend.extraction)
        self.assertNotEqual(before['prompt_fingerprint'], after['prompt_fingerprint'])
        self.assertEqual(before['assessment'], after['assessment'])

    def test_refund_proposal_can_be_prepared_in_its_declared_reference_role(self):
        from hashlib import sha256
        manifest = self.manifest.model_copy(update={'purpose': 'supporting_reference'})
        extraction = deepcopy(self.backend.extraction)
        text = 'Propuesta de cierre. Devolución propuesta: USD 120.'
        extraction.update(text=text, text_sha256=sha256(text.encode()).hexdigest())
        extraction['segments'][0]['text'] = text
        class Model(ModelDouble):
            def generate(_, messages, schema):
                payload = json.loads(messages[-1]['content'])
                self.assertEqual(payload['purpose'], 'supporting_reference')
                self.assertIn('refund requests or proposals', payload['purpose_criteria'])
                return super().generate(messages, schema)
        result = PurposeAgent(Model(), model_identity='test', maximum_input_bytes=30000).assess(manifest, extraction)
        self.assertEqual(result['decision'], 'continue')
        self.assertEqual(result['assessment']['detected_category'], 'supporting_reference')
        self.assertIn(result['assessment']['evidence'][0]['quote'], text)

    def test_sandbox_agreement_is_assessed_for_content_without_claiming_authenticity(self):
        from hashlib import sha256
        manifest = self.manifest.model_copy(update={'purpose': 'initial_agreement'})
        extraction = deepcopy(self.backend.extraction)
        text = 'PRUEBA SANDBOX - ACUERDO FICTICIO PARA ENSAYO. Alcance: diseñar cinco páginas. Este documento no acredita un contrato ni un pago real.'
        extraction.update(text=text, text_sha256=sha256(text.encode()).hexdigest())
        extraction['segments'][0]['text'] = text
        class Model(ModelDouble):
            def generate(_, messages, schema):
                payload = json.loads(messages[-1]['content'])
                self.assertIn('not its legal validity or authenticity', payload['purpose_criteria'])
                self.assertIn('Preserve its fictional/test status', payload['purpose_criteria'])
                self.assertEqual(payload['segments'][0]['text'], text)
                value = super().generate(messages, schema)
                value['reason'] = 'El acuerdo ficticio describe un alcance de prueba, sin acreditar un contrato real.'
                return value
        result = PurposeAgent(Model(), model_identity='test', maximum_input_bytes=30000).assess(manifest, extraction)
        self.assertEqual(result['decision'], 'continue')
        self.assertIn('ficticio', result['reason'])
        self.assertIn(result['assessment']['evidence'][0]['quote'], text)
