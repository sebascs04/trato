"""Reusable file-processing architecture. No consumer is activated on import."""
from .contracts import FileThread, FileManifest, PipelineError, PURPOSES
from .pipeline import FilePipeline

__all__ = ['FileThread', 'FileManifest', 'PipelineError', 'PURPOSES', 'FilePipeline']
