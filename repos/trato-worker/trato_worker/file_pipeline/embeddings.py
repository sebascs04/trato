"""Explicit vector-space contract shared by ingestion and retrieval.

No cloud calls and no provider fallback. Collection configuration must match
this profile before writing documents or vectorizing queries.
"""
from typing import Literal
from pydantic import Field
from .contracts import Strict, PipelineError, fingerprint


class EmbeddingProfile(Strict):
    provider: Literal['weaviate_embeddings']
    model: Literal['Snowflake/snowflake-arctic-embed-l-v2.0']
    dimensions: Literal[1024]
    distance: Literal['cosine']
    input_version: Literal['chunk-text-v1']
    # Conservative byte cap, below the model's 8192-token window, preventing
    # provider-side right truncation. Neither host nor provider may truncate.
    maximum_text_bytes: int = Field(ge=32, le=4096)

    def identity(self): return fingerprint(self.model_dump())

    def validate_text(self, text):
        if not isinstance(text, str) or not text.strip(): raise PipelineError('EMBEDDING_EMPTY_TEXT')
        if len(text.encode()) > self.maximum_text_bytes: raise PipelineError('EMBEDDING_INPUT_LIMIT')
        return text


TRATO_EMBEDDING_PROFILE = {
    'provider': 'weaviate_embeddings', 'model': 'Snowflake/snowflake-arctic-embed-l-v2.0',
    'dimensions': 1024, 'distance': 'cosine', 'input_version': 'chunk-text-v1',
    'maximum_text_bytes': 4096,
}
TRATO_CHUNK_POLICY = {'version': 'v1', 'max_chars': 800, 'overlap_chars': 100, 'max_chunks': 512}


def validate_query_space(profile, stored_profile, query):
    """Retrieval must read/check collection profile, not trust an LLM choice."""
    expected = EmbeddingProfile.model_validate(profile)
    actual = EmbeddingProfile.model_validate(stored_profile)
    if expected != actual: raise PipelineError('EMBEDDING_PROFILE_MISMATCH')
    return {'embedding_identity': expected.identity(), 'embedding_profile': expected.model_dump(),
            'query': expected.validate_text(query)}
