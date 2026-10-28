"""Authenticated community projections. Private projects are checked inside the RPC."""
from typing import Annotated
from uuid import UUID
from urllib.parse import urlparse
from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator
from starlette.concurrency import run_in_threadpool
from .business_routes import read_bytes
from .persistence import Repository
from .errors import ApiError

class ReviewInput(BaseModel):
    model_config=ConfigDict(extra='forbid',strict=True)
    project_id: str
    profile_id: str | None=None
    review_id: str | None=None
    alias: Annotated[str,StringConstraints(strip_whitespace=True,min_length=2,max_length=60)]
    name: Annotated[str,StringConstraints(strip_whitespace=True,max_length=160)]=''
    location: Annotated[str,StringConstraints(strip_whitespace=True,max_length=120)]=''
    website: Annotated[str,StringConstraints(strip_whitespace=True,max_length=300)]=''
    rating: int=Field(ge=1,le=5)
    communication: int=Field(ge=1,le=5)
    scope: int=Field(ge=1,le=5)
    payment: Annotated[str,StringConstraints(pattern='^(on_time|late|unpaid|not_applicable)$')]
    body: Annotated[str,StringConstraints(strip_whitespace=True,min_length=20,max_length=3000)]
    consent: bool

    @field_validator('project_id','profile_id','review_id')
    @classmethod
    def identifier(cls,value):
        if value is not None:
            return str(UUID(value))
        return value

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
    def directory(search:str=Query(default='',max_length=160),offset:int=Query(default=0,ge=0,le=100000),repo=Depends(repository)):
        return reply(repo,'list',{'search':search,'offset':offset})
    @router.get('/review-options')
    def options(repo=Depends(repository)):
        return reply(repo,'options',{})
    @router.get('/clients/{profile_id}')
    def detail(profile_id:UUID,offset:int=Query(default=0,ge=0,le=100000),repo=Depends(repository)):
        return reply(repo,'detail',{'profile_id':str(profile_id),'offset':offset})
    @router.post('/reviews')
    async def save(request:Request,repo=Depends(repository)):
        item=await model(request,ReviewInput)
        if not item.consent:raise ApiError('REPUTATION_CONSENT_REQUIRED',422)
        if not item.profile_id and not 2<=len(item.name)<=160:raise ApiError('REPUTATION_INVALID',422)
        return await run_in_threadpool(reply,repo,'save',item.model_dump())
    @router.post('/reviews/withdraw')
    async def withdraw(request:Request,repo=Depends(repository)):
        item=await model(request,ReviewRef)
        return await run_in_threadpool(reply,repo,'withdraw',item.model_dump(mode='json'))
    @router.post('/reviews/report')
    async def report(request:Request,repo=Depends(repository)):
        item=await model(request,ReportInput)
        return await run_in_threadpool(reply,repo,'report',item.model_dump(mode='json'))
    return router
