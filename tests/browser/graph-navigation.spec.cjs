const {test,expect}=require('@playwright/test');
const nodes=[
 {entity_key:'projects:p',source_id:'p',kind:'Project',project_id:'p',title:'Sitio de la cafetería'},
 {entity_key:'documents:agreement',source_id:'agreement',kind:'Document',project_id:'p',title:'Acuerdo inicial',business_kind:'initial_agreement'},
 {entity_key:'documents:request',source_id:'request',kind:'Document',project_id:'p',title:'Catálogo nuevo',business_kind:'email_request'},
 {entity_key:'change_proposals:proposal',source_id:'proposal',kind:'Proposal',project_id:'p'},
 {entity_key:'proposal_revisions:revision',source_id:'revision',kind:'Revision',project_id:'p',revision_no:1},
 {entity_key:'proposal_acceptances:acceptance',source_id:'acceptance',kind:'Acceptance',project_id:'p'},
 {entity_key:'proposal_payments:payment',source_id:'payment',kind:'Payment',project_id:'p',currency:'USD',amount_minor:45000,status:'completed'}
];
const relations=[['projects:p','HAS_DOCUMENT','documents:agreement'],['projects:p','HAS_DOCUMENT','documents:request'],['projects:p','HAS_PROPOSAL','change_proposals:proposal'],['change_proposals:proposal','RESPONDS_TO','documents:request'],['change_proposals:proposal','HAS_REVISION','proposal_revisions:revision'],['proposal_acceptances:acceptance','ACCEPTS_REVISION','proposal_revisions:revision'],['proposal_payments:payment','FOLLOWS_ACCEPTANCE','proposal_acceptances:acceptance']];
const data={nodes,edges:relations.map(([source,kind,target],i)=>({source,target,kind,edge_key:'e'+i})),synced_at:'2026-10-27T17:00:00Z'};
async function mount(page,{language='es',graph=data}={}){
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(language=>localStorage.setItem('trato:ui-language',language),language);
 await page.goto('/grafo.html');await page.setContent('<main id="map" style="max-width:1400px;margin:auto"></main>');
 await page.evaluate(async data=>{
  window.calls=[];const {openProjectGraph}=await import('/graph-live.mjs');
  window.cleanup=await openProjectGraph({projectId:'p',container:document.querySelector('#map'),request:async path=>{window.calls.push(path);return path.endsWith('/sync')?{status:'ready'}:data;}});
 },graph);
 await expect(page.locator('[data-live-node]')).toHaveCount(7);return errors;
}
test('map arranges hierarchical branches and labels selectable directed relationships',async({page})=>{
 const errors=await mount(page);
 await expect(page.locator('[data-live-node="projects:p"]')).toHaveAttribute('data-live-depth','0');
 await expect(page.locator('[data-live-node="documents:request"]')).toHaveAttribute('data-live-depth','1');
 await expect(page.locator('[data-live-node="change_proposals:proposal"]')).toHaveAttribute('data-live-depth','2');
 await expect(page.locator('[data-live-node="proposal_revisions:revision"]')).toHaveAttribute('data-live-depth','3');
 await expect(page.locator('[data-live-edge]')).toHaveCount(7);
 await expect(page.locator('[data-live-edge="e3"] text')).toHaveText('Responde al pedido');
 const before=await page.locator('.gd-scene').getAttribute('style');
 await page.getByRole('button',{name:'Ajustar',exact:true}).click();
 await page.locator('[data-live-edge="e0"]').focus();await page.keyboard.press('Enter');
 await expect(page.locator('.gd-inspector')).toBeVisible();
 await expect(page.locator('.gd-inspector')).toContainText('Contiene');
 await expect(page.locator('.gd-inspector')).toContainText('Origen');
 await expect(page.locator('.gd-inspector')).toContainText('Destino');
 await expect(page.locator('.gd-inspector')).toContainText('Acuerdo inicial');
 expect(await page.locator('.gd-scene').getAttribute('style')).not.toBe(before);
 expect(errors).toEqual([]);
});
test('pan zoom keyboard and expansion navigate without fetching or changing graph data',async({page})=>{
 const errors=await mount(page),scene=page.locator('.gd-scene'),viewport=page.locator('.gd-map');
 const initial=await scene.evaluate(el=>el.style.transform);
 await page.getByRole('button',{name:'Acercar',exact:true}).click();
 const zoomed=await scene.evaluate(el=>el.style.transform);expect(zoomed).not.toBe(initial);
 const box=await viewport.boundingBox();
 await page.mouse.move(box.x+40,box.y+70);await page.mouse.down();await page.mouse.move(box.x+160,box.y+160,{steps:8});await page.mouse.up();
 const dragged=await scene.evaluate(el=>el.style.transform);expect(dragged).not.toBe(zoomed);
 await viewport.focus();await page.keyboard.press('ArrowRight');
 expect(await scene.evaluate(el=>el.style.transform)).not.toBe(dragged);
 await page.mouse.move(box.x+70,box.y+100);const scale=await page.locator('[data-live-scale]').textContent();await page.mouse.wheel(0,-180);
 await expect(page.locator('[data-live-scale]')).not.toHaveText(scale);
 await page.getByRole('button',{name:'Ampliar mapa',exact:true}).click();
 await expect(page.locator('.graph-live')).toHaveClass(/is-expanded/);
 expect(await viewport.evaluate(el=>el.clientHeight)).toBeGreaterThan(700);
 await page.keyboard.press('Escape');await expect(page.locator('.graph-live')).not.toHaveClass(/is-expanded/);
 expect(await page.evaluate(()=>document.body.style.overflow)).toBe('');
 expect(await page.evaluate(()=>window.calls)).toHaveLength(2);expect(errors).toEqual([]);
});
test('filter and connection navigation keep state and cleanup expanded maps',async({page})=>{
 const errors=await mount(page);
 await page.getByLabel('Filtrar mapa por pedido').selectOption('documents:request');
 await page.getByRole('button',{name:'Detalles',exact:true}).click();
 await expect(page.locator('.gd-inspector')).toBeVisible();
 const connection=page.locator('.gd-inspector [data-live-select]').first();await connection.click();
 await expect(page.locator('[data-live-node][aria-pressed="true"]')).toHaveCount(1);
 await page.getByRole('button',{name:'Ampliar mapa',exact:true}).click();
 await page.evaluate(()=>window.cleanup());
 await expect(page.locator('.graph-live')).toHaveCount(0);
 expect(await page.evaluate(()=>document.body.style.overflow)).toBe('');expect(errors).toEqual([]);
});

test('modal map keeps navigation controls visible and preserves its close action',async({page})=>{
 await mount(page);await page.evaluate(()=>window.cleanup());
 await page.evaluate(async data=>{
  const {openProjectGraph}=await import('/graph-live.mjs');
  window.cleanup=await openProjectGraph({projectId:'p',request:async path=>path.endsWith('/sync')?{status:'ready'}:data});
 },data);
 const dialog=page.getByRole('dialog',{name:'Mapa del proyecto',exact:true});
 const box=await dialog.boundingBox(),controls=await page.locator('.gd-map-controls').boundingBox();
 expect(controls.y+controls.height).toBeLessThan(box.y+box.height);
 await page.getByRole('button',{name:'Volver al proyecto',exact:true}).click();
 await expect(dialog).toHaveCount(0);
});

test('only selected-node connections show verbs and the legend explains arrow directions',async({page})=>{
 const errors=await mount(page);
 await expect(page.locator('[data-live-edge="e0"] text')).toBeVisible();
 await expect(page.locator('[data-live-edge="e3"] text')).toBeHidden();
 await page.getByRole('button',{name:'Detalles',exact:true}).click();
 await page.locator('.gd-inspector [data-live-select="change_proposals:proposal"]').click();
 await expect(page.locator('[data-live-edge="e0"] text')).toBeHidden();
 for(const id of ['e2','e3','e4'])await expect(page.locator(`[data-live-edge="${id}"] text`)).toBeVisible();
 await expect(page.locator('.gd-connection-legend')).toContainText('Entra al nodo seleccionado');
 await expect(page.locator('.gd-connection-legend')).toContainText('Sale hacia otro nodo');
 await expect(page.locator('.gd-inspector [data-live-select="projects:p"] small')).toHaveText('← Incluye propuesta');
 await expect(page.locator('.gd-inspector [data-live-select="documents:request"] small')).toHaveText('→ Responde al pedido');
 expect(errors).toEqual([]);
});
test('direction legend follows English UI without translating project content',async({page})=>{
 const errors=await mount(page,{language:'en'});
 await page.getByRole('button',{name:'Details',exact:true}).click();
 await expect(page.getByLabel('Connection directions')).toContainText('Enters the selected node');
 await expect(page.getByLabel('Connection directions')).toContainText('Goes out to another node');
 await expect(page.locator('.gd-inspector')).toContainText('Sitio de la cafetería');
 await expect(page.locator('[data-live-edge="e2"] text')).toHaveText('Includes proposal');
 expect(errors).toEqual([]);
});
test('business view hides technical nodes and preserves verified document evidence',async({page})=>{
 const graph={...data,nodes:[...nodes,
  {entity_key:'document_extractions:extract',source_id:'extract',kind:'Extraction',project_id:'p',document_id:'agreement'},
  {entity_key:'proposal_reviews:review',source_id:'review',kind:'Review',project_id:'p'},
  {entity_key:'proposal_deliveries:delivery',source_id:'delivery',kind:'Delivery',project_id:'p'}],
  edges:[...data.edges,
   {edge_key:'extraction',source:'documents:agreement',target:'document_extractions:extract',kind:'HAS_EXTRACTION'},
   {edge_key:'source',source:'proposal_revisions:revision',target:'document_extractions:extract',kind:'SUPPORTED_BY'},
   {edge_key:'review',source:'proposal_revisions:revision',target:'proposal_reviews:review',kind:'HAS_REVIEW'},
   {edge_key:'mail',source:'proposal_deliveries:delivery',target:'proposal_revisions:revision',kind:'FOR_REVISION'}]};
 const errors=await mount(page,{graph});
 await expect(page.locator('[data-live-node^="document_extractions:"],[data-live-node^="proposal_reviews:"],[data-live-node^="proposal_deliveries:"]')).toHaveCount(0);
 await expect(page.locator('[data-live-node="proposal_acceptances:acceptance"]')).toHaveCount(1);
 await expect(page.locator('[data-live-node="proposal_payments:payment"]')).toHaveCount(1);
 await page.locator('[data-live-node="proposal_revisions:revision"]').evaluate(el=>el.click());
 await expect(page.locator('.gd-inspector [data-live-select="documents:agreement"] small')).toHaveText('→ Usa como fuente');
 const checked=await page.evaluate(async graph=>{
  const {presentProjectGraph}=await import('/graph-live.mjs');const original=JSON.stringify(graph);
  const present=presentProjectGraph(graph);
  const missing=presentProjectGraph({...graph,edges:graph.edges.filter(e=>e.edge_key!=='extraction')});
  return {unchanged:JSON.stringify(graph)===original,evidence:present.edges.find(e=>e.kind==='SUPPORTED_BY'),unsupported:missing.edges.some(e=>e.kind==='SUPPORTED_BY')};
 },graph);
 expect(checked.unchanged).toBe(true);expect(checked.evidence.target).toBe('documents:agreement');
 expect(checked.evidence.evidence_edges).toEqual(['source','extraction']);expect(checked.unsupported).toBe(false);
 expect(errors).toEqual([]);
});

test('current adenda uses one connection and marks the version without duplicating the arrow',async({page})=>{
 const graph={...data,edges:[...data.edges,{edge_key:'current',source:'change_proposals:proposal',target:'proposal_revisions:revision',kind:'CURRENT_REVISION'}]};
 const errors=await mount(page,{graph});
 await expect(page.locator('[data-live-edge]')).toHaveCount(7);
 await expect(page.locator('[data-live-node="proposal_revisions:revision"]')).toContainText('Versión actual');
 await page.getByRole('button',{name:'Detalles',exact:true}).click();
 await page.locator('.gd-inspector [data-live-select="change_proposals:proposal"]').click();
 await expect(page.locator('.gd-inspector [data-live-select="proposal_revisions:revision"]')).toHaveCount(1);
 await expect(page.locator('.gd-inspector')).not.toContainText('Tiene como vigente');
 const marked=await page.evaluate(async graph=>{const {presentProjectGraph}=await import('/graph-live.mjs');return presentProjectGraph(graph).edges.find(e=>e.edge_key==='e4');},graph);
 expect(marked.current_revision_edge).toBe('current');expect(graph.edges).toHaveLength(8);expect(errors).toEqual([]);
});
test('automatic layout packs related branches without overlapping their cards',async({page})=>{
 await mount(page);
 const packed=await page.evaluate(async()=>{
  const {layoutProjectGraph}=await import('/graph-live.mjs');
  const nodes=[{entity_key:'root',kind:'Project'}],edges=[];
  for(let i=0;i<6;i++){
   const request='request'+i,proposal='proposal'+i,revision='revision'+i,pdf='pdf'+i;
   nodes.push({entity_key:request,kind:'Document'},{entity_key:proposal,kind:'Proposal'},{entity_key:revision,kind:'Revision'},{entity_key:pdf,kind:'Document'});
   for(const [source,kind,target] of [['root','HAS_DOCUMENT',request],['root','HAS_PROPOSAL',proposal],[proposal,'RESPONDS_TO',request],[proposal,'HAS_REVISION',revision],[revision,'HAS_PDF',pdf]])edges.push({source,kind,target});
  }
  const layout=layoutProjectGraph(nodes,edges),positions=[...layout.positions.values()],collisions=[];
  for(let i=0;i<positions.length;i++)for(let j=i+1;j<positions.length;j++)if(Math.abs(positions[i].x-positions[j].x)<240&&Math.abs(positions[i].y-positions[j].y)<132)collisions.push([i,j]);
  const again=layoutProjectGraph(nodes,edges);
  return {width:layout.width,height:layout.height,collisions,stable:JSON.stringify([...layout.positions])===JSON.stringify([...again.positions])};
 });
 expect(packed.collisions).toEqual([]);expect(packed.stable).toBe(true);
 expect(packed.width*packed.height).toBeLessThan(5_000_000);
});

for(const language of ['es','en'])test(`readable default zoom and selected labels avoid cards and each other (${language})`,async({page})=>{
 await mount(page,{language});
 await expect(page.locator('[data-live-scale]')).toHaveText('100%');
 const result=await page.evaluate(()=>{
  const box=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};};
  const cards=[...document.querySelectorAll('[data-live-node]')].map(box);
  const labels=[...document.querySelectorAll('.gd-edge.is-active text')].filter(el=>getComputedStyle(el).visibility==='visible').map(box);
  const hits=(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;
  return {minimumWidth:Math.min(...cards.map(c=>c.w)),labels:labels.length,
   overlaps:labels.some((label,i)=>cards.some(card=>hits(label,card))||labels.slice(i+1).some(other=>hits(label,other)))};
 });
 expect(result.minimumWidth).toBeGreaterThanOrEqual(200);expect(result.labels).toBe(3);expect(result.overlaps).toBe(false);
 await page.getByRole('button',{name:language==='es'?'Detalles':'Details',exact:true}).click();
 await page.locator('.gd-inspector [data-live-select="change_proposals:proposal"]').click();
 await page.getByRole('button',{name:language==='es'?'Ampliar mapa':'Expand map',exact:true}).click();
 await expect(page.locator('[data-live-scale]')).toHaveText('100%');
 const card=await page.locator('[data-live-node="change_proposals:proposal"]').boundingBox(),panel=await page.locator('.gd-inspector').boundingBox();
 expect(card.x+card.width).toBeLessThan(panel.x);
});
