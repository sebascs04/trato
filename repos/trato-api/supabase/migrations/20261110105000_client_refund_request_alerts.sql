begin;
-- One email to the freelancer when the client asks for a refund from their space, sent from Trato's mailbox.
-- Same pattern as client_problem_alerts (20261110090000): one row per request keeps it to one email even on retries.
-- Backend only (service_role); the recipient is the project owner's own account email, never an input. Purely additive.
create table public.client_refund_request_alerts(
 request_id uuid primary key references public.client_refund_requests(id) on delete cascade,
 owner_id uuid not null,
 notification_id uuid not null default gen_random_uuid(),
 status text not null default 'sending' check(status in('sending','sent','failed','uncertain')),
 message_id text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table public.client_refund_request_alerts enable row level security;
revoke all on public.client_refund_request_alerts from public,anon,authenticated;

create function public.refund_request_alert_claim(p_request uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare req public.client_refund_requests;alert public.client_refund_request_alerts;recipient text;project_name text;client_name text;item text;
begin
 select * into req from public.client_refund_requests where id=p_request;
 if req.id is null then raise sqlstate 'PT404' using message='REFUND_REQUEST_NOT_FOUND'; end if;
 select u.email::text into recipient from auth.users u where u.id=req.owner_id and u.deleted_at is null and u.email_confirmed_at is not null;
 if recipient is null then raise sqlstate 'PT409' using message='OWNER_EMAIL_UNAVAILABLE'; end if;
 select p.name,c.name into project_name,client_name from public.projects p join public.clients c on c.id=p.client_id where p.id=req.project_id;
 if req.stage_position is not null then
  select 'Deliverable '||req.stage_position||coalesce(' · '||s.title,'') into item from public.project_start_stages s where s.project_id=req.project_id and s.position=req.stage_position;
  item:=coalesce(item,'Deliverable '||req.stage_position);
 else
  select d.title into item from public.change_proposals cp left join public.documents d on d.id=cp.request_document_id where cp.id=req.proposal_id;
 end if;
 insert into public.client_refund_request_alerts(request_id,owner_id) values(req.id,req.owner_id) on conflict(request_id) do nothing returning * into alert;
 if alert.request_id is null then
  update public.client_refund_request_alerts set status='sending',updated_at=now() where request_id=req.id and status='failed' returning * into alert;
  if alert.request_id is null then return jsonb_build_object('acquired',false); end if;
 end if;
 return jsonb_build_object('acquired',true,'owner_id',req.owner_id,'request_id',req.id,'notification_id',alert.notification_id,'recipient',recipient,
  'project_name',coalesce(project_name,''),'client_name',coalesce(client_name,''),'item',coalesce(item,''),'amount_minor',req.requested_minor,'reason',req.reason);
end $$;

create function public.refund_request_alert_finish(p_request uuid,p_status text,p_message_id text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if p_status not in('sent','failed','uncertain') then raise sqlstate 'PT422' using message='INVALID_ALERT_STATUS'; end if;
 update public.client_refund_request_alerts set status=p_status,message_id=p_message_id,updated_at=now() where request_id=p_request and status='sending';
end $$;

revoke all on function public.refund_request_alert_claim(uuid) from public,anon,authenticated;
revoke all on function public.refund_request_alert_finish(uuid,text,text) from public,anon,authenticated;
grant execute on function public.refund_request_alert_claim(uuid) to service_role;
grant execute on function public.refund_request_alert_finish(uuid,text,text) to service_role;
commit;
