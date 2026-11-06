begin;
-- Structural upload context is independent of AI feature flags and inference.
create table public.document_upload_contexts (
 document_id uuid primary key,
 project_id uuid not null,
 owner_id uuid not null,
 purpose text not null check (purpose in ('initial_agreement','change_request','supporting_reference','delivery_evidence','addendum_adjustments','acceptance_evidence','generated_addendum','refund_request','refund_evidence')),
 request_document_id uuid,
 proposal_id uuid,
 revision_id uuid,
 refund_case_id uuid,
 snapshot_id uuid,
 payment_id uuid,
 created_at timestamptz not null default now(),
 foreign key(document_id,project_id,owner_id) references public.documents(id,project_id,owner_id),
 foreign key(request_document_id,project_id,owner_id) references public.documents(id,project_id,owner_id),
 foreign key(revision_id,proposal_id,project_id,owner_id) references public.proposal_revisions(id,proposal_id,project_id,owner_id),
 foreign key(refund_case_id,project_id,owner_id) references public.refund_settlements(id,project_id,owner_id),
 foreign key(snapshot_id,refund_case_id,project_id,owner_id) references public.refund_snapshots(id,settlement_id,project_id,owner_id),
 foreign key(payment_id,project_id,owner_id) references public.project_received_payments(id,project_id,owner_id),
 check ((revision_id is null)=(proposal_id is null)),
 check (snapshot_id is null or refund_case_id is not null)
);
create index document_upload_contexts_owner_project on public.document_upload_contexts(owner_id,project_id);
alter table public.document_upload_contexts enable row level security;
revoke all on public.document_upload_contexts from public,anon,authenticated;
grant select on public.document_upload_contexts to authenticated;
grant all on public.document_upload_contexts to service_role;
create policy document_upload_context_owner on public.document_upload_contexts for select to authenticated
 using(owner_id=(select auth.uid()) and exists(select 1 from public.projects p join public.clients c on c.id=p.client_id
  where p.id=project_id and p.owner_id=(select auth.uid()) and p.deleted_at is null and c.deleted_at is null));

create function private.reserve_document_with_context(p_project_id uuid,p_title text,p_kind text,p_filename text,
 p_mime text,p_size integer,p_sha256 text,p_key text,p_context jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); result jsonb; ctx jsonb:=coalesce(p_context,'{}'); purpose text;
 request_id uuid; proposal uuid; revision uuid; refund uuid; snapshot uuid; payment uuid;
 expected public.document_upload_contexts; actual public.document_upload_contexts;
begin
 if u is null then raise sqlstate 'PT401' using message='UNAUTHORIZED';end if;
 perform private.ensure_active_project(p_project_id,u);
 if jsonb_typeof(ctx)<>'object' or exists(select 1 from jsonb_object_keys(ctx) k where k not in('purpose','request_id','revision_id','refund_case_id','snapshot_id','payment_id'))
 then raise sqlstate 'PT422' using message='FILE_PURPOSE_CONTEXT_INVALID';end if;
 purpose:=coalesce(ctx->>'purpose',case p_kind when 'initial_agreement' then 'initial_agreement' when 'email_request' then 'change_request'
  when 'delivery' then 'delivery_evidence' else 'supporting_reference' end);
 if purpose not in('initial_agreement','change_request','supporting_reference','delivery_evidence','addendum_adjustments','acceptance_evidence','generated_addendum','refund_request','refund_evidence')
 then raise sqlstate 'PT422' using message='FILE_PURPOSE_CONTEXT_INVALID';end if;
 begin
  request_id:=(ctx->>'request_id')::uuid;revision:=(ctx->>'revision_id')::uuid;
  refund:=(ctx->>'refund_case_id')::uuid;snapshot:=(ctx->>'snapshot_id')::uuid;payment:=(ctx->>'payment_id')::uuid;
 exception when invalid_text_representation then raise sqlstate 'PT422' using message='FILE_PURPOSE_CONTEXT_INVALID';end;
 if (purpose='initial_agreement' and p_kind<>'initial_agreement') or (purpose='change_request' and p_kind<>'email_request')
 or (purpose='delivery_evidence' and p_kind<>'delivery') or (purpose='supporting_reference' and p_kind<>'reference')
 or (purpose='addendum_adjustments' and (p_kind<>'reference' or revision is null))
 or (purpose in('acceptance_evidence','generated_addendum') and (p_kind not in('reference','addendum') or revision is null))
 or (purpose in('refund_request','refund_evidence') and p_kind not in('reference','addendum'))
 then raise sqlstate 'PT422' using message='FILE_PURPOSE_CONTEXT_INVALID';end if;
 if revision is not null then
  if purpose not in('addendum_adjustments','acceptance_evidence','generated_addendum') or refund is not null or snapshot is not null or payment is not null
  then raise sqlstate 'PT422' using message='FILE_PURPOSE_CONTEXT_INVALID';end if;
  select r.proposal_id,p.request_document_id into proposal,request_id from public.proposal_revisions r
   join public.change_proposals p on p.id=r.proposal_id and p.owner_id=r.owner_id and p.project_id=r.project_id
   where r.id=revision and r.project_id=p_project_id and r.owner_id=u;
  if not found or (ctx ? 'request_id' and (ctx->>'request_id')::uuid is distinct from request_id)
  then raise sqlstate 'PT409' using message='FILE_PURPOSE_CONTEXT_INVALID';end if;
 end if;
 if request_id is not null and not exists(select 1 from public.documents d where d.id=request_id and d.kind='email_request' and d.project_id=p_project_id and d.owner_id=u)
 then raise sqlstate 'PT409' using message='FILE_PURPOSE_CONTEXT_INVALID';end if;
 if purpose in('initial_agreement','change_request') and (request_id is not null or revision is not null or refund is not null or snapshot is not null or payment is not null)
 then raise sqlstate 'PT422' using message='FILE_PURPOSE_CONTEXT_INVALID';end if;
 if refund is not null or snapshot is not null or payment is not null then
  if purpose not in('refund_request','refund_evidence') or request_id is not null or revision is not null
  then raise sqlstate 'PT422' using message='FILE_PURPOSE_CONTEXT_INVALID';end if;
 end if;
 if refund is not null then
  select r.payment_id into payment from public.refund_settlements r where r.id=refund and r.project_id=p_project_id and r.owner_id=u;
  if not found or (ctx ? 'payment_id' and (ctx->>'payment_id')::uuid is distinct from payment)
  then raise sqlstate 'PT409' using message='FILE_PURPOSE_CONTEXT_INVALID';end if;
 end if;
 if snapshot is not null and (refund is null or not exists(select 1 from public.refund_snapshots s where s.id=snapshot and s.settlement_id=refund and s.project_id=p_project_id and s.owner_id=u))
 then raise sqlstate 'PT409' using message='FILE_PURPOSE_CONTEXT_INVALID';end if;
 if payment is not null and not exists(select 1 from public.project_received_payments p where p.id=payment and p.project_id=p_project_id and p.owner_id=u)
 then raise sqlstate 'PT409' using message='FILE_PURPOSE_CONTEXT_INVALID';end if;
 -- Both records commit together, before any Storage POST or work publication.
 result:=private.reserve_document(p_project_id,p_title,p_kind,p_filename,p_mime,p_size,p_sha256,p_key);
 expected.document_id:=(result->'document'->>'id')::uuid;expected.project_id:=p_project_id;expected.owner_id:=u;expected.purpose:=purpose;
 expected.request_document_id:=case when purpose='change_request' then expected.document_id else request_id end;
 expected.proposal_id:=proposal;expected.revision_id:=revision;expected.refund_case_id:=refund;expected.snapshot_id:=snapshot;expected.payment_id:=payment;
 insert into public.document_upload_contexts(document_id,project_id,owner_id,purpose,request_document_id,proposal_id,revision_id,refund_case_id,snapshot_id,payment_id)
 values(expected.document_id,p_project_id,u,purpose,expected.request_document_id,proposal,revision,refund,snapshot,payment)
 on conflict(document_id) do nothing;
 select * into actual from public.document_upload_contexts where document_id=expected.document_id;
 if (to_jsonb(actual)-'created_at') is distinct from (to_jsonb(expected)-'created_at')
 then raise sqlstate 'PT409' using message='DOCUMENT_CONTEXT_CONFLICT';end if;
 return result;
end $$;
revoke all on function private.reserve_document_with_context(uuid,text,text,text,text,integer,text,text,jsonb) from public,anon;
grant execute on function private.reserve_document_with_context(uuid,text,text,text,text,integer,text,text,jsonb) to authenticated;
create function public.reserve_document_with_context(p_project_id uuid,p_title text,p_kind text,p_filename text,
 p_mime text,p_size integer,p_sha256 text,p_key text,p_context jsonb)
returns jsonb language sql security invoker set search_path='' as $$
 select private.reserve_document_with_context(p_project_id,p_title,p_kind,p_filename,p_mime,p_size,p_sha256,p_key,p_context);
$$;
revoke all on function public.reserve_document_with_context(uuid,text,text,text,text,integer,text,text,jsonb) from public,anon;
grant execute on function public.reserve_document_with_context(uuid,text,text,text,text,integer,text,text,jsonb) to authenticated;
commit;
