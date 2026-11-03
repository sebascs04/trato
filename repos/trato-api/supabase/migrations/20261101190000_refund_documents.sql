begin;
create table public.refund_artifacts(
 id uuid primary key default gen_random_uuid(),snapshot_id uuid not null unique,settlement_id uuid not null,project_id uuid not null,owner_id uuid not null,
 language text not null check(language in('es','en')),render_context jsonb not null,
 document_id uuid,sha256 text,created_at timestamptz not null default now(),
 unique(id,snapshot_id,settlement_id,project_id,owner_id),
 foreign key(snapshot_id,settlement_id,project_id,owner_id) references public.refund_snapshots(id,settlement_id,project_id,owner_id),
 foreign key(document_id,project_id,owner_id) references public.documents(id,project_id,owner_id),
 check((document_id is null)=(sha256 is null)),check(sha256 is null or sha256 ~ '^[a-f0-9]{64}$')
);
create table public.refund_reviews(
 snapshot_id uuid primary key,settlement_id uuid not null,project_id uuid not null,owner_id uuid not null,
 artifact_id uuid not null,reviewer_id uuid not null references auth.users(id),review_notes text not null,created_at timestamptz not null default now(),
 foreign key(artifact_id,snapshot_id,settlement_id,project_id,owner_id) references public.refund_artifacts(id,snapshot_id,settlement_id,project_id,owner_id)
);
create table public.refund_deliveries(
 id uuid primary key default gen_random_uuid(),snapshot_id uuid not null,settlement_id uuid not null,project_id uuid not null,owner_id uuid not null,
 artifact_id uuid not null,operation_key text not null,recipient text not null,sender text not null,message_hash text not null,
 message_preview jsonb not null,
 status text not null check(status in('sending','accepted_by_gmail','failed','delivery_uncertain')),
 provider_message_id text,provider_thread_id text,error_code text,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(owner_id,operation_key),unique(id,snapshot_id,settlement_id,project_id,owner_id),
 foreign key(artifact_id,snapshot_id,settlement_id,project_id,owner_id) references public.refund_artifacts(id,snapshot_id,settlement_id,project_id,owner_id)
);
create unique index refund_one_live_delivery on public.refund_deliveries(snapshot_id) where status in('sending','accepted_by_gmail','delivery_uncertain');
create table public.refund_client_responses(
 id uuid primary key default gen_random_uuid(),delivery_id uuid not null,snapshot_id uuid not null,settlement_id uuid not null,project_id uuid not null,owner_id uuid not null,
 provider_message_id text not null,from_email text not null,body_text text not null,body_sha256 text not null,received_at timestamptz not null,attachments jsonb not null default '[]',raw_message jsonb not null default '{}',
 created_at timestamptz not null default now(),unique(owner_id,provider_message_id),
 foreign key(delivery_id,snapshot_id,settlement_id,project_id,owner_id) references public.refund_deliveries(id,snapshot_id,settlement_id,project_id,owner_id)
);
create table public.refund_acceptances(
 snapshot_id uuid primary key,settlement_id uuid not null,project_id uuid not null,owner_id uuid not null,
 artifact_id uuid not null,evidence jsonb not null,reviewer_id uuid not null references auth.users(id),review_notes text not null,
 method text not null check(method='manual_document_review'),cryptographic_signature_verified boolean not null default false check(not cryptographic_signature_verified),created_at timestamptz not null default now(),
 foreign key(artifact_id,snapshot_id,settlement_id,project_id,owner_id) references public.refund_artifacts(id,snapshot_id,settlement_id,project_id,owner_id)
);
do $$declare t text;begin
 foreach t in array array['refund_artifacts','refund_reviews','refund_deliveries','refund_client_responses','refund_acceptances'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy own_refund_document on public.%I for select to authenticated using(exists(select 1 from public.refund_settlements r where r.id=settlement_id and r.owner_id=(select auth.uid())))',t);
  execute format('create index %I on public.%I(settlement_id,project_id,owner_id)',t||'_parent_idx',t);
  if t not in('refund_artifacts','refund_deliveries') then execute format('create trigger immutable_record before update or delete on public.%I for each row execute function private.refund_immutable()',t);end if;
 end loop;
end $$;
create index refund_artifact_document_idx on public.refund_artifacts(document_id,project_id,owner_id);
create index refund_review_artifact_idx on public.refund_reviews(artifact_id,snapshot_id,settlement_id,project_id,owner_id);
create index refund_delivery_artifact_idx on public.refund_deliveries(artifact_id,snapshot_id,settlement_id,project_id,owner_id);
create index refund_response_delivery_idx on public.refund_client_responses(delivery_id,snapshot_id,settlement_id,project_id,owner_id);
create index refund_acceptance_artifact_idx on public.refund_acceptances(artifact_id,snapshot_id,settlement_id,project_id,owner_id);
create function private.refund_document_evidence(j jsonb,parent public.refund_settlements,snapshot uuid,feedback boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.documents;r public.refund_client_responses;begin
 if jsonb_typeof(j) is distinct from 'object' then raise sqlstate 'PT422' using message='REFUND_EVIDENCE_REQUIRED';end if;
 if j ? 'email_id' then
  perform private.refund_object(j,array['email_id']);
  select * into r from public.refund_client_responses where id=(j->>'email_id')::uuid and snapshot_id=snapshot and settlement_id=parent.id and owner_id=parent.owner_id;
  if not found then raise sqlstate 'PT409' using message='REFUND_EVIDENCE_MISMATCH';end if;
  return jsonb_build_object('email_id',r.id,'body_sha256',r.body_sha256,'snapshot_id',snapshot);
 end if;
 if feedback then
  j:=(private.refund_evidence(jsonb_build_array(j),parent.project_id,parent.owner_id))->0;
 else
  perform private.refund_object(j,array['document_id','document_sha256']);
 end if;
 select * into d from public.documents where id=(j->>'document_id')::uuid and project_id=parent.project_id and owner_id=parent.owner_id for share;
 if not found or d.sha256 is distinct from j->>'document_sha256' or d.mime_type<>'application/pdf'
 or exists(select 1 from public.refund_artifacts where document_id=d.id)
 or not exists(select 1 from storage.objects where bucket_id='project-documents' and name=d.storage_path and (metadata->>'size')::bigint=d.size_bytes)
 then raise sqlstate 'PT409' using message='REFUND_EVIDENCE_MISMATCH';end if;
 return j||jsonb_build_object('snapshot_id',snapshot,'method','manual_document_review');
end $$;
revoke all on function private.refund_document_evidence(jsonb,public.refund_settlements,uuid,boolean) from public,anon,authenticated;

create or replace function private.refund_command(p_action text,p_data jsonb,p_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
<<command>>
declare actor uuid:=auth.uid();project uuid;parent public.refund_settlements;pay public.project_received_payments;
 prior public.refund_snapshots;snap public.refund_snapshots;artifact public.refund_artifacts;
 digest text;result jsonb;facts jsonb;prepared jsonb;previous bigint:=0;gross bigint:=0;payments jsonb:='[]';ids uuid[];allocation jsonb;total bigint:=0;amount bigint;feedback jsonb;new_version boolean:=false;
begin
 if actor is null or not exists(select 1 from auth.users where id=actor and deleted_at is null and not coalesce(is_anonymous,false)) then raise sqlstate 'PT401' using message='UNAUTHORIZED';end if;
 if p_action is null or p_action not in('create','edit_draft','close','reserve_pdf','review_pdf','feedback','accept') or p_key is null or p_key !~ '^[!-~]{1,128}$' or jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>2000000 then raise sqlstate 'PT422' using message='INVALID_REFUND_INPUT';end if;
 if p_action='create' then project:=(p_data->>'project_id')::uuid;
 else
  select * into parent from public.refund_settlements where id=(p_data->>'settlement_id')::uuid and owner_id=actor;
  if not found then raise sqlstate 'PT404' using message='REFUND_NOT_FOUND';end if;project:=parent.project_id;
 end if;
 perform private.ensure_active_project(project,actor);
 perform 1 from public.projects where id=project and owner_id=actor for update;
 digest:=encode(sha256(convert_to(jsonb_build_object('action',p_action,'data',p_data)::text,'UTF8')),'hex');
 insert into private.refund_commands(owner_id,idempotency_key,command_hash) values(actor,p_key,digest) on conflict do nothing;
 select c.result into result from private.refund_commands c where c.owner_id=actor and c.idempotency_key=p_key and c.command_hash=digest for update;
 if not found then raise sqlstate 'PT409' using message='IDEMPOTENCY_KEY_CONFLICT';end if;if result is not null then return result;end if;
 if p_action='create' then
  perform private.refund_object(p_data,array['project_id','scope','reason','requested_by','request_evidence'],array['payment_id','payment_ids','payments_reviewed']);
  if (private.project_request_status(project)->>'can_register')::boolean is false then raise sqlstate 'PT409' using message='PROJECT_HAS_OPEN_REQUEST';end if;
  if p_data->>'scope'='payment_only' then ids:=array[(p_data->>'payment_id')::uuid];
  elsif p_data->>'scope'='project_closure' then
   if p_data->'payments_reviewed' is distinct from 'true'::jsonb then raise sqlstate 'PT422' using message='REFUND_PAYMENTS_REVIEW_REQUIRED';end if;
   if jsonb_typeof(p_data->'payment_ids') is distinct from 'array' or jsonb_array_length(p_data->'payment_ids') not between 1 and 100 then raise sqlstate 'PT422' using message='INVALID_REFUND_INPUT';end if;
   select array_agg(value::uuid order by value) into ids from jsonb_array_elements_text(p_data->'payment_ids');
   if cardinality(ids)<>(select count(*) from public.project_received_payments where project_id=project and owner_id=actor)
    or exists(select id from public.project_received_payments where project_id=project and owner_id=actor except select unnest(ids))
   then raise sqlstate 'PT409' using message='REFUND_PAYMENTS_CHANGED';end if;
  else raise sqlstate 'PT422' using message='INVALID_REFUND_INPUT';end if;
  if array_position(ids,null) is not null or cardinality(ids)<>(select count(distinct x) from unnest(ids) x) then raise sqlstate 'PT422' using message='INVALID_REFUND_INPUT';end if;
  if (p_data->>'requested_by') is null or p_data->>'requested_by' not in('customer','seller','mutual') then raise sqlstate 'PT422' using message='INVALID_REFUND_INPUT';end if;
  for pay in select * from public.project_received_payments where id=any(ids) and project_id=project and owner_id=actor order by id for update loop
   if exists(select 1 from public.project_received_payments q where q.id=any(ids) and (q.merchant_id<>pay.merchant_id or q.currency<>pay.currency)) then raise sqlstate 'PT409' using message='REFUND_PAYMENT_CONTEXT_MISMATCH';end if;
   if pay.origin='change' and not exists(select 1 from public.proposal_payments where id=pay.proposal_payment_id and status='completed' and capture_id=pay.capture_id and amount_minor=pay.amount_minor and merchant_id=pay.merchant_id) then raise sqlstate 'PT409' using message='REFUND_PAYMENT_NOT_ELIGIBLE';end if;
   total:=total+1;
  end loop;
  if total<>cardinality(ids) then raise sqlstate 'PT404' using message='PAYMENT_NOT_FOUND';end if;
  facts:=private.refund_evidence(p_data->'request_evidence',project,actor);
  insert into public.refund_settlements(owner_id,project_id,payment_id,scope,reason,requested_by,request_evidence)
   values(actor,project,ids[1],p_data->>'scope',private.refund_text(p_data->'reason'),p_data->>'requested_by',p_data->'request_evidence') returning * into parent;
  insert into public.refund_settlement_payments select parent.id,x,project,actor from unnest(ids) x;
  perform private.refund_save_sources(facts,parent,null);
  insert into public.refund_events(settlement_id,project_id,owner_id,actor_id,event_type) values(parent.id,project,actor,actor,'request_registered');
  result:=jsonb_build_object('settlement',to_jsonb(parent));
 else
  perform 1 from public.project_received_payments where id in(select payment_id from public.refund_settlement_payments where settlement_id=parent.id) order by id for update;
  select * into parent from public.refund_settlements where id=parent.id for update;
  if p_action in('accept','feedback') then perform private.refund_object(p_data,array['settlement_id','expected_snapshot_id','confirmed','notes','evidence']);
  elsif p_action='review_pdf' then perform private.refund_object(p_data,array['settlement_id','expected_snapshot_id','confirmed','notes']);
  elsif p_action='reserve_pdf' then perform private.refund_object(p_data,array['settlement_id','expected_snapshot_id','language']);end if;
  select * into prior from public.refund_snapshots where id=parent.current_snapshot_id;
  if p_action in('edit_draft','close') and parent.status not in('draft','adjustments_requested') then raise sqlstate 'PT409' using message='REFUND_SETTLEMENT_READ_ONLY';end if;
  if p_action<>'close' and parent.current_snapshot_id is distinct from (p_data->>'expected_snapshot_id')::uuid then raise sqlstate 'PT409' using message='REFUND_REVISION_CONFLICT';end if;
  if p_action in('edit_draft','close') then
   if parent.status not in('draft','adjustments_requested') or exists(select 1 from public.refund_deliveries where snapshot_id=prior.id and status in('sending','accepted_by_gmail','delivery_uncertain') and parent.status<>'adjustments_requested') then raise sqlstate 'PT409' using message='REFUND_SETTLEMENT_READ_ONLY';end if;
   if parent.scope='project_closure' and exists(select id from public.project_received_payments where project_id=project and owner_id=actor except select payment_id from public.refund_settlement_payments where settlement_id=parent.id) then raise sqlstate 'PT409' using message='REFUND_PAYMENTS_CHANGED';end if;
   if p_action='close' then
    perform private.refund_object(p_data,array['settlement_id','reason','notes']);
    if p_data->>'reason' is null or p_data->>'reason' not in('rejected','withdrawn') then raise sqlstate 'PT422' using message='INVALID_REFUND_INPUT';end if;
    update public.refund_settlements set status=p_data->>'reason',closed_at=now(),closure_notes=private.refund_text(p_data->'notes'),updated_at=now() where id=parent.id returning * into parent;
    insert into public.refund_events(settlement_id,project_id,owner_id,actor_id,event_type,notes) values(parent.id,project,actor,actor,parent.status,parent.closure_notes);
    result:=jsonb_build_object('settlement',to_jsonb(parent));
   else
    perform private.refund_object(p_data,array['settlement_id','expected_snapshot_id','terms']);
    perform private.refund_evidence(parent.request_evidence,project,actor);
    if exists(select 1 from public.refund_sources s join public.document_extractions e on e.id=s.extraction_id join public.documents d on d.id=s.document_id where s.settlement_id=parent.id and s.snapshot_id is null and (d.sha256<>s.document_sha256 or e.result_hash is distinct from s.extraction_result_hash or e.status<>'ready')) then raise sqlstate 'PT409' using message='REFUND_EVIDENCE_MISMATCH';end if;
    for pay in select q.* from public.project_received_payments q join public.refund_settlement_payments m on m.payment_id=q.id where m.settlement_id=parent.id order by q.id loop
     previous:=previous+private.refund_previous(pay.id);gross:=gross+pay.amount_minor;
     if parent.scope='payment_only' then allocation:=jsonb_build_object('refund_minor',p_data->'terms'->'proposed_refund_minor');
     else
      if jsonb_typeof(p_data->'terms'->'allocations') is distinct from 'array' then raise sqlstate 'PT422' using message='REFUND_ALLOCATION_REQUIRED';end if;
      if (select count(*) from jsonb_array_elements(p_data->'terms'->'allocations') a where a->>'payment_id'=pay.id::text)<>1 then raise sqlstate 'PT422' using message='REFUND_ALLOCATION_REQUIRED';end if;
      select a into allocation from jsonb_array_elements(p_data->'terms'->'allocations') a where a->>'payment_id'=pay.id::text;
      perform private.refund_object(allocation,array['payment_id','refund_minor']);
     end if;
     amount:=private.refund_money(allocation->'refund_minor');
     if amount>pay.amount_minor-private.refund_previous(pay.id) then raise sqlstate 'PT409' using message='REFUND_EXCEEDS_AVAILABLE';end if;
     total:=total+amount;
     payments:=payments||jsonb_build_array(jsonb_build_object('payment_id',pay.id,'origin',pay.origin,'capture_id',pay.capture_id,'merchant_id',pay.merchant_id,'amount_minor',pay.amount_minor,'currency',pay.currency,'local_previous_refunds_minor',private.refund_previous(pay.id),'refund_minor',amount));
    end loop;
    if parent.scope='project_closure' and jsonb_array_length(p_data->'terms'->'allocations')<>jsonb_array_length(payments) then raise sqlstate 'PT422' using message='REFUND_ALLOCATION_REQUIRED';end if;
    if gross>99999999999 then raise sqlstate 'PT422' using message='REFUND_AMOUNT_OVERFLOW';end if;
    prepared:=private.refund_prepare((p_data->'terms')-'allocations',gross,previous,project,actor);
    if total<>(prepared->'breakdown'->>'refund_minor')::bigint then raise sqlstate 'PT409' using message='REFUND_ALLOCATION_MISMATCH';end if;
    new_version:=parent.status='adjustments_requested';
    feedback:=prior.feedback;
    if new_version then
     select evidence into feedback from public.refund_feedback where snapshot_id=prior.id;
     if not found then raise sqlstate 'PT409' using message='REFUND_FEEDBACK_REQUIRED';end if;
    end if;
    if feedback is not null and not (feedback ? 'email_id') then
      facts:=private.refund_evidence(jsonb_build_array(feedback-array['snapshot_id','method','extraction_result_hash']),project,actor);
      if facts->0->>'extraction_result_hash' is distinct from feedback->>'extraction_result_hash' then raise sqlstate 'PT409' using message='REFUND_EVIDENCE_MISMATCH';end if;
    end if;
    insert into public.refund_snapshots(settlement_id,project_id,owner_id,version_no,draft_sequence,previous_snapshot_id,terms,breakdown,payments,feedback,content_sha256)
    values(parent.id,project,actor,case when new_version then prior.version_no+1 else coalesce(prior.version_no,1) end,case when new_version then 1 else coalesce(prior.draft_sequence,0)+1 end,prior.id,p_data->'terms',prepared->'breakdown',payments,feedback,encode(sha256(convert_to(jsonb_build_object('terms',p_data->'terms','breakdown',prepared->'breakdown','payments',payments,'facts',prepared->'facts','feedback',feedback)::text,'UTF8')),'hex')) returning * into snap;
    perform private.refund_save_sources(prepared->'facts',parent,snap.id);
    update public.refund_settlements set current_snapshot_id=snap.id,status='draft',updated_at=now() where id=parent.id returning * into parent;
    insert into public.refund_events(settlement_id,snapshot_id,project_id,owner_id,actor_id,event_type) values(parent.id,snap.id,project,actor,actor,'draft_saved');
    result:=jsonb_build_object('settlement',to_jsonb(parent),'snapshot',to_jsonb(snap));
   end if;
  elsif p_action='reserve_pdf' then
   perform private.refund_object(p_data,array['settlement_id','expected_snapshot_id','language']);
   if prior.id is null or p_data->>'language' is null or p_data->>'language' not in('es','en') then raise sqlstate 'PT422' using message='INVALID_REFUND_INPUT';end if;
   select * into artifact from public.refund_artifacts where snapshot_id=prior.id;
   if not found then
    if parent.status<>'draft' then raise sqlstate 'PT409' using message='REFUND_SETTLEMENT_READ_ONLY';end if;
    insert into public.refund_artifacts(snapshot_id,settlement_id,project_id,owner_id,language,render_context)
    select prior.id,parent.id,project,actor,p_data->>'language',jsonb_build_object('project_name',p.name,'client_name',c.name,'snapshot',to_jsonb(prior)||jsonb_build_object('payments',case when jsonb_array_length(prior.payments)>0 then prior.payments else (select jsonb_agg(jsonb_build_object('payment_id',q.id,'capture_id',q.capture_id,'amount_minor',q.amount_minor,'refund_minor',(prior.breakdown->>'refund_minor')::bigint,'origin',q.origin,'currency',q.currency)) from public.project_received_payments q where q.id=parent.payment_id and parent.scope='payment_only') end),
     'request_evidence',parent.request_evidence,'scope',parent.scope,
     'feedback_text',case when prior.feedback ? 'email_id' then (select body_text from public.refund_client_responses where id=(prior.feedback->>'email_id')::uuid and settlement_id=parent.id) else prior.feedback->>'quote' end)
    from public.projects p join public.clients c on c.id=p.client_id and c.owner_id=p.owner_id where p.id=project and p.owner_id=actor returning * into artifact;
   elsif artifact.language<>p_data->>'language' then raise sqlstate 'PT409' using message='REFUND_PDF_LANGUAGE_LOCKED';end if;
   result:=jsonb_build_object('settlement',to_jsonb(parent),'artifact',to_jsonb(artifact));
  elsif p_action='review_pdf' then
   perform private.refund_object(p_data,array['settlement_id','expected_snapshot_id','confirmed','notes']);
   if p_data->'confirmed' is distinct from 'true'::jsonb or parent.status<>'draft' then raise sqlstate 'PT409' using message='REFUND_REVIEW_REQUIRED';end if;
   select * into artifact from public.refund_artifacts where snapshot_id=prior.id and document_id is not null;
   if not found then raise sqlstate 'PT409' using message='REFUND_PDF_REQUIRED';end if;
   insert into public.refund_reviews(snapshot_id,settlement_id,project_id,owner_id,artifact_id,reviewer_id,review_notes) values(prior.id,parent.id,project,actor,artifact.id,actor,private.refund_text(p_data->'notes')) on conflict(snapshot_id) do nothing;
   insert into public.refund_events(settlement_id,snapshot_id,project_id,owner_id,actor_id,event_type) values(parent.id,prior.id,project,actor,actor,'pdf_reviewed');
   result:=jsonb_build_object('settlement',to_jsonb(parent));
  else
   perform private.refund_object(p_data,array['settlement_id','expected_snapshot_id','confirmed','notes','evidence']);
   if parent.status<>'awaiting_response' or p_data->'confirmed' is distinct from 'true'::jsonb
   or not exists(select 1 from public.refund_deliveries where snapshot_id=prior.id and status='accepted_by_gmail') then raise sqlstate 'PT409' using message='REFUND_SEND_REQUIRED';end if;
   select * into artifact from public.refund_artifacts where snapshot_id=prior.id and document_id is not null;
   if not found then raise sqlstate 'PT409' using message='REFUND_PDF_REQUIRED';end if;
   facts:=private.refund_document_evidence(p_data->'evidence',parent,prior.id,p_action='feedback');
   if p_action='feedback' then
    insert into public.refund_feedback(snapshot_id,settlement_id,project_id,owner_id,evidence,reviewer_id,notes) values(prior.id,parent.id,project,actor,facts,actor,private.refund_text(p_data->'notes'));
    update public.refund_settlements set status='adjustments_requested',updated_at=now() where id=parent.id returning * into parent;
   else
    insert into public.refund_acceptances(snapshot_id,settlement_id,project_id,owner_id,artifact_id,evidence,reviewer_id,review_notes,method) values(prior.id,parent.id,project,actor,artifact.id,facts,actor,private.refund_text(p_data->'notes'),'manual_document_review');
    update public.refund_settlements set status=case when (prior.breakdown->>'refund_minor')::bigint=0 then 'closed_without_refund' else 'accepted' end,closed_at=case when (prior.breakdown->>'refund_minor')::bigint=0 then now() else null end,updated_at=now() where id=parent.id returning * into parent;
    if parent.scope='project_closure' and parent.status='closed_without_refund' then update public.projects set status='closed' where id=project;end if;
   end if;
   insert into public.refund_events(settlement_id,snapshot_id,project_id,owner_id,actor_id,event_type,notes) values(parent.id,prior.id,project,actor,actor,case when p_action='feedback' then 'adjustments_requested' else 'acceptance_recorded' end,private.refund_text(p_data->'notes'));
   result:=jsonb_build_object('settlement',to_jsonb(parent));
  end if;
 end if;
 update private.refund_commands set result=command.result where owner_id=actor and idempotency_key=p_key;
 return result;
exception when invalid_text_representation or numeric_value_out_of_range then raise sqlstate 'PT422' using message='INVALID_REFUND_INPUT';
end $$;
create table public.refund_feedback(
 snapshot_id uuid primary key,settlement_id uuid not null,project_id uuid not null,owner_id uuid not null,evidence jsonb not null,reviewer_id uuid not null references auth.users(id),notes text not null,created_at timestamptz not null default now(),
 foreign key(snapshot_id,settlement_id,project_id,owner_id) references public.refund_snapshots(id,settlement_id,project_id,owner_id)
);
alter table public.refund_feedback enable row level security;
revoke all on public.refund_feedback from public,anon,authenticated;
grant select on public.refund_feedback to authenticated;
create policy own_feedback on public.refund_feedback for select to authenticated using(exists(select 1 from public.refund_settlements r where r.id=settlement_id and r.owner_id=(select auth.uid())));
create trigger feedback_immutable before update or delete on public.refund_feedback for each row execute function private.refund_immutable();
commit;
