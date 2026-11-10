begin;
-- The client's Work plan shows a refunded stage payment as refunded, like the addenda already do (20261109100000).
-- Same function as 20261109236000 with two more fields: the verified paid amount and the refunded amount PayPal confirmed
-- (private.refund_previous, the same total the freelancer's Refunds and the client's addenda use). A stage checkout's id is its received payment's id.
create or replace function public.client_account_project_plans(p_user uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(x order by x.project_name, x.position),'[]'::jsonb) from (
  select pj.id project_id, pj.name project_name, fu.email freelancer_email,
   s.position, s.title, s.amount, s.payment_condition,
   ck.status payment_status, ck.method payment_method, ck.paid_at, ck.output_language,
   case when ck.method='invoice' and ck.status='pending_approval' then ck.invoice_url end invoice_url,
   case when ck.method='invoice' then ck.invoice_number end invoice_number,
   case when ck.method='order' and ck.status='pending_approval' and ck.order_id is not null and ck.mail_status='sent' then ck.checkout_token end checkout_token,
   ev.id delivery_document_id, ev.title delivery_title,
   rv.decision review_decision, rv.notes review_notes, rv.created_at reviewed_at,
   case when ck.status='completed' then rp.amount_minor end paid_minor,
   case when ck.status='completed' then coalesce(least(rp.amount_minor, private.refund_previous(rp.id)),0) else 0 end refunded_minor
  from auth.users u
  join public.account_roles ar on ar.user_id=u.id and ar.role='client'
  join public.clients c on lower(btrim(c.contact_email))=lower(btrim(u.email)) and c.deleted_at is null
  join auth.users fu on fu.id=c.owner_id
  join public.projects pj on pj.client_id=c.id and pj.owner_id=c.owner_id and pj.deleted_at is null
  join public.project_start_stages s on s.project_id=pj.id
  left join public.project_initial_checkouts ck on ck.project_id=pj.id and ck.stage_position=s.position
  left join public.project_received_payments rp on rp.id=ck.id and rp.origin='initial' and rp.project_id=pj.id
  left join lateral private.stage_delivery(pj.id,s.position) ev on true
  left join public.project_stage_reviews rv on rv.document_id=ev.id
  where u.id=p_user and u.deleted_at is null and u.email_confirmed_at is not null
 ) x
$$;
commit;
