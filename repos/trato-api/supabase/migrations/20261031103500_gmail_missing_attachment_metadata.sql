-- Recover missing attachment metadata on an idempotent sync without changing message evidence.
begin;

create or replace function private.gmail_inbox(p_owner uuid,p_action text,p_data jsonb)
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
    'proposal_id',proposal_row.id,'revision_id',revision_row.id,'revision_no',revision_row.revision_no,'delivery_id',delivery_row.id,
    'provider_message_id',delivery_row.provider_message_id,'provider_thread_id',delivery_row.provider_thread_id,'provider_rfc_message_id',delivery_row.provider_rfc_message_id,
    'recipient',delivery_row.recipient,'sent_at',delivery_row.updated_at,'client_email',client_row.contact_email
   ) as target,delivery_row.updated_at as sent_at
   from public.proposal_deliveries delivery_row
   join public.change_proposals proposal_row on proposal_row.id=delivery_row.proposal_id and proposal_row.project_id=delivery_row.project_id and proposal_row.owner_id=delivery_row.owner_id
   join public.proposal_revisions revision_row on revision_row.id=delivery_row.revision_id and revision_row.proposal_id=delivery_row.proposal_id and revision_row.project_id=delivery_row.project_id and revision_row.owner_id=delivery_row.owner_id
   join public.projects project_row on project_row.id=proposal_row.project_id and project_row.owner_id=proposal_row.owner_id
   join public.clients client_row on client_row.id=project_row.client_id and client_row.owner_id=project_row.owner_id
   where delivery_row.owner_id=p_owner and delivery_row.project_id=project and delivery_row.kind='adenda' and delivery_row.status='accepted_by_gmail'
    and delivery_row.provider_thread_id is not null and delivery_row.provider_message_id is not null
    and proposal_row.current_revision_id=revision_row.id and proposal_row.status='ready_for_review' and proposal_row.locked_at is null
   order by delivery_row.updated_at desc limit 5
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
   select * into m from public.gmail_inbound_messages where owner_id=p_owner and mailbox_email=lower(p_data->>'mailbox_email') and provider_message_id=p_data->>'provider_message_id' for update;
   if m.delivery_id<>d.id or m.body_sha256<>p_data->>'body_sha256' then raise sqlstate 'PT409' using message='GMAIL_MESSAGE_CONFLICT';end if;
   if m.used_at is null and m.attachment_metadata='[]'::jsonb and jsonb_array_length(p_data->'attachment_metadata')>0 then
    update public.gmail_inbound_messages set attachment_metadata=p_data->'attachment_metadata'
     where id=m.id and owner_id=p_owner and used_at is null and attachment_metadata='[]'::jsonb returning * into m;
   end if;
  end if;
  return to_jsonb(m);
 elsif p_action='list' then
  project:=(p_data->>'project_id')::uuid;
  select * into p from public.change_proposals where id=(p_data->>'proposal_id')::uuid and project_id=project and owner_id=p_owner;
  if not found then raise sqlstate 'PT404' using message='PROPOSAL_NOT_FOUND';end if;
  select coalesce(jsonb_agg(to_jsonb(inbox_row) order by inbox_row.received_at desc,inbox_row.id desc),'[]'::jsonb) into targets
   from (select * from public.gmail_inbound_messages where owner_id=p_owner and project_id=project and proposal_id=p.id
    order by received_at desc,id desc limit 50) inbox_row;
  return targets;
 end if;
 raise sqlstate 'PT422' using message='INVALID_GMAIL_INBOX_COMMAND';
end $$;

commit;
