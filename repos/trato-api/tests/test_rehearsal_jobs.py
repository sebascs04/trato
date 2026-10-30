from copy import deepcopy
import json
import os
import unittest
from unittest.mock import patch
from uuid import uuid4
from fastapi import FastAPI
from fastapi.testclient import TestClient
from fastapi.responses import JSONResponse
from trato_api.rehearsal_jobs import RehearsalJobs
from trato_api.rehearsal_routes import build_rehearsal_router
from trato_api.errors import ApiError


class Redis:
    def __init__(self): self.rows = {}; self.queued = 0
    def exists(self, key): return key in self.rows
    def get(self, key): return '1'
    def hgetall(self, key): return deepcopy(self.rows.get(key, {}))
    def eval(self, script, n, key, stream, owner, digest, body, ttl, job):
        row = self.rows.get(key)
        if row:
            if row['owner'] != owner: return -1
            if row['digest'] != digest: return -2
            return 0
        self.rows[key] = {'owner': owner, 'digest': digest, 'input': body, 'status': 'queued'}
        self.queued += 1; return 1


class JobTests(unittest.TestCase):
    def test_owner_bound_idempotency_and_no_private_payload_in_status(self):
        redis = Redis(); jobs = RehearsalJobs(redis); job = str(uuid4())
        with patch.dict(os.environ, {'TRATO_REHEARSAL_EVALUATOR_ENABLED': 'true'}):
            self.assertEqual(jobs.enqueue('a', job, {'text': 'private'}), {'id': job, 'status': 'queued'})
            jobs.enqueue('a', job, {'text': 'private'})
            self.assertEqual(redis.queued, 1)
            with self.assertRaises(ApiError) as error: jobs.get('b', job)
            self.assertEqual(error.exception.status, 404)
            with self.assertRaises(ApiError): jobs.enqueue('a', job, {'text': 'changed'})

    def test_disabled_does_not_queue_or_use_a_simulation(self):
        redis = Redis()
        with patch.dict(os.environ, {'TRATO_REHEARSAL_EVALUATOR_ENABLED': 'false'}):
            with self.assertRaises(ApiError): RehearsalJobs(redis).enqueue('a', str(uuid4()), {})
        self.assertEqual(redis.queued, 0)

    def test_routes_validate_and_ignore_client_supplied_case(self):
        jobs = RehearsalJobs(Redis()); app = FastAPI()
        app.include_router(build_rehearsal_router(lambda: 'owner-a', jobs=jobs))
        @app.exception_handler(ApiError)
        async def error(_, exc): return JSONResponse({'error': {'code': exc.code}}, status_code=exc.status)
        payload = {'action': 'evaluate', 'scenario': 'scope', 'output_language': 'en',
                   'persona': {'patience': 3, 'flexibility': 3, 'price_sensitivity': 3},
                   'messages': [{'role': 'client', 'text': 'Extra?'}, {'role': 'user', 'text': 'What matters?'}]}
        with patch.dict(os.environ, {'TRATO_REHEARSAL_EVALUATOR_ENABLED': 'true'}), TestClient(app) as client:
            headers = {'Idempotency-Key': str(uuid4())}
            response = client.post('/api/v1/rehearsals/evaluations', json=payload, headers=headers)
            self.assertEqual(response.status_code, 202)
            self.assertEqual(client.get('/api/v1/rehearsals/evaluations/' + response.json()['data']['id']).status_code, 200)
            self.assertIn('case', json.loads(next(iter(jobs.redis.rows.values()))['input']))
            self.assertEqual(client.post('/api/v1/rehearsals/evaluations', json={**payload, 'case': {}}, headers=headers).status_code, 422)
