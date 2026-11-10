begin;
-- The project group's count follows its list (persistence.activity): a client's problem report on a paid plan deliverable
-- (20261110100000, no addendum) adds its opening, each reply, its registration as a new request and its closing.
-- Patched into the current function instead of rewritten, so other sessions' changes to it are kept. Idempotent; it fails
-- instead of applying a partial change.
do $patch$
declare target regprocedure := 'private.project_activity_groups(uuid)'::regprocedure;
 def text := pg_get_functiondef(target); before text;
 anchor text := 'select ''project''::text group_kind,(p.id)::text group_id,(p.name)::text group_title,(x.paid_at)::timestamptz happened_at from public.project_initial_checkouts';
 src text := 'join p on x.project_id=p.id and x.owner_id=p.owner_id join public.project_start_plans z on z.project_id=p.id and z.owner_id=p.owner_id';
 head text := 'select ''project''::text group_kind,(p.id)::text group_id,(p.name)::text group_title,';
begin
 if position('stage problem reports' in def) > 0 then return; end if;
 before := def;
 def := replace(def, anchor,
  '-- stage problem reports: opened, closed, each reply, registered as a new request.' || chr(10) ||
  head || '(x.created_at)::timestamptz happened_at from public.client_problem_reports x ' || src || ' where x.stage_position is not null' || chr(10) || 'union all' || chr(10) ||
  head || '(x.closed_at)::timestamptz happened_at from public.client_problem_reports x ' || src || ' where x.stage_position is not null and x.closed_at is not null' || chr(10) || 'union all' || chr(10) ||
  head || '(m.created_at)::timestamptz happened_at from public.client_problem_messages m join public.client_problem_reports x on x.id=m.report_id and x.owner_id=m.owner_id ' || src || ' where x.stage_position is not null' || chr(10) || 'union all' || chr(10) ||
  head || '(nd.created_at)::timestamptz happened_at from public.client_problem_reports x ' || src || ' join public.documents nd on nd.id=x.request_document_id and nd.project_id=p.id and nd.owner_id=p.owner_id where x.stage_position is not null and nd.kind=''email_request'' and nd.deleted_at is null' || chr(10) || 'union all' || chr(10) ||
  anchor);
 if def = before or position('stage problem reports' in def) = 0 then raise exception 'ACTIVITY_GROUPS_PATCH_FAILED'; end if;
 execute def;
end $patch$;
commit;
