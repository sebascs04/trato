begin;

-- Activate per project while existing consumers still use projection 2.
create table private.refund_graph_rollout (
    project_id uuid primary key,
    owner_id uuid not null,
    foreign key(project_id,owner_id) references public.projects(id,owner_id) on delete cascade
);
revoke all on private.refund_graph_rollout from public,anon,authenticated,service_role;

-- Keep the existing project, plan and change projection as the base.
alter function private.graph_snapshot(uuid,uuid) rename to graph_snapshot_before_refunds;
create function private.graph_snapshot(p_project uuid,p_owner uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
with base as (
    select private.graph_snapshot_before_refunds(p_project,p_owner) as snapshot
), cases as (
    select r.id,r.scope,r.status,r.reason,r.current_snapshot_id,r.confirmed_refund_minor,r.created_at,r.closed_at
    from public.refund_settlements r cross join base
    where r.project_id=p_project and r.owner_id=p_owner and base.snapshot->'project'<>'null'::jsonb
), versions as (
    select s.id,s.settlement_id,s.version_no,s.draft_sequence,s.created_at,
           (s.breakdown->>'refund_minor')::bigint as amount_minor,
           s.id=r.current_snapshot_id as is_current_revision,a.created_at as accepted_at
    from public.refund_snapshots s join cases r on r.id=s.settlement_id
    left join public.refund_acceptances a on a.snapshot_id=s.id and a.owner_id=p_owner and a.project_id=p_project
    where s.project_id=p_project and s.owner_id=p_owner
), documents as (
    select id from public.documents where project_id=p_project and owner_id=p_owner and deleted_at is null
), evidence as (
    select s.settlement_id,s.snapshot_id,d.id as document_id,'source'::text as role
    from public.refund_sources s join cases r on r.id=s.settlement_id join documents d on d.id=s.document_id
    where s.project_id=p_project and s.owner_id=p_owner
    union
    select c.refund_case_id,c.snapshot_id,d.id,'source'
    from public.document_upload_contexts c join cases r on r.id=c.refund_case_id join documents d on d.id=c.document_id
    where c.project_id=p_project and c.owner_id=p_owner
    union
    select a.settlement_id,a.snapshot_id,d.id,'pdf'
    from public.refund_artifacts a join cases r on r.id=a.settlement_id join documents d on d.id=a.document_id
    where a.project_id=p_project and a.owner_id=p_owner
    union
    select a.settlement_id,a.snapshot_id,d.id,'acceptance'
    from public.refund_acceptances a join cases r on r.id=a.settlement_id join documents d on d.id::text=a.evidence->>'document_id'
    where a.project_id=p_project and a.owner_id=p_owner
    union
    select f.settlement_id,f.snapshot_id,d.id,'feedback'
    from public.refund_feedback f join cases r on r.id=f.settlement_id join documents d on d.id::text=f.evidence->>'document_id'
    where f.project_id=p_project and f.owner_id=p_owner
), payments as (
    select m.settlement_id,p.id,p.proposal_payment_id,p.origin,p.amount_minor,p.currency,p.verified_at
    from public.refund_settlement_payments m join cases r on r.id=m.settlement_id
    join public.project_received_payments p on p.id=m.payment_id and p.project_id=p_project and p.owner_id=p_owner
    where m.project_id=p_project and m.owner_id=p_owner
), receipts as (
    select x.settlement_id,r.id,r.payment_id,r.amount_minor,r.currency,r.confirmed_at
    from public.refund_receipt_applications x join cases c on c.id=x.settlement_id
    join public.refund_provider_receipts r on r.id=x.receipt_id and r.project_id=p_project and r.owner_id=p_owner
    join payments p on p.id=r.payment_id and p.settlement_id=x.settlement_id
    where x.project_id=p_project and x.owner_id=p_owner and r.status='completed' and r.confirmed_at is not null
)
select case when exists(select 1 from private.refund_graph_rollout where project_id=p_project and owner_id=p_owner)
 and base.snapshot->'project'<>'null'::jsonb then base.snapshot||jsonb_build_object('projection_version',3,
    'refund_cases',coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from cases r),'[]'::jsonb),
    'refund_versions',coalesce((select jsonb_agg(to_jsonb(v) order by v.id) from versions v),'[]'::jsonb),
    'refund_documents',coalesce((select jsonb_agg(to_jsonb(e) order by e.settlement_id,e.snapshot_id,e.document_id,e.role) from evidence e),'[]'::jsonb),
    'refund_payments',coalesce((select jsonb_agg(to_jsonb(p) order by p.settlement_id,p.id) from payments p),'[]'::jsonb),
    'refund_receipts',coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from receipts r),'[]'::jsonb))
 else base.snapshot end
from base;
$$;
revoke all on function private.graph_snapshot(uuid,uuid) from public,anon,authenticated;
commit;
