"""Private, idempotent rehearsal evaluation jobs on Trato's existing durable Redis."""
from hashlib import sha256
import json
import os
from redis import Redis
from redis.exceptions import RedisError
from .errors import ApiError

PREFIX = 'trato:ai:job:'
STREAM = 'trato:ai:jobs'
TTL = 86400
ENQUEUE = '''
if redis.call('EXISTS',KEYS[1])==1 then
 if redis.call('HGET',KEYS[1],'owner')~=ARGV[1] then return -1 end
 if redis.call('HGET',KEYS[1],'digest')~=ARGV[2] then return -2 end
 return 0
end
redis.call('HSET',KEYS[1],'owner',ARGV[1],'digest',ARGV[2],'input',ARGV[3],'status','queued')
redis.call('EXPIRE',KEYS[1],ARGV[4])
redis.call('XADD',KEYS[2],'*','job_id',ARGV[5])
return 1
'''


class AIJobs:
    def __init__(self, redis=None):
        self.redis = redis

    def connection(self):
        if os.getenv('TRATO_AI_WORKFLOWS_ENABLED') != 'true':
            raise ApiError('AI_EVALUATOR_NOT_CONFIGURED', 503)
        if self.redis is None:
            url = os.getenv('TRATO_REDIS_URL', '')
            if not url.startswith(('redis://', 'rediss://')):
                raise ApiError('AI_EVALUATOR_NOT_CONFIGURED', 503)
            self.redis = Redis.from_url(url, decode_responses=True, socket_connect_timeout=5, socket_timeout=10)
        return self.redis

    def enqueue(self, owner, job_id, data):
        body = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
        digest = sha256(body.encode()).hexdigest()
        try:
            redis=self.connection()
            if not redis.exists(PREFIX+job_id) and not redis.get('trato:ai:consumer:ready'):
                raise ApiError('AI_EVALUATOR_NOT_CONFIGURED',503)
            result = redis.eval(ENQUEUE, 2, PREFIX + job_id, STREAM, owner, digest, body, TTL, job_id)
            if result == -1: raise ApiError('AI_NOT_FOUND', 404)
            if result == -2: raise ApiError('AI_CONFLICT', 409)
            return self.get(owner, job_id)
        except RedisError: raise ApiError('AI_QUEUE_UNAVAILABLE', 503) from None

    def get(self, owner, job_id, action=None):
        try: row = self.connection().hgetall(PREFIX + job_id)
        except RedisError: raise ApiError('AI_QUEUE_UNAVAILABLE', 503) from None
        if not row or row.get('owner') != owner: raise ApiError('AI_NOT_FOUND', 404)
        if action is not None:
            try: kind = json.loads(row['input']).get('workflow')
            except (KeyError, ValueError): raise ApiError('AI_JOB_INVALID', 502) from None
            if kind != action: raise ApiError('AI_NOT_FOUND', 404)
        status = row['status']
        if status not in ('queued', 'running', 'completed', 'failed'):
            raise ApiError('AI_JOB_INVALID', 502)
        result = {'id': job_id, 'status': status}
        if status == 'completed':
            try: result['result'] = json.loads(row['result'])
            except (KeyError, ValueError): raise ApiError('AI_JOB_INVALID', 502) from None
        if status == 'failed': result['error_code'] = row.get('error_code', 'AI_EVALUATION_FAILED')
        return result

    def input(self, owner, job_id):
        self.get(owner, job_id)
        try: return json.loads(self.connection().hgetall(PREFIX + job_id)['input'])
        except (RedisError, KeyError, ValueError): raise ApiError('AI_JOB_INVALID', 502) from None
