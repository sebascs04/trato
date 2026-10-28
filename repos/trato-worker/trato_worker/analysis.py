import json
import os
from typing import Protocol
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen

SCHEMA = {
    'type': 'object', 'additionalProperties': False,
    'required': ['relation', 'classification', 'summary', 'sources'],
    'properties': {
        'relation': {'type': 'string', 'enum': ['matches', 'unrelated', 'unclear']},
        'classification': {'type': 'string', 'enum': ['included', 'possible_extra', 'contradictory', 'ambiguous']},
        'summary': {'type': 'string', 'maxLength': 4000},
        'sources': {'type': 'array', 'maxItems': 20, 'items': {
            'type': 'object', 'additionalProperties': False, 'required': ['source_id', 'quote'],
            'properties': {'source_id': {'type': 'string'}, 'quote': {'type': 'string', 'minLength': 1, 'maxLength': 1000}}}}
    }
}


class Model(Protocol):
    def generate(self, messages: list, schema: dict) -> dict: ...


class OllamaModel:
    """Explicitly configured local model. Does not download or select a paid fallback."""
    def __init__(self, model=None, base_url=None):
        self.model = model or os.getenv('OLLAMA_MODEL', '')
        self.base_url = (base_url or os.getenv('OLLAMA_URL', 'http://127.0.0.1:11434')).rstrip('/')
        url = urlparse(self.base_url)
        if url.scheme != 'http' or url.hostname not in ('127.0.0.1', 'localhost') or url.username or url.password:
            raise ValueError('OLLAMA_URL debe apuntar al servidor local de modelos.')
        if not self.model:
            raise ValueError('Configura OLLAMA_MODEL con un modelo ya instalado y de licencia revisada.')

    def generate(self, messages, schema):
        payload = {'model': self.model, 'messages': messages, 'format': schema, 'stream': False,
                   'options': {'temperature': 0, 'num_predict': 2000}}
        request = Request(self.base_url + '/api/chat', data=json.dumps(payload).encode(),
                          headers={'Content-Type': 'application/json'}, method='POST')
        with urlopen(request, timeout=90) as response:
            raw = response.read(250_001)
            if len(raw) > 250_000:
                raise ValueError('La salida del modelo supera el límite.')
            result = json.loads(raw)
        return json.loads(result['message']['content'])


def analyze(sources, model: Model, *, output_language: str):
    """Sources must be retrieved and authorized by API, including the applicable agreement."""
    if output_language not in ('es', 'en'):
        raise ValueError('output_language must be es or en.')
    if not isinstance(sources, list) or not sources or len(sources) > 100:
        raise ValueError('Se requieren fuentes autorizadas y acotadas.')
    by_id = {}
    for source in sources:
        if not isinstance(source, dict) or not isinstance(source.get('id'), str) or source.get('kind') not in ('agreement', 'request'):
            raise ValueError('Fuente inválida.')
        if source['id'] in by_id or not isinstance(source.get('text'), str) or not source['text'].strip():
            raise ValueError('Fuente repetida o vacía.')
        by_id[source['id']] = source
    if {source['kind'] for source in sources} != {'agreement', 'request'}:
        raise ValueError('Faltan acuerdo aplicable o solicitud.')
    context = json.dumps(sources, ensure_ascii=False)
    if len(context.encode()) > 60_000:
        raise ValueError('Contexto demasiado grande; el backend debe seleccionar las fuentes.')
    template = json.loads((Path(__file__).resolve().parent.parent / 'prompts/compare-sources.json').read_text())
    messages = [
        {'role': 'system', 'content': template['role_description']},
        {'role': 'developer', 'content': template['instructions']},
        {'role': 'user', 'content': json.dumps({'sources': sources, 'output_language': output_language}, ensure_ascii=False)}
    ]
    result = model.generate(messages, SCHEMA)
    if not isinstance(result, dict) or set(result) != {'relation', 'classification', 'summary', 'sources'}:
        raise ValueError('Salida del modelo inválida.')
    if result['relation'] not in ('matches', 'unrelated', 'unclear') or result['classification'] not in ('included', 'possible_extra', 'contradictory', 'ambiguous'):
        raise ValueError('Clasificación del modelo inválida.')
    if not isinstance(result['summary'], str) or not 1 <= len(result['summary']) <= 4000:
        raise ValueError('Resumen inválido.')
    citations = result['sources']
    if not isinstance(citations, list) or len(citations) > 20:
        raise ValueError('Citas inválidas.')
    kinds = set()
    for citation in citations:
        if not isinstance(citation, dict) or set(citation) != {'source_id', 'quote'}:
            raise ValueError('Referencia inválida.')
        source = by_id.get(citation['source_id']) if isinstance(citation['source_id'], str) else None
        quote = citation['quote']
        if source is None or not isinstance(quote, str) or not quote.strip() or len(quote) > 1000 or quote not in source['text']:
            raise ValueError('Cita inexistente en las fuentes autorizadas.')
        kinds.add(source['kind'])
    if result['relation'] == 'matches' and kinds != {'agreement', 'request'}:
        raise ValueError('El análisis requiere evidencia del acuerdo y de la solicitud.')
    return {'schema_version': 1, 'output_language': output_language, 'mode': 'simulation' if getattr(model, 'mode', None) == 'simulation' else 'model', 'human_review_required': True,
            'analysis': result, 'sources': sources}
