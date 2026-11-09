-- PayPal invoice as the collection path of an accepted addendum, issued by TeTrato after the freelancer confirms.
-- Additive: existing rows keep method 'order' and the Orders checkout behaves exactly as before.
-- One collection path per acceptance: switching to an invoice retires the order, and an invoice row can never be
-- captured through Orders, so the client cannot pay twice.

alter table public.proposal_payments
  add column if not exists method text not null default 'order',
  add column if not exists invoice_id text,
  add column if not exists invoice_number text,
  add column if not exists invoice_url text,
  add column if not exists retired_order_id text;

do $$
begin
 if not exists(select 1 from pg_constraint where conname='proposal_payments_method_check') then
  alter table public.proposal_payments add constraint proposal_payments_method_check check(method in('order','invoice'));
 end if;
 if not exists(select 1 from pg_constraint where conname='proposal_payments_invoice_shape') then
  alter table public.proposal_payments add constraint proposal_payments_invoice_shape check(
   (method='order' and invoice_id is null and invoice_number is null and invoice_url is null and retired_order_id is null)
   or (method='invoice' and order_id is null and invoice_number ~ '^TR-[A-Z0-9]{10}$'
       and (invoice_url is null or invoice_url ~ '^https://www\.sandbox\.paypal\.com/invoice/p/#[A-Za-z0-9-]{1,64}$')));
 end if;
end $$;

create unique index if not exists proposal_payments_invoice_id_key on public.proposal_payments(invoice_id) where invoice_id is not null;
create unique index if not exists proposal_payments_invoice_number_key on public.proposal_payments(invoice_number) where invoice_number is not null;

-- Orders commands refuse an invoice row (a retired order the client approves later is never captured),
-- and the Trato payment email is only for Orders: PayPal itself emails the invoice.
do $$
declare definition text; patched text;
begin
 definition:=pg_get_functiondef('private.proposal_backend(uuid,text,jsonb)'::regprocedure);
 if position('PAYMENT_METHOD_INVOICE' in definition)>0 then return; end if;
 patched:=replace(definition,
  $a$if pay.status='completed' then return to_jsonb(pay); end if;$a$,
  $b$if pay.status='completed' then return to_jsonb(pay); end if;
  if pay.method='invoice' then raise sqlstate 'PT409' using message='PAYMENT_METHOD_INVOICE'; end if;$b$);
 if patched=definition then raise exception 'proposal_backend: payment guard anchor not found'; end if;
 definition:=patched;
 patched:=replace(definition,
  $a$where revision_id=r.id and status='pending_approval')$a$,
  $b$where revision_id=r.id and status='pending_approval' and method='order')$b$);
 if patched=definition then raise exception 'proposal_backend: payment mail anchor not found'; end if;
 execute patched;
end $$;

create or replace function private.proposal_invoice_backend(p_owner uuid,p_action text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.change_proposals;r public.proposal_revisions;a public.proposal_acceptances;pay public.proposal_payments;
begin
 if p_owner is null then raise sqlstate 'PT403' using message='OWNER_REQUIRED'; end if;
 if p_action='claim' then
  if coalesce(p_data->>'invoice_number','') !~ '^TR-[A-Z0-9]{10}$' then raise sqlstate 'PT422' using message='INVALID_INVOICE_NUMBER'; end if;
  select * into p from public.change_proposals where id=(p_data->>'proposal_id')::uuid and owner_id=p_owner for update;
  if not found then raise sqlstate 'PT404' using message='PROPOSAL_NOT_FOUND'; end if;
  perform private.ensure_active_project(p.project_id,p_owner);
  select * into r from public.proposal_revisions where id=p.current_revision_id;
  if r.id is distinct from (p_data->>'revision_id')::uuid then raise sqlstate 'PT409' using message='PROPOSAL_REVISION_CONFLICT'; end if;
  if p.locked_at is not null then raise sqlstate 'PT409' using message='CHANGE_READ_ONLY'; end if;
  if p.status<>'accepted' then raise sqlstate 'PT409' using message='ACCEPTANCE_REQUIRED'; end if;
  select * into a from public.proposal_acceptances where revision_id=r.id;
  if not found then raise sqlstate 'PT409' using message='ACCEPTANCE_REQUIRED'; end if;
  if r.additional_minor=0 then raise sqlstate 'PT409' using message='PAYMENT_NOT_REQUIRED'; end if;
  select * into pay from public.proposal_payments where acceptance_id=a.id for update;
  if not found then
   insert into public.proposal_payments(owner_id,project_id,proposal_id,revision_id,acceptance_id,amount_minor,currency,merchant_id,checkout_token,method,invoice_number)
    values(p_owner,p.project_id,p.id,r.id,a.id,r.additional_minor,r.currency,p_data->>'merchant_id',p_data->>'token','invoice',p_data->>'invoice_number')
    returning * into pay;
   return to_jsonb(pay)||jsonb_build_object('acquired',true);
  end if;
  if pay.status='completed' then return to_jsonb(pay)||jsonb_build_object('acquired',false); end if;
  if pay.method='invoice' then
   -- Only an unfinished or uncertain issue is retried; it keeps its invoice number so PayPal cannot create a second one.
   if pay.status in('creating','reconciliation_required') then
    update public.proposal_payments set status='creating',error_code=null,updated_at=now() where id=pay.id returning * into pay;
    return to_jsonb(pay)||jsonb_build_object('acquired',true);
   end if;
   return to_jsonb(pay)||jsonb_build_object('acquired',false);
  end if;
  -- An order can be retired only while nobody can have paid it: not captured, not approved, and its state known.
  if pay.capture_attempted or not(pay.status in('pending_approval','failed','cancelled') or pay.status='reconciliation_required' and pay.order_id is null) then
   raise sqlstate 'PT409' using message='PAYMENT_IN_PROGRESS';
  end if;
  update public.proposal_payments set method='invoice',retired_order_id=pay.order_id,order_id=null,approval_url=null,status='creating',
   invoice_number=p_data->>'invoice_number',error_code=null,updated_at=now() where id=pay.id returning * into pay;
  return to_jsonb(pay)||jsonb_build_object('acquired',true);
 end if;
 if p_action not in('record','apply','uncertain') then raise sqlstate 'PT422' using message='INVALID_BACKEND_COMMAND'; end if;
 select * into pay from public.proposal_payments where id=(p_data->>'payment_id')::uuid and owner_id=p_owner;
 if not found or pay.method<>'invoice' then raise sqlstate 'PT404' using message='PAYMENT_NOT_FOUND'; end if;
 select * into p from public.change_proposals where id=pay.proposal_id for update;
 select * into pay from public.proposal_payments where id=pay.id for update;
 if pay.status='completed' then return to_jsonb(pay); end if;
 if p.current_revision_id<>pay.revision_id or p.status<>'accepted' then raise sqlstate 'PT409' using message='PAYMENT_REVISION_CONFLICT'; end if;
 if p_action='uncertain' then
  update public.proposal_payments set status='reconciliation_required',error_code=p_data->>'error_code',updated_at=now() where id=pay.id returning * into pay;
  return to_jsonb(pay);
 end if;
 if nullif(p_data->>'invoice_id','') is null or pay.invoice_id is not null and pay.invoice_id<>p_data->>'invoice_id' then
  raise sqlstate 'PT409' using message='PAYMENT_EVIDENCE_MISMATCH';
 end if;
 if p_action='record' then
  update public.proposal_payments set invoice_id=p_data->>'invoice_id',invoice_url=p_data->>'invoice_url',status='pending_approval',error_code=null,updated_at=now()
   where id=pay.id returning * into pay;
  return to_jsonb(pay);
 end if;
 -- apply: only PayPal's verified capture of this invoice, same amount, currency and merchant, completes the change.
 if (p_data->>'amount_minor')::bigint<>pay.amount_minor or p_data->>'currency'<>pay.currency or p_data->>'merchant_id'<>pay.merchant_id then
  raise sqlstate 'PT409' using message='PAYMENT_EVIDENCE_MISMATCH';
 end if;
 if nullif(p_data->>'capture_id','') is null then raise sqlstate 'PT409' using message='CAPTURE_EVIDENCE_REQUIRED'; end if;
 update public.proposal_payments set invoice_id=p_data->>'invoice_id',status='completed',capture_id=p_data->>'capture_id',error_code=null,updated_at=now()
  where id=pay.id returning * into pay;
 update public.change_proposals set locked_at=now() where id=p.id;
 return to_jsonb(pay);
end $$;

create or replace function public.proposal_invoice_backend(p_owner uuid,p_action text,p_data jsonb)
returns jsonb language sql set search_path='' as $$select private.proposal_invoice_backend(p_owner,p_action,p_data)$$;

revoke all on function private.proposal_invoice_backend(uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.proposal_invoice_backend(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.proposal_invoice_backend(uuid,text,jsonb) to service_role;
grant execute on function private.proposal_invoice_backend(uuid,text,jsonb) to service_role;
