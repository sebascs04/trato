begin;
-- An edit must refer to this author, project and community profile.
create or replace function private.community_reputation(p_action text,p_data jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 u uuid:=auth.uid(); v_email text; v_profile uuid; v_known text; v_name text;
 v_items jsonb; v_result jsonb; v_offset integer; v_search text;
begin
 if u is null or not exists(select 1 from auth.users where id=u) or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
  raise exception using message='UNAUTHORIZED',errcode='42501';end if;
 if jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>20000 then
  raise exception using message='REPUTATION_INVALID',errcode='22023';end if;
 if p_action='lookup' then
  v_email:=private.reputation_email(p_data->>'public_email');
  if v_email is null then raise exception using message='REPUTATION_EMAIL_INVALID',errcode='22023';end if;
  select private.reputation_client_summary(c) into v_result from private.reputation_clients c where c.public_email=v_email
   and exists(select 1 from private.reputation_reviews r where r.profile_id=c.id and r.status='published');
  return jsonb_build_object('client',v_result);
 elsif p_action='list' then
  v_search:=btrim(coalesce(p_data->>'search',''));v_offset:=coalesce((p_data->>'offset')::integer,0);
  if char_length(v_search)>254 or v_offset<0 or v_offset>100000 then raise exception using message='REPUTATION_INVALID',errcode='22023';end if;
  select coalesce(jsonb_agg(private.reputation_client_summary(c::private.reputation_clients) order by lower(c.name),c.id),'[]'::jsonb) into v_items from (
   select c.* from private.reputation_clients c where (v_search='' or position(lower(v_search) in lower(c.name||' '||c.location||' '||coalesce(c.public_email,'')))>0)
   and exists(select 1 from private.reputation_reviews r where r.profile_id=c.id and r.status='published')
   order by lower(c.name),c.id limit 25 offset v_offset
  )c;
  return jsonb_build_object('clients',v_items,'next_offset',case when jsonb_array_length(v_items)=25 then v_offset+25 else null end);
 elsif p_action='options' then
  v_result:=private.community_reputation_core(p_action,p_data);
  select coalesce(jsonb_agg(p.item||jsonb_build_object('profile_public_email',c.public_email) order by p.ordinality),'[]'::jsonb) into v_items
   from jsonb_array_elements(v_result->'projects') with ordinality p(item,ordinality)
   left join private.reputation_clients c on c.id=(p.item->>'profile_id')::uuid;
  return jsonb_set(v_result,'{projects}',v_items);
 elsif p_action='save' then
  if p_data->>'consent' is distinct from 'true' then raise exception using message='REPUTATION_CONSENT_REQUIRED',errcode='22023';end if;
  v_email:=private.reputation_email(p_data->>'public_email');v_profile:=(p_data->>'profile_id')::uuid;
  if p_data->>'review_id' is not null and not exists(select 1 from private.reputation_reviews where id=(p_data->>'review_id')::uuid and author_id=u and project_id=(p_data->>'project_id')::uuid and profile_id=v_profile) then
   raise exception using message='REPUTATION_NOT_FOUND',errcode='P0001';end if;
  if v_profile is null then
   if v_email is null then raise exception using message='REPUTATION_EMAIL_REQUIRED',errcode='22023';end if;
   v_name:=btrim(p_data->>'name');
   if v_name is null or char_length(v_name) not between 2 and 160 then raise exception using message='REPUTATION_INVALID',errcode='22023';end if;
   insert into private.reputation_clients(name,location,website,created_by,public_email)
    values(v_name,btrim(coalesce(p_data->>'location','')),btrim(coalesce(p_data->>'website','')),u,v_email)
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
  return private.community_reputation_core(p_action,p_data||jsonb_build_object('profile_id',v_profile));
 elsif p_action='detail' then
  v_result:=private.community_reputation_core(p_action,p_data);
  select coalesce(jsonb_agg(x.item||jsonb_build_object('version',r.version) order by x.ordinality),'[]'::jsonb) into v_items
   from jsonb_array_elements(v_result->'reviews') with ordinality x(item,ordinality)
   join private.reputation_reviews r on r.id=(x.item->>'id')::uuid;
  return jsonb_set(v_result,'{reviews}',v_items);
 end if;
 return private.community_reputation_core(p_action,p_data);
end $$;
commit;
