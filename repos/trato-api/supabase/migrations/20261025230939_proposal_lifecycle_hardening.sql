begin;
create index proposals_project_owner_fk_idx on public.change_proposals(project_id,owner_id);
create policy no_client_access on private.proposal_commands for all to authenticated using(false) with check(false);
create or replace function private.proposal_command(p_action text,p_data jsonb,p_key text)
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
