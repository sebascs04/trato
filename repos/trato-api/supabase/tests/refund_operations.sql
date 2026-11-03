begin;
set local statement_timeout='10s';
\ir fixtures/refund_fixture.sql
create temp table refund_lookup_fixture as select pg_temp.refund_fixture() a,pg_temp.refund_fixture() b,gen_random_uuid() other_project;
insert into public.projects(id,owner_id,client_id,name)
select f.other_project,p.owner_id,p.client_id,'Other project' from refund_lookup_fixture f join public.projects p on p.id=(f.a->>'project')::uuid;
grant select on refund_lookup_fixture to authenticated;
set local role authenticated;
do $$declare f jsonb;b jsonb;other uuid;saved jsonb;query jsonb;begin
 select a,refund_lookup_fixture.b,other_project into f,b,other from refund_lookup_fixture;
 perform set_config('request.jwt.claim.sub',f->>'owner',true);
 query:=public.refund_command_result((f->>'project')::uuid,'not-saved');
 if query<>'{"state":"unconfirmed"}'::jsonb then raise exception 'Missing command falsely confirmed';end if;
 saved:=public.refund_command('create',f->'request','same-key');
 query:=public.refund_command_result((f->>'project')::uuid,'same-key');
 if query->>'state'<>'confirmed' or query->'result'<>saved then raise exception 'Wrong saved result';end if;
 if public.refund_command_result(other,'same-key')<>'{"state":"unconfirmed"}'::jsonb then raise exception 'Result leaked to other project';end if;
 if (select count(*) from public.refund_events where settlement_id=(saved->'settlement'->>'id')::uuid)<>1 then raise exception 'Lookup wrote events';end if;
 begin perform 1 from private.refund_commands;raise exception 'Private commands readable';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub',b->>'owner',true);
 if public.refund_command_result((b->>'project')::uuid,'same-key')<>'{"state":"unconfirmed"}'::jsonb then raise exception 'Foreign command leaked';end if;
 begin perform public.refund_command_result((f->>'project')::uuid,'same-key');raise exception 'Foreign project allowed';exception when sqlstate 'PT404' then null;end;
end $$;
reset role;
do $$begin
 if has_function_privilege('anon','public.refund_command_result(uuid,text)','execute') then raise exception 'Anonymous lookup exposed';end if;
end $$;
rollback;
