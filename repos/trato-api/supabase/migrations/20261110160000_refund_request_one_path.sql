-- one open path per payment. While the client has an open problem report on a paid deliverable or
-- addendum, a refund is talked about inside that report, so no separate refund request can be opened on it.
do $$
declare def text;
 old text:=$o$ if exists(select 1 from public.client_refund_requests where received_payment_id = payment.id and status in ('declined','withdrawn')) then$o$;
 new text:=$n$ if exists(select 1 from public.client_problem_reports pr where pr.project_id = p_project and pr.status = 'open'
  and ((p_stage is not null and pr.stage_position = p_stage) or (p_proposal is not null and pr.proposal_id = p_proposal))) then
  raise sqlstate 'PT409' using message='REFUND_REQUEST_PROBLEM_OPEN';
 end if;
 if exists(select 1 from public.client_refund_requests where received_payment_id = payment.id and status in ('declined','withdrawn')) then$n$;
begin
 def:=pg_get_functiondef('public.client_refund_request_create(uuid,uuid,integer,uuid,bigint,text)'::regprocedure);
 if position('REFUND_REQUEST_PROBLEM_OPEN' in def)>0 then return;end if;
 if position(old in def)=0 then raise exception 'client_refund_request_create changed: closed check not found';end if;
 execute replace(def,old,new);
end $$;
