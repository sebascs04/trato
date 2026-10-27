import json
import sys
from .analysis import analyze
from .models import configured_model

try:
    raw = sys.stdin.buffer.read(100_001)
    if len(raw) > 100_000:
        raise ValueError('Entrada demasiado grande.')
    model = configured_model()
    try:
        result = analyze(json.loads(raw)['sources'], model)
        if hasattr(model, 'last_usage'):
            result['usage'] = model.last_usage
    finally:
        if hasattr(model, 'close'):
            model.close()
    print(json.dumps({'data': result}, ensure_ascii=False))
except Exception:
    # Do not leak document content, provider responses or credentials in errors.
    print(json.dumps({'error': {'code': 'ANALYSIS_FAILED', 'message': 'Revisa fuentes, configuración y disponibilidad del modelo seleccionado.'}}))
    sys.exit(1)
