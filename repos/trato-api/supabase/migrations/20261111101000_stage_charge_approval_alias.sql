-- Fixes the first version of 20261111100000, which named the approvals table "v" inside initial_checkout_backend,
-- where v is already the checkout record ("record v has no field document_id"). A database built from the corrected
-- 20261111100000 already has the right alias, so this does nothing there.
do $$
declare d text; bad text; good text;
begin
 select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace s on s.oid=p.pronamespace
  where s.nspname='public' and p.proname='initial_checkout_backend';
 bad:=$t$exists(select 1 from public.project_stage_reviews v where v.document_id=evidence and v.project_id=p.id and v.stage_position=stage_no and v.decision='approved')$t$;
 good:=$t$exists(select 1 from public.project_stage_reviews stage_review where stage_review.document_id=evidence and stage_review.project_id=p.id and stage_review.stage_position=stage_no and stage_review.decision='approved')$t$;
 if position(bad in d)>0 then execute replace(d,bad,good); end if;
end $$;
