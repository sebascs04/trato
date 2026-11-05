-- Transactional checks only. No original is uploaded; fixtures roll back.
begin;
do $$
declare p uuid;u uuid;r uuid;request_id uuid;other_p uuid:=gen_random_uuid();client uuid;
 a jsonb;b jsonb;doc uuid;count_before integer;key text:='context-test-'||gen_random_uuid();
begin
 select pr.project_id,pr.owner_id,pr.id,cp.request_document_id into p,u,r,request_id
 from public.proposal_revisions pr join public.change_proposals cp on cp.id=pr.proposal_id
 join public.projects pj on pj.id=pr.project_id join public.clients c on c.id=pj.client_id
 where pj.deleted_at is null and c.deleted_at is null and pj.status<>'closed' limit 1;
 if p is null then raise exception 'An existing active project revision is required for this rollback test';end if;
 select client_id into client from public.projects where id=p;
 insert into public.projects(id,owner_id,client_id,name) values(other_p,u,client,'Upload context rollback fixture');
 perform set_config('request.jwt.claim.sub',u::text,true);
 perform set_config('role','authenticated',true);
 a:=public.reserve_document_with_context(p,'Client adjustments','reference','adjustments.pdf','application/pdf',6,repeat('a',64),key,
  jsonb_build_object('purpose','addendum_adjustments','revision_id',r));
 doc:=(a->'document'->>'id')::uuid;
 if not exists(select 1 from public.document_upload_contexts where document_id=doc and request_document_id=request_id and revision_id=r)
 then raise exception 'Missing context before Storage upload and before a new revision exists';end if;
 b:=public.reserve_document_with_context(p,'Client adjustments','reference','adjustments.pdf','application/pdf',6,repeat('a',64),key,
  jsonb_build_object('purpose','addendum_adjustments','revision_id',r));
 if a->'document'->>'id' is distinct from b->'document'->>'id' then raise exception 'Retry duplicated original';end if;
 begin
  perform public.reserve_document_with_context(p,'Client adjustments','reference','adjustments.pdf','application/pdf',6,repeat('a',64),key,
   jsonb_build_object('purpose','supporting_reference'));
  raise exception 'Context reassignment was accepted';
 exception when sqlstate 'PT409' then null;end;
 begin
  perform public.reserve_document_with_context(other_p,'Foreign revision','reference','foreign.pdf','application/pdf',6,repeat('b',64),key||'-foreign',
   jsonb_build_object('purpose','addendum_adjustments','revision_id',r));
  raise exception 'Cross-project context was accepted';
 exception when sqlstate 'PT409' then null;end;
 if exists(select 1 from public.documents where project_id=other_p) then raise exception 'Invalid context left a partial reservation';end if;
 begin
  insert into public.document_upload_contexts(document_id,owner_id,project_id,purpose) values(gen_random_uuid(),u,p,'supporting_reference');
  raise exception 'Direct context writes were allowed';
 exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 if exists(select 1 from public.document_upload_contexts where document_id=doc) then raise exception 'Foreign owner read context';end if;
 begin
  perform public.reserve_document_with_context(p,'Foreign owner','reference','foreign.pdf','application/pdf',6,repeat('c',64),key||'-owner','{}');
  raise exception 'Foreign owner reserved a document';
 exception when sqlstate 'PT404' then null;end;
end $$;
rollback;
