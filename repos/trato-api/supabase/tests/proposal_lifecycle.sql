-- Transactional SQL tests. Synthetic metadata only, no actual Storage files or sends.
begin;
-- Trusted provider fixture exists only for this rollback transaction.
create function pg_temp.test_sent(p uuid,r uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.change_proposals where id=p and owner_id='11111111-1111-4111-8111-111111111111') then raise exception 'Fixture owner mismatch'; end if;
 insert into public.proposal_deliveries(owner_id,project_id,proposal_id,revision_id,kind,recipient,message_hash,status,provider_message_id)
 select owner_id,project_id,id,r,'adenda','a@trato.invalid',repeat('a',64),'accepted_by_gmail','synthetic-message' from public.change_proposals where id=p;
end $$;
create function pg_temp.test_backend(action text,data jsonb) returns jsonb language sql security definer set search_path='' as $$
 select private.proposal_backend('11111111-1111-4111-8111-111111111111',action,data)
$$;
insert into auth.users(id,email) values
 ('11111111-1111-4111-8111-111111111111','proposal-a@trato.invalid'),
 ('22222222-2222-4222-8222-222222222222','proposal-b@trato.invalid');
insert into public.clients(id,owner_id,name) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','A'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222','B');
insert into public.projects(id,owner_id,client_id,name) values
 ('aaaaaaaa-0001-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','A1'),
 ('aaaaaaaa-0002-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','A2'),
 ('bbbbbbbb-0001-4000-8000-000000000001','22222222-2222-4222-8222-222222222222','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','B1');
insert into public.documents(id,owner_id,project_id,title,kind,original_filename,mime_type,size_bytes,sha256,ingestion_key,command_hash)
select ('dddddddd-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 '11111111-1111-4111-8111-111111111111','aaaaaaaa-0001-4000-8000-000000000001','Fixture '||n,
 case when n=1 then 'initial_agreement' when n in(2,7,8) then 'email_request' else 'addendum' end,
 'fixture.pdf','application/pdf',5,repeat(n::text,64),'fixture-'||n,repeat('a',64)
from generate_series(1,8)n;
insert into public.documents(id,owner_id,project_id,title,kind,original_filename,mime_type,size_bytes,sha256,ingestion_key,command_hash)
 values('dddddddd-0000-4000-8000-000000000009','11111111-1111-4111-8111-111111111111','aaaaaaaa-0002-4000-8000-000000000002','Other project','initial_agreement','other.pdf','application/pdf',5,repeat('9',64),'other',repeat('a',64));
insert into public.document_extractions(owner_id,project_id,document_id,status,parser,parser_version,result_hash,completed_at)
 select owner_id,project_id,id,'ready','synthetic-fixture','1',sha256,now() from public.documents where owner_id='11111111-1111-4111-8111-111111111111';
insert into public.documents(id,owner_id,project_id,title,kind,original_filename,mime_type,size_bytes,sha256,ingestion_key,command_hash) values('dddddddd-0000-4000-8000-000000000010','11111111-1111-4111-8111-111111111111','aaaaaaaa-0001-4000-8000-000000000001','Client feedback','reference','feedback.pdf','application/pdf',5,repeat('a',64),'feedback',repeat('a',64));
insert into public.document_extractions(owner_id,project_id,document_id,status,parser,parser_version,result_hash,completed_at) values('11111111-1111-4111-8111-111111111111','aaaaaaaa-0001-4000-8000-000000000001','dddddddd-0000-4000-8000-000000000010','ready','fixture','1',repeat('a',64),now());
-- Metadata fixture only: checks SQL ownership/existence guard, not actual binary persistence.
insert into storage.objects(bucket_id,name,owner_id,metadata)
 select 'project-documents',storage_path,owner_id::text,'{"size":5}'::jsonb from public.documents where owner_id='11111111-1111-4111-8111-111111111111';
update public.clients set contact_email='a@trato.invalid' where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set local role authenticated;
set local request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
set local request.jwt.claims='{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
do $$ declare data jsonb; result jsonb; repeated jsonb; stale jsonb; revision uuid; proposal uuid; acceptance uuid; revision2 uuid; pay jsonb; first_draft uuid;
begin
 data:=jsonb_build_object('project_id','aaaaaaaa-0001-4000-8000-000000000001','request_document_id','dddddddd-0000-4000-8000-000000000002',
 'terms',jsonb_build_object('scope_summary','Two new deliverables','conditions','Review before sending.','currency','USD','deadline',(current_date+14)::text,
 'line_items','[{"description":"Vertical video","quantity":2,"unit_amount_minor":9000}]'::jsonb),
 'source_document_ids','["dddddddd-0000-4000-8000-000000000001","dddddddd-0000-4000-8000-000000000002"]'::jsonb);
 result:=public.proposal_command('create',data,'create-a');
 repeated:=public.proposal_command('create',data,'create-a');
 if repeated<>result then raise exception 'Idempotent create changed IDs'; end if;
 proposal:=(result->>'proposal_id')::uuid; revision:=(result->>'revision_id')::uuid;
 perform set_config('trato.test_proposal',proposal::text,true);
 if (select additional_minor from public.proposal_revisions where id=revision)<>18000 then raise exception 'Total is not exact minor units'; end if;
 if (select generation from public.project_agreement_heads where project_id='aaaaaaaa-0001-4000-8000-000000000001')<>0 then raise exception 'Draft changed head'; end if;
 first_draft:=revision;
 perform public.proposal_command('attach_pdf',jsonb_build_object('proposal_id',proposal,'expected_revision_id',revision,'document_id','dddddddd-0000-4000-8000-000000000005'),'first-draft-pdf');
 result:=public.proposal_command('edit_draft',(data-'project_id'-'request_document_id')||jsonb_build_object('proposal_id',proposal,'expected_revision_id',revision),'edit-draft');
 revision:=(result->>'revision_id')::uuid;
 if revision=first_draft or (select revision_no from public.proposal_revisions where id=revision)<>1 or (select draft_sequence from public.proposal_revisions where id=revision)<>2 then raise exception 'Draft editing changed client version or reused snapshot';end if;
 if not exists(select 1 from public.proposal_artifacts where revision_id=first_draft and document_id='dddddddd-0000-4000-8000-000000000005') then raise exception 'Draft editing erased old PDF';end if;
 begin
  perform public.proposal_command('revise',(data-'project_id'-'request_document_id')||jsonb_build_object('proposal_id',proposal,'expected_revision_id',revision),'premature-v2');
  raise exception 'New client version allowed before delivery/feedback';
 exception when sqlstate 'PT409' then null;end;
 begin
  perform public.proposal_command('create',jsonb_set(data,'{terms,conditions}','"Different"'),'create-a');
  raise exception 'Idempotency conflict allowed';
 exception when sqlstate 'PT409' then null; end;
 begin
  perform public.proposal_command('create',jsonb_set(data,'{project_id}','"bbbbbbbb-0001-4000-8000-000000000001"'),'foreign');
  raise exception 'Foreign project allowed';
 exception when sqlstate 'PT404' then null; end;
 begin
  perform public.proposal_command('revise',(data-'project_id'-'request_document_id')||jsonb_build_object('proposal_id',proposal,'expected_revision_id',revision,'source_document_ids','["dddddddd-0000-4000-8000-000000000009","dddddddd-0000-4000-8000-000000000002"]'::jsonb),'cross-source');
  raise exception 'Cross-project source allowed';
 exception when sqlstate 'PT409' then null; end;
 begin
  update public.proposal_revisions set additional_minor=1 where id=revision;
  raise exception 'Immutable amount editable';
 exception when insufficient_privilege then null; end;
 begin
  perform private.proposal_revision(proposal,data->'terms',data->'source_document_ids');
  raise exception 'Internal helper exposed';
 exception when insufficient_privilege then null; end;
 begin
  perform public.proposal_backend('11111111-1111-4111-8111-111111111111','payment_apply','{}');
  raise exception 'Browser forged backend payment command';
 exception when insufficient_privilege then null; end;
 -- Save another proposal on the same generation, then verify stale review rejection.
 stale:=public.proposal_command('create',data||jsonb_build_object('request_document_id','dddddddd-0000-4000-8000-000000000007','source_document_ids','["dddddddd-0000-4000-8000-000000000001","dddddddd-0000-4000-8000-000000000007"]'::jsonb),'stale');
 begin
  perform public.proposal_command('review',jsonb_build_object('proposal_id',proposal,'expected_revision_id',revision,'document_id','dddddddd-0000-4000-8000-000000000003','confirmed',false),'not-confirmed');
  raise exception 'Review without human confirmation';
 exception when sqlstate 'PT422' then null; end;
 if exists(select 1 from public.proposal_events where revision_id=revision) then raise exception 'Terms-only revision reported saved PDF'; end if;
 begin
  perform public.proposal_command('review',jsonb_build_object('proposal_id',proposal,'expected_revision_id',revision,'document_id','dddddddd-0000-4000-8000-000000000003','confirmed',true),'review-no-pdf');
  raise exception 'Review allowed without bound PDF';
 exception when sqlstate 'PT409' then null; end;
 perform public.proposal_command('attach_pdf',jsonb_build_object('proposal_id',proposal,'expected_revision_id',revision,'document_id','dddddddd-0000-4000-8000-000000000003'),'pdf-a');
 begin
  perform public.proposal_command('attach_pdf',jsonb_build_object('proposal_id',proposal,'expected_revision_id',revision,'document_id','dddddddd-0000-4000-8000-000000000004'),'replace-pdf');
  raise exception 'Bound PDF replaced';
 exception when sqlstate 'PT409' then null; end;
 if (select count(*) from public.proposal_events where revision_id=revision and event_type in('revision_created','draft_updated'))<>1 then raise exception 'PDF save event missing or duplicated'; end if;
 perform public.proposal_command('review',jsonb_build_object('proposal_id',proposal,'expected_revision_id',revision,'document_id','dddddddd-0000-4000-8000-000000000003','confirmed',true),'review-a');
 if (select generation from public.project_agreement_heads where project_id='aaaaaaaa-0001-4000-8000-000000000001')<>0 then raise exception 'Review changed head'; end if;
 perform pg_temp.test_sent(proposal,revision);
 begin
  perform public.proposal_command('accept',jsonb_build_object('proposal_id',proposal,'expected_revision_id',revision,'document_id','dddddddd-0000-4000-8000-000000000003','confirmed',true,'review_notes','Reviewed'),'same-pdf');
  raise exception 'Original outgoing PDF counted as return';
 exception when sqlstate 'PT409' then null; end;
 result:=public.proposal_command('accept',jsonb_build_object('proposal_id',proposal,'expected_revision_id',revision,'document_id','dddddddd-0000-4000-8000-000000000004','confirmed',true,'review_notes','Human reviewed returned PDF'),'accept-a');
 acceptance:=(result->>'acceptance_id')::uuid;
 if (select cryptographic_signature_verified from public.proposal_acceptances where id=acceptance) is distinct from false then raise exception 'Invented cryptographic verification'; end if;
 if (select generation from public.project_agreement_heads where project_id='aaaaaaaa-0001-4000-8000-000000000001')<>1 then raise exception 'Acceptance did not advance head once'; end if;
 begin
  perform public.proposal_command('review',jsonb_build_object('proposal_id',stale->>'proposal_id','expected_revision_id',stale->>'revision_id','document_id','dddddddd-0000-4000-8000-000000000003','confirmed',true),'stale-review');
  raise exception 'Stale generation was accepted';
 exception when sqlstate 'PT409' then null; end;
 -- Provider fixtures stay inside a subtransaction: no real order/capture is asserted.
 begin
  pay:=pg_temp.test_backend('payment_prepare',jsonb_build_object('proposal_id',proposal,'revision_id',revision,'merchant_id','SYNTHETICMERCHANT','token','synthetic-checkout-token'));
  if not (pay->>'acquired')::boolean or (pay->>'amount_minor')::bigint<>18000 then raise exception 'Wrong payment reservation'; end if;
  repeated:=pg_temp.test_backend('payment_prepare',jsonb_build_object('proposal_id',proposal,'revision_id',revision,'merchant_id','SYNTHETICMERCHANT','token','another-token'));
  if (repeated->>'acquired')::boolean or repeated->>'id'<>pay->>'id' then raise exception 'Duplicate financial reservation'; end if;
  begin
   perform public.proposal_command('revise',(data-'project_id'-'request_document_id')||jsonb_build_object('proposal_id',proposal,'expected_revision_id',revision),'while-paying');
   raise exception 'Payment allowed terms to change';
  exception when sqlstate 'PT409' then null; end;
  begin
   perform pg_temp.test_backend('payment_apply',jsonb_build_object('payment_id',pay->>'id','status','completed','order_id','SYNTHETICORDER','capture_id','SYNTHETICCAPTURE','amount_minor',1,'currency','USD','merchant_id','SYNTHETICMERCHANT'));
   raise exception 'Wrong amount accepted';
  exception when sqlstate 'PT409' then null; end;
  perform pg_temp.test_backend('payment_apply',jsonb_build_object('payment_id',pay->>'id','status','approved','order_id','SYNTHETICORDER','amount_minor',18000,'currency','USD','merchant_id','SYNTHETICMERCHANT'));
  perform pg_temp.test_backend('capture_claim',jsonb_build_object('payment_id',pay->>'id'));
  begin
   perform pg_temp.test_backend('capture_claim',jsonb_build_object('payment_id',pay->>'id'));
   raise exception 'Duplicate capture allowed';
  exception when sqlstate 'PT409' then null; end;
  perform pg_temp.test_backend('payment_apply',jsonb_build_object('payment_id',pay->>'id','status','completed','order_id','SYNTHETICORDER','capture_id','SYNTHETICCAPTURE','amount_minor',18000,'currency','USD','merchant_id','SYNTHETICMERCHANT'));
  if (select locked_at from public.change_proposals where id=proposal) is null then raise exception 'Paid change is editable'; end if;
  repeated:=pg_temp.test_backend('payment_uncertain',jsonb_build_object('payment_id',pay->>'id','error_code','OLD_FAILURE'));
  if repeated->>'status'<>'completed' then raise exception 'Completed payment regressed'; end if;
  raise sqlstate 'ZT001' using message='Rollback synthetic financial subtransaction';
 exception when sqlstate 'ZT001' then null;
 end;
 begin
  perform public.proposal_command('edit_draft',(data-'project_id'-'request_document_id')||jsonb_build_object('proposal_id',proposal,'expected_revision_id',revision),'edit-sent-draft');
  raise exception 'Sent/accepted draft remained editable';
 exception when sqlstate 'PT409' then null;end;
 -- Unpaid corrections create a new immutable revision and do not inherit review/acceptance.
 result:=public.proposal_command('revise',(data-'project_id'-'request_document_id')||jsonb_build_object('proposal_id',proposal,'expected_revision_id',revision,'feedback_document_id','dddddddd-0000-4000-8000-000000000010','feedback_notes','Client requested adjustments','source_document_ids','["dddddddd-0000-4000-8000-000000000001","dddddddd-0000-4000-8000-000000000002","dddddddd-0000-4000-8000-000000000010"]'::jsonb),'revision-two');
 revision2:=(result->>'revision_id')::uuid;
 if revision2=revision or (select count(distinct revision_no) from public.proposal_revisions where proposal_id=proposal)<>2 then raise exception 'Revision overwritten'; end if;
 if (select base_acceptance_id from public.proposal_revisions where id=revision2)<>acceptance then raise exception 'Accepted base reference lost'; end if;
 if exists(select 1 from public.proposal_reviews where revision_id=revision2) or exists(select 1 from public.proposal_acceptances where revision_id=revision2) then raise exception 'New revision inherited authorization'; end if;
 if not exists(select 1 from public.proposal_acceptances where id=acceptance) then raise exception 'Previous acceptance lost'; end if;
 perform set_config('trato.test_revision',revision2::text,true);
 begin
  perform public.proposal_command('review',jsonb_build_object('proposal_id',proposal,'expected_revision_id',revision,'document_id','dddddddd-0000-4000-8000-000000000005','confirmed',true),'old-revision');
  raise exception 'Old revision reviewed as current';
 exception when sqlstate 'PT409' then null; end;
 -- A zero-price proposal is valid. It must not be turned into a payment by this domain.
 result:=public.proposal_command('create',data||jsonb_build_object('request_document_id','dddddddd-0000-4000-8000-000000000008','source_document_ids','["dddddddd-0000-4000-8000-000000000001","dddddddd-0000-4000-8000-000000000008"]'::jsonb,'terms',(data->'terms')||jsonb_build_object('line_items','[{"description":"Swap","quantity":1,"unit_amount_minor":0}]'::jsonb)),'zero');
 if (select additional_minor from public.proposal_revisions where id=(result->>'revision_id')::uuid)<>0 then raise exception 'Zero price rejected or replaced'; end if;
 perform public.proposal_command('attach_pdf',jsonb_build_object('proposal_id',result->>'proposal_id','expected_revision_id',result->>'revision_id','document_id','dddddddd-0000-4000-8000-000000000005'),'zero-pdf');
 perform public.proposal_command('review',jsonb_build_object('proposal_id',result->>'proposal_id','expected_revision_id',result->>'revision_id','document_id','dddddddd-0000-4000-8000-000000000005','confirmed',true),'zero-review');
 perform pg_temp.test_sent((result->>'proposal_id')::uuid,(result->>'revision_id')::uuid);
 perform public.proposal_command('accept',jsonb_build_object('proposal_id',result->>'proposal_id','expected_revision_id',result->>'revision_id','document_id','dddddddd-0000-4000-8000-000000000006','confirmed',true,'review_notes','Reviewed zero-cost change'),'zero-accept');
 if (select locked_at from public.change_proposals where id=(result->>'proposal_id')::uuid) is null then raise exception 'Zero-cost finalized change is not read-only'; end if;

end $$;
reset role;
-- Simulate a trusted financial lock only inside this rollback; no payment is asserted.
update public.change_proposals set locked_at=now() where id=current_setting('trato.test_proposal')::uuid;
set local role authenticated;
do $$ begin
 begin
  perform public.proposal_command('revise',jsonb_build_object('proposal_id',current_setting('trato.test_proposal'),'expected_revision_id',current_setting('trato.test_revision')),'locked-change');
  raise exception 'Finalized change was editable';
 exception when sqlstate 'PT409' then null; end;
end $$;
set local request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
set local request.jwt.claims='{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
do $$ begin
 if exists(select 1 from public.change_proposals) or exists(select 1 from public.proposal_revisions) or exists(select 1 from public.proposal_acceptances) then raise exception 'Cross-owner read'; end if;
 begin
  perform public.proposal_command('review',jsonb_build_object('proposal_id',current_setting('trato.test_proposal'),'expected_revision_id',current_setting('trato.test_revision')),'foreign-review');
  raise exception 'Foreign change editable';
 exception when sqlstate 'PT404' then null; end;
end $$;
reset role;
set local role anon;
do $$ begin
 begin
  perform public.proposal_command('create','{}','anon');
  raise exception 'Anonymous command allowed';
 exception when insufficient_privilege then null; end;
 begin
  perform 1 from public.proposal_revisions;
  raise exception 'Anonymous revision read allowed';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'PASS: immutable revisions, owner/project/source boundaries, exact cents, explicit manual review, generation CAS, zero price and read-only lock; all fixtures rolled back' as result;
rollback;
