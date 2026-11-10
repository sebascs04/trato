begin;

alter table public.refund_provider_receipts
 add column dispute_id text check(dispute_id ~ '^PP-[A-Z0-9-]{4,40}$');

create function public.link_dispute_refund_backend(p_owner uuid,p_project uuid,p_receipt uuid,p_dispute text)
returns void language plpgsql security definer set search_path='' as $$
begin
 update public.refund_provider_receipts r set dispute_id=p_dispute
 where r.id=p_receipt and r.project_id=p_project and r.owner_id=p_owner
   and r.status='completed' and r.confirmed_at is not null
   and (r.dispute_id is null or r.dispute_id=p_dispute)
   and exists(select 1 from public.project_dispute_events d
    where d.project_id=r.project_id and d.owner_id=r.owner_id and d.dispute_id=p_dispute
     and d.kind='dispute_opened' and d.details->>'received_payment_id'=r.payment_id::text);
 if not found then raise sqlstate 'PT409' using message='DISPUTE_REFUND_LINK_MISMATCH'; end if;
end $$;
revoke all on function public.link_dispute_refund_backend(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.link_dispute_refund_backend(uuid,uuid,uuid,text) to service_role;

alter function private.graph_snapshot(uuid,uuid) rename to graph_snapshot_before_dispute_refunds;
create function private.graph_snapshot(p_project uuid,p_owner uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 with base as (select private.graph_snapshot_before_dispute_refunds(p_project,p_owner) as snapshot),
 confirmed as (
  select r.id,d.id as dispute_event_id,r.amount_minor,r.currency,r.confirmed_at
  from public.refund_provider_receipts r
  join public.project_dispute_events d on d.project_id=r.project_id and d.owner_id=r.owner_id
   and d.dispute_id=r.dispute_id and d.kind='dispute_opened'
   and d.details->>'received_payment_id'=r.payment_id::text
  where r.project_id=p_project and r.owner_id=p_owner and r.status='completed' and r.confirmed_at is not null
 )
 select case when base.snapshot->'project'<>'null'::jsonb and exists(select 1 from confirmed) then base.snapshot||jsonb_build_object(
  'dispute_refund_receipts',coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from confirmed r),'[]'::jsonb))
 else base.snapshot end
 from base;
$$;
revoke all on function private.graph_snapshot(uuid,uuid) from public,anon,authenticated;

commit;
