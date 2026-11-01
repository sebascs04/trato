"""Independent rehearsal stream consumed by the worker, without financial tools."""
import json
import os
import time
from uuid import UUID, uuid4
from dataclasses import replace
from .gemini import GeminiLangChainModel, GeminiUnavailableError, GeminiConfigurationError
from redis.exceptions import ResponseError
from .source_tools import BackendToolClient, ToolError
from .business_ai import run_business_ai

PREFIX = 'trato:ai:job:'
STREAM = 'trato:ai:jobs'
GROUP = 'trato-business-ai'
CLAIM = '''
local status=redis.call('HGET',KEYS[1],'status')
if status=='queued' then
 redis.call('HSET',KEYS[1],'status','running','started_at',ARGV[1]) return 1
end
if status=='running' and tonumber(ARGV[1])-tonumber(redis.call('HGET',KEYS[1],'started_at') or ARGV[1])>600 then
 redis.call('HSET',KEYS[1],'status','failed','error_code','AI_INTERRUPTED')
end
return 0
'''
FINISH = '''
if redis.call('HGET',KEYS[1],'status')~='running' or redis.call('HGET',KEYS[1],'execution_id')~=ARGV[1] then return 0 end
redis.call('HSET',KEYS[1],'status',ARGV[2],ARGV[3],ARGV[4]) return 1
'''


class AIConsumer:
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
        execution_id = str(uuid4())
        self.redis.hset(key, 'execution_id', execution_id)
        def finish(status, field, value):
            self.redis.eval(FINISH, 1, key, execution_id, status, field, value)
        try:
            raw = self.redis.hget(key, 'input')
            data = json.loads(raw)
            if data.get('workflow') in ('index_document','index_reputation'):
                client = self.client if self.client is not None else BackendToolClient.from_env()
                result = client.request('POST', '/internal/vector-jobs/' + job_id + '/execute',
                                        timeout=550, json={'execution_id': execution_id})
                valid = (isinstance(result,dict) and result.get('status')=='ready' and
                    ((data['workflow']=='index_document' and result.get('kind')=='document_index' and
                      result.get('id')==data['file_id'] and result.get('generation')==data['generation']) or
                     (data['workflow']=='index_reputation' and result.get('kind')=='reputation_index' and
                      result.get('profile_id')==data['profile_id'])))
                if not valid:
                    raise ToolError('VECTOR_INDEX_INCOMPLETE')
                finish('completed', 'result', json.dumps(result))
                self.redis.xack(STREAM, GROUP, entry_id)
                self.redis.xdel(STREAM, entry_id)
                return True
            selected_model = self.reply_model if data.get('action') == 'reply' else self.model
            temporary_model = None
            if isinstance(selected_model, GeminiLangChainModel):
                model_id = data.get('model_id')
                allowed = os.getenv('TRATO_TEST_MODEL_IDS', '').split(',')
                if model_id not in allowed or model_id not in ('gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.5-flash', 'gemini-3.6-flash', 'gemini-3.7-flash', 'gemini-3.1-pro-preview', 'gemini-4-argon'):
                    raise ToolError('MODEL_SELECTION_UNAVAILABLE')
                temporary_model = GeminiLangChainModel(replace(selected_model.config, model=model_id), max_output_tokens=8192)
                selected_model = temporary_model
            try:
                if data.get('workflow')=='process_file':
                    if os.getenv('TRATO_FILE_PROCESSING_ENABLED')!='true':raise ToolError('FILE_PROCESSING_NOT_CONFIGURED')
                    from .file_pipeline.runtime import build_file_pipeline
                    from .file_pipeline.backend import BackendFileClient
                    from .file_pipeline.contracts import PURPOSES
                    client=self.client if self.client is not None else BackendToolClient.from_env()
                    def heartbeat(phase=None):
                        if self.redis.hget(key,'execution_id')!=execution_id or self.redis.hget(key,'status')!='running':
                            raise ToolError('FILE_JOB_NOT_ACTIVE')
                        self.redis.hset(key,mapping={'started_at':time.time(),**({'phase':phase} if phase else {})})
                        self.redis.set('trato:ai:consumer:ready','1',ex=900)
                    class ProgressModel:
                        name=selected_model.name
                        def generate(_,messages,schema):
                            heartbeat();output=selected_model.generate(messages,schema);heartbeat();return output
                    pipeline=build_file_pipeline(BackendFileClient(client),ProgressModel(),
                        model_identity=selected_model.name,maximum_input_bytes=600000,
                        enabled_purposes=tuple(sorted(PURPOSES)))
                    event=pipeline.run(data['thread'],on_progress=lambda update:heartbeat(update['phase']))
                    if event.get('lease_id') is not None:
                        receipt=client.request('POST','/internal/file-processing/'+job_id+'/outcome',
                            json={'execution_id':execution_id,'event':event})
                        if receipt!={'stored':True,'status':event['result']['status']}:raise ToolError('FILE_OUTCOME_INVALID')
                    if event['action']=='failed':raise ToolError(event['result'].get('error_code','FILE_PROCESSING_FAILED'))
                    result={'kind':'file_processing',**event['result']}
                else:
                    result = run_business_ai(data, selected_model)
            finally:
                if temporary_model is not None: temporary_model.close()
            finish('completed', 'result', json.dumps(result, ensure_ascii=False))
        except ToolError as e:
            finish('failed', 'error_code', e.code)
        except (GeminiUnavailableError, GeminiConfigurationError):
            finish('failed', 'error_code', 'MODEL_REQUEST_FAILED')
        except (ValueError, KeyError, TypeError):
            finish('failed', 'error_code', 'AI_FAILED')
        # Never retry a failed/incomplete model call automatically after recovery.
        self.redis.xack(STREAM, GROUP, entry_id)
        self.redis.xdel(STREAM, entry_id)
        return True

    @classmethod
    def from_env(cls, redis):
        if os.getenv('TRATO_MODEL_PROVIDER')!='gemini':raise ValueError('AI workflows require the explicitly configured Gemini provider.')
        return cls(redis, None, GeminiLangChainModel())


def main():
    from redis import Redis
    from redis.exceptions import RedisError
    if os.environ.get('TRATO_AI_WORKFLOWS_ENABLED') != 'true':
        raise SystemExit('AI workflows are not explicitly enabled.')
    url = os.environ.get('TRATO_REDIS_URL', '')
    if not url.startswith(('redis://', 'rediss://')): raise SystemExit('AI queue is not configured.')
    redis = Redis.from_url(url, decode_responses=True, socket_connect_timeout=5, socket_timeout=10)
    consumer = AIConsumer.from_env(redis)
    try:
        consumer.setup()
        while True:
            try:
                redis.set('trato:ai:consumer:ready', '1', ex=900)
                if not consumer.process_once(): time.sleep(.5)
            except RedisError:
                print(json.dumps({'error': {'code': 'AI_QUEUE_UNAVAILABLE'}}), flush=True)
                time.sleep(1)
    finally: redis.close()


if __name__ == '__main__': main()
