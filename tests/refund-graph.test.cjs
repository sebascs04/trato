const assert=require('node:assert/strict');
const test=require('node:test');

test('refund scope preserves the exact document and verified payment paths',async()=>{
 const {createProjectGraphReader,presentProjectGraph,layoutProjectGraph,routeProjectGraph}=await import('../graph-live.mjs');
 const [project,refund,version,doc,payment,receipt]=Array.from({length:6},(_,i)=>'00000000-0000-4000-8000-'+String(i+1).padStart(12,'0'));
 const owner='test-owner',generation=3;
 const nodes=[
  ['projects',project,'Project',{}],
  ['refund_settlements',refund,'Refund',{status:'completed'}],
  ['refund_snapshots',version,'RefundVersion',{revision_no:1}],
  ['documents',doc,'Document',{title:'Refund PDF'}],
  ['project_received_payments',payment,'Payment',{status:'completed',currency:'USD',amount_minor:9000}],
  ['refund_provider_receipts',receipt,'RefundReceipt',{status:'completed',currency:'USD',amount_minor:7500}],
 ].map(([table,id,kind,props])=>({entity_key:table+':'+id,source_id:id,kind,project_id:project,owner_id:owner,generation,...props}));
 const edges=[
  [0,'HAS_REFUND',1],[1,'HAS_REFUND_VERSION',2],[2,'REFUND_PDF',3],
  [1,'REFUND_ORIGINAL_PAYMENT',4],[1,'REFUND_CONFIRMED_RECEIPT',5],[5,'REFUND_APPLIES_TO_PAYMENT',4],
 ].map(([a,kind,b],i)=>({edge_key:'test:'+i,source:nodes[a].entity_key,target:nodes[b].entity_key,kind,owner_id:owner,project_id:project}));
 const option={scope:'refund',id:refund,key:nodes[1].entity_key,title:''};
 const reader=createProjectGraphReader({projectId:project,request:async path=>{
  assert.equal(path,`/api/v1/projects/${project}/graph?scope=refund&request_id=${refund}`);
  return {nodes,edges,scopes:[option],generation,scope:{kind:'refund',request_id:refund}};
 }});
 const graph=presentProjectGraph(await reader.read(option,generation));
 assert.equal(graph.nodes.length,nodes.length);
 assert.deepEqual(graph.edges.map(edge=>edge.edge_key).sort(),edges.map(edge=>edge.edge_key).sort());
 const {positions}=layoutProjectGraph(graph.nodes,graph.edges);
 assert.equal(routeProjectGraph(graph.edges,positions).size,edges.length);
});
