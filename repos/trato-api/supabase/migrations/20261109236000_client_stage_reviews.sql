-- The client reviews each Work plan delivery from their account: approve it or request changes, like an addendum.
-- The decision is recorded once per delivery document (who, when, which document and its hash): evidence for a dispute.
-- Additive: payment preparation is unchanged; the freelancer sees the client's answer next to the deliverable.

create table if not exists public.project_stage_reviews(
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.projects(id) on delete cascade,
 owner_id uuid not null,
 stage_position integer not null check(stage_position between 1 and 8),
 document_id uuid not null references public.documents(id),
 document_sha256 text,
 decision text not null check(decision in('approved','changes_requested')),
 notes text check(notes is null or length(btrim(notes)) between 1 and 4000),
 client_user_id uuid not null,
 client_email text not null,
 created_at timestamptz not null default now(),
 unique(document_id),
 check(decision='approved' or notes is not null)
);
create index if not exists project_stage_reviews_project_idx on public.project_stage_reviews(project_id, stage_position);
alter table public.project_stage_reviews enable row level security;
do $$ begin
 if not exists(select 1 from pg_policies where tablename='project_stage_reviews' and policyname='owner reads client stage reviews') then
  create policy "owner reads client stage reviews" on public.project_stage_reviews for select to authenticated using(owner_id=(select auth.uid()));
 end if;
end $$;
revoke all on public.project_stage_reviews from anon;
grant select on public.project_stage_reviews to authenticated;

-- The latest processed delivery of a stage: what the client reviews.
create or replace function private.stage_delivery(p_project uuid,p_position integer)
returns table(id uuid,title text,sha256 text) language sql stable security definer set search_path='' as $$
 select d.id,d.title,d.sha256 from public.document_upload_contexts x join public.documents d on d.id=x.document_id
 where x.project_id=p_project and x.stage_position=p_position and x.purpose='delivery_evidence' and d.deleted_at is null
  and exists(select 1 from public.document_extractions e where e.document_id=d.id and e.status='ready')
 order by x.created_at desc limit 1
$$;

-- A client-role account whose verified email is the project's client email (same rule as the client's agreements).
create or replace function private.client_project(p_user uuid,p_project uuid)
returns table(project_id uuid,owner_id uuid,email text) language sql stable security definer set search_path='' as $$
 select pj.id,pj.owner_id,u.email::text from auth.users u
 join public.account_roles ar on ar.user_id=u.id and ar.role='client'
 join public.clients c on lower(btrim(c.contact_email))=lower(btrim(u.email)) and c.deleted_at is null
 join public.projects pj on pj.client_id=c.id and pj.owner_id=c.owner_id and pj.deleted_at is null
 where u.id=p_user and pj.id=p_project and u.deleted_at is null and u.email_confirmed_at is not null
$$;

create or replace function public.client_account_project_plans(p_user uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(x order by x.project_name, x.position),'[]'::jsonb) from (
  select pj.id project_id, pj.name project_name, fu.email freelancer_email,
   s.position, s.title, s.amount, s.payment_condition,
   ck.status payment_status, ck.method payment_method, ck.paid_at, ck.output_language,
   case when ck.method='invoice' and ck.status='pending_approval' then ck.invoice_url end invoice_url,
   case when ck.method='invoice' then ck.invoice_number end invoice_number,
   case when ck.method='order' and ck.status='pending_approval' and ck.order_id is not null and ck.mail_status='sent' then ck.checkout_token end checkout_token,
   ev.id delivery_document_id, ev.title delivery_title,
   rv.decision review_decision, rv.notes review_notes, rv.created_at reviewed_at
  from auth.users u
  join public.account_roles ar on ar.user_id=u.id and ar.role='client'
  join public.clients c on lower(btrim(c.contact_email))=lower(btrim(u.email)) and c.deleted_at is null
  join auth.users fu on fu.id=c.owner_id
  join public.projects pj on pj.client_id=c.id and pj.owner_id=c.owner_id and pj.deleted_at is null
  join public.project_start_stages s on s.project_id=pj.id
  left join public.project_initial_checkouts ck on ck.project_id=pj.id and ck.stage_position=s.position
  left join lateral private.stage_delivery(pj.id,s.position) ev on true
  left join public.project_stage_reviews rv on rv.document_id=ev.id
  where u.id=p_user and u.deleted_at is null and u.email_confirmed_at is not null
 ) x
$$;

-- The delivery PDF the client may open: only the latest processed delivery of a stage of their project.
create or replace function public.client_stage_delivery(p_user uuid,p_project uuid,p_position integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare scope record;doc public.documents;
begin
 select * into scope from private.client_project(p_user,p_project);
 if not found then raise sqlstate 'PT404' using message='PROJECT_NOT_FOUND'; end if;
 select d.* into doc from public.documents d where d.id=(select id from private.stage_delivery(p_project,p_position));
 if not found then raise sqlstate 'PT404' using message='STAGE_DELIVERY_NOT_FOUND'; end if;
 return jsonb_build_object('id',doc.id,'project_id',doc.project_id,'storage_path',doc.storage_path,'size_bytes',doc.size_bytes,
  'sha256',doc.sha256,'original_filename',doc.original_filename,'mime_type',doc.mime_type);
end $$;

create or replace function public.client_stage_review(p_user uuid,p_project uuid,p_position integer,p_document uuid,p_decision text,p_notes text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare scope record;delivery record;review public.project_stage_reviews;
begin
 select * into scope from private.client_project(p_user,p_project);
 if not found then raise sqlstate 'PT404' using message='PROJECT_NOT_FOUND'; end if;
 perform 1 from public.projects where id=p_project for update;
 if p_decision not in('approved','changes_requested') then raise sqlstate 'PT422' using message='INVALID_STAGE_REVIEW'; end if;
 if p_decision='changes_requested' and (p_notes is null or length(btrim(p_notes)) not between 1 and 4000) then raise sqlstate 'PT422' using message='CHANGE_REQUEST_NOTES_REQUIRED'; end if;
 select * into delivery from private.stage_delivery(p_project,p_position);
 -- The client answers the delivery they saw: a newer upload makes the old one stale.
 if not found or delivery.id<>p_document then raise sqlstate 'PT409' using message='STAGE_DELIVERY_CHANGED'; end if;
 if exists(select 1 from public.project_initial_checkouts where project_id=p_project and stage_position=p_position and status='completed') then
  raise sqlstate 'PT409' using message='STAGE_ALREADY_PAID';
 end if;
 select * into review from public.project_stage_reviews where document_id=p_document;
 if found then return to_jsonb(review); end if;  -- One answer per delivery; a retry returns it unchanged.
 insert into public.project_stage_reviews(project_id,owner_id,stage_position,document_id,document_sha256,decision,notes,client_user_id,client_email)
  values(p_project,scope.owner_id,p_position,p_document,delivery.sha256,p_decision,nullif(btrim(coalesce(p_notes,'')),''),p_user,scope.email)
  returning * into review;
 return to_jsonb(review);
end $$;

revoke all on function private.stage_delivery(uuid,integer) from public,anon,authenticated;
revoke all on function private.client_project(uuid,uuid) from public,anon,authenticated;
revoke all on function public.client_account_project_plans(uuid) from public,anon,authenticated;
revoke all on function public.client_stage_delivery(uuid,uuid,integer) from public,anon,authenticated;
revoke all on function public.client_stage_review(uuid,uuid,integer,uuid,text,text) from public,anon,authenticated;
grant execute on function public.client_account_project_plans(uuid) to service_role;
grant execute on function public.client_stage_delivery(uuid,uuid,integer) to service_role;
grant execute on function public.client_stage_review(uuid,uuid,integer,uuid,text,text) to service_role;
