begin;
-- Client "Projects" view groups agreements by freelancer and project. The freelancer is identified by the email
-- the client already receives the addenda from (the freelancer's Trato account email).
create or replace function private.client_account_agreements(p_user uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
 select coalesce(jsonb_agg(x order by x.sent_at desc), '[]'::jsonb) from (
  select p.id proposal_id, pj.id project_id, pj.name project_name, c.name client_name, fu.email freelancer_email,
   r.revision_no, r.scope_summary, r.additional_minor, r.currency, r.deadline,
   case when a.id is not null then 'accepted' else p.status end status, pay.status payment_status, l.created_at sent_at
  from auth.users u
  join public.account_roles ar on ar.user_id = u.id and ar.role = 'client'
  join public.clients c on lower(btrim(c.contact_email)) = lower(btrim(u.email)) and c.deleted_at is null
  join auth.users fu on fu.id = c.owner_id
  join public.projects pj on pj.client_id = c.id and pj.owner_id = c.owner_id and pj.deleted_at is null
  join public.change_proposals p on p.project_id = pj.id
  join public.proposal_revisions r on r.id = p.current_revision_id
  join lateral (select * from public.client_portal_links l where l.revision_id = r.id and l.revoked_at is null and l.expires_at > now() order by l.created_at desc limit 1) l on true
  left join public.proposal_acceptances a on a.revision_id = r.id
  left join public.proposal_payments pay on pay.acceptance_id = a.id
  where u.id = p_user and u.deleted_at is null and u.email_confirmed_at is not null
 ) x
$$;
commit;
