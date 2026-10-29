"""Immutable, user-authorized PDF storage for explicitly shared experiences."""
from hashlib import sha256
from copy import copy
import os
from urllib.parse import quote
from .errors import ApiError

BUCKET='reputation-evidence'
MAX_FILE_BYTES=10*1024*1024

def action(repo,name,data):
    return repo.rpc('community_reputation',{'p_action':name,'p_data':data})

def public_metadata(item):
    return {k:item[k] for k in ('id','filename','size_bytes','sha256','status')}

def checked_bytes(repo,item):
    data=repo.call('GET','/storage/v1/object/authenticated/'+BUCKET+'/'+quote(item['storage_path'],safe='/'),binary=True)
    if len(data)!=item['size_bytes'] or sha256(data).hexdigest()!=item['sha256'] or not data.startswith(b'%PDF-'):
        raise ApiError('REPUTATION_ATTACHMENT_MISMATCH',409)
    return data

def upload(repo,project_id,filename,key,data):
    item=action(repo,'attachment_reserve',{'project_id':project_id,'filename':filename,'upload_key':key,'size_bytes':len(data),'sha256':sha256(data).hexdigest()})
    if item['status'] in ('ready','attached'):
        # A retried upload confirms the canonical immutable object rather than creating another.
        checked_bytes(repo,item)
        return public_metadata(item)
    if item['object_exists']:
        checked_bytes(repo,item)
    else:
        repo.call('POST','/storage/v1/object/'+BUCKET+'/'+quote(item['storage_path'],safe='/'),content=data,headers={'Content-Type':'application/pdf','x-upsert':'false'})
    result=action(repo,'attachment_ready',{'attachment_id':item['id']})
    return public_metadata(result)

def storage_reader(repo):
    # A community reader must never obtain Storage metadata containing another author's user ID.
    key=os.environ.get('SUPABASE_SERVER_KEY','')
    if not key or not key.startswith(('sb_secret_','eyJ')):
        raise ApiError('REPUTATION_FILE_BACKEND_NOT_CONFIGURED',503)
    reader=copy(repo);reader.headers=dict(repo.headers);reader.headers['apikey']=key
    if key.startswith('sb_secret_'):reader.headers.pop('Authorization',None)
    else:reader.headers['Authorization']='Bearer '+key
    return reader

def download(repo,attachment_id):
    item=action(repo,'attachment_read',{'attachment_id':attachment_id})
    data=checked_bytes(storage_reader(repo),item)
    # Withdrawal or removal during a slow download revokes community access before response.
    action(repo,'attachment_read',{'attachment_id':attachment_id})
    return item,data

def discard(repo,attachment_id):
    item=action(repo,'attachment_discard',{'attachment_id':attachment_id})
    repo.call('DELETE','/storage/v1/object/'+BUCKET,json={'prefixes':[item['storage_path']]})
    return {'discarded':True}
