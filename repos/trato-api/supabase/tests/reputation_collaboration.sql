begin;
insert into auth.users(id,email) values('8a111111-1111-4111-8111-111111111111','rep-collab-a@example.invalid'),('8b222222-2222-4222-8222-222222222222','rep-collab-b@example.invalid');
insert into public.clients(id,owner_id,name,contact_email) values
 ('8c111111-1111-4111-8111-111111111111','8a111111-1111-4111-8111-111111111111','Chosen client','chosen@example.invalid'),
 ('8c222222-2222-4222-8222-222222222222','8a111111-1111-4111-8111-111111111111','Different client','other@example.invalid'),
 ('8c333333-3333-4333-8333-333333333333','8b222222-2222-4222-8222-222222222222','Foreign client','chosen@example.invalid');
insert into public.projects(id,owner_id,client_id,name) values
 ('8d111111-1111-4111-8111-111111111111','8a111111-1111-4111-8111-111111111111','8c111111-1111-4111-8111-111111111111','Legacy project'),
 ('8d222222-2222-4222-8222-222222222222','8a111111-1111-4111-8111-111111111111','8c111111-1111-4111-8111-111111111111','Second chosen project'),
 ('8d333333-3333-4333-8333-333333333333','8a111111-1111-4111-8111-111111111111','8c222222-2222-4222-8222-222222222222','Other project'),
 ('8d444444-4444-4444-8444-444444444444','8b222222-2222-4222-8222-222222222222','8c333333-3333-4333-8333-333333333333','Foreign project');
insert into private.reputation_clients(id,name,public_email,created_by) values('8e111111-1111-4111-8111-111111111111','Chosen client','chosen@example.invalid','8a111111-1111-4111-8111-111111111111');
insert into private.reputation_members(user_id,alias) values('8a111111-1111-4111-8111-111111111111','Test designer');
insert into private.reputation_client_links(client_id,owner_id,profile_id) values('8c111111-1111-4111-8111-111111111111','8a111111-1111-4111-8111-111111111111','8e111111-1111-4111-8111-111111111111');
insert into private.reputation_reviews(id,profile_id,author_id,project_id,rating,communication,scope,payment,body)
 values('8f111111-1111-4111-8111-111111111111','8e111111-1111-4111-8111-111111111111','8a111111-1111-4111-8111-111111111111','8d111111-1111-4111-8111-111111111111',4,4,5,'late','A historical test experience whose fields must retain their meaning.');
set local role authenticated;
set local request.jwt.claim.sub='8a111111-1111-4111-8111-111111111111';
set local request.jwt.claims='{"sub":"8a111111-1111-4111-8111-111111111111","role":"authenticated","is_anonymous":false}';
do $$declare p jsonb; result jsonb; items jsonb; detail jsonb;begin
 items:=public.community_reputation('options','{"public_email":" CHOSEN@EXAMPLE.INVALID "}'::jsonb)->'projects';
 if jsonb_array_length(items)<>2 then raise exception 'Options not filtered by chosen client';end if;
 if exists(select 1 from jsonb_array_elements(items)x where x->>'client_email'<>'chosen@example.invalid') then raise exception 'Other client leaked into options';end if;
 if jsonb_array_length(public.community_reputation('options','{"public_email":"missing@example.invalid"}'::jsonb)->'projects')<>0 then raise exception 'Missing client returned all projects';end if;
 p:=jsonb_build_object('project_id','8d222222-2222-4222-8222-222222222222','profile_id','8e111111-1111-4111-8111-111111111111','public_email','chosen@example.invalid','alias','Test designer','rating',4,'communication',4,'collaboration',3,'body','A general experience about working together, without any payment classification.','consent',true);
 result:=public.community_reputation('save',p);
 detail:=public.community_reputation('detail',jsonb_build_object('profile_id',p->>'profile_id'));
 if not exists(select 1 from jsonb_array_elements(detail->'reviews')r where r->>'id'=result->>'review_id' and r->>'collaboration'='3' and r->'payment'='null'::jsonb and r->'scope'='null'::jsonb) then raise exception 'New experience invented legacy payment/scope values';end if;
 begin perform public.community_reputation('save',p||'{"project_id":"8d333333-3333-4333-8333-333333333333"}'::jsonb);raise exception 'Other client accepted';exception when invalid_parameter_value then if sqlerrm<>'REPUTATION_CLIENT_MISMATCH' then raise;end if;end;
 begin perform public.community_reputation('save',p||'{"project_id":"8d444444-4444-4444-8444-444444444444"}'::jsonb);raise exception 'Foreign project accepted';exception when raise_exception then if sqlerrm<>'PROJECT_NOT_FOUND' then raise;end if;end;
 begin perform public.community_reputation('save',p||'{"collaboration":7}'::jsonb);raise exception 'Invalid collaboration accepted';exception when invalid_parameter_value then null;end;
 perform public.community_reputation('save',p||'{"project_id":"8d111111-1111-4111-8111-111111111111","review_id":"8f111111-1111-4111-8111-111111111111","collaboration":4}'::jsonb);
 if has_function_privilege('authenticated','private.community_reputation_core(text,jsonb)','execute') then raise exception 'Core bypass callable';end if;
end $$;
reset role;
do $$begin
 if not exists(select 1 from private.reputation_reviews where id='8f111111-1111-4111-8111-111111111111' and scope=5 and payment='late' and collaboration=4 and version=2) then raise exception 'Legacy fields changed by new form';end if;
 if not exists(select 1 from private.reputation_review_versions where review_id='8f111111-1111-4111-8111-111111111111' and version=1 and snapshot->>'scope'='5' and snapshot->>'payment'='late' and (snapshot->'collaboration')='null'::jsonb) then raise exception 'Historical snapshot lost';end if;
end $$;
rollback;
