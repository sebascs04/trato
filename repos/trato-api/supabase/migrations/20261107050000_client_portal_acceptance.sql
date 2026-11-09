begin;
-- Client portal: the client accepts the reviewed addendum through a signed link, without a Trato account.
-- The acceptance is the same fact as the PDF flow, so it lives in proposal_acceptances (payments, graph,
-- project status and dispute evidence keep reading one table). Portal-only details live in 1:1 tables.
-- Every portal entry point is service_role only: the backend checks the link before calling them.

-- 1. Links: one per reviewed revision; only the SHA-256 of the token is stored.
create table public.client_portal_links(
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null,
 project_id uuid not null,
 proposal_id uuid not null,
 revision_id uuid not null,
 token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
 expires_at timestamptz not null,
 revoked_at timestamptz,
 created_at timestamptz not null default now(),
 check (expires_at > created_at),
 unique (id, project_id, owner_id),
 foreign key (revision_id, proposal_id, project_id, owner_id) references public.proposal_revisions(id, proposal_id, project_id, owner_id)
);
create index client_portal_links_revision_idx on public.client_portal_links(revision_id);
create index client_portal_links_proposal_active_idx on public.client_portal_links(proposal_id) where revoked_at is null;
alter table public.client_portal_links enable row level security;
revoke all on public.client_portal_links from anon, authenticated;
grant select (id, project_id, proposal_id, revision_id, expires_at, revoked_at, created_at) on public.client_portal_links to authenticated;
create policy client_portal_links_owner_read on public.client_portal_links for select to authenticated
 using ((select auth.uid()) = owner_id);

-- 2. Acceptances: PDF review keeps its required evidence; the portal records the link instead.
alter table public.proposal_acceptances
 drop constraint proposal_acceptances_method_check,
 drop constraint proposal_acceptances_review_notes_check,
 alter column returned_document_id drop not null,
 alter column returned_sha256 drop not null,
 alter column reviewer_id drop not null,
 alter column review_notes drop not null,
 add constraint proposal_acceptances_method_check check (method in ('manual_document_review','client_portal')),
 add constraint proposal_acceptances_method_evidence_check check (
  (method = 'manual_document_review' and returned_document_id is not null and returned_sha256 is not null
   and reviewer_id is not null and review_notes is not null and length(trim(review_notes)) between 1 and 4000)
  or (method = 'client_portal' and returned_document_id is null and returned_sha256 is null
   and reviewer_id is null and review_notes is null));

create table public.client_portal_acceptances(
 acceptance_id uuid primary key,
 owner_id uuid not null,
 project_id uuid not null,
 link_id uuid not null unique,
 accepted_addendum_sha256 text not null check (accepted_addendum_sha256 ~ '^[0-9a-f]{64}$'),
 created_at timestamptz not null default now(),
 foreign key (acceptance_id, project_id, owner_id) references public.proposal_acceptances(id, project_id, owner_id),
 foreign key (link_id, project_id, owner_id) references public.client_portal_links(id, project_id, owner_id)
);
alter table public.client_portal_acceptances enable row level security;
revoke all on public.client_portal_acceptances from anon, authenticated;
grant select on public.client_portal_acceptances to authenticated;
create policy client_portal_acceptances_owner_read on public.client_portal_acceptances for select to authenticated
 using ((select auth.uid()) = owner_id);

-- 3. Events: the client has no auth.users row, so client events carry actor_kind='client' and no actor_id.
alter table public.proposal_events
 add column actor_kind text not null default 'owner' check (actor_kind in ('owner','client')),
 alter column actor_id drop not null,
 add constraint proposal_events_actor_check check ((actor_kind = 'owner') = (actor_id is not null));

-- 4. Owner issues a link for the reviewed, sent revision. The backend generates the token and passes its hash.
create or replace function private.client_portal_link_issue(p_proposal uuid, p_expected_revision uuid, p_token_hash text, p_days integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid(); p public.change_proposals; link public.client_portal_links;
begin
 if u is null then raise sqlstate 'PT401' using message = 'UNAUTHORIZED'; end if;
 if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' or p_days is null or p_days not between 1 and 60 then
  raise sqlstate 'PT422' using message = 'INVALID_PORTAL_LINK'; end if;
 select * into p from public.change_proposals where id = p_proposal and owner_id = u;
 if not found then raise sqlstate 'PT404' using message = 'PROPOSAL_NOT_FOUND'; end if;
 perform private.ensure_active_project(p.project_id, u);
 perform 1 from public.projects where id = p.project_id and owner_id = u for update;
 select * into p from public.change_proposals where id = p.id for update;
 if p.current_revision_id is distinct from p_expected_revision then raise sqlstate 'PT409' using message = 'PROPOSAL_REVISION_CONFLICT'; end if;
 if p.locked_at is not null then raise sqlstate 'PT409' using message = 'CHANGE_READ_ONLY'; end if;
 if p.status <> 'ready_for_review' then raise sqlstate 'PT409' using message = 'PROPOSAL_REVIEW_REQUIRED'; end if;
 update public.client_portal_links set revoked_at = now() where proposal_id = p.id and revoked_at is null;
 insert into public.client_portal_links(owner_id, project_id, proposal_id, revision_id, token_hash, expires_at)
  values (u, p.project_id, p.id, p.current_revision_id, p_token_hash, now() + make_interval(days => p_days)) returning * into link;
 return jsonb_build_object('link_id', link.id, 'revision_id', link.revision_id, 'expires_at', link.expires_at);
end $$;

-- Resolves a token to its link; raises the same error for unknown, revoked and expired links.
create or replace function private.client_portal_link(p_token_hash text)
returns public.client_portal_links language plpgsql stable security definer set search_path = '' as $$
declare link public.client_portal_links;
begin
 if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise sqlstate 'PT404' using message = 'PORTAL_LINK_NOT_FOUND'; end if;
 select * into link from public.client_portal_links where token_hash = p_token_hash;
 if not found or link.revoked_at is not null or link.expires_at <= now() then raise sqlstate 'PT404' using message = 'PORTAL_LINK_NOT_FOUND'; end if;
 perform private.ensure_active_project(link.project_id, link.owner_id);
 return link;
end $$;

-- 5. What the client sees: only this revision, its reviewed addendum and its state. No notes, sources or other projects.
create or replace function private.client_portal_view(p_token_hash text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare link public.client_portal_links; p public.change_proposals; r public.proposal_revisions; v public.proposal_reviews;
 a public.proposal_acceptances; prj record;
begin
 link := private.client_portal_link(p_token_hash);
 select * into p from public.change_proposals where id = link.proposal_id;
 select * into r from public.proposal_revisions where id = link.revision_id;
 select * into v from public.proposal_reviews where revision_id = link.revision_id;
 select * into a from public.proposal_acceptances where revision_id = link.revision_id;
 select pj.name project_name, c.name client_name into prj from public.projects pj join public.clients c on c.id = pj.client_id where pj.id = link.project_id;
 return jsonb_build_object(
  'link_id', link.id, 'expires_at', link.expires_at,
  'project_name', prj.project_name, 'client_name', prj.client_name,
  'proposal_id', p.id, 'revision_id', r.id, 'revision_no', r.revision_no,
  'is_current', p.current_revision_id = r.id,
  'scope_summary', r.scope_summary, 'conditions', r.conditions, 'currency', r.currency,
  'additional_minor', r.additional_minor, 'deadline', r.deadline,
  'addendum_document_id', v.addendum_document_id, 'addendum_sha256', v.addendum_sha256,
  'status', case when a.id is not null then 'accepted' when p.current_revision_id <> r.id then 'superseded' else p.status end,
  'accepted_at', a.created_at, 'acceptance_method', a.method);
end $$;

-- 6. Client accepts the version shown. Mirrors proposal_command('accept') checks and lock order (project, head, proposal).
create or replace function private.client_portal_accept(p_token_hash text, p_revision uuid, p_addendum_sha256 text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare link public.client_portal_links; p public.change_proposals; r public.proposal_revisions; h public.project_agreement_heads;
 v public.proposal_reviews; acceptance uuid;
begin
 link := private.client_portal_link(p_token_hash);
 select acceptance_id into acceptance from public.client_portal_acceptances where link_id = link.id;
 if found then return jsonb_build_object('proposal_id', link.proposal_id, 'revision_id', link.revision_id, 'acceptance_id', acceptance); end if;
 if p_revision is distinct from link.revision_id then raise sqlstate 'PT409' using message = 'PROPOSAL_REVISION_CONFLICT'; end if;
 perform 1 from public.projects where id = link.project_id and owner_id = link.owner_id for update;
 insert into public.project_agreement_heads(project_id, owner_id) values (link.project_id, link.owner_id) on conflict do nothing;
 select * into h from public.project_agreement_heads where project_id = link.project_id and owner_id = link.owner_id for update;
 select * into p from public.change_proposals where id = link.proposal_id and owner_id = link.owner_id for update;
 select * into link from public.client_portal_links where id = link.id for update;
 if link.revoked_at is not null or link.expires_at <= now() then raise sqlstate 'PT404' using message = 'PORTAL_LINK_NOT_FOUND'; end if;
 if p.current_revision_id is distinct from link.revision_id then raise sqlstate 'PT409' using message = 'PROPOSAL_REVISION_CONFLICT'; end if;
 if exists(select 1 from public.proposal_deliveries where proposal_id = p.id and status = 'sending') then raise sqlstate 'PT409' using message = 'EMAIL_IN_PROGRESS'; end if;
 if p.locked_at is not null then raise sqlstate 'PT409' using message = 'CHANGE_READ_ONLY'; end if;
 if p.status = 'accepted' then raise sqlstate 'PT409' using message = 'PROPOSAL_ALREADY_ACCEPTED'; end if;
 if p.status <> 'ready_for_review' then raise sqlstate 'PT409' using message = 'PROPOSAL_REVIEW_REQUIRED'; end if;
 select * into r from public.proposal_revisions where id = link.revision_id;
 if r.base_generation <> h.generation then raise sqlstate 'PT409' using message = 'AGREEMENT_GENERATION_CONFLICT'; end if;
 if exists(select 1 from public.proposal_revision_sources s join public.documents d on d.id = s.document_id join public.document_extractions e on e.id = s.extraction_id
  where s.revision_id = r.id and (d.sha256 <> s.document_sha256 or e.result_hash is distinct from s.extraction_result_hash or e.status <> 'ready')) then
  raise sqlstate 'PT409' using message = 'PROPOSAL_SOURCE_CHANGED'; end if;
 if not exists(select 1 from public.proposal_deliveries where revision_id = r.id and kind = 'adenda' and status = 'accepted_by_gmail') then
  raise sqlstate 'PT409' using message = 'ADENDA_SEND_REQUIRED'; end if;
 select * into v from public.proposal_reviews where revision_id = r.id;
 if v.addendum_sha256 is distinct from p_addendum_sha256 then raise sqlstate 'PT409' using message = 'ADDENDUM_CHANGED'; end if;
 insert into public.proposal_acceptances(owner_id, project_id, proposal_id, revision_id, method)
  values (link.owner_id, link.project_id, p.id, r.id, 'client_portal') returning id into acceptance;
 insert into public.client_portal_acceptances(acceptance_id, owner_id, project_id, link_id, accepted_addendum_sha256)
  values (acceptance, link.owner_id, link.project_id, link.id, v.addendum_sha256);
 update public.change_proposals set status = 'accepted', locked_at = case when r.additional_minor = 0 then now() else locked_at end where id = p.id;
 update public.project_agreement_heads set generation = generation + 1, acceptance_id = acceptance where project_id = link.project_id and owner_id = link.owner_id;
 insert into public.proposal_events(owner_id, project_id, proposal_id, revision_id, event_type, actor_id, actor_kind)
  values (link.owner_id, link.project_id, p.id, r.id, 'acceptance_recorded', null, 'client');
 return jsonb_build_object('proposal_id', p.id, 'revision_id', r.id, 'acceptance_id', acceptance);
end $$;

-- 7. Public wrappers (PostgREST only exposes public). Issue: the owner. View and accept: service_role only.
create or replace function public.client_portal_link_issue(p_proposal uuid, p_expected_revision uuid, p_token_hash text, p_days integer)
returns jsonb language sql set search_path = '' as $$ select private.client_portal_link_issue(p_proposal, p_expected_revision, p_token_hash, p_days) $$;
create or replace function public.client_portal_view(p_token_hash text)
returns jsonb language sql stable set search_path = '' as $$ select private.client_portal_view(p_token_hash) $$;
create or replace function public.client_portal_accept(p_token_hash text, p_revision uuid, p_addendum_sha256 text)
returns jsonb language sql set search_path = '' as $$ select private.client_portal_accept(p_token_hash, p_revision, p_addendum_sha256) $$;

revoke all on function private.client_portal_link_issue(uuid, uuid, text, integer), private.client_portal_link(text),
 private.client_portal_view(text), private.client_portal_accept(text, uuid, text) from public, anon, authenticated;
revoke all on function public.client_portal_link_issue(uuid, uuid, text, integer), public.client_portal_view(text),
 public.client_portal_accept(text, uuid, text) from public, anon, authenticated;
grant execute on function private.client_portal_link_issue(uuid, uuid, text, integer), public.client_portal_link_issue(uuid, uuid, text, integer) to authenticated, service_role;
grant execute on function private.client_portal_link(text), private.client_portal_view(text), private.client_portal_accept(text, uuid, text),
 public.client_portal_view(text), public.client_portal_accept(text, uuid, text) to service_role;
commit;
