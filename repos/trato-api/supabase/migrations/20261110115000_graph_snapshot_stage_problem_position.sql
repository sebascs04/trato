begin;
-- A problem report on a paid plan deliverable (20261110100000) has no addendum version: the map hangs it from its stage,
-- so the snapshot carries stage_position too. Patches the list added by 20261110020000; idempotent, and it fails instead
-- of applying a partial change.
do $patch$
declare target regprocedure := coalesce(to_regprocedure('private.graph_snapshot_before_refunds(uuid,uuid)'), 'private.graph_snapshot(uuid,uuid)'::regprocedure);
 def text := pg_get_functiondef(target); before text;
 old text := 'select r.id,r.revision_id,r.request_document_id,r.reason,r.status,r.created_at,r.closed_at from public.client_problem_reports r';
begin
 if position('r.closed_at,r.stage_position from public.client_problem_reports' in def) > 0 then return; end if;
 before := def;
 def := replace(def, old, 'select r.id,r.revision_id,r.request_document_id,r.reason,r.status,r.created_at,r.closed_at,r.stage_position from public.client_problem_reports r');
 if def = before then raise exception 'GRAPH_SNAPSHOT_PATCH_FAILED'; end if;
 execute def;
end $patch$;
commit;
