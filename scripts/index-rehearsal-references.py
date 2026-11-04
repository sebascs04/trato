"""Explicitly index the configured approved library via API-owned authorization.

Run with the processor Python environment. No Weaviate SDK/key outside the processor.
"""
import argparse,json,os,runpy,sys
from pathlib import Path
from urllib.parse import urlparse
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'repos/trato-api'))

def main():
    parser=argparse.ArgumentParser(description='Index only the configured Trato reference library and store its completed receipt.')
    parser.add_argument('--index',required=True,action='store_true');parser.parse_args()
    env=runpy.run_path(str(ROOT/'scripts/dev-polyrepo.py'))['environment'](ROOT/'repos/trato-api')
    os.environ.update(env)
    from trato_api.app import Settings
    from trato_api.agent_tools import SourceLibrary,ProcessorSourceReader
    from trato_api.vector_contract import PROFILE_ID
    from redis import Redis
    import httpx
    settings=Settings.from_env();parsed=urlparse(settings.processor_url)
    if not settings.processor_token or parsed.scheme not in ('http','https') or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:raise ValueError('FILE_PROCESSOR_NOT_CONFIGURED')
    if not env.get('TRATO_REDIS_URL','').startswith(('redis://','rediss://')):raise ValueError('REFERENCE_INDEX_NOT_CONFIGURED')
    bundle=SourceLibrary().load();checked=ProcessorSourceReader(settings).read(bundle['files'])
    payload={'scope_id':bundle['scope_id'],'files':[{k:f[k] for k in ('file_id','text_sha256','segments')} for f in checked['files']]}
    with httpx.Client(timeout=240,follow_redirects=False) as client:
        response=client.post(settings.processor_url.rstrip('/')+'/v1/references/index',headers={'Authorization':'Bearer '+settings.processor_token},json=payload)
    body=response.json()
    if response.status_code!=200:raise ValueError(body.get('error',{}).get('code','REFERENCE_INDEX_FAILED'))
    receipt=body['data'];ids={f['file_id'] for f in checked['files']}
    if receipt.get('scope_id')!=bundle['scope_id'] or receipt.get('embedding_identity')!=PROFILE_ID or receipt.get('files_indexed')!=len(ids) or set(receipt.get('file_chunks',{}))!=ids or any(type(n) is not int or not 1<=n<=512 for n in receipt['file_chunks'].values()) or receipt.get('chunks')!=sum(receipt['file_chunks'].values()):raise ValueError('REFERENCE_INDEX_RECEIPT_INVALID')
    with Redis.from_url(env['TRATO_REDIS_URL'],decode_responses=True,socket_connect_timeout=5,socket_timeout=10) as connection:
        connection.set('trato:reference-library:receipt:'+bundle['scope_id'],json.dumps(receipt,separators=(',',':')))
    print(json.dumps({'status':'indexed',**receipt}))

if __name__=='__main__':
    try:main()
    except Exception as error:
        code=getattr(error,'code',None)
        if not code and isinstance(error,ValueError) and str(error).isupper() and len(str(error))<100:code=str(error)
        print(json.dumps({'error':{'code':code or 'REFERENCE_INDEX_FAILED'}}))
        raise SystemExit(1) from None
