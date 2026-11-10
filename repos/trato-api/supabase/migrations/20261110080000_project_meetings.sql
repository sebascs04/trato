begin;
-- Schedule meeting: the freelancer saves a Google Meet link and time for a project; Trato emails the invitation from the
-- central mailbox and the client sees it in their account. The call itself happens in Meet; TeTrato listens from
-- the freelancer's meeting page. Nothing here records audio, moves money or creates anything in Google.
create table public.project_meetings(
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null,
 project_id uuid not null,
 title text not null check (length(btrim(title)) between 1 and 200),
 meet_url text not null check (meet_url ~ '^https://meet\.google\.com/[a-z]{3}-[a-z]{4}-[a-z]{3}$'),
 starts_at timestamptz not null,
 time_zone text not null check (length(time_zone) between 1 and 64),
 recipient_email text not null,
 output_language text not null check (output_language in ('es', 'en')),
 mail_status text not null default 'none' check (mail_status in ('none', 'sending', 'sent', 'failed', 'uncertain')),
 mail_digest text,
 mail_message_id text,
 mail_sent_at timestamptz,
 cancelled_at timestamptz,
 created_at timestamptz not null default now(),
 foreign key (project_id, owner_id) references public.projects(id, owner_id)
);
create index project_meetings_project_idx on public.project_meetings(project_id, starts_at);
create index project_meetings_owner_idx on public.project_meetings(owner_id);
alter table public.project_meetings enable row level security;
revoke all on public.project_meetings from public, anon, authenticated;
grant select on public.project_meetings to authenticated;
create policy project_meetings_owner_read on public.project_meetings for select to authenticated using ((select auth.uid()) = owner_id);

-- The freelancer schedules for their own active project; the invitation goes to the client's registered email.
create or replace function private.project_meeting_create(p_project uuid, p_title text, p_meet_url text, p_starts_at timestamptz,
 p_time_zone text, p_language text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare u uuid := (select auth.uid()); email text; row public.project_meetings;
begin
 perform private.ensure_active_project(p_project, u);
 select nullif(btrim(c.contact_email), '') into email from public.projects p join public.clients c on c.id = p.client_id and c.owner_id = p.owner_id
  where p.id = p_project and p.owner_id = u;
 if email is null then raise sqlstate 'PT422' using message = 'CLIENT_EMAIL_REQUIRED'; end if;
 if p_starts_at is null or p_starts_at < now() - interval '5 minutes' then raise sqlstate 'PT422' using message = 'MEETING_TIME_INVALID'; end if;
 insert into public.project_meetings(owner_id, project_id, title, meet_url, starts_at, time_zone, recipient_email, output_language)
  values (u, p_project, btrim(p_title), btrim(p_meet_url), p_starts_at, p_time_zone, email, p_language) returning * into row;
 return to_jsonb(row);
end $$;

create or replace function private.project_meeting_cancel(p_meeting uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare row public.project_meetings;
begin
 update public.project_meetings set cancelled_at = now() where id = p_meeting and owner_id = (select auth.uid()) and cancelled_at is null
  returning * into row;
 if row.id is null then raise sqlstate 'PT404' using message = 'MEETING_NOT_FOUND'; end if;
 return to_jsonb(row);
end $$;

-- Sending once: a claim for one reviewed email (its digest), then its result. A sent or uncertain email is never repeated.
create or replace function private.project_meeting_mail_claim(p_meeting uuid, p_digest text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare row public.project_meetings;
begin
 update public.project_meetings set mail_status = 'sending', mail_digest = p_digest
  where id = p_meeting and owner_id = (select auth.uid()) and cancelled_at is null and mail_status in ('none', 'failed')
  returning * into row;
 if row.id is not null then return jsonb_build_object('acquired', true, 'meeting', to_jsonb(row)); end if;
 select * into row from public.project_meetings where id = p_meeting and owner_id = (select auth.uid());
 if row.id is null then raise sqlstate 'PT404' using message = 'MEETING_NOT_FOUND'; end if;
 return jsonb_build_object('acquired', false, 'meeting', to_jsonb(row));
end $$;

create or replace function private.project_meeting_mail_finish(p_meeting uuid, p_status text, p_message_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare row public.project_meetings;
begin
 if p_status not in ('sent', 'failed', 'uncertain') then raise sqlstate 'PT422' using message = 'MEETING_MAIL_STATUS_INVALID'; end if;
 update public.project_meetings set mail_status = p_status, mail_message_id = p_message_id,
  mail_sent_at = case when p_status = 'sent' then now() end
  where id = p_meeting and owner_id = (select auth.uid()) and mail_status = 'sending' returning * into row;
 if row.id is null then raise sqlstate 'PT409' using message = 'MEETING_MAIL_NOT_SENDING'; end if;
 return to_jsonb(row);
end $$;

-- What the client sees: upcoming meetings of their projects, with the same authorization as their agreements.
create or replace function public.client_account_meetings(p_user uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
 select coalesce(jsonb_agg(x order by x.starts_at), '[]'::jsonb) from (
  select m.id, pj.id project_id, pj.name project_name, fu.email freelancer_email, m.title, m.meet_url, m.starts_at, m.time_zone
  from auth.users u
  join public.account_roles ar on ar.user_id = u.id and ar.role = 'client'
  join public.clients c on lower(btrim(c.contact_email)) = lower(btrim(u.email)) and c.deleted_at is null
  join auth.users fu on fu.id = c.owner_id
  join public.projects pj on pj.client_id = c.id and pj.owner_id = c.owner_id and pj.deleted_at is null
  join public.project_meetings m on m.project_id = pj.id and m.owner_id = pj.owner_id
  where u.id = p_user and u.deleted_at is null and u.email_confirmed_at is not null
   and m.cancelled_at is null and m.starts_at > now() - interval '3 hours'
 ) x
$$;

create or replace function public.project_meeting_create(p_project uuid, p_title text, p_meet_url text, p_starts_at timestamptz, p_time_zone text, p_language text)
returns jsonb language sql set search_path = '' as $$ select private.project_meeting_create(p_project, p_title, p_meet_url, p_starts_at, p_time_zone, p_language) $$;
create or replace function public.project_meeting_cancel(p_meeting uuid)
returns jsonb language sql set search_path = '' as $$ select private.project_meeting_cancel(p_meeting) $$;
create or replace function public.project_meeting_mail_claim(p_meeting uuid, p_digest text)
returns jsonb language sql set search_path = '' as $$ select private.project_meeting_mail_claim(p_meeting, p_digest) $$;
create or replace function public.project_meeting_mail_finish(p_meeting uuid, p_status text, p_message_id text)
returns jsonb language sql set search_path = '' as $$ select private.project_meeting_mail_finish(p_meeting, p_status, p_message_id) $$;

revoke all on function private.project_meeting_create(uuid, text, text, timestamptz, text, text), private.project_meeting_cancel(uuid),
 private.project_meeting_mail_claim(uuid, text), private.project_meeting_mail_finish(uuid, text, text),
 public.project_meeting_create(uuid, text, text, timestamptz, text, text), public.project_meeting_cancel(uuid),
 public.project_meeting_mail_claim(uuid, text), public.project_meeting_mail_finish(uuid, text, text),
 public.client_account_meetings(uuid) from public, anon, authenticated;
grant execute on function private.project_meeting_create(uuid, text, text, timestamptz, text, text), private.project_meeting_cancel(uuid),
 private.project_meeting_mail_claim(uuid, text), private.project_meeting_mail_finish(uuid, text, text),
 public.project_meeting_create(uuid, text, text, timestamptz, text, text), public.project_meeting_cancel(uuid),
 public.project_meeting_mail_claim(uuid, text), public.project_meeting_mail_finish(uuid, text, text) to authenticated;
grant execute on function public.client_account_meetings(uuid) to service_role;
commit;
