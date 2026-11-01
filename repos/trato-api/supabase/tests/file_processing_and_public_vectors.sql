begin;
insert into auth.users(id,email) values('c1111111-1111-4111-8111-111111111111','vector-owner@example.invalid'),('c2111111-1111-4111-8111-111111111111','vector-other@example.invalid');
insert into public.clients(id,owner_id,name) values('c3111111-1111-4111-8111-111111111111','c1111111-1111-4111-8111-111111111111','Synthetic client');
insert into public.projects(id,owner_id,client_id,name) values('c4111111-1111-4111-8111-111111111111','c1111111-1111-4111-8111-111111111111','c3111111-1111-4111-8111-111111111111','Synthetic project');
insert into public.documents(id,owner_id,project_id,title,kind,original_filename,mime_type,size_bytes,sha256,ingestion_key,command_hash)
values('c5111111-1111-4111-8111-111111111111','c1111111-1111-4111-8111-111111111111','c4111111-1111-4111-8111-111111111111','Synthetic document','initial_agreement','test.pdf','application/pdf',10,repeat('a',64),'synthetic-vector-test',repeat('b',64));
insert into public.file_processing_options(document_id,project_id,owner_id,output_language) values('c5111111-1111-4111-8111-111111111111','c4111111-1111-4111-8111-111111111111','c1111111-1111-4111-8111-111111111111','en');
insert into public.file_processing_artifacts(document_id,project_id,owner_id,source_generation,stage,cache_key,artifact_fingerprint,artifact)
values('c5111111-1111-4111-8111-111111111111','c4111111-1111-4111-8111-111111111111','c1111111-1111-4111-8111-111111111111',repeat('a',64),'summary',repeat('b',64),repeat('c',64),'{"summary":"Synthetic"}');
insert into private.reputation_members(user_id,alias) values('c1111111-1111-4111-8111-111111111111','Synthetic author');
insert into private.reputation_clients(id,name,created_by,public_email) values('c6111111-1111-4111-8111-111111111111','Synthetic public client','c1111111-1111-4111-8111-111111111111','vector-client@example.invalid');
insert into private.reputation_reviews(id,profile_id,author_id,project_id,rating,communication,scope,collaboration,payment,body)
values('c7111111-1111-4111-8111-111111111111','c6111111-1111-4111-8111-111111111111','c1111111-1111-4111-8111-111111111111','c4111111-1111-4111-8111-111111111111',4,4,4,4,'on_time','Synthetic experience: clear terms and timely communication.');
set local role authenticated;
set local request.jwt.claims='{"sub":"c1111111-1111-4111-8111-111111111111","role":"authenticated"}';
set local request.jwt.claim.sub='c1111111-1111-4111-8111-111111111111';
do $$begin
 if not exists(select 1 from public.file_processing_artifacts where document_id='c5111111-1111-4111-8111-111111111111') then raise exception 'Own artifact hidden';end if;
 begin perform public.reputation_vector_source('c6111111-1111-4111-8111-111111111111');raise exception 'Server source exposed';exception when insufficient_privilege then null;end;
end $$;
set local request.jwt.claims='{"sub":"c2111111-1111-4111-8111-111111111111","role":"authenticated"}';
set local request.jwt.claim.sub='c2111111-1111-4111-8111-111111111111';
do $$begin
 if exists(select 1 from public.file_processing_artifacts where document_id='c5111111-1111-4111-8111-111111111111') or exists(select 1 from public.file_processing_options where document_id='c5111111-1111-4111-8111-111111111111') then raise exception 'Foreign file artifacts exposed';end if;
end $$;
reset role;
set local request.jwt.claims='{"role":"service_role"}';
do $$declare v jsonb;begin
 v:=public.reputation_vector_source('c6111111-1111-4111-8111-111111111111');
 if jsonb_array_length(v->'reviews')<>1 or v::text like '%owner_id%' or v::text like '%project_id%' or v::text like '%author_id%' then raise exception 'Bad public projection';end if;
 if not exists(select 1 from private.reputation_vector_outbox where profile_id='c6111111-1111-4111-8111-111111111111' and generation=1) then raise exception 'Publication event missing';end if;
 update private.reputation_reviews set status='withdrawn',version=version+1 where id='c7111111-1111-4111-8111-111111111111';
 v:=public.reputation_vector_source('c6111111-1111-4111-8111-111111111111');
 if jsonb_array_length(v->'reviews')<>0 or (v->>'generation')::int<>2 then raise exception 'Withdrawal not reflected';end if;
 perform public.reputation_vector_receipt('c6111111-1111-4111-8111-111111111111',jsonb_build_object('generation',2,'source_hash',repeat('a',64),'state','ready','chunks',0));
 perform public.reputation_vector_receipt('c6111111-1111-4111-8111-111111111111',jsonb_build_object('generation',1,'source_hash',repeat('b',64),'state','failed','chunks',0));
 v:=public.reputation_vector_receipt('c6111111-1111-4111-8111-111111111111');
 if (v->>'generation')::int<>2 or v->>'state'<>'ready' then raise exception 'Stale writer replaced newer receipt';end if;
end $$;
rollback;
