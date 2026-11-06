begin;
create table if not exists public.proposal_revision_ai(
 revision_id uuid primary key, proposal_id uuid not null, project_id uuid not null,
 owner_id uuid not null default auth.uid(), job_id uuid not null,
 proposal jsonb not null check(jsonb_typeof(proposal)='object' and octet_length(proposal::text)<=200000),
 created_at timestamptz not null default now(),
 foreign key(revision_id,proposal_id,project_id,owner_id) references public.proposal_revisions(id,proposal_id,project_id,owner_id) on delete cascade);
alter table public.proposal_revision_ai enable row level security;
revoke all on public.proposal_revision_ai from public,anon,authenticated;
grant select,insert on public.proposal_revision_ai to authenticated;
grant all on public.proposal_revision_ai to service_role;
drop policy if exists proposal_revision_ai_read on public.proposal_revision_ai;
create policy proposal_revision_ai_read on public.proposal_revision_ai for select to authenticated using(owner_id=(select auth.uid()));
drop policy if exists proposal_revision_ai_insert on public.proposal_revision_ai;
create policy proposal_revision_ai_insert on public.proposal_revision_ai for insert to authenticated with check(owner_id=(select auth.uid()) and exists(select 1 from public.projects p where p.id=project_id and p.owner_id=(select auth.uid()) and p.deleted_at is null));
create index if not exists proposal_revision_ai_owner_project on public.proposal_revision_ai(owner_id,project_id);
notify pgrst,'reload schema';
commit;
