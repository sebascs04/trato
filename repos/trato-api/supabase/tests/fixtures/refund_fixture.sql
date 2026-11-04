-- Synthetic fixture helper, only loaded by tests. Not a production migration.
create or replace function pg_temp.refund_fixture() returns jsonb language plpgsql as $$
declare u uuid:=gen_random_uuid();c uuid:=gen_random_uuid();p uuid:=gen_random_uuid();d uuid:=gen_random_uuid();
 e uuid:=gen_random_uuid();proposal uuid:=gen_random_uuid();revision uuid:=gen_random_uuid();
 acceptance uuid:=gen_random_uuid();payment uuid:=gen_random_uuid();
begin
 insert into auth.users(id,email) values(u,u::text||'@example.invalid');
 insert into public.clients(id,owner_id,name) values(c,u,'Refund SQL fixture');
 insert into public.projects(id,owner_id,client_id,name) values(p,u,c,'Refund test');
 insert into public.documents(id,owner_id,project_id,title,kind,original_filename,mime_type,size_bytes,sha256,ingestion_key,command_hash)
 values(d,u,p,'Evidence','reference','evidence.pdf','application/pdf',10,repeat('a',64),'fixture',repeat('b',64));
 insert into public.document_extractions(id,owner_id,project_id,document_id,status,parser,parser_version,result_hash,completed_at)
 values(e,u,p,d,'ready','test','1',repeat('c',64),now());
 insert into public.document_segments(owner_id,project_id,document_id,extraction_id,ordinal,locator_kind,locator_number,text)
 values(u,p,d,e,1,'page',1,'Cancel please. Work recognized: USD 120. Cancellation fee: USD 30.');
 insert into public.change_proposals(id,owner_id,project_id,request_document_id,status,locked_at) values(proposal,u,p,d,'accepted',now());
 insert into public.proposal_revisions(id,proposal_id,owner_id,project_id,revision_no,base_generation,scope_summary,conditions,currency,additional_minor,deadline,source_snapshot_hash)
 values(revision,proposal,u,p,1,0,'Fixture','Test','USD',30000,current_date,repeat('d',64));
 update public.change_proposals set current_revision_id=revision where id=proposal;
 insert into public.proposal_artifacts(revision_id,proposal_id,owner_id,project_id,document_id,sha256) values(revision,proposal,u,p,d,repeat('a',64));
 insert into public.proposal_reviews(revision_id,proposal_id,owner_id,project_id,addendum_document_id,addendum_sha256,reviewer_id) values(revision,proposal,u,p,d,repeat('a',64),u);
 insert into public.proposal_acceptances(id,owner_id,project_id,proposal_id,revision_id,returned_document_id,returned_sha256,reviewer_id,review_notes)
 values(acceptance,u,p,proposal,revision,d,repeat('a',64),u,'Fixture only');
 insert into public.proposal_payments(id,owner_id,project_id,proposal_id,revision_id,acceptance_id,amount_minor,currency,merchant_id,status,capture_id,checkout_token)
 values(payment,u,p,proposal,revision,acceptance,30000,'USD','TEST-MERCHANT','completed','TEST-'||payment::text,'TOKEN-'||payment::text);
 return jsonb_build_object('owner',u,'project',p,'payment',payment,'document',d,'extraction',e,
  'request',jsonb_build_object('project_id',p,'payment_id',payment,'scope','payment_only','reason','Cancellation',
  'requested_by','customer','request_evidence',jsonb_build_array(jsonb_build_object('document_id',d,'extraction_id',e,'document_sha256',repeat('a',64),'quote','Cancel please.'))));
end $$;
