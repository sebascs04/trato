"""Real PDF extraction workflow. No semantic simulation, LLM call or user JWT."""
from hashlib import sha256
from typing import Literal
from uuid import UUID, uuid4
import httpx
from langchain_core.runnables import RunnableLambda
from langgraph.graph import StateGraph, START, END
from langsmith import tracing_context
from pydantic import Field, model_validator
from .ingestion import Context, StrictModel


class ConnectedPayload(StrictModel):
    document_id: str
    extraction_id: str
    kind: Literal['initial_agreement','email_request','reference','addendum','delivery']
    sha256: str = Field(pattern='^[a-f0-9]{64}$')

    @model_validator(mode='after')
    def ids(self):
        if any(str(UUID(v)) != v for v in (self.document_id,self.extraction_id)):
            raise ValueError('Documento/extracción inválidos.')
        return self


class GraphPayload(StrictModel):
    project_id: str
    generation: int = Field(ge=1)
    content_hash: str = Field(pattern='^[a-f0-9]{64}$')


class ConnectedThread(StrictModel):
    type: Literal['thread']
    schema_version: Literal[1]
    mode: Literal['connected']
    thread_id: str
    event_id: str
    action: Literal['start']
    workflow: Literal['ingest_document','sync_project_graph']
    context: Context
    payload: ConnectedPayload | GraphPayload

    @model_validator(mode='after')
    def ids(self):
        if any(str(UUID(v)) != v for v in (self.thread_id,self.event_id)):
            raise ValueError('Thread/evento inválidos.')
        if (self.workflow=='ingest_document') != isinstance(self.payload,ConnectedPayload):
            raise ValueError('Payload no corresponde al workflow.')
        if self.workflow=='sync_project_graph' and self.payload.project_id!=self.context.project_id:
            raise ValueError('Proyecto no corresponde al contexto.')
        return self


class JobError(RuntimeError):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


class ExtractionClient:
    def __init__(self, api_url, worker_token, processor_url, processor_token, *, transport=None):
        from urllib.parse import urlparse
        for value in (api_url,processor_url):
            parsed = urlparse(value)
            if parsed.scheme not in ('http','https') or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
                raise ValueError('Configura endpoints privados explícitos.')
        if not worker_token or not processor_token:
            raise ValueError('Faltan las credenciales internas.')
        self.api_url,self.processor_url = api_url.rstrip('/'),processor_url.rstrip('/')
        self.worker_token,self.processor_token = worker_token,processor_token
        self.transport = transport

    def request(self, method, url, *, token, maximum, **kwargs):
        try:
            with httpx.Client(transport=self.transport,timeout=25,follow_redirects=False) as client:
                with client.stream(method,url,headers={'Authorization':'Bearer '+token,**kwargs.pop('headers',{})},**kwargs) as response:
                    parts=[];size=0
                    for part in response.iter_bytes():
                        size += len(part)
                        if size>maximum: raise JobError('RESPONSE_TOO_LARGE')
                        parts.append(part)
                    raw=b''.join(parts)
                    if response.status_code != 200:
                        try: code=__import__('json').loads(raw)['error']['code']
                        except (ValueError,KeyError,TypeError): code='SERVICE_UNAVAILABLE'
                        if code=='THREAD_BUSY': raise RuntimeError('THREAD_BUSY')
                        if not isinstance(code,str) or not __import__('re').fullmatch('[A-Z_0-9]{1,80}',code): code='SERVICE_UNAVAILABLE'
                        raise JobError(code)
                    return raw
        except httpx.HTTPError:
            # Leave the queue command pending on transport failure; never switch to fixtures.
            raise RuntimeError('INTERNAL_SERVICE_UNAVAILABLE') from None

    def claim(self, message):
        import json
        return json.loads(self.request('POST',self.api_url+'/internal/threads/claim',token=self.worker_token,
                                       maximum=16000,json=message))['data']

    def extract(self, inputs):
        import json
        message,claim=inputs['message'],inputs['claim']
        doc=claim['document']
        if (doc['id']!=message['payload']['document_id'] or doc['project_id']!=message['context']['project_id']
            or doc['sha256']!=message['payload']['sha256'] or claim['extraction_id']!=message['payload']['extraction_id']):
            raise JobError('THREAD_CONTEXT_CONFLICT')
        raw=self.request('GET',self.api_url+'/internal/threads/'+message['thread_id']+'/original',
                         token=self.worker_token,maximum=10485760,params={'lease_id':claim['lease_id']})
        if len(raw)!=doc['size_bytes'] or sha256(raw).hexdigest()!=doc['sha256']:
            raise JobError('ORIGINAL_HASH_MISMATCH')
        if inputs.get('on_stage'):
            inputs['on_stage']('extracting_text')
        result=json.loads(self.request('POST',self.processor_url+'/v1/extractions',token=self.processor_token,
                                       maximum=4000000,params={'filename':doc['original_filename']},content=raw,
                                       headers={'Content-Type':doc['mime_type']}))['data']
        try:
            segments=result['segments']
            if (type(result['schema_version']) is not int or result['schema_version']!=1
                or result['sha256']!=doc['sha256'] or result['size_bytes']!=doc['size_bytes']
                or result['format']!='pdf' or not 1<=len(result['parser'])<=80
                or not 1<=len(result['parser_version'])<=80 or not isinstance(result['warnings'],list)
                or len(result['warnings'])>20 or not isinstance(segments,list) or not 1<=len(segments)<=4096):
                raise ValueError()
            positions=set();total=0
            for segment in segments:
                index=segment['index'];locator=segment['locator'];text=segment['text']
                if (type(index) is not int or not 1<=index<=100000 or index in positions
                    or locator!={'kind':'page','page':index} or not isinstance(text,str) or not text.strip()):
                    raise ValueError()
                positions.add(index);total+=len(text.encode())
            if total+2*(len(segments)-1)>250000:raise ValueError()
        except (KeyError,TypeError,ValueError):
            raise JobError('INVALID_PROCESSOR_RESPONSE') from None
        return result


class ConnectedWorker:
    mode = 'connected'
    validate_envelope = staticmethod(ConnectedThread.model_validate)

    def __init__(self, client):
        self.client=client

    def handle(self, raw, on_progress=None):
        message=self.validate_envelope(raw).model_dump()
        # Claim is validated against the durable outbox envelope before any original is exposed.
        try:
            claim=self.client.claim(message)
        except JobError as exc:
            if exc.code in ('PROJECT_NOT_FOUND','THREAD_NOT_FOUND','THREAD_CONTEXT_CONFLICT','STALE_THREAD'):
                return self.event(message,None,'rejected',{'error_code':exc.code})
            raise RuntimeError('INTERNAL_SERVICE_UNAVAILABLE') from None
        if claim['terminal']:
            return self.event(message,None,'snapshot',{'status':claim['status']})
        lease=claim['lease_id']
        if message['workflow']=='sync_project_graph':
            return self.sync_graph(message,claim)
        def progress(step):
            if on_progress:
                on_progress(self.event(message,lease,'progress',{'step':step}))
        progress('reading_original')
        graph=StateGraph(dict)
        chain=RunnableLambda(self.client.extract)
        def extract(state):
            return {'extraction':chain.invoke({'message':message,'claim':claim,'on_stage':progress})}
        graph.add_node('extract_text',extract)
        graph.add_edge(START,'extract_text');graph.add_edge('extract_text',END)
        try:
            with tracing_context(enabled=False):
                result=graph.compile().invoke({})
            return self.event(message,lease,'completed',{'status':'text_ready','extraction':result['extraction'],
                                                       'relevance_status':'not_evaluated'})
        except JobError as exc:
            return self.event(message,lease,'failed',{'error_code':exc.code})
        except RuntimeError:
            return self.event(message,lease,'failed',{'error_code':'INTERNAL_SERVICE_UNAVAILABLE'})

    def sync_graph(self,message,claim):
        from .graph_projection import GraphWriter,build_projection
        import json
        try:
            data=json.loads(self.client.request('GET',self.client.api_url+'/internal/threads/'+message['thread_id']+'/graph-input',
                token=self.client.worker_token,maximum=2400000,params={'lease_id':claim['lease_id']}))['data']
            if data['generation']!=message['payload']['generation'] or data['content_hash']!=message['payload']['content_hash']:
                raise JobError('GRAPH_CONTEXT_CONFLICT')
            projection=build_projection(data['snapshot'],message['context'])
            GraphWriter.from_env().sync(projection,message['context'],data['generation'],data['content_hash'])
            return self.event(message,claim['lease_id'],'completed',{'generation':data['generation'],'content_hash':data['content_hash']})
        except JobError as exc:
            return self.event(message,claim['lease_id'],'failed',{'error_code':exc.code})
        except (KeyError,ValueError,TypeError):
            return self.event(message,claim['lease_id'],'failed',{'error_code':'INVALID_GRAPH_SOURCE'})
        except RuntimeError:
            return self.event(message,claim['lease_id'],'failed',{'error_code':'INTERNAL_SERVICE_UNAVAILABLE'})

    @staticmethod
    def event(message,lease,action,result):
        return {'type':'thread','schema_version':1,'mode':'connected','workflow':message['workflow'],
                'thread_id':message['thread_id'],'event_id':str(uuid4()),'causation_id':message['event_id'],
                'context':message['context'],'lease_id':lease,'action':action,'result':result}
