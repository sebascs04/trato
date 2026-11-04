"""Consented community projection, never a projection of private contracts."""
from hashlib import sha256
import math
from uuid import NAMESPACE_URL,uuid5
from fastapi import APIRouter,Depends,Request
from fastapi.responses import JSONResponse
from .errors import ApiError
from .persistence import Repository,uuid
from .thread_store import ThreadStore
from .ai_jobs import AIJobs
from .vector_routes import ProcessorChunks,SearchInput,POLICY
from .vector_client import ProcessorVectorClient
from .vector_contract import PROFILE_ID,digest
from .business_routes import read_bytes


def canonical_snapshot(profile,reviews):
    profile=uuid(profile);seen=set();out=[];total=0
    for review in reviews:
        id=uuid(review['id']);version=review['version'];body=review['body']
        if id in seen or type(version) is not int or version<1 or not isinstance(body,str) or not 1<=len(body)<=3000:
            raise ApiError('REPUTATION_VECTOR_SOURCE_INVALID',502)
        seen.add(id);total+=len(body.encode())
        if total>500000 or len(seen)>1000:raise ApiError('REPUTATION_VECTOR_LIMIT',413)
        generation=digest([profile,id,version,body,POLICY,PROFILE_ID])
        out.append({'id':id,'version':version,'body':body,'generation':generation})
    out.sort(key=lambda r:r['id'])
    return {'profile_id':profile,'reviews':out,'source_hash':digest(out)}


def published_snapshot(repo,profile):
    offset=0;reviews=[]
    while True:
        page=repo.rpc('community_reputation',{'p_action':'detail','p_data':{'profile_id':uuid(profile),'offset':offset}})
        if page['client']['id']!=profile:raise ApiError('REPUTATION_VECTOR_SOURCE_INVALID',502)
        reviews.extend(page['reviews'])
        if len(reviews)>1000:raise ApiError('REPUTATION_VECTOR_LIMIT',413)
        next=page.get('next_offset')
        if next is None:break
        if type(next) is not int or next<=offset:raise ApiError('REPUTATION_VECTOR_SOURCE_INVALID',502)
        offset=next
    return canonical_snapshot(profile,reviews)


class PublicVector:
    def __init__(self,settings,*,server=None,processor=None,chunks=None):
        self.settings=settings;self.server=server
        self.processor=processor if processor is not None else ProcessorVectorClient(settings)
        self.chunks=chunks if chunks is not None else ProcessorChunks(settings)
    def repo(self):return self.server if self.server is not None else ThreadStore(self.settings).repo
    def current(self,profile):
        raw=self.repo().rpc('reputation_vector_source',{'p_profile_id':uuid(profile)})
        if raw.get('profile_id')!=profile:raise ApiError('REPUTATION_VECTOR_SOURCE_INVALID',502)
        value=canonical_snapshot(profile,raw['reviews']);value['generation']=raw['generation'];return value
    def receipt(self,profile,value=None):
        return self.repo().rpc('reputation_vector_receipt',{'p_profile_id':uuid(profile),'p_receipt':value})
    def sync(self,profile):
        before=self.current(profile);count=0
        receipt={'generation':before['generation'],'source_hash':before['source_hash'],'state':'indexing','chunks':0}
        self.receipt(profile,receipt)
        try:
            for review in before['reviews']:
                value={'document':{'id':review['id']},'generation':review['generation'],
                    'segments':[{'segment_id':review['id'],'locator':{'kind':'section','section':'Published experience'},'text':review['body']}]}
                records=[]
                for chunk in self.chunks.read(value):
                    p={'community_client_id':profile,'review_id':review['id'],'review_version':str(review['version']),
                       'generation':review['generation'],'embedding_identity':PROFILE_ID,'segment_id':chunk['segment_id'],
                       'chunk_text':chunk['text'],'text_sha256':chunk['text_sha256'],'start_char':chunk['start_char'],'end_char':chunk['end_char']}
                    records.append({'id':str(uuid5(NAMESPACE_URL,'trato:weaviate:public:'+digest(p))),'properties':p})
                self.processor.write_public(profile,records);count+=len(records)
            if self.current(profile)!=before:raise ApiError('REPUTATION_VECTOR_SOURCE_CHANGED',409)
            self.processor.prune_public(profile,[{'id':r['id'],'generation':r['generation']} for r in before['reviews']])
            if self.current(profile)!=before:raise ApiError('REPUTATION_VECTOR_SOURCE_CHANGED',409)
            saved=self.receipt(profile,{**receipt,'state':'ready','chunks':count})
            if saved['source_hash']!=before['source_hash'] or saved['state']!='ready':raise ApiError('REPUTATION_VECTOR_SOURCE_CHANGED',409)
            return {'kind':'reputation_index','profile_id':profile,'status':'ready','reviews':len(before['reviews']),'chunks':count}
        except ApiError as error:
            self.receipt(profile,{**receipt,'state':'failed','chunks':count,'error_code':error.code});raise
    def search(self,repo,profile,query,limit=8):
        if not query.strip() or len(query.encode())>4096:raise ApiError('EMBEDDING_INPUT_LIMIT',422)
        before=published_snapshot(repo,profile)
        status=self.receipt(profile)
        if not status or status['state']!='ready' or status['source_hash']!=before['source_hash']:
            raise ApiError('REPUTATION_VECTOR_INDEX_INCOMPLETE',409)
        if not before['reviews']:return {'matches':[],'reviews_checked':0}
        rows=self.processor.search_public(profile,[{'id':r['id'],'generation':r['generation']} for r in before['reviews']],query,limit,status['chunks'])
        by_id={r['id']:r for r in before['reviews']};matches=[]
        allowed={'community_client_id','review_id','review_version','generation','embedding_identity','segment_id','chunk_text','text_sha256','start_char','end_char'}
        for row in rows:
            p=row.get('properties',{});review=by_id.get(p.get('review_id'));a=p.get('start_char');b=p.get('end_char')
            if (set(p)!=allowed or not review or p['community_client_id']!=profile or p['generation']!=review['generation'] or
                p['review_version']!=str(review['version']) or p['embedding_identity']!=PROFILE_ID or p['segment_id']!=review['id'] or
                type(a) is not int or type(b) is not int or not 0<=a<b<=len(review['body']) or
                p['chunk_text']!=review['body'][a:b] or sha256(p['chunk_text'].encode()).hexdigest()!=p['text_sha256'] or
                row.get('id')!=str(uuid5(NAMESPACE_URL,'trato:weaviate:public:'+digest(p))) or
                not isinstance(row.get('score'),(int,float)) or not math.isfinite(row['score'])):
                raise ApiError('REPUTATION_VECTOR_RESULT_INVALID',502)
            matches.append({'review_id':review['id'],'version':review['version'],'quote':review['body'][a:b],
                            'start_char':a,'end_char':b,'score':row['score']})
        if published_snapshot(repo,profile)!=before:raise ApiError('REPUTATION_VECTOR_SOURCE_CHANGED',409)
        return {'matches':matches,'reviews_checked':len(before['reviews']),'exhaustive_evidence':False}


def relay_reputation(store,redis):
    event=store.repo.rpc('reputation_vector_event',{'p_action':'claim','p_data':{}})
    if not event:return False
    id=str(uuid5(NAMESPACE_URL,'trato:reputation-index:'+event['profile_id']+':'+str(event['generation'])))
    AIJobs(redis).enqueue(event['actor_id'],id,{'workflow':'index_reputation','profile_id':event['profile_id']})
    store.repo.rpc('reputation_vector_event',{'p_action':'published','p_data':event})
    return True


def build_public_vector_router(settings,require_user,repository_factory=None,service=None):
    router=APIRouter(prefix='/api/v1/reputation/clients');service=service if service is not None else PublicVector(settings)
    @router.post('/{profile_id}/sources/sync')
    async def sync(profile_id:str,request:Request,user=Depends(require_user)):
        from starlette.concurrency import run_in_threadpool
        profile_id=uuid(profile_id);job_id=uuid(request.headers.get('idempotency-key',''))
        repo=(repository_factory or Repository)(settings,request.headers.get('authorization',''))
        await run_in_threadpool(published_snapshot,repo,profile_id)
        value=await run_in_threadpool(AIJobs().enqueue,user,job_id,{'workflow':'index_reputation','profile_id':profile_id})
        return JSONResponse({'data':value},status_code=202,headers={'Cache-Control':'no-store'})
    @router.post('/{profile_id}/sources/search')
    async def search(profile_id:str,request:Request,user=Depends(require_user)):
        from starlette.concurrency import run_in_threadpool
        profile_id=uuid(profile_id)
        try:body=SearchInput.model_validate_json(await read_bytes(request,18000))
        except ValueError:raise ApiError('INVALID_REQUEST',422) from None
        repo=(repository_factory or Repository)(settings,request.headers.get('authorization',''))
        value=await run_in_threadpool(service.search,repo,profile_id,body.query,body.limit)
        return JSONResponse({'data':value},headers={'Cache-Control':'no-store'})
    return router
