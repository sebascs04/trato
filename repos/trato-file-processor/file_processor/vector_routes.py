"""Internal vector functions. The caller supplies a backend-authorized scope only."""
from hashlib import sha256
import json
import os
import secrets
import threading
from typing import Literal
from uuid import UUID, NAMESPACE_URL, uuid5

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, model_validator
from starlette.concurrency import run_in_threadpool

from .vector_contract import PROFILE_ID, digest
from .vector_store import WeaviateStore, VectorError


def canonical(value):
    if str(UUID(value)) != value:
        raise ValueError('Canonical ID required')
    return value


class Strict(BaseModel):
    model_config = ConfigDict(strict=True, extra='forbid')


class Properties(Strict):
    owner_id: str
    client_id: str
    project_id: str
    file_id: str
    generation: str = Field(pattern='^[a-f0-9]{64}$')
    embedding_identity: Literal[PROFILE_ID]
    segment_id: str = Field(min_length=1, max_length=100)
    text_sha256: str = Field(pattern='^[a-f0-9]{64}$')
    chunk_text: str = Field(min_length=1, max_length=800)
    start_char: int = Field(ge=0, le=250000)
    end_char: int = Field(ge=1, le=250000)

    @model_validator(mode='after')
    def validate_properties(self):
        for value in (self.owner_id, self.client_id, self.project_id, self.file_id): canonical(value)
        if (not self.chunk_text.strip() or len(self.chunk_text.encode()) > 4096 or
            self.end_char - self.start_char != len(self.chunk_text) or
            sha256(self.chunk_text.encode()).hexdigest() != self.text_sha256):
            raise ValueError('Invalid chunk binding')
        return self


class Record(Strict):
    id: str
    properties: Properties
    @model_validator(mode='after')
    def binding(self):
        if self.id != str(uuid5(NAMESPACE_URL, 'trato:weaviate:' + digest(self.properties.model_dump()))):
            raise ValueError('Record identity mismatch')
        return self


class IndexInput(Strict):
    schema_version: Literal[1]
    embedding_identity: Literal[PROFILE_ID]
    owner_id: str
    records: list[Record] = Field(min_length=1, max_length=512)
    @model_validator(mode='after')
    def scope(self):
        canonical(self.owner_id)
        first = self.records[0].properties
        if (len({r.id for r in self.records}) != len(self.records) or
            any((p.owner_id, p.client_id, p.project_id, p.file_id, p.generation) !=
                (self.owner_id, first.client_id, first.project_id, first.file_id, first.generation)
                for p in (r.properties for r in self.records))):
            raise ValueError('Mixed document scopes')
        return self


class FileGeneration(Strict):
    id: str
    generation: str = Field(pattern='^[a-f0-9]{64}$')
    @model_validator(mode='after')
    def identity(self):
        canonical(self.id)
        return self


class SearchInput(Strict):
    schema_version: Literal[1]
    embedding_identity: Literal[PROFILE_ID]
    owner_id: str
    client_id: str
    project_id: str
    files: list[FileGeneration] = Field(min_length=1, max_length=1000)
    query: str = Field(min_length=1, max_length=4096)
    limit: int = Field(ge=1, le=20)
    @model_validator(mode='after')
    def scope(self):
        for value in (self.owner_id, self.client_id, self.project_id): canonical(value)
        if (len({f.id for f in self.files}) != len(self.files) or
            not self.query.strip() or len(self.query.encode()) > 4096):
            raise ValueError('Invalid scope or query')
        return self

class PublicProperties(Strict):
    community_client_id: str
    review_id: str
    review_version: str = Field(pattern='^[1-9][0-9]{0,9}$')
    generation: str = Field(pattern='^[a-f0-9]{64}$')
    embedding_identity: Literal[PROFILE_ID]
    segment_id: str = Field(min_length=1, max_length=100)
    text_sha256: str = Field(pattern='^[a-f0-9]{64}$')
    chunk_text: str = Field(min_length=1, max_length=800)
    start_char: int = Field(ge=0, le=3000)
    end_char: int = Field(ge=1, le=3000)
    @model_validator(mode='after')
    def binding(self):
        canonical(self.community_client_id); canonical(self.review_id)
        if (not self.chunk_text.strip() or len(self.chunk_text.encode()) > 4096 or
            self.end_char-self.start_char != len(self.chunk_text) or
            sha256(self.chunk_text.encode()).hexdigest() != self.text_sha256):
            raise ValueError('Invalid published chunk')
        return self

class PublicRecord(Strict):
    id: str
    properties: PublicProperties
    @model_validator(mode='after')
    def binding(self):
        if self.id != str(uuid5(NAMESPACE_URL,'trato:weaviate:public:'+digest(self.properties.model_dump()))):
            raise ValueError('Invalid public record ID')
        return self

class PublicIndex(Strict):
    schema_version: Literal[1]
    embedding_identity: Literal[PROFILE_ID]
    profile_id: str
    records: list[PublicRecord] = Field(min_length=1,max_length=512)
    @model_validator(mode='after')
    def scope(self):
        canonical(self.profile_id); first=self.records[0].properties
        if (len({r.id for r in self.records}) != len(self.records) or
            any((r.properties.community_client_id,r.properties.review_id,r.properties.generation,r.properties.review_version) !=
                (self.profile_id,first.review_id,first.generation,first.review_version) for r in self.records)):
            raise ValueError('Mixed public scopes')
        return self

class PublicPrune(Strict):
    schema_version: Literal[1]
    embedding_identity: Literal[PROFILE_ID]
    profile_id: str
    files: list[FileGeneration] = Field(max_length=1000)
    @model_validator(mode='after')
    def scope(self):
        canonical(self.profile_id)
        if len({f.id for f in self.files}) != len(self.files): raise ValueError('Repeated review')
        return self

class PublicSearch(PublicPrune):
    files: list[FileGeneration] = Field(min_length=1,max_length=1000)
    query: str = Field(min_length=1,max_length=4096)
    limit: int = Field(ge=1,le=20)
    expected_chunks: int = Field(ge=1,le=99000)
    @model_validator(mode='after')
    def query_size(self):
        if not self.query.strip() or len(self.query.encode())>4096: raise ValueError('Query limit')
        return self


def build_vector_router(service_token, store=None):
    router = APIRouter(prefix='/v1/vectors')
    store = store if store is not None else WeaviateStore()
    index_lock = threading.Lock()

    async def input(request, model):
        if not service_token:
            raise VectorError('SERVICE_NOT_CONFIGURED', 503)
        if not secrets.compare_digest(request.headers.get('authorization', '').encode(),
                                      ('Bearer ' + service_token).encode()):
            raise VectorError('UNAUTHORIZED', 401)
        if os.getenv('TRATO_VECTOR_SEARCH_ENABLED') != 'true':
            raise VectorError('VECTOR_NOT_CONFIGURED', 503)
        parts, size = [], 0
        async for part in request.stream():
            size += len(part)
            if size > 2_000_000:
                raise VectorError('VECTOR_REQUEST_TOO_LARGE', 413)
            parts.append(part)
        try:
            return model.model_validate_json(b''.join(parts))
        except (ValueError, TypeError, RecursionError):
            raise VectorError('INVALID_VECTOR_REQUEST', 422) from None

    async def execute(request, model, operation):
        try:
            value = await input(request, model)
            result = await run_in_threadpool(operation, value)
            return JSONResponse({'data': result}, headers={'Cache-Control': 'no-store'})
        except VectorError as error:
            return JSONResponse({'error': {'code': error.code}}, status_code=error.status,
                                headers={'Cache-Control': 'no-store'})

    def index(value):
        if not index_lock.acquire(blocking=False):
            raise VectorError('VECTOR_INDEX_BUSY', 409)
        try:
            return store.write(value.owner_id, [r.model_dump() for r in value.records])
        finally:
            index_lock.release()

    @router.post('/index')
    async def index_route(request: Request):
        return await execute(request, IndexInput, index)

    @router.post('/search')
    async def search_route(request: Request):
        return await execute(request, SearchInput, lambda value: {
            'embedding_identity': PROFILE_ID,
            'matches': store.search(value.owner_id, value.client_id, value.project_id,
                [f.model_dump() for f in value.files], value.query, value.limit)})

    @router.post('/public-index')
    async def public_index(request: Request):
        def write(value):
            if not index_lock.acquire(blocking=False): raise VectorError('VECTOR_INDEX_BUSY',409)
            try: return store.write_public(value.profile_id,[r.model_dump() for r in value.records])
            finally: index_lock.release()
        return await execute(request,PublicIndex,write)

    @router.post('/public-search')
    async def public_search(request: Request):
        return await execute(request,PublicSearch,lambda value:{'embedding_identity':PROFILE_ID,
            'matches':store.search_public(value.profile_id,[f.model_dump() for f in value.files],value.query,value.limit,value.expected_chunks)})

    @router.post('/public-prune')
    async def public_prune(request: Request):
        return await execute(request,PublicPrune,lambda value:store.prune_public(value.profile_id,[f.model_dump() for f in value.files]))

    return router
