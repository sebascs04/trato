"""Explicit, scoped operator recovery. Default is inspection, never a model call.

Run with repos/trato-worker/.venv/bin/python. Uses this checkout's API credentials;
never reads browser storage, changes document kinds or modifies original files.
"""
import argparse
import json
import os
from pathlib import Path
import runpy
import sys
from uuid import UUID, uuid4

ROOT = Path(__file__).resolve().parent.parent


def canonical(value):
    try:
        return str(UUID(value))
    except ValueError:
        raise argparse.ArgumentTypeError('A canonical UUID is required.') from None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project', required=True, type=canonical)
    parser.add_argument('--owner', required=True, type=canonical)
    parser.add_argument('--document', action='append', type=canonical)
    parser.add_argument('--apply', action='store_true', help='Enqueue the existing processing workflow explicitly.')
    parser.add_argument('--retry-failed', action='store_true', help='Create one fresh attempt for a confirmed failed processing job.')
    args = parser.parse_args()
    if args.retry_failed and not args.apply:
        parser.error('--retry-failed requires --apply')
    dev = runpy.run_path(str(ROOT / 'scripts/dev-polyrepo.py'))
    env = dev['environment'](ROOT / 'repos/trato-api')
    os.environ.update(env)
    sys.path[:0] = [str(ROOT / 'repos/trato-api'), str(ROOT / 'repos/trato-file-processor')]
    # Reuse installed Trato environments, without installing or changing dependencies.
    sys.path.extend(str(p) for p in (ROOT / 'repos/trato-file-processor/.venv/lib').glob('python*/site-packages'))
    from trato_api.app import Settings
    from trato_api.ai_jobs import AIJobs, PREFIX
    from trato_api.errors import ApiError
    from trato_api.file_processing import enqueue_processing
    from trato_api.model_preferences import ModelPreferences
    from trato_api.thread_store import ThreadStore
    from trato_api.vector_routes import VectorGateway
    settings = Settings.from_env()
    repo = ThreadStore(settings).repo
    project = repo.project(args.project)
    if project['owner_id'] != args.owner:
        raise ApiError('PROJECT_NOT_FOUND', 404)
    gateway = VectorGateway(settings)
    if args.document:
        if len(set(args.document)) != len(args.document):
            raise ApiError('DOCUMENT_NOT_FOUND', 404)
    _, files = gateway.snapshot(repo, args.owner, args.project, file_ids=args.document)
    jobs = AIJobs()
    model = ModelPreferences().selected(args.owner)
    # Read only this operator's selected project. Retain running and review outcomes.
    previous = {}
    count = 0
    for key in jobs.connection().scan_iter(PREFIX + '*'):
        count += 1
        if count > 10000:
            raise ApiError('RECOVERY_INVENTORY_LIMIT', 413)
        row = jobs.connection().hgetall(key)
        data = json.loads(row.get('input', '{}'))
        if (data.get('owner_id') == args.owner and data.get('project_id') == args.project
                and data.get('workflow') == 'process_file'):
            previous.setdefault(data['file_id'], []).append((row, data))
    plan = []
    for file in files:
        row = {'file_id': file['id'], 'status': file['status']}
        summary = gateway.summary(repo, file)
        receipt = gateway.receipt(args.owner, file['id'])
        if file['status'] == 'source_pending':
            action = 'extraction_required'
        elif (file['status'] == 'ready' and summary and receipt
              and receipt.get('summary_fingerprint') == summary['summary_fingerprint']):
            action = 'ready'
        else:
            history = [r for r, d in previous.get(file['id'], []) if d.get('generation') == file['generation']]
            if any(r['status'] in ('queued', 'running') for r in history):
                action = 'in_progress'
            elif any(r['status'] == 'completed' and json.loads(r.get('result', '{}')).get('status')
                     in ('rejected', 'needs_clarification') for r in history):
                action = 'review_required'
            elif any(r['status'] == 'failed' for r in history):
                action = 'retry_failed' if args.retry_failed else 'failed_requires_explicit_retry'
            elif any(r['status'] == 'completed' and json.loads(r.get('result', '{}')).get('status')
                     == 'processed' for r in history):
                action = 'reindex'
            else:
                action = 'process'
        row['action'] = action
        plan.append(row)
    # No partial enqueue if source reading still needs recovery through the normal
    # authenticated POST /api/v1/documents/{id}/retry endpoint.
    if args.apply and any(row['action'] == 'extraction_required' for row in plan):
        print(json.dumps({'mode': 'blocked', 'error': 'EXTRACTION_REQUIRED', 'files': plan}))
        return 1
    for row in plan:
        if args.apply and row['action'] in ('process', 'retry_failed', 'reindex'):
            result = enqueue_processing(repo, jobs, args.owner, args.project, row['file_id'], model,
                                        job_id=str(uuid4()) if row['action'] != 'process' else None)
            row.update(job_id=result['id'], job_status=result['status'])
        print(json.dumps({'mode': 'enqueue' if args.apply else 'inspect', **row}), flush=True)
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as error:
        # Never expose provider messages, original text, keys or tokens.
        print(json.dumps({'error': getattr(error, 'code', type(error).__name__)}), file=sys.stderr)
        raise SystemExit(1)
