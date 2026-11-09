begin;
-- Report a problem → new request. When the fix is new work, the freelancer registers it as a request through the usual
-- request upload (its own addendum and payment follow the usual flow). The report remembers that request; it stays open
-- until the client closes it. Linking never creates, edits or accepts anything else.
alter table public.client_problem_reports add column request_document_id uuid,
 add constraint client_problem_reports_request_fkey foreign key (request_document_id, project_id, owner_id)
  references public.documents(id, project_id, owner_id);
create index client_problem_reports_request_fk_idx on public.client_problem_reports(request_document_id, project_id, owner_id);

-- The owner links a request of the same project, registered after the report, once, while the report is open.
create or replace function private.problem_report_link_request(p_report uuid, p_document uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare rep public.client_problem_reports;
begin
 select * into rep from public.client_problem_reports where id = p_report for update;
 if rep.id is null or rep.owner_id is distinct from (select auth.uid()) then
  raise sqlstate 'PT404' using message = 'PROBLEM_NOT_FOUND'; end if;
 if rep.status <> 'open' then raise sqlstate 'PT409' using message = 'PROBLEM_CLOSED'; end if;
 if rep.request_document_id is not null then
  if rep.request_document_id = p_document then return private.client_problem_json(rep); end if;
  raise sqlstate 'PT409' using message = 'PROBLEM_REQUEST_ALREADY_LINKED'; end if;
 if not exists(select 1 from public.documents d where d.id = p_document and d.project_id = rep.project_id and d.owner_id = rep.owner_id
   and d.kind = 'email_request' and d.created_at >= rep.created_at) then
  raise sqlstate 'PT404' using message = 'PROBLEM_REQUEST_NOT_FOUND'; end if;
 update public.client_problem_reports set request_document_id = p_document, updated_at = now() where id = rep.id returning * into rep;
 return private.client_problem_json(rep);
end $$;
create or replace function public.problem_report_link_request(p_report uuid, p_document uuid)
returns jsonb language sql set search_path = '' as $$ select private.problem_report_link_request(p_report, p_document) $$;

-- The client sees only that a request was registered, never the document or its id.
create or replace function private.client_problem_json(p_report public.client_problem_reports)
returns jsonb language sql volatile security definer set search_path = '' as $$
 select jsonb_build_object('reason', p_report.reason, 'notes', p_report.notes, 'status', p_report.status,
  'created_at', p_report.created_at, 'closed_at', p_report.closed_at,
  'registered_as_request', p_report.request_document_id is not null,
  'messages', coalesce((select jsonb_agg(jsonb_build_object('author', m.author, 'body', m.body, 'created_at', m.created_at) order by m.created_at, m.id)
   from public.client_problem_messages m where m.report_id = p_report.id), '[]'::jsonb))
$$;

revoke all on function private.problem_report_link_request(uuid, uuid), public.problem_report_link_request(uuid, uuid) from public, anon, authenticated;
grant execute on function private.problem_report_link_request(uuid, uuid), public.problem_report_link_request(uuid, uuid) to authenticated;
commit;
