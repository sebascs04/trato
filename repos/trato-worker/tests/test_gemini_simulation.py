import copy
import socket
import unittest
from unittest.mock import patch
from trato_worker.analysis import SCHEMA,analyze
from trato_worker.gemini import GeminiUnavailableError
from trato_worker.gemini_simulation import GeminiSimulationModel,response_fixture
from test_gemini import SOURCES,RESULT

class GeminiSimulationTests(unittest.TestCase):
    def model(self,response=None,**kwargs):
        model=GeminiSimulationModel(model='gemini-simulation',mode='simulation',
                                   response=response if response is not None else response_fixture(RESULT),**kwargs)
        self.addCleanup(model.close)
        return model

    def test_actual_sdk_serializes_vertex_contract_without_network(self):
        model=self.model()
        with patch.object(socket.socket,'connect',side_effect=AssertionError('No network')):
            result=analyze(SOURCES,model)
        self.assertEqual(result['mode'],'simulation')
        request=model.requests[0]
        self.assertEqual(request['method'],'POST')
        self.assertIn('projects/simulation-project/locations/us-central1/publishers/google/models/gemini-simulation:generateContent',request['path'])
        self.assertEqual(request['body']['generationConfig']['responseMimeType'],'application/json')
        self.assertEqual(request['body']['generationConfig']['responseJsonSchema'],SCHEMA)
        self.assertIn('PRE-TASK CHECKLIST',str(request['body']['systemInstruction']))
        self.assertTrue(result['human_review_required'])

    def test_error_blocking_and_truncation_are_not_replaced(self):
        blocked={'promptFeedback':{'blockReason':'SAFETY'}}
        truncated=response_fixture(RESULT);truncated['candidates'][0]['finishReason']='MAX_TOKENS'
        malformed=response_fixture(RESULT);malformed['candidates'][0]['content']['parts'][0]['text']='not JSON'
        for value,status in [(blocked,200),(truncated,200),(malformed,200),({'error':{'message':'private'}},503)]:
            model=self.model(value,status_code=status)
            with self.assertRaises(GeminiUnavailableError):model.generate([{'role':'user','content':'Texto'}],SCHEMA)
            self.assertEqual(len(model.requests),1)

    def test_forged_citation_is_rejected_after_provider_json(self):
        invalid=copy.deepcopy(RESULT);invalid['sources'][0]['quote']='Inventado'
        with self.assertRaises(ValueError):analyze(SOURCES,self.model(response_fixture(invalid)))
