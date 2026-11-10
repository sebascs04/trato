-- A refund the client asked for from their own space, for everything still refundable on that payment, needs no proposal
-- email or reply: the authenticated request is the client's acceptance. Two narrow, additive steps reuse the usual tables,
-- so the PDF, the financial check, authorization and execution stay exactly the existing ones.
-- 1) client_refund_request_settle: registers the refund and its only version (full refund, no deductions) from the request.
-- 2) client_refund_request_accept: once the version's PDF is saved, records the request as the client's acceptance.
-- Anything else (a partial amount, deductions) keeps the full flow with the client's reply.

alter table public.refund_acceptances drop constraint refund_acceptances_method_check;
alter table public.refund_acceptances add constraint refund_acceptances_method_check
 check (method in ('manual_document_review','client_portal_request'));

create or replace function public.client_refund_request_settle(p_request uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();item public.client_refund_requests;pay public.project_received_payments;
 parent public.refund_settlements;snap public.refund_snapshots;terms jsonb;prepared jsonb;payments jsonb;previous bigint;
begin
 if actor is null or not exists(select 1 from auth.users where id=actor and deleted_at is null and not coalesce(is_anonymous,false)) then raise sqlstate 'PT401' using message='UNAUTHORIZED';end if;
 select * into item from public.client_refund_requests where id=p_request and owner_id=actor for update;
 if not found then raise sqlstate 'PT404' using message='REFUND_REQUEST_NOT_FOUND';end if;
 perform private.ensure_active_project(item.project_id,actor);
 perform 1 from public.projects where id=item.project_id and owner_id=actor for update;
 -- Repeating the same click returns the refund it already created.
 if item.status='registered' then
  select * into parent from public.refund_settlements where id=item.settlement_id and owner_id=actor;
  select * into snap from public.refund_snapshots where id=parent.current_snapshot_id;
  return jsonb_build_object('settlement',to_jsonb(parent),'snapshot',to_jsonb(snap));
 end if;
 if (private.project_request_status(item.project_id)->>'can_register')::boolean is false then raise sqlstate 'PT409' using message='PROJECT_HAS_OPEN_REQUEST';end if;
 select * into pay from public.project_received_payments where id=item.received_payment_id and project_id=item.project_id and owner_id=actor for update;
 if not found then raise sqlstate 'PT404' using message='PAYMENT_NOT_FOUND';end if;
 if pay.origin='change' and not exists(select 1 from public.proposal_payments where id=pay.proposal_payment_id and status='completed' and capture_id=pay.capture_id and amount_minor=pay.amount_minor and merchant_id=pay.merchant_id) then raise sqlstate 'PT409' using message='REFUND_PAYMENT_NOT_ELIGIBLE';end if;
 previous:=private.refund_previous(pay.id);
 if item.requested_minor<>pay.amount_minor-previous then raise sqlstate 'PT409' using message='REFUND_REQUEST_NOT_FULL';end if;
 insert into public.refund_settlements(owner_id,project_id,payment_id,scope,reason,requested_by,request_evidence)
  values(actor,item.project_id,pay.id,'payment_only',item.reason,'customer','[]'::jsonb) returning * into parent;
 insert into public.refund_settlement_payments values(parent.id,pay.id,item.project_id,actor);
 insert into public.refund_events(settlement_id,project_id,owner_id,actor_id,event_type) values(parent.id,item.project_id,actor,actor,'request_registered');
 terms:=jsonb_build_object('currency','USD','adjustments','[]'::jsonb,'proposed_refund_minor',item.requested_minor,
  'conditions','Full refund requested by the client from their Trato space on '||to_char(item.created_at at time zone 'UTC','YYYY-MM-DD')||'.');
 prepared:=private.refund_prepare(terms,pay.amount_minor,previous,item.project_id,actor);
 payments:=jsonb_build_array(jsonb_build_object('payment_id',pay.id,'origin',pay.origin,'capture_id',pay.capture_id,'merchant_id',pay.merchant_id,'amount_minor',pay.amount_minor,'currency',pay.currency,'local_previous_refunds_minor',previous,'refund_minor',item.requested_minor));
 insert into public.refund_snapshots(settlement_id,project_id,owner_id,version_no,draft_sequence,previous_snapshot_id,terms,breakdown,payments,feedback,content_sha256)
  values(parent.id,item.project_id,actor,1,1,null,terms,prepared->'breakdown',payments,null,
   encode(sha256(convert_to(jsonb_build_object('terms',terms,'breakdown',prepared->'breakdown','payments',payments,'facts',prepared->'facts','feedback',null)::text,'UTF8')),'hex')) returning * into snap;
 update public.refund_settlements set current_snapshot_id=snap.id,updated_at=now() where id=parent.id returning * into parent;
 insert into public.refund_events(settlement_id,snapshot_id,project_id,owner_id,actor_id,event_type) values(parent.id,snap.id,item.project_id,actor,actor,'draft_saved');
 update public.client_refund_requests set status='registered',settlement_id=parent.id,updated_at=now() where id=item.id;
 return jsonb_build_object('settlement',to_jsonb(parent),'snapshot',to_jsonb(snap));
end $$;

create or replace function public.client_refund_request_accept(p_request uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();item public.client_refund_requests;parent public.refund_settlements;snap public.refund_snapshots;artifact public.refund_artifacts;
begin
 if actor is null then raise sqlstate 'PT401' using message='UNAUTHORIZED';end if;
 select * into item from public.client_refund_requests where id=p_request and owner_id=actor and status='registered' for update;
 if not found then raise sqlstate 'PT404' using message='REFUND_REQUEST_NOT_FOUND';end if;
 select * into parent from public.refund_settlements where id=item.settlement_id and owner_id=actor for update;
 if parent.status<>'draft' then return jsonb_build_object('settlement',to_jsonb(parent));end if;
 select * into snap from public.refund_snapshots where id=parent.current_snapshot_id;
 -- Only the single version this request created: full refund, no deductions, nothing sent or edited since.
 if snap.version_no<>1 or snap.draft_sequence<>1 or jsonb_array_length(snap.terms->'adjustments')<>0
  or (snap.breakdown->>'refund_minor')::bigint<>item.requested_minor or parent.payment_id<>item.received_payment_id
  or exists(select 1 from public.refund_deliveries where snapshot_id=snap.id)
 then raise sqlstate 'PT409' using message='REFUND_REQUEST_CHANGED';end if;
 select * into artifact from public.refund_artifacts where snapshot_id=snap.id and document_id is not null;
 if not found then raise sqlstate 'PT409' using message='REFUND_PDF_REQUIRED';end if;
 insert into public.refund_acceptances(snapshot_id,settlement_id,project_id,owner_id,artifact_id,evidence,reviewer_id,review_notes,method)
  values(snap.id,parent.id,parent.project_id,actor,artifact.id,
   jsonb_build_object('client_request_id',item.id,'client_user_id',item.client_user_id,'client_email',item.client_email,'requested_minor',item.requested_minor,'reason',item.reason,'requested_at',item.created_at),
   actor,'Requested by the client from their Trato space.','client_portal_request');
 update public.refund_settlements set status='accepted',updated_at=now() where id=parent.id returning * into parent;
 insert into public.refund_events(settlement_id,snapshot_id,project_id,owner_id,actor_id,event_type,notes) values(parent.id,snap.id,parent.project_id,actor,actor,'acceptance_recorded','Requested by the client from their Trato space.');
 return jsonb_build_object('settlement',to_jsonb(parent));
end $$;

revoke all on function public.client_refund_request_settle(uuid) from public, anon;
revoke all on function public.client_refund_request_accept(uuid) from public, anon;
grant execute on function public.client_refund_request_settle(uuid) to authenticated;
grant execute on function public.client_refund_request_accept(uuid) to authenticated;
