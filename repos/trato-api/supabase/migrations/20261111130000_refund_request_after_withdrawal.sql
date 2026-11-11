-- A client who withdrew their own refund request can ask again on the same payment. A request the freelancer declined
-- still closes that path: the client continues with Report a problem. Same function, only the closed check changes.
do $$
declare def text;
 old text:=$o$ if exists(select 1 from public.client_refund_requests where received_payment_id = payment.id and status in ('declined','withdrawn')) then$o$;
 new text:=$n$ if exists(select 1 from public.client_refund_requests where received_payment_id = payment.id and status = 'declined') then$n$;
begin
 def:=pg_get_functiondef('public.client_refund_request_create(uuid,uuid,integer,uuid,bigint,text)'::regprocedure);
 if position(new in def)>0 then return;end if;
 if position(old in def)=0 then raise exception 'client_refund_request_create changed: closed check not found';end if;
 execute replace(def,old,new);
end $$;
