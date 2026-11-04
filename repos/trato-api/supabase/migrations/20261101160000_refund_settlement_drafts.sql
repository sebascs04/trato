-- Draft settlement persistence only. No provider, mail or financial authorization.
begin;
alter table public.proposal_payments add constraint refund_payment_identity unique(id,project_id,owner_id);
create table public.refund_settlements (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
 project_id uuid not null, payment_id uuid not null,
 scope text not null check(scope='payment_only'), reason text not null check(length(trim(reason)) between 1 and 4000),
 requested_by text not null check(requested_by in('customer','seller','mutual')),
 request_evidence jsonb not null check(jsonb_typeof(request_evidence)='array'),
 status text not null default 'draft' check(status in('draft','awaiting_response','adjustments_requested','accepted','refund_pending','completed','closed_without_refund','rejected','withdrawn')),
 current_snapshot_id uuid, closed_at timestamptz, closure_notes text,
 confirmed_refund_minor bigint check(confirmed_refund_minor between 1 and 99999999999),
 check((status='completed')=(confirmed_refund_minor is not null)),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(id,project_id,owner_id),
 foreign key(project_id,owner_id) references public.projects(id,owner_id),
 foreign key(payment_id,project_id,owner_id) references public.proposal_payments(id,project_id,owner_id)
);
create unique index refund_one_open_project on public.refund_settlements(project_id)
 where status not in('completed','closed_without_refund','rejected','withdrawn');
create index refund_payment_idx on public.refund_settlements(payment_id,project_id,owner_id);
create index refund_owner_idx on public.refund_settlements(owner_id,project_id,created_at);
create table public.refund_snapshots (
 id uuid primary key default gen_random_uuid(), settlement_id uuid not null, project_id uuid not null, owner_id uuid not null,
 version_no integer not null default 1 check(version_no>0), draft_sequence integer not null check(draft_sequence>0),
 previous_snapshot_id uuid, terms jsonb not null, breakdown jsonb not null,
 content_sha256 text not null check(content_sha256 ~ '^[a-f0-9]{64}$'), created_at timestamptz not null default now(),
 unique(id,settlement_id,project_id,owner_id), unique(settlement_id,version_no,draft_sequence),
 foreign key(settlement_id,project_id,owner_id) references public.refund_settlements(id,project_id,owner_id),
 foreign key(previous_snapshot_id,settlement_id,project_id,owner_id) references public.refund_snapshots(id,settlement_id,project_id,owner_id)
);
alter table public.refund_settlements add foreign key(current_snapshot_id,id,project_id,owner_id)
 references public.refund_snapshots(id,settlement_id,project_id,owner_id);
create index refund_current_idx on public.refund_settlements(current_snapshot_id,id,project_id,owner_id);
create index refund_previous_idx on public.refund_snapshots(previous_snapshot_id,settlement_id,project_id,owner_id);
create table public.refund_sources (
 id uuid primary key default gen_random_uuid(), settlement_id uuid not null, snapshot_id uuid,
 project_id uuid not null, owner_id uuid not null, document_id uuid not null, extraction_id uuid not null,
 document_sha256 text not null, extraction_result_hash text not null, quote text not null,
 foreign key(settlement_id,project_id,owner_id) references public.refund_settlements(id,project_id,owner_id),
 foreign key(snapshot_id,settlement_id,project_id,owner_id) references public.refund_snapshots(id,settlement_id,project_id,owner_id),
 foreign key(extraction_id,document_id,project_id,owner_id) references public.document_extractions(id,document_id,project_id,owner_id)
);
create index refund_sources_snapshot_idx on public.refund_sources(snapshot_id,settlement_id,project_id,owner_id);
create index refund_sources_parent_idx on public.refund_sources(settlement_id,project_id,owner_id);
create index refund_sources_extraction_idx on public.refund_sources(extraction_id,document_id,project_id,owner_id);
create table public.refund_events (
 id uuid primary key default gen_random_uuid(), settlement_id uuid not null, snapshot_id uuid,
 project_id uuid not null, owner_id uuid not null, actor_id uuid not null references auth.users(id),
 event_type text not null check(event_type in('request_registered','draft_saved','rejected','withdrawn')),
 notes text, created_at timestamptz not null default now(),
 foreign key(settlement_id,project_id,owner_id) references public.refund_settlements(id,project_id,owner_id),
 foreign key(snapshot_id,settlement_id,project_id,owner_id) references public.refund_snapshots(id,settlement_id,project_id,owner_id)
);
create index refund_events_parent_idx on public.refund_events(settlement_id,project_id,owner_id,created_at);
create index refund_events_snapshot_idx on public.refund_events(snapshot_id,settlement_id,project_id,owner_id);
create table private.refund_commands (
 owner_id uuid not null references auth.users(id), idempotency_key text not null,
 command_hash text not null, result jsonb, primary key(owner_id,idempotency_key)
);
alter table private.refund_commands enable row level security;
revoke all on private.refund_commands from public,anon,authenticated;
do $$declare t text;begin
 foreach t in array array['refund_settlements','refund_snapshots','refund_sources','refund_events'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy own_active_refund on public.%I for select to authenticated using(owner_id=(select auth.uid()) and exists(select 1 from public.projects p join public.clients c on c.id=p.client_id and c.owner_id=p.owner_id where p.id=%I.project_id and p.owner_id=%I.owner_id and p.deleted_at is null and c.deleted_at is null))',t,t,t);
 end loop;
end $$;
create function private.refund_immutable() returns trigger language plpgsql set search_path='' as $$
begin raise sqlstate 'PT409' using message='REFUND_HISTORY_IMMUTABLE';end $$;
revoke all on function private.refund_immutable() from public,anon,authenticated;
create trigger refund_snapshot_immutable before update or delete on public.refund_snapshots for each row execute function private.refund_immutable();
create trigger refund_source_immutable before update or delete on public.refund_sources for each row execute function private.refund_immutable();
create trigger refund_event_immutable before update or delete on public.refund_events for each row execute function private.refund_immutable();

-- Strict JSON boundary: required keys + explicit optional keys. No client financial facts.
create function private.refund_object(j jsonb, required text[], optional text[] default array[]::text[])
returns void language plpgsql set search_path='' as $$
begin
 if jsonb_typeof(j) is distinct from 'object' or not (j ?& required)
 or exists(select 1 from jsonb_object_keys(j) k where not k=any(required||optional))
 then raise sqlstate 'PT422' using message='INVALID_REFUND_INPUT';end if;
end $$;
create function private.refund_text(j jsonb) returns text language plpgsql set search_path='' as $$
begin
 if jsonb_typeof(j) is distinct from 'string' or length(trim(j#>>'{}')) not between 1 and 4000
 then raise sqlstate 'PT422' using message='INVALID_REFUND_INPUT';end if;
 return trim(j#>>'{}');
end $$;
create function private.refund_money(j jsonb) returns bigint language plpgsql set search_path='' as $$
begin
 if jsonb_typeof(j) is distinct from 'number' or (j#>>'{}') !~ '^[0-9]{1,11}$'
 or (j#>>'{}')::bigint>99999999999 then raise sqlstate 'PT422' using message='INVALID_REFUND_AMOUNT';end if;
 return (j#>>'{}')::bigint;
end $$;
create function private.refund_evidence(j jsonb, project uuid, actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c jsonb; d public.documents; e public.document_extractions; facts jsonb:='[]';q text;
begin
 if jsonb_typeof(j) is distinct from 'array' or jsonb_array_length(j) not between 1 and 20
 then raise sqlstate 'PT422' using message='REFUND_EVIDENCE_REQUIRED';end if;
 for c in select value from jsonb_array_elements(j) loop
  perform private.refund_object(c,array['document_id','extraction_id','document_sha256','quote']);
  q:=private.refund_text(c->'quote');
  if q is distinct from c->>'quote' then raise sqlstate 'PT422' using message='INVALID_REFUND_INPUT';end if;
  select * into d from public.documents where id=(c->>'document_id')::uuid and owner_id=actor and project_id=project for share;
  if not found or d.sha256 is distinct from c->>'document_sha256' then raise sqlstate 'PT409' using message='REFUND_EVIDENCE_MISMATCH';end if;
  select * into e from public.document_extractions where id=(c->>'extraction_id')::uuid and document_id=d.id and owner_id=actor and project_id=project for share;
  if not found or e.status<>'ready' or e.result_hash is null
  or not exists(select 1 from public.document_segments s where s.extraction_id=e.id and s.owner_id=actor and s.project_id=project and position(q in s.text)>0)
  then raise sqlstate 'PT409' using message='REFUND_EVIDENCE_MISMATCH';end if;
  facts:=facts||jsonb_build_array(c||jsonb_build_object('extraction_result_hash',e.result_hash));
 end loop;
 return facts;
end $$;
create function private.refund_save_sources(facts jsonb, parent public.refund_settlements, snapshot uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 insert into public.refund_sources(settlement_id,snapshot_id,project_id,owner_id,document_id,extraction_id,document_sha256,extraction_result_hash,quote)
 select parent.id,snapshot,parent.project_id,parent.owner_id,(x->>'document_id')::uuid,(x->>'extraction_id')::uuid,x->>'document_sha256',x->>'extraction_result_hash',x->>'quote'
 from jsonb_array_elements(facts) x;
end $$;
-- Returns the same local-only breakdown as prepare_settlement(); not a provider check.
create function private.refund_prepare(terms jsonb, gross bigint, previous bigint, project uuid, actor uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare item jsonb; pct jsonb; amount bigint; retained bigint:=0;credit bigint:=0;entitlement bigint; refund bigint;
 concepts uuid[]:='{}';concept uuid;facts jsonb:='[]';base bigint;bps bigint;
begin
 perform private.refund_object(terms,array['currency','adjustments','proposed_refund_minor','conditions']);
 perform private.refund_text(terms->'conditions');
 if terms->>'currency' is distinct from 'USD' or jsonb_typeof(terms->'adjustments') is distinct from 'array'
 or jsonb_array_length(terms->'adjustments')>100 then raise sqlstate 'PT422' using message='INVALID_REFUND_INPUT';end if;
 for item in select value from jsonb_array_elements(terms->'adjustments') loop
  perform private.refund_object(item,array['concept_id','kind','beneficiary','description','amount_minor','evidence'],array['percentage']);
  perform private.refund_text(item->'description');
  concept:=(item->>'concept_id')::uuid;
  if concept is null or concept=any(concepts) then raise sqlstate 'PT422' using message='REFUND_DUPLICATE_CONCEPT';end if;
  concepts:=array_append(concepts,concept);
  if (item->>'kind') is null or (item->>'kind') not in('recognized_work','expense','penalty','other')
  or (item->>'beneficiary') is null or (item->>'beneficiary') not in('seller','customer')
  or (item->>'kind'='recognized_work' and item->>'beneficiary'<>'seller') then raise sqlstate 'PT422' using message='INVALID_REFUND_INPUT';end if;
  amount:=private.refund_money(item->'amount_minor');
  if amount=0 then raise sqlstate 'PT422' using message='INVALID_REFUND_AMOUNT';end if;
  pct:=item->'percentage';
  if pct is not null and pct<>'null'::jsonb then
   perform private.refund_object(pct,array['base_minor','basis_points']);
   base:=private.refund_money(pct->'base_minor');bps:=private.refund_money(pct->'basis_points');
   if base=0 or bps not between 1 and 10000 or (base*bps+5000)/10000<>amount
   then raise sqlstate 'PT422' using message='REFUND_PERCENTAGE_MISMATCH';end if;
  end if;
  facts:=facts||private.refund_evidence(item->'evidence',project,actor);
  if item->>'beneficiary'='seller' then retained:=retained+amount;else credit:=credit+amount;end if;
 end loop;
 if greatest(retained,credit)>99999999999 then raise sqlstate 'PT422' using message='REFUND_AMOUNT_OVERFLOW';end if;
 entitlement:=gross-retained+credit;
 if previous>gross or (previous>0 and entitlement<previous) then raise sqlstate 'PT409' using message='REFUND_PRIOR_SETTLEMENT_CONFLICT';end if;
 refund:=greatest(entitlement-previous,0);
 if refund>gross-previous then raise sqlstate 'PT409' using message='REFUND_EXCEEDS_AVAILABLE';end if;
 if private.refund_money(terms->'proposed_refund_minor')<>refund then raise sqlstate 'PT409' using message='REFUND_PROPOSAL_AMOUNT_MISMATCH';end if;
 return jsonb_build_object('facts',facts,'breakdown',jsonb_build_object('currency','USD','gross_minor',gross,
  'local_previous_refunds_minor',previous,'seller_retention_minor',retained,'customer_credit_minor',credit,
  'refund_minor',refund,'additional_payment_due_minor',greatest(-entitlement,0),
  'original_fee_minor',null,'provider_remaining_minor',null,'provider_verified',false,'financial_execution_ready',false));
end $$;

-- Extend the existing gate rather than maintain a second independent request list.
alter function private.project_request_status(uuid) rename to project_change_request_status;
create function private.project_request_status(p_project_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; active jsonb;
begin
 result:=private.project_change_request_status(p_project_id);
 select jsonb_build_object('id',id,'kind','refund','title',reason) into active from public.refund_settlements
 where project_id=p_project_id and owner_id=auth.uid() and status not in('completed','closed_without_refund','rejected','withdrawn') order by created_at,id limit 1;
 if active is not null then result:=result||jsonb_build_object('can_register',false,'active_request',active);end if;
 return result;
end $$;
-- Rebind the SQL wrapper; the old SQL function may have dependencies by OID.
create or replace function public.project_request_status(p_project_id uuid) returns jsonb
language sql security invoker set search_path='' as $$select private.project_request_status(p_project_id)$$;

create function private.refund_command(p_action text,p_data jsonb,p_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
<<command>>
declare actor uuid:=auth.uid();project uuid;parent public.refund_settlements;pay public.proposal_payments;
 prior public.refund_snapshots; snap public.refund_snapshots; digest text; result jsonb; facts jsonb; prepared jsonb;previous bigint;
begin
 if actor is null or not exists(select 1 from auth.users where id=actor and deleted_at is null and not coalesce(is_anonymous,false))
 then raise sqlstate 'PT401' using message='UNAUTHORIZED';end if;
 if p_action is null or p_action not in('create','edit_draft','close') or p_key is null or p_key !~ '^[!-~]{1,128}$'
 or jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>2000000
 then raise sqlstate 'PT422' using message='INVALID_REFUND_INPUT';end if;
 if p_action='create' then
  perform private.refund_object(p_data,array['project_id','payment_id','scope','reason','requested_by','request_evidence']);
  project:=(p_data->>'project_id')::uuid;
 else
  select * into parent from public.refund_settlements where id=(p_data->>'settlement_id')::uuid and owner_id=actor;
  if not found then raise sqlstate 'PT404' using message='REFUND_NOT_FOUND';end if;
  project:=parent.project_id;
 end if;
 perform private.ensure_active_project(project,actor);
 -- Every ingestion/refund writer takes the project lock first, then payment and parent.
 perform 1 from public.projects where id=project and owner_id=actor for update;
 digest:=encode(sha256(convert_to(jsonb_build_object('action',p_action,'data',p_data)::text,'UTF8')),'hex');
 insert into private.refund_commands(owner_id,idempotency_key,command_hash) values(actor,p_key,digest) on conflict do nothing;
 select c.result into result from private.refund_commands c where c.owner_id=actor and c.idempotency_key=p_key and c.command_hash=digest for update;
 if not found then raise sqlstate 'PT409' using message='IDEMPOTENCY_KEY_CONFLICT';end if;
 if result is not null then return result;end if;
 if p_action='create' then
  if (private.project_request_status(project)->>'can_register')::boolean is false then raise sqlstate 'PT409' using message='PROJECT_HAS_OPEN_REQUEST';end if;
  if p_data->>'scope' is distinct from 'payment_only' or (p_data->>'requested_by') is null
   or (p_data->>'requested_by') not in('customer','seller','mutual') then raise sqlstate 'PT422' using message='INVALID_REFUND_INPUT';end if;
  select * into pay from public.proposal_payments where id=(p_data->>'payment_id')::uuid and project_id=project and owner_id=actor for update;
  if not found then raise sqlstate 'PT404' using message='PAYMENT_NOT_FOUND';end if;
  if pay.status<>'completed' or nullif(trim(pay.capture_id),'') is null or pay.currency<>'USD'
   then raise sqlstate 'PT409' using message='REFUND_PAYMENT_NOT_ELIGIBLE';end if;
  facts:=private.refund_evidence(p_data->'request_evidence',project,actor);
  insert into public.refund_settlements(owner_id,project_id,payment_id,scope,reason,requested_by,request_evidence)
  values(actor,project,pay.id,'payment_only',private.refund_text(p_data->'reason'),p_data->>'requested_by',p_data->'request_evidence') returning * into parent;
  perform private.refund_save_sources(facts,parent,null);
  insert into public.refund_events(settlement_id,project_id,owner_id,actor_id,event_type) values(parent.id,project,actor,actor,'request_registered');
  result:=jsonb_build_object('settlement',to_jsonb(parent));
 else
  select * into pay from public.proposal_payments where id=parent.payment_id and owner_id=actor for update;
  select * into parent from public.refund_settlements where id=parent.id and owner_id=actor for update;
  if parent.status<>'draft' then raise sqlstate 'PT409' using message='REFUND_SETTLEMENT_READ_ONLY';end if;
  if p_action='close' then
   perform private.refund_object(p_data,array['settlement_id','reason','notes']);
   if p_data->>'reason' is null or p_data->>'reason' not in('rejected','withdrawn') then raise sqlstate 'PT422' using message='INVALID_REFUND_INPUT';end if;
   update public.refund_settlements set status=p_data->>'reason',closed_at=now(),closure_notes=private.refund_text(p_data->'notes'),updated_at=now()
   where id=parent.id returning * into parent;
   insert into public.refund_events(settlement_id,project_id,owner_id,actor_id,event_type,notes)
   values(parent.id,project,actor,actor,parent.status,parent.closure_notes);
   result:=jsonb_build_object('settlement',to_jsonb(parent));
  else
   perform private.refund_object(p_data,array['settlement_id','expected_snapshot_id','terms']);
   if parent.current_snapshot_id is distinct from (p_data->>'expected_snapshot_id')::uuid then raise sqlstate 'PT409' using message='REFUND_REVISION_CONFLICT';end if;
   if pay.status<>'completed' or nullif(trim(pay.capture_id),'') is null then raise sqlstate 'PT409' using message='REFUND_PAYMENT_NOT_ELIGIBLE';end if;
   perform private.refund_evidence(parent.request_evidence,project,actor);
   -- Initial request evidence must still be ready and match its original extraction result.
   if exists(select 1 from public.refund_sources s join public.document_extractions e on e.id=s.extraction_id join public.documents d on d.id=s.document_id
    where s.settlement_id=parent.id and s.snapshot_id is null and (d.sha256<>s.document_sha256 or e.result_hash is distinct from s.extraction_result_hash or e.status<>'ready'))
   then raise sqlstate 'PT409' using message='REFUND_EVIDENCE_MISMATCH';end if;
   select coalesce(sum(confirmed_refund_minor),0) into previous from public.refund_settlements where payment_id=pay.id and status='completed';
   prepared:=private.refund_prepare(p_data->'terms',pay.amount_minor,previous,project,actor);
   select * into prior from public.refund_snapshots where id=parent.current_snapshot_id;
   insert into public.refund_snapshots(settlement_id,project_id,owner_id,version_no,draft_sequence,previous_snapshot_id,terms,breakdown,content_sha256)
   values(parent.id,project,actor,coalesce(prior.version_no,1),coalesce(prior.draft_sequence,0)+1,prior.id,p_data->'terms',prepared->'breakdown',
    encode(sha256(convert_to(jsonb_build_object('terms',p_data->'terms','breakdown',prepared->'breakdown','facts',prepared->'facts')::text,'UTF8')),'hex')) returning * into snap;
   perform private.refund_save_sources(prepared->'facts',parent,snap.id);
   update public.refund_settlements set current_snapshot_id=snap.id,updated_at=now() where id=parent.id returning * into parent;
   insert into public.refund_events(settlement_id,snapshot_id,project_id,owner_id,actor_id,event_type) values(parent.id,snap.id,project,actor,actor,'draft_saved');
   result:=jsonb_build_object('settlement',to_jsonb(parent),'snapshot',to_jsonb(snap));
  end if;
 end if;
 update private.refund_commands set result=command.result where owner_id=actor and idempotency_key=p_key;
 return result;
exception when invalid_text_representation or numeric_value_out_of_range then
 raise sqlstate 'PT422' using message='INVALID_REFUND_INPUT';
end $$;
create function public.refund_command(p_action text,p_data jsonb,p_key text) returns jsonb
language sql security invoker set search_path='' as $$select private.refund_command(p_action,p_data,p_key)$$;

-- Explicitly revoke helper invocation, including by RPC-capable authenticated users.
revoke all on function private.refund_object(jsonb,text[],text[]),private.refund_text(jsonb),private.refund_money(jsonb),
 private.refund_evidence(jsonb,uuid,uuid),private.refund_save_sources(jsonb,public.refund_settlements,uuid),
 private.refund_prepare(jsonb,bigint,bigint,uuid,uuid),private.refund_command(text,jsonb,text),public.refund_command(text,jsonb,text)
 from public,anon,authenticated;
grant execute on function private.refund_command(text,jsonb,text),public.refund_command(text,jsonb,text) to authenticated;
revoke all on function private.project_request_status(uuid) from public,anon;
grant execute on function private.project_request_status(uuid) to authenticated;
commit;
