begin;
create table public.project_assistant_memory (
 project_id uuid primary key, owner_id uuid not null,
 revision bigint not null default 0, summary text not null default '', summarized_through bigint not null default 0,
 updated_at timestamptz not null default now(),
 foreign key(project_id,owner_id) references public.projects(id,owner_id),
 check(summarized_through between 0 and revision),check(octet_length(summary)<=60000)
);
create table public.project_assistant_turns (
 job_id uuid primary key,project_id uuid not null,owner_id uuid not null,position bigint not null,
 question text not null,answer jsonb not null,created_at timestamptz not null default now(),
 unique(project_id,position),foreign key(project_id,owner_id) references public.projects(id,owner_id),
 check(char_length(question) between 1 and 4000),check(octet_length(answer::text)<=500000)
);
create table public.project_assistant_checkpoints (
 project_id uuid not null,owner_id uuid not null,job_id uuid not null,checkpoint_id text not null,
 payload jsonb not null,writes jsonb not null default '{}',created_at timestamptz not null default now(),
 primary key(job_id,checkpoint_id),foreign key(project_id,owner_id) references public.projects(id,owner_id),
 check(octet_length(payload::text)<=2000000),check(octet_length(writes::text)<=2000000)
);
create index project_assistant_checkpoints_scope on public.project_assistant_checkpoints(project_id,owner_id);
alter table public.project_assistant_memory enable row level security;
alter table public.project_assistant_turns enable row level security;
alter table public.project_assistant_checkpoints enable row level security;
revoke all on public.project_assistant_memory,public.project_assistant_turns,public.project_assistant_checkpoints from public,anon,authenticated;
grant select,insert,update on public.project_assistant_memory,public.project_assistant_turns,public.project_assistant_checkpoints to service_role;
create function public.project_assistant_memory_backend(p_owner uuid,p_project uuid,p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare m public.project_assistant_memory; t public.project_assistant_turns; items jsonb; v bigint; checkpoint text;
begin
 if not exists(select 1 from public.projects p join public.clients c on c.id=p.client_id and c.owner_id=p.owner_id where p.id=p_project and p.owner_id=p_owner and p.deleted_at is null and c.deleted_at is null) then raise exception 'PROJECT_NOT_FOUND';end if;
 if jsonb_typeof(p_data)<>'object' then raise exception 'AI_INVALID_INPUT';end if;
 if p_action in ('context','commit') then
  insert into public.project_assistant_memory(project_id,owner_id) values(p_project,p_owner) on conflict do nothing;
  select * into m from public.project_assistant_memory where project_id=p_project and owner_id=p_owner for update;
 end if;
 if p_action='context' then
  select coalesce(jsonb_agg(jsonb_build_object('position',position,'question',question,'answer',answer->>'answer') order by position),'[]') into items from public.project_assistant_turns where project_id=p_project and owner_id=p_owner and position>m.summarized_through;
  if octet_length(items::text)>500000 then raise exception 'AI_MEMORY_CONTEXT_LIMIT';end if;
  return jsonb_build_object('revision',m.revision,'summary',m.summary,'summarized_through',m.summarized_through,'messages',items);
 elsif p_action='history' then
  v:=coalesce((p_data->>'before')::bigint,9223372036854775807);
  select coalesce(jsonb_agg(jsonb_build_object('id',job_id,'position',position,'result',answer,'created_at',created_at) order by position),'[]') into items from (select * from public.project_assistant_turns where project_id=p_project and owner_id=p_owner and position<v order by position desc limit 50)x;
  return jsonb_build_object('entries',items,'next_before',case when jsonb_array_length(items)=50 then (items->0->>'position')::bigint else null end);
 elsif p_action='turn' then
  select * into t from public.project_assistant_turns where job_id=(p_data->>'job_id')::uuid and owner_id=p_owner and project_id=p_project;
  return case when found then jsonb_build_object('id',t.job_id,'result',t.answer) else null end;
 elsif p_action='search' then
  if char_length(btrim(p_data->>'query')) not between 1 and 4096 then raise exception 'AI_TOOL_INVALID';end if;
  select coalesce(jsonb_agg(jsonb_build_object('position',position,'question',question,'answer',answer->>'answer','created_at',created_at) order by position),'[]') into items from (select * from public.project_assistant_turns where project_id=p_project and owner_id=p_owner and position<= (p_data->>'revision')::bigint and (position(lower(p_data->>'query') in lower(question))>0 or position(lower(p_data->>'query') in lower(answer->>'answer'))>0) order by position desc limit 8)x;
  return jsonb_build_object('messages',items);
 elsif p_action='commit' then
  select * into t from public.project_assistant_turns where job_id=(p_data->>'job_id')::uuid;
  if found then
   if t.owner_id<>p_owner or t.project_id<>p_project or t.question is distinct from p_data->>'question' or t.answer is distinct from p_data->'answer' then raise exception 'AI_MEMORY_CONFLICT';end if;
   return jsonb_build_object('stored',true,'revision',t.position);
  end if;
  if m.revision<>(p_data->>'revision')::bigint or not(p_data ? 'revision') then raise exception 'AI_MEMORY_CONFLICT';end if;
  v:=(p_data->>'summarized_through')::bigint;
  if v is null or v<m.summarized_through or v>m.revision or p_data->>'summary' is null then raise exception 'AI_MEMORY_INVALID';end if;
  insert into public.project_assistant_turns(job_id,project_id,owner_id,position,question,answer) values((p_data->>'job_id')::uuid,p_project,p_owner,m.revision+1,p_data->>'question',p_data->'answer');
  update public.project_assistant_memory set revision=revision+1,summary=p_data->>'summary',summarized_through=v,updated_at=now() where project_id=p_project;
  return jsonb_build_object('stored',true,'revision',m.revision+1);
 elsif p_action='checkpoint_get' then
  select jsonb_build_object('payload',payload,'writes',writes) into items from public.project_assistant_checkpoints where owner_id=p_owner and project_id=p_project and job_id=(p_data->>'job_id')::uuid and (p_data->>'checkpoint_id' is null or checkpoint_id=p_data->>'checkpoint_id') order by checkpoint_id desc limit 1;
  return items;
 elsif p_action='checkpoint_put' then
  checkpoint:=p_data->>'checkpoint_id';
  if checkpoint is null or char_length(checkpoint)>100 then raise exception 'AI_MEMORY_INVALID';end if;
  insert into public.project_assistant_checkpoints(project_id,owner_id,job_id,checkpoint_id,payload) values(p_project,p_owner,(p_data->>'job_id')::uuid,checkpoint,p_data->'payload') on conflict(job_id,checkpoint_id) do nothing;
  return jsonb_build_object('stored',true);
 elsif p_action='checkpoint_writes' then
  update public.project_assistant_checkpoints set writes=writes||(p_data->'writes') where owner_id=p_owner and project_id=p_project and job_id=(p_data->>'job_id')::uuid and checkpoint_id=p_data->>'checkpoint_id';
  if not found then raise exception 'AI_MEMORY_INVALID';end if;
  return jsonb_build_object('stored',true);
 end if;
 raise exception 'AI_TOOL_NOT_ALLOWED';
end $$;
revoke all on function public.project_assistant_memory_backend(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.project_assistant_memory_backend(uuid,uuid,text,jsonb) to service_role;
commit;
