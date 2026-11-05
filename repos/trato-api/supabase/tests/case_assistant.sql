-- Run with psql -v ON_ERROR_STOP=1 against the migrated test database.
-- Synthetic metadata only. No model, vector index, email or financial calls.
begin;
set local statement_timeout='15s';
\ir fixtures/refund_fixture.sql
create temp table case_ai_fixture as select pg_temp.refund_fixture() a,pg_temp.refund_fixture() b;
alter table case_ai_fixture add column session_id uuid,add column job_id uuid,add column proposal_id uuid,add column revision_id uuid,add column next_job uuid;
update case_ai_fixture set proposal_id=(select proposal_id from public.proposal_payments where id=(a->>'payment')::uuid),revision_id=(select revision_id from public.proposal_payments where id=(a->>'payment')::uuid),job_id=gen_random_uuid(),next_job=gen_random_uuid();
grant select,update on case_ai_fixture to authenticated,service_role;
select set_config('request.jwt.claim.sub',a->>'owner',true) from case_ai_fixture;
set local role authenticated;
do $$declare f record;s jsonb;t jsonb;m jsonb;r jsonb;
begin
 select * into f from case_ai_fixture;
 s:=public.case_assistant_open('change',f.proposal_id,f.revision_id);
 t:=public.case_assistant_open('change',f.proposal_id,f.revision_id);
 if s->>'id'<>t->>'id' then raise exception 'Session replay changed ID';end if;
 update case_ai_fixture set session_id=(s->>'id')::uuid;
 m:=public.case_assistant_message((s->>'id')::uuid,f.job_id,'Explain the agreement','es');
 if m<>public.case_assistant_message((s->>'id')::uuid,f.job_id,'Explain the agreement','es') then raise exception 'Message replay changed record';end if;
 begin perform public.case_assistant_message((s->>'id')::uuid,f.job_id,'Different','es');raise exception 'Key reuse allowed';exception when sqlstate 'PT409' then if sqlerrm<>'AI_CONFLICT' then raise;end if;end;
 begin perform public.case_assistant_message((s->>'id')::uuid,f.next_job,'Second','es');raise exception 'Concurrent turn allowed';exception when sqlstate 'PT409' then if sqlerrm<>'AI_CASE_BUSY' then raise;end if;end;
 begin perform public.case_assistant_open('change',(select proposal_id from public.proposal_payments where id=(f.b->>'payment')::uuid),f.revision_id);raise exception 'Foreign case allowed';exception when sqlstate 'PT404' then null;end;
 begin perform public.case_assistant_outcome((f.a->>'owner')::uuid,f.job_id,'{}',null);raise exception 'Client forged output';exception when insufficient_privilege then null;end;
 begin update public.case_assistant_messages set status='failed',error_code='FORGED' where job_id=f.job_id;
  if found then raise exception 'Client mutated message';end if;
 exception when insufficient_privilege then null;end;
 if not exists(select 1 from public.case_assistant_messages where job_id=f.job_id and status='queued' and error_code is null) then raise exception 'Client mutation changed pending record';end if;
 -- Refund sessions can exist before the first draft snapshot.
 r:=public.refund_command('create',f.a->'request','case-assistant-refund');
 s:=public.case_assistant_open('refund',(r->'settlement'->>'id')::uuid,null);
 if s->>'revision_id' is not null then raise exception 'Invented refund revision';end if;
 if s<>public.case_assistant_open('refund',(r->'settlement'->>'id')::uuid,null) then raise exception 'Null-revision session duplicated';end if;
end $$;
reset role;
set local role service_role;
do $$declare f record;r jsonb;
begin
 select * into f from case_ai_fixture;
 r:=public.case_assistant_outcome((f.a->>'owner')::uuid,f.job_id,'{"answer":"Synthetic archived answer"}',null);
 if r<>public.case_assistant_outcome((f.a->>'owner')::uuid,f.job_id,'{"answer":"Synthetic archived answer"}',null) then raise exception 'Outcome replay failed';end if;
 begin perform public.case_assistant_outcome((f.a->>'owner')::uuid,f.job_id,null,'REPLACED');raise exception 'Final result overwritten';exception when sqlstate 'PT409' then null;end;
end $$;
reset role;
set local role authenticated;
do $$declare f record;begin
 select * into f from case_ai_fixture;
 if not exists(select 1 from public.case_assistant_messages where job_id=f.job_id and status='completed' and result->>'answer'='Synthetic archived answer') then raise exception 'Durable result missing';end if;
 perform public.case_assistant_message(f.session_id,f.next_job,'Another question','en');
end $$;
reset role;
-- Change head outside assistant; it must reject the now stale successful outcome.
update public.change_proposals set current_revision_id=null where id=(select proposal_id from case_ai_fixture);
set local role service_role;
do $$declare f record;begin
 select * into f from case_ai_fixture;
 begin perform public.case_assistant_outcome((f.a->>'owner')::uuid,f.next_job,'{}',null);raise exception 'Stale success stored';exception when sqlstate 'PT409' then if sqlerrm<>'AI_CASE_STALE' then raise;end if;end;
 perform public.case_assistant_outcome((f.a->>'owner')::uuid,f.next_job,null,'AI_CASE_STALE');
end $$;
reset role;
select set_config('request.jwt.claim.sub',b->>'owner',true) from case_ai_fixture;
set local role authenticated;
do $$begin
 if exists(select 1 from public.case_assistant_sessions) or exists(select 1 from public.case_assistant_messages) then raise exception 'Foreign history exposed';end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub',a->>'owner',true) from case_ai_fixture;
update public.clients set deleted_at=now() where id=(select client_id from public.projects where id=(select (a->>'project')::uuid from case_ai_fixture));
set local role authenticated;
do $$begin
 if exists(select 1 from public.case_assistant_sessions) or exists(select 1 from public.case_assistant_messages) then raise exception 'Deleted client history visible';end if;
end $$;
rollback;
