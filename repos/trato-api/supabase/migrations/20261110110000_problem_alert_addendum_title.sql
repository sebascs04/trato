-- The problem email named an addendum by its request document's title, often the generic «Change».
-- It now names it like the stage reports do: «Addendum v1 · $1.00». Only that line changes in both claims.
create or replace function public.problem_alert_claim(p_token_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare rep public.client_problem_reports;alert public.client_problem_alerts;recipient text;project_name text;client_name text;title text;
begin
 select r.* into rep from public.client_portal_links l join public.client_problem_reports r on r.revision_id=l.revision_id and r.owner_id=l.owner_id
  where l.token_hash=p_token_hash;
 if rep.id is null then raise sqlstate 'PT404' using message='PROBLEM_NOT_FOUND'; end if;
 select u.email::text into recipient from auth.users u where u.id=rep.owner_id and u.deleted_at is null and u.email_confirmed_at is not null;
 if recipient is null then raise sqlstate 'PT409' using message='OWNER_EMAIL_UNAVAILABLE'; end if;
 select p.name,c.name into project_name,client_name from public.projects p join public.clients c on c.id=p.client_id where p.id=rep.project_id;
 select 'Addendum v'||v.revision_no||' · $'||to_char(v.additional_minor/100.0,'FM999999990.00') into title from public.proposal_revisions v where v.id=rep.revision_id;
 insert into public.client_problem_alerts(report_id,owner_id) values(rep.id,rep.owner_id) on conflict(report_id) do nothing returning * into alert;
 if alert.report_id is null then
  update public.client_problem_alerts set status='sending',updated_at=now() where report_id=rep.id and status='failed' returning * into alert;
  if alert.report_id is null then return jsonb_build_object('acquired',false); end if;
 end if;
 return jsonb_build_object('acquired',true,'owner_id',rep.owner_id,'report_id',rep.id,'notification_id',alert.notification_id,'recipient',recipient,
  'project_name',coalesce(project_name,''),'client_name',coalesce(client_name,''),'title',coalesce(title,''),'reason',rep.reason,'notes',rep.notes);
end $$;

create or replace function public.problem_alert_claim_report(p_report uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
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
  select 'Addendum v' || v.revision_no || ' · $' || to_char(v.additional_minor / 100.0, 'FM999999990.00') into title from public.proposal_revisions v where v.id = rep.revision_id;
 end if;
 insert into public.client_problem_alerts(report_id, owner_id) values (rep.id, rep.owner_id) on conflict (report_id) do nothing returning * into alert;
 if alert.report_id is null then
  update public.client_problem_alerts set status = 'sending', updated_at = now() where report_id = rep.id and status = 'failed' returning * into alert;
  if alert.report_id is null then return jsonb_build_object('acquired', false); end if;
 end if;
 return jsonb_build_object('acquired', true, 'owner_id', rep.owner_id, 'report_id', rep.id, 'notification_id', alert.notification_id, 'recipient', recipient,
  'project_name', coalesce(project_name, ''), 'client_name', coalesce(client_name, ''), 'title', coalesce(title, ''), 'reason', rep.reason, 'notes', rep.notes);
end $$;
