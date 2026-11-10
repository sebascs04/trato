-- One email to the freelancer when a client reports a problem from the portal, sent from Trato's mailbox.
-- The report is already one per addendum revision; this claim keeps the email to one per report even on retries.
-- Backend only (service_role); the recipient is the project owner's own account email. Purely additive.
create table if not exists public.client_problem_alerts(
 report_id uuid primary key references public.client_problem_reports(id) on delete cascade,
 owner_id uuid not null,
 notification_id uuid not null default gen_random_uuid(),
 status text not null default 'sending' check(status in('sending','sent','failed','uncertain')),
 message_id text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table public.client_problem_alerts enable row level security;
revoke all on public.client_problem_alerts from public,anon,authenticated;

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
 select d.title into title from public.change_proposals cp left join public.documents d on d.id=cp.request_document_id where cp.id=rep.proposal_id;
 insert into public.client_problem_alerts(report_id,owner_id) values(rep.id,rep.owner_id) on conflict(report_id) do nothing returning * into alert;
 if alert.report_id is null then
  update public.client_problem_alerts set status='sending',updated_at=now() where report_id=rep.id and status='failed' returning * into alert;
  if alert.report_id is null then return jsonb_build_object('acquired',false); end if;
 end if;
 return jsonb_build_object('acquired',true,'owner_id',rep.owner_id,'report_id',rep.id,'notification_id',alert.notification_id,'recipient',recipient,
  'project_name',coalesce(project_name,''),'client_name',coalesce(client_name,''),'title',coalesce(title,''),'reason',rep.reason,'notes',rep.notes);
end $$;

create or replace function public.problem_alert_finish(p_report uuid,p_status text,p_message_id text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if p_status not in('sent','failed','uncertain') then raise sqlstate 'PT422' using message='INVALID_ALERT_STATUS'; end if;
 update public.client_problem_alerts set status=p_status,message_id=p_message_id,updated_at=now() where report_id=p_report and status='sending';
end $$;

revoke all on function public.problem_alert_claim(text) from public,anon,authenticated;
revoke all on function public.problem_alert_finish(uuid,text,text) from public,anon,authenticated;
grant execute on function public.problem_alert_claim(text) to service_role;
grant execute on function public.problem_alert_finish(uuid,text,text) to service_role;
