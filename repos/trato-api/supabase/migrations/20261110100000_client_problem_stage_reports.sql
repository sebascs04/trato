begin;
-- Report a problem on a paid Work plan deliverable, not only on a paid addendum. Same reports table, conversation,
-- freelancer reply, closing and «Register as new request». A report is about exactly one thing: an addendum revision
-- (its portal link) or a paid stage checkout. Addendum reports keep working as before.
alter table public.client_problem_reports
 alter column proposal_id drop not null,
 alter column revision_id drop not null,
 alter column link_id drop not null,
 add column stage_checkout_id uuid unique references public.project_initial_checkouts(id),
 add column stage_position integer,
 add constraint client_problem_reports_subject check (
  (revision_id is not null and proposal_id is not null and link_id is not null and stage_checkout_id is null and stage_position is null)
  or (stage_checkout_id is not null and stage_position is not null and revision_id is null and proposal_id is null and link_id is null));

-- The paid stage the signed-in client may report on: client-role account whose verified email is the project's client.
create or replace function private.client_account_stage_checkout(p_user uuid, p_project uuid, p_position integer)
returns public.project_initial_checkouts language plpgsql stable security definer set search_path = '' as $$
declare ck public.project_initial_checkouts;
begin
 select k.* into ck from auth.users u
  join public.account_roles ar on ar.user_id = u.id and ar.role = 'client'
  join public.clients c on lower(btrim(c.contact_email)) = lower(btrim(u.email)) and c.deleted_at is null
  join public.projects pj on pj.client_id = c.id and pj.owner_id = c.owner_id and pj.deleted_at is null
  join public.project_initial_checkouts k on k.project_id = pj.id and k.owner_id = pj.owner_id and k.stage_position = p_position
  where u.id = p_user and u.deleted_at is null and u.email_confirmed_at is not null and pj.id = p_project
  order by (k.status = 'completed') desc, k.created_at desc limit 1;
 if ck.id is null then raise sqlstate 'PT404' using message = 'STAGE_NOT_FOUND'; end if;
 return ck;
end $$;

create or replace function private.client_account_stage_report(p_user uuid, p_project uuid, p_position integer)
returns public.client_problem_reports language sql stable security definer set search_path = '' as $$
 select r.* from public.client_problem_reports r where r.stage_checkout_id = (private.client_account_stage_checkout(p_user, p_project, p_position)).id
$$;

create or replace function private.client_account_stage_problem(p_user uuid, p_project uuid, p_position integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare rep public.client_problem_reports := private.client_account_stage_report(p_user, p_project, p_position);
begin
 if rep.id is null then return null; end if;
 return private.client_problem_json(rep);
end $$;

create or replace function private.client_account_report_stage_problem(p_user uuid, p_project uuid, p_position integer, p_reason text, p_notes text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare ck public.project_initial_checkouts := private.client_account_stage_checkout(p_user, p_project, p_position); rep public.client_problem_reports;
begin
 if ck.status <> 'completed' then raise sqlstate 'PT409' using message = 'PROBLEM_REQUIRES_PAYMENT'; end if;
 if p_reason is null or p_reason not in ('not_received', 'not_as_agreed', 'quality', 'other') then
  raise sqlstate 'PT422' using message = 'PROBLEM_REASON_REQUIRED'; end if;
 if p_notes is null or length(btrim(p_notes)) not between 1 and 4000 then
  raise sqlstate 'PT422' using message = 'PROBLEM_NOTES_REQUIRED'; end if;
 insert into public.client_problem_reports(owner_id, project_id, stage_checkout_id, stage_position, reason, notes)
  values (ck.owner_id, ck.project_id, ck.id, p_position, p_reason, btrim(p_notes))
  on conflict (stage_checkout_id) do nothing returning * into rep;
 if rep.id is null then raise sqlstate 'PT409' using message = 'PROBLEM_ALREADY_REPORTED'; end if;
 return jsonb_build_object('report_id', rep.id, 'problem', private.client_problem_json(rep));
end $$;

-- Same rules as the portal: the client writes and closes only after the freelancer answered.
create or replace function private.client_account_stage_problem_message(p_user uuid, p_project uuid, p_position integer, p_body text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare rep public.client_problem_reports := private.client_account_stage_report(p_user, p_project, p_position);
begin
 if rep.id is null then raise sqlstate 'PT404' using message = 'PROBLEM_NOT_FOUND'; end if;
 if not private.client_problem_freelancer_replied(rep.id) then raise sqlstate 'PT409' using message = 'PROBLEM_AWAITING_FREELANCER'; end if;
 return private.client_problem_json(private.client_problem_add_message(rep.id, 'client', p_body));
end $$;

create or replace function private.client_account_close_stage_problem(p_user uuid, p_project uuid, p_position integer, p_status text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare rep public.client_problem_reports := private.client_account_stage_report(p_user, p_project, p_position);
begin
 if p_status is null or p_status not in ('resolved', 'unresolved') then raise sqlstate 'PT422' using message = 'PROBLEM_STATUS_INVALID'; end if;
 if rep.id is null then raise sqlstate 'PT404' using message = 'PROBLEM_NOT_FOUND'; end if;
 if rep.status <> 'open' then raise sqlstate 'PT409' using message = 'PROBLEM_CLOSED'; end if;
 if not private.client_problem_freelancer_replied(rep.id) then raise sqlstate 'PT409' using message = 'PROBLEM_AWAITING_FREELANCER'; end if;
 update public.client_problem_reports set status = p_status, closed_at = now(), updated_at = now() where id = rep.id returning * into rep;
 return private.client_problem_json(rep);
end $$;

-- For the client's lists: the state of each stage report, like /account/problems does for addenda.
create or replace function private.client_account_stage_problems(p_user uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
 select coalesce(jsonb_agg(jsonb_build_object('project_id', r.project_id, 'position', r.stage_position, 'status', r.status,
   'request_paid', (private.client_problem_json(r)->>'request_paid')::boolean)), '[]'::jsonb)
 from auth.users u
 join public.account_roles ar on ar.user_id = u.id and ar.role = 'client'
 join public.clients c on lower(btrim(c.contact_email)) = lower(btrim(u.email)) and c.deleted_at is null
 join public.projects pj on pj.client_id = c.id and pj.owner_id = c.owner_id and pj.deleted_at is null
 join public.client_problem_reports r on r.project_id = pj.id and r.owner_id = pj.owner_id and r.stage_checkout_id is not null
 where u.id = p_user and u.deleted_at is null and u.email_confirmed_at is not null
$$;

-- The freelancer's alert for a stage report: the same email and claim table as addendum reports, found by report id.
create or replace function public.problem_alert_claim_report(p_report uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare rep public.client_problem_reports; alert public.client_problem_alerts; recipient text; project_name text; client_name text; title text;
begin
 select * into rep from public.client_problem_reports where id = p_report;
 if rep.id is null then raise sqlstate 'PT404' using message = 'PROBLEM_NOT_FOUND'; end if;
 select u.email::text into recipient from auth.users u where u.id = rep.owner_id and u.deleted_at is null and u.email_confirmed_at is not null;
 if recipient is null then raise sqlstate 'PT409' using message = 'OWNER_EMAIL_UNAVAILABLE'; end if;
 select p.name, c.name into project_name, client_name from public.projects p join public.clients c on c.id = p.client_id where p.id = rep.project_id;
 if rep.stage_position is not null then
  select 'Deliverable ' || s.position || ' · ' || s.title into title from public.project_start_stages s where s.project_id = rep.project_id and s.position = rep.stage_position;
 else
  select d.title into title from public.change_proposals cp left join public.documents d on d.id = cp.request_document_id where cp.id = rep.proposal_id;
 end if;
 insert into public.client_problem_alerts(report_id, owner_id) values (rep.id, rep.owner_id) on conflict (report_id) do nothing returning * into alert;
 if alert.report_id is null then
  update public.client_problem_alerts set status = 'sending', updated_at = now() where report_id = rep.id and status = 'failed' returning * into alert;
  if alert.report_id is null then return jsonb_build_object('acquired', false); end if;
 end if;
 return jsonb_build_object('acquired', true, 'owner_id', rep.owner_id, 'report_id', rep.id, 'notification_id', alert.notification_id, 'recipient', recipient,
  'project_name', coalesce(project_name, ''), 'client_name', coalesce(client_name, ''), 'title', coalesce(title, ''), 'reason', rep.reason, 'notes', rep.notes);
end $$;

create or replace function public.client_account_stage_problem(p_user uuid, p_project uuid, p_position integer)
returns jsonb language sql stable set search_path = '' as $$ select private.client_account_stage_problem(p_user, p_project, p_position) $$;
create or replace function public.client_account_report_stage_problem(p_user uuid, p_project uuid, p_position integer, p_reason text, p_notes text)
returns jsonb language sql set search_path = '' as $$ select private.client_account_report_stage_problem(p_user, p_project, p_position, p_reason, p_notes) $$;
create or replace function public.client_account_stage_problem_message(p_user uuid, p_project uuid, p_position integer, p_body text)
returns jsonb language sql set search_path = '' as $$ select private.client_account_stage_problem_message(p_user, p_project, p_position, p_body) $$;
create or replace function public.client_account_close_stage_problem(p_user uuid, p_project uuid, p_position integer, p_status text)
returns jsonb language sql set search_path = '' as $$ select private.client_account_close_stage_problem(p_user, p_project, p_position, p_status) $$;
create or replace function public.client_account_stage_problems(p_user uuid)
returns jsonb language sql stable set search_path = '' as $$ select private.client_account_stage_problems(p_user) $$;

revoke all on function private.client_account_stage_checkout(uuid, uuid, integer), private.client_account_stage_report(uuid, uuid, integer),
 private.client_account_stage_problem(uuid, uuid, integer), private.client_account_report_stage_problem(uuid, uuid, integer, text, text),
 private.client_account_stage_problem_message(uuid, uuid, integer, text), private.client_account_close_stage_problem(uuid, uuid, integer, text),
 private.client_account_stage_problems(uuid), public.problem_alert_claim_report(uuid),
 public.client_account_stage_problem(uuid, uuid, integer), public.client_account_report_stage_problem(uuid, uuid, integer, text, text),
 public.client_account_stage_problem_message(uuid, uuid, integer, text), public.client_account_close_stage_problem(uuid, uuid, integer, text),
 public.client_account_stage_problems(uuid) from public, anon, authenticated;
grant execute on function private.client_account_stage_checkout(uuid, uuid, integer), private.client_account_stage_report(uuid, uuid, integer),
 private.client_account_stage_problem(uuid, uuid, integer), private.client_account_report_stage_problem(uuid, uuid, integer, text, text),
 private.client_account_stage_problem_message(uuid, uuid, integer, text), private.client_account_close_stage_problem(uuid, uuid, integer, text),
 private.client_account_stage_problems(uuid), public.problem_alert_claim_report(uuid),
 public.client_account_stage_problem(uuid, uuid, integer), public.client_account_report_stage_problem(uuid, uuid, integer, text, text),
 public.client_account_stage_problem_message(uuid, uuid, integer, text), public.client_account_close_stage_problem(uuid, uuid, integer, text),
 public.client_account_stage_problems(uuid) to service_role;
commit;
