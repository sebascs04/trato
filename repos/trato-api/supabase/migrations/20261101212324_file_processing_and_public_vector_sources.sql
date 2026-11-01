begin;
create table public.file_processing_options(
 document_id uuid primary key, project_id uuid not null, owner_id uuid not null,
 output_language text not null check(output_language in('es','en')),
 purpose text, bindings jsonb not null default '{}'::jsonb check(jsonb_typeof(bindings)='object'),
 created_at timestamptz not null default now(),
 foreign key(document_id,project_id,owner_id) references public.documents(id,project_id,owner_id)
);
alter table public.file_processing_options enable row level security;
revoke all on public.file_processing_options from public,anon,authenticated;
grant select on public.file_processing_options to authenticated;
grant all on public.file_processing_options to service_role;
create policy options_owner_read on public.file_processing_options for select to authenticated using(
 owner_id=(select auth.uid()) and exists(select 1 from public.projects p join public.clients c on c.id=p.client_id
 where p.id=project_id and p.owner_id=auth.uid() and p.deleted_at is null and c.deleted_at is null));
create index file_options_owner on public.file_processing_options(owner_id);
create index file_options_project on public.file_processing_options(project_id);
create table public.file_processing_artifacts(
 document_id uuid not null, project_id uuid not null, owner_id uuid not null,
 source_generation text not null check(source_generation~'^[a-f0-9]{64}$'),
 stage text not null check(stage in('extraction','treatment','chunks','summary','outcome')),
 cache_key text not null check(cache_key~'^[a-f0-9]{64}$'),
 artifact_fingerprint text not null check(artifact_fingerprint~'^[a-f0-9]{64}$'),
 artifact jsonb not null check(jsonb_typeof(artifact)='object' and octet_length(artifact::text)<=2000000),
 created_at timestamptz not null default now(),
 primary key(document_id,stage,cache_key),
 foreign key(document_id,project_id,owner_id) references public.documents(id,project_id,owner_id)
);
alter table public.file_processing_artifacts enable row level security;
revoke all on public.file_processing_artifacts from public,anon,authenticated;
grant select on public.file_processing_artifacts to authenticated;
grant select,insert on public.file_processing_artifacts to service_role;
create policy artifacts_owner_read on public.file_processing_artifacts for select to authenticated using(
 owner_id=(select auth.uid()) and exists(select 1 from public.projects p join public.clients c on c.id=p.client_id
 where p.id=project_id and p.owner_id=auth.uid() and p.deleted_at is null and c.deleted_at is null));
create index file_artifacts_owner on public.file_processing_artifacts(owner_id);
create index file_artifacts_project on public.file_processing_artifacts(project_id);

create table private.reputation_vector_outbox(
 profile_id uuid primary key references private.reputation_clients(id),
 actor_id uuid not null references auth.users(id), generation bigint not null default 1,
 state text not null default 'pending' check(state in('pending','publishing','published')),
 lease_id uuid, leased_generation bigint, lease_until timestamptz,
 updated_at timestamptz not null default now()
);
alter table private.reputation_vector_outbox enable row level security;
revoke all on private.reputation_vector_outbox from public,anon,authenticated;
create index reputation_vector_pending on private.reputation_vector_outbox(state,lease_until,updated_at);
create function private.reputation_vector_changed() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into private.reputation_vector_outbox(profile_id,actor_id) values(new.profile_id,new.author_id)
 on conflict(profile_id) do update set actor_id=excluded.actor_id,generation=private.reputation_vector_outbox.generation+1,
 state='pending',updated_at=now();
 return new;
end $$;
revoke all on function private.reputation_vector_changed() from public,anon,authenticated;
create trigger reputation_vector_changed after insert or update of body,status,version on private.reputation_reviews
for each row execute function private.reputation_vector_changed();

create function public.reputation_vector_source(p_profile_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v jsonb;g bigint;
begin
 if auth.role() is distinct from 'service_role' then raise sqlstate '42501' using message='UNAUTHORIZED';end if;
 if not exists(select 1 from private.reputation_clients where id=p_profile_id and public_email is not null) then
  raise sqlstate 'PT404' using message='REPUTATION_NOT_FOUND';end if;
 select generation into g from private.reputation_vector_outbox where profile_id=p_profile_id;
 if (select count(*) from private.reputation_reviews where profile_id=p_profile_id and status='published')>1000 then
  raise sqlstate 'PT413' using message='REPUTATION_VECTOR_LIMIT';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'version',version,'body',body) order by id),'[]'::jsonb)
 into v from private.reputation_reviews where profile_id=p_profile_id and status='published';
 return jsonb_build_object('profile_id',p_profile_id,'generation',coalesce(g,0),'reviews',v);
end $$;
revoke all on function public.reputation_vector_source(uuid) from public,anon,authenticated;
grant execute on function public.reputation_vector_source(uuid) to service_role;

create function public.reputation_vector_event(p_action text,p_data jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r private.reputation_vector_outbox;
begin
 if auth.role() is distinct from 'service_role' then raise sqlstate '42501' using message='UNAUTHORIZED';end if;
 if p_action='claim' then
  select * into r from private.reputation_vector_outbox where state<>'published' and(lease_until is null or lease_until<now())
  order by updated_at for update skip locked limit 1;
  if not found then return null;end if;
  update private.reputation_vector_outbox set state='publishing',lease_id=gen_random_uuid(),
   leased_generation=generation,lease_until=now()+interval '60 seconds' where profile_id=r.profile_id returning * into r;
  return jsonb_build_object('profile_id',r.profile_id,'actor_id',r.actor_id,'generation',r.leased_generation,'lease_id',r.lease_id);
 elsif p_action='published' then
  update private.reputation_vector_outbox set state=case when generation=leased_generation then 'published' else 'pending' end,
   lease_id=null,lease_until=null where profile_id=(p_data->>'profile_id')::uuid and lease_id=(p_data->>'lease_id')::uuid;
  return jsonb_build_object('published',found);
 end if;
 raise sqlstate 'PT422' using message='INVALID_REQUEST';
end $$;
revoke all on function public.reputation_vector_event(text,jsonb) from public,anon,authenticated;
grant execute on function public.reputation_vector_event(text,jsonb) to service_role;
-- Existing reviews are indexed only by an explicit sync action; do not silently backfill users' text.
create table private.reputation_vector_receipts(
 profile_id uuid primary key references private.reputation_clients(id), generation bigint not null,
 source_hash text not null check(source_hash~'^[a-f0-9]{64}$'),
 state text not null check(state in('indexing','ready','failed')),
 chunks integer not null check(chunks>=0), error_code text,
 updated_at timestamptz not null default now()
);
alter table private.reputation_vector_receipts enable row level security;
revoke all on private.reputation_vector_receipts from public,anon,authenticated;
create function public.reputation_vector_receipt(p_profile_id uuid,p_receipt jsonb default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r private.reputation_vector_receipts;
begin
 if auth.role() is distinct from 'service_role' then raise sqlstate '42501' using message='UNAUTHORIZED';end if;
 if p_receipt is not null then
  if jsonb_typeof(p_receipt)<>'object' or p_receipt->>'state' not in('indexing','ready','failed')
    or coalesce(p_receipt->>'source_hash','') !~ '^[a-f0-9]{64}$' then raise sqlstate 'PT422' using message='INVALID_REQUEST';end if;
  insert into private.reputation_vector_receipts(profile_id,generation,source_hash,state,chunks,error_code)
  values(p_profile_id,(p_receipt->>'generation')::bigint,p_receipt->>'source_hash',p_receipt->>'state',
         (p_receipt->>'chunks')::integer,p_receipt->>'error_code')
  on conflict(profile_id) do update set generation=excluded.generation,source_hash=excluded.source_hash,
   state=excluded.state,chunks=excluded.chunks,error_code=excluded.error_code,updated_at=now()
   where private.reputation_vector_receipts.generation<=excluded.generation;
 end if;
 select * into r from private.reputation_vector_receipts where profile_id=p_profile_id;
 if not found then return null;end if;
 return jsonb_build_object('generation',r.generation,'source_hash',r.source_hash,'state',r.state,'chunks',r.chunks,'error_code',r.error_code);
end $$;
revoke all on function public.reputation_vector_receipt(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.reputation_vector_receipt(uuid,jsonb) to service_role;
commit;
