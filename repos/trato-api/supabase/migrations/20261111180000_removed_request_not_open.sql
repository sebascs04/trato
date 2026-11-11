-- A request document removed from the project (deleted_at) is no longer an open request: it stops blocking
-- refunds and new requests. Same function as before plus that one condition; nothing else changes.
create or replace function private.project_change_request_status(p_project_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare u uuid:=auth.uid(); active jsonb; closures jsonb;
begin
 if u is null then raise sqlstate 'PT401' using message='UNAUTHORIZED';end if;
 perform private.ensure_active_project(p_project_id,u);
 select jsonb_build_object('id',d.id,'title',d.title) into active
 from public.documents d left join public.change_proposals p on p.request_document_id=d.id and p.owner_id=u
 where d.project_id=p_project_id and d.owner_id=u and d.kind='email_request' and d.deleted_at is null and p.locked_at is null
 and not exists(select 1 from public.request_closures c where c.request_document_id=d.id)
 order by d.created_at,d.id limit 1;
 select coalesce(jsonb_agg(to_jsonb(c) order by c.closed_at),'[]'::jsonb) into closures from public.request_closures c where c.project_id=p_project_id and c.owner_id=u;
 return jsonb_build_object('can_register',active is null,'active_request',active,'closures',closures);
end $function$;
