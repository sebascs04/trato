import os, unittest
from types import SimpleNamespace
from unittest.mock import patch
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from fastapi.responses import JSONResponse
from trato_api.model_preferences import ModelPreferences, build_model_preferences_router
from trato_api.errors import ApiError
from redis.exceptions import ConnectionError

class Store:
    def __init__(self): self.values={}
    def get(self,k): return self.values.get(k)
    def set(self,k,v): self.values[k]=v

class ModelPreferenceTests(unittest.TestCase):
    def setUp(self):
        self.environment=patch.dict(os.environ,{'TRATO_DEFAULT_MODEL':'gemini-3.8-flash','TRATO_TEST_MODEL_IDS':'gemini-3.8-flash,gemini-3.5-flash-lite','TRATO_MODEL_TESTER_EMAILS':'tester@example.com'},clear=True)
        self.environment.start();self.addCleanup(self.environment.stop)
        self.store=Store();self.preferences=ModelPreferences(self.store)
    def request(self,email='tester@example.com',id='a'):
        return SimpleNamespace(state=SimpleNamespace(identity={'id':id,'email':email}))
    def test_persists_per_owner_and_does_not_change_another_user(self):
        self.assertTrue(self.preferences.get(self.request(),'a')['can_select'])
        self.preferences.save(self.request(),'a','gemini-3.5-flash-lite')
        self.assertEqual(self.preferences.selected('a'),'gemini-3.5-flash-lite')
        self.assertEqual(self.preferences.selected('b'),'gemini-3.8-flash')
    def test_other_user_cannot_select_even_with_forged_owner_or_model(self):
        for request in [self.request('other@example.com'),self.request(id='b'),SimpleNamespace(state=SimpleNamespace())]:
            with self.assertRaises(ApiError) as error:self.preferences.save(request,'a','gemini-3.5-flash-lite')
            self.assertEqual(error.exception.status,403)
        with self.assertRaises(ApiError):self.preferences.save(self.request(),'a','gemini-unknown-model')
        self.assertFalse(self.preferences.get(self.request('other@example.com'),'a')['can_select'])
    def test_failure_or_retired_selection_never_silently_uses_default(self):
        self.store.set('trato:model-preference:a','removed-model')
        with self.assertRaises(ApiError):self.preferences.selected('a')
        with patch.object(self.store,'get',side_effect=ConnectionError):
            with self.assertRaises(ApiError) as error:self.preferences.selected('a')
            self.assertEqual(error.exception.code,'MODEL_SETTINGS_UNAVAILABLE')
    def test_routes_validate_and_only_return_safe_data(self):
        app=FastAPI()
        def user(request:Request):request.state.identity={'id':'a','email':'tester@example.com'};return 'a'
        app.include_router(build_model_preferences_router(user,self.preferences))
        @app.exception_handler(ApiError)
        async def error(_,e):return JSONResponse({'error':{'code':e.code}},status_code=e.status)
        with TestClient(app) as client:
            self.assertEqual(client.get('/api/v1/profile/model').status_code,200)
            self.assertEqual(client.post('/api/v1/profile/model',json={'model_id':'gemini-3.5-flash-lite'}).status_code,200)
            self.assertEqual(client.post('/api/v1/profile/model',json={'model_id':'gemini-3.8-flash','owner':'b'}).status_code,422)
            self.assertNotIn('credential',client.get('/api/v1/profile/model').text)
