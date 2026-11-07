begin;
-- Change requests placed in the work plan (20261107020000) join the canonical graph snapshot:
-- a request under a stage, or new work after the plan. projection_version stays 2 on purpose:
-- workers that do not know this key ignore it, and the new key changes every project's content hash,
-- so maps are regenerated without breaking consumers that have not been deployed yet.
create or replace function private.graph_snapshot(p_project uuid,p_owner uuid) returns jsonb language sql stable security invoker set search_path='' as $$
with graph_project as (select p.id from public.projects p join public.clients c on c.id=p.client_id and c.owner_id=p.owner_id where p.id=p_project and p.owner_id=p_owner and p.deleted_at is null and c.deleted_at is null)
select jsonb_build_object('schema_version',1,'projection_version',2,'owner_id',p_owner,'project_id',p_project,
 'project',(select jsonb_build_object('id',p.id,'name',p.name,'status',p.status,'client_id',p.client_id,'client_name',c.name)
 from public.projects p join public.clients c on c.id=p.client_id and c.owner_id=p.owner_id
 where p.id=p_project and p.owner_id=p_owner and p.deleted_at is null and c.deleted_at is null),
'documents',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from (select id,title,kind,mime_type,sha256,created_at from public.documents where project_id=p_project and owner_id=p_owner and deleted_at is null) x),'[]'::jsonb),
'document_extractions',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from (select id,document_id,status,result_hash,created_at,completed_at from public.document_extractions where project_id=p_project and owner_id=p_owner and document_id in(select id from public.documents where deleted_at is null)) x),'[]'::jsonb),
'change_proposals',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from (select id,request_document_id,current_revision_id,status,locked_at,created_at from public.change_proposals where project_id=p_project and owner_id=p_owner and exists(select 1 from graph_project)) x),'[]'::jsonb),
'proposal_revisions',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from (select id,proposal_id,revision_no,draft_sequence,replaces_draft_id,feedback_document_id,base_acceptance_id,scope_summary,conditions,currency,additional_minor,deadline,created_at from public.proposal_revisions where project_id=p_project and owner_id=p_owner and exists(select 1 from graph_project)) x),'[]'::jsonb),
'proposal_revision_sources',coalesce((select jsonb_agg(to_jsonb(x) order by x.revision_id) from (select revision_id,document_id,extraction_id,document_sha256,extraction_result_hash from public.proposal_revision_sources where project_id=p_project and owner_id=p_owner and exists(select 1 from graph_project)) x),'[]'::jsonb),
'proposal_artifacts',coalesce((select jsonb_agg(to_jsonb(x) order by x.revision_id) from (select revision_id,document_id,sha256,created_at from public.proposal_artifacts where project_id=p_project and owner_id=p_owner and exists(select 1 from graph_project)) x),'[]'::jsonb),
'proposal_reviews',coalesce((select jsonb_agg(to_jsonb(x) order by x.revision_id) from (select revision_id,addendum_document_id,addendum_sha256,reviewed_at from public.proposal_reviews where project_id=p_project and owner_id=p_owner and exists(select 1 from graph_project)) x),'[]'::jsonb),
'proposal_acceptances',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from (select id,revision_id,returned_document_id,returned_sha256,method,cryptographic_signature_verified,created_at from public.proposal_acceptances where project_id=p_project and owner_id=p_owner and exists(select 1 from graph_project)) x),'[]'::jsonb),
'proposal_deliveries',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from (select id,revision_id,kind,status,created_at,updated_at from public.proposal_deliveries where project_id=p_project and owner_id=p_owner and exists(select 1 from graph_project)) x),'[]'::jsonb),
'proposal_payments',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from (select id,revision_id,acceptance_id,status,amount_minor,currency,created_at,updated_at from public.proposal_payments where project_id=p_project and owner_id=p_owner and exists(select 1 from graph_project)) x),'[]'::jsonb),
'project_agreement_heads',coalesce((select jsonb_agg(to_jsonb(x) order by x.generation) from (select acceptance_id,generation from public.project_agreement_heads where project_id=p_project and owner_id=p_owner and exists(select 1 from graph_project)) x),'[]'::jsonb),
'project_start_plans',coalesce((select jsonb_agg(to_jsonb(x) order by x.project_id) from (
 select project_id,budget,currency,target_date,summary,created_at,completed_at from public.project_start_plans
 where project_id=p_project and owner_id=p_owner and exists(select 1 from graph_project)) x),'[]'::jsonb),
'project_start_stages',coalesce((select jsonb_agg(to_jsonb(x) order by x.position) from (
 select position,title,deliverables,percent,payment_condition,amount from public.project_start_stages
 where project_id=p_project and owner_id=p_owner and exists(select 1 from graph_project)) x),'[]'::jsonb),
'plan_stage_evidence',coalesce((select jsonb_agg(to_jsonb(x) order by x.stage_position,x.document_id) from (
 select ctx.document_id,ctx.stage_position,ctx.created_at from public.document_upload_contexts ctx
 join public.documents d on d.id=ctx.document_id and d.owner_id=ctx.owner_id and d.project_id=ctx.project_id
 join public.project_start_stages st on st.project_id=ctx.project_id and st.owner_id=ctx.owner_id and st.position=ctx.stage_position
 where ctx.project_id=p_project and ctx.owner_id=p_owner and ctx.purpose='delivery_evidence' and d.deleted_at is null and exists(select 1 from graph_project)) x),'[]'::jsonb),
'plan_stage_payments',coalesce((select jsonb_agg(to_jsonb(x) order by x.stage_position,x.id) from (
 select co.id,co.stage_position,co.status,co.amount_minor,co.currency,co.paid_at,co.evidence_document_id,r.id as received_payment_id
 from public.project_initial_checkouts co
 join public.project_received_payments r on r.project_id=co.project_id and r.owner_id=co.owner_id and r.capture_id=co.capture_id
  and r.order_id=co.order_id and r.merchant_id=co.merchant_id and r.amount_minor=co.amount_minor and r.currency=co.currency and r.origin='initial'
 join public.project_start_stages st on st.project_id=co.project_id and st.owner_id=co.owner_id and st.position=co.stage_position
 join public.documents d on d.id=co.evidence_document_id and d.project_id=co.project_id and d.owner_id=co.owner_id and d.deleted_at is null
 where co.project_id=p_project and co.owner_id=p_owner and co.status='completed' and co.paid_at is not null and r.verified_at is not null and exists(select 1 from graph_project)) x),'[]'::jsonb),
'change_request_plan_placements',coalesce((select jsonb_agg(to_jsonb(x) order by x.request_document_id) from (
 select pl.request_document_id,pl.placement,pl.stage_position from public.change_request_plan_placements pl
 join public.documents d on d.id=pl.request_document_id and d.project_id=pl.project_id and d.owner_id=pl.owner_id and d.deleted_at is null
 where pl.project_id=p_project and pl.owner_id=p_owner and exists(select 1 from graph_project)) x),'[]'::jsonb)
);$$;
revoke all on function private.graph_snapshot(uuid,uuid) from public,anon,authenticated;
commit;
