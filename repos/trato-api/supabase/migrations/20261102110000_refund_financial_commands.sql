begin;
create function private.refund_financial_validate(e jsonb,f jsonb,p public.project_received_payments,own_reserve bigint default 0)
returns void language plpgsql security definer set search_path='' as $$
declare previous bigint:=private.refund_previous(p.id);remaining bigint;fee bigint;net bigint;begin
 if jsonb_typeof(e) is distinct from 'object' or e->'verified' is distinct from 'true'::jsonb
 or e->>'payment_id' is distinct from p.id::text or e->>'capture_id' is distinct from p.capture_id
 or e->>'merchant_id' is distinct from p.merchant_id or e->>'currency' is distinct from 'USD'
 or private.refund_money(e->'gross_minor')<>p.amount_minor
 or private.refund_money(f->'amount_minor')<>p.amount_minor
 or f->>'capture_id' is distinct from p.capture_id or f->>'merchant_id' is distinct from p.merchant_id
 then raise sqlstate 'PT409' using message='REFUND_PAYMENT_CONTEXT_MISMATCH';end if;
 remaining:=private.refund_money(e->'provider_remaining_minor');fee:=private.refund_money(e->'original_fee_minor');net:=private.refund_money(e->'original_net_minor');
 if private.refund_money(e->'previous_refunds_minor')<>previous or private.refund_money(f->'local_previous_refunds_minor')<>previous
 or remaining<>p.amount_minor-previous or fee+net<>p.amount_minor
 then raise sqlstate 'PT409' using message='REFUND_RECONCILIATION_REQUIRED';end if;
 if nullif(e->>'observed_at','') is null or (e->>'observed_at')::timestamptz<now()-interval '5 minutes'
 or (e->>'observed_at')::timestamptz>now()+interval '30 seconds' then raise sqlstate 'PT409' using message='REFUND_FINANCIAL_CHECK_EXPIRED';end if;
 if private.refund_money(f->'refund_minor')>remaining-private.refund_reserved(p.id)+own_reserve then raise sqlstate 'PT409' using message='REFUND_EXCEEDS_AVAILABLE';end if;
end $$;
create function private.refund_financial_authorize(p_data jsonb,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$
<<command>>
declare actor uuid:=auth.uid();r public.refund_settlements;s public.refund_snapshots;c public.refund_financial_checks;a public.refund_financial_authorizations;
 p public.project_received_payments;o public.refund_financial_operations;f jsonb;e jsonb;payments jsonb;result jsonb;digest text;payload jsonb;n int:=0;total bigint:=0;begin
 if actor is null or not exists(select 1 from auth.users where id=actor and deleted_at is null and not coalesce(is_anonymous,false)) then raise sqlstate 'PT401' using message='UNAUTHORIZED';end if;
 perform private.refund_object(p_data,array['settlement_id','expected_snapshot_id','check_id','digest','confirmed','notes']);
 if p_key is null or p_key !~ '^[!-~]{1,128}$' then raise sqlstate 'PT422' using message='INVALID_IDEMPOTENCY_KEY';end if;
 select * into r from public.refund_settlements where id=(p_data->>'settlement_id')::uuid and owner_id=actor;
 if not found then raise sqlstate 'PT404' using message='REFUND_NOT_FOUND';end if;
 perform private.ensure_active_project(r.project_id,actor);
 perform 1 from public.projects where id=r.project_id for update;
 perform 1 from public.project_received_payments where id in(select payment_id from public.refund_settlement_payments where settlement_id=r.id) order by id for update;
 select * into r from public.refund_settlements where id=r.id for update;
 digest:=encode(sha256(convert_to(jsonb_build_object('action','financial_authorize','data',p_data)::text,'UTF8')),'hex');
 insert into private.refund_commands(owner_id,idempotency_key,command_hash) values(actor,p_key,digest) on conflict do nothing;
 select x.result into result from private.refund_commands x where x.owner_id=actor and x.idempotency_key=p_key and x.command_hash=digest for update;
 if not found then raise sqlstate 'PT409' using message='IDEMPOTENCY_KEY_CONFLICT';end if;
 if result is not null then return private.refund_financial_view(actor,r.id);end if;
 if r.current_snapshot_id is distinct from (p_data->>'expected_snapshot_id')::uuid then raise sqlstate 'PT409' using message='REFUND_REVISION_CONFLICT';end if;
 if exists(select 1 from public.refund_financial_authorizations where snapshot_id=r.current_snapshot_id) then raise sqlstate 'PT409' using message='REFUND_ALREADY_AUTHORIZED';end if;
 if r.status<>'accepted' or p_data->'confirmed' is distinct from 'true'::jsonb then raise sqlstate 'PT409' using message='REFUND_FINANCIAL_AUTHORIZATION_REQUIRED';end if;
 select * into s from public.refund_snapshots where id=r.current_snapshot_id;
 if (s.breakdown->>'refund_minor')::bigint<=0 then raise sqlstate 'PT409' using message='REFUND_ZERO_AMOUNT';end if;
 select * into c from public.refund_financial_checks where id=(p_data->>'check_id')::uuid and snapshot_id=s.id and owner_id=actor;
 if not found or c.digest is distinct from p_data->>'digest' or c.snapshot_sha256<>s.content_sha256
 or not exists(select 1 from public.refund_acceptances x join public.refund_artifacts y on y.id=x.artifact_id where x.snapshot_id=s.id and y.sha256=c.artifact_sha256)
 then raise sqlstate 'PT409' using message='REFUND_FINANCIAL_CHECK_MISMATCH';end if;
 if c.expires_at<=now() then raise sqlstate 'PT409' using message='REFUND_FINANCIAL_CHECK_EXPIRED';end if;
 payments:=private.refund_financial_payments(r,s);
 if r.scope='project_closure' and exists(select id from public.project_received_payments where project_id=r.project_id and owner_id=r.owner_id except select payment_id from public.refund_settlement_payments where settlement_id=r.id) then raise sqlstate 'PT409' using message='REFUND_PAYMENTS_CHANGED';end if;
 insert into public.refund_financial_authorizations(settlement_id,snapshot_id,project_id,owner_id,check_id,reviewer_id,notes,amount_minor,snapshot_sha256,artifact_sha256)
 values(r.id,s.id,r.project_id,actor,c.id,actor,private.refund_text(p_data->'notes'),(s.breakdown->>'refund_minor')::bigint,s.content_sha256,c.artifact_sha256) returning * into a;
 for f in select value from jsonb_array_elements(payments) where (value->>'refund_minor')::bigint>0 order by value->>'payment_id' loop
  select * into p from public.project_received_payments where id=(f->>'payment_id')::uuid and owner_id=actor and project_id=r.project_id;
  if not found then raise sqlstate 'PT409' using message='REFUND_PAYMENT_CONTEXT_MISMATCH';end if;
  select value into e from jsonb_array_elements(c.evidence) where value->>'payment_id'=p.id::text;
  if not found then raise sqlstate 'PT409' using message='REFUND_FINANCIAL_CHECK_MISMATCH';end if;
  perform private.refund_financial_validate(e,f,p);
  n:=n+1;total:=total+(f->>'refund_minor')::bigint;
  insert into public.refund_financial_operations(authorization_id,settlement_id,project_id,owner_id,payment_id,sequence_no,amount_minor)
  values(a.id,r.id,r.project_id,actor,p.id,n,(f->>'refund_minor')::bigint) returning * into o;
  payload:=jsonb_build_object('amount',jsonb_build_object('currency_code','USD','value',((o.amount_minor/100)::text||'.'||lpad((o.amount_minor%100)::text,2,'0'))),'custom_id','trato-refund-'||o.id::text);
  insert into public.refund_financial_attempts(operation_id,settlement_id,project_id,owner_id,payload,payload_sha256)
  values(o.id,r.id,r.project_id,actor,payload,encode(sha256(convert_to(payload::text,'UTF8')),'hex'));
 end loop;
 if n=0 or n<>jsonb_array_length(c.evidence) or total<>a.amount_minor then raise sqlstate 'PT409' using message='REFUND_ALLOCATION_MISMATCH';end if;
 update public.refund_settlements set status='refund_pending',updated_at=now() where id=r.id;
 result:=private.refund_financial_view(actor,r.id);
 update private.refund_commands set result=command.result where owner_id=actor and idempotency_key=p_key;
 return result;
exception when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format then raise sqlstate 'PT422' using message='INVALID_REFUND_INPUT';
end $$;
create function public.refund_financial_authorize(p_data jsonb,p_key text) returns jsonb language sql security invoker set search_path='' as $$select private.refund_financial_authorize(p_data,p_key)$$;

create function private.refund_finance_backend(p_owner uuid,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
<<command>>
declare r public.refund_settlements;s public.refund_snapshots;c public.refund_financial_checks;a public.refund_financial_authorizations;
 o public.refund_financial_operations;t public.refund_financial_attempts;run public.refund_financial_runs;p public.project_received_payments;
 artifact public.refund_artifacts;f jsonb;e jsonb;payments jsonb;facts jsonb;result jsonb;digest text;total bigint;status text;op_key text;begin
 if p_owner is null or not exists(select 1 from auth.users where id=p_owner and deleted_at is null and not coalesce(is_anonymous,false)) then raise sqlstate 'PT401' using message='UNAUTHORIZED';end if;
 if p_action is null or p_action not in('context','save_check','run_claim','run_finish','dispatch_claim','bind','result')
 or jsonb_typeof(p_data) is distinct from 'object' then raise sqlstate 'PT422' using message='INVALID_REFUND_INPUT';end if;
 select * into r from public.refund_settlements where id=(p_data->>'settlement_id')::uuid and owner_id=p_owner;
 if not found then raise sqlstate 'PT404' using message='REFUND_NOT_FOUND';end if;
 perform private.ensure_active_project(r.project_id,p_owner);
 perform 1 from public.projects where id=r.project_id for update;
 perform 1 from public.project_received_payments where id in(select payment_id from public.refund_settlement_payments where settlement_id=r.id) order by id for update;
 select * into r from public.refund_settlements where id=r.id for update;
 select * into s from public.refund_snapshots where id=r.current_snapshot_id;
 select y.* into artifact from public.refund_artifacts y join public.refund_acceptances x on x.artifact_id=y.id where x.snapshot_id=s.id;
 if not found or r.status not in('accepted','refund_pending','completed') then raise sqlstate 'PT409' using message='REFUND_ACCEPTANCE_REQUIRED';end if;
 if p_data ? 'expected_snapshot_id' and s.id is distinct from (p_data->>'expected_snapshot_id')::uuid then raise sqlstate 'PT409' using message='REFUND_REVISION_CONFLICT';end if;
 payments:=private.refund_financial_payments(r,s);
 if p_action='context' then
  select coalesce(jsonb_agg(to_jsonb(q)||jsonb_build_object('expected_reference',case when q.origin='initial' then 'initial-'||q.project_id::text else q.proposal_payment_id::text end,
   'previous_refunds_minor',private.refund_previous(q.id),'reserved_minor',private.refund_reserved(q.id),
   'known_refunds',coalesce((select jsonb_agg(jsonb_build_object('refund_id',x.provider_refund_id,'status',v.status,'amount_minor',v.amount_minor))
    from public.refund_financial_operations v join public.refund_financial_attempts x on x.operation_id=v.id where v.payment_id=q.id and x.dispatched_at is not null),'[]')) order by q.id),'[]') into facts
   from public.project_received_payments q join public.refund_settlement_payments m on m.payment_id=q.id where m.settlement_id=r.id;
  return private.refund_financial_view(p_owner,r.id)||jsonb_build_object('snapshot',to_jsonb(s),'artifact',to_jsonb(artifact),'payments',payments,'received_payments',facts);
 elsif p_action='save_check' then
  if r.scope='project_closure' and exists(select id from public.project_received_payments where project_id=r.project_id and owner_id=r.owner_id except select payment_id from public.refund_settlement_payments where settlement_id=r.id) then raise sqlstate 'PT409' using message='REFUND_PAYMENTS_CHANGED';end if;
  if r.status<>'accepted' or (s.breakdown->>'refund_minor')::bigint<=0 then raise sqlstate 'PT409' using message='REFUND_FINANCIAL_AUTHORIZATION_REQUIRED';end if;
  facts:=p_data->'evidence';
  if jsonb_typeof(facts) is distinct from 'array' or jsonb_array_length(facts)<> (select count(*) from jsonb_array_elements(payments) x where (x->>'refund_minor')::bigint>0)
   or (select count(distinct value->>'payment_id') from jsonb_array_elements(facts))<>jsonb_array_length(facts) then raise sqlstate 'PT409' using message='REFUND_ALLOCATION_MISMATCH';end if;
  for f in select value from jsonb_array_elements(payments) where (value->>'refund_minor')::bigint>0 loop
   select * into p from public.project_received_payments where id=(f->>'payment_id')::uuid;
   select value into e from jsonb_array_elements(facts) where value->>'payment_id'=p.id::text;
   if not found then raise sqlstate 'PT409' using message='REFUND_FINANCIAL_CHECK_MISMATCH';end if;
   perform private.refund_financial_validate(e,f,p);
  end loop;
  digest:=encode(sha256(convert_to(jsonb_build_object('snapshot_sha256',s.content_sha256,'artifact_sha256',artifact.sha256,'evidence',facts,'policy',p_data->'policy')::text,'UTF8')),'hex');
  insert into public.refund_financial_checks(settlement_id,snapshot_id,project_id,owner_id,snapshot_sha256,artifact_sha256,evidence,policy,digest,expires_at)
  values(r.id,s.id,r.project_id,p_owner,s.content_sha256,artifact.sha256,facts,p_data->'policy',digest,
   least(now()+interval '5 minutes',(select min((value->>'observed_at')::timestamptz)+interval '5 minutes' from jsonb_array_elements(facts)))) returning * into c;
  return jsonb_build_object('settlement',to_jsonb(r),'check',to_jsonb(c));
 elsif p_action in('run_claim','run_finish') then
  select * into a from public.refund_financial_authorizations where id=(p_data->>'authorization_id')::uuid and settlement_id=r.id;
  if not found then raise sqlstate 'PT404' using message='REFUND_AUTHORIZATION_NOT_FOUND';end if;
  if p_action='run_finish' then
   update public.refund_financial_runs x set status='finished',finished_at=now() where x.id=(p_data->>'run_id')::uuid and x.authorization_id=a.id and x.status='running';
   return private.refund_financial_view(p_owner,r.id);
  end if;
  op_key:=p_data->>'operation_key';
  if op_key is null or op_key !~ '^[!-~]{1,128}$' then raise sqlstate 'PT422' using message='INVALID_IDEMPOTENCY_KEY';end if;
  digest:=encode(sha256(convert_to(jsonb_build_object('action','financial_execute','data',p_data)::text,'UTF8')),'hex');
  insert into private.refund_commands(owner_id,idempotency_key,command_hash) values(p_owner,op_key,digest) on conflict do nothing;
  select x.result into result from private.refund_commands x where x.owner_id=p_owner and x.idempotency_key=op_key and x.command_hash=digest for update;
  if not found then raise sqlstate 'PT409' using message='IDEMPOTENCY_KEY_CONFLICT';end if;
  if result is not null then return private.refund_financial_view(p_owner,r.id)||jsonb_build_object('acquired',false,'run_id',result->>'run_id');end if;
  if exists(select 1 from public.refund_financial_runs x where x.authorization_id=a.id and x.status='running') then raise sqlstate 'PT409' using message='REFUND_EXECUTION_IN_PROGRESS';end if;
  insert into public.refund_financial_runs(authorization_id,settlement_id,project_id,owner_id) values(a.id,r.id,r.project_id,p_owner) returning * into run;
  result:=jsonb_build_object('settlement',to_jsonb(r),'authorization_id',a.id,'run_id',run.id,'execution_registered',true);
  update private.refund_commands set result=command.result where owner_id=p_owner and idempotency_key=op_key;
  return private.refund_financial_view(p_owner,r.id)||jsonb_build_object('acquired',true,'run_id',run.id);
 end if;
 select * into o from public.refund_financial_operations where id=(p_data->>'operation_id')::uuid and settlement_id=r.id for update;
 if not found then raise sqlstate 'PT404' using message='REFUND_OPERATION_NOT_FOUND';end if;
 select * into t from public.refund_financial_attempts where operation_id=o.id for update;
 select * into p from public.project_received_payments where id=o.payment_id;
 if p_action='dispatch_claim' then
 if r.scope='project_closure' and exists(select id from public.project_received_payments where project_id=r.project_id and owner_id=r.owner_id except select payment_id from public.refund_settlement_payments where settlement_id=r.id) then raise sqlstate 'PT409' using message='REFUND_PAYMENTS_CHANGED';end if;
  if o.status<>'reserved' then return to_jsonb(o)||jsonb_build_object('acquired',false);end if;
  if not exists(select 1 from public.refund_financial_runs x where x.id=(p_data->>'run_id')::uuid and x.authorization_id=o.authorization_id and x.status='running') then raise sqlstate 'PT409' using message='REFUND_EXECUTION_IN_PROGRESS';end if;
  if exists(select 1 from public.refund_financial_operations x where x.authorization_id=o.authorization_id and x.sequence_no<o.sequence_no and x.status<>'completed') then raise sqlstate 'PT409' using message='REFUND_PREVIOUS_OPERATION_PENDING';end if;
  select value into f from jsonb_array_elements(payments) where value->>'payment_id'=p.id::text;
  perform private.refund_financial_validate(p_data->'evidence',f,p,o.amount_minor);
  update public.refund_financial_operations set status='dispatching',updated_at=now() where id=o.id returning * into o;
  update public.refund_financial_attempts set dispatched_at=now(),updated_at=now() where id=t.id returning * into t;
  return jsonb_build_object('acquired',true,'operation',to_jsonb(o),'attempt',to_jsonb(t),'payment',to_jsonb(p));
 elsif p_action='bind' then
  if o.status<>'dispatching' or t.dispatched_at is null or p_data->>'refund_id' is null or p_data->>'refund_id' !~ '^[A-Za-z0-9_-]{1,64}$'
  or (t.provider_refund_id is not null and t.provider_refund_id<>p_data->>'refund_id') then raise sqlstate 'PT409' using message='REFUND_RESULT_MISMATCH';end if;
  update public.refund_financial_attempts set provider_refund_id=p_data->>'refund_id',updated_at=now() where id=t.id;
  return jsonb_build_object('recorded',true);
 elsif p_action='result' then
  status:=p_data->>'status';
  if status is null or status not in('uncertain','pending','completed','failed','cancelled') or t.dispatched_at is null then raise sqlstate 'PT422' using message='INVALID_REFUND_INPUT';end if;
  if o.status='completed' then
   if status<>'completed' or t.provider_refund_id is distinct from p_data->>'refund_id' then raise sqlstate 'PT409' using message='REFUND_RESULT_MISMATCH';end if;
   return private.refund_financial_view(p_owner,r.id);
  end if;
  if o.status in('failed','cancelled') and status<>o.status then raise sqlstate 'PT409' using message='REFUND_RESULT_MISMATCH';end if;
  if status in('completed','pending','failed','cancelled') then
   if p_data->'canonical'='true'::jsonb then
    if t.provider_refund_id is null or t.provider_refund_id is distinct from p_data->>'refund_id' or private.refund_money(p_data->'amount_minor')<>o.amount_minor
     or p_data->>'currency' is distinct from 'USD' or p_data->>'capture_id' is distinct from p.capture_id then raise sqlstate 'PT409' using message='REFUND_RESULT_MISMATCH';end if;
   elsif status<>'failed' or p_data->'definitive_rejection' is distinct from 'true'::jsonb or t.provider_refund_id is not null
    or p_data->>'error_code' is null or p_data->>'error_code' not in('PAYPAL_REFUND_AUTH_REJECTED','PAYPAL_REFUND_REQUEST_REJECTED') then raise sqlstate 'PT409' using message='REFUND_RESULT_MISMATCH';end if;
  end if;
  update public.refund_financial_operations set status=command.status,updated_at=now() where id=o.id;
  update public.refund_financial_attempts set error_code=p_data->>'error_code',provider_status=case when p_data->'canonical'='true'::jsonb then upper(command.status) else provider_status end,
   verified_at=case when p_data->'canonical'='true'::jsonb then now() else verified_at end,updated_at=now() where id=t.id;
  insert into public.refund_financial_observations(operation_id,settlement_id,project_id,owner_id,status,evidence) values(o.id,r.id,r.project_id,p_owner,status,p_data-ARRAY['settlement_id','operation_id']);
  if not exists(select 1 from public.refund_financial_operations x where x.authorization_id=o.authorization_id and x.status<>'completed')
   and (r.scope<>'project_closure' or not exists(select id from public.project_received_payments where project_id=r.project_id and owner_id=r.owner_id except select payment_id from public.refund_settlement_payments where settlement_id=r.id)) then
   select sum(amount_minor) into total from public.refund_financial_operations where authorization_id=o.authorization_id;
   if total<>(s.breakdown->>'refund_minor')::bigint then raise sqlstate 'PT409' using message='REFUND_ALLOCATION_MISMATCH';end if;
   update public.refund_settlements set status='completed',confirmed_refund_minor=total,closed_at=now(),updated_at=now() where id=r.id;
   if r.scope='project_closure' then update public.projects set status='closed' where id=r.project_id;end if;
  end if;
  return private.refund_financial_view(p_owner,r.id);
 end if;
 raise sqlstate 'PT422' using message='INVALID_REFUND_ACTION';
exception when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format then raise sqlstate 'PT422' using message='INVALID_REFUND_INPUT';
end $$;
create function public.refund_finance_backend(p_owner uuid,p_action text,p_data jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.refund_finance_backend(p_owner,p_action,p_data)$$;
revoke all on function private.refund_financial_validate(jsonb,jsonb,public.project_received_payments,bigint),private.refund_financial_authorize(jsonb,text),public.refund_financial_authorize(jsonb,text),private.refund_finance_backend(uuid,text,jsonb),public.refund_finance_backend(uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.refund_financial_authorize(jsonb,text),public.refund_financial_authorize(jsonb,text) to authenticated;
grant execute on function private.refund_finance_backend(uuid,text,jsonb),public.refund_finance_backend(uuid,text,jsonb) to service_role;
create or replace function private.refund_command_result(p_project_id uuid,p_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();saved jsonb;m public.refund_deliveries;a public.refund_artifacts;
begin
 if actor is null or not exists(select 1 from auth.users where id=actor and deleted_at is null and not coalesce(is_anonymous,false)) then raise sqlstate 'PT401' using message='UNAUTHORIZED';end if;
 if p_key is null or p_key !~ '^[!-~]{1,128}$' then raise sqlstate 'PT422' using message='INVALID_IDEMPOTENCY_KEY';end if;
 perform private.ensure_active_project(p_project_id,actor);
 select result into saved from private.refund_commands where owner_id=actor and idempotency_key=p_key;
 if saved is not null and saved->'settlement'->>'project_id'=p_project_id::text then
  if saved ? 'authorizations' or saved ? 'execution_registered' then
   saved:=private.refund_financial_view(actor,(saved->'settlement'->>'id')::uuid)||case when saved ? 'run_id' then jsonb_build_object('run_id',saved->>'run_id','execution_registered',true) else '{}'::jsonb end;
  elsif saved ? 'artifact' then
   select * into a from public.refund_artifacts where id=(saved->'artifact'->>'id')::uuid and owner_id=actor and project_id=p_project_id;
   if a.document_id is null then return jsonb_build_object('state','unconfirmed');end if;
   saved:=saved||jsonb_build_object('artifact',to_jsonb(a));
  end if;
  return jsonb_build_object('state','confirmed','result',saved);
 elsif saved is not null and saved->>'project_id'=p_project_id::text and saved ? 'payment' then
  return jsonb_build_object('state','confirmed','result',saved);
 end if;
 select * into m from public.refund_deliveries where owner_id=actor and project_id=p_project_id and operation_key=p_key;
 if found and m.status in('accepted_by_gmail','failed') then
  select jsonb_build_object('settlement',to_jsonb(r),'delivery',to_jsonb(m)) into saved from public.refund_settlements r where r.id=m.settlement_id and r.owner_id=actor;
  return jsonb_build_object('state','confirmed','result',saved);
 end if;
 return jsonb_build_object('state','unconfirmed');
end $$;
commit;
