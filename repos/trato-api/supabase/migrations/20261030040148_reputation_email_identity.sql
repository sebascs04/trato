begin;
-- Email is the community identity; historical names/locations/websites are preserved.
alter table private.reputation_clients alter column name drop not null;
CREATE OR REPLACE FUNCTION private.community_reputation(p_action text, p_data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 u uuid:=auth.uid(); v_email text; v_profile uuid; v_known text; v_name text;
 v_attachment private.reputation_attachments; v_project uuid; v_key text; v_object boolean; v_id uuid;
 v_items jsonb; v_result jsonb; v_offset integer; v_search text; v_private_email text; v_linked_profile uuid;
begin
 if u is null or not exists(select 1 from auth.users where id=u) or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
  raise exception using message='UNAUTHORIZED',errcode='42501';end if;
 if jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>20000 then
  raise exception using message='REPUTATION_INVALID',errcode='22023';end if;
 if p_action in('attachment_context','attachment_reserve','attachment_list') then
  v_project:=(p_data->>'project_id')::uuid;
  perform 1 from public.projects p join public.clients c on c.id=p.client_id and c.owner_id=u and c.deleted_at is null where p.id=v_project and p.owner_id=u for update of p;
  if not found then raise exception using message='PROJECT_NOT_FOUND',errcode='P0001';end if;
  if p_action='attachment_context' then return jsonb_build_object('project_id',v_project);end if;
  if p_action='attachment_list' then
   select coalesce(jsonb_agg(private.reputation_attachment_summary(a) order by a.created_at,a.id),'[]'::jsonb) into v_items from private.reputation_attachments a where a.author_id=u and a.project_id=v_project and a.status in('reserved','ready');
   return jsonb_build_object('attachments',v_items);
  end if;
  v_key:=p_data->>'upload_key';
  if v_key is null or char_length(v_key) not between 1 and 128 or v_key ~ '[^!-~]' then raise exception using message='REPUTATION_ATTACHMENT_INVALID',errcode='22023';end if;
  select * into v_attachment from private.reputation_attachments where author_id=u and upload_key=v_key for update;
  if found then
   if v_attachment.project_id<>v_project or v_attachment.filename is distinct from p_data->>'filename' or v_attachment.size_bytes is distinct from (p_data->>'size_bytes')::bigint or v_attachment.sha256 is distinct from p_data->>'sha256' or v_attachment.status='discarded' then
    raise exception using message='REPUTATION_ATTACHMENT_CONFLICT',errcode='23505';end if;
  else
   if (select count(*) from private.reputation_attachments where author_id=u and project_id=v_project and status in('reserved','ready'))>=3 then raise exception using message='REPUTATION_ATTACHMENT_LIMIT',errcode='22023';end if;
   v_id:=gen_random_uuid();
   insert into private.reputation_attachments(id,author_id,project_id,filename,size_bytes,sha256,upload_key,storage_path)
    values(v_id,u,v_project,p_data->>'filename',(p_data->>'size_bytes')::bigint,p_data->>'sha256',v_key,v_id::text||'.pdf') returning * into v_attachment;
  end if;
  select exists(select 1 from storage.objects where bucket_id='reputation-evidence' and name=v_attachment.storage_path) into v_object;
  return private.reputation_attachment_summary(v_attachment)||jsonb_build_object('storage_path',v_attachment.storage_path,'object_exists',v_object);
 elsif p_action in('attachment_ready','attachment_read','attachment_discard') then
  select * into v_attachment from private.reputation_attachments where id=(p_data->>'attachment_id')::uuid for update;
  if not found then raise exception using message='REPUTATION_ATTACHMENT_NOT_FOUND',errcode='P0001';end if;
  if p_action='attachment_read' then
   if not private.reputation_attachment_access(v_attachment.storage_path,'read') then raise exception using message='REPUTATION_ATTACHMENT_NOT_FOUND',errcode='P0001';end if;
   return private.reputation_attachment_summary(v_attachment)||jsonb_build_object('storage_path',v_attachment.storage_path);
  end if;
  if v_attachment.author_id<>u then raise exception using message='REPUTATION_ATTACHMENT_NOT_FOUND',errcode='P0001';end if;
  if p_action='attachment_discard' then
   if v_attachment.status not in('reserved','ready','discarded') then raise exception using message='REPUTATION_ATTACHMENT_INVALID',errcode='22023';end if;
   update private.reputation_attachments set status='discarded' where id=v_attachment.id returning * into v_attachment;
   return private.reputation_attachment_summary(v_attachment)||jsonb_build_object('storage_path',v_attachment.storage_path);
  end if;
  if v_attachment.status not in('reserved','ready') then raise exception using message='REPUTATION_ATTACHMENT_INVALID',errcode='22023';end if;
  if not exists(select 1 from storage.objects where bucket_id='reputation-evidence' and name=v_attachment.storage_path and (metadata->>'size')::bigint=v_attachment.size_bytes and metadata->>'mimetype'='application/pdf') then
   raise exception using message='REPUTATION_ATTACHMENT_NOT_READY',errcode='22023';end if;
  update private.reputation_attachments set status='ready' where id=v_attachment.id returning * into v_attachment;
  return private.reputation_attachment_summary(v_attachment);
 elsif p_action='lookup' then
  v_email:=private.reputation_email(p_data->>'public_email');
  if v_email is null then raise exception using message='REPUTATION_EMAIL_INVALID',errcode='22023';end if;
  select private.reputation_client_summary(c) into v_result from private.reputation_clients c where c.public_email=v_email
   and exists(select 1 from private.reputation_reviews r where r.profile_id=c.id and r.status='published');
  return jsonb_build_object('client',v_result);
 elsif p_action='list' then
  v_search:=btrim(coalesce(p_data->>'search',''));v_offset:=coalesce((p_data->>'offset')::integer,0);
  if char_length(v_search)>254 or v_offset<0 or v_offset>100000 then raise exception using message='REPUTATION_INVALID',errcode='22023';end if;
  select coalesce(jsonb_agg(private.reputation_client_summary(c::private.reputation_clients) order by lower(c.public_email),c.id),'[]'::jsonb) into v_items from (
   select c.* from private.reputation_clients c where (v_search='' or position(lower(v_search) in lower(coalesce(c.public_email,'')))>0)
   and exists(select 1 from private.reputation_reviews r where r.profile_id=c.id and r.status='published')
   order by lower(c.public_email),c.id limit 25 offset v_offset
  )c;
  return jsonb_build_object('clients',v_items,'next_offset',case when jsonb_array_length(v_items)=25 then v_offset+25 else null end);
 elsif p_action='options' then
  v_result:=private.community_reputation_core(p_action,p_data);
  select coalesce(jsonb_agg(p.item||jsonb_build_object('profile_public_email',c.public_email) order by p.ordinality),'[]'::jsonb) into v_items
   from jsonb_array_elements(v_result->'projects') with ordinality p(item,ordinality)
   left join private.reputation_clients c on c.id=(p.item->>'profile_id')::uuid;
  return jsonb_set(v_result,'{projects}',v_items);
 elsif p_action='save' then
  perform 1 from public.projects p join public.clients c on c.id=p.client_id and c.owner_id=u and c.deleted_at is null where p.id=(p_data->>'project_id')::uuid and p.owner_id=u for update of p;
  if not found then raise exception using message='PROJECT_NOT_FOUND',errcode='P0001';end if;
  if p_data->>'consent' is distinct from 'true' then raise exception using message='REPUTATION_CONSENT_REQUIRED',errcode='22023';end if;
  v_email:=private.reputation_email(p_data->>'public_email');v_profile:=(p_data->>'profile_id')::uuid;
  -- An unlinked client must match the explicitly chosen public identity by email.
  select c.contact_email,l.profile_id into v_private_email,v_linked_profile
    from public.projects p join public.clients c on c.id=p.client_id and c.owner_id=u
    left join private.reputation_client_links l on l.client_id=c.id and l.owner_id=u
    where p.id=(p_data->>'project_id')::uuid and p.owner_id=u and p.deleted_at is null and c.deleted_at is null for update of c;
  if not found then raise exception using message='PROJECT_NOT_FOUND',errcode='P0001';end if;
  if v_linked_profile is not null then
   if v_profile is distinct from v_linked_profile then raise exception using message='REPUTATION_CLIENT_MISMATCH',errcode='22023';end if;
  elsif v_email is null or lower(btrim(v_private_email)) is distinct from v_email then
   raise exception using message='REPUTATION_CLIENT_MISMATCH',errcode='22023';
  end if;
  if p_data->>'review_id' is not null and not exists(select 1 from private.reputation_reviews where id=(p_data->>'review_id')::uuid and author_id=u and project_id=(p_data->>'project_id')::uuid and profile_id=v_profile) then
   raise exception using message='REPUTATION_NOT_FOUND',errcode='P0001';end if;
  if v_profile is null then
   if v_email is null then raise exception using message='REPUTATION_EMAIL_REQUIRED',errcode='22023';end if;
   insert into private.reputation_clients(name,location,website,created_by,public_email)
    values(null,'','',u,v_email)
    on conflict(public_email) do nothing returning id into v_profile;
   if v_profile is null then raise exception using message='REPUTATION_EMAIL_EXISTS',errcode='23505';end if;
  else
   select public_email into v_known from private.reputation_clients where id=v_profile;
   if not found then raise exception using message='REPUTATION_NOT_FOUND',errcode='P0001';end if;
   -- Legacy reviews without published email remain editable; no contact is disclosed retroactively.
   if v_email is null and v_known is null and p_data->>'review_id' is not null then null;
   elsif v_email is null then raise exception using message='REPUTATION_EMAIL_REQUIRED',errcode='22023';
   elsif v_email is distinct from v_known then raise exception using message='REPUTATION_CLIENT_MISMATCH',errcode='22023';end if;
  end if;
  v_result:=private.community_reputation_core(p_action,p_data||jsonb_build_object('profile_id',v_profile));
  perform private.reputation_set_attachments(u,(v_result->>'review_id')::uuid,p_data->'attachment_ids');
  return v_result;
 elsif p_action='detail' then
  v_result:=private.community_reputation_core(p_action,p_data);
  select coalesce(jsonb_agg(x.item||jsonb_build_object('version',r.version,'attachments',(select coalesce(jsonb_agg(private.reputation_attachment_summary(a) order by a.created_at,a.id),'[]'::jsonb) from private.reputation_attachments a where a.review_id=r.id and a.status='attached')) order by x.ordinality),'[]'::jsonb) into v_items
   from jsonb_array_elements(v_result->'reviews') with ordinality x(item,ordinality)
   join private.reputation_reviews r on r.id=(x.item->>'id')::uuid;
  return jsonb_set(v_result,'{reviews}',v_items);
 end if;
 return private.community_reputation_core(p_action,p_data);
end $function$
;
revoke all on function private.community_reputation(text,jsonb) from public,anon;
grant execute on function private.community_reputation(text,jsonb) to authenticated;
commit;
