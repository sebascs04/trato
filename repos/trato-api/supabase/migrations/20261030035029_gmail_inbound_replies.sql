begin;

alter table public.proposal_deliveries add column provider_thread_id text;
alter table public.proposal_deliveries add column provider_rfc_message_id text;
alter table public.proposal_deliveries add constraint proposal_delivery_thread_id_shape
 check(provider_thread_id is null or provider_thread_id ~ '^[A-Za-z0-9_-]{1,200}$');
alter table public.proposal_deliveries add constraint proposal_delivery_rfc_message_id_shape
 check(provider_rfc_message_id is null or length(provider_rfc_message_id) between 3 and 998);
alter table public.proposal_deliveries add constraint proposal_delivery_scope_unique
 unique(id,proposal_id,project_id,owner_id);

create table public.gmail_inbound_messages(
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null,
 project_id uuid not null,
 proposal_id uuid not null,
 revision_id uuid not null,
 delivery_id uuid not null,
 mailbox_email text not null check(length(mailbox_email) between 3 and 320),
 provider_message_id text not null check(provider_message_id ~ '^[A-Za-z0-9_-]{1,256}$'),
 provider_thread_id text not null check(provider_thread_id ~ '^[A-Za-z0-9_-]{1,200}$'),
 from_email text not null check(length(from_email) between 3 and 320),
 to_emails jsonb not null check(jsonb_typeof(to_emails)='array' and jsonb_array_length(to_emails) between 1 and 20),
 subject text not null check(length(subject)<=1000),
 received_at timestamptz not null,
 in_reply_to text check(in_reply_to is null or length(in_reply_to)<=998),
 references_header text check(references_header is null or length(references_header)<=4000),
 body_text text not null check(length(body_text)<=50000),
 body_sha256 text not null check(body_sha256 ~ '^[a-f0-9]{64}$'),
 attachment_metadata jsonb not null default '[]'::jsonb check(jsonb_typeof(attachment_metadata)='array' and jsonb_array_length(attachment_metadata)<=5),
 used_at timestamptz,
 created_at timestamptz not null default now(),
 unique(owner_id,mailbox_email,provider_message_id),
 unique(id,proposal_id,project_id,owner_id),
 foreign key(delivery_id,proposal_id,project_id,owner_id)
  references public.proposal_deliveries(id,proposal_id,project_id,owner_id),
 foreign key(revision_id,proposal_id,project_id,owner_id)
  references public.proposal_revisions(id,proposal_id,project_id,owner_id),
 check(coalesce(length(in_reply_to),0)>0 or coalesce(length(references_header),0)>0)
);
alter table public.gmail_inbound_messages enable row level security;
revoke all on public.gmail_inbound_messages from public,anon,authenticated;
create index gmail_inbound_proposal_idx on public.gmail_inbound_messages(owner_id,project_id,proposal_id,received_at desc);
alter table public.proposal_revisions add column feedback_email_id uuid;
alter table public.proposal_revisions add constraint proposal_revision_feedback_email_fk
 foreign key(feedback_email_id,proposal_id,project_id,owner_id)
 references public.gmail_inbound_messages(id,proposal_id,project_id,owner_id);
create index revision_feedback_email_idx on public.proposal_revisions(feedback_email_id,proposal_id,project_id,owner_id);

do $migration$
declare definition text; needle text; replacement text;
begin
 definition:=pg_get_functiondef('private.proposal_command(text,jsonb,text)'::regprocedure);
 needle:=$n$doc public.documents;$n$;
 replacement:=$n$doc public.documents; gmail_message public.gmail_inbound_messages;$n$;
 if position(needle in definition)=0 then raise exception 'Proposal command declaration changed';end if;
 definition:=replace(definition,needle,replacement);
 needle:=$n$   if not exists(select 1 from public.documents where id=(p_data->>'feedback_document_id')::uuid and owner_id=u and project_id=project and kind='reference')
    or not (p_data->'source_document_ids') @> jsonb_build_array(p_data->>'feedback_document_id') then raise sqlstate 'PT422' using message='CLIENT_FEEDBACK_REQUIRED';end if;$n$;
 replacement:=$n$   if p_data->>'feedback_email_id' is not null then
    select * into gmail_message from public.gmail_inbound_messages where id=(p_data->>'feedback_email_id')::uuid and owner_id=u and project_id=project and proposal_id=p.id and revision_id=r.id and used_at is null for update;
    if not found then raise sqlstate 'PT422' using message='CLIENT_FEEDBACK_REQUIRED';end if;
   if p_data->>'feedback_document_id' is not null and (not exists(select 1 from public.documents where id=(p_data->>'feedback_document_id')::uuid and owner_id=u and project_id=project and kind='reference')
    or not (p_data->'source_document_ids') @> jsonb_build_array(p_data->>'feedback_document_id')) then raise sqlstate 'PT422' using message='CLIENT_FEEDBACK_REQUIRED';end if;
   elsif p_data->>'feedback_document_id' is not null then
    if not exists(select 1 from public.documents where id=(p_data->>'feedback_document_id')::uuid and owner_id=u and project_id=project and kind='reference')
     or not (p_data->'source_document_ids') @> jsonb_build_array(p_data->>'feedback_document_id') then raise sqlstate 'PT422' using message='CLIENT_FEEDBACK_REQUIRED';end if;
   else raise sqlstate 'PT422' using message='CLIENT_FEEDBACK_REQUIRED';end if;$n$;
 if position(needle in definition)=0 then raise exception 'Proposal feedback evidence validation changed';end if;
 definition:=replace(definition,needle,replacement);
 needle:=$n$update public.proposal_revisions set feedback_document_id=(p_data->>'feedback_document_id')::uuid,feedback_notes=trim(p_data->>'feedback_notes') where id=revision;$n$;
 replacement:=$n$update public.proposal_revisions set feedback_document_id=(p_data->>'feedback_document_id')::uuid,feedback_email_id=(p_data->>'feedback_email_id')::uuid,feedback_notes=trim(p_data->>'feedback_notes') where id=revision;
  if p_data->>'feedback_email_id' is not null then update public.gmail_inbound_messages set used_at=now() where id=gmail_message.id and used_at is null; if not found then raise sqlstate 'PT409' using message='CLIENT_FEEDBACK_ALREADY_USED';end if;end if;$n$;
 if position(needle in definition)=0 then raise exception 'Proposal feedback evidence update changed';end if;
 definition:=replace(definition,needle,replacement);
 execute definition;
end $migration$;

do $migration$
declare definition text; needle text; replacement text;
begin
 definition:=pg_get_functiondef('private.proposal_backend(uuid,text,jsonb)'::regprocedure);
 needle:=$n$provider_message_id=p_data->>'message_id',error_code=p_data->>'error_code'$n$;
 replacement:=$n$provider_message_id=p_data->>'message_id',provider_thread_id=p_data->>'thread_id',error_code=p_data->>'error_code'$n$;
 if position(needle in definition)=0 then raise exception 'Proposal mail finish update changed';end if;
 definition:=replace(definition,needle,replacement);
 execute definition;
end $migration$;

create function private.gmail_inbox(p_owner uuid,p_action text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.change_proposals; r public.proposal_revisions; d public.proposal_deliveries; m public.gmail_inbound_messages;
 project uuid; mailbox text; targets jsonb;
begin
 if p_owner is null or jsonb_typeof(p_data) is distinct from 'object' then raise sqlstate 'PT422' using message='INVALID_GMAIL_INBOX_COMMAND';end if;
 if p_action='targets' then
  project:=(p_data->>'project_id')::uuid;
  if not exists(select 1 from public.projects where id=project and owner_id=p_owner) then raise sqlstate 'PT404' using message='PROJECT_NOT_FOUND';end if;
  select coalesce(jsonb_agg(q.target order by q.sent_at desc),'[]'::jsonb) into targets from (
   select jsonb_build_object(
    'proposal_id',p.id,'revision_id',r.id,'revision_no',r.revision_no,'delivery_id',d.id,
    'provider_message_id',d.provider_message_id,'provider_thread_id',d.provider_thread_id,'provider_rfc_message_id',d.provider_rfc_message_id,
    'recipient',d.recipient,'sent_at',d.updated_at,'client_email',c.contact_email
   ) as target,d.updated_at as sent_at
   from public.proposal_deliveries d
   join public.change_proposals p on p.id=d.proposal_id and p.project_id=d.project_id and p.owner_id=d.owner_id
   join public.proposal_revisions r on r.id=d.revision_id and r.proposal_id=d.proposal_id and r.project_id=d.project_id and r.owner_id=d.owner_id
   join public.projects pr on pr.id=p.project_id and pr.owner_id=p.owner_id
   join public.clients c on c.id=pr.client_id and c.owner_id=pr.owner_id
   where d.owner_id=p_owner and d.project_id=project and d.kind='adenda' and d.status='accepted_by_gmail'
    and d.provider_thread_id is not null and d.provider_message_id is not null
    and p.current_revision_id=r.id and p.status='ready_for_review' and p.locked_at is null
   order by d.updated_at desc limit 5
  ) q;
  return targets;
 elsif p_action='known' then
  if jsonb_typeof(p_data->'provider_message_ids') is distinct from 'array' or jsonb_array_length(p_data->'provider_message_ids')>100 then
   raise sqlstate 'PT422' using message='INVALID_GMAIL_MESSAGE';
  end if;
  if not exists(select 1 from public.proposal_deliveries where id=(p_data->>'delivery_id')::uuid and owner_id=p_owner and kind='adenda') then
   raise sqlstate 'PT404' using message='DELIVERY_NOT_FOUND';
  end if;
  select coalesce(jsonb_agg(i.provider_message_id),'[]'::jsonb) into targets
   from public.gmail_inbound_messages i
   where i.owner_id=p_owner and i.delivery_id=(p_data->>'delivery_id')::uuid
    and i.provider_message_id in (select jsonb_array_elements_text(p_data->'provider_message_ids'));
  return targets;
 elsif p_action='record_sent_header' then
  select * into d from public.proposal_deliveries where id=(p_data->>'delivery_id')::uuid and owner_id=p_owner and kind='adenda' and status='accepted_by_gmail' for update;
  if not found or d.provider_thread_id is distinct from p_data->>'provider_thread_id' then raise sqlstate 'PT404' using message='DELIVERY_NOT_FOUND';end if;
  if length(p_data->>'provider_rfc_message_id') not between 3 and 998 or (d.provider_rfc_message_id is not null and d.provider_rfc_message_id<>p_data->>'provider_rfc_message_id') then raise sqlstate 'PT409' using message='GMAIL_MESSAGE_CONFLICT';end if;
  update public.proposal_deliveries set provider_rfc_message_id=p_data->>'provider_rfc_message_id' where id=d.id and provider_rfc_message_id is null returning * into d;
  return to_jsonb(d);
 elsif p_action='record' then
  select * into d from public.proposal_deliveries where id=(p_data->>'delivery_id')::uuid and owner_id=p_owner and kind='adenda' and status='accepted_by_gmail';
  if not found then raise sqlstate 'PT404' using message='DELIVERY_NOT_FOUND';end if;
  select * into p from public.change_proposals where id=d.proposal_id and owner_id=p_owner for update;
  select * into r from public.proposal_revisions where id=d.revision_id and proposal_id=p.id;
  if p.current_revision_id<>r.id or p.status<>'ready_for_review' or p.locked_at is not null then raise sqlstate 'PT409' using message='PROPOSAL_REVISION_CONFLICT';end if;
  if d.provider_thread_id is distinct from p_data->>'provider_thread_id' then raise sqlstate 'PT409' using message='GMAIL_THREAD_CONFLICT';end if;
  if d.provider_rfc_message_id is null or lower(d.provider_rfc_message_id)<>lower(p_data->>'provider_rfc_message_id')
   or position('<'||lower(d.provider_rfc_message_id)||'>' in lower(coalesce(p_data->>'in_reply_to','')||' '||coalesce(p_data->>'references_header','')))=0
   or (p_data->>'received_at')::timestamptz<=d.updated_at then raise sqlstate 'PT409' using message='GMAIL_REPLY_REFERENCE_REQUIRED';end if;
  if jsonb_typeof(p_data->'to_emails') is distinct from 'array' or jsonb_array_length(p_data->'to_emails') not between 1 and 20
   or length(p_data->>'body_text')>50000 or length(p_data->>'subject')>1000
   or jsonb_typeof(p_data->'attachment_metadata') is distinct from 'array' or jsonb_array_length(p_data->'attachment_metadata')>5
   or not coalesce((p_data->>'body_sha256') ~ '^[a-f0-9]{64}$',false)
   or (coalesce(length(p_data->>'in_reply_to'),0)=0 and coalesce(length(p_data->>'references_header'),0)=0) then raise sqlstate 'PT422' using message='INVALID_GMAIL_MESSAGE';end if;
  if lower(d.recipient)<>lower(p_data->>'from_email') or lower(p_data->>'mailbox_email')=lower(p_data->>'from_email') then raise sqlstate 'PT409' using message='GMAIL_SENDER_MISMATCH';end if;
  if not exists(select 1 from jsonb_array_elements_text(p_data->'to_emails') as recipient(value) where lower(value)=lower(p_data->>'mailbox_email')) then raise sqlstate 'PT409' using message='GMAIL_RECIPIENT_MISMATCH';end if;
  insert into public.gmail_inbound_messages(owner_id,project_id,proposal_id,revision_id,delivery_id,mailbox_email,provider_message_id,provider_thread_id,
   from_email,to_emails,subject,received_at,in_reply_to,references_header,body_text,body_sha256,attachment_metadata)
   values(p_owner,p.project_id,p.id,r.id,d.id,lower(p_data->>'mailbox_email'),p_data->>'provider_message_id',d.provider_thread_id,
    lower(p_data->>'from_email'),p_data->'to_emails',p_data->>'subject',(p_data->>'received_at')::timestamptz,
    p_data->>'in_reply_to',p_data->>'references_header',p_data->>'body_text',p_data->>'body_sha256',p_data->'attachment_metadata')
   on conflict(owner_id,mailbox_email,provider_message_id) do nothing returning * into m;
  if not found then
   select * into m from public.gmail_inbound_messages where owner_id=p_owner and mailbox_email=lower(p_data->>'mailbox_email') and provider_message_id=p_data->>'provider_message_id';
   if m.delivery_id<>d.id or m.body_sha256<>p_data->>'body_sha256' then raise sqlstate 'PT409' using message='GMAIL_MESSAGE_CONFLICT';end if;
  end if;
  return to_jsonb(m);
 elsif p_action='list' then
  project:=(p_data->>'project_id')::uuid;
  select * into p from public.change_proposals where id=(p_data->>'proposal_id')::uuid and project_id=project and owner_id=p_owner;
  if not found then raise sqlstate 'PT404' using message='PROPOSAL_NOT_FOUND';end if;
  select coalesce(jsonb_agg(to_jsonb(m) order by m.received_at desc,m.id desc),'[]'::jsonb) into targets
   from (select * from public.gmail_inbound_messages where owner_id=p_owner and project_id=project and proposal_id=p.id
    order by received_at desc,id desc limit 50) m;
  return targets;
 end if;
 raise sqlstate 'PT422' using message='INVALID_GMAIL_INBOX_COMMAND';
end $$;
revoke all on function private.gmail_inbox(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function private.gmail_inbox(uuid,text,jsonb) to service_role;
create function public.gmail_inbox(p_owner uuid,p_action text,p_data jsonb)
returns jsonb language sql security invoker set search_path='' as $$select private.gmail_inbox(p_owner,p_action,p_data)$$;
revoke all on function public.gmail_inbox(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.gmail_inbox(uuid,text,jsonb) to service_role;

commit;
