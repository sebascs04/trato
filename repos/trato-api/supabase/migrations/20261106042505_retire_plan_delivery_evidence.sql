begin;
alter table public.documents add column deleted_at timestamptz;
grant update(deleted_at) on public.documents to service_role;
alter table public.document_upload_contexts add column vector_cleanup_status text check(vector_cleanup_status in ('pending','complete'));
create index active_project_documents on public.documents(owner_id,project_id,created_at desc) where deleted_at is null;
create function public.plan_evidence_backend(p_owner uuid,p_project uuid,p_position integer,p_document uuid,p_action text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare pr public.projects;d public.documents;ctx public.document_upload_contexts;
begin
 if p_owner is null then raise sqlstate 'PT401' using message='UNAUTHORIZED';end if;
 select * into pr from public.projects where id=p_project and owner_id=p_owner and deleted_at is null for update;
 if not found then raise sqlstate 'PT404' using message='PROJECT_NOT_FOUND';end if;
 if p_action='pending' then
  return coalesce((select jsonb_agg(jsonb_build_object('file_id',x.document_id,'title',doc.title,'cleanup_status',x.vector_cleanup_status)) from public.document_upload_contexts x join public.documents doc on doc.id=x.document_id where x.project_id=p_project and x.owner_id=p_owner and x.stage_position=p_position and doc.deleted_at is not null and x.vector_cleanup_status='pending'),'[]'::jsonb);
 end if;
 select * into d from public.documents where id=p_document and project_id=p_project and owner_id=p_owner for update;
 select * into ctx from public.document_upload_contexts where document_id=p_document and project_id=p_project and owner_id=p_owner and stage_position=p_position and purpose='delivery_evidence' for update;
 if d.id is null or d.kind<>'delivery' or ctx.document_id is null then raise sqlstate 'PT404' using message='PLAN_EVIDENCE_INVALID';end if;
 if d.deleted_at is null and (exists(select 1 from public.project_initial_checkouts where project_id=p_project and (stage_position=p_position or evidence_document_id=p_document))
 or exists(select 1 from public.proposal_revision_sources where document_id=p_document))
 then raise sqlstate 'PT409' using message='PLAN_EVIDENCE_PROTECTED';end if;
 if p_action='withdraw' then
  update public.documents set deleted_at=coalesce(deleted_at,now()) where id=p_document returning * into d;
  update public.document_upload_contexts set vector_cleanup_status=coalesce(vector_cleanup_status,'pending') where document_id=p_document returning * into ctx;
 elsif p_action='cleaned' then
  if d.deleted_at is null then raise sqlstate 'PT409' using message='PLAN_EVIDENCE_INVALID';end if;
  update public.document_upload_contexts set vector_cleanup_status='complete' where document_id=p_document returning * into ctx;
 else raise sqlstate 'PT422' using message='INVALID_REQUEST';end if;
 return jsonb_build_object('file_id',d.id,'project_id',pr.id,'client_id',pr.client_id,'title',d.title,'withdrawn_at',d.deleted_at,'cleanup_status',ctx.vector_cleanup_status);
end $$;
revoke all on function public.plan_evidence_backend(uuid,uuid,integer,uuid,text) from public,anon,authenticated;
grant execute on function public.plan_evidence_backend(uuid,uuid,integer,uuid,text) to service_role;
create or replace function private.graph_snapshot(p_project uuid,p_owner uuid) returns jsonb language sql stable security invoker set search_path='' as $$
select jsonb_build_object('schema_version',1,'owner_id',p_owner,'project_id',p_project,
 'project',(select jsonb_build_object('id',p.id,'name',p.name,'status',p.status,'client_id',p.client_id,'client_name',c.name)
 from public.projects p join public.clients c on c.id=p.client_id and c.owner_id=p.owner_id
 where p.id=p_project and p.owner_id=p_owner and c.deleted_at is null),
'documents',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from (select id,title,kind,mime_type,sha256,created_at from public.documents where project_id=p_project and owner_id=p_owner and deleted_at is null) x),'[]'::jsonb),
'document_extractions',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from (select id,document_id,status,result_hash,created_at,completed_at from public.document_extractions where project_id=p_project and owner_id=p_owner and document_id in(select id from public.documents where deleted_at is null)) x),'[]'::jsonb),
'change_proposals',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from (select id,request_document_id,current_revision_id,status,locked_at,created_at from public.change_proposals where project_id=p_project and owner_id=p_owner) x),'[]'::jsonb),
'proposal_revisions',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from (select id,proposal_id,revision_no,draft_sequence,replaces_draft_id,feedback_document_id,base_acceptance_id,scope_summary,conditions,currency,additional_minor,deadline,created_at from public.proposal_revisions where project_id=p_project and owner_id=p_owner) x),'[]'::jsonb),
'proposal_revision_sources',coalesce((select jsonb_agg(to_jsonb(x) order by x.revision_id) from (select revision_id,document_id,extraction_id,document_sha256,extraction_result_hash from public.proposal_revision_sources where project_id=p_project and owner_id=p_owner) x),'[]'::jsonb),
'proposal_artifacts',coalesce((select jsonb_agg(to_jsonb(x) order by x.revision_id) from (select revision_id,document_id,sha256,created_at from public.proposal_artifacts where project_id=p_project and owner_id=p_owner) x),'[]'::jsonb),
'proposal_reviews',coalesce((select jsonb_agg(to_jsonb(x) order by x.revision_id) from (select revision_id,addendum_document_id,addendum_sha256,reviewed_at from public.proposal_reviews where project_id=p_project and owner_id=p_owner) x),'[]'::jsonb),
'proposal_acceptances',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from (select id,revision_id,returned_document_id,returned_sha256,method,cryptographic_signature_verified,created_at from public.proposal_acceptances where project_id=p_project and owner_id=p_owner) x),'[]'::jsonb),
'proposal_deliveries',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from (select id,revision_id,kind,status,created_at,updated_at from public.proposal_deliveries where project_id=p_project and owner_id=p_owner) x),'[]'::jsonb),
'proposal_payments',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from (select id,revision_id,acceptance_id,status,amount_minor,currency,created_at,updated_at from public.proposal_payments where project_id=p_project and owner_id=p_owner) x),'[]'::jsonb),
'project_agreement_heads',coalesce((select jsonb_agg(to_jsonb(x) order by x.generation) from (select acceptance_id,generation from public.project_agreement_heads where project_id=p_project and owner_id=p_owner) x),'[]'::jsonb));$$;
create or replace function public.initial_checkout_backend(p_owner uuid,p_action text,p_data jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.projects; c public.clients; v public.project_initial_checkouts; h text; a bigint; existing public.project_received_payments; stage_no integer; st public.project_start_stages; evidence uuid; gen text;
begin
 if p_action='checkout' then
  select * into v from public.project_initial_checkouts where checkout_token=p_data->>'token';
  if not found then raise sqlstate 'PT404' using message='INITIAL_PAYMENT_NOT_FOUND';end if;
  return to_jsonb(v);
 end if;
 if p_owner is null then raise sqlstate 'PT401' using message='UNAUTHORIZED';end if;
 if p_data ? 'project_id' then
  select * into p from public.projects where id=(p_data->>'project_id')::uuid and owner_id=p_owner and deleted_at is null for update;
 else
  select * into v from public.project_initial_checkouts where id=(p_data->>'id')::uuid and owner_id=p_owner;
  if not found then raise sqlstate 'PT404' using message='INITIAL_PAYMENT_NOT_FOUND';end if;
  select * into p from public.projects where id=v.project_id and owner_id=p_owner and deleted_at is null for update;
 end if;
 if p.id is null then raise sqlstate 'PT404' using message='PROJECT_NOT_FOUND';end if;
 if p.status='closed' and p_action in ('prepare','claim_create','claim_capture','mail_claim') then raise sqlstate 'PT409' using message='PROJECT_NOT_ACTIVE';end if;
 select * into c from public.clients where id=p.client_id and owner_id=p_owner and deleted_at is null;
 if not found then raise sqlstate 'PT404' using message='PROJECT_NOT_FOUND';end if;
 if p_data ? 'id' then
  select * into v from public.project_initial_checkouts where id=(p_data->>'id')::uuid and project_id=p.id and owner_id=p_owner for update;
  stage_no:=v.stage_position;
 else
  stage_no:=(p_data->>'stage_position')::integer;
  select * into v from public.project_initial_checkouts where project_id=p.id and owner_id=p_owner and stage_position is not distinct from stage_no for update;
 end if;
 if p_action='get' then
  if v.id is null then return 'null'::jsonb;end if;
  return to_jsonb(v)||jsonb_build_object('events',(select coalesce(jsonb_agg(to_jsonb(e) order by e.id),'[]'::jsonb) from public.project_initial_checkout_events e where e.checkout_id=v.id));
 elsif p_action='prepare' then
  a:=(p_data->>'amount_minor')::bigint;
  if a is null or a not between 1 and 99999999999 or length(trim(coalesce(p_data->>'conditions',''))) not between 1 and 2000 or coalesce(p_data->>'output_language','') not in ('es','en') then raise sqlstate 'PT422' using message='INITIAL_PAYMENT_INVALID';end if;
  h:=encode(sha256(convert_to((case when stage_no is null then jsonb_build_object('amount_minor',a,'conditions',p_data->>'conditions','output_language',p_data->>'output_language') else jsonb_build_object('amount_minor',a,'conditions',p_data->>'conditions','output_language',p_data->>'output_language','stage_position',stage_no,'evidence_document_id',p_data->>'evidence_document_id') end)::text,'UTF8')),'hex');
  if v.id is not null then
   if v.command_hash<>h then raise sqlstate 'PT409' using message='INITIAL_PAYMENT_ALREADY_CREATED';end if;
   return to_jsonb(v);
  end if;
  if stage_no is not null then
   select * into st from public.project_start_stages where project_id=p.id and owner_id=p_owner and position=stage_no;
   if not found or a<>round(st.amount*100)::bigint or p_data->>'conditions'<>st.payment_condition then raise sqlstate 'PT422' using message='PLAN_STAGE_AMOUNT_MISMATCH';end if;
   if exists(select 1 from public.project_received_payments r where r.project_id=p.id and r.origin='initial'
    and not exists(select 1 from public.project_initial_checkouts linked where linked.id=r.id and linked.stage_position is not null))
   then raise sqlstate 'PT409' using message='PLAN_LEGACY_PAYMENT_REQUIRES_REVIEW';end if;
   if exists(select 1 from public.project_initial_checkouts where project_id=p.id and stage_position is null)
   then raise sqlstate 'PT409' using message='PLAN_LEGACY_PAYMENT_REQUIRES_REVIEW';end if;
   if exists(select 1 from public.project_start_stages prev where prev.project_id=p.id and prev.position<stage_no
    and not exists(select 1 from public.project_initial_checkouts paid where paid.project_id=p.id and paid.stage_position=prev.position and paid.status='completed'))
   then raise sqlstate 'PT409' using message='PLAN_PREVIOUS_STAGE_UNPAID';end if;
   evidence:=(p_data->>'evidence_document_id')::uuid;gen:=p_data->>'evidence_generation';
   if evidence is null or gen is null or not exists(select 1 from public.document_upload_contexts x join public.documents d on d.id=x.document_id
    where x.document_id=evidence and x.project_id=p.id and x.owner_id=p_owner and x.stage_position=stage_no and x.purpose='delivery_evidence' and d.deleted_at is null and exists(select 1 from public.document_extractions e where e.document_id=d.id and e.status='ready'))
    or not exists(select 1 from public.file_processing_artifacts f where f.document_id=evidence and f.source_generation=gen and f.stage='treatment' and f.artifact->>'decision'='continue')
    or not exists(select 1 from public.file_processing_artifacts f where f.document_id=evidence and f.source_generation=gen and f.stage='summary')
   then raise sqlstate 'PT409' using message='PLAN_EVIDENCE_NOT_READY';end if;
  elsif exists(select 1 from public.project_start_plans where project_id=p.id) then
   raise sqlstate 'PT409' using message='PLAN_STAGE_REQUIRED';
  end if;
  if p.status not in ('draft','active') then raise sqlstate 'PT409' using message='PROJECT_NOT_ACTIVE';end if;
  if stage_no is null and exists(select 1 from public.project_received_payments where project_id=p.id and origin='initial') then raise sqlstate 'PT409' using message='INITIAL_PAYMENT_ALREADY_RECEIVED';end if;
  if exists(select 1 from public.project_start_plans where project_id=p.id and round(budget*100)<a) then raise sqlstate 'PT422' using message='INITIAL_PAYMENT_EXCEEDS_BUDGET';end if;
  if nullif(trim(c.contact_email),'') is null then raise sqlstate 'PT422' using message='CLIENT_EMAIL_REQUIRED';end if;
  insert into public.project_initial_checkouts(project_id,owner_id,request_key,command_hash,amount_minor,conditions,output_language,merchant_id,payer_email,recipient_email,client_name,project_name,checkout_token,stage_position,evidence_document_id,evidence_generation)
  values(p.id,p_owner,(p_data->>'request_key')::uuid,h,a,p_data->>'conditions',p_data->>'output_language',p_data->>'merchant_id',p_data->>'payer_email',c.contact_email,c.name,p.name,p_data->>'token',stage_no,evidence,gen) returning * into v;
  insert into public.project_initial_checkout_events(checkout_id,kind) values(v.id,'requested');
  return to_jsonb(v);
 end if;
 if v.id is null then raise sqlstate 'PT404' using message='INITIAL_PAYMENT_NOT_FOUND';end if;
 if p_action='claim_create' then
  if v.order_id is not null or v.status='completed' then return to_jsonb(v)||'{"acquired":false}';end if;
  -- PayPal's default idempotency window is six hours. Never repeat beyond it.
  if v.created_at<now()-interval '5 hours' then raise sqlstate 'PT409' using message='INITIAL_ORDER_RECONCILIATION_REQUIRED';end if;
  if v.create_lease_until>now() then raise sqlstate 'PT409' using message='INITIAL_PAYMENT_BUSY';end if;
  update public.project_initial_checkouts set create_lease_until=now()+interval '2 minutes',updated_at=now() where id=v.id returning * into v;
  return to_jsonb(v)||'{"acquired":true}';
 elsif p_action='claim_capture' then
  if v.status='completed' then return to_jsonb(v)||'{"acquired":false}';end if;
  if v.status not in ('approved','capturing') or v.capture_lease_until>now() then raise sqlstate 'PT409' using message='INITIAL_PAYMENT_BUSY';end if;
  update public.project_initial_checkouts set status='capturing',capture_lease_until=now()+interval '2 minutes',updated_at=now() where id=v.id returning * into v;
  return to_jsonb(v)||'{"acquired":true}';
 elsif p_action='apply' then
  if v.order_id is not null and v.order_id<>p_data->>'order_id' then raise sqlstate 'PT409' using message='PAYMENT_EVIDENCE_MISMATCH';end if;
  if v.status='completed' then return to_jsonb(v);end if;
  if (p_data->>'amount_minor')::bigint<>v.amount_minor or p_data->>'merchant_id'<>v.merchant_id or p_data->>'currency'<>'USD' then raise sqlstate 'PT409' using message='PAYMENT_EVIDENCE_MISMATCH';end if;
  if p_data->>'status'='completed' then
   if nullif(p_data->>'capture_id','') is null then raise sqlstate 'PT409' using message='PAYMENT_EVIDENCE_MISMATCH';end if;
   select * into existing from public.project_received_payments where capture_id=p_data->>'capture_id';
   if found then raise sqlstate 'PT409' using message='PAYMENT_EVIDENCE_MISMATCH';end if;
   insert into public.project_received_payments(id,owner_id,project_id,origin,capture_id,order_id,merchant_id,amount_minor,currency,verified_at,evidence,review_notes)
   values(v.id,p_owner,p.id,'initial',p_data->>'capture_id',p_data->>'order_id',v.merchant_id,v.amount_minor,'USD',now(),'[]'::jsonb,v.conditions);
   insert into public.project_initial_checkout_events(checkout_id,kind) values(v.id,'paid');
  end if;
  update public.project_initial_checkouts set status=p_data->>'status',order_id=p_data->>'order_id',capture_id=p_data->>'capture_id',approval_url=coalesce(p_data->>'approval_url',approval_url),last_error=null,create_lease_until=null,
   paid_at=case when p_data->>'status'='completed' then now() else null end,updated_at=now() where id=v.id returning * into v;
  if v.status='completed' and v.stage_position is not null and not exists(select 1 from public.project_start_stages final_stage where final_stage.project_id=p.id
    and not exists(select 1 from public.project_initial_checkouts paid where paid.project_id=p.id and paid.stage_position=final_stage.position and paid.status='completed'))
  then update public.project_start_plans set completed_at=coalesce(completed_at,now()) where project_id=p.id;end if;
 elsif p_action='uncertain' then
  if v.status<>'completed' then update public.project_initial_checkouts set last_error=p_data->>'code',create_lease_until=null,updated_at=now() where id=v.id returning * into v;end if;
 elsif p_action='mail_claim' then
  if v.status not in ('pending_approval','approved','pending') or v.order_id is null then raise sqlstate 'PT409' using message='INITIAL_PAYMENT_NOT_READY';end if;
  if v.mail_status='sent' then return to_jsonb(v)||'{"acquired":false}';end if;
  if v.mail_status in ('sending','uncertain') then raise sqlstate 'PT409' using message='EMAIL_DELIVERY_UNCERTAIN';end if;
  update public.project_initial_checkouts set mail_status='sending',mail_sender=p_data->>'sender',mail_digest=p_data->>'digest',updated_at=now() where id=v.id returning * into v;
  return to_jsonb(v)||'{"acquired":true}';
 elsif p_action='mail_finish' then
  if v.mail_status<>'sending' then raise sqlstate 'PT409' using message='INITIAL_PAYMENT_BUSY';end if;
  update public.project_initial_checkouts set mail_status=p_data->>'status',mail_message_id=p_data->>'message_id',mail_thread_id=p_data->>'thread_id',updated_at=now() where id=v.id returning * into v;
  if v.mail_status='sent' then insert into public.project_initial_checkout_events(checkout_id,kind) values(v.id,'email_sent');end if;
 else raise sqlstate 'PT422' using message='INVALID_REQUEST';
 end if;
 return to_jsonb(v);
end $$;
revoke all on function public.initial_checkout_backend(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.initial_checkout_backend(uuid,text,jsonb) to service_role;


notify pgrst,'reload schema';
commit;
