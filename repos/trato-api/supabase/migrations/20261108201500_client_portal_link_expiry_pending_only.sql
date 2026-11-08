-- A portal link's expiry limits only addenda still waiting for an answer. Once one is accepted, the client keeps
-- access through the link and the account: they may still have to pay it, and it stays their record if a dispute comes.
-- A revoked link stays blocked in every case.

create or replace function private.client_portal_link(p_token_hash text)
returns public.client_portal_links
language plpgsql stable security definer set search_path to ''
as $function$
declare link public.client_portal_links;
begin
 if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise sqlstate 'PT404' using message = 'PORTAL_LINK_NOT_FOUND'; end if;
 select * into link from public.client_portal_links where token_hash = p_token_hash;
 if not found or link.revoked_at is not null
    or (link.expires_at <= now() and not exists(select 1 from public.proposal_acceptances a where a.revision_id = link.revision_id)) then
  raise sqlstate 'PT404' using message = 'PORTAL_LINK_NOT_FOUND';
 end if;
 perform private.ensure_active_project(link.project_id, link.owner_id);
 return link;
end $function$;

create or replace function private.client_account_agreements(p_user uuid)
returns jsonb
language sql stable security definer set search_path to ''
as $function$
 select coalesce(jsonb_agg(x order by x.sent_at desc), '[]'::jsonb) from (
  select p.id proposal_id, pj.id project_id, pj.name project_name, c.name client_name, fu.email freelancer_email,
   r.revision_no, r.scope_summary, r.additional_minor, r.currency, r.deadline,
   case when a.id is not null then 'accepted' else p.status end status, pay.status payment_status, l.created_at sent_at,
   exists(select 1 from public.client_portal_change_requests q where q.revision_id = r.id and q.used_at is null) change_requested
  from auth.users u
  join public.account_roles ar on ar.user_id = u.id and ar.role = 'client'
  join public.clients c on lower(btrim(c.contact_email)) = lower(btrim(u.email)) and c.deleted_at is null
  join auth.users fu on fu.id = c.owner_id
  join public.projects pj on pj.client_id = c.id and pj.owner_id = c.owner_id and pj.deleted_at is null
  join public.change_proposals p on p.project_id = pj.id
  join public.proposal_revisions r on r.id = p.current_revision_id
  left join public.proposal_acceptances a on a.revision_id = r.id
  join lateral (select * from public.client_portal_links l where l.revision_id = r.id and l.revoked_at is null and (l.expires_at > now() or a.id is not null) order by l.created_at desc limit 1) l on true
  left join public.proposal_payments pay on pay.acceptance_id = a.id
  where u.id = p_user and u.deleted_at is null and u.email_confirmed_at is not null
 ) x
$function$;

create or replace function private.client_account_link_hash(p_user uuid, p_proposal uuid)
returns text
language plpgsql stable security definer set search_path to ''
as $function$
declare digest text;
begin
 select l.token_hash into digest from auth.users u
  join public.account_roles ar on ar.user_id = u.id and ar.role = 'client'
  join public.clients c on lower(btrim(c.contact_email)) = lower(btrim(u.email)) and c.deleted_at is null
  join public.projects pj on pj.client_id = c.id and pj.owner_id = c.owner_id and pj.deleted_at is null
  join public.change_proposals p on p.project_id = pj.id and p.id = p_proposal
  join public.client_portal_links l on l.revision_id = p.current_revision_id and l.revoked_at is null
   and (l.expires_at > now() or exists(select 1 from public.proposal_acceptances a where a.revision_id = l.revision_id))
  where u.id = p_user and u.deleted_at is null and u.email_confirmed_at is not null
  order by l.created_at desc limit 1;
 if digest is null then raise sqlstate 'PT404' using message = 'AGREEMENT_NOT_FOUND'; end if;
 return digest;
end $function$;
