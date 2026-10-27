begin;
insert into auth.users(id,email) values('91000000-0000-4000-8000-000000000001','thread-test@example.invalid');
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000001',true);
insert into public.clients(id,owner_id,name) values('92000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001','Thread SQL test');
insert into public.projects(id,owner_id,client_id,name) values('93000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','Thread SQL test');
set local role authenticated;
select public.reserve_document('93000000-0000-4000-8000-000000000001','Fuente','initial_agreement','fuente.pdf','application/pdf',5,encode(sha256(convert_to('%PDF-','UTF8')),'hex'),'thread-sql-1');
reset role;
insert into storage.objects(bucket_id,name,owner_id,metadata)
 select 'project-documents',storage_path,owner_id::text,'{"size":5}'::jsonb from public.documents where ingestion_key='thread-sql-1';
set local role authenticated;
do $$declare d uuid;q jsonb;r jsonb;begin
 select id into d from public.documents where ingestion_key='thread-sql-1';
 q:=public.queue_document(d);r:=public.queue_document(d);
 if q<>r or q->>'status'<>'queued' then raise exception 'Queue is not idempotent';end if;
 begin perform public.thread_backend('relay_claim','{}');raise exception 'User reached backend';exception when insufficient_privilege then null;end;
end $$;
reset role;
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
do $$declare o jsonb;c jsonb;m jsonb;d jsonb;v jsonb;old uuid;bad jsonb;begin
 o:=public.thread_backend('relay_claim','{}');
 if o is null then raise exception 'Outbox missing';end if;
 perform public.thread_backend('relay_published',jsonb_build_object('id',o->'id','lease_id',o->'lease_id'));
 bad:=jsonb_set(o->'envelope','{context,owner_id}','"91000000-0000-4000-8000-000000000099"');
 begin perform public.thread_backend('claim',jsonb_build_object('message',bad));raise exception 'Forged context accepted';exception when sqlstate 'PT409' then null;end;
 c:=public.thread_backend('claim',jsonb_build_object('message',o->'envelope'));
 begin perform public.thread_backend('claim',jsonb_build_object('message',o->'envelope'));raise exception 'Concurrent worker accepted';exception when sqlstate 'PT409' then null;end;
 d:=public.thread_backend('input',jsonb_build_object('message',o->'envelope','lease_id',c->'lease_id'));
 if d->>'id'<>o->'envelope'->'payload'->>'document_id' then raise exception 'Wrong original';end if;
 m:=jsonb_build_object('type','thread','schema_version',1,'mode','connected','workflow','ingest_document',
  'thread_id',o->'envelope'->'thread_id','event_id',gen_random_uuid(),'causation_id',o->'envelope'->'event_id',
  'context',o->'envelope'->'context','lease_id',c->'lease_id','action','completed',
  'result',jsonb_build_object('extraction',jsonb_build_object('schema_version',1,'format','pdf','sha256',d->'sha256',
   'size_bytes',5,'parser','test','parser_version','1','warnings','[]'::jsonb,
   'segments',jsonb_build_array(jsonb_build_object('index',1,'locator',jsonb_build_object('kind','page','page',1),'text','Contenido de la fuente.')))));
 bad:=jsonb_set(m,'{lease_id}',to_jsonb(gen_random_uuid()));
 v:=public.thread_backend('result',jsonb_build_object('message',bad));
 if v->>'reason'<>'STALE_RESULT' then raise exception 'Stale worker accepted';end if;
 v:=public.thread_backend('result',jsonb_build_object('message',m));
 if v->>'stored'<>'true' then raise exception 'Result not stored';end if;
 v:=public.thread_backend('result',jsonb_build_object('message',m));
 if v->>'duplicate'<>'true' then raise exception 'Duplicate not recognized';end if;
 bad:=jsonb_set(m,'{result,extraction,parser}','"forged"');
 begin perform public.thread_backend('result',jsonb_build_object('message',bad));raise exception 'Changed event accepted';exception when sqlstate 'PT409' then null;end;
end $$;
reset role;
do $$begin
 if (select count(*) from public.document_segments where owner_id='91000000-0000-4000-8000-000000000001')<>1 then raise exception 'Duplicate text';end if;
 if (select status from public.worker_threads where owner_id='91000000-0000-4000-8000-000000000001')<>'ready' then raise exception 'Job not ready';end if;
 if (select status from public.document_extractions where owner_id='91000000-0000-4000-8000-000000000001')<>'ready' then raise exception 'Text not ready';end if;
end $$;
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000099',true);
set local role authenticated;
do $$begin if exists(select 1 from public.worker_threads) then raise exception 'Owner isolation failed';end if;end $$;
reset role;
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select public.reserve_document('93000000-0000-4000-8000-000000000001','Otra fuente','initial_agreement','otra.pdf','application/pdf',5,encode(sha256(convert_to('%PDF-','UTF8')),'hex'),'thread-sql-2');
reset role;
insert into storage.objects(bucket_id,name,owner_id,metadata) select 'project-documents',storage_path,owner_id::text,'{"size":5}'::jsonb from public.documents where ingestion_key='thread-sql-2';
set local role authenticated;
do $$declare d uuid;begin select id into d from public.documents where ingestion_key='thread-sql-2';perform public.queue_document(d);end $$;
reset role;
set local role service_role;
do $$declare o jsonb;c jsonb;m jsonb;r jsonb;begin
 o:=public.thread_backend('relay_claim','{}');
 c:=public.thread_backend('claim',jsonb_build_object('message',o->'envelope'));
 m:=jsonb_build_object('type','thread','schema_version',1,'mode','connected','workflow','ingest_document','thread_id',o->'envelope'->'thread_id',
 'event_id',gen_random_uuid(),'causation_id',o->'envelope'->'event_id','context',o->'envelope'->'context','lease_id',c->'lease_id',
 'action','failed','result',jsonb_build_object('error_code','UNREADABLE_FILE'));
 r:=public.thread_backend('result',jsonb_build_object('message',m));
 if r->>'stored'<>'true' then raise exception 'Error not persisted';end if;
end $$;
reset role;
set local role authenticated;
do $$declare d uuid;old uuid;r jsonb;begin
 select document_id,worker_thread_id into d,old from public.document_extractions where error_code='UNREADABLE_FILE' and owner_id=auth.uid();
 r:=public.queue_document(d);
 if r->>'thread_id'=old::text or r->>'status'<>'queued' then raise exception 'Retry did not create a new guarded attempt';end if;
end $$;
reset role;
-- Simulate an acknowledged publication lost with a Redis restart, without changing business data.
update public.thread_outbox b set published_at=now()-interval '121 seconds',lease_until=null from public.worker_threads t
 where t.id=b.thread_id and t.owner_id='91000000-0000-4000-8000-000000000001' and t.status='queued';
set local role service_role;
do $$declare o jsonb;begin
 o:=public.thread_backend('relay_claim','{}');
 if o is null then raise exception 'Stuck published job was not recovered';end if;
end $$;
reset role;
select 'PASS: atomic queue, duplicate commands, privileged-only consumers, context/lease checks, result dedup, immutable ready text and RLS' as result;
rollback;
