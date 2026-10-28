import {uiText,uiLocale} from './i18n.mjs';
import {icon} from './icons.mjs';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const kinds={Project:[uiText("Proyecto"),'layout-dashboard'],Document:[uiText("Documento"),'file-text'],Extraction:[uiText("Texto extraído"),'file-text'],Proposal:[uiText("Propuesta"),'git-compare-arrows'],Revision:[uiText("Adenda"),'pencil'],Review:[uiText("Revisión"),'eye'],Acceptance:[uiText("Aceptación"),'file-text'],Delivery:[uiText("Envío"),'send'],Payment:[uiText("Pago"),'credit-card']};
const links={HAS_DOCUMENT:uiText("Contiene"),HAS_EXTRACTION:uiText("Tiene texto extraído"),HAS_PROPOSAL:uiText("Incluye propuesta"),RESPONDS_TO:uiText("Responde al pedido"),HAS_REVISION:uiText("Tiene adenda"),CURRENT_REVISION:uiText("Tiene como vigente"),SUPPORTED_BY:uiText("Usa como fuente"),HAS_PDF:uiText("Tiene PDF"),HAS_REVIEW:uiText("Tiene revisión"),REVIEWED_PDF:uiText("Revisa"),ACCEPTS_REVISION:uiText("Acepta esta adenda"),EVIDENCED_BY:uiText("Se respalda en"),FOR_REVISION:uiText("Corresponde a"),FOLLOWS_ACCEPTANCE:uiText("Sigue a"),REPLACES_DRAFT:uiText("Reemplaza"),REQUESTED_CHANGES_FROM:uiText("Recoge ajustes de"),BASED_ON_ACCEPTANCE:uiText("Se basa en"),CURRENT_ACCEPTANCE:uiText("Tiene acuerdo vigente")};
const states={draft:uiText("Borrador"),active:uiText("Activo"),closed:uiText("Cerrado"),queued:uiText("Por leer"),ready:uiText("Disponible"),error:uiText("Error"),accepted:uiText("Aceptado"),ready_for_review:uiText("Por revisar"),completed:uiText("Pagado"),created:uiText("Pendiente"),sending:uiText("Enviando"),accepted_by_gmail:uiText("Envío registrado"),failed:uiText("Falló"),delivery_uncertain:uiText("Envío por verificar")};
const formatDate=value=>value?new Intl.DateTimeFormat(uiLocale(),{dateStyle:'medium',timeStyle:'short',timeZone:'America/Lima'}).format(new Date(value)):'';
const title=n=>n.title||(n.kind==='Revision'?`${uiText("Adenda v")}${n.revision_no}`:n.kind==='Document'?n.title:n.kind==='Payment'?new Intl.NumberFormat(uiLocale(),{style:'currency',currency:n.currency}).format(n.amount_minor/100):kinds[n.kind]?.[0]||uiText("Registro"));
// User-facing graph: keep business records, fold verified extraction paths into documents.
// The persisted Neo4j projection and its audit metadata are never rewritten here.
export function presentProjectGraph(data){
 const records=new Map(data.nodes.map(node=>[node.entity_key,node]));
 const replaced=new Set(data.edges.filter(e=>e.kind==='REPLACES_DRAFT').map(e=>e.target));
 const referenced=new Set(data.edges.filter(e=>['ACCEPTS_REVISION','FOR_REVISION'].includes(e.kind)).map(e=>e.target));
 const businessKinds=new Set(['Project','Document','Proposal','Revision','Acceptance','Payment']);
 const nodes=data.nodes.filter(n=>businessKinds.has(n.kind)&&(!replaced.has(n.entity_key)||referenced.has(n.entity_key)));
 const visible=new Set(nodes.map(n=>n.entity_key)),edges=[];
 const currentEdges=data.edges.filter(e=>e.kind==='CURRENT_REVISION'&&visible.has(e.source)&&visible.has(e.target));
 const currentNodes=new Set(currentEdges.map(e=>e.target));
 for(const edge of data.edges){
  if(!visible.has(edge.source))continue;
  const target=records.get(edge.target);
  if(edge.kind==='SUPPORTED_BY'&&target?.kind==='Extraction'){
   const paths=data.edges.filter(e=>e.kind==='HAS_EXTRACTION'&&e.target===edge.target&&visible.has(e.source)
    &&records.get(e.source)?.kind==='Document'&&(!target.document_id||records.get(e.source).source_id===target.document_id));
   if(paths.length===1)edges.push({...edge,edge_key:'document-source:'+edge.edge_key,target:paths[0].source,
    evidence_edges:[edge.edge_key,paths[0].edge_key]});
  }else if(visible.has(edge.target)&&!['REPLACES_DRAFT','CURRENT_REVISION'].includes(edge.kind)){
   const current=edge.kind==='HAS_REVISION'?currentEdges.find(e=>e.source===edge.source&&e.target===edge.target):null;
   edges.push(current?{...edge,current_revision_edge:current.edge_key}:edge);
  }else if(edge.kind==='CURRENT_REVISION'&&!data.edges.some(e=>e.kind==='HAS_REVISION'&&e.source===edge.source&&e.target===edge.target)){
   edges.push({...edge,kind:'HAS_REVISION',current_revision_edge:edge.edge_key});
  }
 }
 return {nodes:nodes.map(n=>currentNodes.has(n.entity_key)?{...n,is_current_revision:true}:n),edges};
}

// A presentation tree chooses one parent; all factual, directed edges remain visible.
export function layoutProjectGraph(nodes,edges){
 const byId=new Map(nodes.map(n=>[n.entity_key,n]));
 const root=nodes.find(n=>n.kind==='Project')?.entity_key;
 const parents=new Map();
 const incoming=(id,kind)=>edges.find(e=>e.target===id&&e.kind===kind)?.source;
 const outgoing=(id,kind)=>edges.find(e=>e.source===id&&e.kind===kind)?.target;
 for(const n of nodes){
  const id=n.entity_key;if(id===root)continue;
  let parent;
  if(n.kind==='Document')parent=incoming(id,'HAS_PDF')||incoming(id,'EVIDENCED_BY')||root;
  else if(n.kind==='Proposal')parent=outgoing(id,'RESPONDS_TO')||root;
  else if(n.kind==='Revision')parent=incoming(id,'HAS_REVISION')||root;
  else if(n.kind==='Extraction')parent=incoming(id,'HAS_EXTRACTION')||root;
  else if(n.kind==='Review')parent=incoming(id,'HAS_REVIEW')||root;
  else if(n.kind==='Acceptance')parent=outgoing(id,'ACCEPTS_REVISION')||root;
  else if(n.kind==='Delivery')parent=outgoing(id,'FOR_REVISION')||root;
  else if(n.kind==='Payment')parent=outgoing(id,'FOLLOWS_ACCEPTANCE')||outgoing(id,'FOR_REVISION')||root;
  parents.set(id,byId.has(parent)?parent:root);
 }
 // Cycles in source relationships must never make layout traversal loop.
 for(const id of parents.keys()){
  const seen=new Set([id]);let p=parents.get(id);
  while(p&&p!==root){if(seen.has(p)){parents.set(id,root);break;}seen.add(p);p=parents.get(p);}
 }
 const children=new Map(nodes.map(n=>[n.entity_key,[]]));
 for(const [id,parent] of parents)children.get(parent)?.push(id);
 for(const values of children.values())values.sort((a,b)=>(byId.get(a).created_at||'').localeCompare(byId.get(b).created_at||'')||a.localeCompare(b));
 const weight=new Map(),depth=new Map([[root,0]]),angle=new Map([[root,0]]);
 function measure(id){const value=Math.max(1,(children.get(id)||[]).reduce((sum,c)=>sum+measure(c),0));weight.set(id,value);return value;}
 measure(root);
 function sectors(id,start,end){
  let offset=start;
  for(const child of children.get(id)||[]){const size=(end-start)*(id===root?1/(children.get(id).length||1):weight.get(child)/weight.get(id));depth.set(child,depth.get(id)+1);angle.set(child,offset+size/2);sectors(child,offset,offset+size);offset+=size;}
 }
 sectors(root,-Math.PI,Math.PI);
 // Seed each branch around the project, then compact its related records.
 const positions=new Map();
 const counts=new Map();for(const d of depth.values())counts.set(d,(counts.get(d)||0)+1);
 for(const n of nodes){const d=depth.get(n.entity_key)||0,a=angle.get(n.entity_key)||0;
  const radius=d?Math.max(d*190,counts.get(d)*36):0;
  positions.set(n.entity_key,{x:Math.cos(a)*radius,y:Math.sin(a)*radius,depth:d});
 }
 const indexed=nodes.map(n=>({id:n.entity_key,...positions.get(n.entity_key)}));
 const indexById=new Map(indexed.map((n,i)=>[n.id,i]));
 const springPairs=new Map();
 for(const e of edges){if(!indexById.has(e.source)||!indexById.has(e.target)||e.source===e.target)continue;
  const pair=[e.source,e.target].sort();springPairs.set(pair.join('|'),pair);
 }
 // Local rectangle collisions use a spatial grid, not a quadratic global scan.
 function separate(){
  const cells=new Map(),cell=260;
  for(let i=0;i<indexed.length;i++){
   const n=indexed[i],cx=Math.floor(n.x/cell),cy=Math.floor(n.y/cell);
   for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const j of cells.get((cx+dx)+','+(cy+dy))||[]){
    const other=indexed[j],sx=n.x-other.x,sy=n.y-other.y,ox=248-Math.abs(sx),oy=144-Math.abs(sy);
    if(ox<=0||oy<=0)continue;
    const axis=ox<oy?'x':'y',gap=(axis==='x'?ox:oy)+1;
    const sign=(axis==='x'?sx:sy)>=0?1:-1;
    if(n.id===root)other[axis]-=sign*gap;
    else if(other.id===root)n[axis]+=sign*gap;
    else{n[axis]+=sign*gap/2;other[axis]-=sign*gap/2;}
   }
   const key=Math.floor(n.x/cell)+','+Math.floor(n.y/cell);if(!cells.has(key))cells.set(key,[]);cells.get(key).push(i);
  }
 }
 const iterations=nodes.length<100?180:80;
 for(let step=0;step<iterations;step++){
  const forces=indexed.map(()=>({x:0,y:0}));
  for(const [a,b] of springPairs.values()){
   const i=indexById.get(a),j=indexById.get(b),p=indexed[i],q=indexed[j];
   const dx=q.x-p.x,dy=q.y-p.y,d=Math.hypot(dx,dy)||1,ux=dx/d,uy=dy/d;
   const rest=2*(110*Math.abs(ux)+56*Math.abs(uy))+64,strength=(d-rest)*.045;
   forces[i].x+=ux*strength;forces[i].y+=uy*strength;forces[j].x-=ux*strength;forces[j].y-=uy*strength;
  }
  for(let i=0;i<indexed.length;i++){
   const p=indexed[i];if(p.id===root)continue;
   const r=Math.hypot(p.x,p.y)||1,target=p.depth*190;
   forces[i].x-=p.x/r*(r-target)*.012;forces[i].y-=p.y/r*(r-target)*.012;
   const damping=.8-step/iterations*.4;
   p.x+=Math.max(-16,Math.min(16,forces[i].x))*damping;p.y+=Math.max(-16,Math.min(16,forces[i].y))*damping;
  }
  // Preserve the inside-to-outside hierarchy while branches pack together.
  for(const p of [...indexed].sort((a,b)=>a.depth-b.depth)){
   if(p.id===root)continue;
   const parent=indexed[indexById.get(parents.get(p.id))],r=Math.hypot(p.x,p.y)||1;
   const minimum=Math.hypot(parent.x,parent.y)+125;
   if(r<minimum){p.x*=minimum/r;p.y*=minimum/r;}
  }
  separate();
 }
 for(let i=0;i<18;i++)separate();
 const halfWidth=Math.max(300,...indexed.map(n=>Math.abs(n.x)))+150;
 const halfHeight=Math.max(220,...indexed.map(n=>Math.abs(n.y)))+100;
 for(const n of indexed)positions.set(n.id,{x:n.x+halfWidth,y:n.y+halfHeight,depth:n.depth});
 return {positions,width:halfWidth*2,height:halfHeight*2,centerX:halfWidth,centerY:halfHeight,firstRadius:190,radii:[]};
}

function relationGeometry(a,b,offset=0){
 const dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy)||1;
 const clip=Math.min(118/Math.max(Math.abs(dx),.001),62/Math.max(Math.abs(dy),.001),.4);
 const start={x:a.x+dx*clip,y:a.y+dy*clip},end={x:b.x-dx*clip,y:b.y-dy*clip};
 const cx=(start.x+end.x)/2-dy/length*offset,cy=(start.y+end.y)/2+dx/length*offset;
 return {path:`M${start.x} ${start.y} Q${cx} ${cy} ${end.x} ${end.y}`,x:(start.x+2*cx+end.x)/4,y:(start.y+2*cy+end.y)/4};
}

let stylesheet;
async function loadStyles(){
 if(!stylesheet)stylesheet=Promise.all(['/graph-preview.css','/graph-live.css'].map(href=>new Promise((resolve,reject)=>{
 const link=document.createElement('link');link.rel='stylesheet';link.href=href;link.onload=resolve;link.onerror=()=>{link.remove();stylesheet=null;reject(new Error(uiText("No se pudo cargar el mapa.")));};document.head.append(link);
 })));
 await stylesheet;
}
export async function openProjectGraph({projectId,request,returnFocus,isCurrent=()=>true,container}){
 if(!container&&document.querySelector('.gd-dialog'))return;
 await loadStyles();if(!isCurrent())return;
 const embedded=Boolean(container),dialog=container||document.createElement('dialog');
 if(!embedded){dialog.className='gd-dialog';dialog.setAttribute('aria-label',uiText("Mapa del proyecto"));document.body.append(dialog);}
 const root=document.createElement('div');root.className='graph-design graph-live'+(embedded?' graph-live-embedded':'');dialog.replaceChildren(root);
 let generation=0,data,selected,all=[],edges=[],byId=new Map(),objectUrl,pdfDialog,observer,disposed=false,requestFilter='all',selectedRelation=null,detailsOpen=false,expanded=false,view={x:0,y:0,scale:1},layout,viewport,scene,resizeObserver,drag,ignoreClickUntil=0;
 const current=run=>!disposed&&(embedded?root.isConnected:dialog.open)&&run===generation&&isCurrent();
 const header=()=>embedded?`<header class="gd-top"><div class="gd-heading"><h3>${uiText("Mapa del proyecto")}</h3><button class="gd-filter" data-live-refresh>${uiText("Actualizar mapa")}</button></div></header>`:`<header class="gd-top"><div class="gd-top-line"><button class="gd-back" data-live-back>${icon('arrow-left')}${uiText("Volver al proyecto")}</button><span class="gd-preview-label">${uiText("Datos del proyecto")}</span><span class="gd-brand">trato.</span></div><div class="gd-heading"><div><span class="gd-eyebrow">${uiText("SEGUIMIENTO")}</span><h1>${uiText("Mapa del proyecto")}</h1><p class="gd-intro">${uiText("Sigue las conexiones entre tus documentos, acuerdos y pagos.")}</p></div><button class="gd-filter" data-live-refresh>${uiText("Actualizar mapa")}</button></div></header>`;
 const cleanup=()=>{if(disposed)return;setExpanded(false);resizeObserver?.disconnect();disposed=true;generation++;observer?.disconnect();if(pdfDialog?.open)pdfDialog.close();if(objectUrl){URL.revokeObjectURL(objectUrl);objectUrl=null;}if(embedded)root.remove();else dialog.remove();if(returnFocus?.isConnected)returnFocus.focus();};
 if(!embedded){dialog.addEventListener('close',cleanup,{once:true});dialog.showModal();}
 else {observer=new MutationObserver(()=>{if(!root.isConnected)cleanup();});observer.observe(document.body,{childList:true,subtree:true});}
 async function load(){
 const run=++generation;root.innerHTML=header()+'<p class="gd-loading" role="status">'+uiText('Actualizando las conexiones del proyecto…')+'</p>';
 try{
  let job=await request(`/api/v1/projects/${encodeURIComponent(projectId)}/graph/sync`,{method:'POST'});
  const deadline=Date.now()+90000;
  while(current(run)&&['queued','processing'].includes(job.status)){
   if(Date.now()>deadline)throw new Error(uiText("La sincronización sigue pendiente. Vuelve a consultar en unos momentos."));
   await new Promise(resolve=>setTimeout(resolve,1000));
   if(!current(run))return;
   job=await request(`/api/v1/threads/${encodeURIComponent(job.thread_id||job.id)}`);
  }
  if(!current(run))return;
  if(job.status!=='ready')throw new Error('No se pudo sincronizar el mapa. '+(job.error_code||''));
  data=await request(`/api/v1/projects/${encodeURIComponent(projectId)}/graph`);
  if(!current(run))return;
  if(!Array.isArray(data.nodes)||!Array.isArray(data.edges)||!data.nodes.some(n=>n.kind==='Project'&&n.source_id===projectId)||data.nodes.some(n=>n.project_id!==projectId))throw new Error(uiText("Las conexiones recibidas no corresponden al proyecto."));
  ({nodes:all,edges}=presentProjectGraph(data));byId=new Map(all.map(n=>[n.entity_key,n]));
  selected=byId.has(selected)?selected:all.find(n=>n.kind==='Project').entity_key;
  render();
 }catch(error){if(current(run))root.innerHTML=header()+`<section class="gd-error" role="alert"><h2>${uiText("No se pudo abrir el mapa")}</h2><p>${esc(error.message)}</p><button class="gd-filter" data-live-refresh>${uiText("Volver a intentar")}</button></section>`;}
 }
 function render(){
 const requests=all.filter(n=>n.kind==='Document'&&n.business_kind==='email_request');
 const visible=new Set(all.map(n=>n.entity_key));
 if(requestFilter!=='all'){
  visible.clear();visible.add(requestFilter);
  all.filter(n=>n.kind==='Project').forEach(n=>visible.add(n.entity_key));
  const proposals=new Set(edges.filter(e=>e.kind==='RESPONDS_TO'&&e.target===requestFilter).map(e=>e.source));
  proposals.forEach(k=>visible.add(k));
  edges.filter(e=>e.kind==='HAS_REVISION'&&proposals.has(e.source)).forEach(e=>visible.add(e.target));
  for(let i=0;i<3;i++)for(const e of edges){
   if(['HAS_REVIEW','HAS_PDF','SUPPORTED_BY','REQUESTED_CHANGES_FROM','EVIDENCED_BY','REVIEWED_PDF'].includes(e.kind)&&visible.has(e.source))visible.add(e.target);
   if(['ACCEPTS_REVISION','FOR_REVISION'].includes(e.kind)&&visible.has(e.target))visible.add(e.source);
   if(e.kind==='HAS_EXTRACTION'&&visible.has(e.target))visible.add(e.source);
  }
 }
 const viewNodes=all.filter(n=>visible.has(n.entity_key));
 const viewEdges=edges.filter(e=>visible.has(e.source)&&visible.has(e.target));
 if(!visible.has(selected))selected=requestFilter==='all'?viewNodes[0].entity_key:requestFilter;
 layout=layoutProjectGraph(viewNodes,viewEdges);
 const {positions,width,height,centerX,centerY}=layout;
 const pairs=new Map();
 for(const e of viewEdges){const key=[e.source,e.target].sort().join('|');if(!pairs.has(key))pairs.set(key,[]);pairs.get(key).push(e.edge_key);}
 root.innerHTML=header()+`<div class="gd-toolbar"><label>${uiText("Ver")} <select data-live-request aria-label="${uiText("Filtrar mapa por pedido")}"><option value="all">${uiText("Todo el proyecto")}</option>${requests.map(n=>`<option value="${esc(n.entity_key)}" ${n.entity_key===requestFilter?'selected':''}>${esc(n.title)}</option>`).join('')}</select></label><span>${uiText("graph.count",{nodes:new Intl.NumberFormat(uiLocale()).format(viewNodes.length),edges:new Intl.NumberFormat(uiLocale()).format(viewEdges.length)})}</span><div class="gd-space-actions"><button class="gd-filter" data-live-details aria-expanded="${detailsOpen}">${uiText("Detalles")}</button><button class="gd-filter" data-live-expand aria-pressed="${expanded}">${expanded?uiText("Reducir mapa"):uiText("Ampliar mapa")}</button></div></div><div class="gd-body"><section class="gd-map" aria-label="${uiText("Relaciones del proyecto")}" tabindex="0"><div class="gd-scene" style="width:${width}px;height:${height}px"><svg class="gd-lines" viewBox="0 0 ${width} ${height}" aria-label="${uiText("Relaciones entre elementos")}"><defs><marker id="live-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L8 4 L0 8" fill="#9b8bd3"/></marker></defs><g class="gd-orbits" aria-hidden="true">${layout.radii.map(r=>`<circle cx="${centerX}" cy="${centerY}" r="${r}"/>`).join('')}</g>${viewEdges.map(e=>{const siblings=pairs.get([e.source,e.target].sort().join('|'));const offset=(siblings.indexOf(e.edge_key)-(siblings.length-1)/2)*55;const line=relationGeometry(positions.get(e.source),positions.get(e.target),offset);return `<g class="gd-edge" data-live-edge="${esc(e.edge_key)}" data-live-relation="${esc(e.edge_key)}" role="button" tabindex="0" aria-label="${esc(title(byId.get(e.source))+' '+(links[e.kind]||e.kind)+' '+title(byId.get(e.target)))}"><path class="gd-edge-hit" d="${line.path}"/><path class="gd-edge-line" marker-end="url(#live-arrow)" d="${line.path}"/><text x="${line.x}" y="${line.y-7}">${esc(links[e.kind]||e.kind)}</text></g>`;}).join('')}</svg>${viewNodes.map(n=>{const p=positions.get(n.entity_key);return `<button class="gd-node ${n.kind==='Project'?'is-root':''}" style="left:${p.x}px;top:${p.y}px" data-live-node="${esc(n.entity_key)}" data-live-depth="${p.depth}"><span class="gd-node-top"><span class="gd-node-icon">${icon(kinds[n.kind]?.[1]||'file-text')}</span><span class="gd-node-kind">${esc(kinds[n.kind]?.[0])}</span></span><strong>${esc(title(n))}</strong><span class="gd-node-description">${esc(n.is_current_revision?uiText("graph.currentRevision"):(states[n.status]|| (n.kind==='Revision'?uiText("Propuesta de cambio"):'')))}</span></button>`;}).join('')}</div></section><div class="gd-map-controls" role="group" aria-label="${uiText("Navegar por el mapa")}"><button class="gd-filter" data-live-zoom="out">${uiText("Alejar")}</button><output data-live-scale aria-label="${uiText("Nivel de zoom")}">100%</output><button class="gd-filter" data-live-zoom="in">${uiText("Acercar")}</button><button class="gd-filter" data-live-fit>${uiText("Ajustar")}</button><button class="gd-filter" data-live-center>${uiText("Ir al proyecto")}</button></div><span class="gd-navigation-hint">${uiText("Arrastra para moverte · Rueda para ampliar")}</span><aside class="gd-inspector" aria-label="${uiText("Detalle del elemento seleccionado")}" aria-live="polite" ${detailsOpen?'':'hidden'}></aside></div>`;
 viewport=root.querySelector('.gd-map');scene=root.querySelector('.gd-scene');
 resizeObserver?.disconnect();resizeObserver=new ResizeObserver(()=>{if(!disposed&&scene?.isConnected)applyView();});resizeObserver.observe(viewport);
 viewport.addEventListener('wheel',wheel,{passive:false});
 viewport.addEventListener('pointerdown',pointerDown);viewport.addEventListener('pointermove',pointerMove);viewport.addEventListener('pointerup',pointerUp);viewport.addEventListener('pointercancel',pointerUp);
 centerProject();
 inspect();
 }
 function inspect(){
 const edge=edges.find(e=>e.edge_key===selectedRelation),node=byId.get(selected);
 if(!node)return;
 const related=edges.filter(e=>e.source===selected||e.target===selected);
 for(const el of root.querySelectorAll('[data-live-node]'))el.setAttribute('aria-pressed',String(el.dataset.liveNode===selected));
 for(const el of root.querySelectorAll('[data-live-edge]')){const active=edge?el.dataset.liveEdge===edge.edge_key:related.some(e=>e.edge_key===el.dataset.liveEdge);el.classList.toggle('is-active',active);el.setAttribute('aria-pressed',String(active));}
 const aside=root.querySelector('.gd-inspector');aside.hidden=!detailsOpen;
 root.querySelector('[data-live-details]')?.setAttribute('aria-expanded',String(detailsOpen));
 const close=`<button class="gd-detail-close" data-live-details aria-label="${uiText("Cerrar detalle")}" title="${uiText("Cerrar detalle")}">${icon('x')}</button>`;
 if(edge){
  const source=byId.get(edge.source),target=byId.get(edge.target);
  aside.innerHTML=close+`<span class="gd-eyebrow">${uiText("RELACIÓN")}</span><h2>${esc(links[edge.kind]||edge.kind)}</h2><div class="gd-relation-summary"><button class="gd-connection" data-live-select="${esc(source.entity_key)}">${icon(kinds[source.kind]?.[1]||'file-text')}<span>${esc(title(source))}<small>${uiText("Origen")}</small></span></button><p>${esc(links[edge.kind]||edge.kind)} ${icon('arrow-right')}</p><button class="gd-connection" data-live-select="${esc(target.entity_key)}">${icon(kinds[target.kind]?.[1]||'file-text')}<span>${esc(title(target))}<small>${uiText("Destino")}</small></span></button></div>`;
  return;
 }
 const description=node.scope_summary||(node.business_kind==='email_request'?uiText("Conversación que respalda el pedido del cliente."):node.kind==='Acceptance'?uiText("Aceptación registrada mediante revisión manual del documento devuelto."):node.kind==='Payment'?(node.status==='completed'?uiText("Pago confirmado por el backend."):uiText("Este pago aún no está confirmado.")):uiText("Registro del proyecto y sus conexiones documentadas."));
 aside.innerHTML=close+`<span class="gd-eyebrow">${esc(kinds[node.kind]?.[0])}</span><h2>${esc(title(node))}</h2><p class="gd-detail-copy">${esc(description)}</p><div class="gd-connections"><h3>${uiText("Conectado con")}</h3><div class="gd-connection-legend" aria-label="${uiText("graph.directionLegend")}"><span>${icon('arrow-left')}${uiText("graph.incoming")}</span><span>${icon('arrow-right')}${uiText("graph.outgoing")}</span></div>${related.map(e=>{const other=byId.get(e.source===selected?e.target:e.source);return `<button class="gd-connection" data-live-select="${esc(other.entity_key)}">${icon(kinds[other.kind]?.[1]||'file-text')}<span>${esc(title(other))}<small>${e.source===selected?'→':'←'} ${esc(links[e.kind]||e.kind)}</small></span>${icon('chevron-right')}</button>`;}).join('')||("<p class=\"gd-detail-copy\">"+uiText("Sin conexiones registradas.")+"</p>")}</div>${node.kind==='Document'?`<button class="gd-document-action" data-live-document="${esc(node.source_id)}">${icon('file-text')}${uiText("Ver documento fuente")}</button>`:''}`;
 }
 function applyView(){
  if(!scene)return;scene.style.transform=`translate(${view.x}px,${view.y}px) scale(${view.scale})`;scene.style.setProperty('--gd-label-scale',String(Math.min(2,1/view.scale)));
  const output=root.querySelector('[data-live-scale]');if(output)output.textContent=Math.round(view.scale*100)+'%';
 }
 function centerProject(){
  if(!viewport||!layout)return;
  view.scale=Math.min(.85,Math.max(.65,Math.min(viewport.clientWidth,viewport.clientHeight)/(layout.firstRadius*2+200)));
  view.x=viewport.clientWidth/2-layout.centerX*view.scale;view.y=viewport.clientHeight/2-layout.centerY*view.scale;applyView();
 }
 function fit(){
  const availableWidth=Math.max(200,viewport.clientWidth-(detailsOpen?Math.min(320,viewport.clientWidth*.4):0));
  const points=[...layout.positions.values()];
  const left=Math.min(...points.map(p=>p.x))-130,right=Math.max(...points.map(p=>p.x))+130;
  const top=Math.min(...points.map(p=>p.y))-80,bottom=Math.max(...points.map(p=>p.y))+80;
  view.scale=Math.max(.05,Math.min(1,(availableWidth-60)/(right-left),(viewport.clientHeight-80)/(bottom-top)));
  view.x=(availableWidth-(right-left)*view.scale)/2-left*view.scale;
  view.y=(viewport.clientHeight-(bottom-top)*view.scale)/2-top*view.scale;applyView();
 }
 function zoom(factor,x=viewport.clientWidth/2,y=viewport.clientHeight/2){
  const next=Math.max(.05,Math.min(2,view.scale*factor)),ratio=next/view.scale;
  view.x=x-(x-view.x)*ratio;view.y=y-(y-view.y)*ratio;view.scale=next;applyView();
 }
 function wheel(event){event.preventDefault();const rect=viewport.getBoundingClientRect();zoom(Math.exp(-event.deltaY*.0015),event.clientX-rect.left,event.clientY-rect.top);}
 function pointerDown(event){if(event.button!==0)return;drag={id:event.pointerId,x:event.clientX,y:event.clientY,startX:view.x,startY:view.y,moved:false};}
 function pointerMove(event){
  if(!drag||drag.id!==event.pointerId)return;
  const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
  if(!drag.moved&&Math.hypot(dx,dy)<5)return;
  drag.moved=true;viewport.setPointerCapture(event.pointerId);viewport.classList.add('is-dragging');
  view.x=drag.startX+dx;view.y=drag.startY+dy;applyView();
 }
 function pointerUp(event){if(drag?.moved)ignoreClickUntil=Date.now()+100;drag=null;viewport.classList.remove('is-dragging');if(viewport.hasPointerCapture(event.pointerId))viewport.releasePointerCapture(event.pointerId);}
 function focusNode(id){const p=layout?.positions.get(id);if(!p)return;view.x=viewport.clientWidth/2-p.x*view.scale;view.y=viewport.clientHeight/2-p.y*view.scale;applyView();}
 let bodyOverflow;
 function setExpanded(value){
  if(value===expanded)return;expanded=value;root.classList.toggle('is-expanded',value);
  if(value){bodyOverflow=document.body.style.overflow;document.body.style.overflow='hidden';}else if(bodyOverflow!==undefined){document.body.style.overflow=bodyOverflow;bodyOverflow=undefined;}
  const button=root.querySelector('[data-live-expand]');if(button){button.textContent=value?uiText("Reducir mapa"):uiText("Ampliar mapa");button.setAttribute('aria-pressed',String(value));}
  if(viewport&&layout)fit();
 }
 if(!embedded)dialog.addEventListener('cancel',event=>{if(expanded){event.preventDefault();setExpanded(false);}});
 root.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&expanded){event.preventDefault();event.stopPropagation();setExpanded(false);return;}
  const relation=event.target.closest('[data-live-relation]');
  if(relation&&['Enter',' '].includes(event.key)){event.preventDefault();relation.dispatchEvent(new MouseEvent('click',{bubbles:true}));return;}
  if(event.target!==viewport)return;
  const moves={ArrowLeft:[70,0],ArrowRight:[-70,0],ArrowUp:[0,70],ArrowDown:[0,-70]};
  if(moves[event.key]){event.preventDefault();view.x+=moves[event.key][0];view.y+=moves[event.key][1];applyView();}
  else if(event.key==='+'||event.key==='='){event.preventDefault();zoom(1.2);}
  else if(event.key==='-'){event.preventDefault();zoom(1/1.2);}
  else if(event.key==='Home'){event.preventDefault();centerProject();}
 });
 root.addEventListener('change',event=>{if(event.target.matches('[data-live-request]')){requestFilter=event.target.value;selectedRelation=null;render();}});
 root.addEventListener('click',async event=>{
 if(Date.now()<ignoreClickUntil)return;
 const scale=event.target.closest('[data-live-zoom]');if(scale){zoom(scale.dataset.liveZoom==='in'?1.25:.8);return;}
 if(event.target.closest('[data-live-fit]')){fit();return;}
 if(event.target.closest('[data-live-center]')){centerProject();return;}
 if(event.target.closest('[data-live-expand]')){setExpanded(!expanded);return;}
 if(event.target.closest('[data-live-details]')){detailsOpen=!detailsOpen;inspect();return;}
 const relation=event.target.closest('[data-live-relation]');if(relation){selectedRelation=relation.dataset.liveRelation;detailsOpen=true;inspect();return;}
 if(event.target.closest('[data-live-back]')){if(embedded)cleanup();else dialog.close();return;}
 if(event.target.closest('[data-live-refresh]')){load();return;}
 const choice=event.target.closest('[data-live-node],[data-live-select]');if(choice){const fromInspector=Boolean(choice.dataset.liveSelect);selected=choice.dataset.liveNode||choice.dataset.liveSelect;selectedRelation=null;detailsOpen=true;if(!root.querySelector(`[data-live-node="${CSS.escape(selected)}"]`)){requestFilter='all';render();}else inspect();if(fromInspector)focusNode(selected);return;}
 const source=event.target.closest('[data-live-document]');if(!source)return;
 const run=generation;source.disabled=true;
 try{
 const blob=await request(`/api/v1/documents/${encodeURIComponent(source.dataset.liveDocument)}/file`,undefined,true);
 if(!current(run))return;
 if(objectUrl)URL.revokeObjectURL(objectUrl);objectUrl=URL.createObjectURL(blob);
 const pdf=document.createElement('dialog');pdfDialog=pdf;pdf.className='gd-pdf-dialog';pdf.setAttribute('aria-label',uiText("Documento fuente"));
 pdf.innerHTML=`<div class="gd-pdf-head"><strong>${uiText("Documento fuente")}</strong><button aria-label="${uiText("Cerrar documento")}" title="${uiText("Cerrar documento")}">${icon('x')}</button></div><iframe title="${uiText("Documento fuente privado")}"></iframe>`;
 pdf.querySelector('iframe').src=objectUrl;document.body.append(pdf);pdf.showModal();pdf.querySelector('button').onclick=()=>pdf.close();
 pdf.addEventListener('close',()=>{pdf.remove();if(objectUrl){URL.revokeObjectURL(objectUrl);objectUrl=null;}pdfDialog=null;if(source.isConnected)source.focus();},{once:true});
 }catch(error){if(current(run)){const message=document.createElement('p');message.setAttribute('role','alert');message.textContent=error.message;root.querySelector('.gd-inspector').append(message);}}
 finally{source.disabled=false;}
 });
 await load();
 return cleanup;
}
