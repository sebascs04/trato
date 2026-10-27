import copy
from hashlib import sha256
import json
from pathlib import Path
import socket
import unittest
from unittest.mock import patch
import httpx
from trato_worker.connected import ConnectedWorker,ExtractionClient

BASE=json.loads((Path(__file__).resolve().parent.parent/'examples/document-upload.thread.json').read_text())

class ConnectedTests(unittest.TestCase):
    def setUp(self):
        self.raw=b'%PDF-simulation-of-storage-transport'
        self.message=copy.deepcopy(BASE);self.message['mode']='connected'
        self.message['payload']={k:self.message['payload'][k] for k in ('document_id','extraction_id','kind')}
        self.message['payload']['sha256']=sha256(self.raw).hexdigest()
        self.extraction={'schema_version':1,'sha256':sha256(self.raw).hexdigest(),'format':'pdf','size_bytes':len(self.raw),'parser':'test','parser_version':'1','warnings':[],'segments':[{'index':1,'locator':{'kind':'page','page':1},'text':'Texto del acuerdo.'}]}
        self.calls=[]

    def transport(self, request):
        self.calls.append(request)
        if request.url.path=='/internal/threads/claim':
            doc={'id':self.message['payload']['document_id'],'project_id':self.message['context']['project_id'],
                 'sha256':self.message['payload']['sha256'],'size_bytes':len(self.raw),'mime_type':'application/pdf','original_filename':'acuerdo.pdf'}
            return httpx.Response(200,json={'data':{'terminal':False,'document':doc,'extraction_id':self.message['payload']['extraction_id'],'lease_id':BASE['event_id']}})
        if request.url.path.endswith('/original'):return httpx.Response(200,content=self.raw)
        if request.url.path=='/v1/extractions':
            self.assertEqual(request.content,self.raw)
            return httpx.Response(200,json={'data':self.extraction})
        raise AssertionError(request.url)

    def worker(self, transport=None):
        return ConnectedWorker(ExtractionClient('http://api.invalid','worker-only','http://processor.invalid','processor-only',
                                                transport=httpx.MockTransport(transport or self.transport)))

    def test_document_remains_private_and_real_mode_never_validates_semantics(self):
        progress=[]
        with patch.object(socket.socket,'connect',side_effect=AssertionError('No network')):
            result=self.worker().handle(self.message,progress.append)
        self.assertEqual(result['action'],'completed')
        self.assertEqual(result['result']['relevance_status'],'not_evaluated')
        self.assertEqual(result['result']['extraction'],self.extraction)
        self.assertEqual([p['result']['step'] for p in progress],['reading_original','extracting_text'])
        self.assertEqual(self.calls[0].headers['authorization'],'Bearer worker-only')
        self.assertEqual(self.calls[-1].headers['authorization'],'Bearer processor-only')
        self.assertNotIn('fixture_id',json.dumps(result))

    def test_hash_mismatch_does_not_call_processor(self):
        self.message['payload']['sha256']='a'*64
        result=self.worker().handle(self.message)
        self.assertEqual(result['action'],'failed')
        self.assertEqual(result['result']['error_code'],'ORIGINAL_HASH_MISMATCH')
        self.assertFalse(any(r.url.path=='/v1/extractions' for r in self.calls))

    def test_transport_failure_never_becomes_simulated_output(self):
        def unavailable(request):raise httpx.ConnectError('private configuration',request=request)
        with self.assertRaisesRegex(RuntimeError,'INTERNAL_SERVICE_UNAVAILABLE'):
            self.worker(unavailable).handle(self.message)

    def test_simulation_envelope_is_rejected_before_claim(self):
        self.message['mode']='simulation'
        with self.assertRaises(ValueError):self.worker().handle(self.message)
        self.assertEqual(self.calls,[])
