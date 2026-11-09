"""Heartbeat, step limit and unexpected errors of the AI consumer, with an in-memory Redis double."""
import json, threading, time, unittest
from unittest.mock import patch
from uuid import uuid4
from redis.exceptions import RedisError
from trato_worker import ai_jobs
from trato_worker.ai_jobs import AIConsumer, BEAT, CLAIM, FINISH

JOB = str(uuid4())


class Redis:
    def __init__(self, data):
        self.lock = threading.Lock()
        self.row = {'input': json.dumps(data), 'status': 'queued'}
        self.beats, self.events, self.claims = [], [], []

    def xautoclaim(self, *a, **k): return ('0', [])
    def xreadgroup(self, *a, **k): return [('stream', [('1', {'job_id': JOB})])]
    def hset(self, key, field=None, value=None, mapping=None):
        with self.lock:
            if mapping: self.row.update(mapping)
            else: self.row[field] = value
    def hget(self, key, field):
        with self.lock: return self.row.get(field)
    def set(self, *a, **k): pass
    def xack(self, *a): self.events.append('ack')
    def xdel(self, *a): pass

    def eval(self, script, count, *args):
        with self.lock:
            if script is CLAIM:
                self.claims.append(args[2]); self.row.update(status='running', started_at=args[1]); return 1
            active = self.row['status'] == 'running' and self.row.get('execution_id') == args[1]
            if script is BEAT:
                if not active: return 0
                self.row['started_at'] = args[2]; self.beats.append(args[2]); return 1
            if script is FINISH:
                if not active: return 0
                self.row.update({'status': args[2], args[3]: args[4]}); self.events.append('finish'); return 1
            raise AssertionError('unknown script')


class Model:
    name = 'test-model'
    def __init__(self, generate): self.generate = generate


def run(redis, generate):
    with patch('trato_worker.ai_jobs.run_business_ai', side_effect=lambda data, model: model.generate([], {})):
        return AIConsumer(redis, object(), Model(generate)).process_once()


class HeartbeatTests(unittest.TestCase):
    def test_claim_uses_the_short_stale_limit(self):
        redis = Redis({'workflow': 'reputation'})
        run(redis, lambda *a: {'kind': 'reputation'})
        self.assertEqual(redis.claims, [ai_jobs.STALE_SECONDS])
        self.assertLessEqual(ai_jobs.STALE_SECONDS, 120)
        self.assertGreater(ai_jobs.RECOVERY_IDLE_MS / 1000, ai_jobs.STALE_SECONDS)

    def test_a_long_step_keeps_the_lease_fresh(self):
        redis = Redis({'workflow': 'reputation'})
        def slow(*a): time.sleep(.35); return {'kind': 'reputation'}
        with patch.object(ai_jobs, 'HEARTBEAT_SECONDS', .05):
            self.assertTrue(run(redis, slow))
        self.assertGreaterEqual(len(redis.beats), 3)
        self.assertEqual(redis.row['status'], 'completed'); self.assertEqual(redis.events, ['finish', 'ack'])

    def test_a_step_over_its_limit_stops_the_heartbeat(self):
        redis = Redis({'workflow': 'reputation'})
        started = []
        def blocked(*a): started.append(time.time()); time.sleep(.6); return {'kind': 'reputation'}
        with patch.object(ai_jobs, 'HEARTBEAT_SECONDS', .05), patch.object(ai_jobs, 'STEP_LIMIT_SECONDS', .15):
            run(redis, blocked)
        self.assertTrue(redis.beats)
        # No beat after the step limit plus one interval: recovery can then release the job.
        self.assertLess(max(redis.beats) - started[0], .15 + .05 + .05)

    def test_the_heartbeat_never_renews_another_execution(self):
        redis = Redis({'workflow': 'reputation'})
        def interrupted(*a):
            redis.hset('k', 'status', 'failed'); time.sleep(.3); return {'kind': 'reputation'}
        with patch.object(ai_jobs, 'HEARTBEAT_SECONDS', .05):
            run(redis, interrupted)
        self.assertEqual(redis.beats, [])
        self.assertEqual(redis.row['status'], 'failed'); self.assertNotIn('finish', redis.events)

    def test_the_heartbeat_stops_when_the_job_ends(self):
        redis = Redis({'workflow': 'reputation'})
        with patch.object(ai_jobs, 'HEARTBEAT_SECONDS', .05):
            run(redis, lambda *a: {'kind': 'reputation'})
            count = len(redis.beats); time.sleep(.2)
        self.assertEqual(len(redis.beats), count)
        self.assertFalse(any(isinstance(t, ai_jobs._Heartbeat) for t in threading.enumerate()))


class UnexpectedErrorTests(unittest.TestCase):
    def test_an_unexpected_error_is_the_jobs_visible_failure(self):
        redis = Redis({'workflow': 'reputation'})
        def broken(*a): raise RuntimeError('boom')
        with patch('builtins.print') as log:
            self.assertTrue(run(redis, broken))
        self.assertEqual(redis.row['status'], 'failed'); self.assertEqual(redis.row['error_code'], 'AI_FAILED')
        self.assertEqual(redis.events, ['finish', 'ack'])
        logged = json.loads(log.call_args.args[0])
        self.assertEqual(logged['error'], {'code': 'AI_FAILED', 'type': 'RuntimeError', 'job_id': JOB})
        self.assertNotIn('boom', log.call_args.args[0])

    def test_a_queue_error_leaves_the_entry_pending_for_recovery(self):
        redis = Redis({'workflow': 'reputation'})
        def lost(*a): raise RedisError('down')
        with self.assertRaises(RedisError):
            run(redis, lost)
        self.assertEqual(redis.events, []); self.assertEqual(redis.row['status'], 'running')


class StepTrackingTests(unittest.TestCase):
    def test_backend_requests_count_as_steps(self):
        steps = ai_jobs._Steps()
        class Backend:
            def request(_, *a, **k): return 'ok'
            other = 'kept'
        tracked = steps.wrap(Backend(), 'request')
        with patch.object(ai_jobs, 'STEP_LIMIT_SECONDS', .1):
            time.sleep(.15); self.assertFalse(steps.within_limit())
            self.assertEqual(tracked.request(), 'ok'); self.assertTrue(steps.within_limit())
        self.assertEqual(tracked.other, 'kept')


if __name__ == '__main__':
    unittest.main()
