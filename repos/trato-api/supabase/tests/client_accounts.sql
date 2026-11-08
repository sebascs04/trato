-- Client accounts see addenda sent to their verified email (migration 20261107110000).
-- Always aborts: the final RAISE reports results and rolls back. Uses the Café Aurora test link created on 7/11/2026.
do $t$
declare tok text := encode(sha256(convert_to('83658db3e4136b82d59366954b854c2fc43b1e7a362d7a8110336afda9699c55','UTF8')),'hex');
 good uuid := gen_random_uuid(); other uuid := gen_random_uuid(); c_email text; proposal uuid; log text := '';
begin
 select c.contact_email, l.proposal_id into c_email, proposal from public.client_portal_links l join public.projects p on p.id = l.project_id join public.clients c on c.id = p.client_id where l.token_hash = tok;
 insert into auth.users(id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data) values
  (good, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tmp-' || good || '@example.com', now(), '{"account_role":"client"}'),
  (other, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tmp-' || other || '@example.com', now(), '{"account_role":"client"}');
 update auth.users set email = upper(c_email) where id = good;
 log := log || 'auto_list=' || (public.client_account_agreements(good) @> jsonb_build_array(jsonb_build_object('proposal_id', proposal))) || ' ';
 log := log || 'hash_ok=' || (public.client_account_link_hash(good, proposal) = tok) || ' ';
 log := log || 'other_list=' || jsonb_array_length(public.client_account_agreements(other)) || ' ';
 begin perform public.client_account_link_hash(other, proposal); log := log || 'other_hash=ALLOWED(BAD) '; exception when others then log := log || 'other_hash=' || sqlerrm || ' '; end;
 update auth.users set email_confirmed_at = null where id = good;
 log := log || 'unverified_list=' || jsonb_array_length(public.client_account_agreements(good)) || ' ';
 log := log || 'anon=' || has_function_privilege('anon','public.client_account_agreements(uuid)','execute');
 raise exception 'ACCOUNT_TEST %', log;
end $t$;
