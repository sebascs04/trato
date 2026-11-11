-- The project map shows refunds in every project and says how each payment was made.
-- 1. Refunds were drawn only for projects listed in private.refund_graph_rollout (a rollout switch left from
--    development). Every refund case now enters the snapshot; the projection already links each refund to its
--    original payment, its documents and PayPal's receipt.
-- 2. Plan stage payments and addendum payments carry their method (PayPal checkout order or PayPal invoice), so the
--    map can name it. Both changes rewrite only those lines of the snapshot functions; nothing else changes.
do $migration$
declare definition text;
begin
 definition:=pg_get_functiondef('private.graph_snapshot_before_dispute_refunds(uuid,uuid)'::regprocedure);
 if position('exists(select 1 from private.refund_graph_rollout where project_id=p_project and owner_id=p_owner)'||chr(10)||' and ' in definition)=0 then
  raise exception 'graph_snapshot_before_dispute_refunds no longer has the expected rollout condition';
 end if;
 execute replace(definition,'exists(select 1 from private.refund_graph_rollout where project_id=p_project and owner_id=p_owner)'||chr(10)||' and ','');

 definition:=pg_get_functiondef('private.graph_snapshot_before_refunds(uuid,uuid)'::regprocedure);
 if position('select co.id,co.stage_position,co.status,co.amount_minor,co.currency,co.paid_at,co.evidence_document_id,r.id as received_payment_id' in definition)=0
  or position('select id,revision_id,acceptance_id,status,amount_minor,currency,created_at,updated_at from public.proposal_payments' in definition)=0 then
  raise exception 'graph_snapshot_before_refunds no longer has the expected payment columns';
 end if;
 definition:=replace(definition,'select co.id,co.stage_position,co.status,co.amount_minor,co.currency,co.paid_at,co.evidence_document_id,r.id as received_payment_id',
                                 'select co.id,co.stage_position,co.status,co.method,co.amount_minor,co.currency,co.paid_at,co.evidence_document_id,r.id as received_payment_id');
 definition:=replace(definition,'select id,revision_id,acceptance_id,status,amount_minor,currency,created_at,updated_at from public.proposal_payments',
                                 'select id,revision_id,acceptance_id,status,method,amount_minor,currency,created_at,updated_at from public.proposal_payments');
 execute definition;
end
$migration$;
