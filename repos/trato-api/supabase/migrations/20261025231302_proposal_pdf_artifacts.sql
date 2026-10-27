begin;
alter table public.proposal_revisions add column input_method text not null default 'manual' check(input_method='manual');
create table public.proposal_artifacts (
 revision_id uuid primary key, proposal_id uuid not null, owner_id uuid not null, project_id uuid not null,
 document_id uuid not null, sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default now(),
 unique(revision_id,document_id,sha256),
 foreign key(revision_id,proposal_id,project_id,owner_id) references public.proposal_revisions(id,proposal_id,project_id,owner_id),
 foreign key(document_id,project_id,owner_id) references public.documents(id,project_id,owner_id)
);
create index artifacts_owner_idx on public.proposal_artifacts(owner_id);
create index artifacts_revision_fk_idx on public.proposal_artifacts(revision_id,proposal_id,project_id,owner_id);
create index artifacts_document_fk_idx on public.proposal_artifacts(document_id,project_id,owner_id);
create index reviews_pdf_binding_idx on public.proposal_reviews(revision_id,addendum_document_id,addendum_sha256);
alter table public.proposal_reviews add foreign key(revision_id,addendum_document_id,addendum_sha256)
 references public.proposal_artifacts(revision_id,document_id,sha256);
alter table public.proposal_artifacts enable row level security;
revoke all on public.proposal_artifacts from public,anon,authenticated;
grant select on public.proposal_artifacts to authenticated;
create policy own_artifacts on public.proposal_artifacts for select to authenticated using(owner_id=(select auth.uid()));
create or replace function private.proposal_revision(p_proposal uuid,p_terms jsonb,p_sources jsonb)
returns uuid language plpgsql set search_path='' as $$
declare u uuid:=auth.uid(); p public.change_proposals; h public.project_agreement_heads;
 ids uuid[]; item jsonb; subtotal bigint:=0; pos integer:=0; rev uuid:=gen_random_uuid(); n integer; snap text; qty integer; price bigint;
begin
 select * into p from public.change_proposals where id=p_proposal and owner_id=u;
 if not found then raise sqlstate 'PT404' using message='PROPOSAL_NOT_FOUND'; end if;
 select * into h from public.project_agreement_heads where project_id=p.project_id and owner_id=u;
 if jsonb_typeof(p_terms) is distinct from 'object' or p_terms-array['scope_summary','conditions','currency','deadline','line_items']<>'{}'::jsonb
  or jsonb_typeof(p_terms->'scope_summary') is distinct from 'string' or length(trim(p_terms->>'scope_summary')) not between 1 and 12000
  or jsonb_typeof(p_terms->'conditions') is distinct from 'string' or length(p_terms->>'conditions')>12000
  or p_terms->>'currency' is distinct from 'USD' or jsonb_typeof(p_terms->'line_items') is distinct from 'array'
  or jsonb_array_length(p_terms->'line_items') not between 1 and 100
  or coalesce(p_terms->>'deadline','') !~ '^\d{4}-\d{2}-\d{2}$' then raise sqlstate 'PT422' using message='INVALID_PROPOSAL_TERMS'; end if;
 for item in select value from jsonb_array_elements(p_terms->'line_items') loop
  if jsonb_typeof(item) is distinct from 'object' or item-array['description','quantity','unit_amount_minor']<>'{}'::jsonb
   or jsonb_typeof(item->'description') is distinct from 'string' or length(trim(item->>'description')) not between 1 and 1000
   or jsonb_typeof(item->'quantity') is distinct from 'number' or coalesce(item->>'quantity','') !~ '^[0-9]{1,6}$'
   or jsonb_typeof(item->'unit_amount_minor') is distinct from 'number' or coalesce(item->>'unit_amount_minor','') !~ '^[0-9]{1,11}$' then raise sqlstate 'PT422' using message='INVALID_PROPOSAL_ITEM'; end if;
  qty:=(item->>'quantity')::integer; price:=(item->>'unit_amount_minor')::bigint;
  if qty not between 1 and 100000 or price>99999999999 then raise sqlstate 'PT422' using message='INVALID_PROPOSAL_ITEM'; end if;
  subtotal:=subtotal+qty::bigint*price;
  if subtotal>99999999999 then raise sqlstate 'PT422' using message='INVALID_PROPOSAL_AMOUNT'; end if;
 end loop;
 if jsonb_typeof(p_sources) is distinct from 'array' or jsonb_array_length(p_sources) not between 2 and 100 then raise sqlstate 'PT422' using message='INVALID_PROPOSAL_SOURCES'; end if;
 select array_agg(distinct value::uuid order by value::uuid) into ids from jsonb_array_elements_text(p_sources);
 if cardinality(ids)<>jsonb_array_length(p_sources) or not(p.request_document_id=any(ids)) then raise sqlstate 'PT422' using message='INVALID_PROPOSAL_SOURCES'; end if;
 -- Previously accepted terms/evidence remain linked through base_acceptance_id.
 if exists(select 1 from unnest(ids) x where not exists(select 1 from public.documents d join public.document_extractions e on e.document_id=d.id
   where d.id=x and d.project_id=p.project_id and d.owner_id=u and e.status='ready' and e.result_hash is not null))
  or not exists(select 1 from public.documents where id=any(ids) and owner_id=u and project_id=p.project_id and kind='initial_agreement') then raise sqlstate 'PT409' using message='PROPOSAL_SOURCE_NOT_READY'; end if;
 select encode(sha256(convert_to(jsonb_agg(jsonb_build_object('document_id',d.id,'sha256',d.sha256,'extraction_id',e.id,'result_hash',e.result_hash) order by d.id)::text,'UTF8')),'hex') into snap
 from public.documents d join public.document_extractions e on e.document_id=d.id where d.id=any(ids);
 select coalesce(max(revision_no),0)+1 into n from public.proposal_revisions where proposal_id=p.id;
 insert into public.proposal_revisions(id,proposal_id,owner_id,project_id,revision_no,base_generation,base_acceptance_id,scope_summary,conditions,currency,additional_minor,deadline,source_snapshot_hash)
 values(rev,p.id,u,p.project_id,n,h.generation,h.acceptance_id,trim(p_terms->>'scope_summary'),p_terms->>'conditions','USD',subtotal,(p_terms->>'deadline')::date,snap);
 for item in select value from jsonb_array_elements(p_terms->'line_items') loop
  pos:=pos+1;
  insert into public.proposal_revision_items values(rev,p.id,u,p.project_id,pos,trim(item->>'description'),(item->>'quantity')::integer,(item->>'unit_amount_minor')::bigint);
 end loop;
 insert into public.proposal_revision_sources
 select rev,p.id,u,p.project_id,d.id,e.id,d.sha256,e.result_hash from public.documents d join public.document_extractions e on e.document_id=d.id where d.id=any(ids);
 update public.change_proposals set current_revision_id=rev,status='draft' where id=p.id;
 return rev;
end $$;
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
