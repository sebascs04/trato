from datetime import date
from typing import Annotated,Literal
from uuid import UUID

from fastapi import APIRouter,Depends,Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel,ConfigDict,Field,StringConstraints, field_validator
from starlette.concurrency import run_in_threadpool

from ..errors import ApiError
from ..persistence import uuid
from .repository import ProposalRepository
from .pdf import ProposalPdfService

Description=Annotated[str,StringConstraints(strip_whitespace=True,min_length=1,max_length=1000)]

class Input(BaseModel):
    model_config=ConfigDict(extra='forbid')

class Item(Input):
    description:Description
    quantity:int=Field(strict=True,ge=1,le=100000)
    unit_amount_minor:int=Field(strict=True,ge=0,le=99999999999)

class Terms(Input):
    scope_summary:Annotated[str,StringConstraints(strip_whitespace=True,min_length=1,max_length=12000)]
    conditions:str=Field(max_length=12000)
    currency:Literal['USD']
    deadline:date
    line_items:list[Item]=Field(min_length=1,max_length=100)

class Create(Input):
    request_document_id:UUID
    terms:Terms
    source_document_ids:list[UUID]=Field(min_length=2,max_length=100)

class DraftEdit(Input):
    expected_revision_id:UUID
    terms:Terms
    source_document_ids:list[UUID]=Field(min_length=2,max_length=100)

class Revise(DraftEdit):
    feedback_document_id:UUID
    feedback_notes:Annotated[str,StringConstraints(strip_whitespace=True,min_length=1,max_length=4000)]

class Review(Input):
    expected_revision_id:UUID
    document_id:UUID
    confirmed:bool=Field(strict=True)

    @field_validator('confirmed')
    @classmethod
    def explicit_confirmation(cls,value):
        if value is not True:raise ValueError('Explicit review is required')
        return value

class Send(Input):
    digest:Annotated[str,StringConstraints(pattern='^[a-f0-9]{64}$')]
    confirmed:bool=Field(strict=True)

    @field_validator('confirmed')
    @classmethod
    def explicit_send(cls,value):
        if value is not True:raise ValueError('Explicit send is required')
        return value

class Accept(Review):
    review_notes:Annotated[str,StringConstraints(strip_whitespace=True,min_length=1,max_length=4000)]


def build_proposal_router(settings,require_user,repository_factory=None,workflow=None):
    router=APIRouter(prefix='/api/v1')
    def repository(request:Request,user=Depends(require_user)):
        return (repository_factory or ProposalRepository)(settings,request.headers.get('authorization',''))
    def reply(data):return JSONResponse({'data':data},headers={'Cache-Control':'no-store'})
    def key(request):
        value=request.headers.get('idempotency-key','')
        if not 1<=len(value)<=128 or any(ord(c)<33 or ord(c)>126 for c in value):raise ApiError('INVALID_IDEMPOTENCY_KEY',422)
        return value
    async def command(request,repo,action,model,extra):
        operation_key=key(request)
        # These terms can contain full contractual text; bound reads separately
        # from the small document-metadata form shared by the ingestion routes.
        from ..business_routes import read_bytes
        from pydantic import ValidationError
        try:item=model.model_validate_json(await read_bytes(request,100000))
        except (ValidationError,ValueError):raise ApiError('INVALID_REQUEST',422)
        result=await run_in_threadpool(repo.command,action,{**item.model_dump(mode='json'),**extra},operation_key)
        return reply(result)
    @router.get('/projects/{project_id}/proposals')
    def list_proposals(project_id:str,repo=Depends(repository)):
        return reply(repo.list_proposals(uuid(project_id)))
    @router.get('/proposals/{proposal_id}')
    def get_proposal(proposal_id:str,repo=Depends(repository)):
        return reply(repo.get_proposal(uuid(proposal_id)))
    @router.get('/proposals/{proposal_id}/revisions/{revision_id}')
    def get_revision(proposal_id:str,revision_id:str,repo=Depends(repository)):
        return reply(repo.get_revision(uuid(proposal_id),uuid(revision_id)))
    @router.post('/proposals/{proposal_id}/revisions/{revision_id}/returned-pdf')
    async def returned_pdf(proposal_id:str,revision_id:str,request:Request,filename:str,repo=Depends(repository)):
        from ..business_routes import read_bytes
        proposal_id,revision_id=uuid(proposal_id),uuid(revision_id)
        snapshot=await run_in_threadpool(repo.get_revision,proposal_id,revision_id)
        if snapshot['proposal']['current_revision_id']!=revision_id or snapshot['proposal']['status']!='ready_for_review':raise ApiError('PROPOSAL_REVISION_CONFLICT',409)
        if not any(d['kind']=='adenda' and d['status']=='accepted_by_gmail' for d in snapshot['deliveries']):raise ApiError('ADENDA_SEND_REQUIRED',409)
        if not 1<=len(filename)<=180 or not filename.lower().endswith('.pdf') or any(c in filename for c in '/\\\r\n'):raise ApiError('INVALID_FILENAME',422)
        if request.headers.get('content-type')!='application/pdf':raise ApiError('UNSUPPORTED_FORMAT',415)
        operation_key=key(request)
        content=await read_bytes(request,10485760)
        if not content.startswith(b'%PDF-'):raise ApiError('FORMAT_MISMATCH',422)
        reservation=await run_in_threadpool(repo.reserve,snapshot['proposal']['project_id'],f"Aceptación de adenda v{snapshot['revision']['revision_no']}",'addendum',filename,'application/pdf',content,operation_key)
        document=reservation['document']
        await run_in_threadpool(repo.upload,document,content)
        return reply({'document_id':document['id'],'sha256':document['sha256']})
    @router.post('/proposals/{proposal_id}/revisions/{revision_id}/pdf')
    def save_pdf(proposal_id:str,revision_id:str,repo=Depends(repository)):
        return reply(ProposalPdfService().save(repo,uuid(proposal_id),uuid(revision_id)))
    @router.post('/projects/{project_id}/proposals')
    async def create(project_id:str,request:Request,repo=Depends(repository)):
        return await command(request,repo,'create',Create,{'project_id':uuid(project_id)})
    @router.post('/proposals/{proposal_id}/draft')
    async def edit_draft(proposal_id:str,request:Request,repo=Depends(repository)):
        return await command(request,repo,'edit_draft',DraftEdit,{'proposal_id':uuid(proposal_id)})
    @router.post('/proposals/{proposal_id}/revisions')
    async def revise(proposal_id:str,request:Request,repo=Depends(repository)):
        return await command(request,repo,'revise',Revise,{'proposal_id':uuid(proposal_id)})
    @router.post('/proposals/{proposal_id}/review')
    async def review(proposal_id:str,request:Request,repo=Depends(repository)):
        return await command(request,repo,'review',Review,{'proposal_id':uuid(proposal_id)})
    @router.post('/proposals/{proposal_id}/acceptance')
    async def accept(proposal_id:str,request:Request,repo=Depends(repository)):
        return await command(request,repo,'accept',Accept,{'proposal_id':uuid(proposal_id)})
    if workflow is not None:
        @router.get('/proposals/{proposal_id}/revisions/{revision_id}/email-preview')
        def preview(proposal_id:str,revision_id:str,kind:Literal['adenda','payment'],repo=Depends(repository),user=Depends(require_user)):
            return reply(workflow.preview(repo,user,uuid(proposal_id),uuid(revision_id),kind))
        @router.post('/proposals/{proposal_id}/revisions/{revision_id}/email')
        async def send(proposal_id:str,revision_id:str,request:Request,kind:Literal['adenda','payment'],repo=Depends(repository),user=Depends(require_user)):
            from ..business_routes import read_model
            value=await read_model(request,Send)
            return reply(await run_in_threadpool(workflow.send,repo,user,uuid(proposal_id),uuid(revision_id),kind,value.digest))
        @router.post('/proposals/{proposal_id}/revisions/{revision_id}/payment')
        def payment(proposal_id:str,revision_id:str,repo=Depends(repository),user=Depends(require_user)):
            return reply(workflow.public_payment(workflow.prepare_payment(repo,user,uuid(proposal_id),uuid(revision_id))))
        @router.post('/proposals/{proposal_id}/revisions/{revision_id}/reconcile')
        def reconcile(proposal_id:str,revision_id:str,repo=Depends(repository)):
            snapshot=repo.get_revision(uuid(proposal_id),uuid(revision_id))
            rows=repo.rows('proposal_payments',{'select':'checkout_token','revision_id':'eq.'+snapshot['revision']['id']})
            if not rows:raise ApiError('PAYMENT_NOT_FOUND',404)
            return reply(workflow.checkout(rows[0]['checkout_token'],capture=True))
        @router.get('/checkout/{token}')
        def checkout(token:str):
            return reply(workflow.checkout(token))
        @router.post('/checkout/{token}/capture')
        def capture(token:str):
            return reply(workflow.checkout(token,capture=True))
    return router
