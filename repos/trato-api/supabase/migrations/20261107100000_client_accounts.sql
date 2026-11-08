begin;
-- Block 2c: a client account saves a freelancer's client record ("Save to my account") from a portal link.
-- Allowed only when the account is a client and its verified email equals the email the freelancer registered.
-- Once saved, the account sees that client's sent addenda in "My agreements" and opens them with its session.
create table public.client_account_links(
 user_id uuid not null references auth.users(id) on delete cascade,
 owner_id uuid not null,
 client_id uuid not null,
 created_at timestamptz not null default now(),
 primary key (user_id, client_id),
 foreign key (client_id, owner_id) references public.clients(id, owner_id)
);
create index client_account_links_client_idx on public.client_account_links(client_id);
alter table public.client_account_links enable row level security;
revoke all on public.client_account_links from anon, authenticated;

create or replace function private.client_portal_claim(p_token_hash text, p_user uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare link public.client_portal_links; c public.clients; u auth.users;
begin
 link := private.client_portal_link(p_token_hash);
 select * into u from auth.users where id = p_user and deleted_at is null;
 if not found or not exists(select 1 from public.account_roles where user_id = p_user and role = 'client') then
  raise sqlstate 'PT403' using message = 'CLIENT_ACCOUNT_REQUIRED'; end if;
 if u.email_confirmed_at is null then raise sqlstate 'PT403' using message = 'EMAIL_NOT_VERIFIED'; end if;
 select c2.* into c from public.projects pj join public.clients c2 on c2.id = pj.client_id and c2.owner_id = pj.owner_id
  where pj.id = link.project_id and c2.deleted_at is null;
 if not found then raise sqlstate 'PT404' using message = 'PORTAL_LINK_NOT_FOUND'; end if;
 if lower(btrim(c.contact_email)) is distinct from lower(btrim(u.email)) then raise sqlstate 'PT403' using message = 'CLIENT_EMAIL_MISMATCH'; end if;
 insert into public.client_account_links(user_id, owner_id, client_id) values (p_user, c.owner_id, c.id) on conflict do nothing;
 return jsonb_build_object('saved', true);
end $$;

-- Is this portal link already saved in this account? (shown in the portal to hide the button)
create or replace function private.client_portal_saved(p_token_hash text, p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.client_portal_links l join public.projects pj on pj.id = l.project_id
  join public.client_account_links a on a.client_id = pj.client_id and a.user_id = p_user
  where l.token_hash = p_token_hash)
$$;

-- "My agreements": sent addenda of the saved clients, newest first. The token hash never leaves the backend.
create or replace function private.client_account_agreements(p_user uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
 select coalesce(jsonb_agg(x order by x.sent_at desc), '[]'::jsonb) from (
  select p.id proposal_id, pj.name project_name, c.name client_name, r.revision_no, r.scope_summary, r.additional_minor, r.currency, r.deadline,
   case when a.id is not null then 'accepted' else p.status end status, pay.status payment_status, l.created_at sent_at
  from public.client_account_links al
  join public.clients c on c.id = al.client_id and c.deleted_at is null
  join public.projects pj on pj.client_id = c.id and pj.owner_id = c.owner_id and pj.deleted_at is null
  join public.change_proposals p on p.project_id = pj.id
  join public.proposal_revisions r on r.id = p.current_revision_id
  join lateral (select * from public.client_portal_links l where l.revision_id = r.id and l.revoked_at is null and l.expires_at > now() order by l.created_at desc limit 1) l on true
  left join public.proposal_acceptances a on a.revision_id = r.id
  left join public.proposal_payments pay on pay.acceptance_id = a.id
  where al.user_id = p_user and exists(select 1 from public.account_roles ar where ar.user_id = p_user and ar.role = 'client')
 ) x
$$;

-- Opening one agreement with the session: resolves the active link hash for the backend only.
create or replace function private.client_account_link_hash(p_user uuid, p_proposal uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare digest text;
begin
 select l.token_hash into digest from public.client_account_links al
  join public.projects pj on pj.client_id = al.client_id and pj.deleted_at is null
  join public.change_proposals p on p.project_id = pj.id and p.id = p_proposal
  join public.client_portal_links l on l.revision_id = p.current_revision_id and l.revoked_at is null and l.expires_at > now()
  where al.user_id = p_user and exists(select 1 from public.account_roles ar where ar.user_id = p_user and ar.role = 'client')
  order by l.created_at desc limit 1;
 if digest is null then raise sqlstate 'PT404' using message = 'AGREEMENT_NOT_FOUND'; end if;
 return digest;
end $$;

create or replace function public.client_portal_claim(p_token_hash text, p_user uuid)
returns jsonb language sql set search_path = '' as $$ select private.client_portal_claim(p_token_hash, p_user) $$;
create or replace function public.client_portal_saved(p_token_hash text, p_user uuid)
returns boolean language sql stable set search_path = '' as $$ select private.client_portal_saved(p_token_hash, p_user) $$;
create or replace function public.client_account_agreements(p_user uuid)
returns jsonb language sql stable set search_path = '' as $$ select private.client_account_agreements(p_user) $$;
create or replace function public.client_account_link_hash(p_user uuid, p_proposal uuid)
returns text language sql stable set search_path = '' as $$ select private.client_account_link_hash(p_user, p_proposal) $$;
revoke all on function private.client_portal_claim(text, uuid), private.client_portal_saved(text, uuid), private.client_account_agreements(uuid), private.client_account_link_hash(uuid, uuid),
 public.client_portal_claim(text, uuid), public.client_portal_saved(text, uuid), public.client_account_agreements(uuid), public.client_account_link_hash(uuid, uuid) from public, anon, authenticated;
grant execute on function private.client_portal_claim(text, uuid), private.client_portal_saved(text, uuid), private.client_account_agreements(uuid), private.client_account_link_hash(uuid, uuid),
 public.client_portal_claim(text, uuid), public.client_portal_saved(text, uuid), public.client_account_agreements(uuid), public.client_account_link_hash(uuid, uuid) to service_role;
commit;
