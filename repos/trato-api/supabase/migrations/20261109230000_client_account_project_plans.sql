-- The client sees how each project goes: its Work plan deliverables with amount and payment state, read-only.
-- Same authorization as the client's agreements: a client-role account whose verified email is the client's registered email.
create or replace function public.client_account_project_plans(p_user uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(x order by x.project_name, x.position),'[]'::jsonb) from (
  select pj.id project_id, pj.name project_name, fu.email freelancer_email,
   s.position, s.title, s.amount, s.payment_condition,
   ck.status payment_status, ck.method payment_method, ck.paid_at, ck.output_language,
   -- Only what the client needs to pay a request already sent: the invoice page, or the emailed checkout token.
   case when ck.method='invoice' and ck.status='pending_approval' then ck.invoice_url end invoice_url,
   case when ck.method='invoice' then ck.invoice_number end invoice_number,
   case when ck.method='order' and ck.status='pending_approval' and ck.order_id is not null and ck.mail_status='sent' then ck.checkout_token end checkout_token
  from auth.users u
  join public.account_roles ar on ar.user_id=u.id and ar.role='client'
  join public.clients c on lower(btrim(c.contact_email))=lower(btrim(u.email)) and c.deleted_at is null
  join auth.users fu on fu.id=c.owner_id
  join public.projects pj on pj.client_id=c.id and pj.owner_id=c.owner_id and pj.deleted_at is null
  join public.project_start_stages s on s.project_id=pj.id
  left join public.project_initial_checkouts ck on ck.project_id=pj.id and ck.stage_position=s.position
  where u.id=p_user and u.deleted_at is null and u.email_confirmed_at is not null
 ) x
$$;

revoke all on function public.client_account_project_plans(uuid) from public,anon,authenticated;
grant execute on function public.client_account_project_plans(uuid) to service_role;
