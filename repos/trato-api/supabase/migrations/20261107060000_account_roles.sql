begin;
-- Account role: one per account, chosen at signup, never changed. Stored in a table, not in user_metadata
-- (user-editable), so authorization never trusts what the user can edit. Existing accounts are freelancers.
create table public.account_roles(
 user_id uuid primary key references auth.users(id) on delete cascade,
 role text not null check (role in ('freelancer','client')),
 created_at timestamptz not null default now()
);
alter table public.account_roles enable row level security;
revoke all on public.account_roles from anon, authenticated;
grant select on public.account_roles to authenticated;
create policy account_roles_own_read on public.account_roles for select to authenticated
 using ((select auth.uid()) = user_id);

insert into public.account_roles(user_id, role) select id, 'freelancer' from auth.users on conflict do nothing;

-- Signup sends the requested role in the signup data. Only the first value counts: the row is never updated.
create or replace function private.account_role_on_signup() returns trigger language plpgsql security definer set search_path = '' as $$
begin
 insert into public.account_roles(user_id, role)
  values (new.id, case when new.raw_user_meta_data->>'account_role' = 'client' then 'client' else 'freelancer' end)
  on conflict do nothing;
 return new;
end $$;
revoke all on function private.account_role_on_signup() from public, anon, authenticated;
create trigger account_role_on_signup after insert on auth.users for each row execute function private.account_role_on_signup();

create or replace function private.is_freelancer() returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.account_roles where user_id = (select auth.uid()) and role = 'freelancer')
$$;
revoke all on function private.is_freelancer() from public, anon;
grant execute on function private.is_freelancer() to authenticated, service_role;

-- Client accounts cannot open a freelancer workspace: everything starts from a client and a project.
create policy create_client_freelancer_only on public.clients as restrictive for insert to authenticated
 with check ((select private.is_freelancer()));
create policy create_project_freelancer_only on public.projects as restrictive for insert to authenticated
 with check ((select private.is_freelancer()));

-- The client's email is required: it carries the addendum, the portal link and the dispute evidence.
alter table public.clients
 alter column contact_email set not null,
 drop constraint clients_contact_email_check,
 add constraint clients_contact_email_check check (length(contact_email) between 3 and 254 and contact_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$');
commit;
