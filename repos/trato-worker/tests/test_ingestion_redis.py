"""Opt-in integration starts its own temporary Redis, never the application server."""
import copy
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time
import unittest
from uuid import uuid4
from redis import Redis
from trato_worker.redis_transport import COMMANDS, EVENTS, GROUP, RedisTransport
from trato_worker.threads import ThreadWorker
from test_ingestion import EXAMPLE

@unittest.skipUnless(os.environ.get('TRATO_RUN_REDIS_TESTS') == '1', 'Redis integration is explicitly opt-in')
class RedisIngestionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not shutil.which('redis-server'): raise RuntimeError('redis-server is required for this test.')
        cls.temp = tempfile.TemporaryDirectory()
        with socket.socket() as s:
            s.bind(('127.0.0.1', 0)); port = s.getsockname()[1]
        cls.url = f'redis://127.0.0.1:{port}/0'
        cls.process = subprocess.Popen(['redis-server', '--bind', '127.0.0.1', '--port', str(port), '--dir', cls.temp.name, '--save', '', '--appendonly', 'no'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        cls.redis = Redis.from_url(cls.url, decode_responses=True, socket_connect_timeout=1)
        for _ in range(60):
            try:
                if cls.redis.ping(): return
            except Exception: time.sleep(.05)
        cls.process.terminate(); cls.process.wait(timeout=5); cls.temp.cleanup()
        raise RuntimeError('Test Redis failed to start.')

    @classmethod
    def tearDownClass(cls):
        cls.redis.close(); cls.process.terminate(); cls.process.wait(timeout=5); cls.temp.cleanup()

    def setUp(self):
        self.redis.flushdb()  # Only the isolated temporary server of this test class.
        self.folder = tempfile.TemporaryDirectory(); self.addCleanup(self.folder.cleanup)
        self.worker = ThreadWorker(Path(self.folder.name) / 'worker.sqlite', mode='simulation')
        self.bus = RedisTransport(self.url, self.worker); self.addCleanup(self.bus.close); self.bus.setup()
        self.message = copy.deepcopy(EXAMPLE); self.message['event_id'] = str(uuid4())

    def test_queue_progress_result_and_ack(self):
        self.bus.publish(self.message); result = self.bus.process_once(block_ms=10)
        self.assertEqual(result['result']['status'], 'ready')
        events = [json.loads(fields['thread']) for _, fields in self.redis.xrange(EVENTS)]
        self.assertEqual([e['action'] for e in events], ['progress'] * 5 + ['completed'])
        self.assertTrue(all(e['thread_id'] == self.message['thread_id'] and e['mode'] == 'simulation' for e in events))
        self.assertEqual(self.redis.xpending(COMMANDS, GROUP)['pending'], 0)

    def test_pending_command_is_recovered_by_another_consumer(self):
        self.bus.publish(self.message)
        self.assertTrue(self.redis.xreadgroup(GROUP, 'crashed-consumer', {COMMANDS: '>'}, count=1))
        time.sleep(.02)
        result = self.bus.process_once(recover_idle_ms=1, block_ms=10)
        self.assertEqual(result['result']['status'], 'ready')
        self.assertEqual(self.redis.xpending(COMMANDS, GROUP)['pending'], 0)

    def test_duplicate_delivery_reuses_result(self):
        self.bus.publish(self.message); first = self.bus.process_once(block_ms=10)
        self.bus.publish(self.message); second = self.bus.process_once(block_ms=10)
        self.assertEqual(first, second)
        self.assertEqual(len(self.redis.xrange(EVENTS)), 7)

    def test_real_message_is_rejected_not_simulated(self):
        self.message['mode'] = 'real'
        self.redis.xadd(COMMANDS, {'thread': json.dumps(self.message)})
        result = self.bus.process_once(block_ms=10)
        self.assertEqual(result['action'], 'rejected'); self.assertNotIn('result', result)
        self.assertEqual(self.redis.xpending(COMMANDS, GROUP)['pending'], 0)

    def test_change_review_can_resume_over_the_same_generic_queue(self):
        self.message.update(workflow='manage_change', thread_id=str(uuid4()))
        self.message['payload'] = {'request_id': str(uuid4()), 'project_brief': 'Web en español.',
                                   'fixture_id': 'extra', 'baseline_reviewed': False}
        self.bus.publish(self.message)
        result = self.bus.process_once(block_ms=10)
        pending = result['result']['pending']
        self.assertEqual(pending['stage'], 'review_baseline')
        self.message.update(action='resume', event_id=str(uuid4()), payload={
            'interrupt_id': pending['interrupt_id'], 'input': {'action': 'confirm_baseline'}})
        self.bus.publish(self.message)
        resumed = self.bus.process_once(block_ms=10)
        self.assertEqual(resumed['result']['pending']['stage'], 'review_proposal')
        review = {'action': 'approve_proposal', 'scope': 'Tienda.', 'amount_cents': 45000,
                  'currency': 'USD', 'due_date': '2026-11-13', 'terms': 'Términos de prueba.'}
        for decision in (review, {**review, 'action': 'edit_draft', 'amount_cents': 35000}):
            self.message.update(action='resume', event_id=str(uuid4()), payload={
                'interrupt_id': resumed['result']['pending']['interrupt_id'], 'input': decision})
            self.bus.publish(self.message)
            resumed = self.bus.process_once(block_ms=10)
        self.assertEqual(resumed['result']['pending']['stage'], 'send_revision')
        self.assertEqual(len(resumed['result']['revisions']), 1)
        self.assertEqual(len(resumed['result']['draft_snapshots']), 2)
        self.assertEqual(resumed['result']['revisions'][0]['version'], 1)
        self.assertEqual(self.redis.xpending(COMMANDS, GROUP)['pending'], 0)

    def test_connected_and_simulated_work_share_consumer_code_but_not_streams(self):
        from trato_worker.connected import ConnectedWorker
        class Client:
            def claim(self,message):return {'terminal':False,'lease_id':str(uuid4())}
            def extract(self,inputs):
                inputs['on_stage']('extracting_text')
                return {'schema_version':1,'segments':[]}
        worker=ConnectedWorker(Client())
        bus=RedisTransport(self.url,worker);self.addCleanup(bus.close);bus.setup()
        message=copy.deepcopy(self.message);message['mode']='connected'
        message['payload']={key:message['payload'][key] for key in ('document_id','extraction_id','kind')}
        message['payload']['sha256']='a'*64
        bus.publish(message)
        result=bus.process_once(block_ms=10)
        self.assertEqual(result['action'],'completed')
        self.assertEqual(result['result']['relevance_status'],'not_evaluated')
        self.assertEqual(self.redis.xlen(COMMANDS),0)
        self.assertEqual(self.redis.xlen(EVENTS),0)
        events=[json.loads(fields['thread']) for _,fields in self.redis.xrange(bus.events)]
        self.assertEqual([e['action'] for e in events],['progress','progress','completed'])
        self.assertTrue(all(e['mode']=='connected' for e in events))
        self.assertEqual(self.redis.xpending(bus.commands,bus.group)['pending'],0)
