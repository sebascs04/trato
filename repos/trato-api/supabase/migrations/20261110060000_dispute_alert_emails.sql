-- One email to the freelancer when a client opens a PayPal dispute on a verified payment, sent from Trato's mailbox.
-- PayPal can repeat its webhook: the claim below lets exactly one delivery start per project and dispute.
-- Backend only (service_role); the recipient is the project owner's own account email, never a value from PayPal.
create table if not exists public.project_dispute_alerts(
 project_id uuid not null references public.projects(id) on delete cascade,
 dispute_id text not null check(dispute_id ~ '^PP-[A-Z0-9-]{4,40}$'),
 owner_id uuid not null,
 notification_id uuid not null default gen_random_uuid(),
 status text not null default 'sending' check(status in('sending','sent','failed','uncertain')),
 message_id text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 primary key(project_id,dispute_id)
);
alter table public.project_dispute_alerts enable row level security;
revoke all on public.project_dispute_alerts from public,anon,authenticated;

create or replace function public.dispute_alert_claim(p_owner uuid,p_project uuid,p_dispute text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare alert public.project_dispute_alerts;project public.projects;client_name text;recipient text;
begin
 select * into project from public.projects where id=p_project and owner_id=p_owner and deleted_at is null;
 if not found then raise sqlstate 'PT404' using message='PROJECT_NOT_FOUND'; end if;
 select u.email::text into recipient from auth.users u where u.id=p_owner and u.deleted_at is null and u.email_confirmed_at is not null;
 if recipient is null then raise sqlstate 'PT409' using message='OWNER_EMAIL_UNAVAILABLE'; end if;
 select c.name into client_name from public.clients c where c.id=project.client_id;
 insert into public.project_dispute_alerts(project_id,dispute_id,owner_id) values(p_project,p_dispute,p_owner)
  on conflict(project_id,dispute_id) do nothing returning * into alert;
 if alert.project_id is null then
  -- Already sent or under way: one alert per dispute. A definite failure may be retried by the next webhook.
  update public.project_dispute_alerts set status='sending',updated_at=now()
   where project_id=p_project and dispute_id=p_dispute and status='failed' returning * into alert;
  if alert.project_id is null then return jsonb_build_object('acquired',false); end if;
 end if;
 return jsonb_build_object('acquired',true,'notification_id',alert.notification_id,'recipient',recipient,
  'project_name',project.name,'client_name',coalesce(client_name,''));
end $$;

create or replace function public.dispute_alert_finish(p_owner uuid,p_project uuid,p_dispute text,p_status text,p_message_id text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if p_status not in('sent','failed','uncertain') then raise sqlstate 'PT422' using message='INVALID_ALERT_STATUS'; end if;
 update public.project_dispute_alerts set status=p_status,message_id=p_message_id,updated_at=now()
  where project_id=p_project and dispute_id=p_dispute and owner_id=p_owner and status='sending';
end $$;

revoke all on function public.dispute_alert_claim(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.dispute_alert_finish(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.dispute_alert_claim(uuid,uuid,text) to service_role;
grant execute on function public.dispute_alert_finish(uuid,uuid,text,text,text) to service_role;
