from typing import Literal
from fastapi import APIRouter,Depends,Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel,ConfigDict,Field,ValidationError
from starlette.concurrency import run_in_threadpool
from .errors import ApiError
from .business_routes import read_bytes
from .rehearsal import LocalRehearsal
from .rehearsal import case_sources
from .rehearsal_jobs import RehearsalJobs
from .persistence import uuid
from .model_preferences import ModelPreferences

class Persona(BaseModel):
    model_config=ConfigDict(extra='forbid',strict=True)
    patience:int=Field(ge=1,le=5)
    flexibility:int=Field(ge=1,le=5)
    price_sensitivity:int=Field(ge=1,le=5)
class Message(BaseModel):
    model_config=ConfigDict(extra='forbid',strict=True)
    role:Literal['user','client']
    text:str=Field(min_length=1,max_length=4000)
class RehearsalInput(BaseModel):
    model_config=ConfigDict(extra='forbid',strict=True)
    action:Literal['reply','evaluate']
    scenario:Literal['scope','payment','refund']
    output_language:Literal['es','en']
    persona:Persona
    messages:list[Message]

def build_rehearsal_router(require_user,service=None,jobs=None):
    router=APIRouter(prefix='/api/v1/rehearsals');service=service or LocalRehearsal()
    jobs=jobs if jobs is not None else RehearsalJobs()
    @router.post('/evaluations')
    async def enqueue(request:Request,owner_id=Depends(require_user)):
        raw=await read_bytes(request,500000)
        try:data=RehearsalInput.model_validate_json(raw).model_dump()
        except (ValidationError,ValueError):raise ApiError('INVALID_REHEARSAL',422)
        if data['action']!='evaluate' or not any(m['role']=='user' for m in data['messages']):raise ApiError('REHEARSAL_EMPTY',422)
        if any(m['role']!=('client' if i%2==0 else 'user') for i,m in enumerate(data['messages'])):raise ApiError('INVALID_REHEARSAL',422)
        job_id=uuid(request.headers.get('Idempotency-Key',''))
        data['case']=case_sources(data['scenario'])
        if __import__('os').getenv('TRATO_DEFAULT_MODEL'):
            data['model_id']=await run_in_threadpool(ModelPreferences().selected,owner_id)
        result=await run_in_threadpool(jobs.enqueue,owner_id,job_id,data)
        return JSONResponse({'data':result},status_code=202,headers={'Cache-Control':'no-store'})
    @router.post('/replies')
    async def reply(request:Request,owner_id=Depends(require_user)):
        raw=await read_bytes(request,500000)
        try:data=RehearsalInput.model_validate_json(raw).model_dump()
        except (ValidationError,ValueError):raise ApiError('INVALID_REHEARSAL',422)
        messages=data['messages']
        if data['action']!='reply' or any(m['role']!=('client' if i%2==0 else 'user') for i,m in enumerate(messages)) or (messages and messages[-1]['role']!='user'):
            raise ApiError('INVALID_REHEARSAL',422)
        data['case']=case_sources(data['scenario'])
        if __import__('os').getenv('TRATO_DEFAULT_MODEL'):
            data['model_id']=await run_in_threadpool(ModelPreferences().selected,owner_id)
        job_id=uuid(request.headers.get('Idempotency-Key',''))
        result=await run_in_threadpool(jobs.enqueue,owner_id,job_id,data)
        return JSONResponse({'data':result},status_code=202,headers={'Cache-Control':'no-store'})
    @router.get('/replies/{job_id}')
    async def reply_status(job_id:str,owner_id=Depends(require_user)):
        result=await run_in_threadpool(jobs.get,owner_id,uuid(job_id),'reply')
        if result['status']=='completed':result['reply']=result.pop('evaluation')
        return JSONResponse({'data':result},headers={'Cache-Control':'no-store'})
    @router.get('/evaluations/{job_id}')
    async def status(job_id:str,owner_id=Depends(require_user)):
        result=await run_in_threadpool(jobs.get,owner_id,uuid(job_id),'evaluate')
        return JSONResponse({'data':result},headers={'Cache-Control':'no-store'})
    @router.post('/local')
    async def local(request:Request,owner_id=Depends(require_user)):
        raw=await read_bytes(request,500000)
        try:data=RehearsalInput.model_validate_json(raw).model_dump()
        except (ValidationError,ValueError):raise ApiError('INVALID_REHEARSAL',422)
        if data['action']=='evaluate':raise ApiError('REHEARSAL_EVALUATION_REQUIRES_JOB',409)
        messages=data['messages']
        if any(m['role']!=('client' if i%2==0 else 'user') for i,m in enumerate(messages)):raise ApiError('INVALID_REHEARSAL',422)
        if data['action']=='reply' and messages and messages[-1]['role']!='user':raise ApiError('INVALID_REHEARSAL',422)
        result=await run_in_threadpool(service.run,data)
        return JSONResponse({'data':result},headers={'Cache-Control':'no-store'})
    return router
