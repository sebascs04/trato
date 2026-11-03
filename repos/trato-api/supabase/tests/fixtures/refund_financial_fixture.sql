-- TEST ONLY. Storage and Gmail server doubles; no real PDF, email or PayPal calls.
\ir refund_fixture.sql
create or replace function pg_temp.refund_financial_fixture(multi boolean default false,zero_initial boolean default false) returns jsonb language plpgsql as $$
declare f jsonb;r jsonb;request jsonb;terms jsonb;parent uuid;snapshot uuid;pdf public.documents;delivery jsonb;ctx jsonb;facts jsonb;check_result jsonb;begin
 f:=pg_temp.refund_fixture();
 perform set_config('request.jwt.claim.sub',f->>'owner',true);
 update public.clients set contact_email='customer@example.invalid' where owner_id=(f->>'owner')::uuid;
 insert into storage.objects(bucket_id,name,metadata) select 'project-documents',d.storage_path,jsonb_build_object('size',d.size_bytes) from public.documents d where d.id=(f->>'document')::uuid;
 request:=f->'request';
 if multi then
  perform public.refund_backend((f->>'owner')::uuid,'register_initial',jsonb_build_object('project_id',f->>'project','capture_id','INITIAL-'||(f->>'project'),'order_id','INITIAL-ORDER','merchant_id','TEST-MERCHANT','amount_minor',10000,'evidence',request->'request_evidence','notes','Initial test fixture','operation_key','initial-finance'));
  request:=(request-'payment_id')||jsonb_build_object('scope','project_closure','payments_reviewed',true,'payment_ids',(select jsonb_agg(id order by id) from public.project_received_payments where project_id=(f->>'project')::uuid));
 end if;
 r:=public.refund_command('create',request,'financial-parent');parent:=(r->'settlement'->>'id')::uuid;
 terms:=jsonb_build_object('currency','USD','conditions','Financial test settlement','proposed_refund_minor',case when multi then case when zero_initial then 20000 else 25000 end else 30000 end,'adjustments',case when multi then jsonb_build_array(jsonb_build_object('concept_id',gen_random_uuid(),'kind','recognized_work','beneficiary','seller','description','Reviewed work','amount_minor',case when zero_initial then 20000 else 15000 end,'evidence',request->'request_evidence')) else '[]'::jsonb end);
 if multi then terms:=terms||jsonb_build_object('allocations',(select jsonb_agg(jsonb_build_object('payment_id',id,'refund_minor',case when origin='initial' then case when zero_initial then 0 else 5000 end else 20000 end) order by id) from public.project_received_payments where project_id=(f->>'project')::uuid));end if;
 r:=public.refund_command('edit_draft',jsonb_build_object('settlement_id',parent,'expected_snapshot_id',null,'terms',terms),'financial-draft');snapshot:=(r->'snapshot'->>'id')::uuid;
 perform public.refund_command('reserve_pdf',jsonb_build_object('settlement_id',parent,'expected_snapshot_id',snapshot,'language','es'),'financial-pdf');
 insert into public.documents(owner_id,project_id,title,kind,original_filename,mime_type,size_bytes,sha256,ingestion_key,command_hash)
 values((f->>'owner')::uuid,(f->>'project')::uuid,'Test settlement','addendum','settlement.pdf','application/pdf',10,repeat('e',64),'financial-pdf',repeat('f',64)) returning * into pdf;
 insert into storage.objects(bucket_id,name,metadata) values('project-documents',pdf.storage_path,jsonb_build_object('size',10));
 perform public.refund_backend((f->>'owner')::uuid,'attach_pdf',jsonb_build_object('settlement_id',parent,'snapshot_id',snapshot,'document_id',pdf.id,'sha256',pdf.sha256));
 perform public.refund_command('review_pdf',jsonb_build_object('settlement_id',parent,'expected_snapshot_id',snapshot,'confirmed',true,'notes','Reviewed'),'financial-review');
 delivery:=public.refund_backend((f->>'owner')::uuid,'mail_reserve',jsonb_build_object('settlement_id',parent,'snapshot_id',snapshot,'operation_key','financial-mail','recipient','customer@example.invalid','sender','owner@example.invalid','message_hash',repeat('a',64),'preview','{}'::jsonb));
 perform public.refund_backend((f->>'owner')::uuid,'mail_finish',jsonb_build_object('settlement_id',parent,'snapshot_id',snapshot,'delivery_id',delivery->>'id','status','accepted_by_gmail','message_id','mail-test','thread_id','thread-test'));
 perform public.refund_command('accept',jsonb_build_object('settlement_id',parent,'expected_snapshot_id',snapshot,'confirmed',true,'notes','Reviewed documentary acceptance','evidence',jsonb_build_object('document_id',f->>'document','document_sha256',repeat('a',64))),'financial-accept');
 ctx:=public.refund_finance_backend((f->>'owner')::uuid,'context',jsonb_build_object('settlement_id',parent));
 select jsonb_agg(jsonb_build_object('payment_id',p->>'id','capture_id',p->>'capture_id','merchant_id',p->>'merchant_id','currency','USD','verified',true,'gross_minor',p->'amount_minor','previous_refunds_minor',0,'provider_remaining_minor',p->'amount_minor','original_fee_minor',100,'original_net_minor',(p->>'amount_minor')::bigint-100,'observed_at',now()) order by p->>'id') into facts from jsonb_array_elements(ctx->'received_payments') p where exists(select 1 from jsonb_array_elements(ctx->'payments') a where a->>'payment_id'=p->>'id' and (a->>'refund_minor')::bigint>0);
 check_result:=public.refund_finance_backend((f->>'owner')::uuid,'save_check',jsonb_build_object('settlement_id',parent,'expected_snapshot_id',snapshot,'evidence',facts,'policy',jsonb_build_object('environment','sandbox','test',true)));
 return f||jsonb_build_object('parent',parent,'snapshot',snapshot,'check',check_result->'check');
end $$;
