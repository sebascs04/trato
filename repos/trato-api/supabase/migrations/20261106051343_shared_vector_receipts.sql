begin;
create table public.document_vector_receipts (
 document_id uuid primary key,
 owner_id uuid not null,
 project_id uuid not null,
 receipt jsonb not null,
 foreign key(document_id,project_id,owner_id) references public.documents(id,project_id,owner_id) on delete cascade,
 check(jsonb_typeof(receipt)='object'),
 check(receipt->>'status' in ('ready','indexing','failed')),
 check(receipt ?& array['status','generation','project_id']),
 check(receipt->>'generation' ~ '^[a-f0-9]{64}$'),
 check(receipt->>'project_id'=project_id::text),
 check(receipt->>'status'<>'ready' or (
  receipt ?& array['id','embedding_identity','objects'] and receipt->>'id'=document_id::text
  and receipt->>'embedding_identity' ~ '^[a-f0-9]{64}$'
  and (receipt->>'objects')::integer > 0))
);
alter table public.document_vector_receipts enable row level security;
revoke all on public.document_vector_receipts from public,anon,authenticated;
grant select,insert,update,delete on public.document_vector_receipts to service_role;
create index document_vector_receipts_owner_project on public.document_vector_receipts(owner_id,project_id);
commit;
