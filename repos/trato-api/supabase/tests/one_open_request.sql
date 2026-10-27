begin;
insert into auth.users(id,email) values('55555555-5555-4555-8555-555555555555','serial-owner@trato.invalid'),('66666666-6666-4666-8666-666666666666','serial-foreign@trato.invalid');
insert into public.clients(id,owner_id,name) values('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','55555555-5555-4555-8555-555555555555','Same client, two projects');
insert into public.projects(id,owner_id,client_id,name) values
 ('eeeeeeee-0001-4000-8000-000000000001','55555555-5555-4555-8555-555555555555','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','P1'),
 ('eeeeeeee-0002-4000-8000-000000000002','55555555-5555-4555-8555-555555555555','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','P2');
-- Trusted finalized/accepted fixtures exist only in the rollback transaction.
create function pg_temp.finalization_fixture(doc uuid,finalized boolean) returns void language plpgsql security definer set search_path='' as $$begin
 insert into public.change_proposals(owner_id,project_id,request_document_id,status,locked_at)
 select owner_id,project_id,id,case when finalized then 'draft' else 'accepted' end,case when finalized then now() else null end from public.documents where id=doc and owner_id='55555555-5555-4555-8555-555555555555';
end $$;
set local role authenticated;
set local request.jwt.claim.sub='55555555-5555-4555-8555-555555555555';
set local request.jwt.claims='{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
do $$declare first_doc uuid;other_doc uuid;third_doc uuid;result jsonb;again jsonb;closed jsonb;begin
 result:=public.reserve_document('eeeeeeee-0001-4000-8000-000000000001','Request 1','email_request','request.pdf','application/pdf',5,repeat('a',64),'first');
 first_doc:=(result->'document'->>'id')::uuid;
 again:=public.reserve_document('eeeeeeee-0001-4000-8000-000000000001','Request 1','email_request','request.pdf','application/pdf',5,repeat('a',64),'first');
 if result<>again then raise exception 'Retry duplicated existing request';end if;
 if (public.project_request_status('eeeeeeee-0001-4000-8000-000000000001')->>'can_register')::boolean then raise exception 'Unproposed request did not block new request';end if;
 begin
 perform public.reserve_document('eeeeeeee-0001-4000-8000-000000000001','Request 2','email_request','new.pdf','application/pdf',5,repeat('b',64),'second');
 raise exception 'Second open request allowed in same project';
 exception when sqlstate 'PT409' then null;end;
 -- Supplemental feedback and initial sources remain allowed in the same project.
 perform public.reserve_document('eeeeeeee-0001-4000-8000-000000000001','Client feedback','reference','feedback.pdf','application/pdf',5,repeat('c',64),'feedback');
 result:=public.reserve_document('eeeeeeee-0002-4000-8000-000000000002','Other project request','email_request','other.pdf','application/pdf',5,repeat('d',64),'other');
 other_doc:=(result->'document'->>'id')::uuid;
 closed:=public.close_change_request(first_doc,'rejected','Client rejected the additional work');
 if closed<>public.close_change_request(first_doc,'rejected','Client rejected the additional work') then raise exception 'Repeated closure changed fact';end if;
 if not (public.project_request_status('eeeeeeee-0001-4000-8000-000000000001')->>'can_register')::boolean then raise exception 'Closure did not release project';end if;
 begin
 perform public.proposal_command('create',jsonb_build_object('project_id','eeeeeeee-0001-4000-8000-000000000001','request_document_id',first_doc),'closed-proposal');
 raise exception 'Proposal created for closed request';
 exception when sqlstate 'PT409' then null;end;
 result:=public.reserve_document('eeeeeeee-0001-4000-8000-000000000001','Request after closure','email_request','after.pdf','application/pdf',5,repeat('e',64),'after');
 third_doc:=(result->'document'->>'id')::uuid;
 perform pg_temp.finalization_fixture(third_doc,true);
 if not (public.project_request_status('eeeeeeee-0001-4000-8000-000000000001')->>'can_register')::boolean then raise exception 'Finalized request did not release project';end if;
 begin
 perform public.close_change_request(third_doc,'withdrawn','Attempt to alter finalized change');
 raise exception 'Finalized request altered';
 exception when sqlstate 'PT409' then null;end;
 perform pg_temp.finalization_fixture(other_doc,false);
 begin
 perform public.close_change_request(other_doc,'withdrawn','Attempt to withdraw accepted terms');
 raise exception 'Accepted request closed without financial review';
 exception when sqlstate 'PT409' then null;end;
 perform set_config('trato.serial.request',other_doc::text,true);
end $$;
set local request.jwt.claim.sub='66666666-6666-4666-8666-666666666666';
set local request.jwt.claims='{"sub":"66666666-6666-4666-8666-666666666666","role":"authenticated"}';
do $$begin
 begin perform public.close_change_request(current_setting('trato.serial.request')::uuid,'rejected','Foreign request');raise exception 'Foreign closure allowed';exception when sqlstate 'PT404' then null;end;
 if exists(select 1 from public.request_closures) then raise exception 'Cross-owner closure read';end if;
end $$;
reset role;
select 'PASS: one open request per project from registration, same-key retry, other project allowed, supplemental sources allowed, explicit closure, finalized/accepted protection, owner isolation; all fixtures rolled back' as result;
rollback;
