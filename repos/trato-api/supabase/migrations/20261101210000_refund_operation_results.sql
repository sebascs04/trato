begin;
create or replace function private.refund_command_result(p_project_id uuid,p_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();saved jsonb;m public.refund_deliveries;a public.refund_artifacts;
begin
 if actor is null or not exists(select 1 from auth.users where id=actor and deleted_at is null and not coalesce(is_anonymous,false)) then raise sqlstate 'PT401' using message='UNAUTHORIZED';end if;
 if p_key is null or p_key !~ '^[!-~]{1,128}$' then raise sqlstate 'PT422' using message='INVALID_IDEMPOTENCY_KEY';end if;
 perform private.ensure_active_project(p_project_id,actor);
 select result into saved from private.refund_commands where owner_id=actor and idempotency_key=p_key;
 if saved is not null and saved->'settlement'->>'project_id'=p_project_id::text then
  if saved ? 'artifact' then
   select * into a from public.refund_artifacts where id=(saved->'artifact'->>'id')::uuid and owner_id=actor and project_id=p_project_id;
   if a.document_id is null then return jsonb_build_object('state','unconfirmed');end if;
   saved:=saved||jsonb_build_object('artifact',to_jsonb(a));
  end if;
  return jsonb_build_object('state','confirmed','result',saved);
 elsif saved is not null and saved->>'project_id'=p_project_id::text and saved ? 'payment' then
  return jsonb_build_object('state','confirmed','result',saved);
 end if;
 select * into m from public.refund_deliveries where owner_id=actor and project_id=p_project_id and operation_key=p_key;
 if found and m.status in('accepted_by_gmail','failed') then
  select jsonb_build_object('settlement',to_jsonb(r),'delivery',to_jsonb(m)) into saved from public.refund_settlements r where r.id=m.settlement_id and r.owner_id=actor;
  return jsonb_build_object('state','confirmed','result',saved);
 end if;
 return jsonb_build_object('state','unconfirmed');
end $$;
commit;
