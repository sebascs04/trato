begin;
-- Report a problem: once the request it became is accepted and paid (or accepted at no cost), the report reminds the
-- client to close it when the fix is delivered. Read-only: it never closes the report or touches the request.
create or replace function private.client_problem_json(p_report public.client_problem_reports)
returns jsonb language sql volatile security definer set search_path = '' as $$
 select jsonb_build_object('reason', p_report.reason, 'notes', p_report.notes, 'status', p_report.status,
  'created_at', p_report.created_at, 'closed_at', p_report.closed_at,
  'registered_as_request', p_report.request_document_id is not null,
  'request_paid', p_report.request_document_id is not null and exists(
   select 1 from public.change_proposals p
    join public.proposal_revisions r on r.id = p.current_revision_id
    join public.proposal_acceptances a on a.revision_id = r.id
    left join public.proposal_payments pay on pay.acceptance_id = a.id
   where p.request_document_id = p_report.request_document_id and p.owner_id = p_report.owner_id
     and (pay.status = 'completed' or (r.additional_minor = 0 and pay.id is null))),
  'messages', coalesce((select jsonb_agg(jsonb_build_object('author', m.author, 'body', m.body, 'created_at', m.created_at) order by m.created_at, m.id)
   from public.client_problem_messages m where m.report_id = p_report.id), '[]'::jsonb))
$$;
commit;
