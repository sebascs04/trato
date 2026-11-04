"""Safe search projections. Source text alone feeds chunk embeddings/BM25."""
from uuid import NAMESPACE_URL, uuid5
from .contracts import PipelineError, fingerprint
from .embeddings import EmbeddingProfile

CHUNK_VECTOR_PROPERTIES = ('chunk_text',)
CHUNK_LEXICAL_PROPERTIES = ('chunk_text',)


def make_projection(manifest, chunks, summary, *, embedding_profile):
    if embedding_profile is None: raise PipelineError('EMBEDDING_NOT_CONFIGURED')
    try: profile = EmbeddingProfile.model_validate(embedding_profile)
    except (TypeError, ValueError): raise PipelineError('EMBEDDING_CONFIGURATION_INVALID') from None
    embedding_identity = profile.identity()
    for chunk in chunks['chunks']: profile.validate_text(chunk['text'])
    access = manifest.access.model_dump(exclude_none=True)
    metadata = {'file_id': manifest.file_id, 'source_version': manifest.source_version,
                'source_sha256': manifest.source_sha256, 'source_fingerprint': chunks['source_fingerprint'],
                'purpose': manifest.purpose, **access, 'summary_fingerprint': summary['summary_fingerprint'],
                'embedding_identity': embedding_identity}
    records = []
    for chunk in chunks['chunks']:
        identity = fingerprint([metadata, chunks['policy_fingerprint'], chunk['chunk_id']])
        records.append({'id': str(uuid5(NAMESPACE_URL, 'trato:index-chunk:' + identity)),
                        'properties': {**metadata, 'record_type': 'text_chunk', 'chunk_id': chunk['chunk_id'],
                                       'chunk_text': chunk['text'], 'document_summary': summary['summary'],
                                       'segment_id': chunk['segment_id'], 'locator': chunk['locator'],
                                       'start_char': chunk['start_char'], 'end_char': chunk['end_char'],
                                       'text_sha256': chunk['text_sha256']}})
    # The inventory is paginated by exact scope, not obtained from a vector top-k.
    document = {'id': str(uuid5(NAMESPACE_URL, 'trato:index-document:' + fingerprint(metadata))),
                'properties': {**metadata, 'record_type': 'document_summary', 'filename': manifest.filename,
                               'document_summary': summary['summary'], 'topics': summary['topics'],
                               'citations': summary['citations'], 'expected_chunks': len(records)}}
    result = {'schema_version': 1, 'scope_fingerprint': fingerprint(access), 'file_id': manifest.file_id,
              'source_fingerprint': chunks['source_fingerprint'], 'embedding_identity': embedding_identity,
              'embedding_profile': profile.model_dump(),
              'chunk_vector_properties': list(CHUNK_VECTOR_PROPERTIES),
              'chunk_lexical_properties': list(CHUNK_LEXICAL_PROPERTIES),
              'document': document, 'chunks': records}
    result['projection_fingerprint'] = fingerprint(result)
    return result
