"""Real SQL races in an explicitly marked, disposable Trato PostgreSQL instance.

Uses committed synthetic fixtures for multiple connections. Never use on shared DBs.
Auth/Storage bootstrap is test-only; this does not test Supabase JWT verification.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import subprocess
from threading import Barrier


ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser()
parser.add_argument('--psql', required=True)
parser.add_argument('--socket', required=True)
parser.add_argument('--state-file', required=True)
parser.add_argument('--verify-state', action='store_true')
args = parser.parse_args()
if not Path(args.socket).resolve().is_relative_to('/tmp/trato-refunds-pg'):
    raise SystemExit('Only the disposable Trato test socket is allowed')


def sql(text, check=True):
    result = subprocess.run([args.psql, '-X', '-qAt', '-h', args.socket, '-d', 'trato_refunds_test',
                             '-v', 'ON_ERROR_STOP=1'], input=text, capture_output=True, text=True, timeout=20)
    if check and result.returncode:
        raise AssertionError(result.stderr)
    return result


if sql("select current_setting('trato.refund_test',true)").stdout.strip() != 'isolated':
    raise SystemExit('Test database marker is missing; refusing to create fixtures')


def literal(value):
    return "'" + value.replace("'", "''") + "'"


def owner_sql(fixture, body):
    return ('begin;set local role authenticated;set local "request.jwt.claim.sub"='
            + literal(fixture['owner']) + ';' + body + ';commit;')


def command(action, data, key):
    return ('select public.refund_command(' + ','.join(map(literal, [action, json.dumps(data), key])) + ')')


def fixture():
    path = ROOT / 'repos/trato-api/supabase/tests/fixtures/refund_fixture.sql'
    return json.loads(sql('\\ir ' + literal(str(path)) + '\nselect pg_temp.refund_fixture();').stdout)


def race(f, left, right):
    barrier = Barrier(2)
    def run(body):
        barrier.wait(timeout=5)
        return sql(owner_sql(f, body), check=False)
    with ThreadPoolExecutor(max_workers=2) as pool:
        a = pool.submit(run, left)
        b = pool.submit(run, right)
        return [a.result(), b.result()]


def exactly_one(results, error):
    assert sum(r.returncode == 0 for r in results) == 1, [r.stderr for r in results]
    assert any(error in r.stderr for r in results), [r.stderr for r in results]


def records():
    return json.loads(sql("select coalesce(jsonb_agg(jsonb_build_object('id',id,'hash',content_sha256,'terms',terms) order by id),'[]') from public.refund_snapshots").stdout)


state_file = Path(args.state_file)
if not state_file.resolve().is_relative_to('/tmp/trato-refunds-pg'):
    raise SystemExit('State file must stay in the disposable test directory')
if args.verify_state:
    assert records() == json.loads(state_file.read_text())
    print('PASS: snapshots and hashes persisted across database restart')
    raise SystemExit(0)

f = fixture()
results = race(f, command('create', f['request'], 'race-a'), command('create', f['request'], 'race-b'))
exactly_one(results, 'PROJECT_HAS_OPEN_REQUEST')
print('PASS: simultaneous refund requests share the project gate')

f = fixture()
reserve = ("select public.reserve_document(" + literal(f['project'])
           + ", 'Change request','email_request','request.pdf','application/pdf',10,repeat('e',64),'change-race')")
exactly_one(race(f, command('create', f['request'], 'refund-race'), reserve), 'PROJECT_HAS_OPEN_REQUEST')
print('PASS: refund versus email_request permits only one open request')

f = fixture()
result = json.loads(sql(owner_sql(f, command('create', f['request'], 'parent'))).stdout)
parent = result['settlement']['id']
edit = {'settlement_id':parent, 'expected_snapshot_id':None, 'terms':{
    'currency':'USD','conditions':'Full refund','adjustments':[],'proposed_refund_minor':30000}}
exactly_one(race(f, command('edit_draft',edit,'draft-a'), command('edit_draft',edit,'draft-b')),
            'REFUND_REVISION_CONFLICT')
print('PASS: simultaneous edits cannot create two current snapshots')

f = fixture()
results = race(f, command('create', f['request'], 'same-key'), command('create', f['request'], 'same-key'))
assert all(r.returncode == 0 for r in results), [r.stderr for r in results]
assert json.loads(results[0].stdout) == json.loads(results[1].stdout)
print('PASS: simultaneous identical retries return the same saved result')
state_file.write_text(json.dumps(records(), sort_keys=True))
print('Saved synthetic snapshot evidence for restart verification')
