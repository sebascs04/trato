begin;
insert into auth.users(id,email) values('7a111111-1111-4111-8111-111111111111','email-only-test@example.invalid');
insert into public.clients(id,owner_id,name,contact_email) values('7c111111-1111-4111-8111-111111111111','7a111111-1111-4111-8111-111111111111','Private name stays private','email-only-client@example.invalid');
insert into public.projects(id,owner_id,client_id,name) values('7d111111-1111-4111-8111-111111111111','7a111111-1111-4111-8111-111111111111','7c111111-1111-4111-8111-111111111111','Private email-only project');
set local role authenticated;
set local request.jwt.claim.sub='7a111111-1111-4111-8111-111111111111';
set local request.jwt.claims='{"sub":"7a111111-1111-4111-8111-111111111111","role":"authenticated","is_anonymous":false}';
do $$declare result jsonb; profile jsonb;begin
 result:=public.community_reputation('save','{"project_id":"7d111111-1111-4111-8111-111111111111","public_email":" EMAIL-ONLY-CLIENT@EXAMPLE.INVALID ","alias":"Test freelancer","rating":4,"communication":4,"collaboration":4,"body":"This experience needs only the client email and no public name or website.","consent":true}'::jsonb);
 profile:=public.community_reputation('lookup','{"public_email":"email-only-client@example.invalid"}'::jsonb)->'client';
 if profile->>'id' is distinct from result->>'profile_id' or profile->>'public_email'<>'email-only-client@example.invalid' then raise exception 'Email-only identity failed';end if;
 if profile->'name' is distinct from 'null'::jsonb or profile->>'location'<>'' or profile->>'website'<>'' then raise exception 'Optional identity fields invented';end if;
 if not exists(select 1 from jsonb_array_elements(public.community_reputation('list','{"search":"email-only-client@"}'::jsonb)->'clients')c where c->>'id'=result->>'profile_id') then raise exception 'Email search lost profile with null historical name';end if;
 if jsonb_array_length(public.community_reputation('list','{"search":"Private name stays private"}'::jsonb)->'clients')<>0 then raise exception 'Private name copied to community';end if;
end $$;
rollback;
