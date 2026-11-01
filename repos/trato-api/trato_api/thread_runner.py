"""One generic outbox publisher and one result consumer, independent of HTTP workers."""
import argparse
import json
import os
import time
from uuid import uuid4
from redis import Redis
from redis.exceptions import ResponseError, ConnectionError, TimeoutError
from .errors import ApiError
from .app import Settings
from .thread_store import ThreadStore

COMMANDS='trato:connected:thread:commands'
EVENTS='trato:connected:thread:events'
GROUP='trato-backend-results'


class BackendPump:
    def __init__(self, store, redis, consumer=None):
        self.store,self.redis=store,redis
        self.consumer=consumer or str(uuid4())
        self.cursor='0-0'

    def setup(self):
        try:self.redis.xgroup_create(EVENTS,GROUP,id='0',mkstream=True)
        except ResponseError as exc:
            if not str(exc).startswith('BUSYGROUP'):raise

    def publish_once(self):
        if os.getenv('TRATO_VECTOR_SEARCH_ENABLED') == 'true':
            from .reputation_vector import relay_reputation
            relay_reputation(self.store,self.redis)
        item=self.store.command('relay_claim',{})
        if item is None:return False
        self.redis.xadd(COMMANDS,{'thread':json.dumps(item['envelope'])})
        self.store.command('relay_published',{'id':item['id'],'lease_id':item['lease_id']})
        return True

    def consume_once(self, *, block_ms=1000, recover_idle_ms=120000):
        claimed=self.redis.xautoclaim(EVENTS,GROUP,self.consumer,recover_idle_ms,start_id=self.cursor,count=1)
        self.cursor=claimed[0];items=claimed[1]
        if not items:
            batches=self.redis.xreadgroup(GROUP,self.consumer,{EVENTS:'>'},count=1,block=block_ms)
            items=batches[0][1] if batches else []
        if not items:return False
        identifier,fields=items[0]
        try:message=json.loads(fields['thread'])
        except (ValueError,KeyError):message=None
        valid=(isinstance(message,dict) and message.get('type')=='thread' and message.get('mode')=='connected'
               and message.get('action') in ('completed','failed','progress'))
        if valid:
            # The RPC checks the stored context, command, active job lease, dedup and domain data atomically.
            try:
                receipt = self.store.command('result',{'message':message})
                if (os.getenv('TRATO_VECTOR_SEARCH_ENABLED') == 'true' and
                    message.get('workflow') == 'ingest_document' and message['action'] == 'completed' and
                    (receipt.get('stored') or receipt.get('duplicate'))):
                    from .vector_jobs import IndexJobs
                    from .ai_jobs import AIJobs
                    IndexJobs(self.store.settings, jobs=AIJobs(self.redis)).after_extraction(self.store, message['thread_id'])
            except ApiError as error:
                if error.status not in (404,409,422):raise
                self.redis.xadd('trato:connected:thread:rejected-events',{'event_ref':identifier,'error_code':error.code})
        else:
            self.redis.xadd('trato:connected:thread:rejected-events',{'event_ref':identifier,'error_code':'INVALID_RESULT'})
        # Persistence is committed before ACK. A crash between both causes safe redelivery.
        self.redis.xack(EVENTS,GROUP,identifier)
        return True


def main():
    parser=argparse.ArgumentParser(description='Publicador y consumidor genéricos de Trato.')
    parser.add_argument('--mode',choices=['connected'],required=True)
    parser.add_argument('--once',action='store_true')
    args=parser.parse_args()
    url=os.environ.get('TRATO_REDIS_URL','')
    if not url.startswith(('redis://','rediss://')):raise ValueError('Configura TRATO_REDIS_URL explícitamente.')
    redis=Redis.from_url(url,decode_responses=True,socket_connect_timeout=5,socket_timeout=10)
    try:
        pump=BackendPump(ThreadStore(Settings.from_env()),redis);pump.setup()
        while True:
            try:
                pump.publish_once();pump.consume_once()
            except (ApiError,ConnectionError,TimeoutError):
                print(json.dumps({'error':{'code':'THREAD_BACKEND_UNAVAILABLE'},'pending_preserved':True}),flush=True)
                if args.once:raise
                time.sleep(1)
            if args.once:return
    finally:redis.close()


if __name__=='__main__':main()
