"""Authorized reference-library retrieval. Weaviate access stays in the processor."""
import json,math,os,secrets
from hashlib import sha256
import httpx
from fastapi import APIRouter,Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool
from .agent_tools import SourceLibrary,ProcessorSourceReader,MAX_REQUEST,MAX_RESPONSE
from .errors import ApiError

TOOLS=('search_reference_passages','read_reference_context')

class ReferenceProcessor:
    def __init__(self,settings,transport=None):self.settings,self.transport=settings,transport
    def search(self,payload):
        from urllib.parse import urlparse
        s=self.settings;url=urlparse(s.processor_url)
        if not s.processor_token or url.scheme not in ('http','https') or not url.hostname or url.username or url.password or url.query or url.fragment:raise ApiError('FILE_PROCESSOR_NOT_CONFIGURED',503)
        try:
            with httpx.Client(timeout=90,follow_redirects=False,transport=self.transport) as client:
                with client.stream('POST',s.processor_url.rstrip('/')+'/v1/references/search',headers={'Authorization':'Bearer '+s.processor_token},json=payload) as response:
                    chunks=[];size=0
                    for chunk in response.iter_bytes():
                        size+=len(chunk)
                        if size>MAX_RESPONSE:raise ApiError('INVALID_PROCESSOR_RESPONSE',502)
                        chunks.append(chunk)
                    body=json.loads(b''.join(chunks))
                    if response.status_code!=200:
                        code=body.get('error',{}).get('code','REFERENCE_SEARCH_FAILED')
                        if not isinstance(code,str) or not code.startswith(('VECTOR_','REFERENCE_','EMBEDDING_')):code='REFERENCE_SEARCH_FAILED'
                        raise ApiError(code,503)
                    return body['data']
        except httpx.HTTPError:raise ApiError('FILE_PROCESSOR_UNAVAILABLE',503) from None
        except (ValueError,KeyError,TypeError):raise ApiError('INVALID_PROCESSOR_RESPONSE',502) from None

class ReferenceReceipts:
    def get(self,scope_id):
        from redis import Redis
        from redis.exceptions import RedisError
        url=os.environ.get('TRATO_REDIS_URL','')
        if not url.startswith(('redis://','rediss://')):raise ApiError('REFERENCE_INDEX_NOT_CONFIGURED',503)
        try:
            with Redis.from_url(url,decode_responses=True,socket_connect_timeout=5,socket_timeout=10) as connection:
                raw=connection.get('trato:reference-library:receipt:'+scope_id)
            if raw is None:raise ApiError('REFERENCE_INDEX_NOT_READY',409)
            value=json.loads(raw)
            if value.get('scope_id')!=scope_id or not isinstance(value.get('file_chunks'),dict):raise ValueError()
            return value
        except RedisError:raise ApiError('REFERENCE_INDEX_REGISTRY_UNAVAILABLE',503) from None
        except (ValueError,TypeError,AttributeError):raise ApiError('REFERENCE_INDEX_RECEIPT_INVALID',503) from None

class ReferenceTools:
    def __init__(self,settings,library=None,processor=None,reader=None,receipts=None):
        self.receipts=receipts or ReferenceReceipts();self.library=library or SourceLibrary();self.processor=processor or ReferenceProcessor(settings);self.reader=reader or ProcessorSourceReader(settings)
    def catalog(self):
        bundle=self.library.load();self.receipt(bundle)
        return {'schema_version':1,'workflow':'rehearsal_feedback','scope_id':bundle['scope_id'],'enabled_tools':list(TOOLS),
                'documents':[{k:f[k] for k in ('file_id','title','author','url')} for f in bundle['files']]}
    def receipt(self,bundle):
        from .vector_contract import PROFILE_ID
        receipt=self.receipts.get(bundle['scope_id']);ids={f['file_id'] for f in bundle['files']}
        if receipt.get('scope_id')!=bundle['scope_id'] or receipt.get('embedding_identity')!=PROFILE_ID or set(receipt.get('file_chunks',{}))!=ids or any(type(n) is not int or not 1<=n<=512 for n in receipt['file_chunks'].values()):raise ApiError('REFERENCE_INDEX_RECEIPT_INVALID',503)
        return receipt
    def execute(self,call):
        if not isinstance(call,dict) or set(call)!={'workflow','scope_id','tool','params'} or call.get('workflow')!='rehearsal_feedback':raise ApiError('INVALID_TOOL_CALL',422)
        if call['tool'] not in TOOLS:raise ApiError('TOOL_NOT_ALLOWED',403)
        bundle=self.library.load()
        if call['scope_id']!=bundle['scope_id']:raise ApiError('SOURCE_SCOPE_CHANGED',409)
        receipt=self.receipt(bundle);by_id={f['file_id']:f for f in bundle['files']};params=call['params']
        if not isinstance(params,dict):raise ApiError('INVALID_TOOL_CALL',422)
        selections={}
        if call['tool']=='search_reference_passages':
            if not {'query'}<=set(params) or not set(params)<={'query','file_ids'} or not isinstance(params['query'],str) or not 1<=len(params['query'].strip())<=2000:raise ApiError('INVALID_TOOL_CALL',422)
            ids=params.get('file_ids',list(by_id))
            if not isinstance(ids,list) or not 1<=len(ids)<=len(by_id) or any(not isinstance(i,str) for i in ids) or len(set(ids))!=len(ids):raise ApiError('INVALID_TOOL_CALL',422)
            if any(i not in by_id for i in ids):raise ApiError('SOURCE_NOT_ALLOWED',403)
            result=self.processor.search({'scope_id':bundle['scope_id'],'file_ids':ids,'query':params['query'],'limit':6,'neighbor_count':1,'expected_chunks':{i:receipt['file_chunks'][i] for i in ids}})
            try:
                if set(result)!={'scope_id','hits'} or result['scope_id']!=bundle['scope_id'] or not isinstance(result['hits'],list) or len(result['hits'])>30:raise ValueError()
                for hit in result['hits']:
                    if not isinstance(hit,dict) or hit.get('file_id') not in ids:raise ValueError()
                    f=by_id[hit['file_id']];segment=next((s for s in f['segments'] if s['segment_id']==hit.get('segment_id')),None)
                    start,end=hit.get('start_char'),hit.get('end_char');text=hit.get('text')
                    if segment is None or type(start) is not int or type(end) is not int or not 0<=start<end<=len(segment['text']) or text!=segment['text'][start:end] or hit.get('text_sha256')!=sha256(text.encode()).hexdigest():raise ValueError()
                    if 'score' in hit and (type(hit['score']) not in (int,float) or not math.isfinite(hit['score'])):raise ValueError()
                    selections.setdefault(f['file_id'],set()).add(segment['segment_id'])
            except (ValueError,KeyError,TypeError,AttributeError):raise ApiError('INVALID_PROCESSOR_RESPONSE',502) from None
        else:
            if set(params)!={'file_id','segment_id'} or not isinstance(params['file_id'],str) or not isinstance(params['segment_id'],str):raise ApiError('INVALID_TOOL_CALL',422)
            if params['file_id'] not in by_id:raise ApiError('SOURCE_NOT_ALLOWED',403)
            f=by_id[params['file_id']];positions=[i for i,s in enumerate(f['segments']) if s['segment_id']==params['segment_id']]
            if not positions:raise ApiError('SOURCE_SEGMENT_NOT_FOUND',404)
            checked=self.reader.read([f])['files'][0]
            index=positions[0];selections[f['file_id']]={s['segment_id'] for s in checked['segments'][max(0,index-1):index+2]}
        files=[]
        for file_id,segment_ids in selections.items():
            f=by_id[file_id];segments=[s for s in f['segments'] if s['segment_id'] in segment_ids];text='\n\n'.join(s['text'] for s in segments)
            files.append({**{k:f[k] for k in ('file_id','title','author','url')},'segments':segments,'text':text,'text_sha256':sha256(text.encode()).hexdigest()})
        return {'schema_version':1,'scope_id':bundle['scope_id'],'files':files}

def build_reference_tools_router(settings,service=None):
    router=APIRouter(prefix='/internal/reference-tools');service=service or ReferenceTools(settings)
    def authorize(request):
        token=os.environ.get('TRATO_WORKER_TOKEN','')
        if not token:raise ApiError('WORKER_NOT_CONFIGURED',503)
        if not secrets.compare_digest(request.headers.get('authorization','').encode(),('Bearer '+token).encode()):raise ApiError('UNAUTHORIZED',401)
    @router.get('/catalog')
    async def catalog(request:Request):
        authorize(request);return JSONResponse({'data':await run_in_threadpool(service.catalog)},headers={'Cache-Control':'no-store'})
    @router.post('/execute')
    async def execute(request:Request):
        authorize(request);parts=[];size=0
        async for part in request.stream():
            size+=len(part)
            if size>MAX_REQUEST:raise ApiError('INVALID_TOOL_CALL',413)
            parts.append(part)
        try:call=json.loads(b''.join(parts))
        except (ValueError,RecursionError):raise ApiError('INVALID_TOOL_CALL',422) from None
        return JSONResponse({'data':await run_in_threadpool(service.execute,call)},headers={'Cache-Control':'no-store'})
    return router
