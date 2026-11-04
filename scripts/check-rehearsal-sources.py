"""Verify the full configured source-tool path, without calling a language model."""
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'repos/trato-worker'))


def main():
    env = ROOT / 'repos/trato-worker/.env'
    for line in env.read_text().splitlines():
        if line.strip() and not line.lstrip().startswith('#') and '=' in line:
            key, value = line.split('=', 1)
            os.environ[key.strip()] = value.strip()
    from trato_worker.source_tools import BackendToolClient, prepare_rehearsal_sources
    from trato_worker.rehearsal_evaluation import citation_references
    _, bundle = prepare_rehearsal_sources(BackendToolClient.from_env())
    guides, refs = citation_references(bundle['files'])
    if len(guides) != 5 or not refs:
        raise ValueError('Incomplete library')
    print(json.dumps({'scope_id': bundle['scope_id'], 'sources_read': len(guides),
        'source_text_bytes': sum(len(f['text'].encode()) for f in bundle['files']),
        'reference_count': len(refs), 'model_called': False,
        'sources': [{k: f[k] for k in ('file_id', 'title', 'author', 'url', 'text_sha256')}
                    for f in bundle['files']]}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'error': {'code': getattr(error, 'code', 'SOURCE_VERIFICATION_FAILED')},
                          'model_called': False}))
        raise SystemExit(1) from None
