import unittest
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
