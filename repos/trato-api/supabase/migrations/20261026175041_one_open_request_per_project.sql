begin;
create table public.request_closures(
 request_document_id uuid primary key,owner_id uuid not null,project_id uuid not null,
 reason text not null check(reason in('rejected','withdrawn')),
 notes text not null check(length(trim(notes)) between 1 and 4000),closed_at timestamptz not null default now(),
 foreign key(request_document_id,project_id,owner_id) references public.documents(id,project_id,owner_id)
);
create index request_closures_owner_project_idx on public.request_closures(owner_id,project_id);
create index request_closures_document_fk_idx on public.request_closures(request_document_id,project_id,owner_id);
alter table public.request_closures enable row level security;
revoke all on public.request_closures from public,anon,authenticated;
grant select on public.request_closures to authenticated;
create policy own_active_closures on public.request_closures for select to authenticated using(owner_id=(select auth.uid()) and exists(select 1 from public.projects p where p.id=request_closures.project_id and p.owner_id=request_closures.owner_id));
create function private.project_request_status(p_project_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); active jsonb; closures jsonb;
begin
 if u is null then raise sqlstate 'PT401' using message='UNAUTHORIZED';end if;
 perform private.ensure_active_project(p_project_id,u);
 select jsonb_build_object('id',d.id,'title',d.title) into active
 from public.documents d left join public.change_proposals p on p.request_document_id=d.id and p.owner_id=u
 where d.project_id=p_project_id and d.owner_id=u and d.kind='email_request' and p.locked_at is null
 and not exists(select 1 from public.request_closures c where c.request_document_id=d.id)
 order by d.created_at,d.id limit 1;
 select coalesce(jsonb_agg(to_jsonb(c) order by c.closed_at),'[]'::jsonb) into closures from public.request_closures c where c.project_id=p_project_id and c.owner_id=u;
 return jsonb_build_object('can_register',active is null,'active_request',active,'closures',closures);
end $$;
revoke all on function private.project_request_status(uuid) from public,anon;
grant execute on function private.project_request_status(uuid) to authenticated;
create function public.project_request_status(p_project_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.project_request_status(p_project_id)$$;
revoke all on function public.project_request_status(uuid) from public,anon;
grant execute on function public.project_request_status(uuid) to authenticated;
create function private.close_change_request(p_request_id uuid,p_reason text,p_notes text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();d public.documents;p public.change_proposals;c public.request_closures;
begin
 if u is null then raise sqlstate 'PT401' using message='UNAUTHORIZED';end if;
 if p_reason not in('rejected','withdrawn') or p_reason is null or length(trim(coalesce(p_notes,''))) not between 1 and 4000 then raise sqlstate 'PT422' using message='INVALID_REQUEST_CLOSURE';end if;
 select * into d from public.documents where id=p_request_id and owner_id=u and kind='email_request';
 if not found then raise sqlstate 'PT404' using message='REQUEST_DOCUMENT_NOT_FOUND';end if;
 perform private.ensure_active_project(d.project_id,u);
 perform 1 from public.projects where id=d.project_id and owner_id=u for update;
 select * into c from public.request_closures where request_document_id=d.id;
 if found then
  if c.reason<>p_reason or c.notes<>trim(p_notes) then raise sqlstate 'PT409' using message='REQUEST_ALREADY_CLOSED';end if;
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
 insert into public.request_closures(request_document_id,owner_id,project_id,reason,notes) values(d.id,u,d.project_id,p_reason,trim(p_notes)) returning * into c;
 return to_jsonb(c);
end $$;
revoke all on function private.close_change_request(uuid,text,text) from public,anon;
grant execute on function private.close_change_request(uuid,text,text) to authenticated;
create function public.close_change_request(p_request_id uuid,p_reason text,p_notes text) returns jsonb language sql security invoker set search_path='' as $$select private.close_change_request(p_request_id,p_reason,p_notes)$$;
revoke all on function public.close_change_request(uuid,text,text) from public,anon;
grant execute on function public.close_change_request(uuid,text,text) to authenticated;
do $migration$ declare definition text;needle text;begin
 definition:=pg_get_functiondef('private.reserve_document(uuid,text,text,text,text,integer,text,text)'::regprocedure);
 needle:=$n$ insert into public.documents(owner_id,project_id,title,kind,original_filename,mime_type,size_bytes,sha256,ingestion_key,command_hash)$n$;
 if position(needle in definition)=0 then raise exception 'Document reservation branch changed';end if;
 definition:=replace(definition,needle,$n$ if p_kind='email_request' then
  perform 1 from public.projects where id=p_project_id and owner_id=u for update;
  if not exists(select 1 from public.documents where owner_id=u and project_id=p_project_id and ingestion_key=p_key)
   and (private.project_request_status(p_project_id)->>'can_register')::boolean is false then raise sqlstate 'PT409' using message='PROJECT_HAS_OPEN_REQUEST';end if;
 end if;
$n$||needle);
 execute definition;
 definition:=pg_get_functiondef('private.proposal_command(text,jsonb,text)'::regprocedure);
 needle:=$n$ perform private.ensure_active_project(project,u);$n$;
 if position(needle in definition)=0 then raise exception 'Active project guard changed';end if;
 definition:=replace(definition,needle,needle||$n$
 perform 1 from public.projects where id=project and owner_id=u for update;
 if p_action='create' and exists(select 1 from public.request_closures where request_document_id=(p_data->>'request_document_id')::uuid and owner_id=u) then raise sqlstate 'PT409' using message='REQUEST_ALREADY_CLOSED';end if;
$n$);
 execute definition;
 definition:=pg_get_functiondef('private.proposal_backend(uuid,text,jsonb)'::regprocedure);
 needle:=$n$ if p_action='payment_prepare' then$n$;
 if position(needle in definition)=0 then raise exception 'Provider reservation branch changed';end if;
 definition:=replace(definition,needle,$n$ if p_action in('mail_reserve','payment_prepare') and p.locked_at is not null then raise sqlstate 'PT409' using message='CHANGE_READ_ONLY';end if;
$n$||needle);
 execute definition;
end $migration$;
commit;
