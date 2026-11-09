begin;
-- A PayPal webhook has no user session: this saves the same dispute events as record_dispute_events, for the backend only.
-- The owner and project come from the verified payment PayPal's dispute contests. Purely additive.
create function public.dispute_webhook_record(p_owner uuid, p_project uuid, p_dispute text, p_events jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare added integer;
begin
 if p_dispute is null or length(p_dispute) not between 1 and 64 then raise sqlstate 'PT422' using message = 'DISPUTE_EVENTS_INVALID'; end if;
 if jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) > 100 then raise sqlstate 'PT422' using message = 'DISPUTE_EVENTS_INVALID'; end if;
 if not exists (select 1 from public.projects p join public.clients c on c.id = p.client_id and c.owner_id = p.owner_id
                where p.id = p_project and p.owner_id = p_owner and p.deleted_at is null and c.deleted_at is null)
 then raise sqlstate 'PT404' using message = 'PROJECT_NOT_FOUND'; end if;
 insert into public.project_dispute_events (owner_id, project_id, dispute_id, event_key, kind, details, happened_at)
 select p_owner, p_project, p_dispute, e.event_key, e.kind, coalesce(e.details, '{}'::jsonb), e.happened_at
 from jsonb_to_recordset(p_events) as e(event_key text, kind text, details jsonb, happened_at timestamptz)
 on conflict (project_id, dispute_id, event_key) do nothing;
 get diagnostics added = row_count;
 return added;
end $$;
revoke all on function public.dispute_webhook_record(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.dispute_webhook_record(uuid, uuid, text, jsonb) to service_role;
commit;
