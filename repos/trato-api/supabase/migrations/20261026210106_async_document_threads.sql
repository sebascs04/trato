begin;
-- Shared infrastructure. The workflow handler owns its subject validation.
create table public.worker_threads (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
 project_id uuid not null, workflow text not null check(workflow ~ '^[a-z_]{1,64}$'),
 subject_id uuid not null, command_event_id uuid not null default gen_random_uuid() unique,
 status text not null default 'queued' check(status in('queued','processing','ready','error')),
 phase text not null default 'queued', error_code text, lease_id uuid, lease_until timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(project_id,owner_id) references public.projects(id,owner_id)
);
create index worker_threads_owner_project on public.worker_threads(owner_id,project_id,created_at);
create index worker_threads_subject on public.worker_threads(subject_id,created_at);
create table public.thread_outbox (
 id uuid primary key default gen_random_uuid(), thread_id uuid not null unique references public.worker_threads(id),
 envelope jsonb not null, published_at timestamptz, lease_id uuid, lease_until timestamptz,
 created_at timestamptz not null default now()
);
create index thread_outbox_pending on public.thread_outbox(created_at) where published_at is null;
create table public.thread_inbox (
 event_id uuid primary key, thread_id uuid not null references public.worker_threads(id),
 result_hash text not null, received_at timestamptz not null default now()
);
create index thread_inbox_thread on public.thread_inbox(thread_id);
alter table public.document_extractions add column worker_thread_id uuid references public.worker_threads(id);
create index extractions_thread on public.document_extractions(worker_thread_id);
alter table public.worker_threads enable row level security;
alter table public.thread_outbox enable row level security;
alter table public.thread_inbox enable row level security;
revoke all on public.worker_threads,public.thread_outbox,public.thread_inbox from anon,authenticated;
grant select(id,owner_id,project_id,workflow,subject_id,status,phase,error_code,created_at,updated_at) on public.worker_threads to authenticated;
create policy own_active_threads on public.worker_threads for select to authenticated using(
 owner_id=(select auth.uid()) and exists(select 1 from public.projects p join public.clients c on c.id=p.client_id
 where p.id=project_id and p.owner_id=worker_threads.owner_id and c.deleted_at is null));

create function private.queue_document(p_document_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();d public.documents;e public.document_extractions;j public.worker_threads;c uuid;envelope jsonb;
begin
 if u is null then raise sqlstate 'PT401' using message='UNAUTHORIZED';end if;
 select * into d from public.documents where id=p_document_id and owner_id=u for update;
 if not found then raise sqlstate 'PT404' using message='DOCUMENT_NOT_FOUND';end if;
 perform private.ensure_active_project(d.project_id,u);
 if d.mime_type<>'application/pdf' then raise sqlstate 'PT422' using message='PDF_REQUIRED';end if;
 select * into e from public.document_extractions where document_id=d.id for update;
 if not found then raise sqlstate 'PT422' using message='EXTRACTION_NOT_REGISTERED';end if;
 if e.status='ready' then return jsonb_build_object('thread_id',e.worker_thread_id,'status','ready');end if;
 if e.worker_thread_id is not null then
  select * into j from public.worker_threads where id=e.worker_thread_id;
  if j.status in('queued','processing') then return jsonb_build_object('thread_id',j.id,'status',j.status);end if;
 end if;
 if not exists(select 1 from storage.objects where bucket_id='project-documents' and name=d.storage_path
  and owner_id=u::text and (metadata->>'size')::bigint=d.size_bytes) then raise sqlstate 'PT409' using message='ORIGINAL_NOT_STORED';end if;
 select client_id into c from public.projects where id=d.project_id;
 insert into public.worker_threads(owner_id,project_id,workflow,subject_id) values(u,d.project_id,'ingest_document',d.id) returning * into j;
 envelope:=jsonb_build_object('type','thread','schema_version',1,'mode','connected','thread_id',j.id,'event_id',j.command_event_id,
  'action','start','workflow',j.workflow,'context',jsonb_build_object('owner_id',u,'client_id',c,'project_id',d.project_id),
  'payload',jsonb_build_object('document_id',d.id,'extraction_id',e.id,'kind',d.kind,'sha256',d.sha256));
 insert into public.thread_outbox(thread_id,envelope) values(j.id,envelope);
 update public.document_extractions set worker_thread_id=j.id,status='queued',error_code=null where id=e.id;
 return jsonb_build_object('thread_id',j.id,'status','queued');
end $$;
revoke all on function private.queue_document(uuid) from public,anon;
grant execute on function private.queue_document(uuid) to authenticated;
create function public.queue_document(p_document_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.queue_document(p_document_id);$$;
revoke all on function public.queue_document(uuid) from public,anon;
grant execute on function public.queue_document(uuid) to authenticated;

-- Server-only entry point. Never accept this credential or action from the browser.
create function private.thread_backend(p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.worker_threads;o public.thread_outbox;d public.documents;e public.document_extractions;
 m jsonb;h text;old_hash text;u uuid;c uuid;outcome jsonb;event uuid;
begin
 if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role'
  and coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'role' is distinct from 'service_role' then
  raise sqlstate 'PT403' using message='BACKEND_ONLY';end if;
 if p_action='relay_claim' then
  select b.* into o from public.thread_outbox b join public.worker_threads t on t.id=b.thread_id
   join public.projects p on p.id=t.project_id join public.clients c on c.id=p.client_id
   where (b.published_at is null or (b.published_at<now()-interval '120 seconds' and
    (t.status='queued' or (t.status='processing' and t.lease_until<now()))))
   and (b.lease_until is null or b.lease_until<now()) and c.deleted_at is null
   order by b.created_at for update of b skip locked limit 1;
  if not found then return null;end if;
  update public.thread_outbox set published_at=null,lease_id=gen_random_uuid(),lease_until=now()+interval '30 seconds' where id=o.id returning * into o;
  return jsonb_build_object('id',o.id,'lease_id',o.lease_id,'envelope',o.envelope);
 elsif p_action='relay_published' then
  update public.thread_outbox set published_at=now(),lease_until=null where id=(p_data->>'id')::uuid
   and lease_id=(p_data->>'lease_id')::uuid and published_at is null;
  return jsonb_build_object('published',found);
 end if;
 m:=p_data->'message';
 select * into j from public.worker_threads where id=(m->>'thread_id')::uuid for update;
 if not found then raise sqlstate 'PT404' using message='THREAD_NOT_FOUND';end if;
 select * into o from public.thread_outbox where thread_id=j.id;
 if p_action='input' then
  perform private.ensure_active_project(j.project_id,j.owner_id);
  if j.status<>'processing' or j.lease_id is distinct from (p_data->>'lease_id')::uuid or j.lease_until<now() then
   raise sqlstate 'PT409' using message='STALE_THREAD';end if;
  select * into d from public.documents where id=j.subject_id and project_id=j.project_id and owner_id=j.owner_id;
  if not found then raise sqlstate 'PT404' using message='DOCUMENT_NOT_FOUND';end if;
  return to_jsonb(d);
 end if;
 if p_action='claim' then
  if m is distinct from o.envelope then raise sqlstate 'PT409' using message='THREAD_CONTEXT_CONFLICT';end if;
  perform private.ensure_active_project(j.project_id,j.owner_id);
  if j.status in('ready','error') then return jsonb_build_object('terminal',true,'status',j.status);end if;
  if j.lease_until>now() then raise sqlstate 'PT409' using message='THREAD_BUSY';end if;
  update public.worker_threads set lease_id=gen_random_uuid(),lease_until=now()+interval '120 seconds',
   status='processing',phase='reading_original',updated_at=now() where id=j.id returning * into j;
  select * into d from public.documents where id=j.subject_id and project_id=j.project_id and owner_id=j.owner_id;
  if not found then raise sqlstate 'PT404' using message='DOCUMENT_NOT_FOUND';end if;
  select * into e from public.document_extractions where document_id=d.id;
  if e.worker_thread_id is distinct from j.id then raise sqlstate 'PT409' using message='STALE_THREAD';end if;
  return jsonb_build_object('terminal',false,'lease_id',j.lease_id,'document',to_jsonb(d),'extraction_id',e.id);
 elsif p_action='result' then
  if m->>'mode' is distinct from 'connected' or m->>'type' is distinct from 'thread'
   or m->>'schema_version' is distinct from '1' or m->>'workflow' is distinct from j.workflow
   or m->>'causation_id' is distinct from j.command_event_id::text
   or m->'context' is distinct from o.envelope->'context' then raise sqlstate 'PT409' using message='THREAD_CONTEXT_CONFLICT';end if;
  event:=(m->>'event_id')::uuid;h:=encode(sha256(convert_to(m::text,'UTF8')),'hex');
  select result_hash into old_hash from public.thread_inbox where event_id=event;
  if found then
   if old_hash<>h then raise sqlstate 'PT409' using message='EVENT_CONFLICT';end if;
   return jsonb_build_object('duplicate',true);
  end if;
  if j.status in('ready','error') or (m->>'lease_id')::uuid is distinct from j.lease_id then
   return jsonb_build_object('discarded',true,'reason','STALE_RESULT');end if;
  if not exists(select 1 from public.projects p join public.clients c on c.id=p.client_id
   where p.id=j.project_id and c.deleted_at is null) then
   update public.worker_threads set status='error',phase='error',error_code='PROJECT_NOT_FOUND',updated_at=now() where id=j.id;
   return jsonb_build_object('discarded',true,'reason','PROJECT_NOT_FOUND');end if;
  select * into e from public.document_extractions where document_id=j.subject_id;
  if e.worker_thread_id is distinct from j.id then return jsonb_build_object('discarded',true,'reason','STALE_RESULT');end if;
  -- Reuse audited domain persistence with the trusted job owner, never a queue-supplied owner.
  perform set_config('request.jwt.claim.sub',j.owner_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',j.owner_id,'role','service_role')::text,true);
  if m->>'action'='completed' then
   outcome:=private.complete_document_ingestion(j.subject_id,m->'result'->'extraction');
   update public.worker_threads set status='ready',phase='text_ready',lease_until=null,updated_at=now() where id=j.id;
  elsif m->>'action'='failed' then
   perform private.fail_document_ingestion(j.subject_id,m->'result'->>'error_code');
   update public.worker_threads set status='error',phase='error',error_code=m->'result'->>'error_code',lease_until=null,updated_at=now() where id=j.id;
  elsif m->>'action'='progress' then
   if m->'result'->>'step' not in('reading_original','extracting_text') then raise sqlstate 'PT422' using message='INVALID_THREAD_PHASE';end if;
   update public.worker_threads set phase=m->'result'->>'step',updated_at=now() where id=j.id;
  else raise sqlstate 'PT422' using message='INVALID_THREAD_ACTION';end if;
  insert into public.thread_inbox(event_id,thread_id,result_hash) values(event,j.id,h);
  return jsonb_build_object('stored',true);
 end if;
 raise sqlstate 'PT422' using message='INVALID_THREAD_ACTION';
end $$;
revoke all on function private.thread_backend(text,jsonb) from public,anon,authenticated;
grant usage on schema private to service_role;
grant execute on function private.thread_backend(text,jsonb) to service_role;
create function public.thread_backend(p_action text,p_data jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.thread_backend(p_action,p_data);$$;
revoke all on function public.thread_backend(text,jsonb) from public,anon,authenticated;
grant execute on function public.thread_backend(text,jsonb) to service_role;
commit;
