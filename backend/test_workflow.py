import os
from pathlib import Path
import subprocess
import json
import tempfile
import unittest

ROOT=Path(__file__).resolve().parent.parent

class WorkflowTest(unittest.TestCase):
    def setUp(self):
        self.directory=tempfile.TemporaryDirectory()
        self.env={**os.environ,'TRATO_LOCAL_DATA':self.directory.name,'LANGSMITH_TRACING':'false','LANGCHAIN_TRACING_V2':'false'}
        self.owner='a'*64
    def tearDown(self): self.directory.cleanup()
    def call(self,**payload):
        result=subprocess.run([str(ROOT/'.venv/bin/python'),str(ROOT/'backend/workflow_worker.py')],input=json.dumps({'owner':self.owner,**payload}),text=True,capture_output=True,env=self.env,check=True)
        return json.loads(result.stdout)
    def create(self,id='req-1'):
        result=self.call(action='create',input={'project_id':'SP-001','request_id':id,'subject':'Agregar una versión','message':'Agregar una versión vertical para redes.','sender':'cliente@example.com','email_date':'2026-10-24'})
        self.assertTrue(result['ok'],result)
        return result
    def resume(self,run,step,**value):
        result=self.call(action='resume',run_id=run['run_id'],expected_step=step,value=value)
        self.assertTrue(result['ok'],result)
        return result
    def test_full_flow_is_persisted_and_never_signs_a_real_agreement(self):
        run=self.create()
        self.assertEqual(run['pending']['step'],'confirm')
        same=self.create();self.assertEqual(same['run_id'],run['run_id'])
        run=self.resume(run,'confirm',confirmed=True)
        run=self.resume(run,'pertinence',relation='matches')
        self.assertEqual(run['state']['analysis']['mode'],'simulation')
        run=self.resume(run,'analysis',reviewed=True)
        run=self.resume(run,'proposal',option='extra',scope='Agregar una versión vertical',amount='120.50',days=3,terms='Revisar condiciones antes de firmar')
        self.assertFalse(run['state']['adenda']['signed'])
        run=self.resume(run,'signature',signed=True)
        self.assertEqual(run['state']['status'],'simulation_complete')
        self.assertTrue(run['state']['signature_simulated'])
        self.assertFalse(run['state']['adenda']['signed'])
        reopened=self.call(action='get',run_id=run['run_id'])
        self.assertEqual(reopened['state'],run['state'])
        stale=self.call(action='resume',run_id=run['run_id'],expected_step='signature',value={'signed':True})
        self.assertFalse(stale['ok'])
    def test_demo_accepts_unknown_sender_and_date_without_inventing_them(self):
        run=self.call(action='create',input={'project_id':'SP-001','request_id':'optional-demo','subject':'correo.pdf','message':'Agregar subtítulos a la entrega.'})
        self.assertTrue(run['ok'],run)
        self.assertEqual(run['state']['sender'],'')
        self.assertEqual(run['state']['email_date'],'')

    def test_foreign_session_cannot_read_run(self):
        run=self.create();self.owner='b'*64
        self.assertFalse(self.call(action='get',run_id=run['run_id'])['ok'])
        self.assertEqual(self.call(action='list')['runs'],[])
    def test_unrelated_is_blocked_and_unclear_returns_to_confirmation(self):
        run=self.resume(self.create(),'confirm',confirmed=True)
        run=self.resume(run,'pertinence',relation='unrelated')
        self.assertEqual(run['state']['status'],'blocked');self.assertIsNone(run['pending'])
        run=self.resume(self.create('req-2'),'confirm',confirmed=True)
        run=self.resume(run,'pertinence',relation='unclear')
        self.assertEqual(run['pending']['step'],'clarification')
        run=self.resume(run,'clarification',message='La versión vertical corresponde al video del proyecto.')
        self.assertEqual(run['pending']['step'],'confirm')
    def test_invalid_price_does_not_advance(self):
        run=self.resume(self.create(),'confirm',confirmed=True)
        run=self.resume(run,'pertinence',relation='matches')
        run=self.resume(run,'analysis',reviewed=True)
        for amount in ['NaN','-1','0.001']:
            result=self.call(action='resume',run_id=run['run_id'],expected_step='proposal',value={'option':'extra','scope':'Agregar otra versión','amount':amount,'days':2})
            self.assertFalse(result['ok'])
        self.assertEqual(self.call(action='get',run_id=run['run_id'])['pending']['step'],'proposal')

if __name__=='__main__':unittest.main()
