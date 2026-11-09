"""Explicit Gemini backend for the worker. No model/provider auto-selection."""
import os
import re
import logging
import json
import time
from dataclasses import dataclass, field


class GeminiConfigurationError(ValueError):
    code = 'MODEL_CONFIGURATION_INVALID'


class GeminiUnavailableError(RuntimeError):
    code = 'MODEL_REQUEST_FAILED'


@dataclass(frozen=True)
class GeminiConfig:
    backend: str
    model: str
    api_key: str = field(default='', repr=False)
    project: str = ''
    location: str = ''
    credentials_file: str = field(default='', repr=False)

    @classmethod
    def from_env(cls, env=None):
        env = os.environ if env is None else env
        return cls(backend=env.get('TRATO_GEMINI_BACKEND', ''),
                   model=env.get('TRATO_GEMINI_MODEL', ''),
                   api_key=env.get('TRATO_GEMINI_API_KEY', ''),
                   project=env.get('TRATO_GOOGLE_CLOUD_PROJECT', ''),
                   location=env.get('TRATO_GOOGLE_CLOUD_LOCATION', ''),
                   credentials_file=env.get('TRATO_GOOGLE_CREDENTIALS_FILE', ''))

    def validate(self):
        if self.backend not in ('developer', 'vertex_express', 'vertex'):
            raise GeminiConfigurationError('Selecciona el backend de Gemini explícitamente.')
        if not re.fullmatch(r'gemini-[a-z0-9][a-z0-9.-]{0,100}', self.model):
            raise GeminiConfigurationError('Configura el identificador exacto del modelo elegido.')
        if self.backend in ('developer', 'vertex_express'):
            if not self.api_key or self.project or self.location or self.credentials_file:
                raise GeminiConfigurationError('Este backend requiere solo su clave y modelo explícitos.')
        elif self.api_key or not all((self.project, self.location, self.credentials_file)):
            raise GeminiConfigurationError('Vertex requiere proyecto, región y credenciales explícitas.')


def _check_shared_environment():
    # The SDK can infer another backend, key, project or endpoint from these.
    names = ('GOOGLE_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_GENAI_USE_VERTEXAI',
             'GOOGLE_CLOUD_PROJECT', 'GOOGLE_CLOUD_LOCATION',
             'GOOGLE_GEMINI_BASE_URL', 'GOOGLE_VERTEX_BASE_URL')
    if any(os.environ.get(name) for name in names):
        raise GeminiConfigurationError('Ejecuta el worker sin configuración Google implícita; usa las variables TRATO_.')


class GeminiLangChainModel:
    def __init__(self, config=None, *, client_factory=None, max_output_tokens=4096):
        self.config = config or GeminiConfig.from_env()
        self.config.validate()
        self.name = self.config.model
        _check_shared_environment()
        self.last_usage = None
        self.calls = 0
        if client_factory is None:
            from langchain_google_genai import ChatGoogleGenerativeAI
            client_factory = ChatGoogleGenerativeAI
        kwargs = dict(model=self.config.model, vertexai=self.config.backend != 'developer',
                      max_output_tokens=max_output_tokens, max_retries=0, timeout=120)
        if self.config.model == 'gemini-3.8-flash':
            kwargs['thinking_config'] = {'thinking_level': 'MEDIUM'}
        if self.config.backend == 'vertex':
            from google.oauth2 import service_account
            kwargs.update(project=self.config.project, location=self.config.location,
                          credentials=service_account.Credentials.from_service_account_file(
                              self.config.credentials_file,
                              scopes=['https://www.googleapis.com/auth/cloud-platform']))
        else:
            kwargs['api_key'] = self.config.api_key
        self._client = client_factory(**kwargs)

    def generate(self, messages, schema):
        self.last_usage = None
        self.calls += 1
        started = time.monotonic()
        invalid_response = False
        response = None
        try:
            from langsmith import tracing_context
            # No implicit transmission of project documents to a tracing service.
            with tracing_context(enabled=False):
                response = self._client.with_structured_output(
                    schema=schema, method='json_schema', include_raw=True).invoke(messages)
            if response.get('parsing_error') or not isinstance(response.get('parsed'), dict):
                invalid_response = True
                raise ValueError('Invalid structured output')
            usage = getattr(response.get('raw'), 'usage_metadata', None)
            if isinstance(usage, dict):
                self.last_usage = {key: usage[key] for key in ('input_tokens', 'output_tokens', 'total_tokens')
                                   if isinstance(usage.get(key), int) and usage[key] >= 0}
            return response['parsed']
        except Exception as error:
            code = 'MODEL_INVALID_RESPONSE' if invalid_response else 'MODEL_REQUEST_FAILED'
            # Sizes, counts and fixed labels only: never the provider's message, prompts or document text.
            diagnostic = {'event': 'model_request_failed', 'error_code': code, 'exception_type': type(error).__name__, 'model': self.name,
                          'call_number': self.calls, 'elapsed_ms': round(1000 * (time.monotonic() - started)),
                          'input_chars': sum(len(str(getattr(message, 'content', message))) for message in messages)}
            if isinstance(response, dict):
                raw = response.get('raw')
                metadata = getattr(raw, 'response_metadata', {})
                reason = metadata.get('finish_reason') if isinstance(metadata, dict) else None
                if reason in ('STOP','MAX_TOKENS','SAFETY','RECITATION','OTHER'):
                    diagnostic['finish_reason'] = reason
                if response.get('parsing_error') is not None:
                    diagnostic['parsing_error_type'] = type(response['parsing_error']).__name__
            status = None
            cause = error
            for _ in range(4):
                candidate = getattr(cause, 'status_code', None) or getattr(cause, 'code', None)
                if type(candidate) is int:
                    status = candidate
                    break
                cause = cause.__cause__ or cause.__context__
                if cause is None: break
            if status is None and type(error).__module__.startswith('langchain_google_genai'):
                status = {'GoogleInvalidRequestError': 400, 'GoogleAuthenticationError': 401,
                          'GooglePermissionDeniedError': 403, 'GoogleModelNotFoundError': 404,
                          'GoogleRateLimitError': 429}.get(type(error).__name__)
            if status == 400:
                # Emit only fixed labels, never the provider's message or source text.
                text = str(error).lower()
                reasons = {'schema_complexity': ('too many states','too complex','complexity'),
                           'schema_enum': ('enum',), 'schema_constraint': ('maxitems','minitems','maxlength','minlength'),
                           'output_token_configuration': ('max_output_tokens','maxoutputtokens'),
                           'thinking_configuration': ('thinking',), 'unsupported_field': ('not supported','unsupported')}
                diagnostic['request_issue_hints'] = [name for name, markers in reasons.items() if any(marker in text for marker in markers)]
            if status == 429:
                # Tells a shared-capacity rejection from a limit of this project.
                chain, seen = [], error
                for _ in range(4):
                    if seen is None: break
                    chain.append(str(seen).lower())
                    seen = seen.__cause__ or seen.__context__
                text = ' '.join(chain)
                reasons = {'resource_exhausted': ('resource exhausted', 'resource_exhausted'), 'quota_failure': ('quota exceeded', 'quotafailure', 'quota metric', 'quota_metric'),
                           'per_minute': ('per minute', 'perminute'), 'per_day': ('per day', 'perday'), 'tokens': ('token',),
                           'billing': ('billing',), 'retry_delay': ('retrydelay', 'retry in', 'retry after')}
                diagnostic['rate_limit_hints'] = [name for name, markers in reasons.items() if any(marker in text for marker in markers)]
            if type(status) is int:
                diagnostic['status_code'] = status
                if not invalid_response:
                    code = {400:'MODEL_REQUEST_REJECTED',401:'MODEL_ACCESS_DENIED',403:'MODEL_ACCESS_DENIED',
                            404:'MODEL_UNAVAILABLE',429:'MODEL_QUOTA_EXCEEDED'}.get(status, code)
                    diagnostic['error_code'] = code
            logging.getLogger(__name__).warning(json.dumps(diagnostic))
            # Do not expose provider messages, prompts, document text or API keys.
            # No retry, substitute response, alternate model or alternate backend.
            failure = GeminiUnavailableError('Gemini no pudo completar el análisis; conserva las fuentes y revisa el servicio.')
            failure.code = code
            raise failure from None

    def close(self):
        client = getattr(self._client, 'client', None)
        if client is not None:
            client.close()
