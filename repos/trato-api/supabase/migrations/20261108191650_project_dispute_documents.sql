-- Links project documents to a PayPal dispute, as refund and change documents already are. A document keeps its other groups.
create table public.project_dispute_documents (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade,
 project_id uuid not null references public.projects(id) on delete cascade,
 dispute_id text not null check (length(dispute_id) between 1 and 64),
 document_id uuid not null references public.documents(id) on delete cascade,
 role text not null check (role in ('uploaded','sent')),
 created_at timestamptz not null default now(),
 unique (project_id, dispute_id, document_id, role)
);
create index project_dispute_documents_project_idx on public.project_dispute_documents (project_id);
create index project_dispute_documents_document_idx on public.project_dispute_documents (document_id);
alter table public.project_dispute_documents enable row level security;
create policy project_dispute_documents_read on public.project_dispute_documents for select to authenticated using (
 owner_id = (select auth.uid()) and exists (
  select 1 from public.projects p join public.clients c on c.id = p.client_id and c.owner_id = p.owner_id
  where p.id = project_dispute_documents.project_id and p.owner_id = project_dispute_documents.owner_id and p.deleted_at is null and c.deleted_at is null));
revoke all on public.project_dispute_documents from anon, authenticated;
grant select on public.project_dispute_documents to authenticated;
grant all on public.project_dispute_documents to service_role;

create function public.record_dispute_documents(p_project uuid, p_dispute text, p_documents uuid[], p_role text) returns integer
language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid(); added integer;
begin
 if u is null then raise sqlstate 'PT401' using message = 'UNAUTHORIZED'; end if;
 if not exists (select 1 from public.projects p join public.clients c on c.id = p.client_id and c.owner_id = p.owner_id
                where p.id = p_project and p.owner_id = u and p.deleted_at is null and c.deleted_at is null)
 then raise sqlstate 'PT404' using message = 'PROJECT_NOT_FOUND'; end if;
 if exists (select 1 from unnest(p_documents) as wanted(id)
            where not exists (select 1 from public.documents d where d.id = wanted.id and d.project_id = p_project and d.owner_id = u and d.deleted_at is null))
 then raise sqlstate 'PT404' using message = 'DOCUMENT_NOT_FOUND'; end if;
 insert into public.project_dispute_documents (owner_id, project_id, dispute_id, document_id, role)
 select u, p_project, p_dispute, wanted.id, p_role from unnest(p_documents) as wanted(id)
 on conflict (project_id, dispute_id, document_id, role) do nothing;
 get diagnostics added = row_count;
 return added;
end $$;
revoke all on function public.record_dispute_documents(uuid, text, uuid[], text) from public, anon;
grant execute on function public.record_dispute_documents(uuid, text, uuid[], text) to authenticated;
