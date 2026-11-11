"""A processing run pays the full check (18 queries) once at the start and again before publishing to search; the
calls in between confirm the document version with one query. Any change still stops the run."""
import json
import os
import unittest
from unittest import mock

from trato_api.errors import ApiError
from trato_api.file_processing import FileProcessing, PREFIX

JOB = '11111111-1111-4111-8111-111111111111'
LEASE = '22222222-2222-4222-8222-222222222222'
DATA = {'workflow': 'process_file', 'owner_id': '33333333-3333-4333-8333-333333333333',
        'project_id': '44444444-4444-4444-8444-444444444444', 'file_id': '55555555-5555-4555-8555-555555555555',
        'thread': {'thread_id': JOB}}


class Redis:
    def __init__(self):
        self.row = {'status': 'running', 'execution_id': LEASE, 'owner': DATA['owner_id'], 'input': json.dumps(DATA)}

    def hgetall(self, key):
        return dict(self.row) if key == PREFIX + JOB else {}


class Jobs:
    def __init__(self):
        self.redis = Redis()

    def connection(self):
        return self.redis


class Repo:
    def __init__(self):
        self.document = [{'id': DATA['file_id'], 'kind': 'email_request', 'sha256': 'a' * 64, 'deleted_at': None,
                          'document_extractions': {'id': 'e1', 'status': 'ready', 'result_hash': 'h1'}}]
        self.queries = 0

    def rows(self, table, params):
        assert table == 'documents'
        self.queries += 1
        return json.loads(json.dumps(self.document))


class LightCheckTests(unittest.TestCase):
    def setUp(self):
        env = mock.patch.dict(os.environ, {'TRATO_FILE_PROCESSING_ENABLED': 'true'})
        env.start()
        self.addCleanup(env.stop)
        self.repo = Repo()
        self.service = FileProcessing(object(), jobs=Jobs(), repo=self.repo, gateway=object(), chunks=object())
        self.full = mock.patch.object(FileProcessing, 'full_check',
                                      side_effect=lambda repo, id, lease, data: (repo, data, {'value': 1}, {'manifest': 1}))
        self.full_check = self.full.start()
        self.addCleanup(self.full.stop)

    def test_full_check_once_then_one_query_per_call(self):
        first = self.service.active(JOB, LEASE)
        for _ in range(5):
            self.assertEqual(self.service.active(JOB, LEASE), first)
        self.assertEqual(self.full_check.call_count, 1)
        self.assertEqual(self.repo.queries, 6)  # one version read with the full check, then one per call

    def test_any_change_to_the_document_stops_the_run(self):
        for change in ({'deleted_at': '2026-11-10T22:00:00Z'}, {'kind': 'reference'}, {'sha256': 'b' * 64},
                       {'document_extractions': {'id': 'e2', 'status': 'ready', 'result_hash': 'h2'}}):
            with self.subTest(change=change):
                self.setUp()
                self.service.active(JOB, LEASE)
                self.repo.document[0].update(change)
                with self.assertRaises(ApiError) as caught:
                    self.service.active(JOB, LEASE)
                self.assertEqual(caught.exception.code, 'FILE_SOURCE_CHANGED')
                self.assertNotIn((JOB, LEASE), self.service.checked)

    def test_publishing_to_search_always_runs_the_full_check(self):
        self.service.active(JOB, LEASE)
        self.service.active(JOB, LEASE, full=True)
        self.assertEqual(self.full_check.call_count, 2)

    def test_the_lease_is_still_checked_on_every_call(self):
        self.service.active(JOB, LEASE)
        self.service.jobs.redis.row['execution_id'] = '99999999-9999-4999-8999-999999999999'
        with self.assertRaises(ApiError) as caught:
            self.service.active(JOB, LEASE)
        self.assertEqual(caught.exception.code, 'FILE_JOB_NOT_ACTIVE')

    def test_a_failed_full_check_is_not_remembered(self):
        self.full_check.side_effect = ApiError('FILE_SOURCE_CHANGED', 409)
        with self.assertRaises(ApiError):
            self.service.active(JOB, LEASE)
        self.assertNotIn((JOB, LEASE), self.service.checked)


if __name__ == '__main__':
    unittest.main()
