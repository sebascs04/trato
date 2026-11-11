-- A plan stage paid with a PayPal invoice has no order id (only checkout orders do). The project map matched
-- stage payments to received payments with order_id = order_id, which is never true for a missing value, so an
-- invoice-paid stage was left out and a finished plan looked unpaid: the map refused to sync
-- (GRAPH_SOURCE_MISSING). The comparison now treats two missing order ids as equal; nothing else changes.
do $migration$
declare definition text;
begin
 definition:=pg_get_functiondef('private.graph_snapshot_before_refunds(uuid,uuid)'::regprocedure);
 if position('r.order_id=co.order_id' in definition)=0 then
  raise exception 'graph_snapshot_before_refunds no longer has the expected order comparison';
 end if;
 execute replace(definition,'r.order_id=co.order_id','r.order_id is not distinct from co.order_id');
end
$migration$;
