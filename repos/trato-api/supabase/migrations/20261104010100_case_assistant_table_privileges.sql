-- Supabase default privileges can grant DML even when RLS blocks all writes.
-- Only the narrow RPCs may mutate assistant records.
begin;
revoke all on public.case_assistant_sessions,public.case_assistant_messages from authenticated,anon;
grant select on public.case_assistant_sessions,public.case_assistant_messages to authenticated;
commit;
