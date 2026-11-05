"""Verify durable case outcome delivery before stream acknowledgment without a model call."""
import json, unittest
from unittest.mock import patch
from uuid import uuid4
from trato_worker.ai_jobs import AIConsumer
from trato_worker.source_tools import ToolError

class Redis:
 def __init__(self,data):self.row={'input':json.dumps(data),'status':'queued'};self.events=[]
 def xautoclaim(self,*a,**k):return ('0',[])
 def xreadgroup(self,*a,**k):return [('stream',[('1',{'job_id':JOB})])]
 def eval(self,script,count,*args):
  if 'queued' in script:self.row['status']='running';return 1
  if self.row['status']!='running' or self.row['execution_id']!=args[1]:return 0
  self.row.update({'status':args[2],args[3]:args[4]});self.events.append('finish');return 1
 def hset(self,key,field,value):self.row[field]=value
 def hget(self,key,field):return self.row.get(field)
 def xack(self,*a):self.events.append('ack')
 def xdel(self,*a):pass
JOB=str(uuid4())
class ArchiveTests(unittest.TestCase):
 def run_case(self,fail_archive=False,fail_model=False):
  redis=Redis({'workflow':'project_assistant','case_context':{'session_id':str(uuid4())}})
  class Backend:
   def request(_,method,path,**kwargs):
    redis.events.append('archive');self.assertEqual(redis.row['status'],'running')
    self.assertEqual(path,'/internal/case-assistant/'+JOB+'/complete')
    self.assertEqual(kwargs['json']['execution_id'],redis.row['execution_id'])
    if fail_archive:raise ToolError('SERVICE_UNAVAILABLE')
    return {'stored':True}
  with patch('trato_worker.project_assistant.run_project_assistant',side_effect=ToolError('MODEL_REQUEST_FAILED') if fail_model else None,return_value={'kind':'project_assistant'}) as model:
   AIConsumer(redis,Backend(),object()).process_once()
   self.assertEqual(model.call_count,1)
  return redis
 def test_archive_is_committed_before_job_finish_and_ack(self):
  redis=self.run_case();self.assertEqual(redis.events,['archive','finish','ack']);self.assertEqual(redis.row['status'],'completed')
 def test_failed_archive_is_visible_and_never_reported_as_success(self):
  redis=self.run_case(fail_archive=True);self.assertEqual(redis.row['status'],'failed');self.assertEqual(redis.row['error_code'],'AI_CASE_ARCHIVE_FAILED')
 def test_model_failure_is_archived_without_reinference(self):
  redis=self.run_case(fail_model=True);self.assertEqual(redis.events,['archive','finish','ack']);self.assertEqual(redis.row['error_code'],'MODEL_REQUEST_FAILED')
