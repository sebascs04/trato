"""Tanda 5 regression: isolated PostgreSQL and explicit PayPal double."""
from refund_finance_test_support import *

f,repo,store,provider,flow,auth=authorized()
view=flow.execute(repo,f['owner'],f['parent'],auth,'execute')
assert view['confirmed_minor']==25000 and view['reserved_minor']==0 and view['settlement']['status']=='completed'
assert len(provider.posts)==2 and len({post[2] for post in provider.posts})==2
flow.execute(repo,f['owner'],f['parent'],auth,'execute');assert len(provider.posts)==2
print('PASS: global completion, exact amounts and idempotent execution replay')

f,repo,store,provider,flow,auth=authorized('pending')
view=flow.execute(repo,f['owner'],f['parent'],auth,'execute');assert view['settlement']['status']=='refund_pending'
assert view['confirmed_minor']>0 and view['confirmed_minor']+view['reserved_minor']==25000
flow.execute(repo,f['owner'],f['parent'],auth,'another-execute');assert len(provider.posts)==2
pending=next(o for o in view['operations'] if o['status']=='pending');attempt=next(a for a in view['attempts'] if a['operation_id']==pending['id'])
provider.records[attempt['provider_refund_id']]['status']='COMPLETED'
view=flow.refresh(repo,f['owner'],f['parent'],pending['id']);assert view['settlement']['status']=='completed' and view['confirmed_minor']==25000
assert len(provider.posts)==2
print('PASS: partial completion, pending reservation, canonical refresh without another POST')

for mode in ['timeout','malformed','wrong_capture']:
    f,repo,store,provider,flow,auth=authorized(mode)
    view=flow.execute(repo,f['owner'],f['parent'],auth,'execute')
    assert view['operations'][0]['status']=='uncertain' and view['reserved_minor']==25000 and len(provider.posts)==1
    flow.execute(repo,f['owner'],f['parent'],auth,'execute-again');assert len(provider.posts)==1
    print('PASS:',mode,'stops batch and keeps reservation without retry')

f,repo,store,provider,flow,auth=authorized('rejected')
view=flow.execute(repo,f['owner'],f['parent'],auth,'execute');assert view['confirmed_minor']>0 and view['reserved_minor']==0
assert view['operations'][1]['status']=='failed' and view['settlement']['status']=='refund_pending'
assert sql("select evidence->>'http_status' from public.refund_financial_observations where operation_id="+literal(view['operations'][1]['id'])+"::uuid and status='failed' order by created_at desc limit 1")=='403'
print('PASS: definitive rejection releases only its reservation and preserves the first success and safe HTTP evidence')

f,repo,store,provider,flow,auth=authorized('crash')
try:flow.execute(repo,f['owner'],f['parent'],auth,'execute')
except RuntimeError:pass
else:raise AssertionError('Crash was swallowed')
view=repo.view();assert view['operations'][0]['status']=='dispatching' and view['runs'][0]['status']=='running'
flow.execute(repo,f['owner'],f['parent'],auth,'execute');assert len(provider.posts)==1
print('PASS: process crash preserves dispatch identity and does not retry')

f,repo,store,provider,flow,auth=authorized(multi=False);store.fail_after_result=True
try:flow.execute(repo,f['owner'],f['parent'],auth,'execute')
except ApiError:pass
else:raise AssertionError('Lost DB response was hidden')
view=repo.view();assert view['confirmed_minor']==30000 and view['settlement']['status']=='completed'
flow.execute(repo,f['owner'],f['parent'],auth,'execute');assert len(provider.posts)==1
print('PASS: lost result response cannot degrade confirmed money or repeat a refund')

f,repo,store,provider,flow,body=prepared();barrier=Barrier(2)
def authorize_race(key):
    barrier.wait(timeout=5)
    try:return repo.authorize(body,key)
    except ApiError as e:return e.code
with ThreadPoolExecutor(2) as pool:
    futures=[pool.submit(authorize_race,key) for key in ['race-a','race-b']];results=[f.result() for f in futures]
assert sum(isinstance(r,dict) for r in results)==1 and 'REFUND_ALREADY_AUTHORIZED' in results
view=repo.view();assert len(view['authorizations'])==1 and view['reserved_minor']==25000
print('PASS: concurrent different authorization keys cannot reserve twice')

f,repo,store,provider,flow,auth=authorized();barrier=Barrier(2)
def execute_race():
    barrier.wait(timeout=5);return flow.execute(repo,f['owner'],f['parent'],auth,'same-execution-key')
with ThreadPoolExecutor(2) as pool:
    futures=[pool.submit(execute_race) for _ in range(2)];[f.result() for f in futures]
assert len(provider.posts)==2 and repo.view()['confirmed_minor']==25000
print('PASS: concurrent executions send each capture exactly once')

for mode in ['canonical_failed','canonical_cancelled']:
    f,repo,store,provider,flow,auth=authorized(mode)
    view=flow.execute(repo,f['owner'],f['parent'],auth,'execute')
    assert view['operations'][0]['status']==('failed' if mode=='canonical_failed' else 'cancelled')
    assert view['operations'][1]['status']=='reserved' and len(provider.posts)==1 and view['confirmed_minor']==0
    assert view['reserved_minor']==view['operations'][1]['amount_minor']
    print('PASS:',mode,'does not complete or dispatch the next capture')

f,repo,store,provider,flow,auth=authorized()
provider.merchant_id='CHANGED-MERCHANT'
try:flow.execute(repo,f['owner'],f['parent'],auth,'execute')
except ApiError:pass
else:raise AssertionError('Changed merchant was accepted')
assert not provider.posts and repo.view()['reserved_minor']==25000
print('PASS: changed provider context blocks dispatch without changing the accepted agreement')

f,repo,store,provider,flow,body=prepared()
# Test-only temporal fixture mutation, never a production recovery command.
sql("alter table public.refund_financial_checks disable trigger immutable_financial_record;update public.refund_financial_checks set created_at=now()-interval '10 minutes',expires_at=now()-interval '9 minutes' where id="+literal(body['check_id'])+"::uuid;alter table public.refund_financial_checks enable trigger immutable_financial_record;")
try:repo.authorize(body,'expired-check')
except ApiError as e:assert e.code=='REFUND_FINANCIAL_CHECK_EXPIRED'
else:raise AssertionError('Expired check authorized')
assert repo.view()['reserved_minor']==0
print('PASS: expired checks cannot authorize or reserve money')

f,repo,store,provider,flow,auth=authorized(zero=True)
view=flow.execute(repo,f['owner'],f['parent'],auth,'execute')
assert view['confirmed_minor']==20000 and len(provider.posts)==1 and len(view['operations'])==1
print('PASS: zero allocation stays documented and never creates a refund operation')

f,repo,store,provider,flow,body=prepared();other=fixture(False)
foreign=Repo(other)
try:foreign.settlement(f['parent'])
except ApiError as e:assert e.code=='REFUND_NOT_FOUND'
else:raise AssertionError('RLS exposed another owner settlement')
try:sql('select public.refund_financial('+literal(f['parent'])+'::uuid)',other['owner'])
except ApiError as e:assert e.code=='REFUND_NOT_FOUND'
else:raise AssertionError('Financial RPC exposed another owner')
for table in ['refund_financial_checks','refund_financial_authorizations','refund_financial_operations','refund_financial_attempts']:
    assert sql('select count(*) from public.'+table+' where settlement_id='+literal(f['parent'])+'::uuid',other['owner'])=='0'
try:flow.check(foreign,other['owner'],f['parent'],f['snapshot'])
except ApiError:pass
else:raise AssertionError('Foreign owner can inspect provider')
assert not provider.posts
print('PASS: foreign owner cannot read financial evidence or reach financial execution')

f,repo,store,provider,flow,auth=authorized(multi=False)
view=flow.execute(repo,f['owner'],f['parent'],auth,'execute')
lookup=json.loads(sql("select public.refund_command_result("+literal(f['project'])+"::uuid,'authorize')",f['owner']))
assert lookup['result']['confirmed_minor']==30000 and lookup['result']['reserved_minor']==0
print('PASS: command recovery returns current confirmed results rather than stale reservations')

if state_path:state_path.write_text(json.dumps(persisted_state(),sort_keys=True))
