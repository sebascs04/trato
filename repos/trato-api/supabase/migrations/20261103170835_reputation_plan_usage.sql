begin;
-- Private evidence of confirmed, backend-verified plan usage. Never a claim of satisfaction.
create table private.reputation_plan_usage(
 project_id uuid not null, owner_id uuid not null, profile_id uuid not null references private.reputation_clients(id),
 source_job_id uuid not null, created_at timestamptz not null default now(),
 primary key(project_id,profile_id),
 foreign key(project_id,owner_id) references public.project_start_plans(project_id,owner_id)
);
create index reputation_plan_usage_profile_owner on private.reputation_plan_usage(profile_id,owner_id);
alter table private.reputation_plan_usage enable row level security;
revoke all on private.reputation_plan_usage from public,anon,authenticated;
create table private.reputation_usefulness(
 profile_id uuid not null references private.reputation_clients(id), owner_id uuid not null references auth.users(id),
 helpful boolean not null, updated_at timestamptz not null default now(), primary key(profile_id,owner_id)
);
alter table private.reputation_usefulness enable row level security;
revoke all on private.reputation_usefulness from public,anon,authenticated;

create function private.record_reputation_plan_usage(p_owner uuid,p_project uuid,p_job uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare plan public.project_start_plans; profile uuid; expected int; actual int;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then raise sqlstate '42501' using message='UNAUTHORIZED';end if;
 select s.* into plan from public.project_start_plans s join public.projects p on p.id=s.project_id and p.owner_id=s.owner_id
 join public.clients c on c.id=p.client_id and c.owner_id=p.owner_id
 where s.project_id=p_project and s.owner_id=p_owner and s.source_job_id=p_job and p.deleted_at is null and c.deleted_at is null for update of s;
 if not found then raise sqlstate 'PT404' using message='AI_PLAN_NOT_FOUND';end if;
 if exists(select 1 from private.reputation_plan_usage where project_id=p_project and owner_id=p_owner and source_job_id=p_job) then return jsonb_build_object('recorded',true);end if;
 expected:=jsonb_array_length(plan.background_snapshot);
 if expected=0 then return jsonb_build_object('recorded',false);end if;
 select rc.id into profile from public.projects p join public.clients c on c.id=p.client_id and c.owner_id=p.owner_id
 join private.reputation_clients rc on rc.public_email=lower(btrim(c.contact_email)) where p.id=p_project;
 if profile is null then raise sqlstate 'PT409' using message='AI_PLAN_SOURCES_CHANGED';end if;
 select count(distinct r.id) into actual from jsonb_array_elements(plan.background_snapshot) item
 join private.reputation_reviews r on r.id=(item->>'id')::uuid and r.version=(item->>'version')::int
 and r.body=item->>'body' and r.status='published' and r.profile_id=profile;
 if actual<>expected then raise sqlstate 'PT409' using message='AI_PLAN_SOURCES_CHANGED';end if;
 insert into private.reputation_plan_usage(project_id,owner_id,profile_id,source_job_id) values(p_project,p_owner,profile,p_job)
 on conflict(project_id,profile_id) do nothing;
 return jsonb_build_object('recorded',true);
end $$;
revoke all on function private.record_reputation_plan_usage(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function private.record_reputation_plan_usage(uuid,uuid,uuid) to service_role;
create function public.record_reputation_plan_usage(p_owner uuid,p_project uuid,p_job uuid) returns jsonb
language sql security invoker set search_path='' as $$ select private.record_reputation_plan_usage(p_owner,p_project,p_job) $$;
revoke all on function public.record_reputation_plan_usage(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.record_reputation_plan_usage(uuid,uuid,uuid) to service_role;

create function private.reputation_usage(p_profile_id uuid,p_helpful boolean default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); used bigint; helpful_count bigint; mine boolean;
begin
 if u is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) or not exists(select 1 from auth.users where id=u and deleted_at is null) then
 raise sqlstate '42501' using message='UNAUTHORIZED';end if;
 if not exists(select 1 from private.reputation_clients c where c.id=p_profile_id and c.public_email is not null
 and exists(select 1 from private.reputation_reviews r where r.profile_id=c.id and r.status='published')) then
 raise sqlstate 'PT404' using message='REPUTATION_NOT_FOUND';end if;
 if p_helpful is not null then
 insert into private.reputation_usefulness(profile_id,owner_id,helpful) values(p_profile_id,u,p_helpful)
 on conflict(profile_id,owner_id) do update set helpful=excluded.helpful,updated_at=now();end if;
 select count(distinct owner_id) into used from private.reputation_plan_usage where profile_id=p_profile_id;
 select count(*) into helpful_count from private.reputation_usefulness f join auth.users a on a.id=f.owner_id and a.deleted_at is null where f.profile_id=p_profile_id and f.helpful;
 select f.helpful into mine from private.reputation_usefulness f where f.profile_id=p_profile_id and f.owner_id=u;
 return jsonb_build_object('profile_id',p_profile_id,'confirmed_plan_freelancers',used,'self_reported_helpful',helpful_count,'my_helpful',mine);
end $$;
revoke all on function private.reputation_usage(uuid,boolean) from public,anon;
grant execute on function private.reputation_usage(uuid,boolean) to authenticated;
create function public.reputation_usage(p_profile_id uuid,p_helpful boolean default null) returns jsonb
language sql security invoker set search_path='' as $$ select private.reputation_usage(p_profile_id,p_helpful) $$;
revoke all on function public.reputation_usage(uuid,boolean) from public,anon;
grant execute on function public.reputation_usage(uuid,boolean) to authenticated;
commit;
