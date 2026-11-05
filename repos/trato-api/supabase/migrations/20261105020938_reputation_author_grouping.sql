begin;
do $migration$
declare source text; updated text;
begin
 source:=pg_get_functiondef('private.community_reputation(text,jsonb)'::regprocedure);
 updated:=replace(source,'''version'',r.version,''attachments''','''author_key'',md5(r.profile_id::text || '':'' || r.author_id::text),''version'',r.version,''attachments''');
 if updated=source then raise exception 'Reputation detail projection does not match expected version'; end if;
 execute updated;
end $migration$;
commit;
