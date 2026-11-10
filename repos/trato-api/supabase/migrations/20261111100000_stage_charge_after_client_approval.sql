-- A deliverable's payment request needs evidence Trato finished reading (treatment "continue" and a summary).
-- When the client already approved that very delivery, their approval decides: the request can be prepared even if
-- Trato's reading asked for clarification. (The alias is not "v": the function already uses v for the checkout.) Only those two conditions change; every other check stays as it was.
do $$
declare d text; treatment text; summary text; approved text; n int;
begin
 select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace s on s.oid=p.pronamespace
  where s.nspname='public' and p.proname='initial_checkout_backend';
 treatment:=$t$or not exists(select 1 from public.file_processing_artifacts f where f.document_id=evidence and f.source_generation=gen and f.stage='treatment' and f.artifact->>'decision'='continue')$t$;
 summary:=$t$or not exists(select 1 from public.file_processing_artifacts f where f.document_id=evidence and f.source_generation=gen and f.stage='summary')$t$;
 approved:=$t$exists(select 1 from public.project_stage_reviews stage_review where stage_review.document_id=evidence and stage_review.project_id=p.id and stage_review.stage_position=stage_no and stage_review.decision='approved')$t$;
 n:=(length(d)-length(replace(d,treatment,'')))/length(treatment);
 if n<>1 then raise exception 'treatment condition found % times',n; end if;
 n:=(length(d)-length(replace(d,summary,'')))/length(summary);
 if n<>1 then raise exception 'summary condition found % times',n; end if;
 d:=replace(d,treatment,'or (not '||approved||' and not exists(select 1 from public.file_processing_artifacts f where f.document_id=evidence and f.source_generation=gen and f.stage=''treatment'' and f.artifact->>''decision''=''continue''))');
 d:=replace(d,summary,'or (not '||approved||' and not exists(select 1 from public.file_processing_artifacts f where f.document_id=evidence and f.source_generation=gen and f.stage=''summary''))');
 execute d;
end $$;
