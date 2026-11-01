"""Validate local deployment inputs; copy secrets only with explicit --write.

Never changes the live .env files, Google IAM, billing or remote resources.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]


def read_env(path):
    values = {}
    for raw in path.read_text().splitlines():
        if not raw.strip() or raw.lstrip().startswith('#'):
            continue
        key, separator, value = raw.partition('=')
        if not separator or not re.fullmatch(r'[A-Z][A-Z0-9_]*', key.strip()):
            raise ValueError('Invalid env input: ' + path.name)
        values[key.strip()] = value.strip()
    return values


def require(values, keys, label):
    missing = [key for key in keys if not values.get(key)]
    if missing:
        raise ValueError(label + ': missing ' + ', '.join(missing))


def load_inputs(root=ROOT):
    names = {'api': 'trato-api', 'processor': 'trato-file-processor', 'worker': 'trato-worker'}
    values = {}
    for role, repo in names.items():
        base = root / 'repos' / repo
        allowed = set(read_env(base / '.env.example'))
        if role == 'api':
            allowed.update(('PAYPAL_RETURN_URL', 'PAYPAL_CANCEL_URL', 'TRATO_PAYPAL_TEST_ENABLED', 'PAYPAL_TEST_RETURN_URL', 'PAYPAL_TEST_CANCEL_URL', 'PAYPAL_TEST_STORE'))
        values[role] = {k: v for k, v in read_env(base / '.env').items() if k in allowed}
    api, processor, worker = (values[k] for k in ('api', 'processor', 'worker'))
    require(api, ('SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SERVER_KEY',
                  'FILE_PROCESSOR_TOKEN', 'TRATO_WORKER_TOKEN', 'GOOGLE_GMAIL_CLIENT_ID',
                  'GOOGLE_GMAIL_CLIENT_SECRET', 'GMAIL_TOKEN_ENCRYPTION_KEY',
                  'PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_MERCHANT_ID'), 'api')
    require(processor, ('FILE_PROCESSOR_TOKEN', 'WEAVIATE_URL', 'WEAVIATE_API_KEY'), 'processor')
    require(worker, ('TRATO_WORKER_TOKEN', 'FILE_PROCESSOR_TOKEN', 'TRATO_GOOGLE_CREDENTIALS_FILE',
                     'TRATO_GOOGLE_CLOUD_PROJECT', 'TRATO_GOOGLE_CLOUD_LOCATION',
                     'TRATO_GEMINI_MODEL', 'TRATO_TEST_MODEL_IDS'), 'worker')
    if api['FILE_PROCESSOR_TOKEN'] != processor['FILE_PROCESSOR_TOKEN'] or api['FILE_PROCESSOR_TOKEN'] != worker['FILE_PROCESSOR_TOKEN']:
        raise ValueError('Service tokens do not match: FILE_PROCESSOR_TOKEN')
    if api['TRATO_WORKER_TOKEN'] != worker['TRATO_WORKER_TOKEN']:
        raise ValueError('Service tokens do not match: TRATO_WORKER_TOKEN')
    if api.get('PAYPAL_ENVIRONMENT') != 'sandbox':
        raise ValueError('Only explicit PayPal sandbox configuration is allowed')
    if worker.get('TRATO_MODEL_PROVIDER') != 'gemini' or worker.get('TRATO_GEMINI_BACKEND') != 'vertex':
        raise ValueError('Expected the explicitly selected Gemini Vertex configuration')
    credentials = Path(worker['TRATO_GOOGLE_CREDENTIALS_FILE'])
    if not credentials.is_absolute():
        credentials = root / 'repos' / names['worker'] / credentials
    if credentials.is_symlink() or json.loads(credentials.read_text()).get('type') != 'service_account':
        raise ValueError('Invalid Gemini credential file')
    # Explicit approved repository corpus; never fall back to a private local library.
    library = root / 'repos' / names['api'] / 'resources' / 'rehearsal-sources' / 'manifest.json'
    manifest = json.loads(library.read_text())
    if manifest.get('schema_version') != 1 or len(manifest.get('sources', [])) != 5:
        raise ValueError('The five-source training library is required')
    for source in manifest['sources']:
        filename = source['filename']
        if filename != source['file_id'] + '.json' or Path(filename).name != filename:
            raise ValueError('Invalid library basename')
        path = library.parent / filename
        if path.is_symlink() or hashlib.sha256(path.read_bytes()).hexdigest() != source['sha256']:
            raise ValueError('Invalid library checksum')
    return values, credentials


def write_inputs(destination, origin, values, credentials):
    parsed = urlsplit(origin)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment:
        raise ValueError('A canonical HTTPS origin without a trailing slash is required')
    if destination.exists():
        raise ValueError('Destination already exists; preserve it and choose a new preparation directory')
    destination.mkdir(mode=0o700, parents=True)
    os.chmod(destination, 0o700)
    values['api'].update(TRATO_REHEARSAL_SOURCE_MANIFEST='/app/resources/rehearsal-sources/manifest.json',
                         WEB_ORIGIN=origin,
                         GOOGLE_GMAIL_REDIRECT_URI=origin + '/gmail-callback.html',
                         PAYPAL_RETURN_URL=origin + '/paypal-sandbox-return.html',
                         PAYPAL_CANCEL_URL=origin + '/paypal-sandbox-return.html?result=cancel',
                         PAYPAL_TEST_RETURN_URL=origin + '/paypal-sandbox-return.html',
                         PAYPAL_TEST_CANCEL_URL=origin + '/paypal-sandbox-return.html?result=cancel')
    for role, env in values.items():
        # Raw Compose env files preserve literal $ in credentials, without interpolation.
        path = destination / (role + '.env')
        with path.open('x', encoding='utf-8') as handle:
            os.chmod(path, 0o600)
            handle.write(''.join(key + '=' + value + '\n' for key, value in sorted(env.items())))
    # Parent stays 0700. Read-only bind-mounted files must be readable by UID10001.
    secret = destination / 'google-cloud-worker.json'
    shutil.copyfile(credentials, secret)
    os.chmod(secret, 0o444)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--write', action='store_true')
    parser.add_argument('--origin')
    parser.add_argument('--destination', type=Path)
    args = parser.parse_args()
    try:
        values, credentials = load_inputs()
        print('Local service configuration and five-source checksums: OK (no values printed)')
        if args.write:
            if not args.origin or not args.destination:
                parser.error('--write requires --origin and --destination')
            target = args.destination.resolve()
            # Keep generated private inputs in ignored .local, never in public source.
            if not target.is_relative_to(ROOT / '.local'):
                raise ValueError('Preparation destination must be inside the ignored .local directory')
            write_inputs(target, args.origin, values, credentials)
            print('Private deployment bundle prepared. No remote changes performed.')
        else:
            print('Read-only check; no files copied and no resources created.')
    except (ValueError, KeyError, OSError) as error:
        # Never include credential payloads or private file content in errors.
        print('Deployment preparation blocked:', str(error) if isinstance(error, ValueError) else type(error).__name__)
        raise SystemExit(1) from None


if __name__ == '__main__':
    main()
