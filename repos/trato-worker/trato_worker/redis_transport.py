"""Redis Streams transport, exclusively for explicitly selected simulation."""
import json
from uuid import uuid4
from redis import Redis
from redis.exceptions import ResponseError
from .threads import Thread

COMMANDS = 'trato:simulation:thread:commands'
EVENTS = 'trato:simulation:thread:events'
GROUP = 'trato-simulation-workers'


class RedisTransport:
    def __init__(self, url, worker, consumer=None):
        if not url or not url.startswith(('redis://', 'rediss://')):
            raise ValueError('Configura una URL Redis explícita; no se cambia a otro transporte.')
        self.redis = Redis.from_url(url, decode_responses=True, socket_connect_timeout=5, socket_timeout=10)
        self.worker = worker
        if worker.mode not in ('simulation', 'connected'):
            raise ValueError('Modo de transporte explícito no admitido.')
        prefix = 'trato:' + worker.mode + ':thread:'
        self.commands, self.events = prefix + 'commands', prefix + 'events'
        self.group = 'trato-' + worker.mode + '-workers'
        self.consumer = consumer or str(uuid4())
        self.claim_cursor = '0-0'

    def setup(self):
        try:
            self.redis.xgroup_create(self.commands, self.group, id='0', mkstream=True)
        except ResponseError as error:
            if not str(error).startswith('BUSYGROUP'):
                raise

    def publish(self, raw):
        message = self.worker.validate_envelope(raw)
        if message.action not in ('start', 'resume', 'get'):
            raise ValueError('Acción de thread no admitida.')
        return self.redis.xadd(self.commands, {'thread': message.model_dump_json()})

    def process_once(self, *, recover_idle_ms=120000, block_ms=1000):
        if recover_idle_ms < 1 or not 1 <= block_ms <= 5000:
            raise ValueError('Límites del consumidor inválidos.')
        # Keep scanning the pending list across calls, including large queues.
        claimed = self.redis.xautoclaim(self.commands, self.group, self.consumer, recover_idle_ms,
                                        start_id=self.claim_cursor, count=1)
        self.claim_cursor = claimed[0]
        items = claimed[1]
        if not items:
            batches = self.redis.xreadgroup(self.group, self.consumer, {self.commands: '>'}, count=1, block=block_ms)
            items = batches[0][1] if batches else []
        if not items:
            return None
        identifier, fields = items[0]
        try:
            raw = json.loads(fields['thread'])
            self.worker.validate_envelope(raw)
        except (KeyError, ValueError, TypeError):
            # Reject poison messages without exposing their content.
            result = {'type': 'thread', 'mode': self.worker.mode, 'action': 'rejected',
                      'command_ref': identifier, 'error_code': 'INVALID_THREAD'}
        else:
            try:
                result = self.worker.handle(raw, on_progress=lambda value: self.redis.xadd(self.events, {'thread': json.dumps(value)}))
            except (ValueError, PermissionError):
                result = {'type': 'thread', 'mode': self.worker.mode, 'action': 'rejected',
                          'command_ref': identifier, 'error_code': 'INVALID_THREAD'}
        # If processing or publication fails, leave the command pending for recovery.
        # Consumers of events must also deduplicate using event_id.
        with self.redis.pipeline(transaction=True) as pipe:
            pipe.xadd(self.events, {'thread': json.dumps(result)})
            pipe.xack(self.commands, self.group, identifier)
            pipe.execute()
        return result

    def close(self):
        self.redis.close()
