-- PayPal invoice for a Work plan deliverable (stage payment), issued by TeTrato after the freelancer confirms.
-- Same rule as addenda: additive columns default to Orders; one collection path per stage payment; an invoice row is
-- never created, captured or applied through Orders, and only PayPal's verified capture completes it.

alter table public.project_initial_checkouts
  add column if not exists method text not null default 'order',
  add column if not exists invoice_id text,
  add column if not exists invoice_number text,
  add column if not exists invoice_url text,
  add column if not exists retired_order_id text;

do $$
begin
 if not exists(select 1 from pg_constraint where conname='project_initial_checkouts_method_check') then
  alter table public.project_initial_checkouts add constraint project_initial_checkouts_method_check check(method in('order','invoice'));
 end if;
 if not exists(select 1 from pg_constraint where conname='project_initial_checkouts_invoice_shape') then
  alter table public.project_initial_checkouts add constraint project_initial_checkouts_invoice_shape check(
   (method='order' and invoice_id is null and invoice_number is null and invoice_url is null and retired_order_id is null)
   or (method='invoice' and order_id is null and stage_position is not null and invoice_number ~ '^TR-[A-Z0-9]{10}$'
       and (invoice_url is null or invoice_url ~ '^https://www\.sandbox\.paypal\.com/invoice/p/#[A-Za-z0-9-]{1,64}$')));
 end if;
end $$;

create unique index if not exists project_initial_checkouts_invoice_id_key on public.project_initial_checkouts(invoice_id) where invoice_id is not null;
create unique index if not exists project_initial_checkouts_invoice_number_key on public.project_initial_checkouts(invoice_number) where invoice_number is not null;

-- Orders commands leave invoice rows alone; Trato's own payment email may carry the invoice link.
do $$
declare definition text; patched text;
begin
 definition:=pg_get_functiondef('public.initial_checkout_backend(uuid,text,jsonb)'::regprocedure);
 if position('PAYMENT_METHOD_INVOICE' in definition)>0 then return; end if;
 patched:=replace(definition,
  $a$if v.order_id is not null or v.status='completed' then return to_jsonb(v)||'{"acquired":false}';end if;$a$,
  $b$if v.order_id is not null or v.status='completed' or v.method='invoice' then return to_jsonb(v)||'{"acquired":false}';end if;$b$);
 if patched=definition then raise exception 'initial_checkout_backend: claim_create anchor not found'; end if;
 definition:=patched;
 patched:=replace(definition,
  $a$elsif p_action='claim_capture' then$a$,
  $b$elsif p_action='claim_capture' then
  if v.method='invoice' then raise sqlstate 'PT409' using message='PAYMENT_METHOD_INVOICE';end if;$b$);
 if patched=definition then raise exception 'initial_checkout_backend: claim_capture anchor not found'; end if;
 definition:=patched;
 patched:=replace(definition,
  $a$elsif p_action='apply' then$a$,
  $b$elsif p_action='apply' then
  if v.method='invoice' then raise sqlstate 'PT409' using message='PAYMENT_METHOD_INVOICE';end if;$b$);
 if patched=definition then raise exception 'initial_checkout_backend: apply anchor not found'; end if;
 definition:=patched;
 patched:=replace(definition,
  $a$if v.status not in ('pending_approval','approved','pending') or v.order_id is null then raise sqlstate 'PT409' using message='INITIAL_PAYMENT_NOT_READY';end if;$a$,
  $b$if v.status not in ('pending_approval','approved','pending') or v.order_id is null and v.invoice_url is null then raise sqlstate 'PT409' using message='INITIAL_PAYMENT_NOT_READY';end if;$b$);
 if patched=definition then raise exception 'initial_checkout_backend: mail_claim anchor not found'; end if;
 execute patched;
end $$;

create or replace function private.stage_invoice_backend(p_owner uuid,p_action text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.projects;v public.project_initial_checkouts;existing public.project_received_payments;
begin
 if p_owner is null then raise sqlstate 'PT403' using message='OWNER_REQUIRED'; end if;
 if p_action='claim' then
  if coalesce(p_data->>'invoice_number','') !~ '^TR-[A-Z0-9]{10}$' then raise sqlstate 'PT422' using message='INVALID_INVOICE_NUMBER'; end if;
  select * into p from public.projects where id=(p_data->>'project_id')::uuid and owner_id=p_owner and deleted_at is null for update;
  if not found then raise sqlstate 'PT404' using message='PROJECT_NOT_FOUND'; end if;
  if p.status='closed' then raise sqlstate 'PT409' using message='PROJECT_NOT_ACTIVE'; end if;
  -- The stage payment is prepared first (delivery evidence, order and amount from the plan); the invoice replaces its order.
  select * into v from public.project_initial_checkouts where project_id=p.id and owner_id=p_owner and stage_position=(p_data->>'stage_position')::integer for update;
  if not found then raise sqlstate 'PT404' using message='INITIAL_PAYMENT_NOT_FOUND'; end if;
  if v.status='completed' then return to_jsonb(v)||jsonb_build_object('acquired',false); end if;
  if v.method='invoice' then
   -- Only an invoice not yet delivered is retried; it keeps its number so PayPal cannot create a second one.
   return to_jsonb(v)||jsonb_build_object('acquired',v.invoice_url is null);
  end if;
  if v.capture_lease_until is not null or not(v.status in('pending_approval','failed','cancelled')
     or v.status='creating' and v.order_id is null and (v.create_lease_until is null or v.create_lease_until<now())) then
   raise sqlstate 'PT409' using message='PAYMENT_IN_PROGRESS';
  end if;
  update public.project_initial_checkouts set method='invoice',retired_order_id=v.order_id,order_id=null,approval_url=null,status='creating',
   invoice_number=p_data->>'invoice_number',last_error=null,create_lease_until=null,updated_at=now() where id=v.id returning * into v;
  return to_jsonb(v)||jsonb_build_object('acquired',true);
 end if;
 if p_action not in('record','apply','uncertain') then raise sqlstate 'PT422' using message='INVALID_BACKEND_COMMAND'; end if;
 select * into v from public.project_initial_checkouts where id=(p_data->>'payment_id')::uuid and owner_id=p_owner;
 if not found or v.method<>'invoice' then raise sqlstate 'PT404' using message='PAYMENT_NOT_FOUND'; end if;
 select * into p from public.projects where id=v.project_id and owner_id=p_owner and deleted_at is null for update;
 select * into v from public.project_initial_checkouts where id=v.id for update;
 if v.status='completed' then return to_jsonb(v); end if;
 if p_action='uncertain' then
  update public.project_initial_checkouts set last_error=p_data->>'error_code',updated_at=now() where id=v.id returning * into v;
  return to_jsonb(v);
 end if;
 if nullif(p_data->>'invoice_id','') is null or v.invoice_id is not null and v.invoice_id<>p_data->>'invoice_id' then
  raise sqlstate 'PT409' using message='PAYMENT_EVIDENCE_MISMATCH';
 end if;
 if p_action='record' then
  update public.project_initial_checkouts set invoice_id=p_data->>'invoice_id',invoice_url=p_data->>'invoice_url',status='pending_approval',last_error=null,updated_at=now()
   where id=v.id returning * into v;
  return to_jsonb(v);
 end if;
 -- apply: the same bookkeeping as a verified Orders capture of this stage.
 if (p_data->>'amount_minor')::bigint<>v.amount_minor or p_data->>'currency'<>'USD' or p_data->>'merchant_id'<>v.merchant_id then
  raise sqlstate 'PT409' using message='PAYMENT_EVIDENCE_MISMATCH';
 end if;
 if nullif(p_data->>'capture_id','') is null then raise sqlstate 'PT409' using message='CAPTURE_EVIDENCE_REQUIRED'; end if;
 select * into existing from public.project_received_payments where capture_id=p_data->>'capture_id';
 if found then raise sqlstate 'PT409' using message='PAYMENT_EVIDENCE_MISMATCH'; end if;
 insert into public.project_received_payments(id,owner_id,project_id,origin,capture_id,order_id,merchant_id,amount_minor,currency,verified_at,evidence,review_notes)
  values(v.id,p_owner,p.id,'initial',p_data->>'capture_id',null,v.merchant_id,v.amount_minor,'USD',now(),'[]'::jsonb,v.conditions);
 insert into public.project_initial_checkout_events(checkout_id,kind) values(v.id,'paid');
 update public.project_initial_checkouts set invoice_id=p_data->>'invoice_id',status='completed',capture_id=p_data->>'capture_id',last_error=null,paid_at=now(),updated_at=now()
  where id=v.id returning * into v;
 if not exists(select 1 from public.project_start_stages final_stage where final_stage.project_id=p.id
   and not exists(select 1 from public.project_initial_checkouts paid where paid.project_id=p.id and paid.stage_position=final_stage.position and paid.status='completed'))
 then update public.project_start_plans set completed_at=coalesce(completed_at,now()) where project_id=p.id; end if;
 return to_jsonb(v);
end $$;

create or replace function public.stage_invoice_backend(p_owner uuid,p_action text,p_data jsonb)
returns jsonb language sql set search_path='' as $$select private.stage_invoice_backend(p_owner,p_action,p_data)$$;

revoke all on function private.stage_invoice_backend(uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.stage_invoice_backend(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.stage_invoice_backend(uuid,text,jsonb) to service_role;
grant execute on function private.stage_invoice_backend(uuid,text,jsonb) to service_role;
