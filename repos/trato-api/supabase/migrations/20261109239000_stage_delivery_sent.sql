-- The freelancer sends a Work plan delivery to the client on purpose: uploading it is not sending it.
-- The client sees (and can approve) only the latest delivery the freelancer sent; the send is recorded with its date.
create table if not exists public.project_stage_delivery_shares(
 document_id uuid primary key references public.documents(id),
 project_id uuid not null references public.projects(id) on delete cascade,
 owner_id uuid not null,
 stage_position integer not null check(stage_position between 1 and 8),
 shared_at timestamptz not null default now()
);
alter table public.project_stage_delivery_shares enable row level security;
do $$ begin
 if not exists(select 1 from pg_policies where tablename='project_stage_delivery_shares' and policyname='owner reads sent deliveries') then
  create policy "owner reads sent deliveries" on public.project_stage_delivery_shares for select to authenticated using(owner_id=(select auth.uid()));
 end if;
end $$;
revoke all on public.project_stage_delivery_shares from anon;
grant select on public.project_stage_delivery_shares to authenticated;

-- What the client reviews: the latest delivery of the stage that the freelancer sent.
create or replace function private.stage_delivery(p_project uuid,p_position integer)
returns table(id uuid,title text,sha256 text) language sql stable security definer set search_path='' as $$
 select d.id,d.title,d.sha256 from public.document_upload_contexts x join public.documents d on d.id=x.document_id
 join public.project_stage_delivery_shares sh on sh.document_id=d.id
 where x.project_id=p_project and x.stage_position=p_position and x.purpose='delivery_evidence' and d.deleted_at is null
  and d.storage_path is not null
 order by sh.shared_at desc limit 1
$$;
revoke all on function private.stage_delivery(uuid,integer) from public,anon,authenticated;

-- The freelancer sends the stage's latest uploaded delivery. Sending it again returns the same record.
create or replace function public.stage_delivery_share(p_owner uuid,p_project uuid,p_position integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare doc uuid;share public.project_stage_delivery_shares;
begin
 if p_owner is null then raise sqlstate 'PT403' using message='OWNER_REQUIRED'; end if;
 perform 1 from public.projects where id=p_project and owner_id=p_owner and deleted_at is null for update;
 if not found then raise sqlstate 'PT404' using message='PROJECT_NOT_FOUND'; end if;
 select d.id into doc from public.document_upload_contexts x join public.documents d on d.id=x.document_id
  where x.project_id=p_project and x.owner_id=p_owner and x.stage_position=p_position and x.purpose='delivery_evidence'
   and d.deleted_at is null and d.storage_path is not null
  order by x.created_at desc limit 1;
 if doc is null then raise sqlstate 'PT409' using message='PLAN_EVIDENCE_REQUIRED'; end if;
 insert into public.project_stage_delivery_shares(document_id,project_id,owner_id,stage_position) values(doc,p_project,p_owner,p_position)
  on conflict(document_id) do nothing;
 select * into share from public.project_stage_delivery_shares where document_id=doc;
 return to_jsonb(share);
end $$;
revoke all on function public.stage_delivery_share(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.stage_delivery_share(uuid,uuid,integer) to service_role;
