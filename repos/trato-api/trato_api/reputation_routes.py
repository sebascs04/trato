"""Authenticated community projections. Private projects are checked inside the RPC."""
import re
from typing import Annotated
from uuid import UUID
from urllib.parse import urlparse, quote
from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_validator
from starlette.concurrency import run_in_threadpool
from .business_routes import read_bytes
from .persistence import Repository
from .errors import ApiError
from . import reputation_evidence as evidence

def normalized_public_email(value):
    if value is None:return None
    value=value.strip(' \t\r\n').lower()
    if not value or len(value)>254 or not re.fullmatch(r"[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,63}",value):
        raise ValueError('Invalid public email')
    local,domain=value.split('@')
    if len(local)>64 or local.startswith('.') or local.endswith('.') or '..' in local or any(not re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?',label) for label in domain.split('.')):
        raise ValueError('Invalid public email')
    return value

class EmailLookup(BaseModel):
    model_config=ConfigDict(extra='forbid',strict=True)
    public_email: str
    @field_validator('public_email')
    @classmethod
    def email(cls,value):return normalized_public_email(value)

class ReviewInput(BaseModel):
    model_config=ConfigDict(extra='forbid',strict=True)
    public_email: str | None=None
    attachment_ids: list[str] | None=Field(default=None,max_length=3)
    project_id: str
    profile_id: str | None=None
    review_id: str | None=None
    alias: Annotated[str,StringConstraints(strip_whitespace=True,min_length=2,max_length=60)]
    name: Annotated[str,StringConstraints(strip_whitespace=True,max_length=160)]=''
    location: Annotated[str,StringConstraints(strip_whitespace=True,max_length=120)]=''
    website: Annotated[str,StringConstraints(strip_whitespace=True,max_length=300)]=''
    rating: int=Field(ge=1,le=5)
    communication: int=Field(ge=1,le=5)
    scope: int | None=Field(default=None,ge=1,le=5)
    collaboration: int | None=Field(default=None,ge=1,le=5)
    payment: Annotated[str,StringConstraints(pattern='^(on_time|late|unpaid|not_applicable)$')] | None=None
    body: Annotated[str,StringConstraints(strip_whitespace=True,min_length=20,max_length=3000)]
    consent: bool

    @model_validator(mode='after')
    def experience_dimension(self):
        if self.collaboration is None and self.scope is None:
            raise ValueError('A collaboration rating is required for the new form.')
        return self

    @field_validator('project_id','profile_id','review_id')
    @classmethod
    def identifier(cls,value):
        if value is not None:
            return str(UUID(value))
        return value

    @field_validator('public_email')
    @classmethod
    def email(cls,value):return normalized_public_email(value)

    @field_validator('attachment_ids')
    @classmethod
    def attachments(cls,value):
        if value is None:return None
        ids=[str(UUID(item)) for item in value]
        if len(set(ids))!=len(ids):raise ValueError('Duplicate attachment')
        return ids

    @field_validator('website')
    @classmethod
    def website_url(cls,value):
        if not value:return value
        p=urlparse(value)
        if p.scheme!='https' or not p.hostname or p.username or p.password or p.fragment:
            raise ValueError('Invalid website')
        return value

class ReviewRef(BaseModel):
    model_config=ConfigDict(extra='forbid')
    review_id: UUID

class ReportInput(ReviewRef):
    reason: Annotated[str,StringConstraints(pattern='^(identity|privacy|abuse|other)$')]
    details: Annotated[str,StringConstraints(strip_whitespace=True,min_length=10,max_length=1500)]


def build_reputation_router(settings,require_user,repository_factory=None):
    router=APIRouter(prefix='/api/v1/reputation')
    def repository(request:Request,user=Depends(require_user)):
        return (repository_factory or Repository)(settings,request.headers.get('authorization',''))
    def reply(repo,action,data):
        return JSONResponse({'data':repo.rpc('community_reputation',{'p_action':action,'p_data':data})},headers={'Cache-Control':'no-store'})
    async def model(request,kind):
        from pydantic import ValidationError
        try:return kind.model_validate_json(await read_bytes(request,20000))
        except (ValueError,ValidationError):raise ApiError('REPUTATION_INVALID',422)
    @router.get('')
    def directory(search:str=Query(default='',max_length=254),offset:int=Query(default=0,ge=0,le=100000),repo=Depends(repository)):
        return reply(repo,'list',{'search':search,'offset':offset})
    @router.post('/lookup')
    async def lookup(request:Request,repo=Depends(repository)):
        item=await model(request,EmailLookup)
        return await run_in_threadpool(reply,repo,'lookup',item.model_dump())
    @router.get('/review-options')
    def options(public_email: str | None=Query(default=None,max_length=254),repo=Depends(repository)):
        try: data={} if public_email is None else {'public_email':normalized_public_email(public_email)}
        except ValueError: raise ApiError('REPUTATION_EMAIL_INVALID',422)
        if public_email is not None and not data['public_email']:raise ApiError('REPUTATION_EMAIL_INVALID',422)
        return reply(repo,'options',data)
    @router.get('/attachments')
    def attachments(project_id:UUID,repo=Depends(repository)):
        return reply(repo,'attachment_list',{'project_id':str(project_id)})
    @router.post('/attachments')
    async def upload_attachment(request:Request,project_id:UUID,filename:str=Query(min_length=1,max_length=255),repo=Depends(repository)):
        key=request.headers.get('idempotency-key','')
        if not key or len(key)>128 or any(ord(c)<33 or ord(c)>126 for c in key):raise ApiError('INVALID_IDEMPOTENCY_KEY',422)
        if not filename.lower().endswith('.pdf') or any(ord(c)<32 or c in '/\\' for c in filename):raise ApiError('REPUTATION_ATTACHMENT_FORMAT',415)
        if request.headers.get('content-type','').split(';',1)[0].strip().lower()!='application/pdf':raise ApiError('REPUTATION_ATTACHMENT_FORMAT',415)
        await run_in_threadpool(evidence.action,repo,'attachment_context',{'project_id':str(project_id)})
        data=await read_bytes(request,evidence.MAX_FILE_BYTES)
        if not data.startswith(b'%PDF-'):raise ApiError('REPUTATION_ATTACHMENT_FORMAT',422)
        value=await run_in_threadpool(evidence.upload,repo,str(project_id),filename,key,data)
        return JSONResponse({'data':value},headers={'Cache-Control':'no-store'})
    @router.get('/attachments/{attachment_id}/file')
    def attachment_file(attachment_id:UUID,repo=Depends(repository)):
        item,data=evidence.download(repo,str(attachment_id))
        return Response(data,media_type='application/pdf',headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Disposition':"inline; filename=document.pdf; filename*=UTF-8''"+quote(item['filename'],safe='')})
    @router.delete('/attachments/{attachment_id}')
    def discard_attachment(attachment_id:UUID,repo=Depends(repository)):
        return JSONResponse({'data':evidence.discard(repo,str(attachment_id))},headers={'Cache-Control':'no-store'})
    @router.get('/clients/{profile_id}')
    def detail(profile_id:UUID,offset:int=Query(default=0,ge=0,le=100000),repo=Depends(repository)):
        return reply(repo,'detail',{'profile_id':str(profile_id),'offset':offset})
    @router.post('/reviews')
    async def save(request:Request,repo=Depends(repository)):
        item=await model(request,ReviewInput)
        if not item.public_email and not item.review_id:raise ApiError('REPUTATION_EMAIL_REQUIRED',422)
        if not item.consent:raise ApiError('REPUTATION_CONSENT_REQUIRED',422)
        return await run_in_threadpool(reply,repo,'save',item.model_dump(exclude_unset=True))
    @router.post('/reviews/withdraw')
    async def withdraw(request:Request,repo=Depends(repository)):
        item=await model(request,ReviewRef)
        return await run_in_threadpool(reply,repo,'withdraw',item.model_dump(mode='json'))
    @router.post('/reviews/report')
    async def report(request:Request,repo=Depends(repository)):
        item=await model(request,ReportInput)
        return await run_in_threadpool(reply,repo,'report',item.model_dump(mode='json'))
    return router
