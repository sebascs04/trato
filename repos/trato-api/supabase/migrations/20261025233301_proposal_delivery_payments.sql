begin;
create table public.proposal_deliveries(
 id uuid primary key default gen_random_uuid(),owner_id uuid not null,project_id uuid not null,proposal_id uuid not null,revision_id uuid not null,
 kind text not null check(kind in('adenda','payment')),recipient text not null,message_hash text not null,
 status text not null default 'sending' check(status in('sending','accepted_by_gmail','failed','delivery_uncertain')),
 provider_message_id text,error_code text,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(revision_id,kind),foreign key(revision_id,proposal_id,project_id,owner_id) references public.proposal_revisions(id,proposal_id,project_id,owner_id)
);
create table public.proposal_payments(
 id uuid primary key default gen_random_uuid(),owner_id uuid not null,project_id uuid not null,proposal_id uuid not null,revision_id uuid not null,
 acceptance_id uuid not null unique references public.proposal_acceptances(id),amount_minor bigint not null check(amount_minor>0),currency text not null check(currency='USD'),merchant_id text not null,
 status text not null default 'creating' check(status in('creating','pending_approval','approved','capturing','pending','completed','failed','cancelled','reconciliation_required')),
 order_id text unique,capture_id text unique,approval_url text,checkout_token text not null unique,capture_attempted boolean not null default false,
 error_code text,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 foreign key(revision_id,proposal_id,project_id,owner_id) references public.proposal_revisions(id,proposal_id,project_id,owner_id)
);
create index proposal_deliveries_owner_idx on public.proposal_deliveries(owner_id);
create index proposal_deliveries_revision_fk_idx on public.proposal_deliveries(revision_id,proposal_id,project_id,owner_id);
create index proposal_payments_owner_idx on public.proposal_payments(owner_id);
create index proposal_payments_revision_fk_idx on public.proposal_payments(revision_id,proposal_id,project_id,owner_id);
alter table public.proposal_deliveries enable row level security;
alter table public.proposal_payments enable row level security;
revoke all on public.proposal_deliveries,public.proposal_payments from public,anon,authenticated;
grant select on public.proposal_deliveries,public.proposal_payments to authenticated;
create policy own_deliveries on public.proposal_deliveries for select to authenticated using(owner_id=(select auth.uid()));
create policy own_payments on public.proposal_payments for select to authenticated using(owner_id=(select auth.uid()));
create function private.proposal_backend(p_owner uuid,p_action text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.change_proposals;r public.proposal_revisions;a public.proposal_acceptances;m public.proposal_deliveries;pay public.proposal_payments;previous text;
begin
 if p_action='checkout' then
  select * into pay from public.proposal_payments where checkout_token=p_data->>'token';
  if not found then raise sqlstate 'PT404' using message='PAYMENT_NOT_FOUND'; end if;
  return to_jsonb(pay);
 end if;
 if p_action in('payment_apply','capture_claim','payment_uncertain') then
  select * into pay from public.proposal_payments where id=(p_data->>'payment_id')::uuid and owner_id=p_owner;
  if not found then raise sqlstate 'PT404' using message='PAYMENT_NOT_FOUND'; end if;
  select * into p from public.change_proposals where id=pay.proposal_id for update;
  select * into pay from public.proposal_payments where id=pay.id for update;
  if pay.status='completed' then return to_jsonb(pay); end if;
  if p.current_revision_id<>pay.revision_id or p.status<>'accepted' then raise sqlstate 'PT409' using message='PAYMENT_REVISION_CONFLICT'; end if;
  if p_action='capture_claim' then
   if pay.status<>'approved' or pay.capture_attempted then raise sqlstate 'PT409' using message='CAPTURE_RECONCILIATION_REQUIRED'; end if;
   update public.proposal_payments set capture_attempted=true,status='capturing',updated_at=now() where id=pay.id returning * into pay;
  elsif p_action='payment_uncertain' then
   update public.proposal_payments set status='reconciliation_required',error_code=p_data->>'error_code',updated_at=now() where id=pay.id returning * into pay;
  else
   if pay.order_id is not null and pay.order_id is distinct from p_data->>'order_id' then raise sqlstate 'PT409' using message='PAYMENT_EVIDENCE_MISMATCH'; end if;
   if (p_data->>'amount_minor')::bigint<>pay.amount_minor or p_data->>'currency'<>pay.currency or p_data->>'merchant_id'<>pay.merchant_id then raise sqlstate 'PT409' using message='PAYMENT_EVIDENCE_MISMATCH'; end if;
   if p_data->>'status' not in('pending_approval','approved','pending','completed','failed','cancelled') then raise sqlstate 'PT422' using message='INVALID_PAYMENT_STATUS'; end if;
   if p_data->>'status'='completed' and nullif(p_data->>'capture_id','') is null then raise sqlstate 'PT409' using message='CAPTURE_EVIDENCE_REQUIRED'; end if;
   update public.proposal_payments set status=p_data->>'status',order_id=p_data->>'order_id',capture_id=p_data->>'capture_id',approval_url=p_data->>'approval_url',error_code=null,updated_at=now() where id=pay.id returning * into pay;
   if pay.status='completed' then update public.change_proposals set locked_at=now() where id=p.id; end if;
  end if;
  return to_jsonb(pay);
 end if;
 select * into p from public.change_proposals where id=(p_data->>'proposal_id')::uuid and owner_id=p_owner for update;
 if not found then raise sqlstate 'PT404' using message='PROPOSAL_NOT_FOUND'; end if;
 select * into r from public.proposal_revisions where id=p.current_revision_id;
 if r.id is distinct from (p_data->>'revision_id')::uuid then raise sqlstate 'PT409' using message='PROPOSAL_REVISION_CONFLICT'; end if;
 if p_action='payment_prepare' then
  if p.status<>'accepted' or p.locked_at is not null then raise sqlstate 'PT409' using message='ACCEPTANCE_REQUIRED'; end if;
  select * into a from public.proposal_acceptances where revision_id=r.id;
  if not found then raise sqlstate 'PT409' using message='ACCEPTANCE_REQUIRED'; end if;
  if r.additional_minor=0 then raise sqlstate 'PT409' using message='PAYMENT_NOT_REQUIRED'; end if;
  select * into pay from public.proposal_payments where acceptance_id=a.id;
  if found then return to_jsonb(pay)||jsonb_build_object('acquired',false); end if;
  if not exists(select 1 from public.proposal_deliveries where revision_id=r.id and kind='adenda' and status='accepted_by_gmail') then raise sqlstate 'PT409' using message='ADENDA_SEND_REQUIRED'; end if;
  insert into public.proposal_payments(owner_id,project_id,proposal_id,revision_id,acceptance_id,amount_minor,currency,merchant_id,checkout_token)
   values(p_owner,p.project_id,p.id,r.id,a.id,r.additional_minor,r.currency,p_data->>'merchant_id',p_data->>'token') returning * into pay;
  return to_jsonb(pay)||jsonb_build_object('acquired',true);
 elsif p_action='mail_reserve' then
  if p_data->>'kind'='adenda' then
   if p.status<>'ready_for_review' or not exists(select 1 from public.proposal_reviews where revision_id=r.id) then raise sqlstate 'PT409' using message='PROPOSAL_REVIEW_REQUIRED'; end if;
  elsif p_data->>'kind'='payment' then
   if p.status<>'accepted' or not exists(select 1 from public.proposal_payments where revision_id=r.id and status='pending_approval') then raise sqlstate 'PT409' using message='PAYMENT_NOT_READY'; end if;
  else raise sqlstate 'PT422' using message='INVALID_MAIL_KIND'; end if;
  if not exists(select 1 from public.projects pr join public.clients c on c.id=pr.client_id where pr.id=p.project_id and pr.owner_id=p_owner and c.contact_email=p_data->>'recipient') then raise sqlstate 'PT409' using message='RECIPIENT_CHANGED'; end if;
  select * into m from public.proposal_deliveries where revision_id=r.id and kind=p_data->>'kind';
  if found then
   if m.message_hash<>p_data->>'message_hash' or m.recipient<>p_data->>'recipient' then raise sqlstate 'PT409' using message='EMAIL_CONTEXT_CHANGED'; end if;
   return to_jsonb(m)||jsonb_build_object('acquired',false);
  end if;
  insert into public.proposal_deliveries(owner_id,project_id,proposal_id,revision_id,kind,recipient,message_hash)
   values(p_owner,p.project_id,p.id,r.id,p_data->>'kind',p_data->>'recipient',p_data->>'message_hash') returning * into m;
  return to_jsonb(m)||jsonb_build_object('acquired',true);
 elsif p_action='mail_finish' then
  select * into m from public.proposal_deliveries where id=(p_data->>'delivery_id')::uuid and owner_id=p_owner and revision_id=r.id for update;
  if not found then raise sqlstate 'PT404' using message='DELIVERY_NOT_FOUND'; end if;
  if m.status<>'sending' then raise sqlstate 'PT409' using message='EMAIL_ALREADY_FINISHED'; end if;
  if p_data->>'status' not in('accepted_by_gmail','failed','delivery_uncertain') then raise sqlstate 'PT422' using message='INVALID_MAIL_RESULT'; end if;
  if p_data->>'status'='accepted_by_gmail' and nullif(p_data->>'message_id','') is null then raise sqlstate 'PT422' using message='EMAIL_RESULT_REQUIRED'; end if;
  update public.proposal_deliveries set status=p_data->>'status',provider_message_id=p_data->>'message_id',error_code=p_data->>'error_code',updated_at=now() where id=m.id returning * into m;
  return to_jsonb(m);
 end if;
 raise sqlstate 'PT422' using message='INVALID_BACKEND_COMMAND';
end $$;
revoke all on function private.proposal_backend(uuid,text,jsonb) from public,anon,authenticated;
grant usage on schema private to service_role;
grant execute on function private.proposal_backend(uuid,text,jsonb) to service_role;
create function public.proposal_backend(p_owner uuid,p_action text,p_data jsonb)
returns jsonb language sql security invoker set search_path='' as $$select private.proposal_backend(p_owner,p_action,p_data)$$;
revoke all on function public.proposal_backend(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.proposal_backend(uuid,text,jsonb) to service_role;
create or replace function private.proposal_command(p_action text,p_data jsonb,p_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); command_digest text; command_result jsonb; project uuid;
 p public.change_proposals; r public.proposal_revisions; h public.project_agreement_heads; v public.proposal_reviews; doc public.documents;
 proposal uuid; revision uuid; acceptance uuid;
begin
 if u is null then raise sqlstate 'PT401' using message='UNAUTHORIZED'; end if;
 if p_action not in ('create','revise','review','accept','attach_pdf') or p_action is null or jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>100000
  or p_key is null or length(p_key) not between 1 and 128 or p_key !~ '^[!-~]+$' then raise sqlstate 'PT422' using message='INVALID_PROPOSAL_COMMAND'; end if;
 command_digest:=encode(sha256(convert_to(jsonb_build_object('action',p_action,'data',p_data)::text,'UTF8')),'hex');
 insert into private.proposal_commands(owner_id,idempotency_key,command_hash) values(u,p_key,command_digest) on conflict do nothing;
 select result into command_result from private.proposal_commands where owner_id=u and idempotency_key=p_key and command_hash=command_digest for update;
 if not found then raise sqlstate 'PT409' using message='IDEMPOTENCY_CONFLICT'; end if;
 if command_result is not null then return command_result; end if;
 if p_action='create' then
  project:=(p_data->>'project_id')::uuid;
 else
  select * into p from public.change_proposals where id=(p_data->>'proposal_id')::uuid and owner_id=u;
  if not found then raise sqlstate 'PT404' using message='PROPOSAL_NOT_FOUND'; end if;
  project:=p.project_id;
 end if;
 if not exists(select 1 from public.projects where id=project and owner_id=u) then raise sqlstate 'PT404' using message='PROJECT_NOT_FOUND'; end if;
 insert into public.project_agreement_heads(project_id,owner_id) values(project,u) on conflict do nothing;
 -- All commands acquire the head before the proposal: deterministic lock ordering.
 select * into h from public.project_agreement_heads where project_id=project and owner_id=u for update;
 if p_action='create' then
  if not exists(select 1 from public.documents where id=(p_data->>'request_document_id')::uuid and project_id=project and owner_id=u and kind='email_request') then raise sqlstate 'PT404' using message='REQUEST_DOCUMENT_NOT_FOUND'; end if;
  insert into public.change_proposals(owner_id,project_id,request_document_id) values(u,project,(p_data->>'request_document_id')::uuid) returning * into p;
 else
  select * into p from public.change_proposals where id=p.id and owner_id=u for update;
  if p.current_revision_id is distinct from (p_data->>'expected_revision_id')::uuid then raise sqlstate 'PT409' using message='PROPOSAL_REVISION_CONFLICT'; end if;
  if exists(select 1 from public.proposal_deliveries where proposal_id=p.id and status='sending') then raise sqlstate 'PT409' using message='EMAIL_IN_PROGRESS'; end if;
  if p_action='revise' and exists(select 1 from public.proposal_payments where proposal_id=p.id and status not in('failed','cancelled')) then raise sqlstate 'PT409' using message='PAYMENT_IN_PROGRESS'; end if;
  if p.locked_at is not null then raise sqlstate 'PT409' using message='CHANGE_READ_ONLY'; end if;
  if p.status='accepted' and p_action<>'revise' then raise sqlstate 'PT409' using message='PROPOSAL_ALREADY_ACCEPTED'; end if;
 end if;
 if p_action in ('create','revise') then
  revision:=private.proposal_revision(p.id,p_data->'terms',p_data->'source_document_ids');
 else
  select * into r from public.proposal_revisions where id=p.current_revision_id;
  if r.base_generation<>h.generation then raise sqlstate 'PT409' using message='AGREEMENT_GENERATION_CONFLICT'; end if;
  if p_action<>'attach_pdf' and p_data->'confirmed' is distinct from 'true'::jsonb then raise sqlstate 'PT422' using message='EXPLICIT_REVIEW_REQUIRED'; end if;
  if exists(select 1 from public.proposal_revision_sources s join public.documents d on d.id=s.document_id join public.document_extractions e on e.id=s.extraction_id
   where s.revision_id=r.id and (d.sha256<>s.document_sha256 or e.result_hash is distinct from s.extraction_result_hash or e.status<>'ready')) then raise sqlstate 'PT409' using message='PROPOSAL_SOURCE_CHANGED'; end if;
  select * into doc from public.documents where id=(p_data->>'document_id')::uuid and owner_id=u and project_id=project and kind='addendum' and mime_type='application/pdf';
  if not found then raise sqlstate 'PT404' using message='ADDENDUM_DOCUMENT_NOT_FOUND'; end if;
  if not exists(select 1 from storage.objects where bucket_id='project-documents' and name=doc.storage_path and owner_id=u::text and (metadata->>'size')::bigint=doc.size_bytes) then raise sqlstate 'PT409' using message='ORIGINAL_NOT_STORED'; end if;
  revision:=r.id;
  if p_action='attach_pdf' then
   if p.status<>'draft' then raise sqlstate 'PT409' using message='PROPOSAL_ALREADY_REVIEWED'; end if;
   if exists(select 1 from public.proposal_artifacts where revision_id=r.id and (document_id<>doc.id or sha256<>doc.sha256)) then raise sqlstate 'PT409' using message='PROPOSAL_PDF_IMMUTABLE'; end if;
   insert into public.proposal_artifacts(revision_id,proposal_id,owner_id,project_id,document_id,sha256)
    values(r.id,p.id,u,project,doc.id,doc.sha256) on conflict(revision_id) do nothing;
   insert into public.proposal_events(owner_id,project_id,proposal_id,revision_id,event_type,actor_id)
    values(u,project,p.id,r.id,'revision_created',u) on conflict(revision_id,event_type) do nothing;
  elsif p_action='review' then
   if not exists(select 1 from public.proposal_artifacts where revision_id=r.id and document_id=doc.id and sha256=doc.sha256) then raise sqlstate 'PT409' using message='PROPOSAL_PDF_REQUIRED'; end if;
   if p.status<>'draft' then raise sqlstate 'PT409' using message='PROPOSAL_ALREADY_REVIEWED'; end if;
   insert into public.proposal_reviews(revision_id,proposal_id,owner_id,project_id,addendum_document_id,addendum_sha256,reviewer_id) values(r.id,p.id,u,project,doc.id,doc.sha256,u);
   update public.change_proposals set status='ready_for_review' where id=p.id;
   insert into public.proposal_events(owner_id,project_id,proposal_id,revision_id,event_type,actor_id) values(u,project,p.id,r.id,'proposal_reviewed',u);
  else
   if not exists(select 1 from public.proposal_deliveries where revision_id=r.id and kind='adenda' and status='accepted_by_gmail') then raise sqlstate 'PT409' using message='ADENDA_SEND_REQUIRED'; end if;
   if p.status<>'ready_for_review' then raise sqlstate 'PT409' using message='PROPOSAL_REVIEW_REQUIRED'; end if;
   select * into v from public.proposal_reviews where revision_id=r.id;
   if doc.id=v.addendum_document_id or doc.sha256=v.addendum_sha256 then raise sqlstate 'PT409' using message='RETURNED_DOCUMENT_REQUIRED'; end if;
   if jsonb_typeof(p_data->'review_notes') is distinct from 'string' or length(trim(p_data->>'review_notes')) not between 1 and 4000 then raise sqlstate 'PT422' using message='REVIEW_NOTES_REQUIRED'; end if;
   insert into public.proposal_acceptances(owner_id,project_id,proposal_id,revision_id,returned_document_id,returned_sha256,reviewer_id,review_notes)
    values(u,project,p.id,r.id,doc.id,doc.sha256,u,trim(p_data->>'review_notes')) returning id into acceptance;
   update public.change_proposals set status='accepted',locked_at=case when r.additional_minor=0 then now() else locked_at end where id=p.id;
   update public.project_agreement_heads set generation=generation+1,acceptance_id=acceptance where project_id=project and owner_id=u;
   insert into public.proposal_events(owner_id,project_id,proposal_id,revision_id,event_type,actor_id) values(u,project,p.id,r.id,'acceptance_recorded',u);
  end if;
 end if;
 command_result:=jsonb_build_object('proposal_id',p.id,'revision_id',revision,'acceptance_id',acceptance);
 update private.proposal_commands set result=command_result where owner_id=u and idempotency_key=p_key;
 return command_result;
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
 raise sqlstate 'PT422' using message='INVALID_PROPOSAL_COMMAND';
end $$;


commit;
