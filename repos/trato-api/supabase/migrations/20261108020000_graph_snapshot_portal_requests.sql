begin;
-- Client portal change requests join the graph: which version the client asked to change and which version answered it.
-- Only ids and dates: the client's text stays in Postgres, like document contents.
do $patch$
declare def text := pg_get_functiondef('private.graph_snapshot(uuid,uuid)'::regprocedure); before text;
begin
 before := def;
 def := replace(def, 'feedback_document_id,base_acceptance_id', 'feedback_document_id,feedback_portal_request_id,base_acceptance_id');
 def := replace(def, '''proposal_acceptances'',coalesce(',
  '''client_portal_change_requests'',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from (select id,revision_id,created_at,used_at from public.client_portal_change_requests where project_id=p_project and owner_id=p_owner and exists(select 1 from graph_project)) x),''[]''::jsonb),
''proposal_acceptances'',coalesce(');
 if def = before or position('feedback_portal_request_id' in def) = 0 or position('''client_portal_change_requests''' in def) = 0 then
  raise exception 'GRAPH_SNAPSHOT_PATCH_FAILED'; end if;
 execute def;
end $patch$;
commit;
