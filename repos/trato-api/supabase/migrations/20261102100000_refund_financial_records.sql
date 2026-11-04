begin;
create table public.refund_financial_checks (
 id uuid primary key default gen_random_uuid(), settlement_id uuid not null,snapshot_id uuid not null,project_id uuid not null,owner_id uuid not null,
 snapshot_sha256 text not null,artifact_sha256 text not null,evidence jsonb not null,policy jsonb not null,digest text not null,
 created_at timestamptz not null default now(),expires_at timestamptz not null,
 unique(id,snapshot_id,settlement_id,project_id,owner_id),
 foreign key(snapshot_id,settlement_id,project_id,owner_id) references public.refund_snapshots(id,settlement_id,project_id,owner_id),
 check(jsonb_typeof(evidence)='array'),check(digest ~ '^[a-f0-9]{64}$'),check(expires_at>created_at)
);
create table public.refund_financial_authorizations (
 id uuid primary key default gen_random_uuid(),settlement_id uuid not null,snapshot_id uuid not null unique,project_id uuid not null,owner_id uuid not null,
 check_id uuid not null,reviewer_id uuid not null references auth.users(id),notes text not null,amount_minor bigint not null check(amount_minor between 1 and 99999999999),
 snapshot_sha256 text not null,artifact_sha256 text not null,created_at timestamptz not null default now(),
 unique(id,settlement_id,project_id,owner_id),
 foreign key(check_id,snapshot_id,settlement_id,project_id,owner_id) references public.refund_financial_checks(id,snapshot_id,settlement_id,project_id,owner_id)
);
create table public.refund_financial_operations (
 id uuid primary key default gen_random_uuid(),authorization_id uuid not null,settlement_id uuid not null,project_id uuid not null,owner_id uuid not null,payment_id uuid not null,
 sequence_no integer not null check(sequence_no>0),amount_minor bigint not null check(amount_minor between 1 and 99999999999),
 status text not null default 'reserved' check(status in('reserved','dispatching','uncertain','pending','completed','failed','cancelled')),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(authorization_id,payment_id),unique(authorization_id,sequence_no),unique(id,settlement_id,project_id,owner_id),
 foreign key(authorization_id,settlement_id,project_id,owner_id) references public.refund_financial_authorizations(id,settlement_id,project_id,owner_id),
 foreign key(settlement_id,payment_id) references public.refund_settlement_payments(settlement_id,payment_id),
 foreign key(payment_id,project_id,owner_id) references public.project_received_payments(id,project_id,owner_id)
);
create index refund_financial_reserved_idx on public.refund_financial_operations(payment_id,status);
create table public.refund_financial_attempts (
 id uuid primary key default gen_random_uuid(),operation_id uuid not null unique,settlement_id uuid not null,project_id uuid not null,owner_id uuid not null,
 request_id uuid not null unique default gen_random_uuid(),payload jsonb not null,payload_sha256 text not null,
 dispatched_at timestamptz,provider_refund_id text unique,error_code text,provider_status text,verified_at timestamptz,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 foreign key(operation_id,settlement_id,project_id,owner_id) references public.refund_financial_operations(id,settlement_id,project_id,owner_id),
 check(payload_sha256 ~ '^[a-f0-9]{64}$')
);
create table public.refund_financial_runs (
 id uuid primary key default gen_random_uuid(),authorization_id uuid not null,settlement_id uuid not null,project_id uuid not null,owner_id uuid not null,
 status text not null default 'running' check(status in('running','finished')),created_at timestamptz not null default now(),finished_at timestamptz,
 foreign key(authorization_id,settlement_id,project_id,owner_id) references public.refund_financial_authorizations(id,settlement_id,project_id,owner_id)
);
create unique index refund_one_financial_run on public.refund_financial_runs(authorization_id) where status='running';
create table public.refund_financial_observations (
 id uuid primary key default gen_random_uuid(),operation_id uuid not null,settlement_id uuid not null,project_id uuid not null,owner_id uuid not null,
 status text not null,evidence jsonb not null,created_at timestamptz not null default now(),
 foreign key(operation_id,settlement_id,project_id,owner_id) references public.refund_financial_operations(id,settlement_id,project_id,owner_id)
);
do $$declare t text;begin
 foreach t in array array['refund_financial_checks','refund_financial_authorizations','refund_financial_operations','refund_financial_attempts','refund_financial_runs','refund_financial_observations'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy own_financial_refund on public.%I for select to authenticated using(exists(select 1 from public.refund_settlements r where r.id=settlement_id and r.owner_id=(select auth.uid())))',t);
  execute format('create index %I on public.%I(settlement_id,project_id,owner_id)',t||'_parent_idx',t);
  if t in('refund_financial_checks','refund_financial_authorizations','refund_financial_observations') then
   execute format('create trigger immutable_financial_record before update or delete on public.%I for each row execute function private.refund_immutable()',t);
  end if;
 end loop;
end $$;
-- Count confirmed per-capture results even when another member keeps the parent pending.
create or replace function private.refund_previous(p_payment uuid) returns bigint language sql stable security definer set search_path='' as $$
 select coalesce((select sum(amount_minor) from public.refund_financial_operations where payment_id=p_payment and status='completed'),0)
 +coalesce((select sum(case when r.scope='payment_only' then r.confirmed_refund_minor else (a.value->>'refund_minor')::bigint end)
 from public.refund_settlements r left join public.refund_snapshots s on s.id=r.current_snapshot_id
 left join lateral jsonb_array_elements(case when r.scope='project_closure' then s.payments else '[{}]'::jsonb end) a on true
 where r.status='completed' and not exists(select 1 from public.refund_financial_authorizations f where f.settlement_id=r.id)
 and ((r.scope='payment_only' and r.payment_id=p_payment) or (r.scope='project_closure' and a.value->>'payment_id'=p_payment::text))),0);
$$;
create function private.refund_reserved(p_payment uuid) returns bigint language sql stable security definer set search_path='' as $$
 select coalesce(sum(amount_minor),0)::bigint from public.refund_financial_operations
 where payment_id=p_payment and status in('reserved','dispatching','uncertain','pending');
$$;
create function private.refund_financial_payments(r public.refund_settlements,s public.refund_snapshots) returns jsonb
language sql stable security definer set search_path='' as $$
 select case when jsonb_array_length(s.payments)>0 then s.payments else
 (select jsonb_build_array(jsonb_build_object('payment_id',p.id,'origin',p.origin,'capture_id',p.capture_id,'merchant_id',p.merchant_id,'currency',p.currency,
 'amount_minor',p.amount_minor,'local_previous_refunds_minor',(s.breakdown->>'local_previous_refunds_minor')::bigint,'refund_minor',(s.breakdown->>'refund_minor')::bigint))
 from public.project_received_payments p where p.id=r.payment_id and r.scope='payment_only') end;
$$;
create function private.refund_financial_view(p_owner uuid,p_parent uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r public.refund_settlements;begin
 select * into r from public.refund_settlements where id=p_parent and owner_id=p_owner;
 if not found then raise sqlstate 'PT404' using message='REFUND_NOT_FOUND';end if;
 perform private.ensure_active_project(r.project_id,p_owner);
 return jsonb_build_object('settlement',to_jsonb(r),
 'authorizations',coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at) from public.refund_financial_authorizations a where a.settlement_id=r.id),'[]'),
 'operations',coalesce((select jsonb_agg(to_jsonb(o) order by o.sequence_no) from public.refund_financial_operations o where o.settlement_id=r.id),'[]'),
 'attempts',coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at) from public.refund_financial_attempts a where a.settlement_id=r.id),'[]'),
 'runs',coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at) from public.refund_financial_runs a where a.settlement_id=r.id),'[]'),
 'confirmed_minor',coalesce((select sum(amount_minor) from public.refund_financial_operations where settlement_id=r.id and status='completed'),r.confirmed_refund_minor,0),
 'reserved_minor',coalesce((select sum(amount_minor) from public.refund_financial_operations where settlement_id=r.id and status in('reserved','dispatching','uncertain','pending')),0));
end $$;
create function public.refund_financial(p_settlement_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from auth.users where id=auth.uid() and deleted_at is null and not coalesce(is_anonymous,false)) then raise sqlstate 'PT401' using message='UNAUTHORIZED';end if;
 return private.refund_financial_view(auth.uid(),p_settlement_id);
end $$;
revoke all on function private.refund_reserved(uuid),private.refund_financial_payments(public.refund_settlements,public.refund_snapshots),private.refund_financial_view(uuid,uuid),public.refund_financial(uuid) from public,anon,authenticated;
grant execute on function public.refund_financial(uuid) to authenticated;
commit;
