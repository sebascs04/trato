-- Run on the development project. Synthetic users/data exist only inside this rollback.
begin;
insert into auth.users(id,email) values
 ('11111111-1111-4111-8111-111111111111','rls-a@trato.invalid'),
 ('22222222-2222-4222-8222-222222222222','rls-b@trato.invalid');
insert into public.clients(id,owner_id,name) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','Test A'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222','Test B');
insert into public.projects(id,owner_id,client_id,name) values
 ('aaaaaaaa-0001-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','A1'),
 ('aaaaaaaa-0002-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','A2'),
 ('bbbbbbbb-0001-4000-8000-000000000001','22222222-2222-4222-8222-222222222222','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','B1');
set local role authenticated;
set local request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
set local request.jwt.claims='{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
do $$ declare first_result jsonb; repeated jsonb; doc uuid; begin
 if (select count(*) from public.clients)<>1 or (select count(*) from public.projects)<>2 then
   raise exception 'RLS read isolation failed'; end if;
 insert into public.clients(name,contact_email) values('A created','a@trato.invalid');
 begin
   insert into public.clients(owner_id,name) values('22222222-2222-4222-8222-222222222222','Forged owner');
   raise exception 'Owner injection was allowed';
 exception when insufficient_privilege then null; end;
 begin
   insert into public.projects(client_id,name) values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Cross owner');
   raise exception 'Cross owner FK was allowed';
 exception when foreign_key_violation then null; end;
 begin
   perform public.reserve_document('bbbbbbbb-0001-4000-8000-000000000001','Correo','email_request','correo.pdf','application/pdf',5,repeat('a',64),'test-key');
   raise exception 'Cross owner RPC was allowed';
 exception when sqlstate 'PT404' then null; end;
 first_result:=public.reserve_document('aaaaaaaa-0001-4000-8000-000000000001','Correo','email_request','correo.pdf','application/pdf',5,repeat('a',64),'test-key');
 repeated:=public.reserve_document('aaaaaaaa-0001-4000-8000-000000000001','Correo','email_request','correo.pdf','application/pdf',5,repeat('a',64),'test-key');
 doc:=(first_result->'document'->>'id')::uuid;
 perform set_config('trato.test_document',doc::text,true);
 if first_result->'document'->>'id' <> repeated->'document'->>'id' then raise exception 'Idempotency failed'; end if;
 if (select count(*) from public.project_events where document_id=doc)<>1 then raise exception 'Duplicate history'; end if;
 if first_result->'document'->>'origin_status'<>'unverified' then raise exception 'Upload promoted verification'; end if;
 if first_result->'document'->>'storage_path' not like '11111111-1111-4111-8111-111111111111/aaaaaaaa-0001-4000-8000-000000000001/%' then
   raise exception 'Invalid source path'; end if;
 begin
   perform public.reserve_document('aaaaaaaa-0001-4000-8000-000000000001','Otro','email_request','correo.pdf','application/pdf',5,repeat('a',64),'test-key');
   raise exception 'Changed command reused key';
 exception when sqlstate 'PT409' then null; end;
 begin
   update public.documents set origin_status='verified' where id=doc;
   raise exception 'Direct source verification allowed';
 exception when insufficient_privilege then null; end;
 begin
   insert into public.document_segments(owner_id,project_id,document_id,extraction_id,ordinal,locator_kind,locator_number,text)
     values(auth.uid(),'aaaaaaaa-0002-4000-8000-000000000002',doc,(first_result->'extraction'->>'id')::uuid,1,'page',1,'Forged');
   raise exception 'Direct segment write allowed';
 exception when insufficient_privilege then null; end;
 begin
   perform public.complete_document_ingestion(doc,jsonb_build_object('schema_version',1,'sha256',repeat('a',64),'size_bytes',5,
     'format','pdf','parser','test','parser_version','1','warnings','[]'::jsonb,
     'segments','[{"index":1,"locator":{"kind":"page","page":1},"text":"test"}]'::jsonb));
   raise exception 'Completion without original was allowed';
 exception when sqlstate 'PT409' then null; end;
 perform public.fail_document_ingestion(doc,'TEST_FAILURE');
 perform public.fail_document_ingestion(doc,'TEST_FAILURE');
 if (select count(*) from public.project_events where document_id=doc and event_type='extraction_failed')<>1 then
   raise exception 'Failure history was duplicated'; end if;
end $$;
reset role;
-- Even privileged callers cannot cross project/owner composite foreign keys.
do $$ declare doc uuid:=current_setting('trato.test_document')::uuid; e uuid; begin
 select id into e from public.document_extractions where document_id=doc;
 begin
   insert into public.document_segments(owner_id,project_id,document_id,extraction_id,ordinal,locator_kind,locator_number,text)
   values('11111111-1111-4111-8111-111111111111','aaaaaaaa-0002-4000-8000-000000000002',doc,e,1,'page',1,'Wrong project');
   raise exception 'Cross project FK was allowed';
 exception when foreign_key_violation then null; end;
end $$;
set local role authenticated;
set local request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
set local request.jwt.claims='{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
do $$ begin
 if (select count(*) from public.clients)<>1 or (select count(*) from public.projects)<>1 then raise exception 'B sees A'; end if;
 if exists(select 1 from public.documents) or exists(select 1 from public.project_events) then raise exception 'B sees A documents/history'; end if;
 begin
   perform public.fail_document_ingestion(current_setting('trato.test_document')::uuid,'FORGED');
   raise exception 'B can alter A document';
 exception when sqlstate 'PT404' then null; end;
end $$;
reset role;
set local role anon;
do $$ begin
 begin
   perform 1 from public.clients;
   raise exception 'Anonymous read allowed';
 exception when insufficient_privilege then null; end;
 begin
   perform public.fail_document_ingestion(current_setting('trato.test_document')::uuid,'FORGED');
   raise exception 'Anonymous RPC allowed';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'PASS: owner/project isolation, immutable sources, idempotency, private original required; all fixtures rolled back' as result;
rollback;
