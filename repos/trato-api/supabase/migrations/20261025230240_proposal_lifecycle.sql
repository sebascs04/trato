-- Manual business decisions only. No provider-paid flag, auto-signing or mail sends.
begin;
create table public.project_agreement_heads (
 project_id uuid not null, owner_id uuid not null,
 generation integer not null default 0 check(generation>=0),
 acceptance_id uuid,
 primary key(project_id,owner_id),
 foreign key(project_id,owner_id) references public.projects(id,owner_id)
);
create table public.change_proposals (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null,
 project_id uuid not null, request_document_id uuid not null,
 current_revision_id uuid, locked_at timestamptz, status text not null default 'draft'
 check(status in ('draft','ready_for_review','accepted')),
 created_at timestamptz not null default now(),
 unique(id,project_id,owner_id), unique(owner_id,project_id,request_document_id),
 foreign key(project_id,owner_id) references public.projects(id,owner_id),
 foreign key(request_document_id,project_id,owner_id) references public.documents(id,project_id,owner_id)
);
create table public.proposal_revisions (
 id uuid primary key default gen_random_uuid(), proposal_id uuid not null,
 owner_id uuid not null, project_id uuid not null,
 revision_no integer not null check(revision_no>0),
 base_generation integer not null check(base_generation>=0),
 base_acceptance_id uuid,
 scope_summary text not null check(length(trim(scope_summary)) between 1 and 12000),
 conditions text not null check(length(conditions)<=12000),
 currency text not null check(currency='USD'),
 additional_minor bigint not null check(additional_minor between 0 and 99999999999),
 deadline date not null,
 source_snapshot_hash text not null check(source_snapshot_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default now(),
 unique(proposal_id,revision_no), unique(id,proposal_id,project_id,owner_id),
 foreign key(proposal_id,project_id,owner_id) references public.change_proposals(id,project_id,owner_id)
);
alter table public.change_proposals add foreign key(current_revision_id,id,project_id,owner_id)
 references public.proposal_revisions(id,proposal_id,project_id,owner_id);
create table public.proposal_revision_items (
 revision_id uuid not null, proposal_id uuid not null, owner_id uuid not null, project_id uuid not null,
 ordinal integer not null check(ordinal between 1 and 100),
 description text not null check(length(trim(description)) between 1 and 1000),
 quantity integer not null check(quantity between 1 and 100000),
 unit_amount_minor bigint not null check(unit_amount_minor between 0 and 99999999999),
 primary key(revision_id,ordinal),
 foreign key(revision_id,proposal_id,project_id,owner_id) references public.proposal_revisions(id,proposal_id,project_id,owner_id)
);
create table public.proposal_revision_sources (
 revision_id uuid not null, proposal_id uuid not null, owner_id uuid not null, project_id uuid not null,
 document_id uuid not null, extraction_id uuid not null,
 document_sha256 text not null check(document_sha256 ~ '^[a-f0-9]{64}$'),
 extraction_result_hash text not null check(extraction_result_hash ~ '^[a-f0-9]{64}$'),
 primary key(revision_id,document_id),
 foreign key(revision_id,proposal_id,project_id,owner_id) references public.proposal_revisions(id,proposal_id,project_id,owner_id),
 foreign key(extraction_id,document_id,project_id,owner_id) references public.document_extractions(id,document_id,project_id,owner_id)
);
create table public.proposal_reviews (
 revision_id uuid primary key, proposal_id uuid not null, owner_id uuid not null, project_id uuid not null,
 addendum_document_id uuid not null, addendum_sha256 text not null,
 reviewer_id uuid not null references auth.users(id),
 reviewed_at timestamptz not null default now(),
 unique(revision_id,proposal_id,project_id,owner_id),
 foreign key(revision_id,proposal_id,project_id,owner_id) references public.proposal_revisions(id,proposal_id,project_id,owner_id),
 foreign key(addendum_document_id,project_id,owner_id) references public.documents(id,project_id,owner_id)
);
create table public.proposal_acceptances (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null, project_id uuid not null,
 proposal_id uuid not null, revision_id uuid not null unique,
 returned_document_id uuid not null, returned_sha256 text not null,
 reviewer_id uuid not null references auth.users(id),
 review_notes text not null check(length(trim(review_notes)) between 1 and 4000),
 method text not null default 'manual_document_review' check(method='manual_document_review'),
 cryptographic_signature_verified boolean not null default false check(not cryptographic_signature_verified),
 created_at timestamptz not null default now(),
 unique(id,project_id,owner_id),
 foreign key(revision_id,proposal_id,project_id,owner_id) references public.proposal_reviews(revision_id,proposal_id,project_id,owner_id),
 foreign key(returned_document_id,project_id,owner_id) references public.documents(id,project_id,owner_id)
);
alter table public.proposal_revisions add foreign key(base_acceptance_id,project_id,owner_id)
 references public.proposal_acceptances(id,project_id,owner_id);
alter table public.project_agreement_heads add foreign key(acceptance_id,project_id,owner_id)
 references public.proposal_acceptances(id,project_id,owner_id);
create table public.proposal_events (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null, project_id uuid not null,
 proposal_id uuid not null, revision_id uuid not null,
 event_type text not null check(event_type in ('revision_created','proposal_reviewed','acceptance_recorded')),
 actor_id uuid not null references auth.users(id), created_at timestamptz not null default now(),
 unique(revision_id,event_type),
 foreign key(revision_id,proposal_id,project_id,owner_id) references public.proposal_revisions(id,proposal_id,project_id,owner_id)
);
create table private.proposal_commands (
 owner_id uuid not null references auth.users(id), idempotency_key text not null check(length(idempotency_key) between 1 and 128),
 command_hash text not null, result jsonb,
 primary key(owner_id,idempotency_key)
);
alter table private.proposal_commands enable row level security;
revoke all on private.proposal_commands from public,anon,authenticated;

create index proposals_owner_project_idx on public.change_proposals(owner_id,project_id,created_at);
create index proposals_request_idx on public.change_proposals(request_document_id,project_id,owner_id);
create index proposals_revision_idx on public.change_proposals(current_revision_id,id,project_id,owner_id);
create index revisions_proposal_idx on public.proposal_revisions(proposal_id,project_id,owner_id);
create index revisions_base_acceptance_idx on public.proposal_revisions(base_acceptance_id,project_id,owner_id);
create index revisions_owner_idx on public.proposal_revisions(owner_id);
create index items_owner_idx on public.proposal_revision_items(owner_id);
create index items_revision_fk_idx on public.proposal_revision_items(revision_id,proposal_id,project_id,owner_id);
create index sources_owner_idx on public.proposal_revision_sources(owner_id);
create index sources_revision_fk_idx on public.proposal_revision_sources(revision_id,proposal_id,project_id,owner_id);
create index sources_extraction_fk_idx on public.proposal_revision_sources(extraction_id,document_id,project_id,owner_id);
create index reviews_owner_idx on public.proposal_reviews(owner_id);
create index reviews_revision_fk_idx on public.proposal_reviews(revision_id,proposal_id,project_id,owner_id);
create index reviews_document_fk_idx on public.proposal_reviews(addendum_document_id,project_id,owner_id);
create index reviews_reviewer_idx on public.proposal_reviews(reviewer_id);
create index acceptances_owner_project_idx on public.proposal_acceptances(owner_id,project_id);
create index acceptances_revision_fk_idx on public.proposal_acceptances(revision_id,proposal_id,project_id,owner_id);
create index acceptances_document_fk_idx on public.proposal_acceptances(returned_document_id,project_id,owner_id);
create index acceptances_reviewer_idx on public.proposal_acceptances(reviewer_id);
create index events_owner_project_idx on public.proposal_events(owner_id,project_id,created_at);
create index events_revision_fk_idx on public.proposal_events(revision_id,proposal_id,project_id,owner_id);
create index proposal_events_actor_idx on public.proposal_events(actor_id);
create index heads_owner_idx on public.project_agreement_heads(owner_id);
create index heads_acceptance_idx on public.project_agreement_heads(acceptance_id,project_id,owner_id);

do $$ declare t text; begin
 foreach t in array array['project_agreement_heads','change_proposals','proposal_revisions','proposal_revision_items','proposal_revision_sources','proposal_reviews','proposal_acceptances','proposal_events'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy own_proposals on public.%I for select to authenticated using(owner_id=(select auth.uid()))',t);
 end loop;
end $$;

-- Internal helper executes only through the owner-checking command, never from Data API.
create function private.proposal_revision(p_proposal uuid,p_terms jsonb,p_sources jsonb)
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
 insert into public.proposal_events(owner_id,project_id,proposal_id,revision_id,event_type,actor_id) values(u,p.project_id,p.id,rev,'revision_created',u);
 return rev;
end $$;
revoke all on function private.proposal_revision(uuid,jsonb,jsonb) from public,anon,authenticated;

create function private.proposal_command(p_action text,p_data jsonb,p_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); command_digest text; command_result jsonb; project uuid;
 p public.change_proposals; r public.proposal_revisions; h public.project_agreement_heads; v public.proposal_reviews; doc public.documents;
 proposal uuid; revision uuid; acceptance uuid;
begin
 if u is null then raise sqlstate 'PT401' using message='UNAUTHORIZED'; end if;
 if p_action not in ('create','revise','review','accept') or p_action is null or jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>100000
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
  if p_data->'confirmed' is distinct from 'true'::jsonb then raise sqlstate 'PT422' using message='EXPLICIT_REVIEW_REQUIRED'; end if;
  if exists(select 1 from public.proposal_revision_sources s join public.documents d on d.id=s.document_id join public.document_extractions e on e.id=s.extraction_id
   where s.revision_id=r.id and (d.sha256<>s.document_sha256 or e.result_hash is distinct from s.extraction_result_hash or e.status<>'ready')) then raise sqlstate 'PT409' using message='PROPOSAL_SOURCE_CHANGED'; end if;
  select * into doc from public.documents where id=(p_data->>'document_id')::uuid and owner_id=u and project_id=project and kind='addendum' and mime_type='application/pdf';
  if not found then raise sqlstate 'PT404' using message='ADDENDUM_DOCUMENT_NOT_FOUND'; end if;
  if not exists(select 1 from storage.objects where bucket_id='project-documents' and name=doc.storage_path and owner_id=u::text and (metadata->>'size')::bigint=doc.size_bytes) then raise sqlstate 'PT409' using message='ORIGINAL_NOT_STORED'; end if;
  revision:=r.id;
  if p_action='review' then
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
   update public.change_proposals set status='accepted' where id=p.id;
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
revoke all on function private.proposal_command(text,jsonb,text) from public,anon;
grant execute on function private.proposal_command(text,jsonb,text) to authenticated;
create function public.proposal_command(p_action text,p_data jsonb,p_key text)
returns jsonb language sql security invoker set search_path='' as $$ select private.proposal_command(p_action,p_data,p_key) $$;
revoke all on function public.proposal_command(text,jsonb,text) from public,anon;
grant execute on function public.proposal_command(text,jsonb,text) to authenticated;
commit;
