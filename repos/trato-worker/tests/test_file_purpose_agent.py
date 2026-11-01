"""Semantic-contract tests with explicit model doubles; no runtime fixtures."""
import json
import unittest
from copy import deepcopy
from uuid import uuid4
from pydantic import ValidationError
from test_file_pipeline import BackendDouble, ModelDouble
from trato_worker.file_pipeline.contracts import FileManifest, PipelineError, PURPOSES
from trato_worker.file_pipeline.pipeline import FilePipeline
from trato_worker.file_pipeline.treatment import PurposeAgent
from trato_worker.file_pipeline.summarize import FileSummarizer
from trato_worker.file_pipeline.embeddings import TRATO_EMBEDDING_PROFILE, TRATO_CHUNK_POLICY, validate_query_space


class ControlledModel(ModelDouble):
    def __init__(self, mutate=None): self.mutate, self.calls = mutate, []
    def generate(self, messages, schema):
        payload = json.loads(messages[-1]['content']); self.calls.append(payload)
        result = super().generate(messages, schema)
        if 'segments' in payload and self.mutate: self.mutate(result)
        return result


class FilePurposeTests(unittest.TestCase):
    def build(self, purpose='initial_agreement', mutate=None, bindings=True):
        backend = BackendDouble()
        backend.thread['payload']['purpose'] = purpose
        backend.manifest['purpose'] = purpose
        if purpose == 'training_material':
            backend.manifest['access'] = {'visibility': 'training_library', 'library_id': 'trato-training'}
        elif purpose == 'reputation_evidence':
            backend.manifest['access'] = {'visibility': 'reputation_published',
                                         'community_client_id': str(uuid4()), 'review_id': str(uuid4())}
        if bindings:
            backend.manifest['bindings'] = {k: str(uuid4()) for k in ('request_id', 'revision_id', 'payment_id', 'refund_case_id')}
        model = ControlledModel(mutate)
        agent = PurposeAgent(model, model_identity='test-only', maximum_input_bytes=30000)
        pipeline = FilePipeline(backend, FileSummarizer(model, model_identity='test-only', maximum_input_bytes=30000),
                                enabled_purposes=(purpose,), handlers=agent.handlers((purpose,)),
                                chunk_policy=TRATO_CHUNK_POLICY, embedding_profile=TRATO_EMBEDDING_PROFILE)
        return backend, pipeline, model

    def test_every_registered_purpose_rejoins_common_flow(self):
        for purpose in sorted(PURPOSES):
            with self.subTest(purpose=purpose):
                backend, pipeline, model = self.build(purpose)
                result = pipeline.run(backend.thread)
                self.assertEqual(result['action'], 'completed', result)
                self.assertEqual(model.calls[0]['purpose'], purpose)
                self.assertEqual(backend.projections[0]['document']['properties']['purpose'], purpose)

    def test_rejected_file_keeps_assessment_but_has_no_chunks_or_index(self):
        def unrelated(result): result.update(relevance='unrelated', detected_category='other')
        backend, pipeline, model = self.build(mutate=unrelated)
        result = pipeline.run(backend.thread)['result']
        self.assertEqual(result['status'], 'rejected')
        self.assertEqual(set(result['artifacts']), {'extraction', 'treatment'})
        self.assertEqual(backend.projections, [])
        self.assertEqual(len(model.calls), 1)

    def test_unclear_file_pauses_without_fabricating_a_summary(self):
        def unclear(result): result.update(relevance='unclear', detected_category='unclear',
                                          clarification_questions=['¿A qué acuerdo corresponde?'])
        backend, pipeline, model = self.build(mutate=unclear)
        result = pipeline.run(backend.thread)['result']
        self.assertEqual(result['status'], 'needs_clarification')
        self.assertNotIn('summary', result['artifacts'])
        self.assertEqual(len(model.calls), 1)

    def test_wrong_binding_pauses_before_model(self):
        backend, pipeline, model = self.build('addendum_adjustments', bindings=False)
        result = pipeline.run(backend.thread)['result']
        self.assertEqual(result['status'], 'needs_clarification')
        self.assertEqual(result['treatment']['missing_bindings'], ['request_id', 'revision_id'])
        self.assertEqual(model.calls, [])

    def test_fabricated_quote_fails_without_summary_or_retry(self):
        def fabricated(result): result['evidence'][0]['quote'] = 'This quote does not exist.'
        backend, pipeline, model = self.build(mutate=fabricated)
        result = pipeline.run(backend.thread)['result']
        self.assertEqual(result['error_code'], 'TREATMENT_INVALID_CITATION')
        self.assertEqual(backend.projections, [])
        self.assertEqual(len(model.calls), 1)

    def test_contradictory_category_is_error_not_automatic_reclassification(self):
        def contradictory(result): result['detected_category'] = 'change_request'
        backend, pipeline, model = self.build(mutate=contradictory)
        result = pipeline.run(backend.thread)['result']
        self.assertEqual(result['error_code'], 'TREATMENT_INCONSISTENT_RESPONSE')
        self.assertEqual(len(model.calls), 1)

    def test_language_is_explicit_and_quotes_are_original(self):
        for language in ('es', 'en'):
            backend, pipeline, model = self.build()
            backend.manifest['output_language'] = language
            self.assertEqual(pipeline.run(backend.thread)['action'], 'completed')
            self.assertTrue(all(payload['output_language'] == language for payload in model.calls))

    def test_published_reputation_projection_has_no_private_owner_or_project(self):
        backend, pipeline, _ = self.build('reputation_evidence')
        pipeline.run(backend.thread)
        serialized = json.dumps(backend.projections)
        for private_id in backend.thread['context'].values(): self.assertNotIn(private_id, serialized)
        self.assertNotIn('owner_id', serialized)
        self.assertNotIn('project_id', serialized)

    def test_withdrawal_during_treatment_prevents_artifact_write_and_index(self):
        backend, pipeline, model = self.build()
        def withdraw(_): backend.manifest['source_version'] = 'withdrawn'
        model.mutate = withdraw
        result = pipeline.run(backend.thread)['result']
        self.assertEqual(result['error_code'], 'FILE_SCOPE_CHANGED')
        self.assertEqual(set(result['artifacts']), {'extraction'})
        self.assertEqual(backend.projections, [])

    def test_full_input_exceeds_context_is_error_without_a_model_call(self):
        backend, _, model = self.build()
        extraction = deepcopy(backend.extraction)
        extraction['segments'][0]['text'] *= 400
        agent = PurposeAgent(model, model_identity='test-only', maximum_input_bytes=12000)
        with self.assertRaisesRegex(PipelineError, 'TREATMENT_CONTEXT_LIMIT'):
            agent.assess(FileManifest.model_validate(backend.manifest), extraction)
        self.assertEqual(model.calls, [])

    def test_handler_cannot_accept_a_different_purpose(self):
        backend, _, model = self.build()
        agent = PurposeAgent(model, model_identity='test-only', maximum_input_bytes=12000)
        with self.assertRaisesRegex(PipelineError, 'FILE_PURPOSE_HANDLER_MISMATCH'):
            agent.handler('change_request')(FileManifest.model_validate(backend.manifest), backend.extraction)
        self.assertEqual(model.calls, [])

    def test_query_and_document_embedding_profiles_must_match(self):
        result = validate_query_space(TRATO_EMBEDDING_PROFILE, TRATO_EMBEDDING_PROFILE, '¿Qué se acordó?')
        self.assertEqual(result['embedding_profile']['dimensions'], 1024)
        other = {**TRATO_EMBEDDING_PROFILE, 'maximum_text_bytes': 2000}
        with self.assertRaisesRegex(PipelineError, 'EMBEDDING_PROFILE_MISMATCH'):
            validate_query_space(TRATO_EMBEDDING_PROFILE, other, 'Entrega')
        with self.assertRaises(ValidationError):
            validate_query_space(TRATO_EMBEDDING_PROFILE, {**TRATO_EMBEDDING_PROFILE, 'dimensions': 768}, 'Entrega')
        with self.assertRaisesRegex(PipelineError, 'EMBEDDING_INPUT_LIMIT'):
            validate_query_space(TRATO_EMBEDDING_PROFILE, TRATO_EMBEDDING_PROFILE, 'é'*3000)


class SummaryIntegrityTests(unittest.TestCase):
    def test_hierarchical_summary_covers_every_chunk(self):
        from file_processor.chunking import chunk_file
        backend = BackendDouble()
        manifest = FileManifest.model_validate(backend.manifest)
        payload = {'schema_version': 1, 'file_id': manifest.file_id, 'source_fingerprint': 'c'*64,
                   'policy': {'version':'v1','max_chars':800,'overlap_chars':100,'max_chunks':512},
                   'segments': [{'segment_id':'page-1','locator':{'kind':'page','page':1},
                                 'text':'Entregar una web con cinco secciones. '*900}]}
        chunks=chunk_file(payload); model=ControlledModel()
        summary=FileSummarizer(model,model_identity='test-only',maximum_input_bytes=14000).summarize(manifest,chunks)
        self.assertGreater(summary['coverage']['calls']['map'],1)
        self.assertGreater(summary['coverage']['calls']['reduce'],0)
        self.assertEqual(summary['coverage']['processed_chunk_ids'],[c['chunk_id'] for c in chunks['chunks']])
        mapped=[unit['chunk_id'] for call in model.calls if call['stage']=='map' for unit in call['units']]
        self.assertEqual(mapped,summary['coverage']['processed_chunk_ids'])

    def test_invalid_cached_summary_fails_without_generating_a_replacement(self):
        backend,pipeline,model=FilePurposeTests().build()
        self.assertEqual(pipeline.run(backend.thread)['action'],'completed')
        for (stage,key),artifact in backend.artifacts.items():
            if stage=='summary': artifact['summary']='An altered cached value.'
        model.calls.clear(); backend.projections.clear()
        result=pipeline.run(backend.thread)['result']
        self.assertEqual(result['error_code'],'FILE_SUMMARY_INVALID')
        self.assertEqual(len(model.calls),1)  # Treatment only; no summary fallback.
        self.assertEqual(backend.projections,[])

    def test_summary_call_budget_is_a_visible_error(self):
        from file_processor.chunking import chunk_file
        backend=BackendDouble(); manifest=FileManifest.model_validate(backend.manifest)
        chunks=chunk_file({'schema_version':1,'file_id':manifest.file_id,'source_fingerprint':'c'*64,
                         'policy':TRATO_CHUNK_POLICY,'segments':[{'segment_id':'page-1',
                         'locator':{'kind':'page','page':1},'text':'Documento con múltiples entregables. '*900}]})
        model=ControlledModel()
        with self.assertRaisesRegex(PipelineError,'SUMMARY_CALL_LIMIT'):
            FileSummarizer(model,model_identity='test-only',maximum_input_bytes=14000,
                           maximum_calls=1).summarize(manifest,chunks)
        self.assertEqual(len(model.calls),1)
