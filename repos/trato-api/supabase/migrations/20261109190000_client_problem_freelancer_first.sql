begin;
-- Report a problem: the client's report is its first word. Until the freelancer replies there is nothing to judge,
-- so the client can neither add messages nor close the report (resolved or unresolved). Enforced here, not only hidden.
create or replace function private.client_problem_freelancer_replied(p_report uuid)
returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.client_problem_messages where report_id = p_report and author = 'freelancer')
$$;

create or replace function private.client_portal_problem_message(p_token_hash text, p_body text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare link public.client_portal_links; rep public.client_problem_reports;
begin
 link := private.client_portal_link(p_token_hash);
 select * into rep from public.client_problem_reports where revision_id = link.revision_id;
 if rep.id is null then raise sqlstate 'PT404' using message = 'PROBLEM_NOT_FOUND'; end if;
 if not private.client_problem_freelancer_replied(rep.id) then
  raise sqlstate 'PT409' using message = 'PROBLEM_AWAITING_FREELANCER'; end if;
 return private.client_problem_json(private.client_problem_add_message(rep.id, 'client', p_body));
end $$;

create or replace function private.client_portal_close_problem(p_token_hash text, p_status text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare link public.client_portal_links; rep public.client_problem_reports;
begin
 link := private.client_portal_link(p_token_hash);
 if p_status is null or p_status not in ('resolved', 'unresolved') then
  raise sqlstate 'PT422' using message = 'PROBLEM_STATUS_INVALID'; end if;
 select * into rep from public.client_problem_reports where revision_id = link.revision_id for update;
 if rep.id is null then raise sqlstate 'PT404' using message = 'PROBLEM_NOT_FOUND'; end if;
 if rep.status <> 'open' then raise sqlstate 'PT409' using message = 'PROBLEM_CLOSED'; end if;
 if not private.client_problem_freelancer_replied(rep.id) then
  raise sqlstate 'PT409' using message = 'PROBLEM_AWAITING_FREELANCER'; end if;
 update public.client_problem_reports set status = p_status, closed_at = now(), updated_at = now()
  where id = rep.id returning * into rep;
 return private.client_problem_json(rep);
end $$;

revoke all on function private.client_problem_freelancer_replied(uuid) from public, anon, authenticated;
grant execute on function private.client_problem_freelancer_replied(uuid) to service_role;
commit;
