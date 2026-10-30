begin;
alter table public.projects add column deleted_at timestamptz;
create policy active_project on public.projects as restrictive for all to authenticated
 using(deleted_at is null) with check(deleted_at is null);

create or replace function private.ensure_active_project(p_project uuid,p_owner uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.projects p join public.clients c on c.id=p.client_id and c.owner_id=p.owner_id
  where p.id=p_project and p.owner_id=p_owner and p.deleted_at is null and c.deleted_at is null)
 then raise sqlstate 'PT404' using message='PROJECT_NOT_FOUND';end if;
end $$;
revoke all on function private.ensure_active_project(uuid,uuid) from public,anon,authenticated;

create function private.soft_delete_project(p_project_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); item public.projects;
begin
 if u is null or not exists(select 1 from auth.users where id=u and deleted_at is null and not coalesce(is_anonymous,false))
 then raise sqlstate 'PT401' using message='UNAUTHORIZED';end if;
 select p.* into item from public.projects p join public.clients c on c.id=p.client_id and c.owner_id=p.owner_id
 where p.id=p_project_id and p.owner_id=u and c.deleted_at is null for update of p;
 if not found then raise sqlstate 'PT404' using message='PROJECT_NOT_FOUND';end if;
 if item.deleted_at is null then update public.projects set deleted_at=now() where id=item.id returning * into item;end if;
 return jsonb_build_object('id',item.id,'deleted_at',item.deleted_at);
end $$;
revoke all on function private.soft_delete_project(uuid) from public,anon;
grant execute on function private.soft_delete_project(uuid) to authenticated;
create function public.soft_delete_project(p_project_id uuid)
returns jsonb language sql security invoker set search_path='' as $$select private.soft_delete_project(p_project_id)$$;
revoke all on function public.soft_delete_project(uuid) from public,anon;
grant execute on function public.soft_delete_project(uuid) to authenticated;
commit;
