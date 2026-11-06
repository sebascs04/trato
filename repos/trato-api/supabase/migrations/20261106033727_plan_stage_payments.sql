begin;
alter table public.project_initial_checkouts drop constraint project_initial_checkouts_project_id_key;
alter table public.project_initial_checkouts add column stage_position integer, add column evidence_document_id uuid, add column evidence_generation text;
alter table public.project_initial_checkouts add constraint checkout_stage_fk foreign key(project_id,stage_position) references public.project_start_stages(project_id,position), add constraint checkout_evidence_fk foreign key(evidence_document_id,project_id,owner_id) references public.documents(id,project_id,owner_id), add constraint stage_checkout_evidence check(stage_position is null or (stage_position between 1 and 8 and evidence_document_id is not null and evidence_generation is not null));
create unique index stage_checkout_unique on public.project_initial_checkouts(project_id,stage_position) where stage_position is not null;
create unique index legacy_checkout_unique on public.project_initial_checkouts(project_id) where stage_position is null;
alter table public.document_upload_contexts add column stage_position integer;
alter table public.document_upload_contexts add constraint upload_stage_fk foreign key(project_id,stage_position) references public.project_start_stages(project_id,position), add constraint upload_stage_purpose check(stage_position is null or (purpose='delivery_evidence' and revision_id is null and refund_case_id is null and request_document_id is null));
alter table public.project_start_plans add column completed_at timestamptz, add column original_proposal jsonb;
create or replace function private.reserve_document_with_context(p_project_id uuid,p_title text,p_kind text,p_filename text,
 p_mime text,p_size integer,p_sha256 text,p_key text,p_context jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); result jsonb; ctx jsonb:=coalesce(p_context,'{}'); purpose text;
 request_id uuid; proposal uuid; revision uuid; refund uuid; snapshot uuid; payment uuid; stage_no integer;
 expected public.document_upload_contexts; actual public.document_upload_contexts;
begin
 if u is null then raise sqlstate 'PT401' using message='UNAUTHORIZED';end if;
 perform private.ensure_active_project(p_project_id,u);
 if jsonb_typeof(ctx)<>'object' or exists(select 1 from jsonb_object_keys(ctx) k where k not in('purpose','request_id','revision_id','refund_case_id','snapshot_id','payment_id','stage_position'))
 then raise sqlstate 'PT422' using message='FILE_PURPOSE_CONTEXT_INVALID';end if;
 purpose:=coalesce(ctx->>'purpose',case p_kind when 'initial_agreement' then 'initial_agreement' when 'email_request' then 'change_request'
  when 'delivery' then 'delivery_evidence' else 'supporting_reference' end);
 if purpose not in('initial_agreement','change_request','supporting_reference','delivery_evidence','addendum_adjustments','acceptance_evidence','generated_addendum','refund_request','refund_evidence')
 then raise sqlstate 'PT422' using message='FILE_PURPOSE_CONTEXT_INVALID';end if;
 begin
  request_id:=(ctx->>'request_id')::uuid;revision:=(ctx->>'revision_id')::uuid;
  refund:=(ctx->>'refund_case_id')::uuid;snapshot:=(ctx->>'snapshot_id')::uuid;payment:=(ctx->>'payment_id')::uuid;stage_no:=(ctx->>'stage_position')::integer;
 exception when invalid_text_representation then raise sqlstate 'PT422' using message='FILE_PURPOSE_CONTEXT_INVALID';end;
 if (purpose='initial_agreement' and p_kind<>'initial_agreement') or (purpose='change_request' and p_kind<>'email_request')
 or (purpose='delivery_evidence' and p_kind<>'delivery') or (purpose='supporting_reference' and p_kind<>'reference')
 or (purpose='addendum_adjustments' and (p_kind<>'reference' or revision is null))
 or (purpose in('acceptance_evidence','generated_addendum') and (p_kind not in('reference','addendum') or revision is null))
 or (purpose in('refund_request','refund_evidence') and p_kind not in('reference','addendum'))
 then raise sqlstate 'PT422' using message='FILE_PURPOSE_CONTEXT_INVALID';end if;
 if revision is not null then
  if purpose not in('addendum_adjustments','acceptance_evidence','generated_addendum') or refund is not null or snapshot is not null or payment is not null
  then raise sqlstate 'PT422' using message='FILE_PURPOSE_CONTEXT_INVALID';end if;
  select r.proposal_id,p.request_document_id into proposal,request_id from public.proposal_revisions r
   join public.change_proposals p on p.id=r.proposal_id and p.owner_id=r.owner_id and p.project_id=r.project_id
   where r.id=revision and r.project_id=p_project_id and r.owner_id=u;
  if not found or (ctx ? 'request_id' and (ctx->>'request_id')::uuid is distinct from request_id)
  then raise sqlstate 'PT409' using message='FILE_PURPOSE_CONTEXT_INVALID';end if;
 end if;
 if request_id is not null and not exists(select 1 from public.documents d where d.id=request_id and d.kind='email_request' and d.project_id=p_project_id and d.owner_id=u)
 then raise sqlstate 'PT409' using message='FILE_PURPOSE_CONTEXT_INVALID';end if;
 if purpose in('initial_agreement','change_request') and (request_id is not null or revision is not null or refund is not null or snapshot is not null or payment is not null)
 then raise sqlstate 'PT422' using message='FILE_PURPOSE_CONTEXT_INVALID';end if;
 if refund is not null or snapshot is not null or payment is not null then
  if purpose not in('refund_request','refund_evidence') or request_id is not null or revision is not null
  then raise sqlstate 'PT422' using message='FILE_PURPOSE_CONTEXT_INVALID';end if;
 end if;
 if refund is not null then
  select r.payment_id into payment from public.refund_settlements r where r.id=refund and r.project_id=p_project_id and r.owner_id=u;
  if not found or (ctx ? 'payment_id' and (ctx->>'payment_id')::uuid is distinct from payment)
  then raise sqlstate 'PT409' using message='FILE_PURPOSE_CONTEXT_INVALID';end if;
 end if;
 if snapshot is not null and (refund is null or not exists(select 1 from public.refund_snapshots s where s.id=snapshot and s.settlement_id=refund and s.project_id=p_project_id and s.owner_id=u))
 then raise sqlstate 'PT409' using message='FILE_PURPOSE_CONTEXT_INVALID';end if;
 if payment is not null and not exists(select 1 from public.project_received_payments p where p.id=payment and p.project_id=p_project_id and p.owner_id=u)
 then raise sqlstate 'PT409' using message='FILE_PURPOSE_CONTEXT_INVALID';end if;
 if stage_no is not null then
  if purpose<>'delivery_evidence' or p_kind<>'delivery' or stage_no not between 1 and 8
   or not exists(select 1 from public.project_start_stages where project_id=p_project_id and owner_id=u and position=stage_no)
  then raise sqlstate 'PT422' using message='PLAN_STAGE_INVALID';end if;
  if exists(select 1 from public.project_initial_checkouts where project_id=p_project_id and owner_id=u and stage_position=stage_no)
  then raise sqlstate 'PT409' using message='PLAN_STAGE_ALREADY_REQUESTED';end if;
 end if;
 -- Both records commit together, before any Storage POST or work publication.
 result:=private.reserve_document(p_project_id,p_title,p_kind,p_filename,p_mime,p_size,p_sha256,p_key);
 expected.document_id:=(result->'document'->>'id')::uuid;expected.project_id:=p_project_id;expected.owner_id:=u;expected.purpose:=purpose;
 expected.request_document_id:=case when purpose='change_request' then expected.document_id else request_id end;
 expected.proposal_id:=proposal;expected.revision_id:=revision;expected.refund_case_id:=refund;expected.snapshot_id:=snapshot;expected.payment_id:=payment;expected.stage_position:=stage_no;
 insert into public.document_upload_contexts(document_id,project_id,owner_id,purpose,request_document_id,proposal_id,revision_id,refund_case_id,snapshot_id,payment_id,stage_position)
 values(expected.document_id,p_project_id,u,purpose,expected.request_document_id,proposal,revision,refund,snapshot,payment,stage_no)
 on conflict(document_id) do nothing;
 select * into actual from public.document_upload_contexts where document_id=expected.document_id;
 if (to_jsonb(actual)-'created_at') is distinct from (to_jsonb(expected)-'created_at')
 then raise sqlstate 'PT409' using message='DOCUMENT_CONTEXT_CONFLICT';end if;
 return result;
end $$;
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
   if exists(select 1 from public.project_initial_checkouts where project_id=p.id and stage_position is null)
   then raise sqlstate 'PT409' using message='PLAN_LEGACY_PAYMENT_REQUIRES_REVIEW';end if;
   if exists(select 1 from public.project_start_stages prev where prev.project_id=p.id and prev.position<stage_no
    and not exists(select 1 from public.project_initial_checkouts paid where paid.project_id=p.id and paid.stage_position=prev.position and paid.status='completed'))
   then raise sqlstate 'PT409' using message='PLAN_PREVIOUS_STAGE_UNPAID';end if;
   evidence:=(p_data->>'evidence_document_id')::uuid;gen:=p_data->>'evidence_generation';
   if evidence is null or gen is null or not exists(select 1 from public.document_upload_contexts x join public.documents d on d.id=x.document_id
    where x.document_id=evidence and x.project_id=p.id and x.owner_id=p_owner and x.stage_position=stage_no and x.purpose='delivery_evidence' and exists(select 1 from public.document_extractions e where e.document_id=d.id and e.status='ready'))
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
  if v.status='completed' and v.stage_position is not null and not exists(select 1 from public.project_start_stages st where st.project_id=p.id
    and not exists(select 1 from public.project_initial_checkouts paid where paid.project_id=p.id and paid.stage_position=st.position and paid.status='completed'))
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

create function private.project_plan_progress(p_project uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();result jsonb;
begin
 if u is null then raise sqlstate 'PT401' using message='UNAUTHORIZED';end if;
 if not exists(select 1 from public.projects where id=p_project and owner_id=u and deleted_at is null) then raise sqlstate 'PT404' using message='PROJECT_NOT_FOUND';end if;
 select jsonb_build_object('completed_at',p.completed_at,'stages',coalesce((select jsonb_agg(jsonb_build_object('position',s.position,'payment_id',c.id,'status',c.status,'paid_at',c.paid_at,'evidence_document_id',c.evidence_document_id) order by s.position) from public.project_start_stages s left join public.project_initial_checkouts c on c.project_id=s.project_id and c.stage_position=s.position where s.project_id=p_project),'[]'::jsonb)) into result from public.project_start_plans p where project_id=p_project and owner_id=u;
 return result;
end $$;
revoke all on function private.project_plan_progress(uuid) from public,anon;
grant execute on function private.project_plan_progress(uuid) to authenticated;
create function public.project_plan_progress(p_project uuid) returns jsonb language sql security invoker set search_path='' as $$select private.project_plan_progress(p_project);$$;
revoke all on function public.project_plan_progress(uuid) from public,anon;
grant execute on function public.project_plan_progress(uuid) to authenticated;
create index upload_stage_lookup on public.document_upload_contexts(owner_id,project_id,stage_position) where stage_position is not null;
notify pgrst,'reload schema';
commit;
