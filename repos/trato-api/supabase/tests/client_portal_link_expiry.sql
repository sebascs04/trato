-- A link's expiry limits only unanswered addenda (migration 20261108201500).
-- Always aborts: the final RAISE reports results and rolls back. Uses the Café Aurora test project.
do $test$
declare
 paid public.client_portal_links; pending public.change_proposals; client_user uuid; pending_hash text := repeat('a', 64); out text := ''; v jsonb; n int; h text;
begin
 select l.* into paid from public.client_portal_links l join public.change_proposals p on p.id = l.proposal_id join public.proposal_acceptances a on a.revision_id = l.revision_id where p.project_id = '6c95845f-c944-4dfb-b04d-4d4255188e9e' limit 1;
 select p.* into pending from public.change_proposals p where p.project_id = '6c95845f-c944-4dfb-b04d-4d4255188e9e' and p.status = 'ready_for_review' limit 1;
 select u.id into client_user from auth.users u join public.account_roles ar on ar.user_id = u.id and ar.role = 'client' join public.clients c on lower(btrim(c.contact_email)) = lower(btrim(u.email)) join public.projects pj on pj.client_id = c.id where pj.id = paid.project_id and u.email_confirmed_at is not null limit 1;
 out := 'client_found=' || (client_user is not null);

 update public.client_portal_links set created_at = now() - interval '3 days', expires_at = now() - interval '1 day' where id = paid.id;
 v := private.client_portal_view(paid.token_hash);
 out := out || ' | accepted+expired view status=' || (v->>'status') || ' pay=' || coalesce(v->>'payment_status','null');
 out := out || ' | payment_context ok=' || (private.client_portal_payment_context(paid.token_hash) is not null);
 select count(*) into n from jsonb_array_elements(private.client_account_agreements(client_user)) e where e->>'proposal_id' = paid.proposal_id::text;
 out := out || ' | in_account=' || n;
 out := out || ' | link_hash_ok=' || (private.client_account_link_hash(client_user, paid.proposal_id) = paid.token_hash);

 update public.client_portal_links set revoked_at = now() where id = paid.id;
 begin perform private.client_portal_view(paid.token_hash); out := out || ' | revoked view=ALLOWED(BAD)'; exception when others then out := out || ' | revoked view blocked=' || sqlerrm; end;
 update public.client_portal_links set revoked_at = null where id = paid.id;

 insert into public.client_portal_links(owner_id, project_id, proposal_id, revision_id, token_hash, created_at, expires_at)
  values (pending.owner_id, pending.project_id, pending.id, pending.current_revision_id, pending_hash, now() - interval '3 days', now() - interval '1 day');
 begin perform private.client_portal_view(pending_hash); out := out || ' | pending+expired view=ALLOWED(BAD)'; exception when others then out := out || ' | pending+expired view blocked=' || sqlerrm; end;
 select count(*) into n from jsonb_array_elements(private.client_account_agreements(client_user)) e where e->>'proposal_id' = pending.id::text;
 out := out || ' | pending+expired in_account=' || n;
 begin h := private.client_account_link_hash(client_user, pending.id); out := out || ' | pending hash=ALLOWED(BAD)'; exception when others then out := out || ' | pending hash blocked=' || sqlerrm; end;
 update public.client_portal_links set expires_at = now() + interval '1 day' where token_hash = pending_hash;
 select count(*) into n from jsonb_array_elements(private.client_account_agreements(client_user)) e where e->>'proposal_id' = pending.id::text;
 out := out || ' | pending+valid in_account=' || n;
 raise exception 'EXPIRY_TEST: %', out;
end $test$;
