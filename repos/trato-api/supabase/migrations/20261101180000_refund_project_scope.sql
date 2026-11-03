begin;
-- Received-money registry: verified initial captures + immutable references to paid changes.
create table public.project_received_payments(
 id uuid primary key default gen_random_uuid(),owner_id uuid not null,project_id uuid not null,
 origin text not null check(origin in('initial','change')),proposal_payment_id uuid unique,
 capture_id text not null unique,order_id text,merchant_id text not null,
 amount_minor bigint not null check(amount_minor between 1 and 99999999999),currency text not null check(currency='USD'),
 verified_at timestamptz not null,registered_at timestamptz not null default now(),
 evidence jsonb,review_notes text,
 unique(id,project_id,owner_id),foreign key(project_id,owner_id) references public.projects(id,owner_id),
 foreign key(proposal_payment_id,project_id,owner_id) references public.proposal_payments(id,project_id,owner_id),
 check((origin='change')=(proposal_payment_id is not null))
);
create index received_project_idx on public.project_received_payments(owner_id,project_id,registered_at);
alter table public.project_received_payments enable row level security;
revoke all on public.project_received_payments from public,anon,authenticated;
grant select on public.project_received_payments to authenticated;
create policy received_own_active on public.project_received_payments for select to authenticated
 using(owner_id=(select auth.uid()) and exists(select 1 from public.projects p join public.clients c on c.id=p.client_id and c.owner_id=p.owner_id where p.id=project_received_payments.project_id and p.owner_id=project_received_payments.owner_id and p.deleted_at is null and c.deleted_at is null));
create function private.received_change_payment() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='completed' and nullif(trim(new.capture_id),'') is not null then
  insert into public.project_received_payments(id,owner_id,project_id,origin,proposal_payment_id,capture_id,order_id,merchant_id,amount_minor,currency,verified_at)
  values(new.id,new.owner_id,new.project_id,'change',new.id,new.capture_id,new.order_id,new.merchant_id,new.amount_minor,new.currency,new.updated_at)
  on conflict(id) do nothing;
 end if;
 return new;
end $$;
revoke all on function private.received_change_payment() from public,anon,authenticated;
create trigger received_change_payment after insert or update on public.proposal_payments for each row execute function private.received_change_payment();
insert into public.project_received_payments(id,owner_id,project_id,origin,proposal_payment_id,capture_id,order_id,merchant_id,amount_minor,currency,verified_at)
select id,owner_id,project_id,'change',id,capture_id,order_id,merchant_id,amount_minor,currency,updated_at from public.proposal_payments where status='completed' and nullif(trim(capture_id),'') is not null;
create trigger received_payment_immutable before update or delete on public.project_received_payments for each row execute function private.refund_immutable();
-- Preserve old paid records, replacing only the refund's reference constraint.
do $$declare fk text;begin
 select conname into fk from pg_constraint where conrelid='public.refund_settlements'::regclass and confrelid='public.proposal_payments'::regclass and contype='f';
 execute format('alter table public.refund_settlements drop constraint %I',fk);
end $$;
alter table public.refund_settlements add foreign key(payment_id,project_id,owner_id) references public.project_received_payments(id,project_id,owner_id);
alter table public.refund_settlements drop constraint refund_settlements_scope_check;
alter table public.refund_settlements add check(scope in('payment_only','project_closure'));
create table public.refund_settlement_payments(
 settlement_id uuid not null,payment_id uuid not null,project_id uuid not null,owner_id uuid not null,
 primary key(settlement_id,payment_id),foreign key(settlement_id,project_id,owner_id) references public.refund_settlements(id,project_id,owner_id),
 foreign key(payment_id,project_id,owner_id) references public.project_received_payments(id,project_id,owner_id)
);
create index refund_payment_parent_idx on public.refund_settlement_payments(payment_id,project_id,owner_id);
insert into public.refund_settlement_payments select id,payment_id,project_id,owner_id from public.refund_settlements;
alter table public.refund_settlement_payments enable row level security;
revoke all on public.refund_settlement_payments from public,anon,authenticated;
grant select on public.refund_settlement_payments to authenticated;
create policy own_refund_payments on public.refund_settlement_payments for select to authenticated
 using(exists(select 1 from public.refund_settlements r where r.id=settlement_id and r.owner_id=(select auth.uid())));
create trigger refund_payment_membership_immutable before update or delete on public.refund_settlement_payments for each row execute function private.refund_immutable();
alter table public.refund_snapshots add column payments jsonb not null default '[]';
alter table public.refund_snapshots add column feedback jsonb;
alter table public.refund_events drop constraint refund_events_event_type_check;
alter table public.refund_events add check(event_type in('request_registered','draft_saved','rejected','withdrawn','pdf_reviewed','revision_sent','adjustments_requested','acceptance_recorded','closed_without_refund'));
create function private.refund_previous(p_payment uuid) returns bigint language sql stable security definer set search_path='' as $$
 select coalesce(sum(case when r.scope='payment_only' then r.confirmed_refund_minor else (a.value->>'refund_minor')::bigint end),0)::bigint
 from public.refund_settlements r left join public.refund_snapshots s on s.id=r.current_snapshot_id
 left join lateral jsonb_array_elements(case when r.scope='project_closure' then s.payments else '[{}]'::jsonb end) a on true
 where r.status='completed' and ((r.scope='payment_only' and r.payment_id=p_payment) or (r.scope='project_closure' and a.value->>'payment_id'=p_payment::text));
$$;
revoke all on function private.refund_previous(uuid) from public,anon,authenticated;
-- Transaction writers still share the existing project gate.
create or replace function private.project_request_status(p_project_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;active jsonb;begin
 result:=private.project_change_request_status(p_project_id);
 select jsonb_build_object('id',id,'kind','refund','title',reason) into active from public.refund_settlements where project_id=p_project_id and owner_id=auth.uid() and
 (status not in('completed','closed_without_refund','rejected','withdrawn') or (scope='project_closure' and status in('completed','closed_without_refund'))) order by created_at,id limit 1;
 if active is not null then result:=result||jsonb_build_object('can_register',false,'active_request',active);end if;
 if exists(select 1 from public.projects where id=p_project_id and owner_id=auth.uid() and status='closed') then result:=result||jsonb_build_object('can_register',false);end if;
 return result;
end $$;
create function private.refund_payments(p_project_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform private.ensure_active_project(p_project_id,auth.uid());
 return coalesce((select jsonb_agg(jsonb_build_object('id',q.id,'origin',q.origin,'amount_minor',q.amount_minor,'currency',q.currency,'updated_at',q.verified_at,'local_previous_refunds_minor',private.refund_previous(q.id)) order by q.verified_at,q.id) from public.project_received_payments q where q.project_id=p_project_id and q.owner_id=auth.uid()),'[]'::jsonb);
end $$;
create function public.refund_payments(p_project_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.refund_payments(p_project_id)$$;
revoke all on function private.refund_payments(uuid),public.refund_payments(uuid) from public,anon;
grant execute on function private.refund_payments(uuid),public.refund_payments(uuid) to authenticated;
create function private.refund_can_register(p_project uuid,p_owner uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.projects where id=p_project and owner_id=p_owner and status<>'closed')
 and not exists(select 1 from public.documents d left join public.change_proposals p on p.request_document_id=d.id and p.owner_id=p_owner
  where d.project_id=p_project and d.owner_id=p_owner and d.kind='email_request' and p.locked_at is null
  and not exists(select 1 from public.request_closures c where c.request_document_id=d.id))
 and not exists(select 1 from public.refund_settlements where project_id=p_project and owner_id=p_owner and
  (status not in('completed','closed_without_refund','rejected','withdrawn') or (scope='project_closure' and status in('completed','closed_without_refund'))));
$$;
revoke all on function private.refund_can_register(uuid,uuid) from public,anon,authenticated;
commit;
