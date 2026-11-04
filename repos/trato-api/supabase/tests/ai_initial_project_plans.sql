begin;
insert into auth.users(id,email) values('e1111111-1111-4111-8111-111111111111','plan-contract-a@example.invalid'),('e2111111-1111-4111-8111-111111111111','plan-contract-b@example.invalid');
insert into public.clients(id,owner_id,name) values('e3111111-1111-4111-8111-111111111111','e1111111-1111-4111-8111-111111111111','Synthetic client');
set local role authenticated;
set local request.jwt.claim.sub='e1111111-1111-4111-8111-111111111111';
set local request.jwt.claims='{"sub":"e1111111-1111-4111-8111-111111111111","role":"authenticated"}';
do $$declare plan jsonb; result jsonb;begin
 plan:='{"brief":"A tiny task","budget":"0.10","target_date":"2026-12-01","summary":"Review before use","model":"test-model","source_job_id":"e4111111-1111-4111-8111-111111111111","output_language":"es","observations":[],"limitations":["Test"],"reviews":[],"stages":[{"title":"First","body":"First deliverable","percent":33,"when":"Before work"},{"title":"Second","body":"Second deliverable","percent":33,"when":"On review"},{"title":"Final","body":"Final deliverable","percent":34,"when":"Before delivery"}]}'::jsonb;
 result:=public.create_planned_project('e5111111-1111-4111-8111-111111111111','e3111111-1111-4111-8111-111111111111','Synthetic plan',plan);
 perform public.create_planned_project('e5111111-1111-4111-8111-111111111111','e3111111-1111-4111-8111-111111111111','Synthetic plan',plan);
 if(select count(*) from public.project_start_plans)<>1 or (select sum(amount) from public.project_start_stages)<>0.10 then raise exception 'Plan idempotency or rounding failed';end if;
 begin
  perform public.create_planned_project('e6111111-1111-4111-8111-111111111111','e3111111-1111-4111-8111-111111111111','Invalid sum',jsonb_set(plan,'{stages,0,percent}','1'));
  raise exception 'Invalid sum accepted';
 exception when sqlstate 'PT422' then null;end;
 if exists(select 1 from public.projects where id='e6111111-1111-4111-8111-111111111111') then raise exception 'Invalid plan left a project';end if;
end $$;
set local request.jwt.claim.sub='e2111111-1111-4111-8111-111111111111';
set local request.jwt.claims='{"sub":"e2111111-1111-4111-8111-111111111111","role":"authenticated"}';
do $$begin
 if exists(select 1 from public.project_start_plans) or exists(select 1 from public.project_start_stages) then raise exception 'Foreign plan visible';end if;
end $$;
reset role;
rollback;
