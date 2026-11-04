"""Independent rehearsal stream consumed by the worker, without financial tools."""
import json
import os
import time
from uuid import UUID, uuid4
from dataclasses import replace
from .gemini import GeminiLangChainModel, GeminiUnavailableError, GeminiConfigurationError
from redis.exceptions import ResponseError
from .source_tools import BackendToolClient, ToolError
from .rehearsal_evaluation import RehearsalModel, evaluate_rehearsal
from .rehearsal_dialogue import DialogueModel, reply_rehearsal

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
    def __init__(self, redis, client, model, consumer=None, reply_model=None):
        self.redis, self.client, self.model = redis, client, model
        self.reply_model = reply_model if reply_model is not None else model
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
            selected_model = self.reply_model if data.get('action') == 'reply' else self.model
            temporary_model = None
            if isinstance(selected_model, GeminiLangChainModel):
                model_id = data.get('model_id')
                allowed = os.getenv('TRATO_TEST_MODEL_IDS', '').split(',')
                if model_id not in allowed or model_id not in ('gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.5-flash', 'gemini-3.6-flash', 'gemini-3.7-flash', 'gemini-3.1-pro-preview', 'gemini-4-argon'):
                    raise ToolError('MODEL_SELECTION_UNAVAILABLE')
                temporary_model = GeminiLangChainModel(replace(selected_model.config, model=model_id), max_output_tokens=4096 if data.get('action')=='reply' else 12288)
                selected_model = temporary_model
            try:
                result = reply_rehearsal(data, selected_model) if data.get('action') == 'reply' else evaluate_rehearsal(data, self.client if self.client is not None else BackendToolClient.from_env(), selected_model)
            finally:
                if temporary_model is not None: temporary_model.close()
            self.redis.hset(key, mapping={'status': 'completed', 'result': json.dumps(result, ensure_ascii=False)})
        except ToolError as e:
            self.redis.hset(key, mapping={'status': 'failed', 'error_code': e.code})
        except (GeminiUnavailableError, GeminiConfigurationError):
            self.redis.hset(key, mapping={'status': 'failed', 'error_code': 'MODEL_REQUEST_FAILED'})
        except (ValueError, KeyError, TypeError):
            self.redis.hset(key, mapping={'status': 'failed', 'error_code': 'REHEARSAL_EVALUATION_FAILED'})
        # Never retry a failed/incomplete model call automatically after recovery.
        self.redis.xack(STREAM, GROUP, entry_id)
        self.redis.xdel(STREAM, entry_id)
        return True

    @classmethod
    def from_env(cls, redis):
        provider = os.getenv('TRATO_MODEL_PROVIDER', '')
        if provider == 'gemini':
            model = GeminiLangChainModel()
            return cls(redis, None, model, reply_model=model)
        if provider == 'ollama':
            url = os.environ.get('TRATO_REHEARSAL_OLLAMA_URL', '')
            return cls(redis, BackendToolClient.from_env(), RehearsalModel(url), reply_model=DialogueModel(url))
        raise ValueError('Configure TRATO_MODEL_PROVIDER explicitly.')


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
