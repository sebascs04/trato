begin;
-- Portal payment (block 2b): after accepting, the client pays the addendum with the same verified PayPal checkout.
-- The view adds the payment state; the context function gives the backend the owner and ids it needs to prepare it.
create or replace function private.client_portal_view(p_token_hash text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare link public.client_portal_links; p public.change_proposals; r public.proposal_revisions; v public.proposal_reviews;
 a public.proposal_acceptances; pay public.proposal_payments; prj record;
begin
 link := private.client_portal_link(p_token_hash);
 select * into p from public.change_proposals where id = link.proposal_id;
 select * into r from public.proposal_revisions where id = link.revision_id;
 select * into v from public.proposal_reviews where revision_id = link.revision_id;
 select * into a from public.proposal_acceptances where revision_id = link.revision_id;
 if a.id is not null then select * into pay from public.proposal_payments where acceptance_id = a.id; end if;
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
  'payment_status', pay.status);
end $$;

create or replace function private.client_portal_payment_context(p_token_hash text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare link public.client_portal_links; a public.proposal_acceptances;
begin
 link := private.client_portal_link(p_token_hash);
 select * into a from public.proposal_acceptances where revision_id = link.revision_id;
 if not found then raise sqlstate 'PT409' using message = 'ACCEPTANCE_REQUIRED'; end if;
 return jsonb_build_object('owner_id', link.owner_id, 'proposal_id', link.proposal_id, 'revision_id', link.revision_id);
end $$;
create or replace function public.client_portal_payment_context(p_token_hash text)
returns jsonb language sql stable set search_path = '' as $$ select private.client_portal_payment_context(p_token_hash) $$;
revoke all on function private.client_portal_payment_context(text), public.client_portal_payment_context(text) from public, anon, authenticated;
grant execute on function private.client_portal_payment_context(text), public.client_portal_payment_context(text) to service_role;
revoke all on function private.client_portal_view(text) from public, anon, authenticated;
grant execute on function private.client_portal_view(text) to service_role;
commit;
