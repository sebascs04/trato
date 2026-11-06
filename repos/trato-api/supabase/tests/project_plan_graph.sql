begin;
-- SQL contract test only: all synthetic fixtures, fake provider receipts and effects roll back.
do $$
declare u uuid;cl uuid:=gen_random_uuid();pr uuid:=gen_random_uuid();d1 uuid;d2 uuid;retired uuid;k uuid:=gen_random_uuid();v jsonb;paid jsonb;body jsonb;doc jsonb;pos int;actual text;snap jsonb;gen text:=repeat('a',64);
begin
 select owner_id into u from public.projects order by created_at limit 1;
 if u is null then raise exception 'A fixture owner is required';end if;
 perform set_config('request.jwt.claim.sub',u::text,true);
 insert into public.clients(id,owner_id,name,contact_email) values(cl,u,'Plan graph SQL fixture','test@example.invalid');
 insert into public.projects(id,owner_id,client_id,name) values(pr,u,cl,'Plan graph SQL fixture');
 insert into public.project_start_plans(project_id,owner_id,brief,budget,target_date,summary,model,source_job_id,output_language,considerations,limitations,background_snapshot,command_hash)
 values(pr,u,'SQL fixture',200,'2030-01-01','Fixture','test',gen_random_uuid(),'en','[]','[]','[]',repeat('a',64));
 insert into public.project_start_stages(project_id,owner_id,position,title,deliverables,percent,payment_condition,amount)
 values(pr,u,1,'First','One',50,'After first delivery',100),(pr,u,2,'Second','Two',50,'After second delivery',100);
 for pos in 1..2 loop
  doc:=private.reserve_document_with_context(pr,'Stage proof','delivery','proof.pdf','application/pdf',20,repeat('a',64),'stage-fixture-'||pos,jsonb_build_object('purpose','delivery_evidence','stage_position',pos));
  if pos=1 then d1:=(doc->'document'->>'id')::uuid;else d2:=(doc->'document'->>'id')::uuid;end if;
  update public.document_extractions set status='ready',parser='fixture',parser_version='1',result_hash=repeat('a',64),completed_at=now() where document_id=(doc->'document'->>'id')::uuid and project_id=pr and owner_id=u;
  insert into public.file_processing_artifacts(document_id,project_id,owner_id,source_generation,stage,cache_key,artifact_fingerprint,artifact)
  values((doc->'document'->>'id')::uuid,pr,u,gen,'treatment',repeat('b',64),repeat('c',64),'{"decision":"continue"}'),((doc->'document'->>'id')::uuid,pr,u,gen,'summary',repeat('b',64),repeat('c',64),'{"summary":"Fixture"}');
 end loop;
 doc:=private.reserve_document_with_context(pr,'Retired proof','delivery','retired.pdf','application/pdf',20,repeat('b',64),'retire-fixture',jsonb_build_object('purpose','delivery_evidence','stage_position',1));
 retired:=(doc->'document'->>'id')::uuid;
 perform public.plan_evidence_backend(u,pr,1,retired,'withdraw');
 if (select deleted_at from public.documents where id=retired) is null then raise exception 'Missing source withdrawal';end if;
 if private.graph_snapshot(pr,u)::text like '%'||retired::text||'%' then raise exception 'Withdrawn document remains in graph snapshot';end if;
 if jsonb_array_length(public.plan_evidence_backend(u,pr,1,null,'pending'))<>1 then raise exception 'Missing cleanup pending state';end if;
 body:=jsonb_build_object('project_id',pr,'stage_position',2,'amount_minor',10000,'conditions','After second delivery','output_language','en','request_key',k,'merchant_id','TEST','payer_email','test@example.invalid','token',repeat('b',43),'evidence_document_id',d2,'evidence_generation',gen);
 begin perform public.initial_checkout_backend(u,'prepare',body);raise exception 'Expected prior-payment gate';exception when sqlstate 'PT409' then if sqlerrm<>'PLAN_PREVIOUS_STAGE_UNPAID' then raise;end if;end;
 body:=body||jsonb_build_object('stage_position',1,'conditions','After first delivery','evidence_document_id',d1,'token',repeat('a',43));
 begin perform public.initial_checkout_backend(u,'prepare',body||'{"amount_minor":1}');raise exception 'Expected fixed amount';exception when sqlstate 'PT422' then if sqlerrm<>'PLAN_STAGE_AMOUNT_MISMATCH' then raise;end if;end;
 begin perform public.initial_checkout_backend(u,'prepare',body||jsonb_build_object('evidence_document_id',d2));raise exception 'Expected evidence binding';exception when sqlstate 'PT409' then if sqlerrm<>'PLAN_EVIDENCE_NOT_READY' then raise;end if;end;
 v:=public.initial_checkout_backend(u,'prepare',body);
 snap:=private.graph_snapshot(pr,u);
 if jsonb_array_length(snap->'project_start_plans')<>1 or jsonb_array_length(snap->'project_start_stages')<>2 or jsonb_array_length(snap->'plan_stage_evidence')<>2 then raise exception 'Missing plan, stages or evidence';end if;
 if jsonb_array_length(snap->'plan_stage_payments')<>0 then raise exception 'Unpaid checkout became confirmed graph payment';end if;
 if public.initial_checkout_backend(u,'prepare',body)->>'id'<>v->>'id' then raise exception 'Non-idempotent prepare';end if;
 begin perform public.plan_evidence_backend(u,pr,1,d1,'withdraw');raise exception 'Expected payment evidence protection';exception when sqlstate 'PT409' then if sqlerrm<>'PLAN_EVIDENCE_PROTECTED' then raise;end if;end;
 perform public.plan_evidence_backend(u,pr,1,retired,'cleaned');
 perform public.plan_evidence_backend(u,pr,1,retired,'withdraw');
 if jsonb_array_length(public.plan_evidence_backend(u,pr,1,null,'pending'))<>0 then raise exception 'Cleanup completion was not retained';end if;
 paid:=jsonb_build_object('id',v->>'id','status','completed','order_id','TEST-FIRST','capture_id','TEST-FIRST-'||pr,'amount_minor',10000,'merchant_id','TEST','currency','USD');
 perform public.initial_checkout_backend(u,'apply',paid);perform public.initial_checkout_backend(u,'apply',paid);
 snap:=private.graph_snapshot(pr,u);
 if jsonb_array_length(snap->'plan_stage_payments')<>1 or snap->'plan_stage_payments'->0->>'status'<>'completed' then raise exception 'Verified payment absent';end if;
 if snap::text like '%checkout_token%' or snap::text like '%approval_url%' or snap::text like '%payer_email%' or snap::text like '%capture_id%' then raise exception 'Private checkout data exposed';end if;
 if (select count(*) from public.project_received_payments where project_id=pr)<>1 then raise exception 'Duplicate received payment';end if;
 if (select completed_at from public.project_start_plans where project_id=pr) is not null then raise exception 'Premature plan completion';end if;
 body:=body||jsonb_build_object('stage_position',2,'conditions','After second delivery','evidence_document_id',d2,'token',repeat('b',43));
 v:=public.initial_checkout_backend(u,'prepare',body);
 perform public.initial_checkout_backend(u,'apply',jsonb_build_object('id',v->>'id','status','completed','order_id','TEST-SECOND','capture_id','TEST-SECOND-'||pr,'amount_minor',10000,'merchant_id','TEST','currency','USD'));
 snap:=private.graph_snapshot(pr,u);
 if jsonb_array_length(snap->'plan_stage_payments')<>2 or snap->'project_start_plans'->0->>'completed_at' is null then raise exception 'Plan completion not projected';end if;
 if jsonb_array_length(private.graph_snapshot(pr,gen_random_uuid())->'project_start_stages')<>0 then raise exception 'Foreign owner sees plan';end if;
 if has_function_privilege('authenticated','private.graph_snapshot(uuid,uuid)','execute') or has_function_privilege('anon','private.graph_snapshot(uuid,uuid)','execute') then raise exception 'Snapshot callable publicly';end if;
 if (select completed_at from public.project_start_plans where project_id=pr) is null then raise exception 'Missing plan completion';end if;
 if (select status from public.projects where id=pr) not in('draft','active') then raise exception 'Plan completion closed the project';end if;
 begin perform public.initial_checkout_backend(gen_random_uuid(),'get',jsonb_build_object('project_id',pr,'stage_position',1));raise exception 'Expected owner isolation';exception when sqlstate 'PT404' then null;end;
 update public.projects set deleted_at=now() where id=pr;
 snap:=private.graph_snapshot(pr,u);
 if snap->'project'<>'null'::jsonb or jsonb_array_length(snap->'project_start_plans')<>0 or jsonb_array_length(snap->'plan_stage_payments')<>0 then raise exception 'Deleted project remains visible';end if;
end $$;
rollback;
