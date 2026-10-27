"""Internal generic thread dispatcher. Simulation storage is isolated from business data."""
from contextlib import contextmanager
from datetime import datetime, timezone
from hashlib import sha256
import fcntl
import json
import os
from pathlib import Path
import sqlite3
from typing import Literal
from uuid import UUID, uuid5, NAMESPACE_URL

from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.types import Command
from langsmith import tracing_context
from pydantic import Field, model_validator

from .ingestion import Context, DocumentInput, IngestionFailure, StrictModel, build_ingestion
from .change_flow import ChangeInput, build_change_flow, validate_resume
from .refund_flow import RefundInput, build_refund_flow, validate_refund_resume


class Thread(StrictModel):
    type: Literal['thread']
    schema_version: Literal[1]
    mode: Literal['simulation']
    thread_id: str
    event_id: str
    action: Literal['start', 'get', 'resume']
    workflow: str = Field(min_length=1, max_length=64)
    context: Context
    payload: dict

    @model_validator(mode='after')
    def ids(self):
        for value in (self.thread_id, self.event_id):
            if str(UUID(value)) != value:
                raise ValueError('Identificador de thread/evento inválido.')
        if len(json.dumps(self.payload).encode()) > 16000:
            raise ValueError('El thread debe contener metadatos acotados.')
        return self


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False)


# A new workflow registers a builder/validator, not another event class.
HANDLERS = {'ingest_document': (build_ingestion, DocumentInput),
            'manage_change': (build_change_flow, ChangeInput),
            'manage_refund': (build_refund_flow, RefundInput)}


class ThreadWorker:
    mode = 'simulation'
    validate_envelope = staticmethod(Thread.model_validate)
    def __init__(self, database, *, mode):
        if mode != 'simulation':
            raise ValueError('El worker de prueba solo admite simulación explícita.')
        self.database = Path(database)
        self.database.parent.mkdir(parents=True, exist_ok=True, mode=0o700)

    @contextmanager
    def connection(self):
        # Cross-process lock for this local SQLite simulation, not a distributed lease.
        with open(str(self.database) + '.lock', 'a') as lock:
            os.chmod(lock.name, 0o600)
            fcntl.flock(lock, fcntl.LOCK_EX)
            db = sqlite3.connect(self.database, check_same_thread=False, timeout=30)
            os.chmod(self.database, 0o600)
            try:
                db.execute('CREATE TABLE IF NOT EXISTS simulation_threads (id TEXT PRIMARY KEY, binding TEXT NOT NULL, input_hash TEXT NOT NULL, failure_code TEXT)')
                db.execute('CREATE TABLE IF NOT EXISTS simulation_events (id TEXT PRIMARY KEY, request_hash TEXT NOT NULL, response TEXT NOT NULL)')
                db.execute('CREATE TABLE IF NOT EXISTS simulation_change_requests (request_id TEXT PRIMARY KEY, thread_id TEXT NOT NULL)')
                db.commit()
                yield db
            finally:
                db.close()

    def handle(self, raw, on_progress=None):
        message = Thread.model_validate(raw)
        if message.workflow not in HANDLERS:
            raise ValueError('Workflow no registrado.')
        builder, validator = HANDLERS[message.workflow]
        document = validator.model_validate(message.payload).model_dump() if message.action == 'start' else None
        if message.action == 'get' and message.payload:
            raise ValueError('La consulta de estado no admite payload.')
        context = message.context.model_dump()
        binding = canonical({'context': context, 'workflow': message.workflow, 'mode': message.mode})
        request_hash = sha256(canonical(message.model_dump()).encode()).hexdigest()
        with self.connection() as db, tracing_context(enabled=False):
            previous = db.execute('SELECT request_hash,response FROM simulation_events WHERE id=?', (message.event_id,)).fetchone()
            if previous:
                if previous[0] != request_hash:
                    raise ValueError('El event_id ya corresponde a otra orden.')
                return json.loads(previous[1])
            row = db.execute('SELECT binding,input_hash,failure_code FROM simulation_threads WHERE id=?', (message.thread_id,)).fetchone()
            if row and row[0] != binding:
                raise PermissionError('El thread no corresponde a este contexto.')
            input_hash = sha256(canonical(document).encode()).hexdigest() if document else None
            if row and message.action == 'start' and row[1] != input_hash:
                raise ValueError('No se puede reemplazar el documento de un thread existente.')
            if not row:
                if message.action != 'start':
                    raise ValueError('Thread no encontrado.')
                if message.workflow in ('manage_change', 'manage_refund'):
                    existing = db.execute('SELECT thread_id FROM simulation_change_requests WHERE request_id=?',
                                          (document['request_id'],)).fetchone()
                    if existing:
                        raise ValueError('La solicitud ya tiene un thread; un ajuste posterior requiere otra solicitud.')
                    db.execute('INSERT INTO simulation_change_requests VALUES(?,?)', (document['request_id'], message.thread_id))
                db.execute('INSERT INTO simulation_threads(id,binding,input_hash) VALUES(?,?,?)',
                           (message.thread_id, binding, input_hash))
                db.commit()
            saver = SqliteSaver(db)
            graph = builder(saver)
            config = {'configurable': {'thread_id': message.thread_id}}
            current = graph.get_state(config)
            failure = row[2] if row else None
            resume = None
            if message.action == 'resume':
                pending = [item for task in current.tasks for item in task.interrupts]
                if failure or message.workflow not in ('manage_change', 'manage_refund') or len(pending) != 1:
                    raise ValueError('El thread no tiene una revisión pendiente; los cambios finalizados son de consulta.')
                if set(message.payload) != {'interrupt_id', 'input'} or message.payload['interrupt_id'] != pending[0].id:
                    raise ValueError('La respuesta no corresponde a la revisión pendiente actual.')
                validator_resume = validate_refund_resume if message.workflow == 'manage_refund' else validate_resume
                resume = validator_resume(pending[0].value['stage'], message.payload['input'])
            if message.action in ('start', 'resume') and not failure:
                initial = {'context': context, 'document': document, 'status': 'queued', 'steps': []}
                # Continue persisted nodes after a process restart, not the whole graph.
                invocation = Command(resume=resume) if resume is not None else initial if not current.values else None
                if message.action == 'start' and any(task.interrupts for task in current.tasks):
                    invocation = None
                if invocation is not None or current.next:
                    # A redelivered start cannot act as approval of a persisted interrupt.
                    if resume is None and any(task.interrupts for task in current.tasks):
                        invocation = None
                        should_run = False
                    else:
                        should_run = True
                    try:
                        for update in graph.stream(invocation, config, stream_mode='updates') if should_run else []:
                            if on_progress:
                                for step in update:
                                    if step != '__interrupt__':
                                        on_progress(self.event(message, 'progress', {'status': 'processing', 'step': step}, suffix=step))
                    except IngestionFailure as error:
                        failure = error.code
                        db.execute('UPDATE simulation_threads SET failure_code=? WHERE id=?', (failure, message.thread_id))
                        db.commit()
            current = graph.get_state(config)
            values = current.values
            pending = [{**item.value, 'interrupt_id': item.id} for task in current.tasks for item in task.interrupts]
            if failure:
                result = {'status': 'error', 'error_code': failure, 'document': values.get('document'),
                          'steps': values.get('steps', []), 'index_status': 'not_indexed'}
            else:
                chunks = values.get('chunks', [])
                result = {'status': values.get('status', 'queued'), 'document': values.get('document'),
                          'steps': values.get('steps', []), 'extraction': values.get('extraction'),
                          'chunks': chunks, 'chunk_count': len(chunks), 'index_status': 'not_indexed',
                          'relevance': values.get('relevance'),
                          'identity_verified': False, 'signature_verified': False}
            if message.workflow in ('manage_change', 'manage_refund') and not failure:
                result = {key: values.get(key) for key in ('status', 'steps', 'analysis', 'proposal', 'revisions', 'draft_snapshots', 'events', 'sources')}
                result['request_id'] = values.get('document', {}).get('request_id')
                if message.workflow == 'manage_refund':
                    result.update({key: values.get(key) for key in ('business_status', 'case', 'policy_sources', 'calculation', 'refund', 'blocked_reason')})
                result['read_only'] = result['status'] in ('ready', 'rejected', 'refund_failed', 'not_relevant', 'blocked')
                result['provider_verified'] = False
                result['pending'] = pending[0] if pending else None
                if pending:
                    result['status'] = 'awaiting_review'
            response = self.event(message, 'failed' if failure or result['status']=='refund_failed' else 'awaiting_review' if pending else 'completed' if result['status'] in ('ready', 'rejected') else 'held' if result['status'] in ('not_relevant', 'needs_clarification', 'blocked') else 'snapshot', result)
            db.execute('INSERT INTO simulation_events(id,request_hash,response) VALUES(?,?,?)',
                       (message.event_id, request_hash, canonical(response)))
            db.commit()
            return response

    @staticmethod
    def event(message, action, result, suffix='result'):
        return {'type': 'thread', 'schema_version': 1, 'mode': 'simulation', 'workflow': message.workflow,
                'thread_id': message.thread_id, 'event_id': str(uuid5(NAMESPACE_URL, message.event_id + ':' + suffix)),
                'causation_id': message.event_id, 'context': message.context.model_dump(),
                'action': action, 'created_at': datetime.now(timezone.utc).isoformat(), 'result': result}
