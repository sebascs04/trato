-- Trato's own payment email also announces a PayPal invoice (PayPal Sandbox does not deliver its invoice emails to real
-- inboxes). The email carries the invoice's payer link; everything else about the payment email is unchanged.
do $$
declare definition text; patched text;
begin
 definition:=pg_get_functiondef('private.proposal_backend(uuid,text,jsonb)'::regprocedure);
 if position($a$status='pending_approval' and method='order')$a$ in definition)=0 then return; end if;
 patched:=replace(definition,
  $a$where revision_id=r.id and status='pending_approval' and method='order')$a$,
  $b$where revision_id=r.id and status='pending_approval' and (method='order' or invoice_url is not null))$b$);
 if patched=definition then raise exception 'proposal_backend: payment mail anchor not found'; end if;
 execute patched;
end $$;
