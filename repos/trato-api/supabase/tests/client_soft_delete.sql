begin;
insert into auth.users(id,email) values('33333333-3333-4333-8333-333333333333','delete-test@trato.invalid'),('44444444-4444-4444-8444-444444444444','foreign-delete@trato.invalid');
insert into public.clients(id,owner_id,name) values('cccccccc-cccc-4ccc-8ccc-cccccccccccc','33333333-3333-4333-8333-333333333333','Archive fixture');
insert into public.projects(id,owner_id,client_id,name) values('cccccccc-0001-4000-8000-000000000001','33333333-3333-4333-8333-333333333333','cccccccc-cccc-4ccc-8ccc-cccccccccccc','Preserved project');
insert into public.documents(id,owner_id,project_id,title,kind,original_filename,mime_type,size_bytes,sha256,ingestion_key,command_hash)
values('cccccccc-0002-4000-8000-000000000002','33333333-3333-4333-8333-333333333333','cccccccc-0001-4000-8000-000000000001','Preserved PDF','initial_agreement','fixture.pdf','application/pdf',5,repeat('a',64),'delete-test-doc',repeat('b',64));
set local role authenticated;
set local request.jwt.claim.sub='44444444-4444-4444-8444-444444444444';
set local request.jwt.claims='{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
do $$begin
 begin
 perform public.soft_delete_client('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
 raise exception 'Cross-owner archive allowed';
 exception when sqlstate 'PT404' then null;end;
end $$;
set local request.jwt.claim.sub='33333333-3333-4333-8333-333333333333';
set local request.jwt.claims='{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
do $$declare first_result jsonb;begin
 first_result:=public.soft_delete_client('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
 if first_result<>public.soft_delete_client('cccccccc-cccc-4ccc-8ccc-cccccccccccc') then raise exception 'Repeated archive changed time';end if;
 if exists(select 1 from public.clients where id='cccccccc-cccc-4ccc-8ccc-cccccccccccc') or exists(select 1 from public.projects where client_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc') or exists(select 1 from public.documents where id='cccccccc-0002-4000-8000-000000000002') then raise exception 'Archived data remains visible';end if;
 begin
 perform public.reserve_document('cccccccc-0001-4000-8000-000000000001','New document','reference','new.pdf','application/pdf',5,repeat('c',64),'after-delete');
 raise exception 'Upload to archived project allowed';
 exception when sqlstate 'PT404' then null;end;
 begin
 insert into public.projects(client_id,name) values('cccccccc-cccc-4ccc-8ccc-cccccccccccc','After archive');
 raise exception 'New project after archive allowed';
 exception when insufficient_privilege then null;end;
end $$;
reset role;
do $$begin
 if not exists(select 1 from public.clients where id='cccccccc-cccc-4ccc-8ccc-cccccccccccc' and deleted_at is not null) or not exists(select 1 from public.projects where id='cccccccc-0001-4000-8000-000000000001') or not exists(select 1 from public.documents where id='cccccccc-0002-4000-8000-000000000002') then raise exception 'Archive physically deleted related data';end if;
end $$;
set local role anon;
do $$begin
 begin
 perform public.soft_delete_client('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
 raise exception 'Anonymous archive allowed';
 exception when insufficient_privilege then null;end;
end $$;
reset role;
select 'PASS: owner-only, idempotent soft deletion; related data hidden and preserved; writes rejected; fixtures rolled back' as result;
rollback;
