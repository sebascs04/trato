begin;
insert into auth.users(id,email) values('a1000000-0000-4000-8000-000000000001','graph-test@example.invalid');
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
insert into public.clients(id,owner_id,name) values('a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','Graph SQL test');
insert into public.projects(id,owner_id,client_id,name) values('a3000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','Graph SQL test');
set local role authenticated;
do $$declare a jsonb;b jsonb;begin
 a:=public.project_graph('a3000000-0000-4000-8000-000000000001','sync');
 b:=public.project_graph('a3000000-0000-4000-8000-000000000001','sync');
 if a<>b or a->>'status'<>'queued' then raise exception 'Queue not idempotent: % / %',a,b;end if;
 begin perform public.project_graph('a3000000-0000-4000-8000-000000000099','sync');raise exception 'Unauthorized project accepted';exception when sqlstate 'PT404' then null;end;
 begin perform public.thread_backend('relay_claim','{}');raise exception 'Backend exposed';exception when insufficient_privilege then null;end;
end $$;
reset role;
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
do $$declare m jsonb;c jsonb;v jsonb;r jsonb;bad jsonb;begin
 select envelope into m from public.thread_outbox where envelope->>'workflow'='sync_project_graph' and envelope->'context'->>'project_id'='a3000000-0000-4000-8000-000000000001';
 bad:=jsonb_set(m,'{context,owner_id}','"a1000000-0000-4000-8000-000000000099"');
 begin perform public.thread_backend('claim',jsonb_build_object('message',bad));raise exception 'Forged claim accepted';exception when sqlstate 'PT409' then null;end;
 c:=public.thread_backend('claim',jsonb_build_object('message',m));
 begin perform public.thread_backend('claim',jsonb_build_object('message',m));raise exception 'Concurrent claim';exception when sqlstate 'PT409' then null;end;
 v:=public.thread_backend('graph_input',jsonb_build_object('message',m,'lease_id',c->'lease_id'));
 if v->'snapshot'->'project'->>'name'<>'Graph SQL test' then raise exception 'Wrong snapshot';end if;
 r:=jsonb_build_object('type','thread','schema_version',1,'mode','connected','workflow','sync_project_graph','thread_id',m->'thread_id','event_id',gen_random_uuid(),'causation_id',m->'event_id','context',m->'context','lease_id',c->'lease_id','action','completed','result',jsonb_build_object('generation',v->'generation','content_hash',v->'content_hash'));
 bad:=jsonb_set(r,'{lease_id}',to_jsonb(gen_random_uuid()));
 if public.thread_backend('result',jsonb_build_object('message',bad))->>'discarded'<>'true' then raise exception 'Stale lease accepted';end if;
 perform public.thread_backend('result',jsonb_build_object('message',r));
 if public.thread_backend('result',jsonb_build_object('message',r))->>'duplicate'<>'true' then raise exception 'Missing dedup';end if;
 bad:=jsonb_set(r,'{result,content_hash}',to_jsonb(repeat('0',64)));
 begin perform public.thread_backend('result',jsonb_build_object('message',bad));raise exception 'Changed event accepted';exception when sqlstate 'PT409' then null;end;
end $$;
reset role;
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
do $$begin
 if public.project_graph('a3000000-0000-4000-8000-000000000001','state')->>'status'<>'ready' then raise exception 'Not ready';end if;
end $$;
reset role;
update public.projects set name='Changed after projection' where id='a3000000-0000-4000-8000-000000000001';
set local role authenticated;
do $$begin
 if public.project_graph('a3000000-0000-4000-8000-000000000001','state')->>'status'<>'stale' then raise exception 'Stale not detected';end if;
end $$;
reset role;
update public.clients set deleted_at=now() where id='a2000000-0000-4000-8000-000000000001';
set local role authenticated;
do $$begin
 begin perform public.project_graph('a3000000-0000-4000-8000-000000000001','state');raise exception 'Archived project accessible';exception when sqlstate 'PT404' then null;end;
end $$;
reset role;
rollback;
