"""First workflow: document ingestion. Explicit simulation, no generative model."""
from hashlib import sha256
from typing import Annotated, Literal, TypedDict
from uuid import UUID, uuid5, NAMESPACE_URL
import operator

from langchain_core.runnables import RunnableLambda
from langgraph.graph import END, START, StateGraph
from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)


class Context(StrictModel):
    owner_id: str
    client_id: str
    project_id: str

    @model_validator(mode='after')
    def ids(self):
        for value in (self.owner_id, self.client_id, self.project_id):
            if str(UUID(value)) != value:
                raise ValueError('El contexto requiere UUID canónicos.')
        return self


class DocumentInput(StrictModel):
    document_id: str
    extraction_id: str
    filename: str = Field(min_length=1, max_length=255)
    kind: Literal['initial_agreement', 'email_request', 'reference']
    fixture_id: Literal['initial_agreement', 'new_request', 'unrelated_document', 'unclear_document', 'unreadable']
    project_brief: str = Field(min_length=3, max_length=2000)
    baseline_revision_id: str | None = None

    @model_validator(mode='after')
    def metadata(self):
        for value in (self.document_id, self.extraction_id, *([self.baseline_revision_id] if self.baseline_revision_id else [])):
            if str(UUID(value)) != value:
                raise ValueError('El documento y su extracción requieren UUID canónicos.')
        if not self.filename.lower().endswith(('.pdf', '.docx')) or any(c in self.filename for c in ('/', '\\', '\0')):
            raise ValueError('Usa un nombre PDF o DOCX, sin rutas.')
        return self


class State(TypedDict, total=False):
    context: dict
    document: dict
    extraction: dict
    chunks: list
    relevance: dict
    steps: Annotated[list[str], operator.add]
    status: str


class IngestionFailure(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


FIXTURES = {
    'initial_agreement': ['El acuerdo de ejemplo incluye una web en español con cinco secciones.',
                          'El alcance inicial de ejemplo excluye tienda, carrito y otros idiomas.'],
    'new_request': ['Pedido de ejemplo: agregar una tienda y una versión en inglés.'],
    'unrelated_document': ['Comprobante de mantenimiento de una motocicleta ajena al proyecto.'],
    'unclear_document': ['Adjunto los datos que conversamos. Falta identificar a qué trabajo corresponden.'],
}


def simulate_extraction(document):
    if document['fixture_id'] == 'unreadable':
        raise IngestionFailure('UNREADABLE_FILE')
    locator_kind = 'page' if document['filename'].lower().endswith('.pdf') else 'paragraph'
    return {'mode': 'simulation', 'parser': 'explicit-fixture',
            'segments': [{'index': number, 'locator': {'kind': locator_kind, locator_kind: number}, 'text': text}
                         for number, text in enumerate(FIXTURES[document['fixture_id']], 1)],
            'identity_verified': False, 'signature_verified': False}


def simulate_relevance(inputs):
    document, extraction = inputs['document'], inputs['extraction']
    fixture = document['fixture_id']
    relation = {'unrelated_document': 'unrelated', 'unclear_document': 'unclear'}.get(fixture, 'matches')
    detected = {'initial_agreement': 'initial_agreement', 'new_request': 'email_request',
                'unrelated_document': 'other', 'unclear_document': 'unknown'}[fixture]
    needs, follow_up = [], []
    if relation == 'unrelated':
        verdict, code = 'rejected', 'NOT_PROJECT_SOURCE'
    elif relation == 'unclear':
        verdict, code = 'needs_clarification', 'INSUFFICIENT_CONTEXT'
        needs.append('clarify_project_or_document')
    else:
        if document['kind'] != 'reference' and document['kind'] != detected:
            needs.append('confirm_document_kind')
        if detected == 'email_request' and not document['baseline_revision_id']:
            follow_up.append('provide_initial_agreement_before_analysis')
        verdict, code = ('needs_clarification', 'DOCUMENT_CONTEXT_REQUIRED') if needs else ('accepted', 'PROJECT_SOURCE')
    # Fixture-selected branches test control flow, not actual semantic inference.
    segment = extraction['segments'][0]
    return {'mode': 'simulation', 'relation': relation, 'verdict': verdict,
            'detected_kind': detected, 'reason_code': code, 'needs': needs, 'follow_up': follow_up,
            'reason': 'Validación de pertinencia simulada; no se ha consultado un modelo.',
            'project_brief': document['project_brief'],
            'evidence': [{'segment_index': segment['index'], 'quote': segment['text'][:300]}]}


def chunk_segments(extraction, document, context, size=800, overlap=100):
    if not 0 <= overlap < size:
        raise ValueError('Configuración de fragmentación inválida.')
    chunks = []
    for segment in extraction['segments']:
        text = segment['text']
        for start in range(0, len(text), size - overlap):
            end = min(start + size, len(text))
            content = text[start:end]
            digest = sha256(content.encode()).hexdigest()
            identity = ':'.join([context['owner_id'], context['project_id'], document['document_id'],
                                 document['extraction_id'], str(segment['index']), str(start), str(end), digest])
            chunks.append({**context, 'document_id': document['document_id'],
                           'extraction_id': document['extraction_id'],
                           'chunk_id': str(uuid5(NAMESPACE_URL, identity)),
                           'kind': document['kind'], 'segment_index': segment['index'],
                           'locator': segment['locator'], 'start_char': start, 'end_char': end,
                           'text': content, 'text_sha256': digest, 'mode': 'simulation'})
            if end == len(text):
                break
    return chunks


def build_ingestion(checkpointer):
    # LangChain executes a deterministic stage; no LLM is needed to read/chunk files.
    extraction_chain = RunnableLambda(simulate_extraction)
    relevance_chain = RunnableLambda(simulate_relevance)

    def validate(state):
        Context.model_validate(state['context'])
        DocumentInput.model_validate(state['document'])
        return {'status': 'processing', 'steps': ['validate_context']}

    def extract(state):
        return {'extraction': extraction_chain.invoke(state['document']), 'steps': ['extract_text']}

    def relevance(state):
        result = relevance_chain.invoke({'document': state['document'], 'extraction': state['extraction']})
        evidence = result['evidence']
        by_index = {segment['index']: segment['text'] for segment in state['extraction']['segments']}
        if not evidence or any(item['quote'] not in by_index.get(item['segment_index'], '') for item in evidence):
            raise IngestionFailure('INVALID_RELEVANCE_EVIDENCE')
        return {'relevance': result, 'steps': ['validate_relevance']}

    def hold(state):
        return {'status': 'not_relevant' if state['relevance']['verdict'] == 'rejected' else 'needs_clarification',
                'steps': ['hold_document']}

    def chunk(state):
        return {'chunks': chunk_segments(state['extraction'], state['document'], state['context']),
                'steps': ['prepare_chunks']}

    def finish(state):
        return {'status': 'ready', 'steps': ['ready']}

    graph = StateGraph(State)
    for name, handler in [('validate_context', validate), ('extract_text', extract),
                          ('validate_relevance', relevance), ('hold_document', hold),
                          ('prepare_chunks', chunk), ('ready', finish)]:
        graph.add_node(name, handler)
    graph.add_edge(START, 'validate_context')
    graph.add_edge('validate_context', 'extract_text')
    graph.add_edge('extract_text', 'validate_relevance')
    graph.add_conditional_edges('validate_relevance',
                                lambda state: 'prepare_chunks' if state['relevance']['verdict'] == 'accepted' else 'hold_document',
                                {'prepare_chunks': 'prepare_chunks', 'hold_document': 'hold_document'})
    graph.add_edge('hold_document', END)
    graph.add_edge('prepare_chunks', 'ready')
    graph.add_edge('ready', END)
    return graph.compile(checkpointer=checkpointer)
