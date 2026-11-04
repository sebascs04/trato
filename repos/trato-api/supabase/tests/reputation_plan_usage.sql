begin;
insert into auth.users(id,email) values('ab111111-1111-4111-8111-111111111111','usage-a@example.invalid'),('ab211111-1111-4111-8111-111111111111','usage-b@example.invalid');
insert into public.clients(id,owner_id,name,contact_email) values('ab311111-1111-4111-8111-111111111111','ab111111-1111-4111-8111-111111111111','Synthetic client','usage-client@example.invalid');
insert into public.projects(id,owner_id,client_id,name) values('ab411111-1111-4111-8111-111111111111','ab111111-1111-4111-8111-111111111111','ab311111-1111-4111-8111-111111111111','Synthetic source');
insert into private.reputation_members(user_id,alias) values('ab111111-1111-4111-8111-111111111111','Synthetic author');
insert into private.reputation_clients(id,name,created_by,public_email) values('ab511111-1111-4111-8111-111111111111','Synthetic profile','ab111111-1111-4111-8111-111111111111','usage-client@example.invalid');
insert into private.reputation_reviews(id,profile_id,author_id,project_id,rating,communication,scope,collaboration,payment,body)
values('ab611111-1111-4111-8111-111111111111','ab511111-1111-4111-8111-111111111111','ab111111-1111-4111-8111-111111111111','ab411111-1111-4111-8111-111111111111',4,4,4,4,'on_time','Synthetic experience with clear scope and communication.');
set local role authenticated;
set local request.jwt.claim.sub='ab111111-1111-4111-8111-111111111111';
set local request.jwt.claims='{"sub":"ab111111-1111-4111-8111-111111111111","role":"authenticated"}';
do $$declare plan jsonb;result jsonb;begin
 plan:='{"brief":"A test","budget":"100","target_date":"2026-12-01","summary":"A plan","model":"test","source_job_id":"ab711111-1111-4111-8111-111111111111","output_language":"es","observations":[],"limitations":[],"reviews":[{"id":"ab611111-1111-4111-8111-111111111111","version":1,"body":"Synthetic experience with clear scope and communication."}],"stages":[{"title":"Delivery","body":"Deliver work","percent":100,"when":"On delivery"}]}'::jsonb;
 perform public.create_planned_project('ab811111-1111-4111-8111-111111111111','ab311111-1111-4111-8111-111111111111','Plan one',plan);
 perform public.create_planned_project('ab911111-1111-4111-8111-111111111111','ab311111-1111-4111-8111-111111111111','Plan two',plan);
 perform public.create_planned_project('aba11111-1111-4111-8111-111111111111','ab311111-1111-4111-8111-111111111111','Plan pending',plan);
 result:=public.reputation_usage('ab511111-1111-4111-8111-111111111111',true);
 if(result->>'confirmed_plan_freelancers')::int<>0 or (result->>'self_reported_helpful')::int<>1 then raise exception 'A vote or browser-only plan inflated confirmed usage';end if;
 perform public.reputation_usage('ab511111-1111-4111-8111-111111111111',true);
 begin perform public.record_reputation_plan_usage('ab111111-1111-4111-8111-111111111111','ab811111-1111-4111-8111-111111111111','ab711111-1111-4111-8111-111111111111');raise exception 'Browser counter write permitted';exception when insufficient_privilege then null;end;
 begin perform 1 from private.reputation_plan_usage;raise exception 'Private usage rows exposed';exception when insufficient_privilege then null;end;
end $$;
reset role;
set local role service_role;
set local request.jwt.claims='{"role":"service_role"}';
select public.record_reputation_plan_usage('ab111111-1111-4111-8111-111111111111','ab811111-1111-4111-8111-111111111111','ab711111-1111-4111-8111-111111111111');
select public.record_reputation_plan_usage('ab111111-1111-4111-8111-111111111111','ab811111-1111-4111-8111-111111111111','ab711111-1111-4111-8111-111111111111');
select public.record_reputation_plan_usage('ab111111-1111-4111-8111-111111111111','ab911111-1111-4111-8111-111111111111','ab711111-1111-4111-8111-111111111111');
do $$begin
 begin perform public.record_reputation_plan_usage('ab211111-1111-4111-8111-111111111111','ab811111-1111-4111-8111-111111111111','ab711111-1111-4111-8111-111111111111');raise exception 'Foreign owner accepted';exception when sqlstate 'PT404' then null;end;
end $$;
reset role;
set local role authenticated;
set local request.jwt.claim.sub='ab211111-1111-4111-8111-111111111111';
set local request.jwt.claims='{"sub":"ab211111-1111-4111-8111-111111111111","role":"authenticated"}';
do $$declare result jsonb;begin
 result:=public.reputation_usage('ab511111-1111-4111-8111-111111111111');
 if(result->>'confirmed_plan_freelancers')::int<>1 or(result->>'self_reported_helpful')::int<>1 or result->'my_helpful'<>'null'::jsonb then raise exception 'Distinct users or privacy incorrect';end if;
 if result ? 'owner_id' or result ? 'project_id' then raise exception 'Private identifiers leaked';end if;
end $$;
set local request.jwt.claim.sub='ab111111-1111-4111-8111-111111111111';
set local request.jwt.claims='{"sub":"ab111111-1111-4111-8111-111111111111","role":"authenticated"}';
do $$declare result jsonb;begin
 result:=public.reputation_usage('ab511111-1111-4111-8111-111111111111',false);
 if(result->>'confirmed_plan_freelancers')::int<>1 or(result->>'self_reported_helpful')::int<>0 then raise exception 'Withdrawing an opinion changed real usage';end if;
end $$;
reset role;
update private.reputation_reviews set status='withdrawn' where id='ab611111-1111-4111-8111-111111111111';
set local role service_role;
set local request.jwt.claims='{"role":"service_role"}';
do $$begin
 begin perform public.record_reputation_plan_usage('ab111111-1111-4111-8111-111111111111','aba11111-1111-4111-8111-111111111111','ab711111-1111-4111-8111-111111111111');raise exception 'Withdrawn source counted as new use';exception when sqlstate 'PT409' then null;end;
end $$;
reset role;
set local request.jwt.claims='{"sub":"ab111111-1111-4111-8111-111111111111","role":"authenticated"}';

set local role authenticated;
do $$begin
 begin perform public.reputation_usage('ab511111-1111-4111-8111-111111111111');raise exception 'Withdrawn profile still visible';exception when sqlstate 'PT404' then null;end;
end $$;
reset role;
rollback;
