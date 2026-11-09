begin;
-- A project's PayPal disputes join the graph as one node each: id, state and the payment they contest.
-- Messages and documents stay in the project history and Documents, so the map keeps only what matters.
-- 20261108101000 renames the original snapshot to graph_snapshot_before_refunds and wraps it. The list of portal
-- requests lives in the original, so that is the one patched, whichever order the two were applied in.
do $patch$
declare target regprocedure := coalesce(to_regprocedure('private.graph_snapshot_before_refunds(uuid,uuid)'), 'private.graph_snapshot(uuid,uuid)'::regprocedure);
 def text := pg_get_functiondef(target); before text;
begin
 if position('''project_disputes''' in def) > 0 then return; end if;
 before := def;
 def := replace(def, '''client_portal_change_requests'',coalesce(',
  '''project_disputes'',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from (select o.id,o.dispute_id as title,o.happened_at as created_at,o.details->>''proposal_payment_id'' as proposal_payment_id,o.details->>''received_payment_id'' as received_payment_id,case when s.details->>''status''=''RESOLVED'' then ''resolved'' when s.details->>''escalated''=''true'' or coalesce(s.details->>''stage'',''INQUIRY'')<>''INQUIRY'' then ''escalated'' else ''open'' end as status,s.details->>''outcome'' as outcome from public.project_dispute_events o left join lateral (select e.details from public.project_dispute_events e where e.project_id=o.project_id and e.dispute_id=o.dispute_id and e.kind=''dispute_status'' order by e.happened_at desc limit 1) s on true where o.project_id=p_project and o.owner_id=p_owner and o.kind=''dispute_opened'' and exists(select 1 from graph_project)) x),''[]''::jsonb),
''client_portal_change_requests'',coalesce(');
 if def = before or position('''project_disputes''' in def) = 0 then
  raise exception 'GRAPH_SNAPSHOT_PATCH_FAILED'; end if;
 execute def;
end $patch$;
commit;
