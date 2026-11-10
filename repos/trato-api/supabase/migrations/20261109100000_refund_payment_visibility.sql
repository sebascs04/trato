begin;

-- A fully refunded capture is independent of individual PayPal refund receipts.
create table private.refund_full_captures(
 payment_id uuid primary key references public.project_received_payments(id),
 verified_at timestamptz not null default now()
);

create function public.refund_full_capture_backend(p_owner uuid,p_payment uuid,p_capture text)
returns void language plpgsql security definer set search_path='' as $$
declare p public.project_received_payments;
begin
 select * into p from public.project_received_payments
 where id=p_payment and owner_id=p_owner and capture_id=p_capture;
 if not found then raise sqlstate 'PT404' using message='REFUND_PAYMENT_NOT_FOUND'; end if;
 perform private.ensure_active_project(p.project_id,p_owner);
 perform 1 from public.projects where id=p.project_id for update;
 perform 1 from public.project_received_payments where id=p.id for update;
 insert into private.refund_full_captures(payment_id) values(p.id) on conflict do nothing;
end $$;

revoke all on function public.refund_full_capture_backend(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.refund_full_capture_backend(uuid,uuid,text) to service_role;

create or replace function private.refund_previous(p_payment uuid)
returns bigint language sql stable security definer set search_path='' as $$
 select greatest(
  coalesce((select p.amount_minor from private.refund_full_captures f
   join public.project_received_payments p on p.id=f.payment_id where f.payment_id=p_payment),0),
  private.refund_previous_v5(p_payment)
  -coalesce((select sum(o.amount_minor) from public.refund_financial_operations o where o.payment_id=p_payment and o.status='completed'),0)
  +coalesce((select sum(r.amount_minor) from public.refund_provider_receipts r where r.payment_id=p_payment and r.status='completed'),0)
  +coalesce((select sum(o.amount_minor) from public.refund_financial_operations o where o.payment_id=p_payment and o.status='completed'
   and not exists(select 1 from public.refund_receipt_applications a where a.operation_id=o.id)),0)
 )::bigint;
$$;

create or replace function private.refund_payments(p_project_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform private.ensure_active_project(p_project_id,auth.uid());
 return coalesce((select jsonb_agg(jsonb_build_object(
  'id',q.id,'origin',q.origin,'amount_minor',q.amount_minor,'currency',q.currency,'updated_at',q.verified_at,
  'local_previous_refunds_minor',private.refund_previous(q.id),
  'external_refund_minor',greatest(0,least(q.amount_minor,private.refund_previous(q.id))-private.refund_previous_v5(q.id))
 ) order by q.verified_at,q.id) from public.project_received_payments q
 where q.project_id=p_project_id and q.owner_id=auth.uid()),'[]'::jsonb);
end $$;

-- Keep payment acceptance immutable. Expose the independently verified refunded total.
create or replace function public.client_portal_view(p_token_hash text)
returns jsonb language sql stable security definer set search_path='' as $$
 with authorized as materialized (select private.client_portal_view(p_token_hash) as item)
 select item || jsonb_build_object('refunded_minor',coalesce(least(p.amount_minor,private.refund_previous(p.id)),0))
 from authorized
 left join public.proposal_payments pay on pay.revision_id=(item->>'revision_id')::uuid and pay.status='completed'
 left join public.project_received_payments p on p.proposal_payment_id=pay.id;
$$;

create or replace function public.client_account_agreements(p_user uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(item || jsonb_build_object(
  'refunded_minor',coalesce(least(p.amount_minor,private.refund_previous(p.id)),0)
 ) order by position),'[]'::jsonb)
 from jsonb_array_elements(private.client_account_agreements(p_user)) with ordinality as agreements(item,position)
 join public.change_proposals proposal on proposal.id=(item->>'proposal_id')::uuid
 left join public.proposal_payments pay on pay.revision_id=proposal.current_revision_id and pay.status='completed'
 left join public.project_received_payments p on p.proposal_payment_id=pay.id;
$$;

commit;
