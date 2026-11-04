"""Read previously extracted, backend-authorized material without parsing it again."""
from hashlib import sha256
import json,secrets
from uuid import UUID
from typing import Literal
from pydantic import Field,model_validator
from fastapi import APIRouter,Request
from fastapi.responses import JSONResponse
from .source_text import Strict,Segment,MAX_SOURCE_BYTES

class PreparedFile(Strict):
    schema_version:Literal[1]
    file_id:str
    source_sha256:str=Field(pattern='^[a-f0-9]{64}$')
    parser:str=Field(min_length=1,max_length=80)
    parser_version:str=Field(min_length=1,max_length=80)
    segments:list[Segment]=Field(min_length=1,max_length=4096)
    @model_validator(mode='after')
    def source(self):
        if str(UUID(self.file_id))!=self.file_id or len({s.segment_id for s in self.segments})!=len(self.segments):raise ValueError('Invalid source')
        if len('\n\n'.join(s.text for s in self.segments).encode())>MAX_SOURCE_BYTES or any(not s.text.strip() for s in self.segments):raise ValueError('Source limit')
        return self

def read_prepared_file(payload):
    value=PreparedFile.model_validate(payload);text='\n\n'.join(s.text for s in value.segments)
    return {**value.model_dump(exclude={'file_id'}),'text':text,'text_sha256':sha256(text.encode()).hexdigest()}

def build_prepared_router(token):
    router=APIRouter()
    @router.post('/v1/files/prepared-text')
    async def read(request:Request):
        if not token:return JSONResponse({'error':{'code':'SERVICE_NOT_CONFIGURED'}},status_code=503)
        if not secrets.compare_digest(request.headers.get('authorization','').encode(),('Bearer '+token).encode()):
            return JSONResponse({'error':{'code':'UNAUTHORIZED'}},status_code=401)
        parts=[];size=0
        async for part in request.stream():
            size+=len(part)
            if size>1500000:return JSONResponse({'error':{'code':'SOURCE_BUNDLE_TOO_LARGE'}},status_code=413)
            parts.append(part)
        try:return JSONResponse({'data':read_prepared_file(json.loads(b''.join(parts)))},headers={'Cache-Control':'no-store'})
        except (ValueError,TypeError,RecursionError):return JSONResponse({'error':{'code':'INVALID_PREPARED_SOURCE'}},status_code=422)
    return router
