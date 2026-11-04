"""Pure chunking of authorized extracted text; no storage, credentials or models."""
from hashlib import sha256
import json
from uuid import UUID, NAMESPACE_URL, uuid5
from pydantic import Field, model_validator
from .source_text import Strict, Segment, MAX_SOURCE_BYTES


class ChunkPolicy(Strict):
    version: str = Field(min_length=1, max_length=40, pattern=r'^[a-z0-9_-]+$')
    max_chars: int = Field(ge=32, le=16000)
    overlap_chars: int = Field(ge=0, le=4000)
    max_chunks: int = Field(ge=1, le=10000)

    @model_validator(mode='after')
    def overlap(self):
        if self.overlap_chars >= self.max_chars:
            raise ValueError('Overlap must be smaller than the window.')
        return self


class ChunkRequest(Strict):
    schema_version: int = Field(ge=1, le=1)
    file_id: str
    source_fingerprint: str = Field(pattern=r'^[a-f0-9]{64}$')
    policy: ChunkPolicy
    segments: list[Segment] = Field(min_length=1, max_length=4096)

    @model_validator(mode='after')
    def source(self):
        if str(UUID(self.file_id)) != self.file_id:
            raise ValueError('Canonical file ID required.')
        if len({s.segment_id for s in self.segments}) != len(self.segments):
            raise ValueError('Duplicate segment ID.')
        if any(not s.text.strip() for s in self.segments):
            raise ValueError('Empty source segment.')
        if sum(len(s.text.encode()) for s in self.segments) > MAX_SOURCE_BYTES:
            raise ValueError('Source text limit exceeded; do not truncate.')
        return self


def digest(value):
    return sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def chunk_file(payload):
    request = ChunkRequest.model_validate(payload)
    policy = request.policy
    policy_fingerprint = digest(policy.model_dump())
    chunks = []
    for segment in request.segments:
        text = segment.text
        for start in range(0, len(text), policy.max_chars - policy.overlap_chars):
            end = min(start + policy.max_chars, len(text))
            left, right = start, end
            # Preserve original offsets. Whitespace-only spans do not become vectors.
            while left < right and text[left].isspace(): left += 1
            while right > left and text[right - 1].isspace(): right -= 1
            if right > left:
                content = text[left:right]
                text_hash = sha256(content.encode()).hexdigest()
                binding = digest([request.file_id, request.source_fingerprint, policy_fingerprint,
                                  segment.segment_id, segment.locator.model_dump(), left, right, text_hash])
                chunks.append({'chunk_id': str(uuid5(NAMESPACE_URL, 'trato:file-chunk:' + binding)),
                               'segment_id': segment.segment_id, 'locator': segment.locator.model_dump(),
                               'start_char': left, 'end_char': right, 'text': content, 'text_sha256': text_hash})
                if len(chunks) > policy.max_chunks:
                    raise ValueError('Chunk limit exceeded; no partial result is returned.')
            if end == len(text): break
    if not chunks:
        raise ValueError('No material text to chunk.')
    return {'schema_version': 1, 'file_id': request.file_id,
            'source_fingerprint': request.source_fingerprint, 'policy_fingerprint': policy_fingerprint,
            'offset_unit': 'unicode_code_points', 'chunks': chunks}
