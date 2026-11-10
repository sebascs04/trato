-- A deliverable switched to a PayPal invoice gets its own email: the earlier payment email carried the retired order link.
-- Switching resets the email state (with a new message id), so Trato can email the invoice link.
do $$
declare definition text; patched text;
begin
 definition:=pg_get_functiondef('private.stage_invoice_backend(uuid,text,jsonb)'::regprocedure);
 if position('mail_status=''not_sent''' in definition)>0 then return; end if;
 patched:=replace(definition,
  $a$invoice_number=p_data->>'invoice_number',last_error=null,create_lease_until=null,updated_at=now() where id=v.id returning * into v;$a$,
  $b$invoice_number=p_data->>'invoice_number',last_error=null,create_lease_until=null,
   mail_status='not_sent',mail_id=gen_random_uuid(),mail_sender=null,mail_digest=null,mail_message_id=null,mail_thread_id=null,
   updated_at=now() where id=v.id returning * into v;$b$);
 if patched=definition then raise exception 'stage_invoice_backend: switch anchor not found'; end if;
 execute patched;
end $$;
