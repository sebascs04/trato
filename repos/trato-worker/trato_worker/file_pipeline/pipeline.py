"""One LangGraph file workflow with registered purpose branches and shared stages.

All IO passes through a required backend port. This module opens no original,
Storage bucket or vector database and has no administrative credentials.
"""
from copy import deepcopy
from hashlib import sha256
import re
from typing import Protocol
from uuid import uuid4
from langgraph.graph import StateGraph, START, END
from langsmith import tracing_context
from .contracts import FileThread, FileManifest, Treatment, PipelineError, POLICIES, fingerprint, canonical_id
from .projection import make_projection
from .summarize import PROMPT


class BackendPort(Protocol):
    def authorize(self, thread: dict) -> dict: ...
    def revalidate(self, manifest: dict) -> dict: ...
    def extract(self, manifest: dict) -> dict: ...
    def chunks(self, manifest: dict, extraction: dict, policy: dict) -> dict: ...
    def load_artifact(self, manifest: dict, stage: str, cache_key: str) -> dict | None: ...
    def store_artifact(self, manifest: dict, stage: str, cache_key: str, artifact: dict) -> dict: ...
    def publish_projection(self, manifest: dict, projection: dict) -> dict: ...


def validate_extraction(value, manifest):
    try:
        if (value['schema_version'] != 1 or value['source_sha256'] != manifest.source_sha256
            or not isinstance(value['parser'], str) or not value['parser']
            or not isinstance(value['parser_version'], str) or not value['parser_version']): raise ValueError()
        segments = value['segments']
        if not isinstance(segments, list) or not 1 <= len(segments) <= 4096: raise ValueError()
        ids, total = set(), 0
        for segment in segments:
            sid, text, locator = segment['segment_id'], segment['text'], segment['locator']
            if not isinstance(sid, str) or not 1 <= len(sid) <= 100 or sid in ids or not isinstance(text, str) or not text.strip(): raise ValueError()
            ids.add(sid); total += len(text.encode())
            if not isinstance(locator, dict): raise ValueError()
            kind = locator.get('kind')
            if kind in ('page', 'paragraph'):
                if set(locator) != {'kind', kind} or type(locator[kind]) is not int or locator[kind] < 1: raise ValueError()
            elif kind == 'section':
                if set(locator) != {'kind', 'section'} or not isinstance(locator['section'], str) or not 1 <= len(locator['section']) <= 300: raise ValueError()
            else: raise ValueError()
        if total > 250000 or value['text'] != '\n\n'.join(s['text'] for s in segments): raise ValueError()
        if value['text_sha256'] != sha256(value['text'].encode()).hexdigest(): raise ValueError()
        return value
    except (KeyError, TypeError, ValueError, AttributeError):
        raise PipelineError('FILE_EXTRACTION_INVALID') from None


def validate_chunks(value, manifest, extraction, policy, source_fingerprint):
    try:
        if (value['schema_version'] != 1 or value['file_id'] != manifest.file_id
            or value['source_fingerprint'] != source_fingerprint or value['policy_fingerprint'] != fingerprint(policy)
            or value['offset_unit'] != 'unicode_code_points' or not isinstance(value['chunks'], list)
            or not 1 <= len(value['chunks']) <= policy['max_chunks']): raise ValueError()
        segments = {s['segment_id']: s for s in extraction['segments']}
        ids, coverage = set(), {sid: [] for sid in segments}
        for chunk in value['chunks']:
            cid, sid = chunk['chunk_id'], chunk['segment_id']; canonical_id(cid)
            if cid in ids or sid not in segments: raise ValueError()
            ids.add(cid); segment = segments[sid]; a, b = chunk['start_char'], chunk['end_char']
            if (type(a) is not int or type(b) is not int or not 0 <= a < b <= len(segment['text'])
                or b-a > policy['max_chars'] or chunk['locator'] != segment['locator']
                or chunk['text'] != segment['text'][a:b] or not chunk['text'].strip()
                or chunk['text_sha256'] != sha256(chunk['text'].encode()).hexdigest()): raise ValueError()
            coverage[sid].append((a,b))
        # A lost segment/window must fail, not silently become an incomplete index.
        for sid, spans in coverage.items():
            end = 0; text = segments[sid]['text']
            for a,b in sorted(spans):
                if a > end and text[end:a].strip(): raise ValueError()
                end = max(end,b)
            if text[end:].strip(): raise ValueError()
        return value
    except (KeyError, TypeError, ValueError, AttributeError):
        raise PipelineError('FILE_CHUNKS_INVALID') from None


class FilePipeline:
    def __init__(self, backend: BackendPort, summarizer, *, enabled_purposes, handlers,
                 chunk_policy, embedding_profile):
        if (not isinstance(enabled_purposes, tuple) or not enabled_purposes
            or len(set(enabled_purposes)) != len(enabled_purposes)
            or any(p not in POLICIES for p in enabled_purposes)
            or set(handlers) != set(enabled_purposes) or any(not callable(h) for h in handlers.values())):
            raise PipelineError('FILE_PURPOSE_CONFIGURATION_INVALID')
        try:
            if (set(chunk_policy) != {'version','max_chars','overlap_chars','max_chunks'}
                or not re.fullmatch('[a-z0-9_-]{1,40}', chunk_policy['version'])
                or any(type(chunk_policy[k]) is not int for k in ('max_chars','overlap_chars','max_chunks'))
                or not 32 <= chunk_policy['max_chars'] <= 16000
                or not 0 <= chunk_policy['overlap_chars'] <= 4000
                or chunk_policy['overlap_chars'] >= chunk_policy['max_chars']
                or not 1 <= chunk_policy['max_chunks'] <= 10000): raise ValueError()
        except (KeyError, TypeError, ValueError): raise PipelineError('CHUNK_POLICY_INVALID') from None
        self.backend, self.summarizer = backend, summarizer
        self.enabled, self.handlers = enabled_purposes, dict(handlers)
        self.policy, self.embedding_profile = deepcopy(chunk_policy), deepcopy(embedding_profile)

    def run(self, raw, on_progress=None):
        try: thread = FileThread.model_validate(raw)
        except (TypeError, ValueError): raise PipelineError('INVALID_FILE_THREAD') from None
        if thread.payload.purpose not in self.enabled: raise PipelineError('FILE_PURPOSE_NOT_ENABLED')
        graph = StateGraph(dict)

        def fresh(manifest):
            current = FileManifest.model_validate(self.backend.revalidate(manifest.model_dump()))
            if current != manifest: raise PipelineError('FILE_SCOPE_CHANGED')

        def store(manifest, stage, cache_key, artifact):
            fresh(manifest)
            receipt = self.backend.store_artifact(manifest.model_dump(), stage, cache_key, deepcopy(artifact))
            if receipt != {'stage': stage, 'cache_key': cache_key, 'artifact_fingerprint': fingerprint(artifact)}:
                raise PipelineError('FILE_PERSISTENCE_UNCONFIRMED')
            return receipt

        def guarded(stage, operation):
            def node(state):
                stages = deepcopy(state.get('stages', {})); stages[stage] = {'status': 'processing'}
                try:
                    if on_progress: on_progress({'thread_id': thread.thread_id, 'phase': stage, 'status': 'processing'})
                    result = operation(state)
                    stages[stage] = {'status': 'ready', **result.pop('_stage', {})}
                    return {**state, **result, 'phase': stage, 'stages': stages}
                except Exception as error:
                    code = getattr(error, 'code', 'FILE_PIPELINE_FAILED')
                    if not isinstance(code, str) or not re.fullmatch('[A-Z_0-9]{1,80}', code): code = 'FILE_PIPELINE_FAILED'
                    stages[stage] = {'status': 'error', 'error_code': code}
                    return {**state, 'status': 'error', 'phase': stage, 'error_code': code, 'stages': stages}
            return node

        def authorize(_):
            manifest = FileManifest.model_validate(self.backend.authorize(thread.model_dump()))
            if not manifest.matches(thread): raise PipelineError('FILE_THREAD_CONTEXT_CONFLICT')
            return {'manifest': manifest, 'status': 'processing', 'artifacts': {}}

        def extract(state):
            manifest = state['manifest']; fresh(manifest)
            value = validate_extraction(self.backend.extract(manifest.model_dump()), manifest)
            key = fingerprint([manifest.input_fingerprint(), value['parser'], value['parser_version'], value['segments']])
            receipt = store(manifest, 'extraction', key, value)
            return {'extraction': value, 'source_fingerprint': key, 'artifacts': {**state['artifacts'], 'extraction': receipt}}

        def specialize(state):
            manifest = state['manifest']; fresh(manifest)
            policy = POLICIES[manifest.purpose]
            missing = [name for name in policy.required_bindings if name not in manifest.bindings]
            if missing:
                return {'status': 'needs_clarification', 'treatment': {'decision': 'needs_clarification',
                        'reason': 'PURPOSE_BINDING_REQUIRED', 'missing_bindings': missing, 'human_review_required': True}}
            treatment = Treatment.model_validate(self.handlers[manifest.purpose](manifest.model_copy(deep=True), deepcopy(state['extraction'])))
            value = treatment.model_dump()
            from .treatment import CATEGORIES
            by_id = {segment['segment_id']: segment['text'] for segment in state['extraction']['segments']}
            if value['coverage'] != {'status': 'all_segments_processed', 'segment_ids': list(by_id)}:
                raise PipelineError('TREATMENT_COVERAGE_INVALID')
            refs = [*treatment.assessment.evidence, *(ref for obs in treatment.assessment.observations for ref in obs.evidence)]
            if any(ref.segment_id not in by_id or ref.quote not in by_id[ref.segment_id] for ref in refs):
                raise PipelineError('TREATMENT_INVALID_CITATION')
            if treatment.decision == 'continue' and treatment.assessment.detected_category != CATEGORIES[manifest.purpose]:
                raise PipelineError('TREATMENT_INCONSISTENT_RESPONSE')
            key = fingerprint([state['source_fingerprint'], manifest.purpose, manifest.output_language,
                               treatment.model_identity, treatment.prompt_fingerprint])
            receipt = store(manifest, 'treatment', key, value)
            # Full observations/citations stay in authorized canonical storage, not the queue envelope.
            brief = {k: value[k] for k in ('decision', 'reason', 'human_review_required')}
            brief['detected_category'] = treatment.assessment.detected_category
            return {'treatment': brief, 'artifacts': {**state['artifacts'], 'treatment': receipt},
                    'status': 'processing' if treatment.decision == 'continue' else treatment.decision}

        def chunk(state):
            manifest = state['manifest']; fresh(manifest)
            extraction = {**state['extraction'], 'source_fingerprint': state['source_fingerprint']}
            value = validate_chunks(self.backend.chunks(manifest.model_dump(), extraction, self.policy),
                                    manifest, state['extraction'], self.policy, state['source_fingerprint'])
            receipt = store(manifest, 'chunks', fingerprint([state['source_fingerprint'], self.policy]), value)
            return {'chunks': value, 'artifacts': {**state['artifacts'], 'chunks': receipt}}

        def summarize(state):
            manifest = state['manifest']; fresh(manifest)
            key = fingerprint([state['source_fingerprint'], state['chunks']['policy_fingerprint'],
                               self.summarizer.model_identity, fingerprint(PROMPT), manifest.output_language])
            value = self.backend.load_artifact(manifest.model_dump(), 'summary', key)
            if value is None: value = self.summarizer.summarize(manifest, state['chunks'])
            self.validate_summary(value, manifest, state['chunks'])
            receipt = store(manifest, 'summary', key, value)
            return {'summary': value, 'artifacts': {**state['artifacts'], 'summary': receipt}}

        def index(state):
            manifest = state['manifest']; fresh(manifest)
            projection = make_projection(manifest, state['chunks'], state['summary'], embedding_profile=self.embedding_profile)
            # Backend must revalidate and atomically activate exactly this generation;
            # partial batch writes must not become searchable as a complete document.
            receipt = self.backend.publish_projection(manifest.model_dump(), projection)
            expected = {'file_id': manifest.file_id, 'projection_fingerprint': projection['projection_fingerprint'],
                        'document_count': 1, 'chunk_count': len(projection['chunks'])}
            if receipt != expected: raise PipelineError('FILE_INDEX_INCOMPLETE')
            fresh(manifest)
            return {'status': 'processed', 'artifacts': {**state['artifacts'], 'index': receipt}}

        operations = {'authorize': authorize, 'extract': extract, 'chunk': chunk, 'summary': summarize, 'index': index}
        for name, function in operations.items(): graph.add_node(name, guarded(name, function))
        for purpose in self.enabled: graph.add_node('purpose_' + purpose, guarded('treatment', specialize))
        graph.add_edge(START, 'authorize')
        proceed = lambda state: state.get('status') == 'processing'
        graph.add_conditional_edges('authorize', lambda s: 'extract' if proceed(s) else END)
        graph.add_conditional_edges('extract', lambda s: 'purpose_' + s['manifest'].purpose if proceed(s) else END)
        for purpose in self.enabled: graph.add_conditional_edges('purpose_' + purpose, lambda s: 'chunk' if proceed(s) else END)
        graph.add_conditional_edges('chunk', lambda s: 'summary' if proceed(s) else END)
        graph.add_conditional_edges('summary', lambda s: 'index' if proceed(s) else END)
        graph.add_edge('index', END)
        with tracing_context(enabled=False): state = graph.compile().invoke({})
        result = {k: state[k] for k in ('status', 'phase', 'stages', 'artifacts', 'error_code', 'treatment') if k in state}
        result['file_id'] = thread.payload.file_id
        return {'type': 'thread', 'schema_version': 1, 'mode': 'connected', 'workflow': 'process_file',
                'thread_id': thread.thread_id, 'event_id': str(uuid4()), 'causation_id': thread.event_id,
                'context': thread.context.model_dump(exclude_none=True),
                'lease_id': state['manifest'].lease_id if 'manifest' in state else None,
                'action': 'completed' if result['status']=='processed' else 'failed' if result['status']=='error' else 'paused',
                'result': result}

    def validate_summary(self, value, manifest, chunks):
        try:
            from .contracts import SummaryContent
            SummaryContent.model_validate({k: value[k] for k in ('summary','topics','citations')})
            expected = {c['chunk_id']: c for c in chunks['chunks']}
            if (value['schema_version'] != 1 or value['file_id'] != manifest.file_id
                or value['output_language'] != manifest.output_language
                or value['source_fingerprint'] != chunks['source_fingerprint']
                or value['policy_fingerprint'] != chunks['policy_fingerprint']
                or value['model_identity'] != self.summarizer.model_identity or value['prompt_fingerprint'] != fingerprint(PROMPT)
                or value['summary_fingerprint'] != fingerprint({k:v for k,v in value.items() if k!='summary_fingerprint'})
                or value['coverage']['status'] != 'all_chunks_processed'
                or value['coverage']['total_chunks'] != len(expected)
                or value['coverage']['processed_chunk_ids'] != list(expected)): raise ValueError()
            if any(ref['chunk_id'] not in expected or ref['quote'] not in expected[ref['chunk_id']]['text'] for ref in value['citations']): raise ValueError()
        except (KeyError, TypeError, ValueError): raise PipelineError('FILE_SUMMARY_INVALID') from None
