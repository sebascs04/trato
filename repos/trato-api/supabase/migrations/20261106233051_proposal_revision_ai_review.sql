begin;
alter table public.proposal_revision_ai add column if not exists review jsonb check(review is null or (jsonb_typeof(review)='object' and octet_length(review::text)<=50000));
grant update(review) on public.proposal_revision_ai to authenticated;
drop policy if exists proposal_revision_ai_review on public.proposal_revision_ai;
create policy proposal_revision_ai_review on public.proposal_revision_ai for update to authenticated using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
notify pgrst,'reload schema';
commit;
