begin;
create table public.case_assistant_sessions (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
 project_id uuid not null references public.projects(id), client_id uuid not null references public.clients(id),
 case_kind text not null check(case_kind in ('change','refund')), case_id uuid not null, revision_id uuid,
 created_at timestamptz not null default now(), unique nulls not distinct(owner_id,case_kind,case_id,revision_id)
);
create table public.case_assistant_messages (
 id uuid primary key default gen_random_uuid(),session_id uuid not null references public.case_assistant_sessions(id),
 owner_id uuid not null references auth.users(id),job_id uuid not null unique,
 question text not null check(length(trim(question)) between 1 and 4000),
 output_language text not null check(output_language in ('es','en')),
 status text not null default 'queued' check(status in ('queued','completed','failed')),
 result jsonb,error_code text,created_at timestamptz not null default now(),
 check ((status='queued' and result is null and error_code is null) or (status='completed' and result is not null and error_code is null) or (status='failed' and result is null and error_code is not null))
);
create unique index case_assistant_one_pending on public.case_assistant_messages(session_id) where status='queued';
alter table public.case_assistant_sessions enable row level security;
alter table public.case_assistant_messages enable row level security;
create policy case_assistant_sessions_read on public.case_assistant_sessions for select to authenticated using(owner_id=auth.uid() and exists(select 1 from public.projects p join public.clients c on c.id=p.client_id where p.id=project_id and p.owner_id=auth.uid() and p.deleted_at is null and c.deleted_at is null));
create policy case_assistant_messages_read on public.case_assistant_messages for select to authenticated using(owner_id=auth.uid() and exists(select 1 from public.case_assistant_sessions s where s.id=session_id));
grant select on public.case_assistant_sessions,public.case_assistant_messages to authenticated;
revoke all on public.case_assistant_sessions,public.case_assistant_messages from anon;
grant all on public.case_assistant_sessions,public.case_assistant_messages to service_role;

-- Verify the authoritative case under its project lock on every creation/reservation.
create function public.case_assistant_context(p_kind text,p_case uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare r record;p public.projects;rev uuid;
begin
 if auth.uid() is null then raise sqlstate 'PT401' using message='UNAUTHORIZED';end if;
 if p_kind='change' then
  select project_id,current_revision_id as revision_id into r from public.change_proposals where id=p_case and owner_id=auth.uid();
 elsif p_kind='refund' then
  select project_id,current_snapshot_id as revision_id into r from public.refund_settlements where id=p_case and owner_id=auth.uid();
 else raise sqlstate 'PT422' using message='AI_INVALID_INPUT';end if;
 if r.project_id is null then raise sqlstate 'PT404' using message='AI_CASE_NOT_FOUND';end if;
 select * into p from public.projects where id=r.project_id and owner_id=auth.uid() and deleted_at is null for update;
 if p.id is null or not exists(select 1 from public.clients where id=p.client_id and owner_id=auth.uid() and deleted_at is null) then raise sqlstate 'PT404' using message='AI_CASE_NOT_FOUND';end if;
 -- Re-read after acquiring lock, because another command may have changed revision.
 if p_kind='change' then select current_revision_id into rev from public.change_proposals where id=p_case;
 else select current_snapshot_id into rev from public.refund_settlements where id=p_case;end if;
 return jsonb_build_object('project_id',p.id,'client_id',p.client_id,'revision_id',rev);
end $$;
create function public.case_assistant_open(p_kind text,p_case uuid,p_revision uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare c jsonb;s public.case_assistant_sessions;
begin
 c:=public.case_assistant_context(p_kind,p_case);
 if (c->>'revision_id')::uuid is distinct from p_revision then raise sqlstate 'PT409' using message='AI_CASE_STALE';end if;
 insert into public.case_assistant_sessions(owner_id,project_id,client_id,case_kind,case_id,revision_id)
 values(auth.uid(),(c->>'project_id')::uuid,(c->>'client_id')::uuid,p_kind,p_case,p_revision)
 on conflict(owner_id,case_kind,case_id,revision_id) do nothing;
 select * into s from public.case_assistant_sessions where owner_id=auth.uid() and case_kind=p_kind and case_id=p_case and revision_id is not distinct from p_revision;
 return to_jsonb(s);
end $$;
create function public.case_assistant_message(p_session uuid,p_job uuid,p_question text,p_language text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare s public.case_assistant_sessions;m public.case_assistant_messages;c jsonb;
begin
 select * into s from public.case_assistant_sessions where id=p_session and owner_id=auth.uid();
 if s.id is null then raise sqlstate 'PT404' using message='AI_CASE_NOT_FOUND';end if;
 c:=public.case_assistant_context(s.case_kind,s.case_id);
 if (c->>'revision_id')::uuid is distinct from s.revision_id then raise sqlstate 'PT409' using message='AI_CASE_STALE';end if;
 select * into m from public.case_assistant_messages where job_id=p_job;
 if m.id is not null then
  if m.owner_id<>auth.uid() or m.session_id<>s.id or m.question<>p_question or m.output_language<>p_language then raise sqlstate 'PT409' using message='AI_CONFLICT';end if;
  return to_jsonb(m);
 end if;
 if exists(select 1 from public.case_assistant_messages where session_id=s.id and status='queued') then raise sqlstate 'PT409' using message='AI_CASE_BUSY';end if;
 if (select count(*) from public.case_assistant_messages where session_id=s.id)>=100 then raise sqlstate 'PT413' using message='AI_CONTEXT_LIMIT';end if;
 insert into public.case_assistant_messages(session_id,owner_id,job_id,question,output_language) values(s.id,auth.uid(),p_job,p_question,p_language) returning * into m;
 return to_jsonb(m);
end $$;
create function public.case_assistant_outcome(p_owner uuid,p_job uuid,p_result jsonb,p_error text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare m public.case_assistant_messages;s public.case_assistant_sessions;rev uuid;
begin
 if (p_result is null)=(p_error is null) then raise sqlstate 'PT422' using message='AI_INVALID_INPUT';end if;
 select * into m from public.case_assistant_messages where job_id=p_job and owner_id=p_owner;
 if m.id is null then raise sqlstate 'PT404' using message='AI_NOT_FOUND';end if;
 select * into s from public.case_assistant_sessions where id=m.session_id and owner_id=p_owner;
 perform 1 from public.projects where id=s.project_id and owner_id=p_owner for update;
 if not found then raise sqlstate 'PT404' using message='AI_CASE_NOT_FOUND';end if;
 select * into m from public.case_assistant_messages where id=m.id for update;
 if p_result is not null then
  if not exists(select 1 from public.projects p join public.clients c on c.id=p.client_id where p.id=s.project_id and p.owner_id=p_owner and p.deleted_at is null and c.deleted_at is null) then raise sqlstate 'PT404' using message='AI_CASE_NOT_FOUND';end if;
  if s.case_kind='change' then select current_revision_id into rev from public.change_proposals where id=s.case_id and owner_id=p_owner;
  else select current_snapshot_id into rev from public.refund_settlements where id=s.case_id and owner_id=p_owner;end if;
  if rev is distinct from s.revision_id then raise sqlstate 'PT409' using message='AI_CASE_STALE';end if;
 end if;
 if m.status<>'queued' then
  if m.result is distinct from p_result or m.error_code is distinct from p_error then raise sqlstate 'PT409' using message='AI_CONFLICT';end if;
  return jsonb_build_object('stored',true);
 end if;
 update public.case_assistant_messages set status=case when p_error is null then 'completed' else 'failed' end,result=p_result,error_code=p_error where id=m.id;
 return jsonb_build_object('stored',true);
end $$;
revoke all on function public.case_assistant_context(text,uuid),public.case_assistant_open(text,uuid,uuid),public.case_assistant_message(uuid,uuid,text,text) from public,anon;
grant execute on function public.case_assistant_open(text,uuid,uuid),public.case_assistant_message(uuid,uuid,text,text) to authenticated;
revoke all on function public.case_assistant_outcome(uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.case_assistant_outcome(uuid,uuid,jsonb,text) to service_role;
commit;
