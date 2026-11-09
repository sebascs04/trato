"""Independent rehearsal stream consumed by the worker, without financial tools."""
import json
import os
import threading
import time
from uuid import UUID, uuid4
from dataclasses import replace
from .gemini import GeminiLangChainModel, GeminiUnavailableError, GeminiConfigurationError
from redis.exceptions import RedisError, ResponseError
from .source_tools import BackendToolClient, ToolError
from .business_ai import run_business_ai

PREFIX = 'trato:ai:job:'
STREAM = 'trato:ai:jobs'
GROUP = 'trato-business-ai'
# A running job without a heartbeat for STALE_SECONDS is marked AI_INTERRUPTED by the next recovery.
STALE_SECONDS = 120
# Stream entries idle this long are re-read by recovery; slightly above STALE_SECONDS.
RECOVERY_IDLE_MS = 130000
HEARTBEAT_SECONDS = 15
# The heartbeat stops when one step (a model call or a backend request) runs longer than this,
# so a blocked call is released by recovery. Longest bounded step: the 550 s index request.
STEP_LIMIT_SECONDS = 660
CLAIM = '''
local status=redis.call('HGET',KEYS[1],'status')
if status=='queued' then
 redis.call('HSET',KEYS[1],'status','running','started_at',ARGV[1]) return 1
end
if status=='running' then
 if tonumber(ARGV[1])-tonumber(redis.call('HGET',KEYS[1],'started_at') or ARGV[1])>tonumber(ARGV[2]) then
  redis.call('HSET',KEYS[1],'status','failed','error_code','AI_INTERRUPTED')
  return 0
 end
 return 2
end
return 0
'''
# CLAIM result 2: the job has a recent heartbeat. Keep its stream entry pending: the owner acknowledges it when it finishes,
# and if the owner died, the next recovery sees a stale heartbeat and marks the job failed. Acknowledging here would orphan it.
FINISH = '''
if redis.call('HGET',KEYS[1],'status')~='running' or redis.call('HGET',KEYS[1],'execution_id')~=ARGV[1] then return 0 end
redis.call('HSET',KEYS[1],'status',ARGV[2],ARGV[3],ARGV[4])
if ARGV[2]=='completed' then
 local now=redis.call('TIME')
 redis.call('HSET',KEYS[1],'completed_at',now[1]..'.'..string.format('%06d',tonumber(now[2])))
end
return 1
'''
BEAT = '''
if redis.call('HGET',KEYS[1],'status')~='running' or redis.call('HGET',KEYS[1],'execution_id')~=ARGV[1] then return 0 end
redis.call('HSET',KEYS[1],'started_at',ARGV[2])
return 1
'''


class _Steps:
    """Records when the current step started; a step is one call of the wrapped method."""
    def __init__(self):
        self.lock, self.active, self.started = threading.Lock(), 0, time.monotonic()

    def wrap(self, target, method):
        steps = self
        class Tracked:
            def __getattr__(_, name): return getattr(target, name)
        def call(*args, **kwargs):
            with steps.lock:
                steps.active += 1
                if steps.active == 1: steps.started = time.monotonic()
            try: return getattr(target, method)(*args, **kwargs)
            finally:
                with steps.lock:
                    steps.active -= 1
                    steps.started = time.monotonic()
        tracked = Tracked()
        setattr(tracked, method, call)
        return tracked

    def within_limit(self):
        # Measured from the start of the running step, or from the end of the last one when idle.
        with self.lock: return time.monotonic() - self.started < STEP_LIMIT_SECONDS


class _Heartbeat(threading.Thread):
    """Keeps a live job's lease fresh between progress updates; never touches another execution."""
    def __init__(self, redis, key, execution_id, steps):
        super().__init__(daemon=True)
        self.redis, self.key, self.execution_id, self.steps = redis, key, execution_id, steps
        self.stopped = threading.Event()

    def run(self):
        while not self.stopped.wait(HEARTBEAT_SECONDS):
            if not self.steps.within_limit(): return
            try:
                if self.redis.eval(BEAT, 1, self.key, self.execution_id, time.time()) != 1: return
                self.redis.set('trato:ai:consumer:ready', '1', ex=900)
            except RedisError:
                continue

    def stop(self):
        self.stopped.set()
        if self.is_alive(): self.join(timeout=5)


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
        recovered = self.redis.xautoclaim(STREAM, GROUP, self.consumer, RECOVERY_IDLE_MS, start_id='0-0', count=1)[1]
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
        claim = self.redis.eval(CLAIM, 1, key, time.time(), STALE_SECONDS)
        if claim == 2: return True
        if claim != 1:
            self.redis.xack(STREAM, GROUP, entry_id); return True
        execution_id = str(uuid4())
        self.redis.hset(key, 'execution_id', execution_id)
        steps = _Steps()
        beat = _Heartbeat(self.redis, key, execution_id, steps)
        beat.start()
        try: return self._run(entry_id, job_id, key, execution_id, steps)
        finally: beat.stop()

    def _backend(self, steps):
        return steps.wrap(self.client if self.client is not None else BackendToolClient.from_env(), 'request')

    def _run(self, entry_id, job_id, key, execution_id, steps):
        def finish(status, field, value):
            self.redis.eval(FINISH, 1, key, execution_id, status, field, value)
        data = {}
        def archive(**outcome):
            if data.get('case_context') is None:return
            client=self._backend(steps)
            receipt=client.request('POST','/internal/case-assistant/'+job_id+'/complete',
                json={'execution_id':execution_id,**outcome})
            if receipt!={'stored':True}:raise ToolError('AI_CASE_ARCHIVE_FAILED')
        def fail(code):
            # Persist before changing the active lease; never repeat model inference.
            try:archive(error_code=code)
            except ToolError:code='AI_CASE_ARCHIVE_FAILED'
            finish('failed','error_code',code)
        try:
            raw = self.redis.hget(key, 'input')
            data = json.loads(raw)
            if data.get('workflow') in ('index_document','index_reputation'):
                client = self._backend(steps)
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
            selected_model = steps.wrap(selected_model, 'generate')
            try:
                if data.get('workflow')=='project_assistant':
                    from .project_assistant import run_project_assistant
                    client=self._backend(steps)
                    if data.get('action')=='draft_change':
                        from .change_proposal import run_change_proposal
                        result=run_change_proposal(data,selected_model,client,job_id,execution_id)
                    else:result=run_project_assistant(data,selected_model,client,job_id,execution_id)
                elif data.get('workflow')=='dispute_defense':
                    from .dispute_defense import run_dispute_defense
                    client=self._backend(steps)
                    result=run_dispute_defense(data,selected_model,client,job_id,execution_id)
                elif data.get('workflow')=='section_help':
                    from .section_help import run_section_help
                    result=run_section_help(data,selected_model)
                elif data.get('workflow')=='invoice_concept':
                    from .invoice_concept import run_invoice_concept
                    result=run_invoice_concept(data,selected_model)
                elif data.get('workflow')=='portal_assistant':
                    from .portal_assistant import run_portal_assistant
                    result=run_portal_assistant(data,selected_model)
                elif data.get('workflow')=='change_reply':
                    from .change_reply import run_change_reply
                    result=run_change_reply(data,selected_model)
                elif data.get('workflow')=='process_file':
                    if os.getenv('TRATO_FILE_PROCESSING_ENABLED')!='true':raise ToolError('FILE_PROCESSING_NOT_CONFIGURED')
                    from .file_pipeline.runtime import build_file_pipeline
                    from .file_pipeline.backend import BackendFileClient
                    from .file_pipeline.contracts import PURPOSES
                    client=self._backend(steps)
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
            archive(result=result)
            finish('completed', 'result', json.dumps(result, ensure_ascii=False))
        except ToolError as e:
            fail(e.code)
        except (GeminiUnavailableError, GeminiConfigurationError):
            fail('MODEL_REQUEST_FAILED')
        except (ValueError, KeyError, TypeError):
            fail('AI_FAILED')
        except RedisError:
            raise  # The entry stays pending; recovery decides once the queue is back.
        except Exception as e:
            # An unexpected error is the job's visible failure, not the end of the consumer.
            print(json.dumps({'error': {'code': 'AI_FAILED', 'type': type(e).__name__, 'job_id': job_id}}), flush=True)
            fail('AI_FAILED')
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
