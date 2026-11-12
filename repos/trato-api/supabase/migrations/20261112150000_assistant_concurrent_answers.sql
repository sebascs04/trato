-- Two questions to TeTrato at the same time in one project (two tabs, for example) both reach an answer, but the
-- second one to finish found the memory already advanced and failed with AI_MEMORY_CONFLICT, discarding a ready
-- answer. Now an answer prepared while another was being saved is stored right after it (the memory row is locked
-- during the save, so positions never repeat); the conversation summary stays as the newer one. A revision from the
-- future is still refused.
do $migration$
declare definition text;
begin
 definition:=pg_get_functiondef('public.project_assistant_memory_backend(uuid,uuid,text,jsonb)'::regprocedure);
 if position('if m.revision<>(p_data->>''revision'')::bigint or not(p_data ? ''revision'') then raise exception ''AI_MEMORY_CONFLICT'';end if;' in definition)=0 then
  raise exception 'project_assistant_memory_backend no longer has the expected revision check';
 end if;
 execute replace(definition,
  'if m.revision<>(p_data->>''revision'')::bigint or not(p_data ? ''revision'') then raise exception ''AI_MEMORY_CONFLICT'';end if;',
  'if not(p_data ? ''revision'') or (p_data->>''revision'')::bigint>m.revision then raise exception ''AI_MEMORY_CONFLICT'';end if;
  if (p_data->>''revision'')::bigint<m.revision then
   insert into public.project_assistant_turns(job_id,project_id,owner_id,position,question,answer) values((p_data->>''job_id'')::uuid,p_project,p_owner,m.revision+1,p_data->>''question'',p_data->''answer'');
   update public.project_assistant_memory set revision=revision+1,updated_at=now() where project_id=p_project;
   return jsonb_build_object(''stored'',true,''revision'',m.revision+1);
  end if;');
end
$migration$;
