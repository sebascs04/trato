begin;
create or replace function public.create_planned_project(p_key uuid,p_client uuid,p_name text,p_plan jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare u uuid:=auth.uid(); p public.projects; previous public.project_start_plans; h text; stage jsonb; n int:=0; total int:=0; budget numeric; cents bigint; allocated bigint:=0; part bigint;
begin
 if u is null then raise sqlstate 'PT401' using message='UNAUTHORIZED';end if;
 if not exists(select 1 from public.clients c where c.id=p_client and c.owner_id=u and c.deleted_at is null) then raise sqlstate 'PT404' using message='CLIENT_NOT_FOUND';end if;
 if length(trim(p_name)) not between 1 and 200 or jsonb_typeof(p_plan->'stages')<>'array' or jsonb_array_length(p_plan->'stages') not between 1 and 8 then raise sqlstate 'PT422' using message='AI_INVALID_PLAN';end if;
 budget:=(p_plan->>'budget')::numeric;
 if budget<=0 or budget>100000000 or budget<>round(budget,2) then raise sqlstate 'PT422' using message='AI_INVALID_PLAN';end if;
 for stage in select value from jsonb_array_elements(p_plan->'stages') loop
  if (stage->>'percent')::int not between 1 and 100 then raise sqlstate 'PT422' using message='AI_INVALID_PLAN';end if;
  total:=total+(stage->>'percent')::int;
 end loop;
 if total<>100 then raise sqlstate 'PT422' using message='AI_INVALID_PLAN';end if;
 h:=encode(sha256(convert_to(jsonb_build_object('client',p_client,'name',p_name,'plan',p_plan)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended(p_key::text,0));
 select * into previous from public.project_start_plans where project_id=p_key and owner_id=u;
 if found then
  if previous.command_hash<>h then raise sqlstate 'PT409' using message='PROJECT_CREATION_CONFLICT';end if;
  select * into p from public.projects where id=p_key and owner_id=u;
  if not found then raise sqlstate 'PT404' using message='PROJECT_NOT_FOUND';end if;
  return to_jsonb(p);
 end if;
 insert into public.projects(id,client_id,name) values(p_key,p_client,p_name) returning * into p;
 insert into public.project_start_plans(project_id,brief,budget,target_date,summary,model,source_job_id,output_language,considerations,limitations,background_snapshot,command_hash,original_proposal)
 values(p.id,p_plan->>'brief',budget,(p_plan->>'target_date')::date,p_plan->>'summary',p_plan->>'model',(p_plan->>'source_job_id')::uuid,p_plan->>'output_language',p_plan->'observations',p_plan->'limitations',p_plan->'reviews',h,p_plan->'original_proposal');
 cents:=(budget*100)::bigint;
 for stage in select value from jsonb_array_elements(p_plan->'stages') loop
  n:=n+1;
  part:=case when n=jsonb_array_length(p_plan->'stages') then cents-allocated else trunc(cents*(stage->>'percent')::numeric/100)::bigint end;
  if part<1 then raise sqlstate 'PT422' using message='AI_INVALID_PLAN';end if;
  allocated:=allocated+part;
  insert into public.project_start_stages(project_id,position,title,deliverables,percent,payment_condition,amount)
  values(p.id,n,stage->>'title',stage->>'body',(stage->>'percent')::int,stage->>'when',part/100.0);
 end loop;
 return to_jsonb(p);
end $$;

notify pgrst,'reload schema';
commit;
