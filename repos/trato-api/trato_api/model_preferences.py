"""Server-controlled tester access and owner-scoped model preference. No credentials in responses."""
import os
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, ValidationError
from redis import Redis
from redis.exceptions import RedisError
from starlette.concurrency import run_in_threadpool
from .errors import ApiError
from .business_routes import read_bytes

CATALOG = {'gemini-3.8-flash': 'Gemini 3.8 Flash', 'gemini-3.5-flash-lite': 'Gemini 3.5 Flash-Lite', 'gemini-3.1-flash-lite': 'Gemini 3.1 Flash-Lite', 'gemini-3.5-flash': 'Gemini 3.5 Flash', 'gemini-3.6-flash': 'Gemini 3.6 Flash', 'gemini-3.7-flash': 'Gemini 3.7 Flash', 'gemini-3.1-pro-preview': 'Gemini 3.1 Pro Preview', 'gemini-4-argon': 'Gemini 4 Argon'}

class ModelPreferences:
    def __init__(self, redis=None): self.redis = redis
    def configuration(self):
        allowed = os.getenv('TRATO_TEST_MODEL_IDS', '').split(',')
        default = os.getenv('TRATO_DEFAULT_MODEL', '')
        if not allowed or any(m not in CATALOG for m in allowed) or default not in allowed:
            raise ApiError('MODEL_SETTINGS_NOT_CONFIGURED', 503)
        return allowed, default
    def connection(self):
        if self.redis is None:
            url = os.getenv('TRATO_REDIS_URL', '')
            if not url.startswith(('redis://', 'rediss://')): raise ApiError('MODEL_SETTINGS_NOT_CONFIGURED', 503)
            self.redis = Redis.from_url(url, decode_responses=True, socket_connect_timeout=5, socket_timeout=5)
        return self.redis
    def can_select(self, request, owner):
        identity = getattr(request.state, 'identity', {})
        emails = {v.strip().lower() for v in os.getenv('TRATO_MODEL_TESTER_EMAILS', '').split(',') if v.strip()}
        return identity.get('id') == owner and bool(identity.get('email')) and identity['email'].lower() in emails
    def selected(self, owner):
        allowed, default = self.configuration()
        try: selected = self.connection().get('trato:model-preference:' + owner)
        except RedisError: raise ApiError('MODEL_SETTINGS_UNAVAILABLE', 503) from None
        # Absence means the configured default, not recovery from an invalid value.
        if selected is None: return default
        if selected not in allowed: raise ApiError('MODEL_SELECTION_UNAVAILABLE', 409)
        return selected
    def get(self, request, owner):
        allowed, default = self.configuration()
        editable = self.can_select(request, owner)
        return {'can_select': editable, 'selected_model': self.selected(owner), 'default_model': default,
                'scope': 'rehearsals', 'models': [{'id': m, 'name': CATALOG[m], 'family': 'lite' if 'lite' in m else 'pro' if 'pro' in m else 'argon' if 'argon' in m else 'flash'} for m in allowed] if editable else []}
    def save(self, request, owner, model):
        if not self.can_select(request, owner): raise ApiError('MODEL_SELECTION_FORBIDDEN', 403)
        allowed, _ = self.configuration()
        if model not in allowed: raise ApiError('MODEL_SELECTION_UNAVAILABLE', 422)
        try: self.connection().set('trato:model-preference:' + owner, model)
        except RedisError: raise ApiError('MODEL_SETTINGS_UNAVAILABLE', 503) from None
        return self.get(request, owner)

class Selection(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    model_id: str

def build_model_preferences_router(require_user, preferences=None):
    router = APIRouter(prefix='/api/v1/profile')
    preferences = preferences if preferences is not None else ModelPreferences()
    @router.get('/model')
    async def get(request: Request, owner=Depends(require_user)):
        data = await run_in_threadpool(preferences.get, request, owner)
        return JSONResponse({'data': data}, headers={'Cache-Control': 'no-store'})
    @router.post('/model')
    async def save(request: Request, owner=Depends(require_user)):
        try: value = Selection.model_validate_json(await read_bytes(request, 2048))
        except (ValidationError, ValueError): raise ApiError('INVALID_MODEL_SELECTION', 422)
        data = await run_in_threadpool(preferences.save, request, owner, value.model_id)
        return JSONResponse({'data': data}, headers={'Cache-Control': 'no-store'})
    return router
