begin;
-- Attachments the client sent in a PayPal dispute are copied into the project, so they appear in Documents and TeTrato can read them.
-- source_key identifies the attachment within the dispute, so each one is copied only once.
alter table public.project_dispute_documents drop constraint project_dispute_documents_role_check;
alter table public.project_dispute_documents add constraint project_dispute_documents_role_check check (role in ('uploaded','sent','received'));
alter table public.project_dispute_documents add column source_key text check (source_key is null or length(source_key) between 1 and 200);
create unique index project_dispute_documents_source_idx on public.project_dispute_documents (project_id, dispute_id, source_key) where source_key is not null;

create function public.record_dispute_received_document(p_project uuid, p_dispute text, p_document uuid, p_key text) returns integer
language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid(); added integer;
begin
 if u is null then raise sqlstate 'PT401' using message = 'UNAUTHORIZED'; end if;
 if not exists (select 1 from public.projects p join public.clients c on c.id = p.client_id and c.owner_id = p.owner_id
                where p.id = p_project and p.owner_id = u and p.deleted_at is null and c.deleted_at is null)
 then raise sqlstate 'PT404' using message = 'PROJECT_NOT_FOUND'; end if;
 if not exists (select 1 from public.documents d where d.id = p_document and d.project_id = p_project and d.owner_id = u and d.deleted_at is null)
 then raise sqlstate 'PT404' using message = 'DOCUMENT_NOT_FOUND'; end if;
 insert into public.project_dispute_documents (owner_id, project_id, dispute_id, document_id, role, source_key)
 values (u, p_project, p_dispute, p_document, 'received', p_key)
 on conflict do nothing;
 get diagnostics added = row_count;
 return added;
end $$;
revoke all on function public.record_dispute_received_document(uuid, text, uuid, text) from public, anon;
grant execute on function public.record_dispute_received_document(uuid, text, uuid, text) to authenticated;
commit;
