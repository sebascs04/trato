import unittest
import os
from unittest.mock import patch
from trato_api.thread_runner import BackendPump,COMMANDS,EVENTS,GROUP

class Redis:
    def __init__(self):self.calls=[];self.fields={}
    def xadd(self,*args):self.calls.append(('publish',args))
    def xautoclaim(self,*args,**kwargs):return ('0-0',[('1-0',self.fields)],[])
    def xack(self,*args):self.calls.append(('ack',args))

class Store:
    def __init__(self,redis):self.redis=redis;self.fail=False;self.calls=[]
    def command(self,action,data):
        self.calls.append(action)
        if action=='relay_claim':return {'id':'outbox','lease_id':'lease','envelope':{'type':'thread'}}
        if action=='result':
            if self.fail:raise RuntimeError('Database unavailable')
            assert not self.redis.calls
        return {'stored':True}

class ThreadPumpTests(unittest.TestCase):
    def setup(self):
        import json
        redis=Redis();store=Store(redis)
        redis.fields={'thread':json.dumps({'type':'thread','mode':'connected','action':'completed'})}
        return BackendPump(store,redis),store,redis
    def test_outbox_is_marked_published_after_redis_receives_command(self):
        pump,store,redis=self.setup();pump.publish_once()
        self.assertEqual(store.calls,['relay_claim','relay_published'])
        self.assertEqual(redis.calls[0][0],'publish')
    def test_result_is_committed_before_ack(self):
        pump,store,redis=self.setup();pump.consume_once()
        self.assertEqual(store.calls,['result'])
        self.assertEqual(redis.calls,[('ack',(EVENTS,GROUP,'1-0'))])
    def test_database_failure_leaves_result_pending(self):
        pump,store,redis=self.setup();store.fail=True
        with self.assertRaises(RuntimeError):pump.consume_once()
        self.assertEqual(redis.calls,[])
    def test_index_is_enqueued_only_after_canonical_extraction_is_committed(self):
        import json
        pump,store,redis=self.setup();store.settings=None
        redis.fields={'thread':json.dumps({'type':'thread','mode':'connected','workflow':'ingest_document',
                                          'action':'completed','thread_id':'thread'})}
        with patch.dict(os.environ,{'TRATO_VECTOR_SEARCH_ENABLED':'true'}),patch('trato_api.vector_jobs.IndexJobs') as jobs:
            pump.consume_once()
            jobs.return_value.after_extraction.assert_called_once_with(store,'thread')
            self.assertEqual(store.calls,['result'])
            self.assertEqual(redis.calls[-1][0],'ack')
    def test_index_enqueue_failure_preserves_the_committed_event_for_relay(self):
        import json
        from trato_api.errors import ApiError
        pump,store,redis=self.setup();store.settings=None
        redis.fields={'thread':json.dumps({'type':'thread','mode':'connected','workflow':'ingest_document',
                                          'action':'completed','thread_id':'thread'})}
        with patch.dict(os.environ,{'TRATO_VECTOR_SEARCH_ENABLED':'true'}),patch('trato_api.vector_jobs.IndexJobs') as jobs:
            jobs.return_value.after_extraction.side_effect=ApiError('AI_QUEUE_UNAVAILABLE',503)
            with self.assertRaises(ApiError):pump.consume_once()
            self.assertEqual(store.calls,['result'])
            self.assertEqual(redis.calls,[])
