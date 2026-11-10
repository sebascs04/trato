begin;
-- Past meetings: when a live meeting with TeTrato ends, the freelancer keeps its conversation and summary in the
-- project's Meetings tab. Text only (what TeTrato transcribed and summarised); no audio is ever stored.
create table public.project_meeting_records(
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null,
 project_id uuid not null,
 meeting_id uuid references public.project_meetings(id),
 title text not null check (length(btrim(title)) between 1 and 200),
 summary jsonb not null default '{}'::jsonb check (jsonb_typeof(summary) = 'object' and length(summary::text) <= 20000),
 transcript jsonb not null default '[]'::jsonb check (jsonb_typeof(transcript) = 'array' and length(transcript::text) <= 200000),
 created_at timestamptz not null default now(),
 foreign key (project_id, owner_id) references public.projects(id, owner_id)
);
create index project_meeting_records_project_idx on public.project_meeting_records(project_id, created_at desc);
create index project_meeting_records_owner_idx on public.project_meeting_records(owner_id);
create index project_meeting_records_meeting_idx on public.project_meeting_records(meeting_id);
alter table public.project_meeting_records enable row level security;
revoke all on public.project_meeting_records from public, anon, authenticated;
grant select on public.project_meeting_records to authenticated;
create policy project_meeting_records_owner_read on public.project_meeting_records for select to authenticated
 using ((select auth.uid()) = owner_id);

-- Saved by the freelancer for their own active project; a scheduled meeting, when given, must be of that project.
create or replace function private.project_meeting_record_save(p_project uuid, p_meeting uuid, p_title text, p_summary jsonb, p_transcript jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare u uuid := (select auth.uid()); row public.project_meeting_records;
begin
 perform private.ensure_active_project(p_project, u);
 if p_meeting is not null and not exists (select 1 from public.project_meetings m where m.id = p_meeting and m.project_id = p_project and m.owner_id = u) then
  raise sqlstate 'PT404' using message = 'MEETING_NOT_FOUND';
 end if;
 if p_title is null or length(btrim(p_title)) not between 1 and 200 then raise sqlstate 'PT422' using message = 'MEETING_RECORD_TITLE_REQUIRED'; end if;
 if p_summary is null or jsonb_typeof(p_summary) <> 'object' or p_transcript is null or jsonb_typeof(p_transcript) <> 'array' or jsonb_array_length(p_transcript) = 0 then
  raise sqlstate 'PT422' using message = 'MEETING_RECORD_INVALID';
 end if;
 insert into public.project_meeting_records(owner_id, project_id, meeting_id, title, summary, transcript)
  values (u, p_project, p_meeting, btrim(p_title), p_summary, p_transcript) returning * into row;
 return to_jsonb(row);
end $$;

-- The freelancer removes a past meeting they no longer want to keep.
create or replace function private.project_meeting_record_delete(p_record uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare u uuid := (select auth.uid());
begin
 delete from public.project_meeting_records where id = p_record and owner_id = u;
 if not found then raise sqlstate 'PT404' using message = 'MEETING_RECORD_NOT_FOUND'; end if;
 return jsonb_build_object('deleted', p_record);
end $$;

create or replace function public.project_meeting_record_save(p_project uuid, p_meeting uuid, p_title text, p_summary jsonb, p_transcript jsonb)
returns jsonb language sql set search_path = '' as $$ select private.project_meeting_record_save(p_project, p_meeting, p_title, p_summary, p_transcript) $$;
create or replace function public.project_meeting_record_delete(p_record uuid)
returns jsonb language sql set search_path = '' as $$ select private.project_meeting_record_delete(p_record) $$;

revoke all on function private.project_meeting_record_save(uuid, uuid, text, jsonb, jsonb), private.project_meeting_record_delete(uuid),
 public.project_meeting_record_save(uuid, uuid, text, jsonb, jsonb), public.project_meeting_record_delete(uuid) from public, anon;
grant execute on function private.project_meeting_record_save(uuid, uuid, text, jsonb, jsonb), private.project_meeting_record_delete(uuid),
 public.project_meeting_record_save(uuid, uuid, text, jsonb, jsonb), public.project_meeting_record_delete(uuid) to authenticated;
commit;
