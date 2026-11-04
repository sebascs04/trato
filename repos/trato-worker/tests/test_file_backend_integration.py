"""Real graph/backend/processor contracts with explicit DB and model doubles."""
from copy import deepcopy
import json,os,sys,unittest
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient
import httpx
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'trato-api'))
from trato_api.file_processing import FileProcessing,enqueue_processing,build_file_processing_router
from trato_api.errors import ApiError
from file_processor.chunking import chunk_file
from trato_worker.file_pipeline.backend import BackendFileClient
from trato_worker.file_pipeline.runtime import build_file_pipeline
from trato_worker.source_tools import BackendToolClient
from test_file_pipeline import ModelDouble

class Repo:
    def __init__(self,kind='initial_agreement',purpose=None):
        self.owner,self.client,self.project_id,self.file,self.extract_id,self.revision,self.proposal,self.request=[str(uuid4()) for _ in range(8)]
        self.doc={'id':self.file,'owner_id':self.owner,'project_id':self.project_id,'kind':kind,
                  'sha256':'a'*64,'original_filename':'source.pdf'}
        self.option={'output_language':'en','purpose':purpose,'bindings':{'revision_id':self.revision} if purpose else {}}
        self.text='The project includes a website. The client requests two additional sections.'
        self.artifacts=[]
    def project(self,id):return {'id':self.project_id,'owner_id':self.owner,'client_id':self.client}
    def extraction(self,id):return {'document':deepcopy(self.doc),'extraction':{'id':self.extract_id,'status':'ready','parser':'test','parser_version':'1'},
        'segments':[{'id':'page-1','locator_kind':'page','locator_number':1,'text':self.text}]}
    def rows(self,table,params):
        if table=='clients':return [{'id':self.client}]
        if table=='file_processing_options':return [deepcopy(self.option)]
        if table=='file_processing_artifacts':
            rows=self.artifacts
            for key,value in params.items():
                if isinstance(value,str) and value.startswith('eq.'):rows=[r for r in rows if r.get(key)==value[3:]]
            return deepcopy(rows)
        if table=='proposal_revisions' and 'id' in params:
            return [{'id':self.revision,'proposal_id':self.proposal,'scope_summary':'A website','conditions':'Review','additional_minor':100,'deadline':'2026-12-01'}]
        if table=='change_proposals':return [{'id':self.proposal,'request_document_id':self.request}]
        return []
    def call(self,method,path,**kwargs):
        row=deepcopy(kwargs['json']);self.artifacts.append(row);return row
class Jobs:
    def __init__(self):self.row={};self.data=None;self.lease=str(uuid4())
    def enqueue(self,owner,id,data):
        self.data=data;self.row={'owner':owner,'status':'running','execution_id':self.lease,'input':json.dumps(data)}
        return {'id':id,'status':'queued'}
    def connection(self):return self
    def hgetall(self,key):return self.row
class Chunks:
    def read_text(self,v):
        from file_processor.prepared_text import read_prepared_file
        return read_prepared_file({'schema_version':1,'file_id':v['document']['id'],'source_sha256':v['document']['sha256'],
            'parser':v['extraction']['parser'],'parser_version':v['extraction']['parser_version'],'segments':v['segments']})
    def read(self,v):return chunk_file({'schema_version':1,'file_id':v['document']['id'],
        'source_fingerprint':v['generation'],'policy':{'version':'v1','max_chars':800,'overlap_chars':100,'max_chunks':512},'segments':v['segments']})['chunks']
class Gateway:
    def __init__(self):self.calls=[];self.states={}
    def index(self,repo,owner,project,file):self.calls.append(file);return {'status':'ready'}
    def connection(self):return self
    def receipt_key(self,owner,file):return file
    def set(self,key,value):self.states[key]=value

@patch.dict(os.environ,{'TRATO_FILE_PROCESSING_ENABLED':'true','TRATO_WORKER_TOKEN':'worker'})
class FileBackendIntegrationTests(unittest.TestCase):
    def setup_graph(self,kind='initial_agreement',purpose=None,model=None):
        repo=Repo(kind,purpose);jobs=Jobs();gateway=Gateway()
        service=FileProcessing(None,jobs=jobs,repo=repo,gateway=gateway,chunks=Chunks())
        enqueue_processing(repo,jobs,repo.owner,repo.project_id,repo.file,'test-model')
        app=FastAPI();app.include_router(build_file_processing_router(None,lambda:repo.owner,service=service))
        @app.exception_handler(ApiError)
        async def error(_,e):return JSONResponse({'error':{'code':e.code}},status_code=e.status)
        server=TestClient(app)
        def handler(request):
            response=server.request(request.method,request.url.path,content=request.content,headers=dict(request.headers))
            return httpx.Response(response.status_code,json=response.json())
        client=BackendToolClient('http://backend','worker',transport=httpx.MockTransport(handler))
        pipeline=build_file_pipeline(BackendFileClient(client),model or ModelDouble(),model_identity='test-model',
                    maximum_input_bytes=100000,enabled_purposes=('initial_agreement','change_request','supporting_reference',
                    'delivery_evidence','addendum_adjustments','acceptance_evidence'))
        return repo,jobs,gateway,service,client,pipeline
    def test_all_existing_project_entry_kinds_follow_real_tools_and_persist(self):
        for kind,purpose in [('initial_agreement',None),('email_request',None),('reference',None),('delivery',None),
                             ('reference','addendum_adjustments'),('addendum','acceptance_evidence')]:
            with self.subTest(kind=kind,purpose=purpose):
                repo,jobs,gateway,service,client,pipeline=self.setup_graph(kind,purpose)
                event=pipeline.run(jobs.data['thread'])
                self.assertEqual(event['action'],'completed',event)
                self.assertEqual(gateway.calls,[repo.file])
                self.assertEqual({r['stage'] for r in repo.artifacts},{'extraction','treatment','chunks','summary'})
                receipt=service.finalize(jobs.data['thread']['thread_id'],jobs.lease,event)
                self.assertEqual(receipt,{'stored':True,'status':'processed'})
                self.assertEqual(repo.artifacts[-1]['artifact']['output_language'],'en')
    def test_scope_change_and_foreign_lease_fail_before_tool(self):
        repo,jobs,gateway,service,client,pipeline=self.setup_graph()
        with self.assertRaises(ApiError):service.active(jobs.data['thread']['thread_id'],str(uuid4()))
        repo.text='The source was replaced after enqueue.'
        event=pipeline.run(jobs.data['thread'])
        self.assertEqual(event['action'],'failed');self.assertEqual(gateway.calls,[])
    def test_rejected_material_is_saved_but_never_indexed_or_treated_as_acceptance(self):
        class Unrelated(ModelDouble):
            def generate(self,messages,schema):
                value=super().generate(messages,schema)
                if 'detected_category' in value:value.update(detected_category='other',relevance='unrelated',reason='Unrelated source')
                return value
        repo,jobs,gateway,service,client,pipeline=self.setup_graph(model=Unrelated())
        event=pipeline.run(jobs.data['thread'])
        self.assertEqual(event['result']['status'],'rejected');self.assertEqual(gateway.calls,[])
        service.finalize(jobs.data['thread']['thread_id'],jobs.lease,event)
        self.assertEqual(json.loads(gateway.states[repo.file])['status'],'failed')
