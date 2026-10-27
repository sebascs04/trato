-- Fresh Trato database. Business approvals/payments are intentionally not inferred here.
begin;
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table public.clients (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null default auth.uid() references auth.users(id),
 name text not null check (length(trim(name)) between 1 and 200),
 contact_email text check (contact_email is null or length(contact_email) between 3 and 254),
 created_at timestamptz not null default now(), unique(id,owner_id)
);
create table public.projects (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null default auth.uid() references auth.users(id),
 client_id uuid not null,
 name text not null check (length(trim(name)) between 1 and 200),
 status text not null default 'draft' check (status in ('draft','active','closed')),
 created_at timestamptz not null default now(), unique(id,owner_id),
 foreign key(client_id,owner_id) references public.clients(id,owner_id)
);
create table public.documents (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null default auth.uid() references auth.users(id),
 project_id uuid not null,
 title text not null check (length(trim(title)) between 1 and 200),
 kind text not null check (kind in ('initial_agreement','email_request','reference','addendum','delivery')),
 original_filename text not null check (length(original_filename) between 1 and 255),
 mime_type text not null check (mime_type in ('application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
 size_bytes integer not null check (size_bytes between 1 and 10485760),
 sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
 origin_status text not null default 'unverified' check (origin_status='unverified'),
 ingestion_key text not null check (length(ingestion_key) between 1 and 128),
 command_hash text not null check (command_hash ~ '^[a-f0-9]{64}$'),
 storage_path text generated always as
   (owner_id::text || '/' || project_id::text || '/' || id::text ||
     case when mime_type='application/pdf' then '.pdf' else '.docx' end) stored unique,
 created_at timestamptz not null default now(),
 unique(id,project_id,owner_id), unique(owner_id,project_id,ingestion_key),
 foreign key(project_id,owner_id) references public.projects(id,owner_id)
);
create table public.document_extractions (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null,
 project_id uuid not null, document_id uuid not null,
 status text not null default 'queued' check (status in ('queued','ready','error')),
 parser text, parser_version text, result_hash text,
 warnings jsonb not null default '[]'::jsonb check (jsonb_typeof(warnings)='array'),
 error_code text, created_at timestamptz not null default now(), completed_at timestamptz,
 unique(document_id,project_id,owner_id), unique(id,document_id,project_id,owner_id),
 foreign key(document_id,project_id,owner_id) references public.documents(id,project_id,owner_id),
 check (status <> 'ready' or (parser is not null and parser_version is not null and result_hash is not null and completed_at is not null))
);
create table public.document_segments (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null,
 project_id uuid not null, document_id uuid not null, extraction_id uuid not null,
 ordinal integer not null check (ordinal between 1 and 100000),
 locator_kind text not null check (locator_kind in ('page','paragraph')),
 locator_number integer not null check (locator_number between 1 and 100000),
 text text not null check (length(trim(text))>0 and octet_length(text)<=250000),
 unique(extraction_id,ordinal),
 foreign key(extraction_id,document_id,project_id,owner_id)
   references public.document_extractions(id,document_id,project_id,owner_id)
);
create table public.project_events (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null,
 project_id uuid not null, document_id uuid not null,
 event_type text not null check (event_type in ('document_registered','extraction_completed','extraction_failed')),
 actor_id uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 unique(document_id,event_type),
 foreign key(document_id,project_id,owner_id) references public.documents(id,project_id,owner_id)
);
create index clients_owner_idx on public.clients(owner_id,created_at);
create index projects_client_owner_idx on public.projects(client_id,owner_id);
create index projects_owner_idx on public.projects(owner_id,created_at);
create index documents_project_owner_idx on public.documents(project_id,owner_id,created_at);
create index extractions_owner_idx on public.document_extractions(owner_id);
create index segments_source_idx on public.document_segments(extraction_id,document_id,project_id,owner_id);
create index segments_project_owner_idx on public.document_segments(project_id,owner_id);
create index events_document_owner_idx on public.project_events(document_id,project_id,owner_id);
create index events_project_date_idx on public.project_events(project_id,owner_id,created_at);
create index events_actor_idx on public.project_events(actor_id);

do $$ declare t text; begin
 foreach t in array array['clients','projects','documents','document_extractions','document_segments','project_events'] loop
   execute format('alter table public.%I enable row level security',t);
   execute format('revoke all on table public.%I from public, anon, authenticated',t);
   execute format('grant select on table public.%I to authenticated',t);
   execute format('create policy own_rows on public.%I for select to authenticated using (owner_id=(select auth.uid()))',t);
 end loop;
end $$;
grant usage on schema public to authenticated;
create policy create_client on public.clients for insert to authenticated with check (owner_id=(select auth.uid()));
create policy create_project on public.projects for insert to authenticated with check (owner_id=(select auth.uid()));
grant insert(name,contact_email) on public.clients to authenticated;
grant insert(client_id,name) on public.projects to authenticated;

-- Narrow atomic operations: direct writes to raw source, extraction state and history
-- remain forbidden. Definer functions live outside the Data API and authorize auth.uid().
-- All ingested content remains UNVERIFIED, including text supplied through these RPCs.
create function private.reserve_document(p_project_id uuid,p_title text,p_kind text,
 p_filename text,p_mime text,p_size integer,p_sha256 text,p_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); d public.documents; e public.document_extractions; h text;
begin
 if u is null then raise sqlstate 'PT401' using message='UNAUTHORIZED'; end if;
 if not exists(select 1 from public.projects where id=p_project_id and owner_id=u) then
   raise sqlstate 'PT404' using message='PROJECT_NOT_FOUND'; end if;
 h:=encode(sha256(convert_to(jsonb_build_object('title',p_title,'kind',p_kind,'filename',p_filename,
   'mime',p_mime,'size',p_size,'sha256',p_sha256)::text,'UTF8')),'hex');
 insert into public.documents(owner_id,project_id,title,kind,original_filename,mime_type,size_bytes,sha256,ingestion_key,command_hash)
 values(u,p_project_id,p_title,p_kind,p_filename,p_mime,p_size,p_sha256,p_key,h)
 on conflict(owner_id,project_id,ingestion_key) do nothing;
 select * into d from public.documents where owner_id=u and project_id=p_project_id and ingestion_key=p_key for update;
 if d.command_hash<>h then raise sqlstate 'PT409' using message='IDEMPOTENCY_CONFLICT'; end if;
 insert into public.document_extractions(owner_id,project_id,document_id) values(u,p_project_id,d.id)
   on conflict(document_id,project_id,owner_id) do nothing;
 select * into e from public.document_extractions where document_id=d.id and owner_id=u;
 insert into public.project_events(owner_id,project_id,document_id,event_type,actor_id)
   values(u,p_project_id,d.id,'document_registered',u) on conflict(document_id,event_type) do nothing;
 return jsonb_build_object('document',to_jsonb(d)-'command_hash'-'ingestion_key','extraction',to_jsonb(e));
end $$;

create function private.complete_document_ingestion(p_document_id uuid,p_result jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); d public.documents; e public.document_extractions;
 s jsonb; item_text text; n integer:=0; total integer:=0; pos integer; loc text; num integer; h text;
begin
 if u is null then raise sqlstate 'PT401' using message='UNAUTHORIZED'; end if;
 select * into d from public.documents where id=p_document_id and owner_id=u for update;
 if not found then raise sqlstate 'PT404' using message='DOCUMENT_NOT_FOUND'; end if;
 select * into e from public.document_extractions where document_id=d.id and owner_id=u for update;
 if jsonb_typeof(p_result) is distinct from 'object' or octet_length(p_result::text)>4000000
    or p_result->>'schema_version' is distinct from '1'
    or p_result->>'sha256' is distinct from d.sha256
    or p_result->>'size_bytes' is distinct from d.size_bytes::text
    or jsonb_typeof(p_result->'segments') is distinct from 'array'
    or jsonb_array_length(p_result->'segments') not between 1 and 4096
    or coalesce(length(p_result->>'parser'),0) not between 1 and 80
    or coalesce(length(p_result->>'parser_version'),0) not between 1 and 80
    or jsonb_typeof(p_result->'warnings') is distinct from 'array'
    or jsonb_array_length(p_result->'warnings')>20 then
   raise sqlstate 'PT422' using message='INVALID_EXTRACTION'; end if;
 if (d.mime_type='application/pdf' and p_result->>'format' is distinct from 'pdf') or
    (d.mime_type<>'application/pdf' and p_result->>'format' is distinct from 'docx') then
   raise sqlstate 'PT422' using message='FORMAT_MISMATCH'; end if;
 if not exists(select 1 from storage.objects where bucket_id='project-documents' and name=d.storage_path
    and owner_id=u::text and (metadata->>'size')::bigint=d.size_bytes) then
   raise sqlstate 'PT409' using message='ORIGINAL_NOT_STORED'; end if;
 h:=encode(sha256(convert_to(jsonb_build_object('parser',p_result->'parser','version',p_result->'parser_version',
    'segments',p_result->'segments','warnings',p_result->'warnings')::text,'UTF8')),'hex');
 if e.status='ready' then
   if e.result_hash<>h then raise sqlstate 'PT409' using message='EXTRACTION_CONFLICT'; end if;
   return jsonb_build_object('document',to_jsonb(d)-'command_hash'-'ingestion_key','extraction',to_jsonb(e));
 end if;
 for s in select value from jsonb_array_elements(p_result->'segments') loop
   if jsonb_typeof(s->'text') is distinct from 'string' or s->>'index' !~ '^[0-9]{1,6}$' then
     raise sqlstate 'PT422' using message='INVALID_SEGMENT'; end if;
   item_text:=s->>'text'; pos:=(s->>'index')::integer; loc:=s->'locator'->>'kind';
   if loc not in ('page','paragraph') or loc is null
      or (d.mime_type='application/pdf' and loc<>'page')
      or (d.mime_type<>'application/pdf' and loc<>'paragraph')
      or coalesce(s->'locator'->>loc,'') !~ '^[0-9]{1,6}$' then
     raise sqlstate 'PT422' using message='INVALID_LOCATOR'; end if;
   num:=(s->'locator'->>loc)::integer;
   if length(trim(item_text))=0 or pos<1 or pos>100000 or num<>pos then
     raise sqlstate 'PT422' using message='INVALID_SEGMENT'; end if;
   total:=total+octet_length(item_text); n:=n+1;
   if total+greatest(n-1,0)*2>250000 then raise sqlstate 'PT422' using message='TEXT_TOO_LARGE'; end if;
   insert into public.document_segments(owner_id,project_id,document_id,extraction_id,ordinal,locator_kind,locator_number,text)
     values(u,d.project_id,d.id,e.id,pos,loc,num,item_text);
 end loop;
 update public.document_extractions set status='ready',parser=p_result->>'parser',parser_version=p_result->>'parser_version',
   warnings=p_result->'warnings',result_hash=h,error_code=null,completed_at=now() where id=e.id returning * into e;
 insert into public.project_events(owner_id,project_id,document_id,event_type,actor_id)
   values(u,d.project_id,d.id,'extraction_completed',u) on conflict(document_id,event_type) do nothing;
 return jsonb_build_object('document',to_jsonb(d)-'command_hash'-'ingestion_key','extraction',to_jsonb(e));
end $$;

create function private.fail_document_ingestion(p_document_id uuid,p_code text)
returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); d public.documents;
begin
 if u is null then raise sqlstate 'PT401' using message='UNAUTHORIZED'; end if;
 select * into d from public.documents where id=p_document_id and owner_id=u for update;
 if not found then raise sqlstate 'PT404' using message='DOCUMENT_NOT_FOUND'; end if;
 if p_code is null or p_code !~ '^[A-Z0-9_]{1,80}$' then raise sqlstate 'PT422' using message='INVALID_ERROR_CODE'; end if;
 update public.document_extractions set status='error',error_code=p_code where document_id=d.id and status<>'ready';
 if found then
   insert into public.project_events(owner_id,project_id,document_id,event_type,actor_id)
    values(u,d.project_id,d.id,'extraction_failed',u) on conflict(document_id,event_type) do nothing;
 end if;
end $$;

revoke all on function private.reserve_document(uuid,text,text,text,text,integer,text,text) from public,anon;
revoke all on function private.complete_document_ingestion(uuid,jsonb) from public,anon;
revoke all on function private.fail_document_ingestion(uuid,text) from public,anon;
grant execute on function private.reserve_document(uuid,text,text,text,text,integer,text,text) to authenticated;
grant execute on function private.complete_document_ingestion(uuid,jsonb) to authenticated;
grant execute on function private.fail_document_ingestion(uuid,text) to authenticated;

create function public.reserve_document(p_project_id uuid,p_title text,p_kind text,p_filename text,p_mime text,p_size integer,p_sha256 text,p_key text)
returns jsonb language sql security invoker set search_path='' as $$
 select private.reserve_document(p_project_id,p_title,p_kind,p_filename,p_mime,p_size,p_sha256,p_key); $$;
create function public.complete_document_ingestion(p_document_id uuid,p_result jsonb)
returns jsonb language sql security invoker set search_path='' as $$ select private.complete_document_ingestion(p_document_id,p_result); $$;
create function public.fail_document_ingestion(p_document_id uuid,p_code text)
returns void language sql security invoker set search_path='' as $$ select private.fail_document_ingestion(p_document_id,p_code); $$;
revoke all on function public.reserve_document(uuid,text,text,text,text,integer,text,text) from public,anon;
revoke all on function public.complete_document_ingestion(uuid,jsonb) from public,anon;
revoke all on function public.fail_document_ingestion(uuid,text) from public,anon;
grant execute on function public.reserve_document(uuid,text,text,text,text,integer,text,text) to authenticated;
grant execute on function public.complete_document_ingestion(uuid,jsonb) to authenticated;
grant execute on function public.fail_document_ingestion(uuid,text) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('project-documents','project-documents',false,10485760,
 array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document']);
create policy read_project_documents on storage.objects for select to authenticated using (
 bucket_id='project-documents' and exists(select 1 from public.documents d
   where d.storage_path=name and d.owner_id=(select auth.uid())));
create policy upload_project_documents on storage.objects for insert to authenticated with check (
 bucket_id='project-documents' and owner_id=(select auth.uid())::text and exists(select 1 from public.documents d
   join public.document_extractions e on e.document_id=d.id where d.storage_path=name
   and d.owner_id=(select auth.uid()) and e.status in ('queued','error')));
-- No overwrite/delete policy: source bytes cannot be replaced after registration.
commit;
