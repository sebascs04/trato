-- Initial Supabase source of truth. Not applied automatically by the demo.
begin;
create table public.clients (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null default auth.uid() references auth.users(id),
 name text not null check(length(trim(name)) between 1 and 200),
 contact_email text,
 created_at timestamptz not null default now(),
 unique(id,owner_id)
);
create table public.projects (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid() references auth.users(id),
 client_id uuid not null, name text not null check(length(trim(name)) between 1 and 200),
 status text not null default 'draft' check(status in ('draft','active','closed')),
 created_at timestamptz not null default now(), unique(id,owner_id),
 foreign key(client_id,owner_id) references public.clients(id,owner_id)
);
create table public.documents (
 id uuid primary key default gen_random_uuid(),owner_id uuid not null default auth.uid() references auth.users(id),
 project_id uuid not null, title text not null, storage_path text not null unique,
 kind text not null check(kind in ('initial_agreement','email_request','addendum','delivery')),
 sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
 origin_status text not null default 'unverified' check(origin_status in ('unverified','verified')),
 created_at timestamptz not null default now(),unique(id,project_id,owner_id),
 foreign key(project_id,owner_id) references public.projects(id,owner_id)
);
create table public.agreement_versions (
 id uuid primary key default gen_random_uuid(),owner_id uuid not null default auth.uid() references auth.users(id),
 project_id uuid not null,document_id uuid not null,version integer not null check(version>0),
 status text not null default 'draft' check(status in ('draft','pending_signature','accepted','superseded')),
 content text not null,accepted_at timestamptz,signature_evidence jsonb,
 created_at timestamptz not null default now(),unique(project_id,version),unique(id,project_id,owner_id),
 foreign key(project_id,owner_id) references public.projects(id,owner_id),
 foreign key(document_id,project_id,owner_id) references public.documents(id,project_id,owner_id),
 check(status not in ('accepted','superseded') or (accepted_at is not null and signature_evidence is not null))
);
create unique index one_active_agreement on public.agreement_versions(project_id) where status='accepted';
create table public.change_requests (
 id uuid primary key default gen_random_uuid(),owner_id uuid not null default auth.uid() references auth.users(id),
 project_id uuid not null,source_document_id uuid not null,agreement_version_id uuid not null,
 subject text not null,sender_email text not null,email_date date not null,message text not null,
 status text not null default 'pending_confirmation' check(status in ('pending_confirmation','pending_analysis','needs_clarification','blocked','analysis_ready','draft_ready','pending_signature','accepted','rejected')),
 created_at timestamptz not null default now(),unique(id,owner_id),
 foreign key(project_id,owner_id) references public.projects(id,owner_id),
 foreign key(source_document_id,project_id,owner_id) references public.documents(id,project_id,owner_id),
 foreign key(agreement_version_id,project_id,owner_id) references public.agreement_versions(id,project_id,owner_id)
);
create table public.workflow_runs (
 id uuid primary key default gen_random_uuid(),owner_id uuid not null default auth.uid() references auth.users(id),
 request_id uuid not null,status text not null,mode text not null check(mode in ('simulation','connected')),
 checkpoint_thread_id text not null unique,created_at timestamptz not null default now(),
 foreign key(request_id,owner_id) references public.change_requests(id,owner_id)
);
-- The API may expose user data for reading/ingestion, but accepted agreements,
-- verification flags and financial transitions must be written by backend roles.
do $$ declare t text; begin
 foreach t in array array['clients','projects','documents','agreement_versions','change_requests','workflow_runs'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('create policy own_rows on public.%I for select to authenticated using (owner_id = (select auth.uid()))',t);
  execute format('revoke all on public.%I from anon, authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
 end loop;
end $$;
create policy create_own_client on public.clients for insert to authenticated with check(owner_id=(select auth.uid()));
create policy create_own_project on public.projects for insert to authenticated with check(owner_id=(select auth.uid()));
grant insert(name,contact_email) on public.clients to authenticated;
grant insert(client_id,name) on public.projects to authenticated;
create index clients_owner on public.clients(owner_id);
create index projects_owner on public.projects(owner_id);
create index documents_project_owner on public.documents(project_id,owner_id);
create index agreement_project_owner on public.agreement_versions(project_id,owner_id);
create index requests_project_owner on public.change_requests(project_id,owner_id);
create index runs_owner on public.workflow_runs(owner_id);
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('project-documents','project-documents',false,10485760,array['application/pdf'])
 on conflict(id) do nothing;
-- Paths: <owner UUID>/<project UUID>/<document UUID>.pdf.
-- Upload authorization will be mediated by backend; no public write policy.
create policy read_project_pdf on storage.objects for select to authenticated
 using(bucket_id='project-documents' and exists (
  select 1 from public.documents d where d.storage_path=name and d.owner_id=(select auth.uid())
 ));
commit;
