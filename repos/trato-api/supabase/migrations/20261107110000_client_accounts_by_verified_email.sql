begin;
-- Simplification (Sebastian, 7/11/2026): a client account sees every sent addendum addressed to its verified email,
-- from any freelancer, without a "Save to my account" step. The email link still works for clients without an account.
create or replace function private.client_account_agreements(p_user uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
 select coalesce(jsonb_agg(x order by x.sent_at desc), '[]'::jsonb) from (
  select p.id proposal_id, pj.name project_name, c.name client_name, r.revision_no, r.scope_summary, r.additional_minor, r.currency, r.deadline,
   case when a.id is not null then 'accepted' else p.status end status, pay.status payment_status, l.created_at sent_at
  from auth.users u
  join public.account_roles ar on ar.user_id = u.id and ar.role = 'client'
  join public.clients c on lower(btrim(c.contact_email)) = lower(btrim(u.email)) and c.deleted_at is null
  join public.projects pj on pj.client_id = c.id and pj.owner_id = c.owner_id and pj.deleted_at is null
  join public.change_proposals p on p.project_id = pj.id
  join public.proposal_revisions r on r.id = p.current_revision_id
  join lateral (select * from public.client_portal_links l where l.revision_id = r.id and l.revoked_at is null and l.expires_at > now() order by l.created_at desc limit 1) l on true
  left join public.proposal_acceptances a on a.revision_id = r.id
  left join public.proposal_payments pay on pay.acceptance_id = a.id
  where u.id = p_user and u.deleted_at is null and u.email_confirmed_at is not null
 ) x
$$;

create or replace function private.client_account_link_hash(p_user uuid, p_proposal uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare digest text;
begin
 select l.token_hash into digest from auth.users u
  join public.account_roles ar on ar.user_id = u.id and ar.role = 'client'
  join public.clients c on lower(btrim(c.contact_email)) = lower(btrim(u.email)) and c.deleted_at is null
  join public.projects pj on pj.client_id = c.id and pj.owner_id = c.owner_id and pj.deleted_at is null
  join public.change_proposals p on p.project_id = pj.id and p.id = p_proposal
  join public.client_portal_links l on l.revision_id = p.current_revision_id and l.revoked_at is null and l.expires_at > now()
  where u.id = p_user and u.deleted_at is null and u.email_confirmed_at is not null
  order by l.created_at desc limit 1;
 if digest is null then raise sqlstate 'PT404' using message = 'AGREEMENT_NOT_FOUND'; end if;
 return digest;
end $$;
create index if not exists clients_contact_email_lower_idx on public.clients (lower(btrim(contact_email))) where deleted_at is null;
commit;
