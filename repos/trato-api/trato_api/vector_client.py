"""Private HTTP port. Authorize in the backend; execute vectors in the processor."""
import json
import re
from urllib.parse import urlparse
import httpx
from .errors import ApiError
from .vector_contract import PROFILE_ID


class ProcessorVectorClient:
    def __init__(self, settings, transport=None):
        self.settings, self.transport = settings, transport

    def request(self, operation, payload):
        s = self.settings
        p = urlparse(s.processor_url)
        if (p.scheme not in ('http', 'https') or not p.hostname or p.username or p.password or
            p.query or p.fragment or not s.processor_token):
            raise ApiError('FILE_PROCESSOR_NOT_CONFIGURED', 503)
        try:
            with httpx.Client(timeout=httpx.Timeout(180, connect=5), transport=self.transport,
                              follow_redirects=False) as client:
                with client.stream('POST', s.processor_url.rstrip('/') + '/v1/vectors/' + operation,
                    headers={'Authorization': 'Bearer ' + s.processor_token},
                    json={'schema_version': 1, 'embedding_identity': PROFILE_ID, **payload}) as response:
                    parts, size = [], 0
                    for part in response.iter_bytes():
                        size += len(part)
                        if size > 1_500_000:
                            raise ApiError('VECTOR_RESULT_INVALID', 502)
                        parts.append(part)
                    body = json.loads(b''.join(parts))
                    if response.status_code != 200:
                        code = body.get('error', {}).get('code')
                        if not isinstance(code, str) or not re.fullmatch('[A-Z_0-9]{1,80}', code):
                            code = 'VECTOR_PROVIDER_UNAVAILABLE'
                        raise ApiError(code, response.status_code if response.status_code in (401, 403, 409, 413, 422, 429, 502, 503) else 502)
                    result = body['data']
                    if result['embedding_identity'] != PROFILE_ID:
                        raise ApiError('EMBEDDING_PROFILE_MISMATCH', 409)
                    return result
        except httpx.HTTPError:
            raise ApiError('FILE_PROCESSOR_UNAVAILABLE', 503) from None
        except (ValueError, KeyError, TypeError, AttributeError, RecursionError):
            raise ApiError('VECTOR_RESULT_INVALID', 502) from None

    def write(self, owner, records):
        result = self.request('index', {'owner_id': owner, 'records': records})
        if result != {'objects': len(records), 'embedding_identity': PROFILE_ID}:
            raise ApiError('VECTOR_INDEX_INCOMPLETE', 502)
        return result

    def search(self, owner, client_id, project_id, files, query, limit):
        result = self.request('search', {'owner_id': owner, 'client_id': client_id, 'project_id': project_id,
            'files': [{'id': f['id'], 'generation': f['generation']} for f in files], 'query': query, 'limit': limit})
        rows = result.get('matches') if isinstance(result, dict) else None
        if not isinstance(rows, list) or len(rows) > limit:
            raise ApiError('VECTOR_RESULT_INVALID', 502)
        return rows

    def write_public(self,profile,records):
        result=self.request('public-index',{'profile_id':profile,'records':records})
        if result!={'objects':len(records),'embedding_identity':PROFILE_ID}:
            raise ApiError('VECTOR_INDEX_INCOMPLETE',502)
        return result

    def search_public(self,profile,files,query,limit,expected_chunks):
        result=self.request('public-search',{'profile_id':profile,'files':files,'query':query,'limit':limit,'expected_chunks':expected_chunks})
        rows=result.get('matches')
        if not isinstance(rows,list) or len(rows)>limit: raise ApiError('VECTOR_RESULT_INVALID',502)
        return rows

    def prune_public(self,profile,files):
        result=self.request('public-prune',{'profile_id':profile,'files':files})
        if result!={'pruned':True,'embedding_identity':PROFILE_ID}: raise ApiError('VECTOR_PRUNE_INCOMPLETE',502)
        return result
