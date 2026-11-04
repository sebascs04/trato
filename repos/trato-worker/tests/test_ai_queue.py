import importlib.util,os,sys,unittest
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4
import test_ingestion_redis as redis_tests
from test_business_ai import Model,OUTPUT,REVIEW
from trato_worker.ai_jobs import AIConsumer,STREAM

@unittest.skipUnless(os.getenv('TRATO_RUN_REDIS_TESTS')=='1' and importlib.util.find_spec('fastapi'),'Explicit isolated Redis contracts')
class AIQueueTests(unittest.TestCase):
    setUpClass=classmethod(redis_tests.RedisIngestionTests.setUpClass.__func__)
    tearDownClass=classmethod(redis_tests.RedisIngestionTests.tearDownClass.__func__)
    def setUp(self):
        self.redis.flushdb() # Isolated temporary test process only, never Trato's live Redis.
        sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'trato-api'))
    def test_queue_processes_once_and_keeps_result_private(self):
        from trato_api.ai_jobs import AIJobs
        from trato_api.errors import ApiError
        jobs=AIJobs(self.redis);model=Model(OUTPUT);consumer=AIConsumer(self.redis,None,model);consumer.setup();id=str(uuid4())
        data={'workflow':'reputation','output_language':'es','reviews':[REVIEW]}
        with patch.dict(os.environ,{'TRATO_AI_WORKFLOWS_ENABLED':'true'}):
            self.redis.set('trato:ai:consumer:ready','1',ex=30)
            jobs.enqueue('owner',id,data);jobs.enqueue('owner',id,data)
            self.assertTrue(consumer.process_once());result=jobs.get('owner',id,'reputation')
            self.assertEqual(result['status'],'completed');self.assertEqual(result['result']['sources_read'],1)
            self.assertNotIn('reviews',result);self.assertEqual(len(model.calls),1)
            with self.assertRaises(ApiError):jobs.get('other',id)
            with self.assertRaises(ApiError):jobs.get('owner',id,'project_plan')
            self.redis.xadd(STREAM,{'job_id':id});consumer.process_once();self.assertEqual(len(model.calls),1)
    def test_document_index_job_calls_backend_not_model_and_is_not_automatically_retried(self):
        from trato_api.ai_jobs import AIJobs
        from trato_worker.source_tools import ToolError
        jobs=AIJobs(self.redis);model=Model(OUTPUT);calls=[]
        class Backend:
            def request(_,method,path,**kwargs):
                calls.append((method,path,kwargs))
                return {'kind':'document_index','status':'ready','id':'file','generation':'a'*64}
        consumer=AIConsumer(self.redis,Backend(),model);consumer.setup();id=str(uuid4())
        data={'workflow':'index_document','file_id':'file','generation':'a'*64}
        with patch.dict(os.environ,{'TRATO_AI_WORKFLOWS_ENABLED':'true'}):
            self.redis.set('trato:ai:consumer:ready','1',ex=30)
            jobs.enqueue('owner',id,data);consumer.process_once()
            self.assertEqual(jobs.get('owner',id)['status'],'completed')
            self.assertEqual(model.calls,[]);self.assertEqual(len(calls),1)
            self.assertIn('execution_id',calls[0][2]['json'])
            self.redis.xadd(STREAM,{'job_id':id});consumer.process_once();self.assertEqual(len(calls),1)
            failed_id=str(uuid4())
            with patch.object(consumer.client,'request',side_effect=ToolError('VECTOR_BATCH_FAILED')) as backend:
                jobs.enqueue('owner',failed_id,data);consumer.process_once()
                self.assertEqual(jobs.get('owner',failed_id)['status'],'failed')
                self.redis.xadd(STREAM,{'job_id':failed_id});consumer.process_once()
                self.assertEqual(backend.call_count,1)
    def test_a_stale_execution_cannot_overwrite_an_interrupted_job(self):
        from trato_api.ai_jobs import AIJobs,PREFIX
        jobs=AIJobs(self.redis);id=str(uuid4());model=Model(OUTPUT)
        class Backend:
            def request(_,method,path,**kwargs):
                self.redis.hset(PREFIX+id,mapping={'status':'failed','error_code':'AI_INTERRUPTED'})
                return {'kind':'document_index','status':'ready','id':'file','generation':'a'*64}
        consumer=AIConsumer(self.redis,Backend(),model);consumer.setup()
        with patch.dict(os.environ,{'TRATO_AI_WORKFLOWS_ENABLED':'true'}):
            self.redis.set('trato:ai:consumer:ready','1',ex=30)
            jobs.enqueue('owner',id,{'workflow':'index_document','file_id':'file','generation':'a'*64})
            consumer.process_once()
            self.assertEqual(jobs.get('owner',id)['status'],'failed')
            self.assertEqual(jobs.get('owner',id)['error_code'],'AI_INTERRUPTED')
