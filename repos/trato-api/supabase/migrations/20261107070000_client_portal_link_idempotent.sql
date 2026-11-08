begin;
-- The backend derives the portal token from a server secret and the revision, so the emailed link is the same in
-- the preview and in the real send. Issuing the same token again returns the existing active link.
create or replace function private.client_portal_link_issue(p_proposal uuid, p_expected_revision uuid, p_token_hash text, p_days integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid(); p public.change_proposals; link public.client_portal_links;
begin
 if u is null then raise sqlstate 'PT401' using message = 'UNAUTHORIZED'; end if;
 if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' or p_days is null or p_days not between 1 and 60 then
  raise sqlstate 'PT422' using message = 'INVALID_PORTAL_LINK'; end if;
 select * into p from public.change_proposals where id = p_proposal and owner_id = u;
 if not found then raise sqlstate 'PT404' using message = 'PROPOSAL_NOT_FOUND'; end if;
 perform private.ensure_active_project(p.project_id, u);
 perform 1 from public.projects where id = p.project_id and owner_id = u for update;
 select * into p from public.change_proposals where id = p.id for update;
 if p.current_revision_id is distinct from p_expected_revision then raise sqlstate 'PT409' using message = 'PROPOSAL_REVISION_CONFLICT'; end if;
 if p.locked_at is not null then raise sqlstate 'PT409' using message = 'CHANGE_READ_ONLY'; end if;
 if p.status <> 'ready_for_review' then raise sqlstate 'PT409' using message = 'PROPOSAL_REVIEW_REQUIRED'; end if;
 select * into link from public.client_portal_links where token_hash = p_token_hash;
 if found then
  if link.owner_id <> u or link.revision_id <> p.current_revision_id or link.revoked_at is not null or link.expires_at <= now() then
   raise sqlstate 'PT409' using message = 'PORTAL_LINK_UNAVAILABLE'; end if;
  return jsonb_build_object('link_id', link.id, 'revision_id', link.revision_id, 'expires_at', link.expires_at);
 end if;
 update public.client_portal_links set revoked_at = now() where proposal_id = p.id and revoked_at is null;
 insert into public.client_portal_links(owner_id, project_id, proposal_id, revision_id, token_hash, expires_at)
  values (u, p.project_id, p.id, p.current_revision_id, p_token_hash, now() + make_interval(days => p_days)) returning * into link;
 return jsonb_build_object('link_id', link.id, 'revision_id', link.revision_id, 'expires_at', link.expires_at);
end $$;
revoke all on function private.client_portal_link_issue(uuid, uuid, text, integer) from public, anon, authenticated;
grant execute on function private.client_portal_link_issue(uuid, uuid, text, integer) to authenticated, service_role;
commit;
