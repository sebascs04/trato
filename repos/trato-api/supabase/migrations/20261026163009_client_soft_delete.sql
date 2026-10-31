begin;
alter table public.clients add column deleted_at timestamptz;
create policy active_client on public.clients as restrictive for select to authenticated using(deleted_at is null);
create policy active_client_projects on public.projects as restrictive for all to authenticated
 using(exists(select 1 from public.clients c where c.id=projects.client_id and c.owner_id=projects.owner_id and c.deleted_at is null))
 with check(exists(select 1 from public.clients c where c.id=projects.client_id and c.owner_id=projects.owner_id and c.deleted_at is null));
do $$ declare t text; begin
 foreach t in array array['documents','document_extractions','document_segments','project_events','project_agreement_heads','change_proposals','proposal_revisions','proposal_revision_items','proposal_revision_sources','proposal_reviews','proposal_acceptances','proposal_events','proposal_artifacts','proposal_deliveries','proposal_payments'] loop
 execute format('create policy active_client_project on public.%I as restrictive for all to authenticated using(exists(select 1 from public.projects p where p.id=%I.project_id and p.owner_id=%I.owner_id)) with check(exists(select 1 from public.projects p where p.id=%I.project_id and p.owner_id=%I.owner_id))',t,t,t,t,t);
 end loop;
end $$;
create function private.ensure_active_project(p_project uuid,p_owner uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.projects p join public.clients c on c.id=p.client_id and c.owner_id=p.owner_id where p.id=p_project and p.owner_id=p_owner and c.deleted_at is null) then raise sqlstate 'PT404' using message='PROJECT_NOT_FOUND'; end if;
end $$;
revoke all on function private.ensure_active_project(uuid,uuid) from public,anon,authenticated;
create function private.soft_delete_client(p_client_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); item public.clients;
begin
 if u is null then raise sqlstate 'PT401' using message='UNAUTHORIZED'; end if;
 select * into item from public.clients where id=p_client_id and owner_id=u for update;
 if not found then raise sqlstate 'PT404' using message='CLIENT_NOT_FOUND'; end if;
 if item.deleted_at is null then
  update public.clients set deleted_at=now() where id=item.id returning * into item;
 end if;
 return jsonb_build_object('id',item.id,'deleted_at',item.deleted_at);
end $$;
revoke all on function private.soft_delete_client(uuid) from public,anon;
grant execute on function private.soft_delete_client(uuid) to authenticated;
create function public.soft_delete_client(p_client_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.soft_delete_client(p_client_id)$$;
revoke all on function public.soft_delete_client(uuid) from public,anon;
grant execute on function public.soft_delete_client(uuid) to authenticated;
-- Definer commands must also enforce the archived-parent boundary. RLS alone
-- cannot protect these owner-authorized, transactional write functions.
do $$ declare definition text; signature regprocedure; begin
 signature:='private.reserve_document(uuid,text,text,text,text,integer,text,text)'::regprocedure;
 definition:=pg_get_functiondef(signature);
 definition:=replace(definition,' h:=encode(sha256(', ' perform private.ensure_active_project(p_project_id,u);'||chr(10)||' h:=encode(sha256(');
 execute definition;
 foreach signature in array array['private.complete_document_ingestion(uuid,jsonb)'::regprocedure,'private.fail_document_ingestion(uuid,text)'::regprocedure] loop
 definition:=pg_get_functiondef(signature);
 definition:=replace(definition,$needle$ if not found then raise sqlstate 'PT404' using message='DOCUMENT_NOT_FOUND'; end if;$needle$, $needle$ if not found then raise sqlstate 'PT404' using message='DOCUMENT_NOT_FOUND'; end if;$needle$||chr(10)||' perform private.ensure_active_project(d.project_id,u);');
 execute definition;
 end loop;
 definition:=pg_get_functiondef('private.proposal_command(text,jsonb,text)'::regprocedure);
 definition:=replace(definition,$needle$ if not exists(select 1 from public.projects where id=project and owner_id=u)$needle$, ' perform private.ensure_active_project(project,u);'||chr(10)||$needle$ if not exists(select 1 from public.projects where id=project and owner_id=u)$needle$);
 execute definition;
 definition:=pg_get_functiondef('private.proposal_backend(uuid,text,jsonb)'::regprocedure);
 definition:=replace(definition,' select * into r from public.proposal_revisions where id=p.current_revision_id;', ' if p_action in(''mail_reserve'',''payment_prepare'') then perform private.ensure_active_project(p.project_id,p_owner); end if;'||chr(10)||' select * into r from public.proposal_revisions where id=p.current_revision_id;');
 execute definition;
end $$;
commit;
