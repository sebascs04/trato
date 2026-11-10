begin;
-- The client asks for a refund from their own space: a paid plan stage or a paid addendum. It is a request, never a
-- refund: the freelancer registers it in Refunds (the usual six-step settlement) and only PayPal confirms money back.
create table public.client_refund_requests(
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null,
 project_id uuid not null references public.projects(id),
 received_payment_id uuid not null references public.project_received_payments(id),
 stage_position integer check(stage_position is null or stage_position between 1 and 8),
 proposal_id uuid references public.change_proposals(id),
 client_user_id uuid not null references auth.users(id),
 client_email text not null,
 requested_minor bigint not null check(requested_minor > 0),
 reason text not null check(length(btrim(reason)) between 1 and 4000),
 status text not null default 'open' check(status in ('open','registered')),
 settlement_id uuid references public.refund_settlements(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check((stage_position is null) <> (proposal_id is null)),
 check((status = 'registered') = (settlement_id is not null))
);
-- One open request per payment: a second one waits until the freelancer registers the first.
create unique index client_refund_requests_open_payment on public.client_refund_requests(received_payment_id) where status = 'open';
create index client_refund_requests_project on public.client_refund_requests(project_id, created_at);
alter table public.client_refund_requests enable row level security;
revoke all on public.client_refund_requests from public, anon, authenticated;
grant select on public.client_refund_requests to authenticated;
create policy client_refund_requests_owner_read on public.client_refund_requests for select to authenticated
 using (owner_id = (select auth.uid()));

-- Client side, through the backend: the account must be the project's client (private.client_project), and the payment a
-- verified one of that project, for that stage or addendum, with money still left to refund.
create function public.client_refund_request_create(p_user uuid, p_project uuid, p_stage integer, p_proposal uuid, p_amount bigint, p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare scope record; payment public.project_received_payments; left_minor bigint; item public.client_refund_requests;
begin
 select * into scope from private.client_project(p_user, p_project);
 if not found then raise sqlstate 'PT404' using message='PROJECT_NOT_FOUND'; end if;
 if (p_stage is null) = (p_proposal is null) then raise sqlstate 'PT422' using message='REFUND_REQUEST_TARGET_INVALID'; end if;
 if p_reason is null or length(btrim(p_reason)) not between 1 and 4000 then raise sqlstate 'PT422' using message='REFUND_REQUEST_REASON_REQUIRED'; end if;
 perform 1 from public.projects where id = p_project for update;
 if p_stage is not null then
  select r.* into payment from public.project_initial_checkouts ck
   join public.project_received_payments r on r.id = ck.id and r.origin = 'initial' and r.project_id = ck.project_id
   where ck.project_id = p_project and ck.stage_position = p_stage and ck.status = 'completed';
 else
  select r.* into payment from public.proposal_payments pay
   join public.change_proposals q on q.id = pay.proposal_id and q.project_id = p_project
   join public.project_received_payments r on r.proposal_payment_id = pay.id and r.project_id = p_project
   where pay.proposal_id = p_proposal and pay.status = 'completed' and pay.revision_id = q.current_revision_id;
 end if;
 if not found or payment.owner_id <> scope.owner_id then raise sqlstate 'PT404' using message='REFUND_PAYMENT_NOT_FOUND'; end if;
 left_minor := payment.amount_minor - least(payment.amount_minor, private.refund_previous(payment.id));
 if p_amount is null or p_amount <= 0 or p_amount > left_minor then raise sqlstate 'PT422' using message='REFUND_REQUEST_AMOUNT_INVALID'; end if;
 if exists(select 1 from public.client_refund_requests where received_payment_id = payment.id and status = 'open') then
  raise sqlstate 'PT409' using message='REFUND_REQUEST_ALREADY_OPEN';
 end if;
 insert into public.client_refund_requests(owner_id, project_id, received_payment_id, stage_position, proposal_id, client_user_id, client_email, requested_minor, reason)
  values(scope.owner_id, p_project, payment.id, p_stage, p_proposal, p_user, scope.email, p_amount, btrim(p_reason))
  returning * into item;
 return jsonb_build_object('id', item.id, 'status', item.status, 'requested_minor', item.requested_minor, 'created_at', item.created_at,
  'stage_position', item.stage_position, 'proposal_id', item.proposal_id, 'project_id', item.project_id);
end $$;

-- The client's own requests, with the state of the refund the freelancer registered from them.
create function public.client_refund_requests_for(p_user uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'project_id', x.project_id, 'stage_position', x.stage_position, 'proposal_id', x.proposal_id,
  'requested_minor', x.requested_minor, 'status', x.status, 'refund_status', s.status, 'created_at', x.created_at) order by x.created_at), '[]'::jsonb)
 from public.client_refund_requests x left join public.refund_settlements s on s.id = x.settlement_id
 where x.client_user_id = p_user;
$$;

-- Freelancer side: once the refund is registered in Refunds, the request points to it. Same project and payment only.
create function public.client_refund_request_register(p_request uuid, p_settlement uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid := auth.uid(); item public.client_refund_requests;
begin
 if u is null then raise sqlstate 'PT401' using message='UNAUTHORIZED'; end if;
 select * into item from public.client_refund_requests where id = p_request and owner_id = u for update;
 if not found then raise sqlstate 'PT404' using message='REFUND_REQUEST_NOT_FOUND'; end if;
 if item.status = 'registered' then
  if item.settlement_id = p_settlement then return to_jsonb(item); end if;
  raise sqlstate 'PT409' using message='REFUND_REQUEST_ALREADY_REGISTERED';
 end if;
 if not exists(select 1 from public.refund_settlements s where s.id = p_settlement and s.owner_id = u and s.project_id = item.project_id) then
  raise sqlstate 'PT409' using message='REFUND_REQUEST_SETTLEMENT_MISMATCH';
 end if;
 update public.client_refund_requests set status = 'registered', settlement_id = p_settlement, updated_at = now() where id = item.id returning * into item;
 return to_jsonb(item);
end $$;

revoke all on function public.client_refund_request_create(uuid, uuid, integer, uuid, bigint, text) from public, anon, authenticated;
revoke all on function public.client_refund_requests_for(uuid) from public, anon, authenticated;
revoke all on function public.client_refund_request_register(uuid, uuid) from public, anon;
grant execute on function public.client_refund_request_create(uuid, uuid, integer, uuid, bigint, text) to service_role;
grant execute on function public.client_refund_requests_for(uuid) to service_role;
grant execute on function public.client_refund_request_register(uuid, uuid) to authenticated;
commit;
