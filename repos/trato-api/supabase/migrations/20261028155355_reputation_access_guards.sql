begin;
create or replace function private.community_reputation(p_action text,p_data jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 u uuid:=auth.uid(); v_profile uuid; v_project public.projects; v_client public.clients;
 v_previous private.reputation_reviews; v_review private.reputation_reviews; v_link uuid;
 v_name text; v_alias text; v_offset integer; v_search text; v_result jsonb; v_items jsonb;
begin
 if u is null or not exists(select 1 from auth.users where id=u) or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception using message='UNAUTHORIZED',errcode='42501'; end if;
 if jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>20000 then raise exception using message='REPUTATION_INVALID',errcode='22023'; end if;
 if p_action='list' then
  v_search:=btrim(coalesce(p_data->>'search','')); v_offset:=coalesce((p_data->>'offset')::integer,0);
  if char_length(v_search)>160 or v_offset<0 or v_offset>100000 then raise exception using message='REPUTATION_INVALID',errcode='22023';end if;
  select coalesce(jsonb_agg(private.reputation_client_summary(c::private.reputation_clients) order by lower(c.name),c.id),'[]'::jsonb) into v_items from (
   select c.* from private.reputation_clients c where (v_search='' or position(lower(v_search) in lower(c.name||' '||c.location))>0)
    and exists(select 1 from private.reputation_reviews r where r.profile_id=c.id and r.status='published')
   order by lower(c.name),c.id limit 25 offset v_offset
  ) c;
  return jsonb_build_object('clients',v_items,'next_offset',case when jsonb_array_length(v_items)=25 then v_offset+25 else null end);
 elsif p_action='options' then
  return jsonb_build_object('alias',(select alias from private.reputation_members where user_id=u),'projects',coalesce((
   select jsonb_agg(jsonb_build_object('id',x.id,'name',x.name,'client_name',x.client_name,'profile_id',x.profile_id,'profile_name',x.profile_name,'review_id',x.review_id) order by x.created_at desc) from (
    select p.id,p.name,p.created_at,c.name client_name,l.profile_id,rc.name profile_name,r.id review_id
    from public.projects p join public.clients c on c.id=p.client_id and c.owner_id=u
    left join private.reputation_client_links l on l.client_id=c.id and l.owner_id=u
    left join private.reputation_clients rc on rc.id=l.profile_id
    left join private.reputation_reviews r on r.project_id=p.id and r.author_id=u
    where p.owner_id=u and c.deleted_at is null order by p.created_at desc limit 200
   )x),'[]'::jsonb));
 elsif p_action='detail' then
  v_profile:=(p_data->>'profile_id')::uuid;v_offset:=coalesce((p_data->>'offset')::integer,0);
  if v_offset<0 or v_offset>100000 then raise exception using message='REPUTATION_INVALID',errcode='22023';end if;
  select private.reputation_client_summary(c) into v_result from private.reputation_clients c where c.id=v_profile
   and exists(select 1 from private.reputation_reviews r where r.profile_id=c.id and r.status='published');
  if v_result is null then raise exception using message='REPUTATION_NOT_FOUND',errcode='P0001';end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'alias',m.alias,'rating',r.rating,'communication',r.communication,'scope',r.scope,'payment',r.payment,'body',r.body,'created_at',r.created_at,'updated_at',r.updated_at,'mine',r.author_id=u,'project_id',case when r.author_id=u then r.project_id else null end) order by r.created_at desc,r.id),'[]'::jsonb) into v_items
  from (select * from private.reputation_reviews where profile_id=v_profile and status='published' order by created_at desc,id limit 25 offset v_offset) r join private.reputation_members m on m.user_id=r.author_id;
  return jsonb_build_object('client',v_result,'reviews',v_items,'next_offset',case when jsonb_array_length(v_items)=25 then v_offset+25 else null end);
 elsif p_action='save' then
  if p_data->>'consent' is distinct from 'true' then raise exception using message='REPUTATION_CONSENT_REQUIRED',errcode='22023';end if;
  v_alias:=btrim(p_data->>'alias');v_name:=btrim(p_data->>'name');
  if v_alias is null or char_length(v_alias) not between 2 and 60 or char_length(btrim(coalesce(p_data->>'body',''))) not between 20 and 3000
   or (p_data->>'rating')::integer not between 1 and 5 or (p_data->>'communication')::integer not between 1 and 5 or (p_data->>'scope')::integer not between 1 and 5
   or (p_data->>'payment') not in ('on_time','late','unpaid','not_applicable') or not(p_data ?& array['rating','communication','scope','payment']) then
   raise exception using message='REPUTATION_INVALID',errcode='22023';end if;
  select p.* into v_project from public.projects p join public.clients c on c.id=p.client_id and c.owner_id=u and c.deleted_at is null where p.id=(p_data->>'project_id')::uuid and p.owner_id=u for update of p;
  if not found then raise exception using message='PROJECT_NOT_FOUND',errcode='P0001';end if;
  select * into v_client from public.clients where id=v_project.client_id and owner_id=u for update;
  if v_client.deleted_at is not null then raise exception using message='PROJECT_NOT_FOUND',errcode='P0001';end if;
  select * into v_previous from private.reputation_reviews where author_id=u and project_id=v_project.id for update;
  if found and v_previous.status<>'withdrawn' and (p_data->>'review_id')::uuid is distinct from v_previous.id then raise exception using message='REPUTATION_REVIEW_EXISTS',errcode='23505';end if;
  if v_previous.status='hidden' then raise exception using message='REPUTATION_REVIEW_HIDDEN',errcode='42501';end if;
  v_profile:=(p_data->>'profile_id')::uuid;
  select profile_id into v_link from private.reputation_client_links where client_id=v_client.id;
  if v_link is not null and v_profile is distinct from v_link then raise exception using message='REPUTATION_CLIENT_MISMATCH',errcode='22023';end if;
  if v_profile is null then
   if v_name is null or char_length(v_name) not between 2 and 160 then raise exception using message='REPUTATION_INVALID',errcode='22023';end if;
   insert into private.reputation_clients(name,location,website,created_by) values(v_name,btrim(coalesce(p_data->>'location','')),btrim(coalesce(p_data->>'website','')),u) returning id into v_profile;
  elsif not exists(select 1 from private.reputation_clients where id=v_profile) then raise exception using message='REPUTATION_NOT_FOUND',errcode='P0001';end if;
  insert into private.reputation_members(user_id,alias) values(u,v_alias) on conflict(user_id) do update set alias=excluded.alias;
  insert into private.reputation_client_links(client_id,owner_id,profile_id) values(v_client.id,u,v_profile) on conflict(client_id) do nothing;
  if v_previous.id is not null then
   insert into private.reputation_review_versions(review_id,version,snapshot) values(v_previous.id,v_previous.version,to_jsonb(v_previous));
   update private.reputation_reviews set rating=(p_data->>'rating')::smallint,communication=(p_data->>'communication')::smallint,scope=(p_data->>'scope')::smallint,payment=p_data->>'payment',body=btrim(p_data->>'body'),status='published',version=version+1,updated_at=now() where id=v_previous.id returning * into v_review;
  else
   insert into private.reputation_reviews(profile_id,author_id,project_id,rating,communication,scope,payment,body) values(v_profile,u,v_project.id,(p_data->>'rating')::smallint,(p_data->>'communication')::smallint,(p_data->>'scope')::smallint,p_data->>'payment',btrim(p_data->>'body')) returning * into v_review;
  end if;
  return jsonb_build_object('profile_id',v_profile,'review_id',v_review.id);
 elsif p_action='withdraw' then
  select * into v_review from private.reputation_reviews where id=(p_data->>'review_id')::uuid and author_id=u for update;
  if not found then raise exception using message='REPUTATION_NOT_FOUND',errcode='P0001';end if;
  if v_review.status='hidden' then raise exception using message='REPUTATION_REVIEW_HIDDEN',errcode='42501';end if;
  if v_review.status='published' then
   insert into private.reputation_review_versions(review_id,version,snapshot) values(v_review.id,v_review.version,to_jsonb(v_review));
   update private.reputation_reviews set status='withdrawn',version=version+1,updated_at=now() where id=v_review.id;
  end if;
  return jsonb_build_object('withdrawn',true);
 elsif p_action='report' then
  select * into v_review from private.reputation_reviews where id=(p_data->>'review_id')::uuid and status='published';
  if not found then raise exception using message='REPUTATION_NOT_FOUND',errcode='P0001';end if;
  if v_review.author_id=u then raise exception using message='REPUTATION_INVALID',errcode='22023';end if;
  insert into private.reputation_reports(review_id,reporter_id,reason,details) values(v_review.id,u,p_data->>'reason',btrim(p_data->>'details')) on conflict(review_id,reporter_id) do nothing;
  return jsonb_build_object('reported',true);
 end if;
 raise exception using message='REPUTATION_INVALID',errcode='22023';
end $$;
commit;
