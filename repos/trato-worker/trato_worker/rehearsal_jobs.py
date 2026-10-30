"""Independent rehearsal stream consumed by the worker, without financial tools."""
import json
import os
import time
from uuid import UUID, uuid4
from redis.exceptions import ResponseError
from .source_tools import BackendToolClient, ToolError
from .rehearsal_evaluation import RehearsalModel, evaluate_rehearsal

PREFIX = 'trato:rehearsal:evaluation:'
STREAM = 'trato:rehearsal:evaluations'
GROUP = 'trato-rehearsal-evaluators'
CLAIM = '''
local status=redis.call('HGET',KEYS[1],'status')
if status=='queued' then
 redis.call('HSET',KEYS[1],'status','running','started_at',ARGV[1]) return 1
end
if status=='running' and tonumber(ARGV[1])-tonumber(redis.call('HGET',KEYS[1],'started_at') or ARGV[1])>600 then
 redis.call('HSET',KEYS[1],'status','failed','error_code','REHEARSAL_EVALUATION_INTERRUPTED')
end
return 0
'''


class RehearsalConsumer:
    def __init__(self, redis, client, model, consumer=None):
        self.redis, self.client, self.model = redis, client, model
        self.consumer = consumer or str(uuid4())

    def setup(self):
        try: self.redis.xgroup_create(STREAM, GROUP, id='0', mkstream=True)
        except ResponseError as e:
            if not str(e).startswith('BUSYGROUP'): raise

    def process_once(self):
        recovered = self.redis.xautoclaim(STREAM, GROUP, self.consumer, 610000, start_id='0-0', count=1)[1]
        if not recovered:
            batches = self.redis.xreadgroup(GROUP, self.consumer, {STREAM: '>'}, count=1)
            recovered = batches[0][1] if batches else []
        if not recovered: return False
        entry_id, fields = recovered[0]
        job_id = fields.get('job_id', '')
        try:
            if str(UUID(job_id)) != job_id: raise ValueError()
        except (ValueError, TypeError):
            self.redis.xack(STREAM, GROUP, entry_id); return True
        key = PREFIX + job_id
        if self.redis.eval(CLAIM, 1, key, time.time()) != 1:
            self.redis.xack(STREAM, GROUP, entry_id); return True
        try:
            raw = self.redis.hget(key, 'input')
            data = json.loads(raw)
            result = evaluate_rehearsal(data, self.client, self.model)
            self.redis.hset(key, mapping={'status': 'completed', 'result': json.dumps(result, ensure_ascii=False)})
        except ToolError as e:
            self.redis.hset(key, mapping={'status': 'failed', 'error_code': e.code})
        except (ValueError, KeyError, TypeError):
            self.redis.hset(key, mapping={'status': 'failed', 'error_code': 'REHEARSAL_EVALUATION_FAILED'})
        # Never retry a failed/incomplete model call automatically after recovery.
        self.redis.xack(STREAM, GROUP, entry_id)
        self.redis.xdel(STREAM, entry_id)
        return True

    @classmethod
    def from_env(cls, redis):
        return cls(redis, BackendToolClient.from_env(), RehearsalModel(os.environ.get('TRATO_REHEARSAL_OLLAMA_URL', '')))


def main():
    from redis import Redis
    from redis.exceptions import RedisError
    if os.environ.get('TRATO_REHEARSAL_EVALUATOR_ENABLED') != 'true':
        raise SystemExit('Rehearsal evaluator is not explicitly enabled.')
    url = os.environ.get('TRATO_REDIS_URL', '')
    if not url.startswith(('redis://', 'rediss://')): raise SystemExit('Rehearsal queue is not configured.')
    redis = Redis.from_url(url, decode_responses=True, socket_connect_timeout=5, socket_timeout=10)
    consumer = RehearsalConsumer.from_env(redis)
    try:
        consumer.setup()
        while True:
            try:
                redis.set('trato:rehearsal:consumer:ready', '1', ex=360)
                if not consumer.process_once(): time.sleep(.5)
            except RedisError:
                print(json.dumps({'error': {'code': 'REHEARSAL_QUEUE_UNAVAILABLE'}}), flush=True)
                time.sleep(1)
    finally: redis.close()


if __name__ == '__main__': main()
