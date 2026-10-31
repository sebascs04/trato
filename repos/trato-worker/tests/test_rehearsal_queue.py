import importlib.util
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
from uuid import uuid4
import test_ingestion_redis as redis_tests
from test_source_tools import Client
from test_rehearsal_evaluation import Model, data
from trato_worker.rehearsal_jobs import RehearsalConsumer, STREAM


@unittest.skipUnless(os.environ.get('TRATO_RUN_REDIS_TESTS') == '1' and importlib.util.find_spec('fastapi'),
                     'Redis integration and API test dependencies must be explicitly enabled')
class RehearsalQueueTests(unittest.TestCase):
    setUpClass = classmethod(redis_tests.RedisIngestionTests.setUpClass.__func__)
    tearDownClass = classmethod(redis_tests.RedisIngestionTests.tearDownClass.__func__)

    def setUp(self):
        self.redis.flushdb()  # Only this test's isolated temporary server.
        sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'trato-api'))

    def test_private_job_is_processed_once_and_keeps_the_validated_result(self):
        from trato_api.rehearsal_jobs import RehearsalJobs
        from trato_api.errors import ApiError
        jobs = RehearsalJobs(self.redis); job_id = str(uuid4()); model = Model()
        consumer = RehearsalConsumer(self.redis, Client(), model); consumer.setup()
        with patch.dict(os.environ, {'TRATO_REHEARSAL_EVALUATOR_ENABLED': 'true'}):
            self.redis.set('trato:rehearsal:consumer:ready', '1', ex=60)
            self.assertEqual(jobs.enqueue('owner-a', job_id, data())['status'], 'queued')
            jobs.enqueue('owner-a', job_id, data())
            self.assertTrue(consumer.process_once())
            result = jobs.get('owner-a', job_id)
            self.assertEqual(result['status'], 'completed')
            self.assertEqual(result['evaluation']['sources_read'], 5)
            self.assertEqual(len(model.calls), 1)
            with self.assertRaises(ApiError): jobs.get('owner-b', job_id)
            self.assertFalse(consumer.process_once())

    def test_invalid_citation_is_terminal_and_redelivery_does_not_rerun_model(self):
        from trato_api.rehearsal_jobs import RehearsalJobs
        jobs = RehearsalJobs(self.redis); job_id = str(uuid4())
        model = Model(lambda r: r['items'][0].update(citations=['not-in-source']))
        consumer = RehearsalConsumer(self.redis, Client(), model); consumer.setup()
        with patch.dict(os.environ, {'TRATO_REHEARSAL_EVALUATOR_ENABLED': 'true'}):
            self.redis.set('trato:rehearsal:consumer:ready', '1', ex=60)
            jobs.enqueue('owner-a', job_id, data()); consumer.process_once()
            result = jobs.get('owner-a', job_id)
            self.assertEqual(result['status'], 'failed')
            self.assertEqual(result['error_code'], 'REHEARSAL_INVALID_CITATION')
            self.assertNotIn('evaluation', result)
            self.redis.xadd(STREAM, {'job_id': job_id}); consumer.process_once()
            self.assertEqual(len(model.calls), 1)
