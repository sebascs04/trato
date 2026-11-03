begin;
create function private.refund_recompute(p_parent uuid) returns void language plpgsql security definer set search_path='' as $$
declare r public.refund_settlements;s public.refund_snapshots;o public.refund_financial_operations;t public.refund_financial_attempts;paid bigint;total bigint:=0;begin
 select * into r from public.refund_settlements where id=p_parent;
 select * into s from public.refund_snapshots where id=r.current_snapshot_id;
 for o in select * from public.refund_financial_operations where settlement_id=r.id order by sequence_no for update loop
  paid:=private.refund_applied(o.id);total:=total+paid;
  select * into t from public.refund_financial_attempts where operation_id=o.id order by attempt_no desc limit 1;
  if paid>o.amount_minor then
   insert into public.refund_financial_incidents(payment_id,project_id,owner_id,code,reference) values(o.payment_id,o.project_id,o.owner_id,'REFUND_ALLOCATION_EXCEEDED',o.id::text) on conflict do nothing;
  end if;
  update public.refund_financial_operations set status=case when paid=o.amount_minor then 'completed' else t.status end,updated_at=now() where id=o.id;
 end loop;
 if total=(s.breakdown->>'refund_minor')::bigint and not exists(select 1 from public.refund_financial_operations where settlement_id=r.id and status<>'completed')
 and not exists(select 1 from public.refund_financial_incidents i join public.refund_settlement_payments m on m.payment_id=i.payment_id where m.settlement_id=r.id)
 and (r.scope<>'project_closure' or not exists(select id from public.project_received_payments where project_id=r.project_id and owner_id=r.owner_id except select payment_id from public.refund_settlement_payments where settlement_id=r.id)) then
  update public.refund_settlements set status='completed',confirmed_refund_minor=total,closed_at=coalesce(closed_at,now()),updated_at=now() where id=r.id;
  if r.scope='project_closure' then update public.projects set status='closed' where id=r.project_id;end if;
 end if;
end $$;
-- Only service-role callers can supply provider evidence. This is not a user RPC.
create function private.refund_receipt_record(p_owner uuid,p_payment uuid,e jsonb,p_attempt uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
<<receipt>>
declare p public.project_received_payments;x public.refund_provider_receipts;t public.refund_financial_attempts;o public.refund_financial_operations;rid text:=e->>'refund_id';st text:=e->>'status';n bigint;linked boolean:=false;begin
 select * into p from public.project_received_payments where id=p_payment and owner_id=p_owner;
 if not found then raise sqlstate 'PT404' using message='REFUND_PAYMENT_NOT_FOUND';end if;
 perform private.ensure_active_project(p.project_id,p_owner);
 perform 1 from public.projects where id=p.project_id for update;
 perform 1 from public.project_received_payments where project_id=p.project_id order by id for update;
 if e->'canonical' is distinct from 'true'::jsonb or rid is null or rid !~ '^[A-Za-z0-9_-]{1,64}$' or st is null or st not in('completed','pending','failed','cancelled')
 or e->>'capture_id' is distinct from p.capture_id or e->>'currency' is distinct from p.currency then raise sqlstate 'PT409' using message='REFUND_RESULT_MISMATCH';end if;
 n:=private.refund_money(e->'amount_minor');if n<=0 then raise sqlstate 'PT422' using message='INVALID_REFUND_INPUT';end if;
 insert into public.refund_provider_receipts(merchant_id,refund_id,payment_id,project_id,owner_id,capture_id,currency,amount_minor,status,evidence,confirmed_at)
 values(p.merchant_id,rid,p.id,p.project_id,p_owner,p.capture_id,p.currency,n,st,e,case when st='completed' then now() end) on conflict do nothing;
 select * into x from public.refund_provider_receipts where environment='sandbox' and merchant_id=p.merchant_id and refund_id=rid for update;
 if x.payment_id<>p.id or x.amount_minor<>n or x.currency<>p.currency or x.capture_id<>p.capture_id then
  insert into public.refund_financial_incidents(payment_id,project_id,owner_id,code,reference) values(p.id,p.project_id,p_owner,'REFUND_RECEIPT_IDENTITY_CONFLICT',rid) on conflict do nothing;
  return jsonb_build_object('recorded',false,'incident',true);
 end if;
 if x.status<>st and x.status in('completed','failed','cancelled') then
  -- A stale pending notification is harmless. Conflicting terminal evidence needs review.
  if st<>'pending' or x.status<>'completed' then insert into public.refund_financial_incidents(payment_id,project_id,owner_id,code,reference) values(p.id,p.project_id,p_owner,'REFUND_RECEIPT_STATUS_CONFLICT',rid) on conflict do nothing;end if;
  if st='completed' then update public.refund_provider_receipts set status='completed',evidence=e,confirmed_at=coalesce(confirmed_at,now()),updated_at=now() where id=x.id returning * into x;end if;
 else
  update public.refund_provider_receipts set status=st,evidence=e,updated_at=now(),confirmed_at=case when st='completed' then coalesce(confirmed_at,now()) else confirmed_at end where id=x.id returning * into x;
 end if;
 if p_attempt is not null then
  select z.* into o from public.refund_financial_operations z join public.refund_financial_attempts a on a.operation_id=z.id where a.id=p_attempt and z.payment_id=p.id and z.owner_id=p_owner for update of z;
  select * into t from public.refund_financial_attempts where id=p_attempt for update;
  if o.id is null or t.dispatched_at is null or t.amount_minor<>n or
   (t.provider_refund_id is not null and t.provider_refund_id<>rid) or
   (t.provider_refund_id is null and e->>'custom_id' is distinct from t.payload->>'custom_id') or
   (e ? 'custom_id' and e->>'custom_id' is not null and e->>'custom_id'<>t.payload->>'custom_id') then
   insert into public.refund_financial_incidents(payment_id,project_id,owner_id,code,reference) values(p.id,p.project_id,p_owner,'REFUND_ATTEMPT_RECEIPT_CONFLICT',rid) on conflict do nothing;
  else
   update public.refund_financial_attempts set provider_refund_id=rid,status=x.status,provider_status=upper(x.status),verified_at=now(),error_code=null,
    replay_in_progress=case when x.status in('completed','failed','cancelled') then false else replay_in_progress end,updated_at=now() where id=t.id;
   if x.status='completed' then
    insert into public.refund_receipt_applications(receipt_id,operation_id,attempt_id,settlement_id,project_id,owner_id)
    values(x.id,o.id,t.id,o.settlement_id,o.project_id,p_owner) on conflict do nothing;
    if not exists(select 1 from public.refund_receipt_applications where receipt_id=x.id and operation_id=o.id) then
     insert into public.refund_financial_incidents(payment_id,project_id,owner_id,code,reference) values(p.id,p.project_id,p_owner,'REFUND_RECEIPT_APPLICATION_CONFLICT',rid) on conflict do nothing;
    end if;
   end if;
   linked:=true;
  end if;
 end if;
 if private.refund_previous(p.id)>p.amount_minor then
  insert into public.refund_financial_incidents(payment_id,project_id,owner_id,code,reference) values(p.id,p.project_id,p_owner,'REFUND_CAPTURE_EXCEEDED',p.capture_id) on conflict do nothing;
 end if;
 if exists(select 1 from public.refund_settlements z where z.status='completed' and not exists(select 1 from public.refund_financial_authorizations a where a.settlement_id=z.id)
 and (z.payment_id=p.id or exists(select 1 from public.refund_settlement_payments m where m.settlement_id=z.id and m.payment_id=p.id)))
 or exists(select 1 from public.refund_financial_operations z where z.payment_id=p.id and z.status='completed' and not exists(select 1 from public.refund_receipt_applications a where a.operation_id=z.id)) then
  insert into public.refund_financial_incidents(payment_id,project_id,owner_id,code,reference) values(p.id,p.project_id,p_owner,'REFUND_LEGACY_RECONCILIATION_REQUIRED',rid) on conflict do nothing;
 end if;
 if o.id is not null then perform private.refund_recompute(o.settlement_id);end if;
 return jsonb_build_object('recorded',true,'receipt_id',x.id,'linked',linked);
end $$;
create function public.refund_receipt_backend(p_owner uuid,p_payment uuid,p_evidence jsonb,p_attempt uuid default null) returns jsonb language sql security invoker set search_path='' as $$select private.refund_receipt_record(p_owner,p_payment,p_evidence,p_attempt)$$;

alter function private.refund_finance_backend(uuid,text,jsonb) rename to refund_finance_backend_v5;
create function private.refund_finance_backend(p_owner uuid,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
<<command>>
declare ctx jsonb;r public.refund_settlements;s public.refund_snapshots;o public.refund_financial_operations;t public.refund_financial_attempts;p public.project_received_payments;
 c public.refund_recovery_checks;consent public.refund_recovery_consents;x public.refund_provider_receipts;f jsonb;e jsonb;result jsonb;payload jsonb;
 remaining bigint;previous bigint;digest text;aid uuid;st text;begin
 -- The old context performs authentication and the common project -> payments -> parent locks.
 ctx:=private.refund_finance_backend_v5(p_owner,'context',p_data);
 select * into r from public.refund_settlements where id=(p_data->>'settlement_id')::uuid;
 select * into s from public.refund_snapshots where id=r.current_snapshot_id;
 if p_action='context' then
  select coalesce(jsonb_agg(to_jsonb(q)||jsonb_build_object('expected_reference',case when q.origin='initial' then 'initial-'||q.project_id::text else q.proposal_payment_id::text end,
   'previous_refunds_minor',private.refund_previous(q.id),'reserved_minor',private.refund_reserved(q.id),
   'known_refunds',coalesce((select jsonb_agg(jsonb_build_object('refund_id',a.provider_refund_id,'status',a.status,'amount_minor',a.amount_minor)) from public.refund_financial_attempts a join public.refund_financial_operations z on z.id=a.operation_id where z.payment_id=q.id and a.dispatched_at is not null),'[]')
   ||coalesce((select jsonb_agg(jsonb_build_object('refund_id',v.refund_id,'status',v.status,'amount_minor',v.amount_minor)) from public.refund_provider_receipts v where v.payment_id=q.id and not exists(select 1 from public.refund_financial_attempts a where a.provider_refund_id=v.refund_id)),'[]')) order by q.id),'[]') into result
   from public.project_received_payments q join public.refund_settlement_payments m on m.payment_id=q.id where m.settlement_id=r.id;
  return ctx||jsonb_build_object('received_payments',result);
 end if;
 if p_action='save_check' and exists(select 1 from public.refund_financial_incidents i join public.refund_settlement_payments m on m.payment_id=i.payment_id where m.settlement_id=r.id) then raise sqlstate 'PT409' using message='REFUND_RECONCILIATION_REQUIRED';end if;
 if p_action in('save_check','run_claim','run_finish') then return private.refund_finance_backend_v5(p_owner,p_action,p_data);end if;
 select * into o from public.refund_financial_operations where id=(p_data->>'operation_id')::uuid and settlement_id=r.id for update;
 if not found then raise sqlstate 'PT404' using message='REFUND_OPERATION_NOT_FOUND';end if;
 if p_data ? 'attempt_id' then
  select * into t from public.refund_financial_attempts where id=(p_data->>'attempt_id')::uuid and operation_id=o.id for update;
 else
  if (select count(*) from public.refund_financial_attempts where operation_id=o.id)>1 and p_action in('bind','result') then raise sqlstate 'PT409' using message='REFUND_ATTEMPT_REQUIRED';end if;
  select * into t from public.refund_financial_attempts where operation_id=o.id order by attempt_no desc limit 1 for update;
 end if;
 if t.id is null then raise sqlstate 'PT404' using message='REFUND_ATTEMPT_NOT_FOUND';end if;
 select * into p from public.project_received_payments where id=o.payment_id;
 remaining:=o.amount_minor-private.refund_applied(o.id);previous:=private.refund_previous(p.id);
 if p_action in('replay_claim','external_apply','retry_authorize') then
  digest:=encode(sha256(convert_to(jsonb_build_object('action',p_action,'data',p_data)::text,'UTF8')),'hex');
  if p_data->>'operation_key' is null or p_data->>'operation_key' !~ '^[!-~]{1,128}$' then raise sqlstate 'PT422' using message='INVALID_IDEMPOTENCY_KEY';end if;
  select * into consent from public.refund_recovery_consents where owner_id=p_owner and operation_key=p_data->>'operation_key';
  if found then
   if consent.request_hash<>digest then raise sqlstate 'PT409' using message='IDEMPOTENCY_KEY_CONFLICT';end if;
   return private.refund_financial_view(p_owner,r.id)||jsonb_build_object('acquired',false);
  end if;
  if t.attempt_no<>(select max(a.attempt_no) from public.refund_financial_attempts a where a.operation_id=o.id) or p_data->'confirmed' is distinct from 'true'::jsonb or p_data->>'expected_snapshot_id' is distinct from s.id::text or p_data->>'attempt_id' is distinct from t.id::text
   or p_data->>'expected_revision' is distinct from t.revision::text or length(trim(coalesce(p_data->>'notes','')))=0 then raise sqlstate 'PT409' using message='REFUND_RECOVERY_CONFIRMATION_REQUIRED';end if;
  if exists(select 1 from public.refund_financial_incidents where payment_id=p.id) then raise sqlstate 'PT409' using message='REFUND_RECONCILIATION_REQUIRED';end if;
 end if;
 if p_action='dispatch_claim' then
  if r.scope='project_closure' and exists(select id from public.project_received_payments where project_id=r.project_id and owner_id=r.owner_id except select payment_id from public.refund_settlement_payments where settlement_id=r.id) then raise sqlstate 'PT409' using message='REFUND_PAYMENTS_CHANGED';end if;
  if o.status<>'reserved' or t.status<>'reserved' or t.dispatched_at is not null then return jsonb_build_object('acquired',false);end if;
  if not exists(select 1 from public.refund_financial_runs z where z.id=(p_data->>'run_id')::uuid and z.authorization_id=o.authorization_id and z.status='running') then raise sqlstate 'PT409' using message='REFUND_EXECUTION_IN_PROGRESS';end if;
  if exists(select 1 from public.refund_financial_operations z where z.authorization_id=o.authorization_id and z.sequence_no<o.sequence_no and z.status<>'completed') then raise sqlstate 'PT409' using message='REFUND_PREVIOUS_OPERATION_PENDING';end if;
  if exists(select 1 from public.refund_financial_incidents where payment_id=p.id) then raise sqlstate 'PT409' using message='REFUND_RECONCILIATION_REQUIRED';end if;
  select value into f from jsonb_array_elements(ctx->'payments') where value->>'payment_id'=p.id::text;
  -- A retry is checked against today's verified balance, preserving the agreed operation total.
  if t.amount_minor<>remaining then raise sqlstate 'PT409' using message='REFUND_ALLOCATION_MISMATCH';end if;
  if exists(select 1 from public.refund_recovery_consents where attempt_id=t.id and action='retry') then f:=f||jsonb_build_object('refund_minor',remaining,'local_previous_refunds_minor',previous);end if;
  perform private.refund_financial_validate(p_data->'evidence',f,p,remaining);
  update public.refund_financial_attempts set status='dispatching',dispatched_at=now(),updated_at=now() where id=t.id returning * into t;
  update public.refund_financial_operations set status='dispatching',updated_at=now() where id=o.id returning * into o;
  return jsonb_build_object('acquired',true,'operation',to_jsonb(o),'attempt',to_jsonb(t),'payment',to_jsonb(p));
 elsif p_action='bind' then
  if t.dispatched_at is null or p_data->>'refund_id' is null or p_data->>'refund_id' !~ '^[A-Za-z0-9_-]{1,64}$'
   or t.provider_refund_id is not null and t.provider_refund_id<>p_data->>'refund_id' then raise sqlstate 'PT409' using message='REFUND_RESULT_MISMATCH';end if;
  update public.refund_financial_attempts set provider_refund_id=p_data->>'refund_id',updated_at=now() where id=t.id;
  return jsonb_build_object('recorded',true);
 elsif p_action='result' then
  st:=p_data->>'status';
  if t.dispatched_at is null or st is null or st not in('uncertain','pending','completed','failed','cancelled') then raise sqlstate 'PT422' using message='INVALID_REFUND_INPUT';end if;
  if p_data->'canonical'='true'::jsonb then
   perform private.refund_receipt_record(p_owner,p.id,p_data,t.id);
  else
   if st='failed' and p_data->'definitive_rejection'='true'::jsonb and t.provider_refund_id is null and p_data->>'error_code' in('PAYPAL_REFUND_AUTH_REJECTED','PAYPAL_REFUND_REQUEST_REJECTED') then
    if t.status not in('completed','pending','failed','cancelled') then update public.refund_financial_attempts set status='failed',error_code=p_data->>'error_code',replay_in_progress=false,updated_at=now() where id=t.id;end if;
   elsif st='uncertain' then
    if t.status not in('completed','failed','cancelled') then update public.refund_financial_attempts set status='uncertain',error_code=p_data->>'error_code',updated_at=now() where id=t.id;end if;
   else raise sqlstate 'PT409' using message='REFUND_RESULT_MISMATCH';end if;
  end if;
  insert into public.refund_financial_observations(operation_id,settlement_id,project_id,owner_id,status,evidence) values(o.id,r.id,r.project_id,p_owner,st,p_data-array['settlement_id','operation_id']);
  perform private.refund_recompute(r.id);
  return private.refund_financial_view(p_owner,r.id);
 elsif p_action='reconcile_claim' then
  -- Fence the entire interrupted batch, including an old handler waiting for HTTP.
  update public.refund_financial_runs set status='finished',finished_at=now() where authorization_id=o.authorization_id and status='running';
  update public.refund_financial_attempts set revision=revision+1,updated_at=now() where id=t.id returning * into t;
  return private.refund_financial_view(p_owner,r.id)||jsonb_build_object('attempt',to_jsonb(t),'operation',to_jsonb(o));
 elsif p_action='save_recovery_check' then
  if t.status not in('failed','cancelled') or exists(select 1 from public.refund_financial_attempts where operation_id=o.id and status in('dispatching','uncertain','pending')) or remaining<=0 then raise sqlstate 'PT409' using message='REFUND_RECONCILIATION_REQUIRED';end if;
  select value into f from jsonb_array_elements(ctx->'payments') where value->>'payment_id'=p.id::text;
  f:=f||jsonb_build_object('refund_minor',remaining,'local_previous_refunds_minor',previous);e:=p_data->'evidence';
  perform private.refund_financial_validate(e,f,p,case when o.status='reserved' then remaining else 0 end);
  if exists(select 1 from public.refund_provider_receipts q where q.payment_id=p.id and (q.status='pending' or q.status='completed' and not exists(select 1 from public.refund_receipt_applications a where a.receipt_id=q.id))) or exists(select 1 from public.refund_financial_incidents where payment_id=p.id) then raise sqlstate 'PT409' using message='REFUND_RECONCILIATION_REQUIRED';end if;
  digest:=encode(sha256(convert_to(jsonb_build_object('snapshot',s.id,'attempt',t.id,'revision',t.revision,'remaining',remaining,'evidence',e)::text,'UTF8')),'hex');
  insert into public.refund_recovery_checks(operation_id,attempt_id,attempt_revision,settlement_id,snapshot_id,project_id,owner_id,amount_minor,evidence,digest,expires_at)
  values(o.id,t.id,t.revision,r.id,s.id,r.project_id,p_owner,remaining,e,digest,least(now()+interval '5 minutes',(e->>'observed_at')::timestamptz+interval '5 minutes')) returning * into c;
  return jsonb_build_object('check',to_jsonb(c));
 elsif p_action='replay_claim' then
  if t.status not in('dispatching','uncertain') or t.dispatched_at is null or t.dispatched_at<=now()-interval '44 days' or t.replay_in_progress then raise sqlstate 'PT409' using message='REFUND_REPLAY_NOT_ALLOWED';end if;
  if remaining<>t.amount_minor or encode(sha256(convert_to(t.payload::text,'UTF8')),'hex')<>t.payload_sha256
  or exists(select 1 from public.refund_provider_receipts q where q.payment_id=p.id and q.status in('completed','pending') and not exists(select 1 from public.refund_receipt_applications a where a.receipt_id=q.id)) then raise sqlstate 'PT409' using message='REFUND_RECONCILIATION_REQUIRED';end if;
  update public.refund_financial_runs set status='finished',finished_at=now() where authorization_id=o.authorization_id and status='running';
  update public.refund_financial_attempts set replay_in_progress=true,revision=revision+1,updated_at=now() where id=t.id returning * into t;
  insert into public.refund_recovery_consents(operation_id,attempt_id,settlement_id,snapshot_id,project_id,owner_id,reviewer_id,action,operation_key,request_hash,notes,details)
  values(o.id,t.id,r.id,s.id,r.project_id,p_owner,p_owner,'replay',p_data->>'operation_key',digest,p_data->>'notes',p_data);
  return private.refund_financial_view(p_owner,r.id)||jsonb_build_object('acquired',true,'attempt',to_jsonb(t),'operation',to_jsonb(o),'payment',to_jsonb(p));
 elsif p_action='external_apply' then
  if exists(select 1 from public.refund_financial_attempts where operation_id=o.id and (status in('dispatching','uncertain','pending') or replay_in_progress)) then raise sqlstate 'PT409' using message='REFUND_RECONCILIATION_REQUIRED';end if;
  select * into x from public.refund_provider_receipts where id=(p_data->>'receipt_id')::uuid and payment_id=p.id and owner_id=p_owner for update;
  if not found or x.status<>'completed' or exists(select 1 from public.refund_receipt_applications where receipt_id=x.id) then raise sqlstate 'PT409' using message='REFUND_RECEIPT_NOT_APPLICABLE';end if;
  if x.amount_minor>remaining then
   insert into public.refund_financial_incidents(payment_id,project_id,owner_id,code,reference) values(p.id,p.project_id,p_owner,'REFUND_RECEIPT_EXCEEDS_ALLOCATION',x.refund_id) on conflict do nothing;
   return private.refund_financial_view(p_owner,r.id)||jsonb_build_object('application_recorded',false,'error_code','REFUND_RECEIPT_EXCEEDS_ALLOCATION');
  end if;
  if t.status='reserved' and t.dispatched_at is null then update public.refund_financial_attempts set status='cancelled',error_code='NOT_DISPATCHED_EXTERNAL_APPLICATION',updated_at=now() where id=t.id;end if;
  insert into public.refund_receipt_applications(receipt_id,operation_id,settlement_id,project_id,owner_id,reviewer_id,notes) values(x.id,o.id,r.id,r.project_id,p_owner,p_owner,p_data->>'notes');
  insert into public.refund_recovery_consents(operation_id,attempt_id,settlement_id,snapshot_id,project_id,owner_id,reviewer_id,action,operation_key,request_hash,notes,details)
  values(o.id,t.id,r.id,s.id,r.project_id,p_owner,p_owner,'external_apply',p_data->>'operation_key',digest,p_data->>'notes',p_data);
  update public.refund_financial_runs set status='finished',finished_at=now() where authorization_id=o.authorization_id and status='running';
  perform private.refund_recompute(r.id);return private.refund_financial_view(p_owner,r.id);
 elsif p_action='retry_authorize' then
  select * into c from public.refund_recovery_checks where id=(p_data->>'check_id')::uuid and operation_id=o.id and attempt_id=t.id and snapshot_id=s.id;
  if not found or c.digest is distinct from p_data->>'digest' or c.expires_at<=now() or c.attempt_revision<>t.revision or c.amount_minor<>remaining or remaining<=0
   or t.status not in('failed','cancelled') or exists(select 1 from public.refund_financial_attempts where operation_id=o.id and (status in('reserved','dispatching','uncertain','pending') or replay_in_progress)) then raise sqlstate 'PT409' using message='REFUND_RECOVERY_CHECK_MISMATCH';end if;
  select value into f from jsonb_array_elements(ctx->'payments') where value->>'payment_id'=p.id::text;
  perform private.refund_financial_validate(c.evidence,f||jsonb_build_object('refund_minor',remaining,'local_previous_refunds_minor',previous),p);
  if exists(select 1 from public.refund_provider_receipts q where q.payment_id=p.id and (q.status='pending' or q.status='completed' and not exists(select 1 from public.refund_receipt_applications a where a.receipt_id=q.id))) then raise sqlstate 'PT409' using message='REFUND_RECONCILIATION_REQUIRED';end if;
  aid:=gen_random_uuid();payload:=jsonb_build_object('amount',jsonb_build_object('currency_code','USD','value',(remaining/100)::text||'.'||lpad((remaining%100)::text,2,'0')),'custom_id','trato-refund-'||aid::text);
  insert into public.refund_financial_attempts(id,operation_id,settlement_id,project_id,owner_id,amount_minor,attempt_no,payload,payload_sha256)
  values(aid,o.id,r.id,r.project_id,p_owner,remaining,t.attempt_no+1,payload,encode(sha256(convert_to(payload::text,'UTF8')),'hex'));
  insert into public.refund_recovery_consents(operation_id,attempt_id,settlement_id,snapshot_id,project_id,owner_id,reviewer_id,action,operation_key,request_hash,notes,details)
  values(o.id,aid,r.id,s.id,r.project_id,p_owner,p_owner,'retry',p_data->>'operation_key',digest,p_data->>'notes',p_data);
  update public.refund_financial_operations set status='reserved',updated_at=now() where id=o.id;
  update public.refund_financial_runs set status='finished',finished_at=now() where authorization_id=o.authorization_id and status='running';
  return private.refund_financial_view(p_owner,r.id);
 end if;
 raise sqlstate 'PT422' using message='INVALID_REFUND_ACTION';
exception when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format then raise sqlstate 'PT422' using message='INVALID_REFUND_INPUT';
end $$;
revoke all on function private.refund_recompute(uuid),private.refund_receipt_record(uuid,uuid,jsonb,uuid),public.refund_receipt_backend(uuid,uuid,jsonb,uuid),private.refund_finance_backend_v5(uuid,text,jsonb),private.refund_finance_backend(uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.refund_receipt_record(uuid,uuid,jsonb,uuid),public.refund_receipt_backend(uuid,uuid,jsonb,uuid),private.refund_finance_backend(uuid,text,jsonb) to service_role;
commit;

begin;
alter function private.refund_financial_authorize(jsonb,text) rename to refund_financial_authorize_v5;
create function private.refund_financial_authorize(p_data jsonb,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();r public.refund_settlements;begin
 if actor is null then raise sqlstate 'PT401' using message='UNAUTHORIZED';end if;
 select * into r from public.refund_settlements where id=(p_data->>'settlement_id')::uuid and owner_id=actor;
 if not found then raise sqlstate 'PT404' using message='REFUND_NOT_FOUND';end if;
 perform private.ensure_active_project(r.project_id,actor);
 perform 1 from public.projects where id=r.project_id for update;
 if exists(select 1 from public.refund_financial_incidents i join public.refund_settlement_payments m on m.payment_id=i.payment_id where m.settlement_id=r.id) then raise sqlstate 'PT409' using message='REFUND_RECONCILIATION_REQUIRED';end if;
 return private.refund_financial_authorize_v5(p_data,p_key);
end $$;
revoke all on function private.refund_financial_authorize(jsonb,text),private.refund_financial_authorize_v5(jsonb,text) from public,anon,authenticated,service_role;
grant execute on function private.refund_financial_authorize(jsonb,text) to authenticated;
commit;
