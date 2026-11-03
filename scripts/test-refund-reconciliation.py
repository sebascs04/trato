"""Tanda 6: real isolated SQL, explicit in-memory PayPal (no network or secrets)."""
from refund_finance_test_support import *
from trato_api.refunds.webhook import RefundWebhook

class RecoveryProvider(Provider):
    client_id='EXPLICIT-TEST-APP'
    webhook_id='EXPLICIT-TEST-LISTENER'
    signature=True
    def __init__(self,context,mode='complete'):
        super().__init__(context,mode);self.identities={};self.fail_get=False
    def verify_webhook(self,headers,event):return self.signature
    def belongs(self,r,p):return r['links'][0]['href'].endswith('/'+p['capture_id'])
    def get_capture(self,id):
        c=super().get_capture(id);p=next(p for p in self.payments if p['capture_id']==id)
        total=sum(int(r['amount']['value'].replace('.','')) for r in self.records.values() if self.belongs(r,p) and r['status']=='COMPLETED')
        if total:c['status']='REFUNDED' if total==p['amount_minor'] else 'PARTIALLY_REFUNDED'
        return c
    def get_order(self,id):
        o=super().get_order(id);p=next(p for p in self.payments if self.order_id(p)==id)
        o['purchase_units'][0]['payments']['refunds']=[{'id':r['id']} for r in self.records.values() if self.belongs(r,p)]
        return o
    def get_refund(self,id):
        if self.fail_get:raise PayPalError('PAYPAL_UNAVAILABLE')
        r=super().get_refund(id);p=next(p for p in self.payments if self.belongs(r,p))
        total=sum(int(v['amount']['value'].replace('.','')) for v in self.records.values() if self.belongs(v,p) and v['status']=='COMPLETED')
        r['seller_payable_breakdown']={'total_refunded_amount':self.money(max(total,int(r['amount']['value'].replace('.',''))))}
        return r
    def refund_capture(self,capture,payload,request_id):
        if request_id in self.identities:
            self.posts.append((capture,deepcopy(payload),request_id));return {'id':self.identities[request_id]}
        lost=self.mode=='lost';mode=self.mode
        if lost:self.mode='complete'
        try:r=super().refund_capture(capture,payload,request_id)
        finally:self.mode=mode
        self.identities[request_id]=r['id']
        if lost:raise PayPalError('PAYPAL_UNAVAILABLE',uncertain=True)
        return r
    def external(self,p,amount,*,status='COMPLETED',custom=None):
        rid='EXT-'+uuid4().hex
        self.records[rid]={'id':rid,'status':status,'amount':self.money(amount),'links':[{'rel':'up','href':'https://api-m.sandbox.paypal.com/v2/payments/captures/'+p['capture_id']}]}
        if custom is not None:self.records[rid]['custom_id']=custom
        return rid

def setup(mode='complete',multi=False):
    f,repo,store,old,flow,auth=authorized(mode,multi=multi)
    context=flow.context(repo,f['owner'],f['parent']);provider=RecoveryProvider(context,mode);flow.paypal=provider
    return f,repo,store,provider,flow,auth

def consent(view,op=None,**extra):
    op=op or view['operations'][0];attempt=max((a for a in view['attempts'] if a['operation_id']==op['id']),key=lambda a:a['attempt_no'])
    return {'expected_snapshot_id':view['settlement']['current_snapshot_id'],'attempt_id':attempt['id'],'expected_revision':attempt['revision'],'confirmed':True,'notes':'Reviewed recovery explicitly',**extra}

def expect(code,call):
    try:call()
    except ApiError as e:assert e.code==code,(e.code,code)
    else:raise AssertionError('Expected '+code)

def event(provider,rid,eid=None,kind='PAYMENT.CAPTURE.REFUNDED'):
    return json.dumps({'id':eid or 'EV-'+uuid4().hex,'event_type':kind,'resource_type':'refund','resource_version':'2.0','resource':{'id':rid}}).encode()

# Lost response: a canonical order + exact saved custom_id recovers the missing ID.
f,repo,store,p,flow,auth=setup('lost');v=flow.execute(repo,f['owner'],f['parent'],auth,'execute');op=v['operations'][0]
assert v['attempts'][0]['provider_refund_id'] is None
v=flow.reconcile(repo,f['owner'],f['parent'],op['id']);assert v['confirmed_minor']==30000 and v['settlement']['status']=='completed' and len(p.posts)==1
assert len(v['receipts'])==len(v['applications'])==1
flow.refresh(repo,f['owner'],f['parent'],op['id']);flow.reconcile(repo,f['owner'],f['parent'],op['id'])
assert repo.view()['confirmed_minor']==30000
print('PASS: lost ID recovered by exact reference; refresh/reconcile count one receipt once')

for ambiguous in [False,True]:
    f,repo,store,p,flow,auth=setup('timeout');v=flow.execute(repo,f['owner'],f['parent'],auth,'execute');op=v['operations'][0];a=v['attempts'][0]
    pay=flow.payment(flow.context(repo,f['owner'],f['parent']),op['payment_id'])
    p.external(pay,30000,custom=a['payload']['custom_id'] if ambiguous else None)
    if ambiguous:p.external(pay,30000,custom=a['payload']['custom_id'])
    v=flow.reconcile(repo,f['owner'],f['parent'],op['id']);assert v['confirmed_minor']==0 and v['reserved_minor']==30000 and v['settlement']['status']=='refund_pending'
    assert v['reconciliation']['attribution']==('ambiguous' if ambiguous else 'unresolved')
    if ambiguous:assert v['incidents'] and sum(r['amount_minor'] for r in v['receipts'])==60000
print('PASS: missing reference and multiple candidates preserve uncertainty; actual excess is retained as incident')

# No effect from the first POST is unknown. Replay needs consent and keeps exact identity.
f,repo,store,p,flow,auth=setup('timeout');v=flow.execute(repo,f['owner'],f['parent'],auth,'execute');op=v['operations'][0];data=consent(v)
expect('REFUND_RECOVERY_CONFIRMATION_REQUIRED',lambda:flow.replay(repo,f['owner'],f['parent'],op['id'],data|{'confirmed':False},'replay-denied'))
p.mode='complete';v=flow.replay(repo,f['owner'],f['parent'],op['id'],data,'explicit-replay')
assert v['confirmed_minor']==30000 and p.posts[0]==p.posts[1]
flow.replay(repo,f['owner'],f['parent'],op['id'],data,'explicit-replay');assert len(p.posts)==2
expect('IDEMPOTENCY_KEY_CONFLICT',lambda:flow.replay(repo,f['owner'],f['parent'],op['id'],data|{'notes':'different'},'explicit-replay'))
print('PASS: explicit replay keeps payload/request ID, false consent and changed/same-key requests cannot send money')

f,repo,store,p,flow,auth=setup('timeout');v=flow.execute(repo,f['owner'],f['parent'],auth,'execute');op=v['operations'][0];data=consent(v)
sql("alter table public.refund_financial_attempts disable trigger refund_attempt_identity;update public.refund_financial_attempts set dispatched_at=now()-interval '44 days' where id="+literal(data['attempt_id'])+"::uuid;alter table public.refund_financial_attempts enable trigger refund_attempt_identity;")
expect('REFUND_REPLAY_NOT_ALLOWED',lambda:flow.replay(repo,f['owner'],f['parent'],op['id'],data,'expired-replay'));assert len(p.posts)==1
assert repo.view()['reserved_minor']==30000
print('PASS: expired uncertain attempt stays reserved, cannot get a new request identity')

# A failed canonical attempt permits fresh evidence + new explicit financial consent.
f,repo,store,p,flow,auth=setup('canonical_failed');v=flow.execute(repo,f['owner'],f['parent'],auth,'execute');op=v['operations'][0];old=v['attempts'][0]
check=flow.recovery_check(repo,f['owner'],f['parent'],op['id'],f['snapshot'])['check'];data=consent(v,check_id=check['id'],digest=check['digest'])
v=flow.retry_authorize(repo,f['owner'],f['parent'],op['id'],data,'new-consent');assert len(v['attempts'])==2 and v['reserved_minor']==30000
assert v['attempts'][0]['request_id']!=v['attempts'][1]['request_id'] and v['attempts'][0]['payload']['custom_id']!=v['attempts'][1]['payload']['custom_id']
p.mode='complete';v=flow.execute(repo,f['owner'],f['parent'],auth,'execute-new');assert v['confirmed_minor']==30000 and len(p.posts)==2
# A late result for the old terminal attempt cannot degrade the new result.
flow.backend().command(f['owner'],'result',{'settlement_id':f['parent'],'operation_id':op['id'],'attempt_id':old['id'],'status':'uncertain','error_code':'LATE_ERROR'})
assert repo.view()['confirmed_minor']==30000
print('PASS: terminal failure requires fresh digest/consent, new immutable attempt; old response cannot degrade new success')

# External money is real, but no contractual application is inferred.
for amount in [10000,30000]:
    f,repo,store,p,flow,auth=setup();v=repo.view();op=v['operations'][0];pay=flow.payment(flow.context(repo,f['owner'],f['parent']),op['payment_id']);p.external(pay,amount)
    v=flow.reconcile(repo,f['owner'],f['parent'],op['id']);assert v['confirmed_minor']==0
    receipt=v['receipts'][0];data=consent(v,receipt_id=receipt['id']);v=flow.external_apply(repo,f['owner'],f['parent'],op['id'],data,'apply-external')
    assert v['confirmed_minor']==amount and len(p.posts)==0
    flow.external_apply(repo,f['owner'],f['parent'],op['id'],data,'apply-external')
    assert len(repo.view()['applications'])==1
    if amount<30000:
        # TEST ONLY: emulate clock rollback. Logical attempt order must survive it.
        sql("alter table public.refund_financial_attempts disable trigger refund_attempt_identity;update public.refund_financial_attempts set created_at=now()+interval '1 hour' where operation_id="+literal(op['id'])+"::uuid;alter table public.refund_financial_attempts enable trigger refund_attempt_identity;")
        check=flow.recovery_check(repo,f['owner'],f['parent'],op['id'],f['snapshot'])['check'];v=repo.view();data=consent(v,check_id=check['id'],digest=check['digest'])
        v=flow.retry_authorize(repo,f['owner'],f['parent'],op['id'],data,'remaining-consent')
        assert v['attempts'][-1]['amount_minor']==20000 and v['operations'][0]['amount_minor']==30000
        v=flow.execute(repo,f['owner'],f['parent'],auth,'remaining-execute')
        assert v['confirmed_minor']==30000 and p.posts[0][1]['amount']['value']=='200.00'
    assert repo.view()['settlement']['status']=='completed'
print('PASS: external total/partial application is explicit and idempotent; new attempt covers only the exact remaining allocation')

# Webhook can arrive before local bind. Signature first, durable inbox, no POST.
f,repo,store,p,flow,auth=setup('lost');v=flow.execute(repo,f['owner'],f['parent'],auth,'execute');rid=next(iter(p.records));raw=event(p,rid);receiver=RefundWebhook(flow)
p.signature=False
expect('INVALID_PAYPAL_SIGNATURE',lambda:receiver.receive(raw,{}));assert not sql("select id from private.refund_webhook_inbox where event_id="+literal(json.loads(raw)['id']))
p.signature=True;receiver.receive(raw,{});assert repo.view()['confirmed_minor']==30000 and len(p.posts)==1
assert receiver.receive(raw,{})['duplicate']
expect('REFUND_WEBHOOK_ID_CONFLICT',lambda:receiver.receive(raw+b' ',{}));assert repo.view()['confirmed_minor']==30000
print('PASS: verified webhook before bind, invalid signature, duplicate and content conflict; webhook never sends refunds')

f,repo,store,p,flow,auth=setup('lost');v=flow.execute(repo,f['owner'],f['parent'],auth,'execute');rid=next(iter(p.records));raw=event(p,rid);receiver=RefundWebhook(flow);p.fail_get=True
expect('REFUND_WEBHOOK_PROCESSING_FAILED',lambda:receiver.receive(raw,{}));assert sql("select status from private.refund_webhook_inbox where event_id="+literal(json.loads(raw)['id']))=='retryable'
p.fail_get=False;receiver.receive(raw,{});assert repo.view()['confirmed_minor']==30000
# Event name says pending but canonical resource is already completed.
receiver.receive(event(p,rid,kind='PAYMENT.REFUND.PENDING'),{});assert repo.view()['confirmed_minor']==30000 and len(repo.view()['receipts'])==1
print('PASS: provider failure is retryable; stale event cannot replace canonical completion')

# Reconciliation fences a crashed batch before a new capture can be claimed.
f,repo,store,p,flow,auth=setup('crash',multi=True)
try:flow.execute(repo,f['owner'],f['parent'],auth,'execute')
except RuntimeError:pass
v=repo.view();run=v['runs'][0];first,second=v['operations'];flow.reconcile(repo,f['owner'],f['parent'],first['id'])
ctx=flow.context(repo,f['owner'],f['parent']);e=flow.observation(ctx,second['payment_id'],p)
expect('REFUND_EXECUTION_IN_PROGRESS',lambda:store.command(f['owner'],'dispatch_claim',{'settlement_id':f['parent'],'operation_id':second['id'],'run_id':run['id'],'evidence':e}))
assert len(p.posts)==1 and repo.view()['reserved_minor']==25000
print('PASS: interrupted handler is fenced; read-only recovery never dispatches the next capture')

# Independent readonly handlers observing the same canonical refund cannot double count.
f,repo,store,p,flow,auth=setup('lost');v=flow.execute(repo,f['owner'],f['parent'],auth,'execute');rid=next(iter(p.records));op=v['operations'][0];barrier=Barrier(2)
def race(webhook):
    barrier.wait(timeout=5)
    if webhook:return RefundWebhook(flow).receive(event(p,rid),{})
    return flow.reconcile(repo,f['owner'],f['parent'],op['id'])
with ThreadPoolExecutor(2) as pool:list(pool.map(race,[True,False]))
v=repo.view();assert v['confirmed_minor']==30000 and len(v['receipts'])==len(v['applications'])==1 and len(p.posts)==1
print('PASS: webhook/reconcile race records and applies one movement once')

# Two explicit replay requests cannot overlap; a crash is not a reason to POST again.
from threading import Event
f,repo,store,p,flow,auth=setup('timeout');v=flow.execute(repo,f['owner'],f['parent'],auth,'execute');op=v['operations'][0];body=consent(v)
entered,release=Event(),Event();original=p.refund_capture;p.mode='complete'
def pause(*args):
    entered.set();assert release.wait(10);return original(*args)
p.refund_capture=pause
with ThreadPoolExecutor(2) as pool:
    future=pool.submit(flow.replay,repo,f['owner'],f['parent'],op['id'],body,'first-replay')
    assert entered.wait(10)
    expect('REFUND_REPLAY_NOT_ALLOWED',lambda:flow.replay(repo,f['owner'],f['parent'],op['id'],body|{'expected_revision':body['expected_revision']+1},'second-replay'))
    release.set();v=future.result(timeout=10)
assert v['confirmed_minor']==30000 and len(p.posts)==2
print('PASS: concurrent explicit replays are serialized before any money POST')

# A pending external receipt does not cover the obligation or authorize another POST.
f,repo,store,p,flow,auth=setup();v=repo.view();op=v['operations'][0];pay=flow.payment(flow.context(repo,f['owner'],f['parent']),op['payment_id'])
p.external(pay,10000,status='PENDING');v=flow.reconcile(repo,f['owner'],f['parent'],op['id']);body=consent(v,receipt_id=v['receipts'][0]['id'])
expect('REFUND_RECEIPT_NOT_APPLICABLE',lambda:flow.external_apply(repo,f['owner'],f['parent'],op['id'],body,'apply-pending'))
assert len(p.posts)==0 and repo.view()['confirmed_minor']==0
print('PASS: pending external money cannot be applied or treated as completed')

# The initial success is retained while only the definitively failed addendum gets a new attempt.
f,repo,store,p,flow,auth=setup('rejected',multi=True);v=flow.execute(repo,f['owner'],f['parent'],auth,'execute');first,failed=v['operations'];assert first['status']=='completed' and failed['status']=='failed'
check=flow.recovery_check(repo,f['owner'],f['parent'],failed['id'],f['snapshot'])['check']
flow.retry_authorize(repo,f['owner'],f['parent'],failed['id'],consent(v,failed,check_id=check['id'],digest=check['digest']),'retry-addendum')
p.mode='complete';v=flow.execute(repo,f['owner'],f['parent'],auth,'execute-addendum');assert v['confirmed_minor']==25000 and v['settlement']['status']=='completed'
assert len(p.posts)==3 and p.posts[2][0]==p.posts[1][0] and p.posts[0][0]!=p.posts[2][0]
print('PASS: multipayment recovery retries only the failed addendum, preserving the first confirmed capture')

# DB failure after receipt persistence remains visible; replaying the webhook cannot duplicate money.
f,repo,store,p,flow,auth=setup('lost');v=flow.execute(repo,f['owner'],f['parent'],auth,'execute');rid=next(iter(p.records));raw=event(p,rid);receiver=RefundWebhook(flow)
original=store.webhook;fail_once=[True]
def fail_finish(action,data):
    if action=='finish' and data['status']=='processed' and fail_once[0]:fail_once[0]=False;raise ApiError('PERSISTENCE_UNAVAILABLE',503)
    return original(action,data)
store.webhook=fail_finish
expect('REFUND_WEBHOOK_PROCESSING_FAILED',lambda:receiver.receive(raw,{}));assert repo.view()['confirmed_minor']==30000
receiver.receive(raw,{});assert len(repo.view()['receipts'])==len(repo.view()['applications'])==1
print('PASS: webhook DB acknowledgment failure stays retryable and preserves exactly one confirmed movement')

# A recovery key resolves through the same command lookup to the current view.
f,repo,store,p,flow,auth=setup('timeout');v=flow.execute(repo,f['owner'],f['parent'],auth,'execute');op=v['operations'][0];p.mode='complete'
flow.replay(repo,f['owner'],f['parent'],op['id'],consent(v),'lookup-replay')
lookup=json.loads(sql('select public.refund_command_result('+literal(f['project'])+'::uuid,\'lookup-replay\')',f['owner']))
assert lookup['state']=='confirmed' and lookup['result']['confirmed_minor']==30000
print('PASS: existing command recovery returns current money and attempt history after explicit recovery')

# A whole receipt cannot be silently clipped to the agreed remaining allocation.
f,repo,store,p,flow,auth=setup('canonical_failed');v=flow.execute(repo,f['owner'],f['parent'],auth,'execute');op=v['operations'][0]
pay=flow.payment(flow.context(repo,f['owner'],f['parent']),op['payment_id']);p.external(pay,40000)
v=flow.reconcile(repo,f['owner'],f['parent'],op['id'])
assert any(r['amount_minor']==40000 for r in v['receipts']) and v['incidents'] and v['confirmed_minor']==0
assert v['settlement']['status']=='refund_pending'
print('PASS: excessive external evidence is retained, cannot complete the agreement or authorize another attempt')

# Exceeds this agreement but stays below capture gross: persist the incident and do not clip/apply.
f,repo,store,p,flow,auth=setup(multi=True);v=repo.view()
ctx=flow.context(repo,f['owner'],f['parent']);op=next(o for o in v['operations'] if o['amount_minor']<flow.payment(ctx,o['payment_id'])['amount_minor'])
pay=flow.payment(ctx,op['payment_id']);p.external(pay,op['amount_minor']+100)
v=flow.reconcile(repo,f['owner'],f['parent'],op['id']);receipt=next(r for r in v['receipts'] if r['payment_id']==op['payment_id'])
v=flow.external_apply(repo,f['owner'],f['parent'],op['id'],consent(v,op,receipt_id=receipt['id']),'excess-agreement')
assert v['application_recorded'] is False and v['confirmed_minor']==0 and any(x['code']=='REFUND_RECEIPT_EXCEEDS_ALLOCATION' for x in v['incidents'])
print('PASS: an external receipt exceeding the agreed allocation is retained whole, opens review, and is never clipped/applied')

if state_path:state_path.write_text(json.dumps(persisted_state(),sort_keys=True))
