begin;
do $$
declare p public.projects; fixture uuid:=gen_random_uuid(); j uuid:=gen_random_uuid(); c jsonb; v jsonb; a jsonb;
begin
 select p0.* into p from public.projects p0 join public.clients c0 on c0.id=p0.client_id and c0.owner_id=p0.owner_id where p0.deleted_at is null and c0.deleted_at is null limit 1;
 if p.id is null then raise exception 'NO_TEST_OWNER';end if;
 insert into public.projects(id,owner_id,client_id,name,status) values(fixture,p.owner_id,p.client_id,'Memory contract rollback test','draft');
 c:=public.project_assistant_memory_backend(p.owner_id,fixture,'context');
 if c->>'revision'<>'0' then raise exception 'INVALID_INITIAL_CONTEXT';end if;
 a:=jsonb_build_object('question','Remember my preference','answer',jsonb_build_object('answer','Preference recorded','question','Remember my preference'),'job_id',j,'revision',0,'summary','','summarized_through',0);
 perform public.project_assistant_memory_backend(p.owner_id,fixture,'commit',a);
 perform public.project_assistant_memory_backend(p.owner_id,fixture,'commit',a);
 c:=public.project_assistant_memory_backend(p.owner_id,fixture,'context');
 if c->>'revision'<>'1' or jsonb_array_length(c->'messages')<>1 then raise exception 'DUPLICATED_MEMORY_TURN';end if;
 begin
  perform public.project_assistant_memory_backend(gen_random_uuid(),fixture,'history');raise exception 'CROSS_OWNER_ALLOWED';
 exception when raise_exception then if sqlerrm<>'PROJECT_NOT_FOUND' then raise;end if;end;
 begin
  perform public.project_assistant_memory_backend(p.owner_id,fixture,'commit',a||jsonb_build_object('job_id',gen_random_uuid()));raise exception 'STALE_COMMIT_ALLOWED';
 exception when raise_exception then if sqlerrm<>'AI_MEMORY_CONFLICT' then raise;end if;end;
 v:=public.project_assistant_memory_backend(p.owner_id,fixture,'search',jsonb_build_object('query','preference','revision',1));
 if jsonb_array_length(v->'messages')<>1 then raise exception 'SEARCH_FAILED';end if;
 perform public.project_assistant_memory_backend(p.owner_id,fixture,'commit',a||jsonb_build_object('job_id',gen_random_uuid(),'revision',1,'summary','User preference, message 1','summarized_through',1));
 c:=public.project_assistant_memory_backend(p.owner_id,fixture,'context');
 if c->>'summarized_through'<>'1' or jsonb_array_length(c->'messages')<>1 then raise exception 'COMPACTION_BOUNDARY_FAILED';end if;
 c:=public.project_assistant_memory_backend(p.owner_id,fixture,'history');
 if jsonb_array_length(c->'entries')<>2 then raise exception 'ORIGINAL_MESSAGES_LOST';end if;
 perform public.project_assistant_memory_backend(p.owner_id,fixture,'checkpoint_writes',jsonb_build_object('job_id',j,'checkpoint_id','ordered-test','writes',jsonb_build_object('task:0',jsonb_build_object('value','pending'))));
 c:=public.project_assistant_memory_backend(p.owner_id,fixture,'checkpoint_get',jsonb_build_object('job_id',j));
 if c is not null then raise exception 'PLACEHOLDER_EXPOSED';end if;
 perform public.project_assistant_memory_backend(p.owner_id,fixture,'checkpoint_put',jsonb_build_object('job_id',j,'checkpoint_id','ordered-test','payload',jsonb_build_object('checkpoint','encoded')));
 c:=public.project_assistant_memory_backend(p.owner_id,fixture,'checkpoint_get',jsonb_build_object('job_id',j));
 if c->'writes'->'task:0'->>'value'<>'pending' or c->'payload'->>'checkpoint'<>'encoded' then raise exception 'PENDING_WRITES_LOST';end if;
 if has_function_privilege('authenticated','public.project_assistant_memory_backend(uuid,uuid,text,jsonb)','execute') or has_table_privilege('anon','public.project_assistant_turns','select') then raise exception 'PUBLIC_ACCESS';end if;
end $$;
select 'memory ownership, idempotency, revision conflict, archive search, compaction and privileges passed' as result;
rollback;
