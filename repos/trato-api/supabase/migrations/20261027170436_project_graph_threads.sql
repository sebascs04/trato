begin;
create function private.graph_snapshot(p_project uuid,p_owner uuid) returns jsonb language sql stable security invoker set search_path='' as $$
select jsonb_build_object('schema_version',1,'owner_id',p_owner,'project_id',p_project,
 'project',(select jsonb_build_object('id',p.id,'name',p.name,'status',p.status,'client_id',p.client_id,'client_name',c.name)
 from public.projects p join public.clients c on c.id=p.client_id and c.owner_id=p.owner_id
 where p.id=p_project and p.owner_id=p_owner and c.deleted_at is null),
'documents',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from (select id,title,kind,mime_type,sha256,created_at from public.documents where project_id=p_project and owner_id=p_owner) x),'[]'::jsonb),
'document_extractions',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from (select id,document_id,status,result_hash,created_at,completed_at from public.document_extractions where project_id=p_project and owner_id=p_owner) x),'[]'::jsonb),
'change_proposals',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from (select id,request_document_id,current_revision_id,status,locked_at,created_at from public.change_proposals where project_id=p_project and owner_id=p_owner) x),'[]'::jsonb),
'proposal_revisions',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from (select id,proposal_id,revision_no,draft_sequence,replaces_draft_id,feedback_document_id,base_acceptance_id,scope_summary,conditions,currency,additional_minor,deadline,created_at from public.proposal_revisions where project_id=p_project and owner_id=p_owner) x),'[]'::jsonb),
'proposal_revision_sources',coalesce((select jsonb_agg(to_jsonb(x) order by x.revision_id) from (select revision_id,document_id,extraction_id,document_sha256,extraction_result_hash from public.proposal_revision_sources where project_id=p_project and owner_id=p_owner) x),'[]'::jsonb),
'proposal_artifacts',coalesce((select jsonb_agg(to_jsonb(x) order by x.revision_id) from (select revision_id,document_id,sha256,created_at from public.proposal_artifacts where project_id=p_project and owner_id=p_owner) x),'[]'::jsonb),
'proposal_reviews',coalesce((select jsonb_agg(to_jsonb(x) order by x.revision_id) from (select revision_id,addendum_document_id,addendum_sha256,reviewed_at from public.proposal_reviews where project_id=p_project and owner_id=p_owner) x),'[]'::jsonb),
'proposal_acceptances',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from (select id,revision_id,returned_document_id,returned_sha256,method,cryptographic_signature_verified,created_at from public.proposal_acceptances where project_id=p_project and owner_id=p_owner) x),'[]'::jsonb),
'proposal_deliveries',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from (select id,revision_id,kind,status,created_at,updated_at from public.proposal_deliveries where project_id=p_project and owner_id=p_owner) x),'[]'::jsonb),
'proposal_payments',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from (select id,revision_id,acceptance_id,status,amount_minor,currency,created_at,updated_at from public.proposal_payments where project_id=p_project and owner_id=p_owner) x),'[]'::jsonb),
'project_agreement_heads',coalesce((select jsonb_agg(to_jsonb(x) order by x.generation) from (select acceptance_id,generation from public.project_agreement_heads where project_id=p_project and owner_id=p_owner) x),'[]'::jsonb));$$;
revoke all on function private.graph_snapshot(uuid,uuid) from public,anon,authenticated;

create table private.graph_jobs(
 thread_id uuid primary key references public.worker_threads(id),
 project_id uuid not null,owner_id uuid not null,
 generation bigint generated always as identity unique,
 content_hash text not null check(content_hash ~ '^[a-f0-9]{64}$'),snapshot jsonb not null,
 foreign key(project_id,owner_id) references public.projects(id,owner_id)
);
create index graph_jobs_project on private.graph_jobs(project_id,owner_id,generation desc);
alter table private.graph_jobs enable row level security;
revoke all on private.graph_jobs from public,anon,authenticated;

create function private.project_graph(p_project_id uuid,p_action text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();s jsonb;h text;g private.graph_jobs;j public.worker_threads;envelope jsonb;
begin
 if u is null then raise sqlstate 'PT401' using message='UNAUTHORIZED';end if;
 perform private.ensure_active_project(p_project_id,u);
 if p_action not in('sync','state') then raise sqlstate 'PT422' using message='INVALID_GRAPH_ACTION';end if;
 -- A project lock serializes generations without changing any business record.
 perform 1 from public.projects where id=p_project_id and owner_id=u for update;
 s:=private.graph_snapshot(p_project_id,u);
 if octet_length(s::text)>2000000 then raise sqlstate 'PT422' using message='GRAPH_PROJECT_TOO_LARGE';end if;
 h:=encode(sha256(convert_to(s::text,'UTF8')),'hex');
 select * into g from private.graph_jobs where project_id=p_project_id and owner_id=u order by generation desc limit 1;
 if found then
  select * into j from public.worker_threads where id=g.thread_id;
  if g.content_hash=h and (p_action='state' or j.status in('queued','processing','ready')) then
   return jsonb_build_object('thread_id',j.id,'status',j.status,'error_code',j.error_code,'generation',g.generation,'content_hash',h,'current',true);
  end if;
 end if;
 if p_action='state' then return jsonb_build_object('status','stale','current',false);end if;
 insert into public.worker_threads(owner_id,project_id,workflow,subject_id) values(u,p_project_id,'sync_project_graph',p_project_id) returning * into j;
 insert into private.graph_jobs(thread_id,project_id,owner_id,content_hash,snapshot) values(j.id,p_project_id,u,h,s) returning * into g;
 envelope:=jsonb_build_object('type','thread','schema_version',1,'mode','connected','thread_id',j.id,'event_id',j.command_event_id,
 'action','start','workflow',j.workflow,'context',jsonb_build_object('owner_id',u,'client_id',s->'project'->>'client_id','project_id',p_project_id),
 'payload',jsonb_build_object('project_id',p_project_id,'generation',g.generation,'content_hash',h));
 insert into public.thread_outbox(thread_id,envelope) values(j.id,envelope);
 return jsonb_build_object('thread_id',j.id,'status',j.status,'error_code',j.error_code,'generation',g.generation,'content_hash',h,'current',true);
end $$;
revoke all on function private.project_graph(uuid,text) from public,anon;
grant execute on function private.project_graph(uuid,text) to authenticated;
create function public.project_graph(p_project_id uuid,p_action text) returns jsonb language sql security invoker set search_path='' as $$select private.project_graph(p_project_id,p_action);$$;
revoke all on function public.project_graph(uuid,text) from public,anon;
grant execute on function public.project_graph(uuid,text) to authenticated;

-- Preserve the ingestion handler and shared relay. Dispatch by the persisted workflow.
alter function private.thread_backend(text,jsonb) rename to ingestion_thread_backend;
create function private.thread_backend(p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.worker_threads;g private.graph_jobs;o public.thread_outbox;m jsonb;event uuid;h text;old_hash text;
begin
 if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role'
 and coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'role' is distinct from 'service_role' then
 raise sqlstate 'PT403' using message='BACKEND_ONLY';end if;
 if p_action in('relay_claim','relay_published') then return private.ingestion_thread_backend(p_action,p_data);end if;
 m:=p_data->'message';
 select * into j from public.worker_threads where id=(m->>'thread_id')::uuid for update;
 if not found then raise sqlstate 'PT404' using message='THREAD_NOT_FOUND';end if;
 if j.workflow<>'sync_project_graph' then return private.ingestion_thread_backend(p_action,p_data);end if;
 select * into g from private.graph_jobs where thread_id=j.id;
 select * into o from public.thread_outbox where thread_id=j.id;
 if p_action='claim' then
  if m is distinct from o.envelope then raise sqlstate 'PT409' using message='THREAD_CONTEXT_CONFLICT';end if;
  perform private.ensure_active_project(j.project_id,j.owner_id);
  if j.status in('ready','error') then return jsonb_build_object('terminal',true,'status',j.status);end if;
  if j.lease_until>now() then raise sqlstate 'PT409' using message='THREAD_BUSY';end if;
  update public.worker_threads set status='processing',phase='syncing_graph',lease_id=gen_random_uuid(),lease_until=now()+interval '120 seconds',updated_at=now() where id=j.id returning * into j;
  return jsonb_build_object('terminal',false,'lease_id',j.lease_id);
 elsif p_action='graph_input' then
  perform private.ensure_active_project(j.project_id,j.owner_id);
  if j.status<>'processing' or j.lease_id is distinct from (p_data->>'lease_id')::uuid or j.lease_until<now() then raise sqlstate 'PT409' using message='STALE_THREAD';end if;
  return jsonb_build_object('snapshot',g.snapshot,'generation',g.generation,'content_hash',g.content_hash);
 elsif p_action='result' then
  if m->>'mode' is distinct from 'connected' or m->>'type' is distinct from 'thread' or m->>'schema_version' is distinct from '1'
   or m->>'workflow' is distinct from j.workflow or m->>'causation_id' is distinct from j.command_event_id::text
   or m->'context' is distinct from o.envelope->'context' then raise sqlstate 'PT409' using message='THREAD_CONTEXT_CONFLICT';end if;
  event:=(m->>'event_id')::uuid;h:=encode(sha256(convert_to(m::text,'UTF8')),'hex');
  select result_hash into old_hash from public.thread_inbox where event_id=event;
  if found then
   if old_hash<>h then raise sqlstate 'PT409' using message='EVENT_CONFLICT';end if;
   return jsonb_build_object('duplicate',true);
  end if;
  if j.status in('ready','error') or j.lease_id is distinct from (m->>'lease_id')::uuid or j.lease_until<now() then return jsonb_build_object('discarded',true);end if;
  perform private.ensure_active_project(j.project_id,j.owner_id);
  if m->>'action'='completed' then
   if m->'result'->>'content_hash' is distinct from g.content_hash or (m->'result'->>'generation')::bigint is distinct from g.generation
    then raise sqlstate 'PT409' using message='GRAPH_CONTEXT_CONFLICT';end if;
   update public.worker_threads set status='ready',phase='graph_ready',lease_until=null,updated_at=now() where id=j.id;
  elsif m->>'action'='failed' then
   if coalesce(m->'result'->>'error_code','') !~ '^[A-Z][A-Z_0-9]{1,79}$' then raise sqlstate 'PT422' using message='INVALID_GRAPH_ERROR';end if;
   update public.worker_threads set status='error',phase='error',error_code=m->'result'->>'error_code',lease_until=null,updated_at=now() where id=j.id;
  else raise sqlstate 'PT422' using message='INVALID_THREAD_ACTION';end if;
  insert into public.thread_inbox(event_id,thread_id,result_hash) values(event,j.id,h);
  return jsonb_build_object('stored',true);
 end if;
 raise sqlstate 'PT422' using message='INVALID_THREAD_ACTION';
end $$;
revoke all on function private.thread_backend(text,jsonb) from public,anon,authenticated;
grant execute on function private.thread_backend(text,jsonb) to service_role;
-- Rebind: SQL-language bodies are resolved at execution, but replace explicitly for clarity.
create or replace function public.thread_backend(p_action text,p_data jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.thread_backend(p_action,p_data);$$;
commit;
