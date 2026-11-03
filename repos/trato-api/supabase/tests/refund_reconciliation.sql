begin;
\ir fixtures/refund_financial_fixture.sql
create temp table reconciliation_test(f jsonb);
insert into reconciliation_test select pg_temp.refund_financial_fixture(false);
grant select on reconciliation_test to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub',f->>'owner',true) from reconciliation_test;
do $$declare f jsonb;v jsonb;begin
 select x.f into f from reconciliation_test x;
 v:=public.refund_financial_authorize(jsonb_build_object('settlement_id',f->>'parent','expected_snapshot_id',f->>'snapshot','check_id',f->'check'->>'id','digest',f->'check'->>'digest','confirmed',true,'notes','Reviewed'), 'reconcile-authorize');
 begin insert into public.refund_provider_receipts(merchant_id,refund_id) values('x','x');raise exception 'Direct receipt write';exception when insufficient_privilege then null;end;
 begin perform public.refund_webhook_backend('claim','{}');raise exception 'Unsigned browser webhook write';exception when insufficient_privilege then null;end;
 begin perform public.refund_receipt_backend((f->>'owner')::uuid,(f->>'payment')::uuid,'{}');raise exception 'Browser canonical fact';exception when insufficient_privilege then null;end;
end $$;
reset role;
do $$declare f jsonb;v jsonb;o jsonb;t jsonb;e jsonb;x jsonb;before bigint;begin
 select z.f into f from reconciliation_test z;
 v:=public.refund_financial((f->>'parent')::uuid);o:=v->'operations'->0;t:=v->'attempts'->0;
 begin update public.refund_financial_attempts set request_id=gen_random_uuid() where id=(t->>'id')::uuid;raise exception 'Changed identity';exception when sqlstate 'PT409' then null;end;
 begin insert into public.refund_financial_attempts(operation_id,settlement_id,project_id,owner_id,payload,payload_sha256) select operation_id,settlement_id,project_id,owner_id,payload,payload_sha256 from public.refund_financial_attempts where id=(t->>'id')::uuid;raise exception 'Two active attempts';exception when unique_violation then null;end;
 select jsonb_build_object('refund_id','EXTERNAL-ONE','capture_id',p.capture_id,'currency','USD','amount_minor',10000,'status','completed','canonical',true) into e from public.project_received_payments p where p.id=(o->>'payment_id')::uuid;
 x:=public.refund_receipt_backend((f->>'owner')::uuid,(o->>'payment_id')::uuid,e);
 before:=private.refund_previous((o->>'payment_id')::uuid);
 perform public.refund_receipt_backend((f->>'owner')::uuid,(o->>'payment_id')::uuid,e);
 if before<>10000 or private.refund_previous((o->>'payment_id')::uuid)<>10000 then raise exception 'Receipt double counted';end if;
 if private.refund_applied((o->>'id')::uuid)<>0 then raise exception 'External refund silently applied';end if;
 perform public.refund_receipt_backend((f->>'owner')::uuid,(o->>'payment_id')::uuid,e||'{"status":"pending"}');
 if not exists(select 1 from public.refund_provider_receipts where id=(x->>'receipt_id')::uuid and status='completed') then raise exception 'Stale event degraded money';end if;
 e:=jsonb_build_object('environment','sandbox','app_id','TESTAPP','listener_id','TESTLISTENER','event_id','TESTEVENT','payload_sha256',repeat('a',64),'payload','{}'::jsonb);
 x:=public.refund_webhook_backend('claim',e);
 if not(x ? 'claim_id') then raise exception 'No durable claim';end if;
 if public.refund_webhook_backend('claim',e)->>'busy'<>'true' then raise exception 'Parallel claim';end if;
 perform public.refund_webhook_backend('finish',x||'{"status":"processed"}');
 if public.refund_webhook_backend('claim',e)->>'duplicate'<>'true' then raise exception 'No dedupe';end if;
 if public.refund_webhook_backend('claim',e||jsonb_build_object('payload_sha256',repeat('b',64)))->>'conflict'<>'true' then raise exception 'Poisoned event overwritten';end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
do $$begin
 if exists(select 1 from public.refund_provider_receipts) or exists(select 1 from public.refund_receipt_applications) then raise exception 'Foreign receipts exposed';end if;
end $$;
rollback;
