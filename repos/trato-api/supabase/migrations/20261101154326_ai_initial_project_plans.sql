begin;
-- Idempotent final project creation uses an explicit UUID under the existing owner RLS.
grant insert(id) on public.projects to authenticated;
create table public.project_start_plans (
 project_id uuid primary key,
 owner_id uuid not null default auth.uid(),
 brief text not null check(length(trim(brief)) between 1 and 4000),
 budget numeric(12,2) not null check(budget>0 and budget<=100000000),
 currency text not null default 'USD' check(currency='USD'),
 target_date date not null,
 summary text not null,
 model text not null,
 source_job_id uuid not null,
 output_language text not null check(output_language in ('es','en')),
 considerations jsonb not null check(jsonb_typeof(considerations)='array'),
 limitations jsonb not null check(jsonb_typeof(limitations)='array'),
 background_snapshot jsonb not null check(jsonb_typeof(background_snapshot)='array'),
 command_hash text not null,
 created_at timestamptz not null default now(),
 unique(project_id,owner_id),
 foreign key(project_id,owner_id) references public.projects(id,owner_id)
);
create table public.project_start_stages (
 project_id uuid not null,
 owner_id uuid not null default auth.uid(),
 position integer not null check(position between 1 and 8),
 title text not null check(length(trim(title)) between 1 and 200),
 deliverables text not null check(length(trim(deliverables)) between 1 and 2000),
 percent integer not null check(percent between 1 and 100),
 payment_condition text not null check(length(trim(payment_condition)) between 1 and 500),
 amount numeric(12,2) not null check(amount>0),
 primary key(project_id,position),
 constraint project_start_stages_plan_fk foreign key(project_id,owner_id) references public.project_start_plans(project_id,owner_id)
);
create index project_start_plans_owner_idx on public.project_start_plans(owner_id);
create index project_start_stages_owner_idx on public.project_start_stages(owner_id);
alter table public.project_start_plans enable row level security;
alter table public.project_start_stages enable row level security;
revoke all on public.project_start_plans,public.project_start_stages from public,anon,authenticated;
grant select,insert on public.project_start_plans,public.project_start_stages to authenticated;
create policy own_plan_read on public.project_start_plans for select to authenticated using(owner_id=(select auth.uid()) and exists(select 1 from public.projects p where p.id=project_id and p.owner_id=auth.uid() and p.deleted_at is null));
create policy own_plan_insert on public.project_start_plans for insert to authenticated with check(owner_id=(select auth.uid()) and exists(select 1 from public.projects p where p.id=project_id and p.owner_id=auth.uid() and p.deleted_at is null));
create policy own_stage_read on public.project_start_stages for select to authenticated using(owner_id=(select auth.uid()) and exists(select 1 from public.project_start_plans p where p.project_id=project_start_stages.project_id and p.owner_id=auth.uid()));
create policy own_stage_insert on public.project_start_stages for insert to authenticated with check(owner_id=(select auth.uid()) and exists(select 1 from public.project_start_plans p where p.project_id=project_start_stages.project_id and p.owner_id=auth.uid()));
create function public.create_planned_project(p_key uuid,p_client uuid,p_name text,p_plan jsonb)
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
 insert into public.project_start_plans(project_id,brief,budget,target_date,summary,model,source_job_id,output_language,considerations,limitations,background_snapshot,command_hash)
 values(p.id,p_plan->>'brief',budget,(p_plan->>'target_date')::date,p_plan->>'summary',p_plan->>'model',(p_plan->>'source_job_id')::uuid,p_plan->>'output_language',p_plan->'observations',p_plan->'limitations',p_plan->'reviews',h);
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
revoke all on function public.create_planned_project(uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.create_planned_project(uuid,uuid,text,jsonb) to authenticated;
commit;
