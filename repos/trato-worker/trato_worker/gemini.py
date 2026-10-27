"""Explicit Gemini backend for the worker. No model/provider auto-selection."""
import os
import re
from dataclasses import dataclass, field


class GeminiConfigurationError(ValueError):
    pass


class GeminiUnavailableError(RuntimeError):
    pass


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
    def __init__(self, config=None, *, client_factory=None):
        self.config = config or GeminiConfig.from_env()
        self.config.validate()
        _check_shared_environment()
        self.last_usage = None
        if client_factory is None:
            from langchain_google_genai import ChatGoogleGenerativeAI
            client_factory = ChatGoogleGenerativeAI
        kwargs = dict(model=self.config.model, vertexai=self.config.backend != 'developer',
                      max_output_tokens=4096, max_retries=0, timeout=60)
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
        try:
            from langsmith import tracing_context
            # No implicit transmission of project documents to a tracing service.
            with tracing_context(enabled=False):
                response = self._client.with_structured_output(
                    schema=schema, method='json_schema', include_raw=True).invoke(messages)
            if response.get('parsing_error') or not isinstance(response.get('parsed'), dict):
                raise ValueError('Invalid structured output')
            usage = getattr(response.get('raw'), 'usage_metadata', None)
            if isinstance(usage, dict):
                self.last_usage = {key: usage[key] for key in ('input_tokens', 'output_tokens', 'total_tokens')
                                   if isinstance(usage.get(key), int) and usage[key] >= 0}
            return response['parsed']
        except Exception:
            # Do not expose provider messages, prompts, document text or API keys.
            # No retry, substitute response, alternate model or alternate backend.
            raise GeminiUnavailableError('Gemini no pudo completar el análisis; conserva las fuentes y revisa el servicio.') from None

    def close(self):
        client = getattr(self._client, 'client', None)
        if client is not None:
            client.close()
