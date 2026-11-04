begin;
create function private.refund_command_result(p_project_id uuid,p_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();saved jsonb;
begin
 if actor is null or not exists(select 1 from auth.users where id=actor and deleted_at is null and not coalesce(is_anonymous,false))
 then raise sqlstate 'PT401' using message='UNAUTHORIZED';end if;
 if p_key is null or p_key !~ '^[!-~]{1,128}$' then raise sqlstate 'PT422' using message='INVALID_IDEMPOTENCY_KEY';end if;
 perform private.ensure_active_project(p_project_id,actor);
 select result into saved from private.refund_commands where owner_id=actor and idempotency_key=p_key;
 if saved is null or saved->'settlement'->>'project_id' is distinct from p_project_id::text then
  return jsonb_build_object('state','unconfirmed');
 end if;
 return jsonb_build_object('state','confirmed','result',saved);
end $$;
create function public.refund_command_result(p_project_id uuid,p_key text) returns jsonb
language sql security invoker set search_path='' as $$select private.refund_command_result(p_project_id,p_key)$$;
revoke all on function private.refund_command_result(uuid,text),public.refund_command_result(uuid,text) from public,anon,authenticated;
grant execute on function private.refund_command_result(uuid,text),public.refund_command_result(uuid,text) to authenticated;
commit;
