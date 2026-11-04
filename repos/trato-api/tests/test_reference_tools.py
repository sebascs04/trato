from copy import deepcopy
from hashlib import sha256
import os
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient
from trato_api.reference_tools import ReferenceTools,build_reference_tools_router
from trato_api.agent_tools import SourceLibrary
from trato_api.errors import ApiError
from trato_api.vector_contract import PROFILE_ID
from test_agent_tools import make_library

class ReferenceToolTests(unittest.TestCase):
    def setUp(self):
        self.temp=TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        path,_,files=make_library(Path(self.temp.name));self.library=SourceLibrary(str(path));self.bundle=self.library.load();self.files=files;self.calls=[]
        parent=self
        class Receipts:
            def get(self,scope):return {'scope_id':scope,'embedding_identity':PROFILE_ID,'file_chunks':{f['file_id']:1 for f in files}}
        class Processor:
            def search(self,payload):
                parent.calls.append(payload);f=files[0];text=f['segments'][0]['text']
                return {'scope_id':payload['scope_id'],'hits':[{'file_id':f['file_id'],'segment_id':'section-1','text':text,'start_char':0,'end_char':len(text),'text_sha256':sha256(text.encode()).hexdigest(),'score':.7}]}
        self.processor=Processor();self.service=ReferenceTools(None,library=self.library,processor=self.processor,receipts=Receipts())
        self.call={'workflow':'rehearsal_feedback','scope_id':self.bundle['scope_id'],'tool':'search_reference_passages','params':{'query':'scope clarification'}}
    def test_search_uses_backend_receipt_and_returns_canonical_original_context(self):
        result=self.service.execute(self.call);self.assertEqual(result['files'][0]['segments'],self.files[0]['segments'])
        self.assertEqual(self.calls[0]['expected_chunks'],{f['file_id']:1 for f in self.files});self.assertNotIn('tenant',self.calls[0]);self.assertEqual(self.calls[0]['neighbor_count'],1)
        self.assertNotIn('text',self.service.catalog()['documents'][0])
    def test_prompt_cannot_select_tenant_or_foreign_source_or_mutating_tool(self):
        for mutate,code in [(lambda c:c['params'].update(tenant='projects_private'),'INVALID_TOOL_CALL'),(lambda c:c['params'].update(file_ids=['not-authorized']),'SOURCE_NOT_ALLOWED'),(lambda c:c.update(tool='index_references'),'TOOL_NOT_ALLOWED'),(lambda c:c.update(scope_id='0'*64),'SOURCE_SCOPE_CHANGED')]:
            call=deepcopy(self.call);mutate(call)
            with self.subTest(code=code),self.assertRaises(ApiError) as error:self.service.execute(call)
            self.assertEqual(error.exception.code,code)
        self.assertFalse(self.calls)
    def test_processor_text_is_checked_against_original_not_just_its_hash(self):
        original=self.processor.search
        def corrupt(payload):
            result=original(payload);hit=result['hits'][0];hit['text']='Forged';hit['text_sha256']=sha256(hit['text'].encode()).hexdigest();return result
        self.processor.search=corrupt
        with self.assertRaises(ApiError) as error:self.service.execute(self.call)
        self.assertEqual(error.exception.code,'INVALID_PROCESSOR_RESPONSE')
    def test_receipt_must_match_corpus_and_embedding_space(self):
        self.service.receipts.get=lambda scope:{'scope_id':scope,'embedding_identity':'wrong','file_chunks':{}}
        with self.assertRaises(ApiError) as error:self.service.catalog()
        self.assertEqual(error.exception.code,'REFERENCE_INDEX_RECEIPT_INVALID');self.assertFalse(self.calls)
    def test_context_read_is_bound_to_authorized_file_and_returns_original_segments(self):
        class Reader:
            def read(self,files):return {'files':files}
        self.service.reader=Reader();call=deepcopy(self.call);call.update(tool='read_reference_context',params={'file_id':self.files[0]['file_id'],'segment_id':'section-1'})
        result=self.service.execute(call);self.assertEqual(result['files'][0]['segments'],self.files[0]['segments']);self.assertFalse(self.calls)
    def test_http_tools_are_worker_only(self):
        app=FastAPI();app.include_router(build_reference_tools_router(None,self.service))
        @app.exception_handler(ApiError)
        async def error(_,e):return JSONResponse({'error':{'code':e.code}},status_code=e.status)
        with patch.dict(os.environ,{'TRATO_WORKER_TOKEN':'private-test-token'}),TestClient(app) as client:
            self.assertEqual(client.get('/internal/reference-tools/catalog').status_code,401)
            self.assertEqual(client.get('/internal/reference-tools/catalog',headers={'Authorization':'Bearer private-test-token'}).status_code,200)
