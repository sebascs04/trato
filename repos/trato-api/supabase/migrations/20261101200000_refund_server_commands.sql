begin;
create function private.refund_backend(p_owner uuid,p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
<<backend>>
declare saved jsonb;digest text;parent public.refund_settlements;snap public.refund_snapshots;a public.refund_artifacts;m public.refund_deliveries;d public.documents;pay public.project_received_payments;project uuid;ctx jsonb;
begin
 if p_action='register_initial' then
  project:=(p_data->>'project_id')::uuid;perform private.ensure_active_project(project,p_owner);
  perform 1 from public.projects where id=project and owner_id=p_owner for update;
  digest:=encode(sha256(convert_to(jsonb_build_object('initial',p_data)::text,'UTF8')),'hex');
  insert into private.refund_commands(owner_id,idempotency_key,command_hash) values(p_owner,p_data->>'operation_key',digest) on conflict do nothing;
  select c.result into saved from private.refund_commands c where c.owner_id=p_owner and c.idempotency_key=p_data->>'operation_key' and c.command_hash=digest for update;
  if not found then raise sqlstate 'PT409' using message='IDEMPOTENCY_KEY_CONFLICT';end if;
  if saved is not null then return saved;end if;
  if private.refund_can_register(project,p_owner) is false then raise sqlstate 'PT409' using message='PROJECT_HAS_OPEN_REQUEST';end if;
  perform private.refund_evidence(p_data->'evidence',project,p_owner);
  select * into pay from public.project_received_payments where capture_id=p_data->>'capture_id';
  if found then
   if pay.owner_id<>p_owner or pay.project_id<>project or pay.origin<>'initial' or pay.amount_minor<>(p_data->>'amount_minor')::bigint or pay.merchant_id<>p_data->>'merchant_id' then raise sqlstate 'PT409' using message='REFUND_PAYMENT_CONTEXT_MISMATCH';end if;
  else
  insert into public.project_received_payments(owner_id,project_id,origin,capture_id,order_id,merchant_id,amount_minor,currency,verified_at,evidence,review_notes)
  values(p_owner,project,'initial',p_data->>'capture_id',p_data->>'order_id',p_data->>'merchant_id',private.refund_money(p_data->'amount_minor'),'USD',now(),p_data->'evidence',private.refund_text(p_data->'notes')) returning * into pay;
  end if;
  saved:=jsonb_build_object('payment',to_jsonb(pay),'project_id',project);
  update private.refund_commands set result=backend.saved where owner_id=p_owner and idempotency_key=p_data->>'operation_key';
  return saved;
 end if;
 select * into parent from public.refund_settlements where id=(p_data->>'settlement_id')::uuid and owner_id=p_owner;
 if not found then raise sqlstate 'PT404' using message='REFUND_NOT_FOUND';end if;
 perform private.ensure_active_project(parent.project_id,p_owner);
 perform 1 from public.projects where id=parent.project_id and owner_id=p_owner for update;
 select * into parent from public.refund_settlements where id=parent.id for update;
 select * into snap from public.refund_snapshots where id=(p_data->>'snapshot_id')::uuid and settlement_id=parent.id and owner_id=p_owner;
 if not found then raise sqlstate 'PT404' using message='REFUND_SNAPSHOT_NOT_FOUND';end if;
 select * into a from public.refund_artifacts where snapshot_id=snap.id;
 if not found then raise sqlstate 'PT409' using message='REFUND_PDF_REQUIRED';end if;
 if p_action='attach_pdf' then
  if parent.current_snapshot_id<>snap.id or parent.status<>'draft' then raise sqlstate 'PT409' using message='REFUND_REVISION_CONFLICT';end if;
  select * into d from public.documents where id=(p_data->>'document_id')::uuid and project_id=parent.project_id and owner_id=p_owner;
  if not found or d.sha256 is distinct from p_data->>'sha256' or not exists(select 1 from storage.objects where bucket_id='project-documents' and name=d.storage_path and (metadata->>'size')::bigint=d.size_bytes) then raise sqlstate 'PT409' using message='REFUND_PDF_HASH_MISMATCH';end if;
  if a.document_id is not null and (a.document_id<>d.id or a.sha256<>d.sha256) then raise sqlstate 'PT409' using message='REFUND_HISTORY_IMMUTABLE';end if;
  update public.refund_artifacts set document_id=d.id,sha256=d.sha256 where id=a.id returning * into a;return to_jsonb(a);
 elsif p_action='mail_reserve' then
  select * into m from public.refund_deliveries where owner_id=p_owner and operation_key=p_data->>'operation_key';
  if found then
   if m.snapshot_id<>snap.id or m.message_hash<>p_data->>'message_hash' or m.recipient<>p_data->>'recipient' or m.sender<>p_data->>'sender' then raise sqlstate 'PT409' using message='EMAIL_PREVIEW_CHANGED';end if;
   return to_jsonb(m)||jsonb_build_object('acquired',false);
  end if;
  if parent.current_snapshot_id<>snap.id or parent.status<>'draft' or a.document_id is null or not exists(select 1 from public.refund_reviews where snapshot_id=snap.id and artifact_id=a.id) then raise sqlstate 'PT409' using message='REFUND_REVIEW_REQUIRED';end if;
  if exists(select 1 from public.refund_deliveries where snapshot_id=snap.id and status in('sending','accepted_by_gmail','delivery_uncertain')) then raise sqlstate 'PT409' using message='EMAIL_DELIVERY_UNCERTAIN';end if;
  if not exists(select 1 from public.projects p join public.clients c on c.id=p.client_id and c.owner_id=p.owner_id where p.id=parent.project_id and c.contact_email=p_data->>'recipient') then raise sqlstate 'PT409' using message='EMAIL_PREVIEW_CHANGED';end if;
  insert into public.refund_deliveries(snapshot_id,settlement_id,project_id,owner_id,artifact_id,operation_key,recipient,sender,message_hash,message_preview,status)
  values(snap.id,parent.id,parent.project_id,p_owner,a.id,p_data->>'operation_key',p_data->>'recipient',p_data->>'sender',p_data->>'message_hash',p_data->'preview','sending') returning * into m;
  return to_jsonb(m)||jsonb_build_object('acquired',true);
 elsif p_action='mail_finish' then
  select * into m from public.refund_deliveries where id=(p_data->>'delivery_id')::uuid and snapshot_id=snap.id and owner_id=p_owner for update;
  if not found then raise sqlstate 'PT404' using message='REFUND_DELIVERY_NOT_FOUND';end if;
  if m.status='accepted_by_gmail' then return to_jsonb(m);end if;
  if m.status not in('sending','delivery_uncertain') or p_data->>'status' is null or p_data->>'status' not in('accepted_by_gmail','failed','delivery_uncertain') then raise sqlstate 'PT409' using message='REFUND_DELIVERY_CONFLICT';end if;
  if p_data->>'status'='accepted_by_gmail' and nullif(p_data->>'message_id','') is null then raise sqlstate 'PT409' using message='REFUND_DELIVERY_CONFLICT';end if;
  update public.refund_deliveries set status=p_data->>'status',provider_message_id=p_data->>'message_id',provider_thread_id=p_data->>'thread_id',error_code=p_data->>'error_code',updated_at=now() where id=m.id returning * into m;
  if m.status='accepted_by_gmail' then
   if parent.current_snapshot_id<>snap.id then raise sqlstate 'PT409' using message='REFUND_REVISION_CONFLICT';end if;
   update public.refund_settlements set status='awaiting_response',updated_at=now() where id=parent.id;
   insert into public.refund_events(settlement_id,snapshot_id,project_id,owner_id,actor_id,event_type) values(parent.id,snap.id,parent.project_id,p_owner,p_owner,'revision_sent');
  end if;
  return to_jsonb(m);
 elsif p_action='response_record' then
  select * into m from public.refund_deliveries where id=(p_data->>'delivery_id')::uuid and snapshot_id=snap.id and owner_id=p_owner and status='accepted_by_gmail';
  if not found or lower(m.recipient)<>lower(p_data->>'from_email') then raise sqlstate 'PT409' using message='REFUND_EVIDENCE_MISMATCH';end if;
  insert into public.refund_client_responses(delivery_id,snapshot_id,settlement_id,project_id,owner_id,provider_message_id,from_email,body_text,body_sha256,received_at,attachments,raw_message)
  values(m.id,snap.id,parent.id,parent.project_id,p_owner,p_data->>'provider_message_id',p_data->>'from_email',p_data->>'body_text',encode(sha256(convert_to(p_data->>'body_text','UTF8')),'hex'),(p_data->>'received_at')::timestamptz,p_data->'attachments',p_data->'raw_message') on conflict(owner_id,provider_message_id) do nothing;
  return jsonb_build_object('recorded',true);
 end if;
 raise sqlstate 'PT422' using message='INVALID_REFUND_ACTION';
end $$;
create function public.refund_backend(p_owner uuid,p_action text,p_data jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.refund_backend(p_owner,p_action,p_data)$$;
revoke all on function private.refund_backend(uuid,text,jsonb),public.refund_backend(uuid,text,jsonb) from public,anon,authenticated,service_role;
grant usage on schema private to service_role;
grant execute on function private.refund_backend(uuid,text,jsonb),public.refund_backend(uuid,text,jsonb) to service_role;
commit;
