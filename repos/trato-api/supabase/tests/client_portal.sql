-- Client portal acceptance checks (migration 20261107050000). Runs in one transaction and always aborts:
-- the final RAISE reports the results and rolls everything back. Set the proposal id before running.
do $t$
declare proposal uuid := '28890d92-92d8-4b17-8668-ea9d77120bd5'; owner uuid; rev uuid; sha text; out jsonb; acc jsonb; again jsonb; log text := '';
 tok text := encode(sha256(convert_to('portal-test-token','UTF8')),'hex');
begin
 select owner_id, current_revision_id into owner, rev from public.change_proposals where id = proposal;
 select addendum_sha256 into sha from public.proposal_reviews where revision_id = rev;
 perform set_config('request.jwt.claims', jsonb_build_object('sub', owner, 'role', 'authenticated')::text, true);

 out := public.client_portal_link_issue(proposal, rev, tok, 30);
 log := log || 'issue=ok ';
 out := public.client_portal_view(tok);
 log := log || 'view.status=' || (out->>'status') || ' view.sha_ok=' || ((out->>'addendum_sha256') = sha) || ' ';

 begin perform public.client_portal_accept(tok, rev, repeat('0',64)); log := log || 'wrong_sha=ACCEPTED(BAD) ';
 exception when others then log := log || 'wrong_sha=' || sqlerrm || ' '; end;
 begin perform public.client_portal_accept(tok, gen_random_uuid(), sha); log := log || 'wrong_rev=ACCEPTED(BAD) ';
 exception when others then log := log || 'wrong_rev=' || sqlerrm || ' '; end;
 begin perform public.client_portal_view(encode(sha256(convert_to('unknown','UTF8')),'hex')); log := log || 'unknown=FOUND(BAD) ';
 exception when others then log := log || 'unknown=' || sqlerrm || ' '; end;

 acc := public.client_portal_accept(tok, rev, sha);
 again := public.client_portal_accept(tok, rev, sha);
 log := log || 'idempotent=' || ((acc->>'acceptance_id') = (again->>'acceptance_id')) || ' ';
 log := log || 'proposal=' || (select status from public.change_proposals where id = proposal) || ' ';
 log := log || 'method=' || (select method from public.proposal_acceptances where id = (acc->>'acceptance_id')::uuid) || ' ';
 log := log || 'head=' || ((select acceptance_id from public.project_agreement_heads h join public.change_proposals p on p.project_id = h.project_id where p.id = proposal) = (acc->>'acceptance_id')::uuid) || ' ';
 log := log || 'event=' || (select actor_kind from public.proposal_events where revision_id = rev and event_type = 'acceptance_recorded') || ' ';
 log := log || 'view_after=' || (public.client_portal_view(tok)->>'status') || ' ';

 begin out := public.client_portal_link_issue(proposal, rev, encode(sha256(convert_to('second','UTF8')),'hex'), 30); log := log || 'reissue_after_accept=ALLOWED(BAD) ';
 exception when others then log := log || 'reissue_after_accept=' || sqlerrm || ' '; end;

 log := log || 'anon_exec=' || has_function_privilege('anon', 'public.client_portal_accept(text,uuid,text)', 'execute')
  || ' auth_exec=' || has_function_privilege('authenticated', 'public.client_portal_accept(text,uuid,text)', 'execute')
  || ' auth_view=' || has_function_privilege('authenticated', 'public.client_portal_view(text)', 'execute')
  || ' anon_links=' || has_table_privilege('anon', 'public.client_portal_links', 'select')
  || ' auth_token_col=' || has_column_privilege('authenticated', 'public.client_portal_links', 'token_hash', 'select');
 raise exception 'PORTAL_TEST %', log;
end $t$;
