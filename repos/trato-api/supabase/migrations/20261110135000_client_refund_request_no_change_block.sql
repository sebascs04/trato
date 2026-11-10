-- a refund the client asked for, of everything still refundable on something already paid, does not
-- wait for an open change request. Only another refund in progress in the project, or a closed project, stops it.
-- Refunds the freelancer starts keep the usual «one open request per project» rule.
do $$
declare def text;
 old text:=$o$ if (private.project_request_status(item.project_id)->>'can_register')::boolean is false then raise sqlstate 'PT409' using message='PROJECT_HAS_OPEN_REQUEST';end if;$o$;
 new text:=$n$ if exists(select 1 from public.refund_settlements where project_id=item.project_id and owner_id=actor and
  (status not in('completed','closed_without_refund','rejected','withdrawn') or (scope='project_closure' and status in('completed','closed_without_refund'))))
 then raise sqlstate 'PT409' using message='REFUND_ALREADY_IN_PROGRESS';end if;$n$;
begin
 def:=pg_get_functiondef('public.client_refund_request_settle(uuid)'::regprocedure);
 if position(new in def)>0 then return;end if;
 if position(old in def)=0 then raise exception 'client_refund_request_settle changed: open request check not found';end if;
 execute replace(def,old,new);
end $$;
