begin;
-- Client reputation is written by freelancers about clients. Client accounts (account_roles) cannot read or write it.
create or replace function public.community_reputation(p_action text, p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql set search_path = '' as $$
begin
 if not private.is_freelancer() then raise sqlstate '42501' using message = 'FREELANCER_ONLY'; end if;
 return private.community_reputation(p_action, p_data);
end $$;
create or replace function public.reputation_usage(p_profile_id uuid, p_helpful boolean default null)
returns jsonb language plpgsql set search_path = '' as $$
begin
 if not private.is_freelancer() then raise sqlstate '42501' using message = 'FREELANCER_ONLY'; end if;
 return private.reputation_usage(p_profile_id, p_helpful);
end $$;
-- Evidence files in storage follow the same rule.
create or replace function private.reputation_attachment_access(p_path text, p_mode text)
returns boolean language sql stable security definer set search_path = '' as $$
 select auth.uid() is not null and not coalesce((auth.jwt()->>'is_anonymous')::boolean,false)
 and private.is_freelancer()
 and exists(select 1 from auth.users where id=auth.uid()) and exists(
  select 1 from private.reputation_attachments a where a.storage_path=p_path and (
   (p_mode='read' and ((a.author_id=auth.uid() and a.status<>'discarded') or
    (a.status='attached' and exists(select 1 from private.reputation_reviews r where r.id=a.review_id and r.status='published'))))
   or (p_mode='upload' and a.author_id=auth.uid() and a.status='reserved' and exists(
    select 1 from public.projects p join public.clients c on c.id=p.client_id where p.id=a.project_id and p.owner_id=auth.uid() and c.owner_id=auth.uid() and c.deleted_at is null))
   or (p_mode='delete' and a.author_id=auth.uid() and a.status in('reserved','ready','discarded'))));
$$;
commit;
