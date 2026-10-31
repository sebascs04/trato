-- Transactional authorization tests. Synthetic attachment rows are NOT real uploaded PDFs.
-- Binary Storage behavior is covered separately by API transport tests.
begin;
set local statement_timeout='8s';
insert into auth.users(id,email) values('a1111111-1111-4111-8111-111111111111','evidence-a@example.invalid'),('b2222222-2222-4222-8222-222222222222','evidence-b@example.invalid');
insert into public.clients(id,owner_id,name) values('c1111111-1111-4111-8111-111111111111','a1111111-1111-4111-8111-111111111111','Private A'),('c2222222-2222-4222-8222-222222222222','b2222222-2222-4222-8222-222222222222','Private B');
insert into public.projects(id,owner_id,client_id,name) values('d1111111-1111-4111-8111-111111111111','a1111111-1111-4111-8111-111111111111','c1111111-1111-4111-8111-111111111111','Private A'),('d2222222-2222-4222-8222-222222222222','b2222222-2222-4222-8222-222222222222','c2222222-2222-4222-8222-222222222222','Private B');
update public.clients set contact_email='evidence-client@example.invalid' where id in ('c1111111-1111-4111-8111-111111111111','c2222222-2222-4222-8222-222222222222');
set local role authenticated;
set local request.jwt.claim.sub='a1111111-1111-4111-8111-111111111111';
set local request.jwt.claims='{"sub":"a1111111-1111-4111-8111-111111111111","role":"authenticated","is_anonymous":false}';
do $$declare f jsonb; again jsonb; p jsonb; r jsonb; i integer;begin
 for i in 1..3 loop
  p:=jsonb_build_object('project_id','d1111111-1111-4111-8111-111111111111','filename','evidence-'||i||'.pdf','size_bytes',20,'sha256',repeat('a',64),'upload_key','test-'||i);
  f:=public.community_reputation('attachment_reserve',p);again:=public.community_reputation('attachment_reserve',p);
  if f->>'id' is distinct from again->>'id' then raise exception 'Duplicate retry';end if;
 end loop;
 perform set_config('trato.test.file',f->>'id',true);
 if position('a1111111' in f->>'storage_path')>0 then raise exception 'Owner ID exposed';end if;
 begin perform public.community_reputation('attachment_reserve',p||jsonb_build_object('upload_key','fourth'));raise exception 'Fourth pending file accepted';exception when invalid_parameter_value then null;end;
 begin perform public.community_reputation('attachment_ready',jsonb_build_object('attachment_id',f->>'id'));raise exception 'Missing object completed';exception when invalid_parameter_value then null;end;
 p:=jsonb_build_object('project_id','d1111111-1111-4111-8111-111111111111','name','Evidence test','public_email','evidence-client@example.invalid','alias','Designer A','rating',4,'communication',4,'scope',4,'payment','late','body','Synthetic experience for evidence authorization tests.','consent',true);
 begin perform public.community_reputation('save',p||jsonb_build_object('attachment_ids',jsonb_build_array(f->>'id')));raise exception 'Unready file attached';exception when invalid_parameter_value then null;end;
 r:=public.community_reputation('save',p);
 perform set_config('trato.test.review',r->>'review_id',true);perform set_config('trato.test.profile',r->>'profile_id',true);
 begin perform 1 from private.reputation_attachments;raise exception 'Private table exposed';exception when insufficient_privilege then null;end;
end $$;
set local request.jwt.claim.sub='b2222222-2222-4222-8222-222222222222';
set local request.jwt.claims='{"sub":"b2222222-2222-4222-8222-222222222222","role":"authenticated","is_anonymous":false}';
do $$begin
 begin perform public.community_reputation('attachment_read',jsonb_build_object('attachment_id',current_setting('trato.test.file')));raise exception 'Draft exposed';exception when raise_exception then if sqlerrm<>'REPUTATION_ATTACHMENT_NOT_FOUND' then raise;end if;end;
end $$;
reset role;
-- Explicit metadata fixture to exercise visibility states, without writing Storage objects.
update private.reputation_attachments set status='attached',review_id=current_setting('trato.test.review')::uuid;
set local role authenticated;
do $$declare result jsonb;begin
 result:=public.community_reputation('detail',jsonb_build_object('profile_id',current_setting('trato.test.profile')));
 if jsonb_array_length(result->'reviews'->0->'attachments')<>3 then raise exception 'Missing file metadata';end if;
 if result::text like '%storage_path%' or result::text like '%a1111111%' then raise exception 'Private context exposed';end if;
 perform public.community_reputation('attachment_read',jsonb_build_object('attachment_id',current_setting('trato.test.file')));
 begin perform public.community_reputation('save',jsonb_build_object('project_id','d2222222-2222-4222-8222-222222222222','profile_id',current_setting('trato.test.profile'),'public_email','evidence-client@example.invalid','alias','Designer B','rating',3,'communication',3,'scope',3,'payment','late','body','Synthetic attempt to attach someone else evidence.','consent',true,'attachment_ids',jsonb_build_array(current_setting('trato.test.file'))));raise exception 'Foreign file attached';exception when invalid_parameter_value then null;end;
end $$;
set local request.jwt.claim.sub='a1111111-1111-4111-8111-111111111111';
set local request.jwt.claims='{"sub":"a1111111-1111-4111-8111-111111111111","role":"authenticated","is_anonymous":false}';
do $$declare p jsonb;begin
 p:=jsonb_build_object('project_id','d1111111-1111-4111-8111-111111111111','profile_id',current_setting('trato.test.profile'),'review_id',current_setting('trato.test.review'),'public_email','evidence-client@example.invalid','alias','Designer A','rating',4,'communication',4,'scope',4,'payment','late','body','Synthetic edit removing the explicitly selected attachments.','consent',true,'attachment_ids','[]'::jsonb);
 perform public.community_reputation('save',p);
end $$;
reset role;
do $$begin
 if jsonb_array_length((select snapshot->'attachments' from private.reputation_review_versions where review_id=current_setting('trato.test.review')::uuid and version=1))<>3 then raise exception 'Old metadata lost';end if;
 if (select public from storage.buckets where id='reputation-evidence') then raise exception 'Public bucket';end if;
 if (select qual from pg_policies where schemaname='storage' and policyname='read_reputation_evidence') not like '%owner_id%' then raise exception 'Direct metadata is not owner-only';end if;
end $$;
set local role authenticated;
set local request.jwt.claim.sub='b2222222-2222-4222-8222-222222222222';
set local request.jwt.claims='{"sub":"b2222222-2222-4222-8222-222222222222","role":"authenticated","is_anonymous":false}';
do $$begin
 begin perform public.community_reputation('attachment_read',jsonb_build_object('attachment_id',current_setting('trato.test.file')));raise exception 'Removed file readable';exception when raise_exception then if sqlerrm<>'REPUTATION_ATTACHMENT_NOT_FOUND' then raise;end if;end;
end $$;
reset role;
update private.reputation_attachments set status='attached' where id=current_setting('trato.test.file')::uuid;
set local role authenticated;
set local request.jwt.claim.sub='a1111111-1111-4111-8111-111111111111';
set local request.jwt.claims='{"sub":"a1111111-1111-4111-8111-111111111111","role":"authenticated","is_anonymous":false}';
select public.community_reputation('withdraw',jsonb_build_object('review_id',current_setting('trato.test.review')));
set local request.jwt.claim.sub='b2222222-2222-4222-8222-222222222222';
set local request.jwt.claims='{"sub":"b2222222-2222-4222-8222-222222222222","role":"authenticated","is_anonymous":false}';
do $$begin
 begin perform public.community_reputation('attachment_read',jsonb_build_object('attachment_id',current_setting('trato.test.file')));raise exception 'Withdrawn file readable';exception when raise_exception then if sqlerrm<>'REPUTATION_ATTACHMENT_NOT_FOUND' then raise;end if;end;
end $$;
reset role;
rollback;
