import test from 'node:test';
import assert from 'node:assert/strict';
import {presentProjectGraph,layoutProjectGraph,routeProjectGraph,renderProjectGraphReading} from '../graph-live.mjs';
const node=(id,kind,extra={})=>({entity_key:id,source_id:id,kind,...extra});
const edge=(source,kind,target)=>({edge_key:source+':'+kind+':'+target,source,kind,target});
function fixture(){return {nodes:[node('root','Project'),node('initial','Document',{business_kind:'initial_agreement'}),node('request','Document',{business_kind:'email_request'}),node('proposal','Proposal'),node('v1','Revision',{revision_no:1}),node('v2','Revision',{revision_no:2}),node('pdf1','Document'),node('pdf2','Document'),node('accept','Acceptance'),node('returned','Document'),node('payment','Payment',{status:'completed'}),node('sent','Delivery',{business_kind:'adenda',status:'accepted_by_gmail'})],edges:[edge('root','HAS_DOCUMENT','initial'),edge('root','HAS_DOCUMENT','request'),edge('root','HAS_DOCUMENT','pdf1'),edge('root','HAS_DOCUMENT','pdf2'),edge('root','HAS_DOCUMENT','returned'),edge('root','HAS_PROPOSAL','proposal'),edge('proposal','RESPONDS_TO','request'),edge('proposal','HAS_REVISION','v1'),edge('proposal','HAS_REVISION','v2'),edge('v1','HAS_PDF','pdf1'),edge('v2','HAS_PDF','pdf2'),edge('accept','ACCEPTS_REVISION','v2'),edge('accept','EVIDENCED_BY','returned'),edge('payment','FOR_REVISION','v2'),edge('payment','FOLLOWS_ACCEPTANCE','accept'),edge('sent','FOR_REVISION','v1')]};}
test('map keeps each version once with exact PDF and preserves acceptance and payment nodes',()=>{
 const data=fixture(),original=JSON.stringify(data),graph=presentProjectGraph(data);
 assert.equal(JSON.stringify(data),original);
 assert.deepEqual(graph.nodes.map(n=>n.entity_key),['root','initial','request','v1','v2','accept','payment']);
 assert.deepEqual(graph.nodes.find(n=>n.entity_key==='v1').documents,[{id:'pdf1',title:undefined,role:'pdf'}]);
 assert.equal(graph.nodes.find(n=>n.entity_key==='v1').milestone,'sent');assert.equal(graph.nodes.find(n=>n.entity_key==='v2').milestone,'accepted');
 assert.equal(graph.nodes.find(n=>n.entity_key==='accept').documents[0].id,'returned');
 assert.ok(graph.edges.some(e=>e.kind==='HAS_CHANGE_PROPOSAL'&&e.source==='request'&&e.target==='v1'&&e.evidence_edges.length===2));
 assert.ok(graph.edges.every(e=>graph.nodes.some(n=>n.entity_key===e.source)&&graph.nodes.some(n=>n.entity_key===e.target)));
 const layout=layoutProjectGraph(graph.nodes,graph.edges);assert.equal(layout.positions.size,7);
 const routes=routeProjectGraph(graph.edges,layout.positions);assert.equal(routes.size,graph.edges.length);
});
test('only actual adenda sends qualify as sent, never payment mail or an uncertain delivery',()=>{
 for(const extra of [{status:'failed'},{status:'delivery_uncertain'},{business_kind:'payment'}]){
  const data=fixture();Object.assign(data.nodes.find(n=>n.entity_key==='sent'),extra);
  assert.equal(presentProjectGraph(data).nodes.find(n=>n.entity_key==='v1').milestone,'created');
 }
});
test('shared PDFs and source agreements never merge distinct business records',()=>{
 const data=fixture();data.edges.push(edge('v2','HAS_PDF','pdf1'),edge('v1','HAS_PDF','initial'));
 const graph=presentProjectGraph(data);assert.ok(graph.nodes.some(n=>n.entity_key==='pdf1'));assert.ok(graph.nodes.some(n=>n.entity_key==='initial'));
 assert.ok(graph.nodes.some(n=>n.entity_key==='v1'));assert.ok(graph.nodes.some(n=>n.entity_key==='v2'));
});
test('draft snapshots are not shown as new versions, and unsupported rejection is never invented',()=>{
 const data=fixture();data.nodes.push(node('old','Revision',{revision_no:1}));data.edges.push(edge('v1','REPLACES_DRAFT','old'),edge('proposal','HAS_REVISION','old'));
 const graph=presentProjectGraph(data);assert.ok(!graph.nodes.some(n=>n.entity_key==='old'));assert.ok(!graph.nodes.some(n=>n.milestone==='rejected'));
});

test('each request has a distinct color inherited by its versions, acceptance and payment, not shared sources',()=>{
 const data=fixture();data.nodes.find(n=>n.entity_key==='request').title='First request';
 data.nodes.push(node('request-other','Document',{business_kind:'email_request',title:'Second request'}),node('proposal-other','Proposal'),node('v1-other','Revision',{revision_no:1}),node('accept-other','Acceptance'),node('payment-other','Payment',{status:'completed'}));
 data.edges.push(edge('proposal-other','RESPONDS_TO','request-other'),edge('proposal-other','HAS_REVISION','v1-other'),edge('accept-other','ACCEPTS_REVISION','v1-other'),edge('payment-other','FOLLOWS_ACCEPTANCE','accept-other'),edge('v1','SUPPORTED_BY','initial'),edge('v1-other','SUPPORTED_BY','initial'));
 const graph=presentProjectGraph(data),byId=new Map(graph.nodes.map(n=>[n.entity_key,n]));
 assert.equal(graph.cases.length,2);assert.notEqual(byId.get('request').case_color,byId.get('request-other').case_color);
 for(const id of ['v1','v2','accept','payment']){assert.equal(byId.get(id).case_id,'request');assert.equal(byId.get(id).case_color,byId.get('request').case_color);assert.equal(byId.get(id).case_title,'First request');}
 for(const id of ['v1-other','accept-other','payment-other']){assert.equal(byId.get(id).case_id,'request-other');assert.equal(byId.get(id).case_color,byId.get('request-other').case_color);}
 assert.equal(byId.get('initial').case_color,undefined);assert.equal(byId.get('root').case_color,undefined);
 assert.ok(graph.edges.filter(e=>['payment-other','accept-other'].includes(e.source)).every(e=>e.case_id==='request-other'));
 const reversed=presentProjectGraph({nodes:[...data.nodes].reverse(),edges:[...data.edges].reverse()});assert.deepEqual(reversed.cases,graph.cases);
 assert.equal(data.nodes.find(n=>n.entity_key==='v1').case_color,undefined);
});

test('one request-to-version arrow retains the parallel source evidence in details without erasing it',()=>{
 const data=fixture();data.edges.push(edge('v1','SUPPORTED_BY','request'),edge('v1','SUPPORTED_BY','initial'));
 const before=JSON.stringify(data),graph=presentProjectGraph(data);
 const between=graph.edges.filter(e=>[e.source,e.target].includes('request')&&[e.source,e.target].includes('v1'));
 assert.equal(between.length,1);const relation=between[0];
 assert.equal(relation.source,'request');assert.equal(relation.target,'v1');assert.equal(relation.kind,'HAS_CHANGE_PROPOSAL');
 assert.equal(relation.original_kind,'RESPONDS_TO');assert.equal(relation.original_source,'v1');assert.equal(relation.original_target,'request');
 assert.ok(relation.evidence_edges.includes('v1:SUPPORTED_BY:request'));
 assert.equal(relation.evidence_relations[0].source,'v1');assert.equal(relation.evidence_relations[0].target,'request');
 assert.ok(graph.edges.some(e=>e.source==='v1'&&e.target==='initial'&&e.kind==='SUPPORTED_BY'));
 assert.equal(JSON.stringify(data),before);
 assert.ok(!graph.edges.some(e=>e.source==='request'&&e.target==='initial'));
 const layout=layoutProjectGraph(graph.nodes,graph.edges);assert.equal(layout.positions.get('v1').depth,layout.positions.get('request').depth+1);
 const routes=routeProjectGraph(graph.edges,layout.positions);assert.equal(routes.size,graph.edges.length);
});
test('project agreement and request labels describe their real scope and the reading guide uses descriptive examples',()=>{
 const data=fixture();data.nodes.find(n=>n.entity_key==='root').title='Prueba de adenda y pago';data.nodes.find(n=>n.entity_key==='request').title='<pedido del cliente>';
 const graph=presentProjectGraph(data);
 assert.ok(graph.edges.some(e=>e.source==='root'&&e.target==='initial'&&e.kind==='HAS_INITIAL_AGREEMENT'));
 assert.ok(graph.edges.some(e=>e.source==='root'&&e.target==='request'&&e.kind==='RECEIVES_REQUEST'));
 const html=renderProjectGraphReading(graph);
 assert.match(html,/Web de Café Aurora/);assert.match(html,/Tiene como acuerdo inicial/);assert.match(html,/Tiene como propuesta/);assert.match(html,/Añadir una tienda en línea/);assert.doesNotMatch(html,/Prueba de adenda y pago|<pedido del cliente>/);
 assert.match(html,/Adenda v1/);assert.match(html,/origen → relación → destino/);
});
