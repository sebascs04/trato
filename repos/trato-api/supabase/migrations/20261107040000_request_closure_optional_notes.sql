-- 7 Nov 2026: closing a request keeps its reason (rejected/withdrawn) but the detail becomes optional.
-- Existing closures stay valid; only the lower bound of the notes length is relaxed.
begin;
do $$
declare n text;
begin
 select conname into strict n from pg_constraint
  where conrelid='public.request_closures'::regclass and contype='c' and pg_get_constraintdef(oid) like '%notes%';
 execute format('alter table public.request_closures drop constraint %I',n);
end $$;
alter table public.request_closures add constraint request_closures_notes_check check(length(notes)<=4000);
create or replace function private.close_change_request(p_request_id uuid,p_reason text,p_notes text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();d public.documents;p public.change_proposals;c public.request_closures;notes text:=trim(coalesce(p_notes,''));
begin
 if u is null then raise sqlstate 'PT401' using message='UNAUTHORIZED';end if;
 if p_reason not in('rejected','withdrawn') or p_reason is null or length(notes)>4000 then raise sqlstate 'PT422' using message='INVALID_REQUEST_CLOSURE';end if;
 select * into d from public.documents where id=p_request_id and owner_id=u and kind='email_request';
 if not found then raise sqlstate 'PT404' using message='REQUEST_DOCUMENT_NOT_FOUND';end if;
 perform private.ensure_active_project(d.project_id,u);
 perform 1 from public.projects where id=d.project_id and owner_id=u for update;
 select * into c from public.request_closures where request_document_id=d.id;
 if found then
  if c.reason<>p_reason or c.notes<>notes then raise sqlstate 'PT409' using message='REQUEST_ALREADY_CLOSED';end if;
  return to_jsonb(c);
 end if;
 select * into p from public.change_proposals where request_document_id=d.id and owner_id=u for update;
 if found then
  if p.locked_at is not null then raise sqlstate 'PT409' using message='CHANGE_READ_ONLY';end if;
  if p.status='accepted' or exists(select 1 from public.proposal_acceptances where proposal_id=p.id)
    or exists(select 1 from public.proposal_payments where proposal_id=p.id) then raise sqlstate 'PT409' using message='ACCEPTED_CHANGE_REQUIRES_REVIEW';end if;
  if exists(select 1 from public.proposal_deliveries where proposal_id=p.id and status in('sending','delivery_uncertain')) then raise sqlstate 'PT409' using message='EMAIL_DELIVERY_UNCERTAIN';end if;
  update public.change_proposals set locked_at=now() where id=p.id;
 end if;
 insert into public.request_closures(request_document_id,owner_id,project_id,reason,notes) values(d.id,u,d.project_id,p_reason,notes) returning * into c;
 return to_jsonb(c);
end $$;
commit;
