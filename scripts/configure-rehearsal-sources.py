"""Validate the repository's five approved guides and explicitly configure the API."""
import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'repos/trato-api'))
sys.path.insert(0, str(ROOT / 'repos/trato-file-processor'))


def main():
    parser = argparse.ArgumentParser(description='Valida las cinco fuentes incluidas de Ensayos.')
    parser.add_argument('--configure', action='store_true', help='Seleccionar esta biblioteca en API .env.')
    args = parser.parse_args()
    from trato_api.agent_tools import SourceLibrary
    from file_processor.source_text import search_text_file_id
    manifest = ROOT / 'repos/trato-api/resources/rehearsal-sources/manifest.json'
    library = SourceLibrary(str(manifest)).load()
    result = search_text_file_id({'schema_version': 1, 'files': library['files']})
    if len(result['files']) != 5:
        raise ValueError('Incomplete approved source library')
    if args.configure:
        env = ROOT / 'repos/trato-api/.env'
        lines = env.read_text().splitlines() if env.exists() else []
        name = 'TRATO_REHEARSAL_SOURCE_MANIFEST'
        replacement = name + '=' + str(manifest)
        found = False
        for i, line in enumerate(lines):
            if line.partition('=')[0].strip() == name:
                lines[i] = replacement
                found = True
        if not found:
            lines.append(replacement)
        env.write_text('\n'.join(lines) + '\n')
        env.chmod(0o600)
    print(json.dumps({'sources_read': len(result['files']), 'scope_id': library['scope_id'],
                     'api_configured': args.configure, 'model_called': False}))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'error': {'code': getattr(error, 'code', 'SOURCE_LIBRARY_VERIFICATION_FAILED')}}))
        raise SystemExit(1) from None
