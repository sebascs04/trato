-- The client sees a Work plan delivery as soon as the freelancer uploads it; Trato's reading of the PDF continues in the
-- background. Preparing the payment still waits for that reading (initial_checkout_backend is unchanged).
create or replace function private.stage_delivery(p_project uuid,p_position integer)
returns table(id uuid,title text,sha256 text) language sql stable security definer set search_path='' as $$
 select d.id,d.title,d.sha256 from public.document_upload_contexts x join public.documents d on d.id=x.document_id
 where x.project_id=p_project and x.stage_position=p_position and x.purpose='delivery_evidence' and d.deleted_at is null
  and d.storage_path is not null
 order by x.created_at desc limit 1
$$;
revoke all on function private.stage_delivery(uuid,integer) from public,anon,authenticated;
