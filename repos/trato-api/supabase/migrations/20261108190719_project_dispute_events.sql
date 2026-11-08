-- History of PayPal disputes per project. Rows are snapshots of what PayPal reported, appended by the backend and never edited,
-- so the project keeps its record even if PayPal is unavailable. Facts stay in PayPal; this is the project's copy of them.
begin;
create table public.project_dispute_events (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade,
 project_id uuid not null references public.projects(id) on delete cascade,
 dispute_id text not null check (length(dispute_id) between 1 and 64),
 event_key text not null check (length(event_key) between 1 and 120),
 kind text not null check (kind in ('dispute_opened','client_message','freelancer_message','paypal_message','dispute_status')),
 details jsonb not null default '{}'::jsonb,
 happened_at timestamptz not null,
 created_at timestamptz not null default now(),
 unique (project_id, dispute_id, event_key)
);
create index project_dispute_events_project_idx on public.project_dispute_events (project_id, happened_at);
alter table public.project_dispute_events enable row level security;
create policy project_dispute_events_read on public.project_dispute_events for select to authenticated using (
 owner_id = (select auth.uid()) and exists (
  select 1 from public.projects p join public.clients c on c.id = p.client_id and c.owner_id = p.owner_id
  where p.id = project_dispute_events.project_id and p.owner_id = project_dispute_events.owner_id and p.deleted_at is null and c.deleted_at is null));
revoke all on public.project_dispute_events from anon, authenticated;
grant select on public.project_dispute_events to authenticated;
grant all on public.project_dispute_events to service_role;

create function public.record_dispute_events(p_project uuid, p_dispute text, p_events jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid(); added integer;
begin
 if u is null then raise sqlstate 'PT401' using message = 'UNAUTHORIZED'; end if;
 if not exists (select 1 from public.projects p join public.clients c on c.id = p.client_id and c.owner_id = p.owner_id
                where p.id = p_project and p.owner_id = u and p.deleted_at is null and c.deleted_at is null)
 then raise sqlstate 'PT404' using message = 'PROJECT_NOT_FOUND'; end if;
 if jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) > 100 then raise sqlstate 'PT422' using message = 'DISPUTE_EVENTS_INVALID'; end if;
 insert into public.project_dispute_events (owner_id, project_id, dispute_id, event_key, kind, details, happened_at)
 select u, p_project, p_dispute, e.event_key, e.kind, coalesce(e.details, '{}'::jsonb), e.happened_at
 from jsonb_to_recordset(p_events) as e(event_key text, kind text, details jsonb, happened_at timestamptz)
 on conflict (project_id, dispute_id, event_key) do nothing;
 get diagnostics added = row_count;
 return added;
end $$;
revoke all on function public.record_dispute_events(uuid, text, jsonb) from public, anon;
grant execute on function public.record_dispute_events(uuid, text, jsonb) to authenticated;
commit;
