begin;
-- Synthetic project/jobs only; this test never executes a Neo4j write or publishes an outbox message.
do $$
declare u uuid;cl uuid:=gen_random_uuid();pr uuid:=gen_random_uuid();old_thread uuid:=gen_random_uuid();
 snap jsonb;old_snap jsonb;old_hash text;new_hash text;old_generation bigint;result jsonb;again jsonb;
begin
 select owner_id into u from public.projects order by created_at limit 1;
 if u is null then raise exception 'A fixture owner is required';end if;
 perform set_config('request.jwt.claim.sub',u::text,true);
 insert into public.clients(id,owner_id,name) values(cl,u,'Graph projection version fixture');
 insert into public.projects(id,owner_id,client_id,name) values(pr,u,cl,'Graph projection version fixture');
 snap:=private.graph_snapshot(pr,u);
 if snap->>'schema_version'<>'1' or snap->>'projection_version'<>'2' then raise exception 'Invalid graph contract versions';end if;
 old_snap:=snap-'projection_version';
 old_hash:=encode(sha256(convert_to(old_snap::text,'UTF8')),'hex');
 new_hash:=encode(sha256(convert_to(snap::text,'UTF8')),'hex');
 if old_hash=new_hash then raise exception 'Version must change only the projection fingerprint';end if;
 insert into public.worker_threads(id,owner_id,project_id,workflow,subject_id,status,phase)
 values(old_thread,u,pr,'sync_project_graph',pr,'ready','graph_ready');
 insert into private.graph_jobs(thread_id,project_id,owner_id,content_hash,snapshot)
 values(old_thread,pr,u,old_hash,old_snap) returning generation into old_generation;
 result:=public.project_graph(pr,'state');
 if result->>'status'<>'stale' or result->>'current'<>'false' then raise exception 'Old ready projector incorrectly reused';end if;
 result:=public.project_graph(pr,'sync');
 if result->>'status'<>'queued' or result->>'content_hash'<>new_hash or (result->>'generation')::bigint<=old_generation then raise exception 'New projector did not get canonical generation';end if;
 again:=public.project_graph(pr,'sync');
 if again<>result then raise exception 'New projection sync is not idempotent';end if;
 if not exists(select 1 from public.thread_outbox where thread_id=(result->>'thread_id')::uuid and envelope->'payload'->>'content_hash'=new_hash) then raise exception 'Missing canonical outbox';end if;
 if not exists(select 1 from private.graph_jobs where thread_id=old_thread and content_hash=old_hash and snapshot=old_snap) then raise exception 'Old snapshot was mutated';end if;
 if (select status from public.worker_threads where id=old_thread)<>'ready' then raise exception 'Old event was altered';end if;
 if (select status from public.projects where id=pr)<>'draft' then raise exception 'Business project state changed';end if;
 if has_function_privilege('authenticated','private.graph_snapshot(uuid,uuid)','execute') or has_function_privilege('anon','private.graph_snapshot(uuid,uuid)','execute') then raise exception 'Snapshot callable publicly';end if;
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 begin perform public.project_graph(pr,'sync');raise exception 'Foreign caller can sync project';exception when sqlstate 'PT404' then null;end;
end $$;
rollback;
