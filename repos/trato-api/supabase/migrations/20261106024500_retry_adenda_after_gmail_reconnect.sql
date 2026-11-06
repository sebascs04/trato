do $migration$
declare definition text; needle text; replacement text;
begin
 definition:=pg_get_functiondef('private.proposal_backend(uuid,text,jsonb)'::regprocedure);
 needle:=$n$   if m.message_hash<>p_data->>'message_hash' or m.recipient<>p_data->>'recipient' then raise sqlstate 'PT409' using message='EMAIL_CONTEXT_CHANGED'; end if;
   return to_jsonb(m)||jsonb_build_object('acquired',false);$n$;
 replacement:=$n$   if m.message_hash<>p_data->>'message_hash' or m.recipient<>p_data->>'recipient' then raise sqlstate 'PT409' using message='EMAIL_CONTEXT_CHANGED'; end if;
   -- Only a definite failure can be retried. Uncertain deliveries keep their reservation.
   if m.kind='adenda' and m.status='failed' and m.provider_message_id is null then
    update public.proposal_deliveries set status='sending',error_code=null,updated_at=now()
     where id=m.id returning * into m;
    return to_jsonb(m)||jsonb_build_object('acquired',true);
   end if;
   return to_jsonb(m)||jsonb_build_object('acquired',false);$n$;
 if position(needle in definition)=0 then raise exception 'Proposal mail reservation changed'; end if;
 execute replace(definition,needle,replacement);
end $migration$;
