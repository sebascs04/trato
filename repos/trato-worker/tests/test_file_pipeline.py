"""Explicit test doubles; never activated as a runtime fallback."""
import json
import unittest
from copy import deepcopy
from hashlib import sha256
from uuid import uuid4
from file_processor.chunking import chunk_file
from trato_worker.file_pipeline.contracts import FileManifest, fingerprint
from trato_worker.file_pipeline.pipeline import FilePipeline
from trato_worker.file_pipeline.summarize import FileSummarizer
from trato_worker.file_pipeline.treatment import PurposeAgent
from trato_worker.file_pipeline.embeddings import TRATO_EMBEDDING_PROFILE


class ModelDouble:
    def generate(self, messages, schema):
        payload = json.loads(messages[-1]['content'])
        if 'segments' in payload:
            segment = payload['segments'][0]
            return {'detected_category': payload['expected_category'], 'relevance': 'supported',
                    'reason': 'El texto describe lo acordado.',
                    'evidence': [{'segment_id': segment['segment_id'], 'quote': schema['$defs']['Evidence']['properties']['quote']['enum'][0]}],
                    'observations': [], 'clarification_questions': []}
        unit = payload['units'][0]
        citation = ({'chunk_id': unit['chunk_id'], 'quote': schema['properties']['citations']['items']['properties']['quote']['enum'][0]}
                    if payload['stage'] == 'map' else unit['citations'][0])
        return {'summary': 'Acuerdo sobre una web y sus entregables.',
                'topics': ['Entregables'], 'citations': [citation]}


class BackendDouble:
    def __init__(self):
        context = {key: str(uuid4()) for key in ('owner_id', 'client_id', 'project_id')}
        self.thread = {'type': 'thread', 'schema_version': 1, 'mode': 'connected',
                       'workflow': 'process_file', 'action': 'start', 'thread_id': str(uuid4()),
                       'event_id': str(uuid4()), 'context': context,
                       'payload': {'file_id': str(uuid4()), 'purpose': 'initial_agreement',
                                   'source_sha256': 'a' * 64}}
        self.manifest = {key: deepcopy(self.thread[key]) for key in ('thread_id', 'event_id', 'context')}
        self.manifest.update(self.thread['payload'])
        self.manifest.update(lease_id=str(uuid4()), source_version='1', selection_fingerprint='b'*64,
                             access={'visibility': 'project_private', **context}, filename='acuerdo.pdf',
                             output_language='es', bindings={})
        self.manifest = FileManifest.model_validate(self.manifest).model_dump()
        text = 'Diseñar una web con cinco secciones. Entregar primero el diseño y después la implementación.'
        self.extraction = {'schema_version': 1, 'source_sha256': 'a'*64, 'parser': 'test',
                           'parser_version': '1', 'text': text, 'text_sha256': sha256(text.encode()).hexdigest(),
                           'segments': [{'segment_id': 'page-1', 'locator': {'kind': 'page', 'page': 1}, 'text': text}]}
        self.projections, self.artifacts = [], {}
        self.partial = False

    def authorize(self, thread): return deepcopy(self.manifest)
    def revalidate(self, manifest): return deepcopy(self.manifest)
    def extract(self, manifest): return deepcopy(self.extraction)
    def chunks(self, manifest, extraction, policy):
        return chunk_file({'schema_version': 1, 'file_id': manifest['file_id'],
                           'source_fingerprint': extraction['source_fingerprint'], 'policy': policy,
                           'segments': extraction['segments']})
    def load_artifact(self, manifest, stage, cache_key):
        return deepcopy(self.artifacts.get((stage, cache_key)))
    def store_artifact(self, manifest, stage, cache_key, artifact):
        self.artifacts[(stage, cache_key)] = deepcopy(artifact)
        return {'stage': stage, 'cache_key': cache_key, 'artifact_fingerprint': fingerprint(artifact)}
    def publish_projection(self, manifest, projection):
        self.projections.append(deepcopy(projection))
        return {'file_id': manifest['file_id'], 'projection_fingerprint': projection['projection_fingerprint'],
                'document_count': 1, 'chunk_count': 0 if self.partial else len(projection['chunks'])}


class FilePipelineTests(unittest.TestCase):
    def setUp(self): self.backend = BackendDouble()

    def pipeline(self, embedding=TRATO_EMBEDDING_PROFILE):
        return FilePipeline(self.backend, FileSummarizer(ModelDouble(), model_identity='explicit-test-model',
                            maximum_input_bytes=16000), enabled_purposes=('initial_agreement',),
                            handlers=PurposeAgent(ModelDouble(), model_identity='explicit-test-model',
                                                  maximum_input_bytes=20000).handlers(('initial_agreement',)),
                            chunk_policy={'version': 'v1', 'max_chars': 64, 'overlap_chars': 8, 'max_chunks': 100},
                            embedding_profile=embedding)

    def test_complete_graph_preserves_state_and_chunk_only_ranking(self):
        result = self.pipeline().run(self.backend.thread)
        self.assertEqual(result['action'], 'completed')
        self.assertEqual(result['result']['status'], 'processed')
        self.assertEqual(len(result['result']['stages']), 6)
        projection = self.backend.projections[0]
        self.assertEqual(projection['chunk_vector_properties'], ['chunk_text'])
        self.assertEqual(projection['chunk_lexical_properties'], ['chunk_text'])
        self.assertNotIn('chunk_text', json.dumps(result))

    def test_missing_embedding_keeps_prior_artifacts_and_fails_index(self):
        result = self.pipeline(None).run(self.backend.thread)['result']
        self.assertEqual(result['error_code'], 'EMBEDDING_NOT_CONFIGURED')
        self.assertEqual(result['stages']['summary']['status'], 'ready')
        self.assertEqual(set(result['artifacts']), {'extraction', 'treatment', 'chunks', 'summary'})
        self.assertEqual(self.backend.projections, [])

    def test_partial_index_is_not_success(self):
        self.backend.partial = True
        result = self.pipeline().run(self.backend.thread)
        self.assertEqual(result['action'], 'failed')
        self.assertEqual(result['result']['error_code'], 'FILE_INDEX_INCOMPLETE')

    def test_forged_thread_context_cannot_read_file(self):
        self.backend.thread['context']['owner_id'] = str(uuid4())
        result = self.pipeline().run(self.backend.thread)['result']
        self.assertEqual(result['error_code'], 'FILE_THREAD_CONTEXT_CONFLICT')
        self.assertEqual(self.backend.artifacts, {})

    def test_bad_source_hash_cannot_be_summarized_or_indexed(self):
        self.backend.extraction['source_sha256'] = 'c'*64
        result = self.pipeline().run(self.backend.thread)['result']
        self.assertEqual(result['error_code'], 'FILE_EXTRACTION_INVALID')
        self.assertEqual(self.backend.projections, [])

    def test_repeat_processing_has_deterministic_projection(self):
        pipeline = self.pipeline()
        pipeline.run(self.backend.thread)
        pipeline.run(self.backend.thread)
        self.assertEqual(self.backend.projections[0], self.backend.projections[1])


if __name__ == '__main__': unittest.main()
