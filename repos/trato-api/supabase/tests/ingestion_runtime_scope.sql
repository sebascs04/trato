begin;
do $$
declare u uuid;cl uuid:=gen_random_uuid();pr uuid:=gen_random_uuid();scope text:='test_'||replace(gen_random_uuid()::text,'-','');doc uuid;tid uuid;oid uuid;scoped_oid uuid;legacy_oid uuid;r jsonb;i int;
begin
select owner_id into u from public.projects order by created_at limit 1;
if u is null then raise exception 'Fixture owner required';end if;
perform set_config('request.jwt.claim.role','service_role',true);
insert into public.clients(id,owner_id,name,contact_email) values(cl,u,'Runtime fixture','fixture@example.invalid');
insert into public.projects(id,owner_id,client_id,name) values(pr,u,cl,'Runtime fixture');
for i in 1..2 loop
doc:=gen_random_uuid();
insert into public.documents(id,owner_id,project_id,title,kind,original_filename,mime_type,size_bytes,sha256,ingestion_key,command_hash)
values(doc,u,pr,'Runtime fixture','initial_agreement','fixture.pdf','application/pdf',20,repeat('a',64),'runtime-'||doc,repeat('a',64));
insert into public.file_processing_options(document_id,project_id,owner_id,output_language,purpose,runtime_scope)
values(doc,pr,u,'en','initial_agreement',case when i=1 then scope else null end);
insert into public.worker_threads(owner_id,project_id,workflow,subject_id) values(u,pr,'ingest_document',doc) returning id into tid;
insert into public.thread_outbox(thread_id,envelope,created_at) values(tid,'{}'::jsonb,case when i=1 then '1700-01-01'::timestamptz else '1800-01-01'::timestamptz end) returning id into oid;
if i=1 then scoped_oid:=oid;else legacy_oid:=oid;end if;
end loop;
r:=private.ingestion_thread_backend('relay_claim','{}');
if r->>'id' is distinct from legacy_oid::text then raise exception 'Legacy relay claimed scoped document';end if;
r:=private.ingestion_thread_backend('relay_claim',jsonb_build_object('runtime_scope',scope));
if r->>'id' is distinct from scoped_oid::text then raise exception 'Scoped relay did not claim its document';end if;
end $$;
rollback;
