"""Capacity guard for the future file indexer; no network or automatic retries.

Counts must come from the backend's locked capacity ledger, including in-flight
reservations. A worker/model cannot supply an authoritative cluster count.
Old generations remain counted until their actual deletion is confirmed.
"""
from dataclasses import dataclass


class FileIndexPolicyError(RuntimeError):
    def __init__(self, code): self.code = code; super().__init__(code)


@dataclass(frozen=True)
class FileIndexLimits:
    maximum_objects: int = 100000
    safety_reserve: int = 1000
    maximum_chunks_per_file: int = 512
    batch_size: int = 200

    def __post_init__(self):
        values = (self.maximum_objects, self.safety_reserve, self.maximum_chunks_per_file, self.batch_size)
        if (any(type(v) is not int for v in values) or not 1 <= self.maximum_objects <= 100000
            or not 0 <= self.safety_reserve < self.maximum_objects
            or not 1 <= self.maximum_chunks_per_file <= 512 or not 1 <= self.batch_size <= 200):
            raise FileIndexPolicyError('VECTOR_LIMIT_CONFIGURATION_INVALID')

    def plan(self, *, confirmed_objects, reserved_objects, chunk_count):
        if (any(type(v) is not int for v in (confirmed_objects,reserved_objects,chunk_count))
            or confirmed_objects < 0 or reserved_objects < 0 or chunk_count < 1):
            raise FileIndexPolicyError('VECTOR_CAPACITY_STATE_INVALID')
        if chunk_count > self.maximum_chunks_per_file: raise FileIndexPolicyError('VECTOR_DOCUMENT_LIMIT')
        needed = chunk_count + 1  # One document summary plus its chunks, both count as objects.
        if confirmed_objects + reserved_objects + needed > self.maximum_objects - self.safety_reserve:
            raise FileIndexPolicyError('VECTOR_CAPACITY_LIMIT')
        return {'new_objects': needed, 'chunk_batches': [min(self.batch_size,chunk_count-start)
                for start in range(0,chunk_count,self.batch_size)], 'summary_objects': 1}


def provider_failure_code(status):
    """Classify infrastructure failures without treating them as document rejection."""
    if status == 429: return 'VECTOR_QUOTA_EXCEEDED'
    if status in (401,403): return 'VECTOR_ACCESS_DENIED'
    if type(status) is int and status >= 500: return 'VECTOR_PROVIDER_UNAVAILABLE'
    return 'VECTOR_PROVIDER_ERROR'
