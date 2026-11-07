-- Where a change request sits in the project's work plan: under one of the plan's stages ('stage')
-- or as new work after the plan ('new'). Chosen once when the request is registered and never edited,
-- so plan views, history and the map read the same placement. Payment stays in the change flow:
-- no row is added to project_start_stages.
begin;
create table public.change_request_plan_placements(
 request_document_id uuid primary key,
 project_id uuid not null,
 owner_id uuid not null default auth.uid(),
 placement text not null check(placement in ('stage','new')),
 stage_position integer,
 created_at timestamptz not null default now(),
 check((placement='stage')=(stage_position is not null)),
 foreign key(request_document_id,project_id,owner_id) references public.documents(id,project_id,owner_id) on delete cascade,
 foreign key(project_id,stage_position) references public.project_start_stages(project_id,position)
);
alter table public.change_request_plan_placements enable row level security;
revoke all on public.change_request_plan_placements from public,anon;
grant select,insert on public.change_request_plan_placements to authenticated;
grant all on public.change_request_plan_placements to service_role;
create policy change_request_plan_placements_read on public.change_request_plan_placements for select to authenticated
 using(owner_id=(select auth.uid()));
-- Only the owner, only for an active change request (email_request) of an active project that has a saved plan.
create policy change_request_plan_placements_insert on public.change_request_plan_placements for insert to authenticated
 with check(owner_id=(select auth.uid())
  and exists(select 1 from public.documents d where d.id=request_document_id and d.project_id=change_request_plan_placements.project_id
   and d.owner_id=(select auth.uid()) and d.kind='email_request' and d.deleted_at is null)
  and exists(select 1 from public.projects p where p.id=change_request_plan_placements.project_id and p.owner_id=(select auth.uid()) and p.deleted_at is null)
  and exists(select 1 from public.project_start_plans s where s.project_id=change_request_plan_placements.project_id and s.owner_id=(select auth.uid())));
create index change_request_plan_placements_owner_project on public.change_request_plan_placements(owner_id,project_id);
notify pgrst,'reload schema';
commit;
