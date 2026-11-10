begin;
-- Report a problem: the client complains in Trato about a paid addendum before going to PayPal.
-- One report per paid revision. The client opens it and closes it (resolved or still unresolved);
-- the freelancer only replies, so a complaint is never closed unilaterally. Nothing here moves money or touches PayPal.
create table public.client_problem_reports(
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null,
 project_id uuid not null,
 proposal_id uuid not null,
 revision_id uuid not null unique,
 link_id uuid not null,
 reason text not null check (reason in ('not_received', 'not_as_agreed', 'quality', 'other')),
 notes text not null check (length(btrim(notes)) between 1 and 4000),
 status text not null default 'open' check (status in ('open', 'resolved', 'unresolved')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 closed_at timestamptz,
 check ((status = 'open') = (closed_at is null)),
 foreign key (revision_id, proposal_id, project_id, owner_id) references public.proposal_revisions(id, proposal_id, project_id, owner_id),
 foreign key (link_id, project_id, owner_id) references public.client_portal_links(id, project_id, owner_id)
);
create index client_problem_reports_owner_status_idx on public.client_problem_reports(owner_id, status);
create index client_problem_reports_project_idx on public.client_problem_reports(project_id);
create index client_problem_reports_link_fk_idx on public.client_problem_reports(link_id, project_id, owner_id);
create index client_problem_reports_revision_fk_idx on public.client_problem_reports(revision_id, proposal_id, project_id, owner_id);

create table public.client_problem_messages(
 id uuid primary key default gen_random_uuid(),
 report_id uuid not null references public.client_problem_reports(id),
 owner_id uuid not null,
 author text not null check (author in ('client', 'freelancer')),
 body text not null check (length(btrim(body)) between 1 and 4000),
 -- clock_timestamp, not now(): messages written in one transaction keep the order they were written in.
 created_at timestamptz not null default clock_timestamp()
);
create index client_problem_messages_report_idx on public.client_problem_messages(report_id, created_at);
create index client_problem_messages_owner_idx on public.client_problem_messages(owner_id);

alter table public.client_problem_reports enable row level security;
alter table public.client_problem_messages enable row level security;
revoke all on public.client_problem_reports, public.client_problem_messages from public, anon, authenticated;
grant select on public.client_problem_reports, public.client_problem_messages to authenticated;
create policy client_problem_reports_owner_read on public.client_problem_reports for select to authenticated
 using ((select auth.uid()) = owner_id);
create policy client_problem_messages_owner_read on public.client_problem_messages for select to authenticated
 using ((select auth.uid()) = owner_id);

-- What the client sees about its report: its own words and the conversation, nothing else of the project.
-- Volatile on purpose: it must see the message inserted by the same statement (a stable function would not).
create or replace function private.client_problem_json(p_report public.client_problem_reports)
returns jsonb language sql volatile security definer set search_path = '' as $$
 select jsonb_build_object('reason', p_report.reason, 'notes', p_report.notes, 'status', p_report.status,
  'created_at', p_report.created_at, 'closed_at', p_report.closed_at,
  'messages', coalesce((select jsonb_agg(jsonb_build_object('author', m.author, 'body', m.body, 'created_at', m.created_at) order by m.created_at, m.id)
   from public.client_problem_messages m where m.report_id = p_report.id), '[]'::jsonb))
$$;

-- A report needs the payment PayPal verified for this exact revision; the link alone is not enough.
create or replace function private.client_problem_paid_link(p_token_hash text)
returns public.client_portal_links language plpgsql stable security definer set search_path = '' as $$
declare link public.client_portal_links;
begin
 link := private.client_portal_link(p_token_hash);
 if not exists(select 1 from public.proposal_acceptances a join public.proposal_payments pay on pay.acceptance_id = a.id
   where a.revision_id = link.revision_id and pay.status = 'completed') then
  raise sqlstate 'PT409' using message = 'PROBLEM_REQUIRES_PAYMENT';
 end if;
 return link;
end $$;

create or replace function private.client_portal_problem(p_token_hash text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare link public.client_portal_links; rep public.client_problem_reports;
begin
 link := private.client_portal_link(p_token_hash);
 select * into rep from public.client_problem_reports where revision_id = link.revision_id;
 if rep.id is null then return null; end if;
 return private.client_problem_json(rep);
end $$;

create or replace function private.client_portal_report_problem(p_token_hash text, p_reason text, p_notes text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare link public.client_portal_links; rep public.client_problem_reports;
begin
 link := private.client_problem_paid_link(p_token_hash);
 if p_reason is null or p_reason not in ('not_received', 'not_as_agreed', 'quality', 'other') then
  raise sqlstate 'PT422' using message = 'PROBLEM_REASON_REQUIRED'; end if;
 if p_notes is null or length(btrim(p_notes)) not between 1 and 4000 then
  raise sqlstate 'PT422' using message = 'PROBLEM_NOTES_REQUIRED'; end if;
 insert into public.client_problem_reports(owner_id, project_id, proposal_id, revision_id, link_id, reason, notes)
  values (link.owner_id, link.project_id, link.proposal_id, link.revision_id, link.id, p_reason, btrim(p_notes))
  on conflict (revision_id) do nothing returning * into rep;
 if rep.id is null then raise sqlstate 'PT409' using message = 'PROBLEM_ALREADY_REPORTED'; end if;
 return private.client_problem_json(rep);
end $$;

-- Shared by both sides: a message goes only into an open report.
create or replace function private.client_problem_add_message(p_report uuid, p_author text, p_body text)
returns public.client_problem_reports language plpgsql security definer set search_path = '' as $$
declare rep public.client_problem_reports;
begin
 if p_body is null or length(btrim(p_body)) not between 1 and 4000 then
  raise sqlstate 'PT422' using message = 'PROBLEM_MESSAGE_REQUIRED'; end if;
 select * into rep from public.client_problem_reports where id = p_report for update;
 if rep.status <> 'open' then raise sqlstate 'PT409' using message = 'PROBLEM_CLOSED'; end if;
 insert into public.client_problem_messages(report_id, owner_id, author, body) values (rep.id, rep.owner_id, p_author, btrim(p_body));
 update public.client_problem_reports set updated_at = now() where id = rep.id returning * into rep;
 return rep;
end $$;

create or replace function private.client_portal_problem_message(p_token_hash text, p_body text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare link public.client_portal_links; rep public.client_problem_reports;
begin
 link := private.client_portal_link(p_token_hash);
 select * into rep from public.client_problem_reports where revision_id = link.revision_id;
 if rep.id is null then raise sqlstate 'PT404' using message = 'PROBLEM_NOT_FOUND'; end if;
 return private.client_problem_json(private.client_problem_add_message(rep.id, 'client', p_body));
end $$;

create or replace function private.client_portal_close_problem(p_token_hash text, p_status text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare link public.client_portal_links; rep public.client_problem_reports;
begin
 link := private.client_portal_link(p_token_hash);
 if p_status is null or p_status not in ('resolved', 'unresolved') then
  raise sqlstate 'PT422' using message = 'PROBLEM_STATUS_INVALID'; end if;
 update public.client_problem_reports set status = p_status, closed_at = now(), updated_at = now()
  where revision_id = link.revision_id and status = 'open' returning * into rep;
 if rep.id is null then raise sqlstate 'PT409' using message = 'PROBLEM_CLOSED'; end if;
 return private.client_problem_json(rep);
end $$;

-- The freelancer replies with the signed-in session; the database checks ownership itself.
create or replace function private.problem_report_reply(p_report uuid, p_body text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare rep public.client_problem_reports;
begin
 select * into rep from public.client_problem_reports where id = p_report;
 if rep.id is null or rep.owner_id is distinct from (select auth.uid()) then
  raise sqlstate 'PT404' using message = 'PROBLEM_NOT_FOUND'; end if;
 perform private.ensure_active_project(rep.project_id, rep.owner_id);
 return private.client_problem_json(private.client_problem_add_message(rep.id, 'freelancer', p_body));
end $$;

create or replace function public.client_portal_problem(p_token_hash text)
returns jsonb language sql stable set search_path = '' as $$ select private.client_portal_problem(p_token_hash) $$;
create or replace function public.client_portal_report_problem(p_token_hash text, p_reason text, p_notes text)
returns jsonb language sql set search_path = '' as $$ select private.client_portal_report_problem(p_token_hash, p_reason, p_notes) $$;
create or replace function public.client_portal_problem_message(p_token_hash text, p_body text)
returns jsonb language sql set search_path = '' as $$ select private.client_portal_problem_message(p_token_hash, p_body) $$;
create or replace function public.client_portal_close_problem(p_token_hash text, p_status text)
returns jsonb language sql set search_path = '' as $$ select private.client_portal_close_problem(p_token_hash, p_status) $$;
create or replace function public.problem_report_reply(p_report uuid, p_body text)
returns jsonb language sql set search_path = '' as $$ select private.problem_report_reply(p_report, p_body) $$;

revoke all on function private.client_problem_json(public.client_problem_reports), private.client_problem_paid_link(text),
 private.client_portal_problem(text), private.client_portal_report_problem(text, text, text),
 private.client_problem_add_message(uuid, text, text), private.client_portal_problem_message(text, text),
 private.client_portal_close_problem(text, text), private.problem_report_reply(uuid, text),
 public.client_portal_problem(text), public.client_portal_report_problem(text, text, text),
 public.client_portal_problem_message(text, text), public.client_portal_close_problem(text, text),
 public.problem_report_reply(uuid, text) from public, anon, authenticated;
-- Client side: only the backend, with the service role, after validating the link or the client session.
grant execute on function private.client_problem_json(public.client_problem_reports), private.client_problem_paid_link(text),
 private.client_portal_problem(text), private.client_portal_report_problem(text, text, text),
 private.client_problem_add_message(uuid, text, text), private.client_portal_problem_message(text, text),
 private.client_portal_close_problem(text, text),
 public.client_portal_problem(text), public.client_portal_report_problem(text, text, text),
 public.client_portal_problem_message(text, text), public.client_portal_close_problem(text, text) to service_role;
-- Freelancer side: the signed-in owner; private.problem_report_reply checks auth.uid().
grant execute on function private.problem_report_reply(uuid, text), public.problem_report_reply(uuid, text) to authenticated;
commit;
