const {test}=require('node:test');
const assert=require('node:assert/strict');
const load=()=>import('../refund-preview.mjs');
function state(){return {case:{capture_id:'cap-1',gross_minor:30000,payment_status:'COMPLETED'},sources:[{id:'request',kind:'request',title:'Correo',text:'Cancelar el proyecto.'}],revisions:[],events:[],refund:null};}
function revision(id,version=1){return {snapshot_id:id,version,proposal:{terms:'Cierre revisado'},source_refs:[{source_id:'request',quote:'Cancelar el proyecto.'}],policy_refs:[{id:'paypal',title:'PayPal',url:'https://www.paypal.com/pe/',reviewed_at:'2026-10-26',summary:'Condiciones guardadas',scope:'PE'}]};}
test('does not invent a proposal, acceptance or refund before they exist',async()=>{
 const {buildRefundEvidenceGraph:build}=await load(),s=state();
 const before=structuredClone(s),g=build(s);
 assert.equal(g.nodes.length,2);assert.equal(g.edges.length,1);assert.deepEqual(s,before);
});
test('binds acceptance and refund to the exact snapshot and preserves original payment',async()=>{
 const {buildRefundEvidenceGraph:build}=await load(),s=state();
 s.revisions=[revision('first'),revision('second',2)];
 s.events=[{event:'client_accept',snapshot_id:'first',at:'2026-10-26'}];
 s.refund={id:'refund',snapshot_id:'first',capture_id:'cap-1',currency:'USD',amount_minor:10000,status:'PENDING'};
 const g=build(s);
 assert.ok(g.edges.some(e=>e.from==='client_accept:first'&&e.to==='revision:first'));
 assert.ok(!g.edges.some(e=>e.from.startsWith('client_accept:')&&e.to==='revision:second'));
 assert.ok(g.edges.some(e=>e.from==='refund:refund'&&e.to==='revision:first'));
 assert.match(g.nodes.find(n=>n.id==='payment:cap-1').detail,/COMPLETED/);
 assert.match(g.nodes.find(n=>n.id==='refund:refund').detail,/PENDING/);
});
test('rejects another capture, missing source and fabricated citation',async()=>{
 const {buildRefundEvidenceGraph:build}=await load(),s=state();s.revisions=[revision('one')];
 s.refund={id:'bad',capture_id:'another',snapshot_id:'one',currency:'USD',amount_minor:1,status:'COMPLETED'};
 assert.throws(()=>build(s),/no corresponde/);s.refund=null;
 s.revisions[0].source_refs[0].quote='Una firma que no existe';assert.throws(()=>build(s),/cita/);
 s.revisions[0].source_refs[0]={source_id:'outside-project',quote:'Cancelar'};assert.throws(()=>build(s),/cita/);
});
test('keeps policy snapshots from different revisions distinct',async()=>{
 const {buildRefundEvidenceGraph:build}=await load(),s=state();s.revisions=[revision('one'),revision('two',2)];
 s.revisions[1].policy_refs[0].summary='Condiciones posteriores';
 const g=build(s);assert.equal(g.nodes.filter(n=>n.id.startsWith('policy:')).length,2);
 const targets=g.edges.filter(e=>e.label==='Consulta condiciones del proveedor').map(e=>e.to);
 assert.notEqual(targets[0],targets[1]);
});
