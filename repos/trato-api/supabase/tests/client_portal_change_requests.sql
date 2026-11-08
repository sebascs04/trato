-- Portal change requests (migration 20261107140000). Always aborts: the final RAISE reports results and rolls back.
do $t$
declare proposal uuid := '0b3454ad-9dd1-4bd3-9007-66d1e4424b55'; owner uuid; rev uuid; log text := ''; v jsonb;
 tok text := encode(sha256(convert_to('change-request-test','UTF8')),'hex'); req uuid;
begin
 select owner_id, current_revision_id into owner, rev from public.change_proposals where id = proposal;
 -- The test proposal's project is archived; restore it inside this always-rolled-back transaction.
 update public.projects set deleted_at = null where id = (select project_id from public.change_proposals where id = proposal);
 update public.clients set deleted_at = null where id = (select client_id from public.projects where id = (select project_id from public.change_proposals where id = proposal));
 perform set_config('request.jwt.claims', jsonb_build_object('sub', owner, 'role', 'authenticated')::text, true);
 perform public.client_portal_link_issue(proposal, rev, tok, 7);
 begin perform public.client_portal_request_changes(tok, '  '); log := log || 'empty=ALLOWED(BAD) '; exception when others then log := log || 'empty=' || sqlerrm || ' '; end;
 perform public.client_portal_request_changes(tok, 'Please add one more revision round.');
 perform public.client_portal_request_changes(tok, 'Please add two more revision rounds.');
 v := public.client_portal_view(tok);
 log := log || 'view_notes=' || (v->'change_request'->>'notes') || ' | ';
 select id into req from public.client_portal_change_requests where revision_id = rev;
 log := log || 'one_row=' || (select count(*) from public.client_portal_change_requests where revision_id = rev) || ' ';
 begin perform public.proposal_command('revise', jsonb_build_object('proposal_id', proposal, 'expected_revision_id', rev, 'feedback_portal_request_id', gen_random_uuid(), 'feedback_notes', 'x', 'terms', '{}'::jsonb, 'source_document_ids', '[]'::jsonb), 'portal-test-' || gen_random_uuid());
  log := log || 'wrong_request=ALLOWED(BAD) '; exception when others then log := log || 'wrong_request=' || sqlerrm || ' '; end;
 log := log || 'patched=' || (position('feedback_portal_request_id=portal_request.id' in pg_get_functiondef('private.proposal_command(text,jsonb,text)'::regprocedure)) > 0) || ' ';
 log := log || 'anon=' || has_function_privilege('anon','public.client_portal_request_changes(text,text)','execute');
 raise exception 'CHANGE_TEST %', log;
end $t$;
