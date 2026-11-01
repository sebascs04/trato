import unittest
from trato_api.file_index_policy import FileIndexLimits, FileIndexPolicyError, provider_failure_code


class FileIndexPolicyTests(unittest.TestCase):
    def test_summary_and_inflight_objects_count_towards_capacity(self):
        limits=FileIndexLimits()
        self.assertEqual(limits.plan(confirmed_objects=98970,reserved_objects=8,chunk_count=21)['new_objects'],22)
        with self.assertRaisesRegex(FileIndexPolicyError,'VECTOR_CAPACITY_LIMIT'):
            limits.plan(confirmed_objects=98970,reserved_objects=9,chunk_count=21)

    def test_batches_do_not_exceed_free_embedding_limit(self):
        result=FileIndexLimits().plan(confirmed_objects=0,reserved_objects=0,chunk_count=512)
        self.assertEqual(result['chunk_batches'],[200,200,112])
        self.assertEqual(result['new_objects'],513)

    def test_invalid_counts_configuration_and_too_many_chunks_fail(self):
        for counts in [dict(confirmed_objects=-1,reserved_objects=0,chunk_count=1),
                       dict(confirmed_objects=0,reserved_objects=True,chunk_count=1),
                       dict(confirmed_objects=0,reserved_objects=0,chunk_count=513)]:
            with self.assertRaises(FileIndexPolicyError): FileIndexLimits().plan(**counts)
        with self.assertRaises(FileIndexPolicyError): FileIndexLimits(batch_size=201)

    def test_quota_and_auth_failures_remain_infrastructure_errors(self):
        self.assertEqual(provider_failure_code(429),'VECTOR_QUOTA_EXCEEDED')
        self.assertEqual(provider_failure_code(403),'VECTOR_ACCESS_DENIED')
        self.assertEqual(provider_failure_code(503),'VECTOR_PROVIDER_UNAVAILABLE')
