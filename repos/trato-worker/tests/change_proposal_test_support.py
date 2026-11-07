"""In-memory records for change-assistance integration; no business writes allowed."""
from copy import deepcopy
from uuid import uuid4
import json
from trato_api.errors import ApiError
from trato_api.vector_routes import source

OWNER,OTHER,CLIENT,PROJECT,AGREEMENT,REQUEST,PROPOSAL,REVISION,FEEDBACK=[str(uuid4()) for _ in range(9)]
class Repo:
 def __init__(self):
  self.owner=OWNER;self.proposal=None;self.deliveries=[];self.mutations=[];self.contexts=[];self.acceptances=[]
  self.documents={AGREEMENT:{'id':AGREEMENT,'owner_id':OWNER,'project_id':PROJECT,'kind':'initial_agreement','title':'Original agreement','original_filename':'agreement.pdf','sha256':'a'*64},
    REQUEST:{'id':REQUEST,'owner_id':OWNER,'project_id':PROJECT,'kind':'email_request','title':'Additional request','original_filename':'request.pdf','sha256':'b'*64}}
  self.text={AGREEMENT:'The original agreement includes five pages.',REQUEST:'The client requests an additional payment module.'}
  self.extracts={file:str(uuid4()) for file in self.documents}
  self.segments={file:str(uuid4()) for file in self.documents}
 def project(self,id):
  if id!=PROJECT:raise ApiError('PROJECT_NOT_FOUND',404)
  return {'id':PROJECT,'owner_id':self.owner,'client_id':CLIENT,'name':'Integration project'}
 def document(self,id):
  if id not in self.documents:raise ApiError('DOCUMENT_NOT_FOUND',404)
  return deepcopy(self.documents[id])
 def extraction(self,id):
  doc=self.document(id)
  return {'document':doc,'extraction':{'id':self.extracts[id],'status':'ready','parser':'test','parser_version':'1'},
    'segments':[{'id':self.segments[id],'text':self.text[id],'locator_kind':'page','locator_number':1}]}
 def rows(self,table,params):
  if table=='clients':rows=[{'id':CLIENT,'owner_id':OWNER,'deleted_at':None}]
  elif table=='documents':rows=list(self.documents.values())
  elif table=='change_proposals':rows=[self.proposal] if self.proposal else []
  elif table=='proposal_revisions':rows=[{'id':REVISION,'proposal_id':PROPOSAL,'owner_id':OWNER,'project_id':PROJECT,'scope_summary':'Payment module','conditions':'Review','additional_minor':10000,'deadline':'2026-12-01','revision_no':1}] if self.proposal else []
  elif table=='proposal_deliveries':rows=self.deliveries
  elif table=='document_upload_contexts':rows=self.contexts
  elif table=='proposal_acceptances':rows=self.acceptances
  else:rows=[]
  for key,value in params.items():
   if key in ('select','order','limit','offset'):continue
   if value=='is.null':rows=[row for row in rows if row.get(key) is None]
   elif value.startswith('eq.'):rows=[row for row in rows if str(row.get(key))==value[3:]]
   elif value.startswith('in.('):rows=[row for row in rows if str(row.get(key)) in value[4:-1].split(',')]
  return deepcopy(rows[params.get('offset',0):params.get('offset',0)+params.get('limit',1000)])
 def rpc(self,*args,**kwargs):self.mutations.append(args);raise AssertionError('Agent must not mutate business records')
 def call(self,*args,**kwargs):self.mutations.append(args);raise AssertionError('Agent must not write records')
 def draft(self):self.proposal={'id':PROPOSAL,'owner_id':OWNER,'project_id':PROJECT,'request_document_id':REQUEST,'current_revision_id':REVISION,'status':'draft','locked_at':None}

 def revise(self):
  self.draft();self.proposal['status']='ready_for_review'
  self.deliveries=[{'id':str(uuid4()),'owner_id':OWNER,'project_id':PROJECT,'revision_id':REVISION,'kind':'adenda','status':'accepted_by_gmail'}]
  self.documents[FEEDBACK]={'id':FEEDBACK,'owner_id':OWNER,'project_id':PROJECT,'kind':'reference','title':'Client adjustments','original_filename':'adjustments.pdf','sha256':'c'*64}
  self.text[FEEDBACK]='Please keep the payment module but remove inventory management.'
  self.extracts[FEEDBACK]=str(uuid4());self.segments[FEEDBACK]=str(uuid4())
  self.contexts=[{'document_id':FEEDBACK,'owner_id':OWNER,'project_id':PROJECT,'purpose':'addendum_adjustments','revision_id':REVISION}]

class Jobs:
 def __init__(self):self.records={};self.last_id=None
 def enqueue(self,owner,id,data):
  self.last_id=id
  self.records[id]={'owner':owner,'input':json.dumps(data),'status':'queued'}
  return {'id':id,'status':'queued'}
 def connection(self):return self
 def row(self,key):return self.records[key.rsplit(':',1)[-1]]
 def hgetall(self,key):return self.row(key)
 def hget(self,key,field):return self.row(key).get(field)
 def eval(self,*args):
  self.row(args[2])['assistant_sources']=args[4];return 1
 def input(self,owner,id):self.get(owner,id);return json.loads(self.records[id]['input'])
 def get(self,owner,id,*args):
  row=self.records.get(id)
  if not row or row['owner']!=owner:raise ApiError('AI_NOT_FOUND',404)
  result={'id':id,'status':row['status']}
  if row['status']=='completed':result['result']=json.loads(row['result'])
  return result
 def start(self,id):
  lease=str(uuid4());self.records[id].update(status='running',execution_id=lease);return lease
 def finish(self,id,result):self.records[id].update(status='completed',result=json.dumps(result))

class Gateway:
 def search(self,repo,owner,project_id,query,limit,file_ids=None):
  project=repo.project(project_id);rows=[]
  for file in file_ids or list(repo.documents):
   value=source(repo,owner,project,file);seg=value['segments'][0]
   rows.append({'file_id':file,'title':value['document']['title'],'generation':value['generation'],'segment_id':seg['segment_id'],
     'text':seg['text'],'locator':seg['locator'],'start_char':0,'end_char':len(seg['text']),'score':0.9})
  return {'matches':rows}
