begin;
-- Immutable attempt identities survive retries. A coordination revision fences handlers,
-- never the financial facts returned by the provider.
alter table public.refund_financial_attempts drop constraint refund_financial_attempts_operation_id_key;
alter table public.refund_financial_attempts add column amount_minor bigint;
alter table public.refund_financial_attempts add column attempt_no integer not null default 1 check(attempt_no>0);
alter table public.refund_financial_attempts add unique(operation_id,attempt_no);
alter table public.refund_financial_attempts add column status text not null default 'reserved' check(status in('reserved','dispatching','uncertain','pending','completed','failed','cancelled'));
alter table public.refund_financial_attempts add column revision bigint not null default 0;
alter table public.refund_financial_attempts add column replay_in_progress boolean not null default false;
update public.refund_financial_attempts t set amount_minor=o.amount_minor,status=o.status from public.refund_financial_operations o where o.id=t.operation_id;
alter table public.refund_financial_attempts alter column amount_minor set not null;
alter table public.refund_financial_attempts add check(amount_minor between 1 and 99999999999);
create unique index refund_one_active_attempt on public.refund_financial_attempts(operation_id) where status in('reserved','dispatching','uncertain','pending');
create function private.refund_attempt_identity() returns trigger language plpgsql set search_path='' as $$begin
 if TG_OP='INSERT' then
  if new.amount_minor is null then select amount_minor into new.amount_minor from public.refund_financial_operations where id=new.operation_id;end if;
 elsif (to_jsonb(new)-array['status','revision','replay_in_progress','dispatched_at','provider_refund_id','error_code','provider_status','verified_at','updated_at'])
  is distinct from (to_jsonb(old)-array['status','revision','replay_in_progress','dispatched_at','provider_refund_id','error_code','provider_status','verified_at','updated_at'])
  or old.dispatched_at is not null and new.dispatched_at is distinct from old.dispatched_at
  or old.provider_refund_id is not null and new.provider_refund_id is distinct from old.provider_refund_id then
  raise sqlstate 'PT409' using message='REFUND_ATTEMPT_IMMUTABLE';
 end if;return new;
end $$;
create trigger refund_attempt_identity before insert or update on public.refund_financial_attempts for each row execute function private.refund_attempt_identity();
create table public.refund_provider_receipts(
 id uuid primary key default gen_random_uuid(),environment text not null default 'sandbox' check(environment='sandbox'),merchant_id text not null,refund_id text not null,
 payment_id uuid not null,project_id uuid not null,owner_id uuid not null,capture_id text not null,currency text not null check(currency='USD'),amount_minor bigint not null check(amount_minor>0),
 status text not null check(status in('completed','pending','failed','cancelled')),evidence jsonb not null,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),confirmed_at timestamptz,
 unique(environment,merchant_id,refund_id),unique(id,project_id,owner_id),
 foreign key(payment_id,project_id,owner_id) references public.project_received_payments(id,project_id,owner_id)
);
create table public.refund_receipt_applications(
 id uuid primary key default gen_random_uuid(),receipt_id uuid not null unique,operation_id uuid not null,attempt_id uuid references public.refund_financial_attempts(id),
 settlement_id uuid not null,project_id uuid not null,owner_id uuid not null,reviewer_id uuid references auth.users(id),notes text,created_at timestamptz not null default now(),
 foreign key(receipt_id,project_id,owner_id) references public.refund_provider_receipts(id,project_id,owner_id),
 foreign key(operation_id,settlement_id,project_id,owner_id) references public.refund_financial_operations(id,settlement_id,project_id,owner_id)
);
create table public.refund_financial_incidents(
 id uuid primary key default gen_random_uuid(),payment_id uuid not null,project_id uuid not null,owner_id uuid not null,code text not null,reference text not null,
 created_at timestamptz not null default now(),unique(payment_id,code,reference),
 foreign key(payment_id,project_id,owner_id) references public.project_received_payments(id,project_id,owner_id)
);
create table public.refund_recovery_checks(
 id uuid primary key default gen_random_uuid(),operation_id uuid not null,attempt_id uuid not null references public.refund_financial_attempts(id),attempt_revision bigint not null,
 settlement_id uuid not null,snapshot_id uuid not null,project_id uuid not null,owner_id uuid not null,amount_minor bigint not null,evidence jsonb not null,digest text not null,
 created_at timestamptz not null default now(),expires_at timestamptz not null,
 foreign key(operation_id,settlement_id,project_id,owner_id) references public.refund_financial_operations(id,settlement_id,project_id,owner_id),
 foreign key(snapshot_id,settlement_id,project_id,owner_id) references public.refund_snapshots(id,settlement_id,project_id,owner_id)
);
create table public.refund_recovery_consents(
 id uuid primary key default gen_random_uuid(),operation_id uuid not null,attempt_id uuid not null references public.refund_financial_attempts(id),
 settlement_id uuid not null,snapshot_id uuid not null,project_id uuid not null,owner_id uuid not null,reviewer_id uuid not null references auth.users(id),
 action text not null check(action in('replay','external_apply','retry')),operation_key text not null,request_hash text not null,notes text not null,details jsonb not null,
 created_at timestamptz not null default now(),unique(owner_id,operation_key),
 foreign key(operation_id,settlement_id,project_id,owner_id) references public.refund_financial_operations(id,settlement_id,project_id,owner_id),
 foreign key(snapshot_id,settlement_id,project_id,owner_id) references public.refund_snapshots(id,settlement_id,project_id,owner_id)
);
create table private.refund_webhook_inbox(
 id uuid primary key default gen_random_uuid(),environment text not null check(environment='sandbox'),app_id text not null,listener_id text not null,event_id text not null,
 payload_sha256 text not null,payload jsonb not null,status text not null default 'received' check(status in('received','processing','retryable','processed','ignored','conflict')),
 claim_id uuid,claimed_at timestamptz,attempts integer not null default 0,error_code text,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(environment,app_id,listener_id,event_id),check(payload_sha256 ~ '^[a-f0-9]{64}$')
);
revoke all on private.refund_webhook_inbox from public,anon,authenticated,service_role;
-- Backfill known canonical successes, retaining the original attempt and application.
insert into public.refund_provider_receipts(merchant_id,refund_id,payment_id,project_id,owner_id,capture_id,currency,amount_minor,status,evidence,confirmed_at)
 select p.merchant_id,t.provider_refund_id,p.id,p.project_id,p.owner_id,p.capture_id,p.currency,t.amount_minor,lower(t.provider_status),
 jsonb_build_object('source','tanda5','attempt_id',t.id),coalesce(t.verified_at,t.updated_at)
 from public.refund_financial_attempts t join public.refund_financial_operations o on o.id=t.operation_id join public.project_received_payments p on p.id=o.payment_id
 where t.provider_refund_id is not null and t.provider_status in('COMPLETED','PENDING','FAILED','CANCELLED');
insert into public.refund_receipt_applications(receipt_id,operation_id,attempt_id,settlement_id,project_id,owner_id)
 select x.id,o.id,t.id,o.settlement_id,o.project_id,o.owner_id from public.refund_provider_receipts x
 join public.refund_financial_attempts t on t.provider_refund_id=x.refund_id join public.refund_financial_operations o on o.id=t.operation_id where x.status='completed';
-- A legacy aggregate without an attributable receipt is preserved and explicitly blocked.
insert into public.refund_financial_incidents(payment_id,project_id,owner_id,code,reference)
 select distinct m.payment_id,r.project_id,r.owner_id,'REFUND_LEGACY_RECONCILIATION_REQUIRED',r.id::text
 from public.refund_settlements r join public.refund_settlement_payments m on m.settlement_id=r.id
 where r.status='completed' and (not exists(select 1 from public.refund_financial_authorizations a where a.settlement_id=r.id)
 or exists(select 1 from public.refund_financial_operations o where o.settlement_id=r.id and o.status='completed' and not exists(select 1 from public.refund_receipt_applications a where a.operation_id=o.id))) on conflict do nothing;
do $$declare t text;begin
 foreach t in array array['refund_provider_receipts','refund_receipt_applications','refund_financial_incidents','refund_recovery_checks','refund_recovery_consents'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy own_refund_recovery on public.%I for select to authenticated using(owner_id=(select auth.uid()) and exists(select 1 from public.projects p join public.clients c on c.id=p.client_id where p.id=project_id and p.owner_id=(select auth.uid()) and p.deleted_at is null and c.deleted_at is null))',t);
  execute format('create index %I on public.%I(project_id,owner_id)',t||'_project_idx',t);
  if t<>'refund_provider_receipts' then execute format('create trigger immutable_refund_recovery before update or delete on public.%I for each row execute function private.refund_immutable()',t);end if;
 end loop;
end $$;
create function private.refund_applied(p_operation uuid) returns bigint language sql stable security definer set search_path='' as $$
 select coalesce(sum(r.amount_minor),0)::bigint from public.refund_receipt_applications a join public.refund_provider_receipts r on r.id=a.receipt_id where a.operation_id=p_operation and r.status='completed';
$$;
-- Keep pre-ledger aggregate evidence. Never guess a link to an external receipt.
alter function private.refund_previous(uuid) rename to refund_previous_v5;
create function private.refund_previous(p_payment uuid) returns bigint language sql stable security definer set search_path='' as $$
 select private.refund_previous_v5(p_payment)
 -coalesce((select sum(o.amount_minor) from public.refund_financial_operations o where o.payment_id=p_payment and o.status='completed'),0)
 +coalesce((select sum(r.amount_minor) from public.refund_provider_receipts r where r.payment_id=p_payment and r.status='completed'),0)
 +coalesce((select sum(o.amount_minor) from public.refund_financial_operations o where o.payment_id=p_payment and o.status='completed' and not exists(select 1 from public.refund_receipt_applications a where a.operation_id=o.id)),0);
$$;
create or replace function private.refund_reserved(p_payment uuid) returns bigint language sql stable security definer set search_path='' as $$
 select coalesce((select sum(greatest(o.amount_minor-private.refund_applied(o.id),0)) from public.refund_financial_operations o
 where o.payment_id=p_payment and o.status in('reserved','dispatching','uncertain','pending')),0)
 +coalesce((select sum(r.amount_minor) from public.refund_provider_receipts r where r.payment_id=p_payment and r.status='pending'
 and not exists(select 1 from public.refund_financial_attempts t join public.refund_financial_operations o on o.id=t.operation_id where t.provider_refund_id=r.refund_id and o.payment_id=p_payment and t.status in('dispatching','uncertain','pending'))),0);
$$;
alter function private.refund_financial_view(uuid,uuid) rename to refund_financial_view_v5;
create function private.refund_financial_view(p_owner uuid,p_parent uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select private.refund_financial_view_v5(p_owner,p_parent)||jsonb_build_object(
 'attempts',coalesce((select jsonb_agg(to_jsonb(a) order by a.operation_id,a.attempt_no) from public.refund_financial_attempts a where a.settlement_id=p_parent and a.owner_id=p_owner),'[]'),
 'receipts',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at,x.id) from public.refund_provider_receipts x where x.owner_id=p_owner and x.payment_id in(select payment_id from public.refund_settlement_payments where settlement_id=p_parent)),'[]'),
 'applications',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at,x.id) from public.refund_receipt_applications x where x.settlement_id=p_parent and x.owner_id=p_owner),'[]'),
 'incidents',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at,x.id) from public.refund_financial_incidents x where x.owner_id=p_owner and x.payment_id in(select payment_id from public.refund_settlement_payments where settlement_id=p_parent)),'[]'),
 'recovery_consents',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at,x.id) from public.refund_recovery_consents x where x.settlement_id=p_parent and x.owner_id=p_owner),'[]'),
 'confirmed_minor',case when exists(select 1 from public.refund_financial_operations where settlement_id=p_parent) then coalesce((select sum(private.refund_applied(o.id)+case when o.status='completed' and not exists(select 1 from public.refund_receipt_applications a where a.operation_id=o.id) then o.amount_minor else 0 end) from public.refund_financial_operations o where o.settlement_id=p_parent),0) else coalesce((select confirmed_refund_minor from public.refund_settlements where id=p_parent and owner_id=p_owner),0) end,
 'reserved_minor',coalesce((select sum(greatest(o.amount_minor-private.refund_applied(o.id),0)) from public.refund_financial_operations o where o.settlement_id=p_parent and o.status in('reserved','dispatching','uncertain','pending')),0));
$$;
revoke all on function private.refund_attempt_identity(),private.refund_applied(uuid),private.refund_previous(uuid),private.refund_previous_v5(uuid),private.refund_financial_view(uuid,uuid),private.refund_financial_view_v5(uuid,uuid) from public,anon,authenticated,service_role;
commit;
