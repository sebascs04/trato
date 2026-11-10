-- a client's refund request is a conversation, like Report a problem. Both write; the freelancer
-- refunds or declines; the client can withdraw it. Once declined or withdrawn, that payment is not asked again: the
-- client goes on with Report a problem, which can escalate. The freelancer's own registration of a request (from Gmail,
-- a PDF) is already the agreement, so the manual flow needs no proposal email or reply either.

alter table public.client_refund_requests drop constraint client_refund_requests_status_check;
alter table public.client_refund_requests add constraint client_refund_requests_status_check check (status in ('open','registered','declined','withdrawn'));
alter table public.client_refund_requests add column if not exists closed_note text check (closed_note is null or length(closed_note) <= 4000),
 add column if not exists closed_by text check (closed_by is null or closed_by in ('client','freelancer')),
 add column if not exists closed_at timestamptz;

create table if not exists public.client_refund_request_messages(
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null references public.client_refund_requests(id) on delete cascade,
 owner_id uuid not null,
 project_id uuid not null,
 author text not null check (author in ('client','freelancer')),
 body text not null check (length(btrim(body)) between 1 and 4000),
 created_at timestamptz not null default now());
create index if not exists client_refund_request_messages_request_idx on public.client_refund_request_messages(request_id, created_at);
alter table public.client_refund_request_messages enable row level security;
drop policy if exists client_refund_request_messages_owner_read on public.client_refund_request_messages;
create policy client_refund_request_messages_owner_read on public.client_refund_request_messages for select to authenticated using (owner_id = auth.uid());
revoke all on public.client_refund_request_messages from anon;
grant select on public.client_refund_request_messages to authenticated;

-- A payment whose request was declined or withdrawn is not asked again from the client's space.
do $$
declare def text;
 old text:=$o$ if exists(select 1 from public.client_refund_requests where received_payment_id = payment.id and status = 'open') then$o$;
 new text:=$n$ if exists(select 1 from public.client_refund_requests where received_payment_id = payment.id and status in ('declined','withdrawn')) then
  raise sqlstate 'PT409' using message='REFUND_REQUEST_CLOSED';
 end if;
 if exists(select 1 from public.client_refund_requests where received_payment_id = payment.id and status = 'open') then$n$;
begin
 def:=pg_get_functiondef('public.client_refund_request_create(uuid,uuid,integer,uuid,bigint,text)'::regprocedure);
 if position('REFUND_REQUEST_CLOSED' in def)>0 then return;end if;
 if position(old in def)=0 then raise exception 'client_refund_request_create changed: open check not found';end if;
 execute replace(def,old,new);
end $$;

-- The client's own view: what they asked, how it ended and the conversation.
create or replace function public.client_refund_requests_for(p_user uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'project_id', x.project_id, 'stage_position', x.stage_position, 'proposal_id', x.proposal_id,
  'requested_minor', x.requested_minor, 'status', x.status, 'refund_status', s.status, 'created_at', x.created_at, 'reason', x.reason,
  'closed_note', x.closed_note, 'closed_by', x.closed_by, 'closed_at', x.closed_at,
  'messages', coalesce((select jsonb_agg(jsonb_build_object('author', m.author, 'body', m.body, 'created_at', m.created_at) order by m.created_at)
   from public.client_refund_request_messages m where m.request_id = x.id), '[]'::jsonb)) order by x.created_at), '[]'::jsonb)
 from public.client_refund_requests x left join public.refund_settlements s on s.id = x.settlement_id
 where x.client_user_id = p_user;
$$;

-- Client: write in their open request, or withdraw it (also before reporting a problem on the same payment).
create or replace function public.client_refund_request_client_message(p_user uuid, p_request uuid, p_body text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare item public.client_refund_requests;
begin
 select * into item from public.client_refund_requests where id=p_request and client_user_id=p_user for update;
 if not found then raise sqlstate 'PT404' using message='REFUND_REQUEST_NOT_FOUND';end if;
 if item.status<>'open' then raise sqlstate 'PT409' using message='REFUND_REQUEST_CLOSED';end if;
 if p_body is null or length(btrim(p_body)) not between 1 and 4000 then raise sqlstate 'PT422' using message='REFUND_REQUEST_MESSAGE_REQUIRED';end if;
 insert into public.client_refund_request_messages(request_id,owner_id,project_id,author,body) values(item.id,item.owner_id,item.project_id,'client',btrim(p_body));
 return public.client_refund_requests_for(p_user);
end $$;

create or replace function public.client_refund_request_withdraw(p_user uuid, p_request uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare item public.client_refund_requests;
begin
 select * into item from public.client_refund_requests where id=p_request and client_user_id=p_user for update;
 if not found then raise sqlstate 'PT404' using message='REFUND_REQUEST_NOT_FOUND';end if;
 if item.status='open' then
  update public.client_refund_requests set status='withdrawn',closed_by='client',closed_at=now(),updated_at=now() where id=item.id;
 elsif item.status<>'withdrawn' then raise sqlstate 'PT409' using message='REFUND_REQUEST_CLOSED';end if;
 return public.client_refund_requests_for(p_user);
end $$;

-- Freelancer: reply, or decline with an optional note. Refunding goes through client_refund_request_settle.
create or replace function public.client_refund_request_reply(p_request uuid, p_body text)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();item public.client_refund_requests;
begin
 select * into item from public.client_refund_requests where id=p_request and owner_id=actor for update;
 if actor is null or not found then raise sqlstate 'PT404' using message='REFUND_REQUEST_NOT_FOUND';end if;
 if item.status<>'open' then raise sqlstate 'PT409' using message='REFUND_REQUEST_CLOSED';end if;
 if p_body is null or length(btrim(p_body)) not between 1 and 4000 then raise sqlstate 'PT422' using message='REFUND_REQUEST_MESSAGE_REQUIRED';end if;
 insert into public.client_refund_request_messages(request_id,owner_id,project_id,author,body) values(item.id,item.owner_id,item.project_id,'freelancer',btrim(p_body));
end $$;

create or replace function public.client_refund_request_decline(p_request uuid, p_note text)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();item public.client_refund_requests;
begin
 select * into item from public.client_refund_requests where id=p_request and owner_id=actor for update;
 if actor is null or not found then raise sqlstate 'PT404' using message='REFUND_REQUEST_NOT_FOUND';end if;
 if item.status='declined' then return;end if;
 if item.status<>'open' then raise sqlstate 'PT409' using message='REFUND_REQUEST_CLOSED';end if;
 if p_note is not null and length(p_note)>4000 then raise sqlstate 'PT422' using message='INVALID_REFUND_INPUT';end if;
 update public.client_refund_requests set status='declined',closed_by='freelancer',closed_note=nullif(btrim(coalesce(p_note,'')),''),closed_at=now(),updated_at=now() where id=item.id;
end $$;

-- Manual flow: registering the request (its evidence) and saving the proposal is the freelancer's agreement to refund.
alter table public.refund_acceptances drop constraint refund_acceptances_method_check;
alter table public.refund_acceptances add constraint refund_acceptances_method_check
 check (method in ('manual_document_review','client_portal_request','freelancer_registered'));

create or replace function public.refund_freelancer_accept(p_settlement uuid, p_snapshot uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();parent public.refund_settlements;snap public.refund_snapshots;artifact public.refund_artifacts;refund bigint;
begin
 if actor is null then raise sqlstate 'PT401' using message='UNAUTHORIZED';end if;
 select * into parent from public.refund_settlements where id=p_settlement and owner_id=actor for update;
 if not found then raise sqlstate 'PT404' using message='REFUND_NOT_FOUND';end if;
 perform private.ensure_active_project(parent.project_id,actor);
 if parent.status not in('draft','awaiting_response') then return jsonb_build_object('settlement',to_jsonb(parent));end if;
 if parent.current_snapshot_id is distinct from p_snapshot then raise sqlstate 'PT409' using message='REFUND_REVISION_CONFLICT';end if;
 select * into snap from public.refund_snapshots where id=p_snapshot;
 select * into artifact from public.refund_artifacts where snapshot_id=snap.id and document_id is not null;
 if not found then raise sqlstate 'PT409' using message='REFUND_PDF_REQUIRED';end if;
 refund:=(snap.breakdown->>'refund_minor')::bigint;
 insert into public.refund_acceptances(snapshot_id,settlement_id,project_id,owner_id,artifact_id,evidence,reviewer_id,review_notes,method)
  values(snap.id,parent.id,parent.project_id,actor,artifact.id,jsonb_build_object('registered_by','freelancer','request_evidence',parent.request_evidence),
   actor,'Registered and agreed by the freelancer.','freelancer_registered')
  on conflict do nothing;
 update public.refund_settlements set status=case when refund=0 then 'closed_without_refund' else 'accepted' end,closed_at=case when refund=0 then now() else null end,updated_at=now()
  where id=parent.id returning * into parent;
 if parent.scope='project_closure' and parent.status='closed_without_refund' then update public.projects set status='closed' where id=parent.project_id;end if;
 insert into public.refund_events(settlement_id,snapshot_id,project_id,owner_id,actor_id,event_type,notes) values(parent.id,snap.id,parent.project_id,actor,actor,'acceptance_recorded','Registered and agreed by the freelancer.');
 return jsonb_build_object('settlement',to_jsonb(parent));
end $$;

revoke all on function public.client_refund_request_client_message(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.client_refund_request_withdraw(uuid,uuid) from public, anon, authenticated;
revoke all on function public.client_refund_requests_for(uuid) from public, anon, authenticated;
revoke all on function public.client_refund_request_reply(uuid,text) from public, anon;
revoke all on function public.client_refund_request_decline(uuid,text) from public, anon;
revoke all on function public.refund_freelancer_accept(uuid,uuid) from public, anon;
grant execute on function public.client_refund_request_client_message(uuid,uuid,text) to service_role;
grant execute on function public.client_refund_request_withdraw(uuid,uuid) to service_role;
grant execute on function public.client_refund_requests_for(uuid) to service_role;
grant execute on function public.client_refund_request_reply(uuid,text) to authenticated;
grant execute on function public.client_refund_request_decline(uuid,text) to authenticated;
grant execute on function public.refund_freelancer_accept(uuid,uuid) to authenticated;
