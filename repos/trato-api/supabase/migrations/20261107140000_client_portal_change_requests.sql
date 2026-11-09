begin;
-- Block 2d: the client asks for changes from the portal. The request is the client's feedback for a new version,
-- like a Gmail reply: the freelancer uses it to prepare v2 (proposal_command 'revise' with feedback_portal_request_id).
create table public.client_portal_change_requests(
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null,
 project_id uuid not null,
 proposal_id uuid not null,
 revision_id uuid not null unique,
 link_id uuid not null,
 notes text not null check (length(btrim(notes)) between 1 and 4000),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 used_at timestamptz,
 unique (id, proposal_id, project_id, owner_id),
 foreign key (revision_id, proposal_id, project_id, owner_id) references public.proposal_revisions(id, proposal_id, project_id, owner_id),
 foreign key (link_id, project_id, owner_id) references public.client_portal_links(id, project_id, owner_id)
);
create index client_portal_change_requests_proposal_idx on public.client_portal_change_requests(proposal_id);
alter table public.client_portal_change_requests enable row level security;
revoke all on public.client_portal_change_requests from anon, authenticated;
grant select on public.client_portal_change_requests to authenticated;
create policy client_portal_change_requests_owner_read on public.client_portal_change_requests for select to authenticated
 using ((select auth.uid()) = owner_id);

alter table public.proposal_revisions add column feedback_portal_request_id uuid,
 add constraint proposal_revisions_feedback_portal_request_fkey foreign key (feedback_portal_request_id) references public.client_portal_change_requests(id);

create or replace function private.client_portal_request_changes(p_token_hash text, p_notes text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare link public.client_portal_links; p public.change_proposals; req public.client_portal_change_requests;
begin
 link := private.client_portal_link(p_token_hash);
 if p_notes is null or length(btrim(p_notes)) not between 1 and 4000 then raise sqlstate 'PT422' using message = 'CHANGE_REQUEST_NOTES_REQUIRED'; end if;
 perform 1 from public.projects where id = link.project_id and owner_id = link.owner_id for update;
 select * into p from public.change_proposals where id = link.proposal_id for update;
 if p.current_revision_id is distinct from link.revision_id then raise sqlstate 'PT409' using message = 'PROPOSAL_REVISION_CONFLICT'; end if;
 if p.status <> 'ready_for_review' or p.locked_at is not null or exists(select 1 from public.proposal_acceptances where revision_id = link.revision_id) then
  raise sqlstate 'PT409' using message = 'PROPOSAL_ALREADY_ACCEPTED'; end if;
 insert into public.client_portal_change_requests(owner_id, project_id, proposal_id, revision_id, link_id, notes)
  values (link.owner_id, link.project_id, link.proposal_id, link.revision_id, link.id, btrim(p_notes))
  on conflict (revision_id) do update set notes = excluded.notes, updated_at = now() where public.client_portal_change_requests.used_at is null
  returning * into req;
 if req.id is null then raise sqlstate 'PT409' using message = 'CHANGE_REQUEST_ALREADY_USED'; end if;
 return jsonb_build_object('requested_at', req.updated_at);
end $$;
create or replace function public.client_portal_request_changes(p_token_hash text, p_notes text)
returns jsonb language sql set search_path = '' as $$ select private.client_portal_request_changes(p_token_hash, p_notes) $$;
revoke all on function private.client_portal_request_changes(text, text), public.client_portal_request_changes(text, text) from public, anon, authenticated;
grant execute on function private.client_portal_request_changes(text, text), public.client_portal_request_changes(text, text) to service_role;

-- The portal view shows the client's pending request for this version.
create or replace function private.client_portal_view(p_token_hash text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare link public.client_portal_links; p public.change_proposals; r public.proposal_revisions; v public.proposal_reviews;
 a public.proposal_acceptances; pay public.proposal_payments; req public.client_portal_change_requests; prj record;
begin
 link := private.client_portal_link(p_token_hash);
 select * into p from public.change_proposals where id = link.proposal_id;
 select * into r from public.proposal_revisions where id = link.revision_id;
 select * into v from public.proposal_reviews where revision_id = link.revision_id;
 select * into a from public.proposal_acceptances where revision_id = link.revision_id;
 if a.id is not null then select * into pay from public.proposal_payments where acceptance_id = a.id; end if;
 select * into req from public.client_portal_change_requests where revision_id = link.revision_id;
 select pj.name project_name, c.name client_name into prj from public.projects pj join public.clients c on c.id = pj.client_id where pj.id = link.project_id;
 return jsonb_build_object(
  'link_id', link.id, 'expires_at', link.expires_at,
  'project_name', prj.project_name, 'client_name', prj.client_name,
  'proposal_id', p.id, 'revision_id', r.id, 'revision_no', r.revision_no,
  'is_current', p.current_revision_id = r.id,
  'scope_summary', r.scope_summary, 'conditions', r.conditions, 'currency', r.currency,
  'additional_minor', r.additional_minor, 'deadline', r.deadline,
  'addendum_document_id', v.addendum_document_id, 'addendum_sha256', v.addendum_sha256,
  'status', case when a.id is not null then 'accepted' when p.current_revision_id <> r.id then 'superseded' else p.status end,
  'accepted_at', a.created_at, 'acceptance_method', a.method,
  'payment_required', r.additional_minor > 0,
  'payment_status', pay.status,
  'change_request', case when req.id is null then null else jsonb_build_object('notes', req.notes, 'requested_at', req.updated_at) end);
end $$;
revoke all on function private.client_portal_view(text) from public, anon, authenticated;
grant execute on function private.client_portal_view(text) to service_role;

-- proposal_command 'revise': a portal request is valid client feedback, used once, like a Gmail reply.
do $patch$
declare def text := pg_get_functiondef('private.proposal_command(text,jsonb,text)'::regprocedure); before text;
begin
 before := def;
 def := replace(def, 'gmail_message public.gmail_inbound_messages;', 'gmail_message public.gmail_inbound_messages; portal_request public.client_portal_change_requests;');
 def := replace(def, '   elsif p_data->>''feedback_document_id'' is not null then',
  '   elsif p_data->>''feedback_portal_request_id'' is not null then
    select * into portal_request from public.client_portal_change_requests where id=(p_data->>''feedback_portal_request_id'')::uuid and owner_id=u and project_id=project and proposal_id=p.id and revision_id=r.id and used_at is null for update;
    if not found then raise sqlstate ''PT422'' using message=''CLIENT_FEEDBACK_REQUIRED'';end if;
   elsif p_data->>''feedback_document_id'' is not null then');
 def := replace(def, '  if p_data->>''feedback_email_id'' is not null then update public.gmail_inbound_messages set used_at=now() where id=gmail_message.id and used_at is null; if not found then raise sqlstate ''PT409'' using message=''CLIENT_FEEDBACK_ALREADY_USED'';end if;end if;',
  '  if p_data->>''feedback_email_id'' is not null then update public.gmail_inbound_messages set used_at=now() where id=gmail_message.id and used_at is null; if not found then raise sqlstate ''PT409'' using message=''CLIENT_FEEDBACK_ALREADY_USED'';end if;end if;
  if p_data->>''feedback_portal_request_id'' is not null then update public.proposal_revisions set feedback_portal_request_id=portal_request.id where id=revision; update public.client_portal_change_requests set used_at=now() where id=portal_request.id and used_at is null; if not found then raise sqlstate ''PT409'' using message=''CLIENT_FEEDBACK_ALREADY_USED'';end if;end if;');
 if def = before or position('portal_request public.client_portal_change_requests' in def) = 0 or position('feedback_portal_request_id=portal_request.id' in def) = 0
  or position('elsif p_data->>''feedback_portal_request_id''' in def) = 0 then
  raise exception 'PROPOSAL_COMMAND_PATCH_FAILED';
 end if;
 execute def;
end $patch$;
commit;
