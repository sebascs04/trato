begin;
create function private.refund_webhook_backend(p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
<<command>>
declare w private.refund_webhook_inbox;p public.project_received_payments;result jsonb;begin
 if p_action='claim' then
  if p_data->>'environment' is distinct from 'sandbox' or length(coalesce(p_data->>'app_id','')) not between 1 and 256 or length(coalesce(p_data->>'listener_id','')) not between 1 and 128
   or length(coalesce(p_data->>'event_id','')) not between 1 and 128 or p_data->>'payload_sha256' !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_data->'payload') is distinct from 'object' then raise sqlstate 'PT422' using message='INVALID_REFUND_WEBHOOK';end if;
  insert into private.refund_webhook_inbox(environment,app_id,listener_id,event_id,payload_sha256,payload) values('sandbox',p_data->>'app_id',p_data->>'listener_id',p_data->>'event_id',p_data->>'payload_sha256',p_data->'payload') on conflict do nothing;
  select * into w from private.refund_webhook_inbox where environment='sandbox' and app_id=p_data->>'app_id' and listener_id=p_data->>'listener_id' and event_id=p_data->>'event_id' for update;
  if w.payload_sha256<>p_data->>'payload_sha256' or w.status='conflict' then
   update private.refund_webhook_inbox set status='conflict',error_code='REFUND_WEBHOOK_ID_CONFLICT',updated_at=now() where id=w.id;
   return jsonb_build_object('conflict',true);
  end if;
  if w.status in('processed','ignored') then return jsonb_build_object('duplicate',true);end if;
  if w.status='processing' and w.claimed_at>now()-interval '60 seconds' then return jsonb_build_object('busy',true);end if;
  update private.refund_webhook_inbox set status='processing',claim_id=gen_random_uuid(),claimed_at=now(),attempts=attempts+1,updated_at=now() where id=w.id returning * into w;
  return jsonb_build_object('id',w.id,'claim_id',w.claim_id);
 elsif p_action='finish' then
  if p_data->>'status' is null or p_data->>'status' not in('processed','ignored','retryable') then raise sqlstate 'PT422' using message='INVALID_REFUND_WEBHOOK';end if;
  update private.refund_webhook_inbox set status=p_data->>'status',error_code=p_data->>'error_code',updated_at=now() where id=(p_data->>'id')::uuid and claim_id=(p_data->>'claim_id')::uuid and status='processing';
  if not found then raise sqlstate 'PT409' using message='REFUND_WEBHOOK_CLAIM_CONFLICT';end if;
  return jsonb_build_object('recorded',true);
 elsif p_action='lookup' then
  select q.* into p from public.project_received_payments q join public.projects z on z.id=q.project_id join public.clients c on c.id=z.client_id
  join auth.users u on u.id=q.owner_id where q.capture_id=p_data->>'capture_id' and q.merchant_id=p_data->>'merchant_id'
  and z.deleted_at is null and c.deleted_at is null and u.deleted_at is null and not coalesce(u.is_anonymous,false);
  if not found then return jsonb_build_object('found',false);end if;
  return jsonb_build_object('found',true,'payment',to_jsonb(p)||jsonb_build_object('expected_reference',case when p.origin='initial' then 'initial-'||p.project_id::text else p.proposal_payment_id::text end),
   'attempts',coalesce((select jsonb_agg(to_jsonb(a)) from public.refund_financial_attempts a join public.refund_financial_operations o on o.id=a.operation_id where o.payment_id=p.id),'[]'));
 elsif p_action='candidates' then
  select * into p from public.project_received_payments where id=(p_data->>'payment_id')::uuid and owner_id=(p_data->>'owner_id')::uuid;
  if not found then raise sqlstate 'PT404' using message='REFUND_PAYMENT_NOT_FOUND';end if;
  perform private.ensure_active_project(p.project_id,p.owner_id);
  -- These are hints, never proof: every result must still pass a canonical GET.
  select coalesce(jsonb_agg(v),'[]') into result from (
   select distinct x.refund_id as v from public.refund_provider_receipts x where x.payment_id=p.id
   union select wh.payload->'resource'->>'id' from private.refund_webhook_inbox wh where wh.environment='sandbox'
    and wh.app_id=p_data->>'app_id' and wh.listener_id=p_data->>'listener_id' and wh.status<>'conflict' and wh.payload->>'resource_type'='refund'
    and wh.payload->'resource'->'supplementary_data'->'related_ids'->>'capture_id'=p.capture_id
  ) q;
  return jsonb_build_object('refund_ids',result);
 elsif p_action='reversal' then
  select * into p from public.project_received_payments where id=(p_data->>'payment_id')::uuid and owner_id=(p_data->>'owner_id')::uuid;
  if not found then raise sqlstate 'PT404' using message='REFUND_PAYMENT_NOT_FOUND';end if;
  perform private.ensure_active_project(p.project_id,p.owner_id);
  perform 1 from public.projects where id=p.project_id for update;
  insert into public.refund_financial_incidents(payment_id,project_id,owner_id,code,reference) values(p.id,p.project_id,p.owner_id,'PAYPAL_CAPTURE_REVERSED',p.capture_id) on conflict do nothing;
  return jsonb_build_object('recorded',true);
 end if;
 raise sqlstate 'PT422' using message='INVALID_REFUND_ACTION';
end $$;
create function public.refund_webhook_backend(p_action text,p_data jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.refund_webhook_backend(p_action,p_data)$$;
revoke all on function private.refund_webhook_backend(text,jsonb),public.refund_webhook_backend(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.refund_webhook_backend(text,jsonb),public.refund_webhook_backend(text,jsonb) to service_role;
commit;

-- Existing command recovery also resolves recovery consents to current financial truth.
begin;
alter function private.refund_command_result(uuid,text) rename to refund_command_result_v5;
create function private.refund_command_result(p_project_id uuid,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();c public.refund_recovery_consents;begin
 if actor is null or not exists(select 1 from auth.users where id=actor and deleted_at is null and not coalesce(is_anonymous,false)) then raise sqlstate 'PT401' using message='UNAUTHORIZED';end if;
 if p_key is null or p_key !~ '^[!-~]{1,128}$' then raise sqlstate 'PT422' using message='INVALID_IDEMPOTENCY_KEY';end if;
 perform private.ensure_active_project(p_project_id,actor);
 select * into c from public.refund_recovery_consents where owner_id=actor and project_id=p_project_id and operation_key=p_key;
 if found then return jsonb_build_object('state','confirmed','result',private.refund_financial_view(actor,c.settlement_id));end if;
 return private.refund_command_result_v5(p_project_id,p_key);
end $$;
revoke all on function private.refund_command_result(uuid,text),private.refund_command_result_v5(uuid,text) from public,anon,authenticated,service_role;
grant execute on function private.refund_command_result(uuid,text) to authenticated;
commit;
