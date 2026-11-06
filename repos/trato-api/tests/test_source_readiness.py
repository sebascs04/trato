"""Document reading state stays distinct from vector preparation state."""
from copy import deepcopy
from unittest import TestCase
from test_vector_routes import Repo,Store,MemoryRedis,MemoryRegistry,Processor,OWNER,PROJECT,FILE
from trato_api.vector_routes import VectorGateway


class ReadinessRepo(Repo):
    def __init__(self,extraction):super().__init__();self.pending_extraction=extraction
    def extraction(self,file):
        value=super().extraction(file)
        value['extraction']=deepcopy(self.pending_extraction);value['segments']=[]
        return value


class SourceReadinessTests(TestCase):
    def snapshot(self,extraction):
        repo=ReadinessRepo(extraction)
        return VectorGateway(None,store=Store(),redis=MemoryRedis(),processor=Processor(),registry=MemoryRegistry()).snapshot(repo,OWNER,PROJECT)[1][0]
    def test_reserved_but_unrequested_reading_is_not_an_active_job(self):
        file=self.snapshot({'id':'extraction','status':'queued','worker_thread_id':None})
        self.assertEqual(file['status'],'source_pending')
        self.assertEqual(file['extraction_status'],'not_requested')
        self.assertIsNone(file['extraction_job_id'])
        self.assertIsNone(file['generation'])
    def test_requested_reading_preserves_the_real_job_id(self):
        file=self.snapshot({'id':'extraction','status':'queued','worker_thread_id':'actual-job'})
        self.assertEqual(file['extraction_status'],'queued')
        self.assertEqual(file['extraction_job_id'],'actual-job')
    def test_reading_failure_is_visible_and_separate_from_index_error(self):
        file=self.snapshot({'id':'extraction','status':'error','worker_thread_id':'actual-job','error_code':'PDF_TEXT_EMPTY'})
        self.assertEqual(file['extraction_status'],'error')
        self.assertEqual(file['extraction_error_code'],'PDF_TEXT_EMPTY')
        self.assertEqual(file['status'],'source_pending')
    def test_missing_extraction_is_not_presented_as_processing(self):
        self.assertEqual(self.snapshot(None)['extraction_status'],'not_requested')
    def test_ready_record_without_text_is_not_claimed_as_readable(self):
        file=self.snapshot({'id':'extraction','status':'ready','worker_thread_id':'actual-job'})
        self.assertEqual(file['extraction_status'],'error')
        self.assertEqual(file['extraction_error_code'],'EXTRACTION_TEXT_MISSING')

class ReadingRetryTests(TestCase):
    def post(self,status,segments):
        from fastapi import FastAPI
        from fastapi.responses import JSONResponse
        from fastapi.testclient import TestClient
        from trato_api.business_routes import build_business_router
        from trato_api.errors import ApiError
        class RetryRepo:
            calls=[]
            def document(self,file):return {'id':FILE}
            def extraction(self,file):return {'document':{'id':FILE},'extraction':status,'segments':segments}
            def queue_document(self,file):self.calls.append(file);return {'thread_id':'actual-job','status':'queued'}
        repo=RetryRepo();app=FastAPI()
        app.include_router(build_business_router(None,None,lambda:OWNER,repository_factory=lambda *args:repo))
        @app.exception_handler(ApiError)
        async def error(_,e):return JSONResponse({'error':{'code':e.code}},status_code=e.status)
        with TestClient(app) as api:response=api.post(f'/api/v1/documents/{FILE}/retry')
        return repo,response
    def test_ready_record_without_text_does_not_pretend_retry_repaired_it(self):
        repo,response=self.post({'status':'ready'},[])
        self.assertEqual(response.status_code,409)
        self.assertEqual(response.json()['error']['code'],'EXTRACTION_TEXT_MISSING')
        self.assertEqual(repo.calls,[])
    def test_missing_extraction_does_not_crash_before_queue_authorization(self):
        repo,response=self.post(None,[])
        self.assertEqual(response.status_code,202)
        self.assertEqual(repo.calls,[FILE])
    def test_readable_original_returns_existing_result_without_new_job(self):
        repo,response=self.post({'status':'ready'},[{'text':'Original text'}])
        self.assertEqual(response.status_code,200)
        self.assertEqual(repo.calls,[])
