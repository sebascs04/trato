"""Explicit assembly only. Importing this module never starts a consumer."""
from .contracts import PipelineError
from .pipeline import FilePipeline
from .treatment import PurposeAgent
from .summarize import FileSummarizer
from .embeddings import TRATO_CHUNK_POLICY, TRATO_EMBEDDING_PROFILE


def build_file_pipeline(backend, model, *, model_identity, maximum_input_bytes,
                        enabled_purposes, maximum_summary_calls=64):
    if not callable(getattr(model, 'generate', None)):
        raise PipelineError('FILE_MODEL_NOT_CONFIGURED')
    agent = PurposeAgent(model, model_identity=model_identity, maximum_input_bytes=maximum_input_bytes)
    summarizer = FileSummarizer(model, model_identity=model_identity,
                               maximum_input_bytes=maximum_input_bytes, maximum_calls=maximum_summary_calls)
    return FilePipeline(backend, summarizer, enabled_purposes=enabled_purposes,
                        handlers=agent.handlers(enabled_purposes), chunk_policy=TRATO_CHUNK_POLICY,
                        embedding_profile=TRATO_EMBEDDING_PROFILE)
