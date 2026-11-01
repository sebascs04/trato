"""Configure Trato's own processor credentials. Never print or copy keys to API/worker."""
import argparse
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'repos/trato-file-processor'))


def values(path):
    result = {}
    for line in path.read_text().splitlines():
        if not line.strip() or line.lstrip().startswith('#'):
            continue
        key, separator, value = line.partition('=')
        if not separator:
            raise ValueError('Invalid environment file')
        result[key.strip()] = value.strip()
    return result


def update(path, changes):
    old = values(path) if path.exists() else {}
    if any(old.get(key) and old[key] != value for key, value in changes.items()):
        raise ValueError('Existing configuration differs; review it explicitly before replacing it')
    lines = path.read_text().splitlines() if path.exists() else []
    seen = set()
    for i, line in enumerate(lines):
        key = line.partition('=')[0].strip()
        if key in changes:
            lines[i] = key + '=' + changes[key]
            seen.add(key)
    lines += [key + '=' + value for key, value in changes.items() if key not in seen]
    path.write_text('\n'.join(lines) + '\n')
    path.chmod(0o600)


def main():
    parser = argparse.ArgumentParser(description='Configura búsqueda vectorial en el file processor de Trato.')
    parser.add_argument('--connection-file', type=Path, default=ROOT / '.local/weaviate/connection.env')
    parser.add_argument('--provision', action='store_true', help='Crear/verificar colección y los dos tenants acordados.')
    args = parser.parse_args()
    from file_processor.vector_store import WeaviateStore, VectorError
    from file_processor.vector_contract import COLLECTION, PROFILE_ID
    private = values(args.connection_file)
    if not private.get('WEAVIATE_URL') or not private.get('WEAVIATE_API_KEY'):
        raise ValueError('Missing private Weaviate configuration')
    store = WeaviateStore(private['WEAVIATE_URL'], private['WEAVIATE_API_KEY'])
    if args.provision:
        store.provision()
        from weaviate.classes.tenants import Tenant
        with store.connection() as client:
            collection = client.collections.use(COLLECTION)
            expected = {'projects_private', 'reputation_public'}
            existing = set(collection.tenants.get())
            if not existing.issubset(expected):
                raise VectorError('VECTOR_TENANT_LAYOUT_CONFLICT', 409)
            missing = expected - existing
            if missing:
                collection.tenants.create([Tenant(name=name) for name in sorted(missing)])
    else:
        with store.connection() as client:
            store.validate(client)
    update(ROOT / 'repos/trato-file-processor/.env', {
        'WEAVIATE_URL': private['WEAVIATE_URL'], 'WEAVIATE_API_KEY': private['WEAVIATE_API_KEY'],
        'TRATO_VECTOR_SEARCH_ENABLED': 'true'})
    update(ROOT / 'repos/trato-api/.env', {'TRATO_VECTOR_SEARCH_ENABLED': 'true'})
    print('Processor configured; API authorization enabled; embedding profile ' + PROFILE_ID)
    print('No documents indexed and no model inference executed. Restart only Trato services to load configuration.')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Do not dump URLs, credentials or provider response bodies.
        code = getattr(error, 'code', 'VECTOR_CONFIGURATION_FAILED')
        print(code, file=sys.stderr)
        raise SystemExit(1) from None
