begin;
set local statement_timeout='10s';
\ir fixtures/refund_fixture.sql
create temp table refund_doc_test(f jsonb,parent_id uuid,snapshot_id uuid,artifact_id uuid);
insert into refund_doc_test(f) select pg_temp.refund_fixture();
update public.clients set contact_email='customer@example.invalid' where owner_id=(select (f->>'owner')::uuid from refund_doc_test);
insert into storage.objects(bucket_id,name,metadata) select 'project-documents',d.storage_path,jsonb_build_object('size',d.size_bytes,'mimetype','application/pdf') from public.documents d join refund_doc_test t on d.id=(t.f->>'document')::uuid;
-- Fixture server helpers stand in for Storage/Gmail, never for user authorization.
create function pg_temp.install_refund_pdf(parent uuid,snapshot uuid) returns jsonb language plpgsql security definer as $$
declare r public.refund_settlements;d public.documents;begin
 select * into r from public.refund_settlements where id=parent;
 insert into public.documents(owner_id,project_id,title,kind,original_filename,mime_type,size_bytes,sha256,ingestion_key,command_hash)
 values(r.owner_id,r.project_id,'Settlement PDF','addendum','settlement.pdf','application/pdf',10,repeat('e',64),snapshot::text,repeat('f',64)) returning * into d;
 insert into storage.objects(bucket_id,name,metadata) values('project-documents',d.storage_path,jsonb_build_object('size',10,'mimetype','application/pdf'));
 return public.refund_backend(r.owner_id,'attach_pdf',jsonb_build_object('settlement_id',parent,'snapshot_id',snapshot,'document_id',d.id,'sha256',d.sha256));
end $$;
create function pg_temp.deliver_refund(parent uuid,snapshot uuid,op text) returns jsonb language plpgsql security definer as $$
declare r public.refund_settlements;m jsonb;begin
 select * into r from public.refund_settlements where id=parent;
 m:=public.refund_backend(r.owner_id,'mail_reserve',jsonb_build_object('settlement_id',parent,'snapshot_id',snapshot,'operation_key',op,'recipient','customer@example.invalid','sender','owner@example.invalid','message_hash',repeat('a',64),'preview','{}'::jsonb));
 return public.refund_backend(r.owner_id,'mail_finish',jsonb_build_object('settlement_id',parent,'snapshot_id',snapshot,'delivery_id',m->>'id','status','accepted_by_gmail','message_id','gmail-'||snapshot::text,'thread_id','thread-test'));
end $$;
grant select,update on refund_doc_test to authenticated;
create function pg_temp.record_refund_reply(parent uuid,snapshot uuid) returns uuid language plpgsql security definer as $$
declare r public.refund_settlements;m public.refund_deliveries;response uuid;begin
 select * into r from public.refund_settlements where id=parent;
 select * into m from public.refund_deliveries where snapshot_id=snapshot and status='accepted_by_gmail';
 perform public.refund_backend(r.owner_id,'response_record',jsonb_build_object('settlement_id',parent,'snapshot_id',snapshot,'delivery_id',m.id,'provider_message_id','reply-'||snapshot::text,'from_email','customer@example.invalid','body_text','Please revise this version','received_at',now(),'attachments','[]'::jsonb,'raw_message','{}'::jsonb));
 select id into response from public.refund_client_responses where snapshot_id=snapshot;
 return response;
end $$;
-- Record a synthetic verified initial payment as the server would, with documentary source.
do $$declare f jsonb;r jsonb;begin
 select t.f into f from refund_doc_test t;
 r:=public.refund_backend((f->>'owner')::uuid,'register_initial',jsonb_build_object('project_id',f->>'project','capture_id','INITIAL-TEST','order_id','INITIAL-ORDER','merchant_id','TEST-MERCHANT','amount_minor',10000,'evidence',f->'request'->'request_evidence','notes','Verified initial fixture','operation_key','initial-test'));
 if r->'payment'->>'origin'<>'initial' then raise exception 'Initial payment not recorded';end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',f->>'owner',true) from refund_doc_test;
do $$declare f jsonb;ids jsonb;r jsonb;request jsonb;terms jsonb;edit jsonb;first_snapshot uuid;old_reply uuid;parent uuid;facts jsonb;allocation jsonb;second uuid;one jsonb;two jsonb;begin
 select t.f into f from refund_doc_test t;
 select jsonb_agg(id order by id) into ids from public.project_received_payments where project_id=(f->>'project')::uuid;
 if jsonb_array_length(ids)<>2 then raise exception 'Initial + change missing';end if;
 if public.refund_payments((f->>'project')::uuid)::text like '%checkout_token%' then raise exception 'Token leaked';end if;
 request:=((f->'request')-'payment_id')||jsonb_build_object('scope','project_closure','payment_ids',ids,'payments_reviewed',true);
 begin perform public.refund_command('create',jsonb_set(request,'{payment_ids}',jsonb_build_array(ids->0)),'omit-payment');raise exception 'Incomplete project closure accepted';exception when sqlstate 'PT409' then null;end;
 r:=public.refund_command('create',request,'project-create');parent:=(r->'settlement'->>'id')::uuid;
 update refund_doc_test set parent_id=parent;
 select jsonb_agg(jsonb_build_object('payment_id',id,'refund_minor',amount_minor-7500) order by id) into allocation from public.project_received_payments where project_id=(f->>'project')::uuid;
 terms:=jsonb_build_object('currency','USD','conditions','Project settlement','proposed_refund_minor',25000,'adjustments',jsonb_build_array(jsonb_build_object('concept_id',gen_random_uuid(),'kind','recognized_work','beneficiary','seller','description','Reviewed work','amount_minor',15000,'evidence',f->'request'->'request_evidence')),'allocations',allocation);
 edit:=jsonb_build_object('settlement_id',parent,'expected_snapshot_id',null,'terms',terms);
 begin perform public.refund_command('edit_draft',jsonb_set(edit,'{terms,allocations,0,refund_minor}','1'),'bad-allocation');raise exception 'Wrong allocation accepted';exception when sqlstate 'PT409' then null;end;
 r:=public.refund_command('edit_draft',edit,'project-draft');first_snapshot:=(r->'snapshot'->>'id')::uuid;
 if (r->'snapshot'->'breakdown'->>'gross_minor')::bigint<>40000 or jsonb_array_length(r->'snapshot'->'payments')<>2 then raise exception 'Global calculation incorrect';end if;
 update refund_doc_test set snapshot_id=first_snapshot;
 r:=public.refund_command('reserve_pdf',jsonb_build_object('settlement_id',parent,'expected_snapshot_id',first_snapshot,'language','es'),'pdf-v1');
 update refund_doc_test set artifact_id=(r->'artifact'->>'id')::uuid;
 begin perform public.refund_backend((f->>'owner')::uuid,'mail_reserve','{}');raise exception 'Backend accessible';exception when insufficient_privilege then null;end;
 begin perform public.refund_command('reserve_pdf',jsonb_build_object('settlement_id',parent,'expected_snapshot_id',first_snapshot,'language','en'),'wrong-language');raise exception 'Language changed';exception when sqlstate 'PT409' then null;end;
 perform pg_temp.install_refund_pdf(parent,first_snapshot);
 perform public.refund_command('review_pdf',jsonb_build_object('settlement_id',parent,'expected_snapshot_id',first_snapshot,'confirmed',true,'notes','Reviewed PDF'),'review-v1');
 perform pg_temp.deliver_refund(parent,first_snapshot,'send-v1');
 old_reply:=pg_temp.record_refund_reply(parent,first_snapshot);
 if (select status from public.refund_settlements where id=parent)<>'awaiting_response' then raise exception 'Sent version state wrong';end if;
 begin perform public.refund_command('edit_draft',edit||jsonb_build_object('expected_snapshot_id',first_snapshot),'edit-sent');raise exception 'Sent snapshot editable';exception when sqlstate 'PT409' then null;end;
 facts:=jsonb_build_object('settlement_id',parent,'expected_snapshot_id',first_snapshot,'confirmed',true,'notes','Client requested adjustments','evidence',f->'request'->'request_evidence'->0);
 perform public.refund_command('feedback',facts,'feedback-v1');
 -- Revised zero settlement: each original payment stays unchanged; no financial API exists here.
 select jsonb_agg(jsonb_build_object('payment_id',id,'refund_minor',0) order by id) into allocation from public.project_received_payments where project_id=(f->>'project')::uuid;
 terms:=jsonb_set(terms,'{adjustments,0,amount_minor}','40000');terms:=jsonb_set(terms,'{proposed_refund_minor}','0');terms:=jsonb_set(terms,'{allocations}',allocation);
 r:=public.refund_command('edit_draft',jsonb_build_object('settlement_id',parent,'expected_snapshot_id',first_snapshot,'terms',terms),'draft-v2');second:=(r->'snapshot'->>'id')::uuid;
 if (r->'snapshot'->>'version_no')::int<>2 or (r->'snapshot'->>'draft_sequence')::int<>1 or exists(select 1 from public.refund_reviews where snapshot_id=second) then raise exception 'New version inherited authorization';end if;
 r:=public.refund_command('edit_draft',jsonb_build_object('settlement_id',parent,'expected_snapshot_id',second,'terms',terms),'edit-draft-v2');second:=(r->'snapshot'->>'id')::uuid;
 if r->'snapshot'->>'version_no'<>'2' or r->'snapshot'->>'draft_sequence'<>'2' or r->'snapshot'->'feedback'->>'quote' is null then raise exception 'Draft edit lost feedback or changed public version';end if;
 facts:=jsonb_build_object('settlement_id',parent,'expected_snapshot_id',second,'confirmed',true,'notes','Client accepted zero closure','evidence',jsonb_build_object('document_id',f->>'document','document_sha256',repeat('a',64)));
 begin perform public.refund_command('accept',facts,'accept-before-send');raise exception 'Unsent accepted';exception when sqlstate 'PT409' then null;end;
 perform public.refund_command('reserve_pdf',jsonb_build_object('settlement_id',parent,'expected_snapshot_id',second,'language','en'),'pdf-v2');
 perform pg_temp.install_refund_pdf(parent,second);
 perform public.refund_command('review_pdf',jsonb_build_object('settlement_id',parent,'expected_snapshot_id',second,'confirmed',true,'notes','Reviewed new PDF'),'review-v2');
 perform pg_temp.deliver_refund(parent,second,'send-v2');
 begin perform public.refund_command('accept',facts||jsonb_build_object('evidence',jsonb_build_object('email_id',old_reply)),'accept-wrong-reply');raise exception 'Old reply accepted new version';exception when sqlstate 'PT409' then null;end;
 r:=public.refund_command('accept',facts,'accept-v2');
 if r->'settlement'->>'status'<>'closed_without_refund' or not exists(select 1 from public.projects where id=(f->>'project')::uuid and status='closed') then raise exception 'Zero project closure not closed';end if;
 if (public.project_request_status((f->>'project')::uuid)->>'can_register')::boolean then raise exception 'Closed project permits new work';end if;
 if (select count(*) from public.refund_snapshots where settlement_id=parent)<>3 or (select count(*) from public.refund_artifacts where settlement_id=parent and document_id is not null)<>2 then raise exception 'History lost';end if;
 if (select amount_minor from public.proposal_payments where id=(f->>'payment')::uuid)<>30000 then raise exception 'Paid change mutated';end if;
end $$;
reset role;
-- An individual initial-payment refund leaves the project open and the paid addendum unchanged.
do $$declare f jsonb;receipt jsonb;r jsonb;parent uuid;snapshot uuid;begin
 f:=pg_temp.refund_fixture();
 update public.clients set contact_email='customer@example.invalid' where owner_id=(f->>'owner')::uuid;
 insert into storage.objects(bucket_id,name,metadata) select 'project-documents',d.storage_path,jsonb_build_object('size',d.size_bytes) from public.documents d where d.id=(f->>'document')::uuid;
 receipt:=public.refund_backend((f->>'owner')::uuid,'register_initial',jsonb_build_object('project_id',f->>'project','capture_id','INITIAL-INDIVIDUAL','order_id','INITIAL-ORDER','merchant_id','TEST-MERCHANT','amount_minor',10000,'evidence',f->'request'->'request_evidence','notes','Initial receipt','operation_key','initial-individual'));
 perform set_config('request.jwt.claim.sub',f->>'owner',true);
 r:=public.refund_command('create',(f->'request')||jsonb_build_object('payment_id',receipt->'payment'->>'id'),'individual-create');parent:=(r->'settlement'->>'id')::uuid;
 r:=public.refund_command('edit_draft',jsonb_build_object('settlement_id',parent,'expected_snapshot_id',null,'terms',jsonb_build_object('currency','USD','conditions','Initial payment refund only','proposed_refund_minor',10000,'adjustments','[]'::jsonb)),'individual-draft');snapshot:=(r->'snapshot'->>'id')::uuid;
 perform public.refund_command('reserve_pdf',jsonb_build_object('settlement_id',parent,'expected_snapshot_id',snapshot,'language','es'),'individual-pdf');
 perform pg_temp.install_refund_pdf(parent,snapshot);
 begin perform pg_temp.deliver_refund(parent,snapshot,'before-review');raise exception 'Unreviewed PDF sent';exception when sqlstate 'PT409' then null;end;
 perform public.refund_command('review_pdf',jsonb_build_object('settlement_id',parent,'expected_snapshot_id',snapshot,'confirmed',true,'notes','Reviewed initial refund'),'individual-review');
 perform pg_temp.deliver_refund(parent,snapshot,'individual-send');
 r:=public.refund_command('accept',jsonb_build_object('settlement_id',parent,'expected_snapshot_id',snapshot,'confirmed',true,'notes','Reviewed acceptance','evidence',jsonb_build_object('document_id',f->>'document','document_sha256',repeat('a',64))),'individual-accept');
 if r->'settlement'->>'status'<>'accepted' then raise exception 'Positive acceptance executed a refund';end if;
 if exists(select 1 from public.projects where id=(f->>'project')::uuid and status='closed') then raise exception 'Individual acceptance closed project';end if;
 if (select amount_minor from public.proposal_payments where id=(f->>'payment')::uuid)<>30000 then raise exception 'Paid addendum changed';end if;
 begin perform public.refund_command('edit_draft',jsonb_build_object('settlement_id',parent,'expected_snapshot_id',snapshot,'terms','{}'::jsonb),'edit-accepted');raise exception 'Accepted revision editable';exception when sqlstate 'PT409' then null;end;
end $$;
rollback;
