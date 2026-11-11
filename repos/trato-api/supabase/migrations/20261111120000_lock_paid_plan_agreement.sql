-- The initial agreement a confirmed plan was built from becomes evidence once the client has paid a stage of that plan:
-- from then on it cannot be removed or given another role (DOCUMENT_IN_USE), like any other document that money relies on.
-- Before the first payment it stays correctable, so a wrong upload is never punished. Same function, one more condition.
create or replace function public.project_document_backend(p_owner uuid, p_project uuid, p_document uuid, p_action text, p_kind text default null)
returns jsonb language plpgsql set search_path to '' as $$
declare pr public.projects; d public.documents; ctx public.document_upload_contexts; used boolean; special boolean;
begin
 if p_owner is null then raise sqlstate 'PT401' using message='UNAUTHORIZED'; end if;
 select * into pr from public.projects where id=p_project and owner_id=p_owner and deleted_at is null for update;
 if not found then raise sqlstate 'PT404' using message='PROJECT_NOT_FOUND'; end if;
 select * into d from public.documents where id=p_document and project_id=p_project and owner_id=p_owner for update;
 if not found then raise sqlstate 'PT404' using message='DOCUMENT_NOT_FOUND'; end if;
 select * into ctx from public.document_upload_contexts where document_id=p_document and project_id=p_project and owner_id=p_owner for update;
 if p_action='cleaned' then
  if d.deleted_at is null then raise sqlstate 'PT409' using message='DOCUMENT_NOT_REMOVED'; end if;
  update public.document_upload_contexts set vector_cleanup_status='complete' where document_id=p_document returning * into ctx;
  return jsonb_build_object('file_id',d.id,'client_id',pr.client_id,'cleanup_status',ctx.vector_cleanup_status);
 end if;
 if d.deleted_at is not null then raise sqlstate 'PT404' using message='DOCUMENT_NOT_FOUND'; end if;
 used := exists(select 1 from public.change_proposals x where x.request_document_id=p_document)
  or exists(select 1 from public.proposal_revision_sources x where x.document_id=p_document)
  or exists(select 1 from public.proposal_artifacts x where x.document_id=p_document)
  or exists(select 1 from public.proposal_reviews x where x.addendum_document_id=p_document)
  or exists(select 1 from public.proposal_acceptances x where x.returned_document_id=p_document)
  or exists(select 1 from public.proposal_revisions x where x.feedback_document_id=p_document)
  or exists(select 1 from public.project_initial_checkouts x where x.evidence_document_id=p_document)
  or exists(select 1 from public.project_stage_delivery_shares x where x.document_id=p_document)
  or exists(select 1 from public.project_stage_reviews x where x.document_id=p_document)
  or exists(select 1 from public.project_dispute_documents x where x.document_id=p_document)
  or exists(select 1 from public.client_problem_reports x where x.request_document_id=p_document)
  or exists(select 1 from public.refund_sources x where x.document_id=p_document)
  or exists(select 1 from public.refund_artifacts x where x.document_id=p_document)
  or exists(select 1 from public.request_closures x where x.request_document_id=p_document)
  or (d.kind='initial_agreement' and exists(select 1 from public.project_start_plans x where x.project_id=p_project)
      and exists(select 1 from public.project_initial_checkouts x where x.project_id=p_project and x.paid_at is not null));
 if used then raise sqlstate 'PT409' using message='DOCUMENT_IN_USE'; end if;
 if p_action='withdraw' then
  update public.documents set deleted_at=now() where id=p_document returning * into d;
  update public.document_upload_contexts set vector_cleanup_status=coalesce(vector_cleanup_status,'pending') where document_id=p_document returning * into ctx;
  return jsonb_build_object('file_id',d.id,'client_id',pr.client_id,'title',d.title,'withdrawn_at',d.deleted_at,'cleanup_status',coalesce(ctx.vector_cleanup_status,'pending'));
 end if;
 if p_action='set_kind' then
  if p_kind is null or p_kind not in ('initial_agreement','email_request','addendum','delivery','reference') then raise sqlstate 'PT422' using message='INVALID_DOCUMENT_KIND'; end if;
  -- A file tied to a deliverable, a refund case, an addendum or a request keeps the role that link gives it.
  special := ctx.document_id is not null and (ctx.stage_position is not null or ctx.refund_case_id is not null or ctx.proposal_id is not null
   or ctx.revision_id is not null or ctx.payment_id is not null or ctx.snapshot_id is not null
   or ctx.request_document_id is not null and ctx.request_document_id<>ctx.document_id);
  if special then raise sqlstate 'PT409' using message='DOCUMENT_ROLE_LOCKED'; end if;
  update public.documents set kind=p_kind where id=p_document returning * into d;
  if ctx.document_id is not null then
   -- A client request points to itself (request_document_id), as when it is registered; any other role points nowhere.
   update public.document_upload_contexts set purpose=case p_kind when 'initial_agreement' then 'initial_agreement' when 'email_request' then 'change_request'
    when 'delivery' then 'delivery_evidence' else 'supporting_reference' end,
    request_document_id=case when p_kind='email_request' then p_document else null end where document_id=p_document;
  end if;
  return jsonb_build_object('file_id',d.id,'kind',d.kind);
 end if;
 raise sqlstate 'PT422' using message='INVALID_REQUEST';
end $$;
revoke all on function public.project_document_backend(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.project_document_backend(uuid,uuid,uuid,text,text) to service_role;
