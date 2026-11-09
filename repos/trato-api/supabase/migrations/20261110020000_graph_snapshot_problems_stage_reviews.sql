begin;
-- The map shows the client's problem reports (on the paid addendum version) and the client's decision on a stage delivery.
-- Patches the original snapshot (graph_snapshot_before_refunds when the refunds wrapper exists), as 20261108203000 did
-- for disputes: idempotent, and it fails instead of applying a partial change. Notes and emails stay out of the graph.
do $patch$
declare target regprocedure := coalesce(to_regprocedure('private.graph_snapshot_before_refunds(uuid,uuid)'), 'private.graph_snapshot(uuid,uuid)'::regprocedure);
 def text := pg_get_functiondef(target); before text;
begin
 if position('''client_problem_reports''' in def) > 0 then return; end if;
 before := def;
 def := replace(def, '''project_disputes'',coalesce(',
  '''client_problem_reports'',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from (select r.id,r.revision_id,r.request_document_id,r.reason,r.status,r.created_at,r.closed_at from public.client_problem_reports r where r.project_id=p_project and r.owner_id=p_owner and exists(select 1 from graph_project)) x),''[]''::jsonb),
''project_stage_reviews'',coalesce((select jsonb_agg(to_jsonb(x) order by x.document_id) from (select v.document_id,v.stage_position,v.decision,v.created_at from public.project_stage_reviews v where v.project_id=p_project and v.owner_id=p_owner and exists(select 1 from graph_project)) x),''[]''::jsonb),
''project_disputes'',coalesce(');
 if def = before or position('''client_problem_reports''' in def) = 0 or position('''project_stage_reviews''' in def) = 0 then
  raise exception 'GRAPH_SNAPSHOT_PATCH_FAILED'; end if;
 execute def;
end $patch$;
commit;
