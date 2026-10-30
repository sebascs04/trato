begin;
set local statement_timeout='8s';
insert into auth.users(id,email) values
 ('a9999999-1111-4111-8111-111111111111','delete-project-a@example.invalid'),
 ('b9999999-2222-4222-8222-222222222222','delete-project-b@example.invalid');
insert into public.clients(id,owner_id,name) values
 ('c9999999-1111-4111-8111-111111111111','a9999999-1111-4111-8111-111111111111','Project owner A'),
 ('c9999999-2222-4222-8222-222222222222','b9999999-2222-4222-8222-222222222222','Project owner B');
insert into public.projects(id,owner_id,client_id,name) values
 ('d9999999-1111-4111-8111-111111111111','a9999999-1111-4111-8111-111111111111','c9999999-1111-4111-8111-111111111111','To remove'),
 ('d9999999-3333-4333-8333-333333333333','a9999999-1111-4111-8111-111111111111','c9999999-1111-4111-8111-111111111111','To retain'),
 ('d9999999-2222-4222-8222-222222222222','b9999999-2222-4222-8222-222222222222','c9999999-2222-4222-8222-222222222222','Foreign project');
insert into public.documents(id,owner_id,project_id,title,kind,original_filename,mime_type,size_bytes,sha256,ingestion_key,command_hash) values
 ('e9999999-1111-4111-8111-111111111111','a9999999-1111-4111-8111-111111111111','d9999999-1111-4111-8111-111111111111','Retained file','initial_agreement','agreement.pdf','application/pdf',6,repeat('a',64),'delete-project-test',repeat('a',64)),
 ('e9999999-3333-4333-8333-333333333333','a9999999-1111-4111-8111-111111111111','d9999999-3333-4333-8333-333333333333','Other file','initial_agreement','other.pdf','application/pdf',6,repeat('a',64),'delete-project-test',repeat('a',64));
set local role authenticated;
select set_config('request.jwt.claim.sub','a9999999-1111-4111-8111-111111111111',true);
select set_config('request.jwt.claims','{"sub":"a9999999-1111-4111-8111-111111111111","role":"authenticated","is_anonymous":false}',true);
do $$declare result jsonb; again jsonb;begin
 begin perform public.soft_delete_project('d9999999-2222-4222-8222-222222222222');raise exception 'Foreign project deleted';exception when sqlstate 'PT404' then null;end;
 result:=public.soft_delete_project('d9999999-1111-4111-8111-111111111111');
 again:=public.soft_delete_project('d9999999-1111-4111-8111-111111111111');
 if result->>'deleted_at' is null or again<>result then raise exception 'Delete not idempotent';end if;
 if exists(select 1 from public.projects where id='d9999999-1111-4111-8111-111111111111') then raise exception 'Deleted project visible';end if;
 if exists(select 1 from public.documents where project_id='d9999999-1111-4111-8111-111111111111') then raise exception 'Deleted project documents visible';end if;
 if not exists(select 1 from public.projects where id='d9999999-3333-4333-8333-333333333333') then raise exception 'Other project hidden';end if;
 if not exists(select 1 from public.documents where project_id='d9999999-3333-4333-8333-333333333333') then raise exception 'Other documents hidden';end if;
 begin perform public.reserve_document('d9999999-1111-4111-8111-111111111111','Forbidden','initial_agreement','new.pdf','application/pdf',6,repeat('b',64),'after-delete');raise exception 'New ingestion allowed';exception when sqlstate 'PT404' then null;end;
end $$;
reset role;
do $$begin
 if not exists(select 1 from public.projects where id='d9999999-1111-4111-8111-111111111111' and deleted_at is not null and status='draft') then raise exception 'Project record not retained unchanged';end if;
 if not exists(select 1 from public.documents where id='e9999999-1111-4111-8111-111111111111') then raise exception 'Source physically deleted';end if;
 if not exists(select 1 from public.clients where id='c9999999-1111-4111-8111-111111111111' and deleted_at is null) then raise exception 'Client changed';end if;
 if has_function_privilege('anon','public.soft_delete_project(uuid)','execute') then raise exception 'Anonymous can delete';end if;
end $$;
rollback;
