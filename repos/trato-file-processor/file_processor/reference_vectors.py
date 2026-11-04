"""Fixed-tenant indexing and retrieval of a backend-authorized reference library."""
from hashlib import sha256
import json
import math
import os
import secrets
import threading
from uuid import UUID,NAMESPACE_URL,uuid5
from fastapi import APIRouter,Request
from fastapi.responses import JSONResponse
from pydantic import Field,model_validator
from starlette.concurrency import run_in_threadpool
from .source_text import Strict,Segment,MAX_SOURCE_BYTES,MAX_BUNDLE_BYTES
from .chunking import chunk_file
from .vector_contract import PROFILE_ID,digest
from .vector_store import WeaviateStore,VectorError

TENANT='references_shared'
FIELDS=('file_id','segment_id','generation','embedding_identity','chunk_text','start_char','end_char','text_sha256')
POLICY={'version':'v1','max_chars':800,'overlap_chars':100,'max_chunks':512}

def identity(value):
    if str(UUID(value))!=value:raise ValueError('Canonical source ID required')
    return value

class ReferenceFile(Strict):
    file_id:str
    text_sha256:str=Field(pattern='^[a-f0-9]{64}$')
    segments:list[Segment]=Field(min_length=1,max_length=4096)
    @model_validator(mode='after')
    def binding(self):
        identity(self.file_id);text='\n\n'.join(s.text for s in self.segments)
        if (len(text.encode())>MAX_SOURCE_BYTES or sha256(text.encode()).hexdigest()!=self.text_sha256 or
            len({s.segment_id for s in self.segments})!=len(self.segments) or any(not s.text.strip() for s in self.segments)):
            raise ValueError('Invalid reference source')
        return self

class ReferenceIndex(Strict):
    scope_id:str=Field(pattern='^[a-f0-9]{64}$')
    files:list[ReferenceFile]=Field(min_length=1,max_length=5)
    @model_validator(mode='after')
    def binding(self):
        if len({f.file_id for f in self.files})!=len(self.files):raise ValueError('Duplicate source')
        if sum(len(f.model_dump_json().encode()) for f in self.files)>MAX_BUNDLE_BYTES:raise ValueError('Reference bundle limit')
        return self

class ReferenceSearch(Strict):
    scope_id:str=Field(pattern='^[a-f0-9]{64}$')
    file_ids:list[str]=Field(min_length=1,max_length=5)
    expected_chunks:dict[str,int]
    query:str=Field(min_length=1,max_length=4096)
    limit:int=Field(default=6,ge=1,le=20)
    neighbor_count:int=Field(default=1,ge=0,le=2)
    @model_validator(mode='after')
    def binding(self):
        for f in self.file_ids:identity(f)
        if (len(set(self.file_ids))!=len(self.file_ids) or set(self.expected_chunks)!=set(self.file_ids) or
            any(type(n) is not int or not 1<=n<=512 for n in self.expected_chunks.values()) or
            not self.query.strip() or len(self.query.encode())>4096):raise ValueError('Invalid reference query scope')
        return self

def records_for(file,scope):
    chunks=chunk_file({'schema_version':1,'file_id':file.file_id,'source_fingerprint':scope,
        'segments':[s.model_dump() for s in file.segments],'policy':POLICY})['chunks']
    records=[]
    for c in chunks:
        p={'file_id':file.file_id,'segment_id':c['segment_id'],'generation':scope,'embedding_identity':PROFILE_ID,
           'chunk_text':c['text'],'start_char':c['start_char'],'end_char':c['end_char'],'text_sha256':c['text_sha256']}
        records.append({'id':str(uuid5(NAMESPACE_URL,'trato:weaviate:reference:'+digest(p))),'properties':p})
    return records

def checked_row(row,scope,files):
    p=row.get('properties',{})
    if (set(p)!=set(FIELDS) or p.get('file_id') not in files or p.get('generation')!=scope or
        p.get('embedding_identity')!=PROFILE_ID or not isinstance(p.get('segment_id'),str) or not p['segment_id'] or
        not isinstance(p.get('chunk_text'),str) or not p['chunk_text'].strip() or len(p['chunk_text'].encode())>4096 or
        type(p.get('start_char')) is not int or type(p.get('end_char')) is not int or
        not 0<=p['start_char']<p['end_char']<=MAX_SOURCE_BYTES or p['end_char']-p['start_char']!=len(p['chunk_text']) or
        sha256(p['chunk_text'].encode()).hexdigest()!=p.get('text_sha256') or
        row.get('id')!=str(uuid5(NAMESPACE_URL,'trato:weaviate:reference:'+digest(p)))):
        raise VectorError('REFERENCE_RESULT_INVALID',502)
    return p

def contextual_hit(hit,neighbors,scope,file_ids,neighbor_count):
    center=checked_row(hit,scope,file_ids);score=hit.get('score')
    if type(score) not in (int,float) or not math.isfinite(score):raise VectorError('REFERENCE_RESULT_INVALID',502)
    rows=[]
    for row in neighbors:
        p=checked_row(row,scope,[center['file_id']])
        if p['segment_id']!=center['segment_id']:raise VectorError('REFERENCE_NEIGHBOR_SCOPE_INVALID',502)
        rows.append((row['id'],p))
    rows.sort(key=lambda item:(item[1]['start_char'],item[1]['end_char']))
    ids=[r[0] for r in rows]
    if len(set(ids))!=len(ids) or hit['id'] not in ids:raise VectorError('REFERENCE_RESULT_INVALID',502)
    i=ids.index(hit['id']);selected=[p for _,p in rows[max(0,i-neighbor_count):i+neighbor_count+1]]
    first=selected[0];left=first['start_char'];right=first['end_char'];text=first['chunk_text']
    for p in selected[1:]:
        start,end=p['start_char'],p['end_char']
        if start>right or text[start-left:min(right,end)-left]!=p['chunk_text'][:min(right,end)-start]:
            raise VectorError('REFERENCE_CONTEXT_GAP',502)
        if end>right:text+=p['chunk_text'][right-start:];right=end
    return {'file_id':center['file_id'],'segment_id':center['segment_id'],'text':text,
            'start_char':left,'end_char':right,'text_sha256':sha256(text.encode()).hexdigest(),'score':score}

class ReferenceVectors:
    def __init__(self,store=None):self.store=store if store is not None else WeaviateStore();self.lock=threading.Lock()
    def index(self,value):
        # Prepare every file before the first write. Input-limit failures cannot create a partial bundle.
        try:prepared=[(f,records_for(f,value.scope_id)) for f in value.files]
        except (ValueError,TypeError):raise VectorError('REFERENCE_INPUT_LIMIT',422) from None
        if not self.lock.acquire(blocking=False):raise VectorError('VECTOR_INDEX_BUSY',409)
        try:
            counts={}
            for f,records in prepared:
                receipt=self.store.write_references(value.scope_id,f.file_id,records)
                if receipt!={'objects':len(records),'embedding_identity':PROFILE_ID}:raise VectorError('REFERENCE_INDEX_INCOMPLETE',503)
                counts[f.file_id]=len(records)
            self.store.reference_counts(value.scope_id,counts)
            return {'scope_id':value.scope_id,'files_indexed':len(counts),'chunks':sum(counts.values()),'file_chunks':counts,'embedding_identity':PROFILE_ID}
        finally:self.lock.release()
    def search(self,value):
        raw=self.store.search_references(value.scope_id,value.file_ids,value.expected_chunks,value.query,value.limit,value.neighbor_count)
        hits=[];seen=set()
        for row in raw:
            result=contextual_hit(row['hit'],row['neighbors'],value.scope_id,value.file_ids,value.neighbor_count)
            key=(result['file_id'],result['segment_id'],result['start_char'],result['end_char'])
            if key not in seen:hits.append(result);seen.add(key)
        return {'scope_id':value.scope_id,'hits':hits}

def build_reference_router(service_token,service=None):
    router=APIRouter(prefix='/v1/references');service=service if service is not None else ReferenceVectors()
    async def execute(request,model,operation):
        try:
            if not service_token:raise VectorError('SERVICE_NOT_CONFIGURED',503)
            if not secrets.compare_digest(request.headers.get('authorization','').encode(),('Bearer '+service_token).encode()):raise VectorError('UNAUTHORIZED',401)
            if os.getenv('TRATO_VECTOR_SEARCH_ENABLED')!='true':raise VectorError('VECTOR_NOT_CONFIGURED',503)
            parts=[];size=0
            async for part in request.stream():
                size+=len(part)
                if size>MAX_BUNDLE_BYTES:raise VectorError('REFERENCE_REQUEST_TOO_LARGE',413)
                parts.append(part)
            try:value=model.model_validate_json(b''.join(parts))
            except (ValueError,TypeError,RecursionError):raise VectorError('INVALID_REFERENCE_REQUEST',422) from None
            result=await run_in_threadpool(operation,value)
            return JSONResponse({'data':result},headers={'Cache-Control':'no-store'})
        except VectorError as error:return JSONResponse({'error':{'code':error.code}},status_code=error.status,headers={'Cache-Control':'no-store'})
    @router.post('/index')
    async def index(request:Request):return await execute(request,ReferenceIndex,service.index)
    @router.post('/search')
    async def search(request:Request):return await execute(request,ReferenceSearch,service.search)
    return router


def main():
    import argparse
    from pathlib import Path
    parser=argparse.ArgumentParser(description='Explicitly provision only the reference tenant on Trato existing collection.')
    parser.add_argument('--provision',action='store_true',required=True)
    parser.parse_args()
    env=Path(__file__).resolve().parents[1]/'.env';values={}
    for line in env.read_text().splitlines():
        k,sep,v=line.partition('=')
        if sep and k.strip() in ('WEAVIATE_URL','WEAVIATE_API_KEY'):values[k.strip()]=v.strip()
    if not all(values.get(k) for k in ('WEAVIATE_URL','WEAVIATE_API_KEY')):raise VectorError('VECTOR_NOT_CONFIGURED',503)
    print(json.dumps(WeaviateStore(values['WEAVIATE_URL'],values['WEAVIATE_API_KEY']).provision_references()))


if __name__=='__main__':
    try:main()
    except Exception as error:
        print(json.dumps({'error':{'code':getattr(error,'code','REFERENCE_PROVISION_FAILED')}}))
        raise SystemExit(1) from None
