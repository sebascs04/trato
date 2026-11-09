begin;
-- Registering the report as a new request is the freelancer's answer too: from then on the client may reply and close.
create or replace function private.client_problem_freelancer_replied(p_report uuid)
returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.client_problem_messages where report_id = p_report and author = 'freelancer')
     or exists(select 1 from public.client_problem_reports where id = p_report and request_document_id is not null)
$$;
commit;
