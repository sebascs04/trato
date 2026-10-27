begin;
alter table public.proposal_revisions add column draft_sequence integer not null default 1 check(draft_sequence>0);
alter table public.proposal_revisions add column replaces_draft_id uuid;
alter table public.proposal_revisions add column feedback_document_id uuid;
alter table public.proposal_revisions add column feedback_notes text check(feedback_notes is null or length(trim(feedback_notes)) between 1 and 4000);
alter table public.proposal_revisions drop constraint proposal_revisions_proposal_id_revision_no_key;
alter table public.proposal_revisions add unique(proposal_id,revision_no,draft_sequence);
alter table public.proposal_revisions add foreign key(replaces_draft_id,proposal_id,project_id,owner_id) references public.proposal_revisions(id,proposal_id,project_id,owner_id);
alter table public.proposal_revisions add foreign key(feedback_document_id,project_id,owner_id) references public.documents(id,project_id,owner_id);
create index revision_draft_parent_idx on public.proposal_revisions(replaces_draft_id,proposal_id,project_id,owner_id);
create index revision_feedback_idx on public.proposal_revisions(feedback_document_id,project_id,owner_id);
alter table public.proposal_events drop constraint proposal_events_event_type_check;
alter table public.proposal_events add check(event_type in('revision_created','draft_updated','proposal_reviewed','acceptance_recorded'));
do $migration$ declare definition text; needle text; replacement text; begin
 definition:=pg_get_functiondef('private.proposal_command(text,jsonb,text)'::regprocedure);
 needle:=$n$('create','revise','review','accept','attach_pdf')$n$;
 if position(needle in definition)=0 then raise exception 'Proposal command action guard changed';end if;
 definition:=replace(definition,needle,$n$('create','revise','review','accept','attach_pdf','edit_draft')$n$);
 needle:=$n$ if p_action in ('create','revise') then
  revision:=private.proposal_revision(p.id,p_data->'terms',p_data->'source_document_ids');$n$;
 replacement:=$n$ if p_action in ('create','revise','edit_draft') then
  if p_action<>'create' then select * into r from public.proposal_revisions where id=p.current_revision_id;end if;
  if p_action='edit_draft' then
   if p.status not in('draft','ready_for_review') or exists(select 1 from public.proposal_acceptances where revision_id=r.id)
    or exists(select 1 from public.proposal_deliveries where revision_id=r.id and status in('sending','accepted_by_gmail','delivery_uncertain'))
    or exists(select 1 from public.proposal_payments where proposal_id=p.id) then raise sqlstate 'PT409' using message='DRAFT_ALREADY_SENT';end if;
  end if;
  if p_action='revise' then
   if not exists(select 1 from public.proposal_deliveries where revision_id=r.id and kind='adenda' and status='accepted_by_gmail') then raise sqlstate 'PT409' using message='CLIENT_FEEDBACK_REQUIRED';end if;
   if jsonb_typeof(p_data->'feedback_notes') is distinct from 'string' or length(trim(p_data->>'feedback_notes')) not between 1 and 4000 then raise sqlstate 'PT422' using message='CLIENT_FEEDBACK_REQUIRED';end if;
   if not exists(select 1 from public.documents where id=(p_data->>'feedback_document_id')::uuid and owner_id=u and project_id=project and kind='reference')
    or not (p_data->'source_document_ids') @> jsonb_build_array(p_data->>'feedback_document_id') then raise sqlstate 'PT422' using message='CLIENT_FEEDBACK_REQUIRED';end if;
  end if;
  revision:=private.proposal_revision(p.id,p_data->'terms',p_data->'source_document_ids');
  if p_action='edit_draft' then
   update public.proposal_revisions set revision_no=r.revision_no,draft_sequence=r.draft_sequence+1,replaces_draft_id=r.id where id=revision;
  elsif p_action='revise' then
   update public.proposal_revisions set feedback_document_id=(p_data->>'feedback_document_id')::uuid,feedback_notes=trim(p_data->>'feedback_notes') where id=revision;
  end if;$n$;
 if position(needle in definition)=0 then raise exception 'Proposal revision branch changed';end if;
 definition:=replace(definition,needle,replacement);
 needle:=$n$values(u,project,p.id,r.id,'revision_created',u) on conflict(revision_id,event_type) do nothing;$n$;
 if position(needle in definition)=0 then raise exception 'PDF event branch changed';end if;
 definition:=replace(definition,needle,$n$values(u,project,p.id,r.id,case when r.replaces_draft_id is null then 'revision_created' else 'draft_updated' end,u) on conflict(revision_id,event_type) do nothing;$n$);
 execute definition;
end $migration$;
commit;
