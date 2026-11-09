begin;
-- Once the client asks for changes, it is the freelancer's turn: this version can no longer be accepted, and the request can no longer be edited.
-- The freelancer's new version answers it (or the request is closed), and that version can be accepted.
do $patch$
declare def text; before text;
 pending constant text := ' if exists(select 1 from public.client_portal_change_requests where revision_id = link.revision_id and used_at is null) then raise sqlstate ''PT409'' using message = ''CHANGE_REQUEST_PENDING''; end if;' || chr(10);
begin
 def := pg_get_functiondef('private.client_portal_accept(text,uuid,text)'::regprocedure); before := def;
 def := replace(def, ' select * into r from public.proposal_revisions where id = link.revision_id;' || chr(10), pending || ' select * into r from public.proposal_revisions where id = link.revision_id;' || chr(10));
 if def = before then raise exception 'PORTAL_ACCEPT_PATCH_FAILED'; end if;
 execute def;
 def := pg_get_functiondef('private.client_portal_request_changes(text,text)'::regprocedure); before := def;
 def := replace(def, ' insert into public.client_portal_change_requests(owner_id', pending || ' insert into public.client_portal_change_requests(owner_id');
 if def = before then raise exception 'PORTAL_REQUEST_PATCH_FAILED'; end if;
 execute def;
end $patch$;
commit;
