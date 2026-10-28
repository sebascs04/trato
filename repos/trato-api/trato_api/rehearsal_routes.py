from typing import Literal
from fastapi import APIRouter,Depends,Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel,ConfigDict,Field,ValidationError
from starlette.concurrency import run_in_threadpool
from .errors import ApiError
from .business_routes import read_bytes
from .rehearsal import LocalRehearsal

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
    messages:list[Message]=Field(max_length=40)

def build_rehearsal_router(require_user,service=None):
    router=APIRouter(prefix='/api/v1/rehearsals');service=service or LocalRehearsal()
    @router.post('/local')
    async def local(request:Request,owner_id=Depends(require_user)):
        raw=await read_bytes(request,24000)
        try:data=RehearsalInput.model_validate_json(raw).model_dump()
        except (ValidationError,ValueError):raise ApiError('INVALID_REHEARSAL',422)
        messages=data['messages']
        if any(m['role']!=('client' if i%2==0 else 'user') for i,m in enumerate(messages)):raise ApiError('INVALID_REHEARSAL',422)
        if data['action']=='reply' and messages and messages[-1]['role']!='user':raise ApiError('INVALID_REHEARSAL',422)
        result=await run_in_threadpool(service.run,data)
        return JSONResponse({'data':result},headers={'Cache-Control':'no-store'})
    return router
