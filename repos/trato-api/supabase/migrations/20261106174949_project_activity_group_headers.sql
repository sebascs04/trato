begin;
create function private.project_activity_groups(p_project_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare u uuid:=auth.uid();result jsonb;invalid boolean;
begin
 if u is null then raise sqlstate 'PT401' using message='UNAUTHORIZED';end if;
 if not exists(select 1 from public.projects p join public.clients c on c.id=p.client_id and c.owner_id=p.owner_id
  where p.id=p_project_id and p.owner_id=u and p.deleted_at is null and c.deleted_at is null)
 then raise sqlstate 'PT404' using message='PROJECT_NOT_FOUND';end if;
 with p as materialized (select id,owner_id,name,created_at from public.projects where id=p_project_id and owner_id=u),events as (
select 'project'::text group_kind,(p.id)::text group_id,(p.name)::text group_title,(p.created_at)::timestamptz happened_at from p where true
union all
select 'project'::text group_kind,(p.id)::text group_id,(p.name)::text group_title,(x.created_at)::timestamptz happened_at from public.documents x join p on x.project_id=p.id and x.owner_id=p.owner_id where x.kind='initial_agreement' and x.deleted_at is null
union all
select 'project'::text group_kind,(p.id)::text group_id,(p.name)::text group_title,(x.created_at)::timestamptz happened_at from public.project_start_plans x join p on x.project_id=p.id and x.owner_id=p.owner_id where true
union all
select 'project'::text group_kind,(p.id)::text group_id,(p.name)::text group_title,(d.created_at)::timestamptz happened_at from public.document_upload_contexts x join p on x.project_id=p.id and x.owner_id=p.owner_id join public.documents d on d.id=x.document_id and d.owner_id=p.owner_id and d.project_id=p.id join public.project_start_plans z on z.project_id=p.id and z.owner_id=p.owner_id where x.purpose='delivery_evidence' and x.stage_position is not null and d.kind='delivery' and d.deleted_at is null
union all
select 'project'::text group_kind,(p.id)::text group_id,(p.name)::text group_title,(x.paid_at)::timestamptz happened_at from public.project_initial_checkouts x join p on x.project_id=p.id and x.owner_id=p.owner_id join public.project_start_plans z on z.project_id=p.id and z.owner_id=p.owner_id where x.stage_position is not null and x.status='completed' and x.paid_at is not null
union all
select 'project'::text group_kind,(p.id)::text group_id,(p.name)::text group_title,(x.completed_at)::timestamptz happened_at from public.project_start_plans x join p on x.project_id=p.id and x.owner_id=p.owner_id where x.completed_at is not null
union all
select 'change'::text group_kind,(x.id)::text group_id,(x.title)::text group_title,(x.created_at)::timestamptz happened_at from public.documents x join p on x.project_id=p.id and x.owner_id=p.owner_id where x.kind='email_request' and x.deleted_at is null
union all
select 'change'::text group_kind,(d.id)::text group_id,(d.title)::text group_title,(x.updated_at)::timestamptz happened_at from public.proposal_deliveries x join p on x.project_id=p.id and x.owner_id=p.owner_id join public.change_proposals q on q.id=x.proposal_id and q.project_id=p.id and q.owner_id=p.owner_id join public.documents d on d.id=q.request_document_id and d.project_id=p.id and d.owner_id=p.owner_id where x.status='accepted_by_gmail' and d.deleted_at is null
union all
select 'change'::text group_kind,(d.id)::text group_id,(d.title)::text group_title,(x.created_at)::timestamptz happened_at from public.proposal_acceptances x join p on x.project_id=p.id and x.owner_id=p.owner_id join public.change_proposals q on q.id=x.proposal_id and q.project_id=p.id and q.owner_id=p.owner_id join public.documents d on d.id=q.request_document_id and d.project_id=p.id and d.owner_id=p.owner_id where true and d.deleted_at is null
union all
select 'change'::text group_kind,(d.id)::text group_id,(d.title)::text group_title,(x.updated_at)::timestamptz happened_at from public.proposal_payments x join p on x.project_id=p.id and x.owner_id=p.owner_id join public.change_proposals q on q.id=x.proposal_id and q.project_id=p.id and q.owner_id=p.owner_id join public.documents d on d.id=q.request_document_id and d.project_id=p.id and d.owner_id=p.owner_id where x.status='completed' and d.deleted_at is null
union all
select 'change'::text group_kind,(d.id)::text group_id,(d.title)::text group_title,(x.closed_at)::timestamptz happened_at from public.request_closures x join p on x.project_id=p.id and x.owner_id=p.owner_id join public.documents d on d.id=x.request_document_id and d.project_id=p.id and d.owner_id=p.owner_id where d.deleted_at is null
union all
select 'refund'::text group_kind,(x.id)::text group_id,(x.reason)::text group_title,(x.created_at)::timestamptz happened_at from public.refund_settlements x join p on x.project_id=p.id and x.owner_id=p.owner_id where true
union all
select 'refund'::text group_kind,(x.id)::text group_id,(x.reason)::text group_title,(x.closed_at)::timestamptz happened_at from public.refund_settlements x join p on x.project_id=p.id and x.owner_id=p.owner_id where x.status in ('completed','closed_without_refund','rejected','withdrawn')
union all
select 'refund'::text group_kind,(r.id)::text group_id,(r.reason)::text group_title,(x.updated_at)::timestamptz happened_at from public.refund_deliveries x join p on x.project_id=p.id and x.owner_id=p.owner_id join public.refund_settlements r on r.id=x.settlement_id and r.project_id=p.id and r.owner_id=p.owner_id where x.status='accepted_by_gmail'
union all
select 'refund'::text group_kind,(r.id)::text group_id,(r.reason)::text group_title,(x.created_at)::timestamptz happened_at from public.refund_feedback x join p on x.project_id=p.id and x.owner_id=p.owner_id join public.refund_settlements r on r.id=x.settlement_id and r.project_id=p.id and r.owner_id=p.owner_id where true
union all
select 'refund'::text group_kind,(r.id)::text group_id,(r.reason)::text group_title,(x.created_at)::timestamptz happened_at from public.refund_acceptances x join p on x.project_id=p.id and x.owner_id=p.owner_id join public.refund_settlements r on r.id=x.settlement_id and r.project_id=p.id and r.owner_id=p.owner_id where true
union all
select 'refund'::text group_kind,(r.id)::text group_id,(r.reason)::text group_title,(x.created_at)::timestamptz happened_at from public.refund_financial_authorizations x join p on x.project_id=p.id and x.owner_id=p.owner_id join public.refund_settlements r on r.id=x.settlement_id and r.project_id=p.id and r.owner_id=p.owner_id where true
union all
select 'refund'::text group_kind,(coalesce(r.id::text,'payment-'||x.payment_id::text))::text group_id,(r.reason)::text group_title,(x.confirmed_at)::timestamptz happened_at from public.refund_provider_receipts x join p on x.project_id=p.id and x.owner_id=p.owner_id left join public.refund_receipt_applications a on a.receipt_id=x.id and a.project_id=p.id and a.owner_id=p.owner_id left join public.refund_settlements r on r.id=a.settlement_id and r.project_id=p.id and r.owner_id=p.owner_id where x.status='completed'
 ),groups as (select group_kind,group_id,group_title,count(*) event_count,max(happened_at) last_at,bool_or(happened_at is null) invalid from events group by group_kind,group_id,group_title)
 select coalesce(bool_or(g.invalid),false),coalesce(jsonb_agg(jsonb_build_object('group_kind',g.group_kind,'group_id',g.group_id,'group_title',g.group_title,'event_count',g.event_count,'last_at',g.last_at) order by g.last_at desc,g.group_kind,g.group_id),'[]'::jsonb)
 into invalid,result from groups g;
 if invalid then raise sqlstate 'PT409' using message='ACTIVITY_TIMESTAMP_MISSING';end if;
 return result;
end $$;
revoke all on function private.project_activity_groups(uuid) from public,anon;
grant execute on function private.project_activity_groups(uuid) to authenticated;
create function public.project_activity_groups(p_project_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$select private.project_activity_groups(p_project_id);$$;
revoke all on function public.project_activity_groups(uuid) from public,anon;
grant execute on function public.project_activity_groups(uuid) to authenticated;
commit;
