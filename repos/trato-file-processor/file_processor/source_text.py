"""Read already-extracted, backend-authorized sources. No paths, network or LLM."""
from hashlib import sha256
from typing import Annotated, Literal
from uuid import UUID
from urllib.parse import urlparse
from pydantic import BaseModel, ConfigDict, Field, model_validator

MAX_SOURCE_BYTES = 250_000
MAX_BUNDLE_BYTES = 1_500_000


class Strict(BaseModel):
    model_config = ConfigDict(strict=True, extra='forbid')


class Page(Strict):
    kind: Literal['page']
    page: int = Field(ge=1)


class Paragraph(Strict):
    kind: Literal['paragraph']
    paragraph: int = Field(ge=1)


class Section(Strict):
    kind: Literal['section']
    section: str = Field(min_length=1, max_length=300)


class Segment(Strict):
    segment_id: str = Field(min_length=1, max_length=100)
    locator: Annotated[Page | Paragraph | Section, Field(discriminator='kind')]
    text: str = Field(min_length=1, max_length=MAX_SOURCE_BYTES)


class Source(Strict):
    file_id: str
    title: str = Field(min_length=1, max_length=400)
    author: str = Field(min_length=1, max_length=400)
    url: str = Field(min_length=1, max_length=2000)
    segments: list[Segment] = Field(min_length=1, max_length=4096)

    @model_validator(mode='after')
    def check_source(self):
        if str(UUID(self.file_id)) != self.file_id:
            raise ValueError('Canonical source ID required.')
        url = urlparse(self.url)
        if url.scheme != 'https' or not url.hostname or url.username or url.password:
            raise ValueError('HTTPS attribution URL required.')
        if len({s.segment_id for s in self.segments}) != len(self.segments):
            raise ValueError('Duplicate segment ID.')
        if any(not s.text.strip() for s in self.segments):
            raise ValueError('Empty source text.')
        if len('\n\n'.join(s.text for s in self.segments).encode()) > MAX_SOURCE_BYTES:
            raise ValueError('Source text too large.')
        return self


class ReadRequest(Strict):
    schema_version: Literal[1]
    files: list[Source] = Field(min_length=1, max_length=5)

    @model_validator(mode='after')
    def check_bundle(self):
        if len({s.file_id for s in self.files}) != len(self.files):
            raise ValueError('Duplicate source ID.')
        if sum(len(s.model_dump_json().encode()) for s in self.files) > MAX_BUNDLE_BYTES:
            raise ValueError('Source bundle too large.')
        return self


def search_text_file_id(payload):
    request = ReadRequest.model_validate(payload)
    files = []
    for source in request.files:
        text = '\n\n'.join(s.text for s in source.segments)
        files.append({**source.model_dump(), 'text': text,
                      'text_sha256': sha256(text.encode()).hexdigest()})
    return {'schema_version': 1, 'files': files}
