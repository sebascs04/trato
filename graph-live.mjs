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
 const initial=nodes.filter(n=>n.kind==='Document'&&n.business_kind==='initial_agreement').sort((a,b)=>(a.created_at||'').localeCompare(b.created_at||'')||a.entity_key.localeCompare(b.entity_key))[0]?.entity_key;
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
 for(const [id,parent] of parents)if(id!==initial)children.get(parent===initial?root:parent)?.push(id);
 for(const values of children.values())values.sort((a,b)=>(byId.get(a).created_at||'').localeCompare(byId.get(b).created_at||'')||a.localeCompare(b));
 // Tidy horizontal tree: each branch owns its vertical space. Stable source
 // order and fixed card dimensions keep siblings aligned without force drift.
 const positions=new Map(),depth=new Map([[root,0]]),heights=new Map();
 function measure(id){const kids=children.get(id)||[];const slots=Math.max(1,kids.reduce((sum,c)=>sum+measure(c),0));heights.set(id,slots);return slots;}
 measure(root);
 const degree=new Map(nodes.map(n=>[n.entity_key,0]));
 for(const edge of edges){degree.set(edge.source,(degree.get(edge.source)||0)+1);degree.set(edge.target,(degree.get(edge.target)||0)+1);}
 const cardHeight=id=>Math.max(112,((degree.get(id)||0)+1)*16);
 const column=340,row=Math.max(152,...nodes.filter(n=>n.kind!=='Project').map(n=>cardHeight(n.entity_key)+36)),padding=100;
 function place(id,level,top){
  depth.set(id,level);const span=heights.get(id)*row;
  positions.set(id,{x:150+level*column,y:padding+top+span/2,depth:level,height:cardHeight(id)});
  let offset=top;
  for(const child of children.get(id)||[]){place(child,level+1,offset);offset+=heights.get(child)*row;}
 }
 place(root,0,0);
 const projectPosition=positions.get(root);
 if(initial){
  // The initial agreement is a visual reference, not a new factual parent.
  positions.set(initial,{x:projectPosition.x,y:projectPosition.y,depth:1,height:cardHeight(initial)});
  positions.set(root,{...projectPosition,x:projectPosition.x-column});
  for(const [id,point] of positions)positions.set(id,{...point,x:point.x+column});
 }
 const width=Math.max(600,...[...positions.values()].map(p=>p.x+150));
 const height=Math.max(440,heights.get(root)*row+padding*2);
 const origin=positions.get(initial||root);
 return {positions,width,height,centerX:origin?.x||150,centerY:origin?.y||220,anchorId:initial||root,firstRadius:340,radii:[]};
}

function relationGeometry(a,b,ports,obstacles=[]){
 const {start,end,sourceSide,targetSide,laneIndex,sourceFraction,targetFraction}=ports;
 const offset=laneIndex*12;
 const lane=sourceSide===targetSide?(sourceSide>0?Math.max(start.x,end.x)+32+offset:Math.min(start.x,end.x)-32-offset):(start.x+(end.x-start.x)*(.2+.6*sourceFraction));

 let points=[start,{x:lane,y:start.y},{x:lane,y:end.y},end];
 const blocked=points.slice(1).some((to,i)=>obstacles.some(p=>p!==a&&p!==b&&(points[i].y===to.y
  ?Math.abs(p.y-to.y)<(p.height||112)/2+16&&Math.max(points[i].x,to.x)>p.x-122&&Math.min(points[i].x,to.x)<p.x+122
  :Math.abs(p.x-to.x)<122&&Math.max(points[i].y,to.y)>p.y-(p.height||112)/2-16&&Math.min(points[i].y,to.y)<p.y+(p.height||112)/2+16)));
 if(blocked){
  const top=Math.min(...obstacles.map(p=>p.y-(p.height||112)/2))-48-offset,bottom=Math.max(...obstacles.map(p=>p.y+(p.height||112)/2))+48+offset;
  const track=Math.abs(start.y-top)+Math.abs(end.y-top)<=Math.abs(start.y-bottom)+Math.abs(end.y-bottom)?top:bottom;
  const exit=start.x+sourceSide*(16+sourceFraction*32),entry=end.x+targetSide*(16+targetFraction*32);
  points=[start,{x:exit,y:start.y},{x:exit,y:track},{x:entry,y:track},{x:entry,y:end.y},end];
 }
 const lengths=points.slice(1).map((p,i)=>Math.hypot(p.x-points[i].x,p.y-points[i].y));
 const total=lengths.reduce((sum,d)=>sum+d,0);
 const point=t=>{let remaining=Math.max(0,Math.min(1,t))*total;
  for(let i=0;i<lengths.length;i++){if(remaining<=lengths[i]||i===lengths.length-1){const ratio=lengths[i]?remaining/lengths[i]:0;return {x:points[i].x+(points[i+1].x-points[i].x)*ratio,y:points[i].y+(points[i+1].y-points[i].y)*ratio};}remaining-=lengths[i];}
  return start;
 };
 const mid=point(.5);
 return {path:points.map((p,i)=>`${i?'L':'M'}${p.x} ${p.y}`).join(' '),x:mid.x,y:mid.y,point,start,end,points};
}

// Allocate incoming and outgoing endpoints together so they never share a port.
export function routeProjectGraph(edges,positions){
 const groups=new Map(),ports=new Map();
 for(const edge of edges){
  const a=positions.get(edge.source),b=positions.get(edge.target);
  const sourceSide=b.x>=a.x?1:-1,targetSide=b.x===a.x?1:-sourceSide;
  ports.set(edge.edge_key,{sourceSide,targetSide,laneIndex:0});
  for(const [role,id,side,other] of [['start',edge.source,sourceSide,b],['end',edge.target,targetSide,a]]){
   const key=id+':'+side;if(!groups.has(key))groups.set(key,[]);
   groups.get(key).push({edge:edge.edge_key,role,id,side,other});
  }
 }
 for(const entries of groups.values()){
  entries.sort((a,b)=>a.other.y-b.other.y||a.other.x-b.other.x||a.edge.localeCompare(b.edge)||a.role.localeCompare(b.role));
  entries.forEach((entry,index)=>{
   const node=positions.get(entry.id),value=ports.get(entry.edge);
   const height=node.height||Math.max(112,(entries.length+1)*16);
   value[entry.role]={x:node.x+entry.side*112,y:node.y-height/2+(index+1)*height/(entries.length+1)};
   value[entry.role==='start'?'sourceFraction':'targetFraction']=(index+1)/(entries.length+1);
   value.laneIndex=Math.max(value.laneIndex,index);
  });
 }
 const obstacles=[...positions.values()],routes=new Map();
 for(const edge of edges)routes.set(edge.edge_key,relationGeometry(positions.get(edge.source),positions.get(edge.target),ports.get(edge.edge_key),obstacles));
 return routes;
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
 let generation=0,data,selected,all=[],edges=[],byId=new Map(),objectUrl,pdfDialog,observer,disposed=false,requestFilter='all',selectedRelation=null,detailsOpen=false,expanded=false,view={x:0,y:0,scale:1},layout,routes=new Map(),viewport,scene,resizeObserver,drag,ignoreClickUntil=0;
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
 routes=routeProjectGraph(viewEdges,positions);
 root.innerHTML=header()+`<div class="gd-toolbar"><label>${uiText("Ver")} <select data-live-request aria-label="${uiText("Filtrar mapa por pedido")}"><option value="all">${uiText("Todo el proyecto")}</option>${requests.map(n=>`<option value="${esc(n.entity_key)}" ${n.entity_key===requestFilter?'selected':''}>${esc(n.title)}</option>`).join('')}</select></label><span>${uiText("graph.count",{nodes:new Intl.NumberFormat(uiLocale()).format(viewNodes.length),edges:new Intl.NumberFormat(uiLocale()).format(viewEdges.length)})}</span><div class="gd-space-actions"><button class="gd-filter" data-live-details aria-expanded="${detailsOpen}">${uiText("Detalles")}</button><button class="gd-filter" data-live-expand aria-pressed="${expanded}">${expanded?uiText("Reducir mapa"):uiText("Ampliar mapa")}</button></div></div><div class="gd-body"><section class="gd-map" aria-label="${uiText("Relaciones del proyecto")}" tabindex="0"><div class="gd-scene" style="width:${width}px;height:${height}px"><svg class="gd-lines" viewBox="0 0 ${width} ${height}" aria-label="${uiText("Relaciones entre elementos")}"><defs><marker id="live-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto"><path d="M0 0 L8 4 L0 8" fill="#9b8bd3"/></marker></defs><g class="gd-orbits" aria-hidden="true">${layout.radii.map(r=>`<circle cx="${centerX}" cy="${centerY}" r="${r}"/>`).join('')}</g>${viewEdges.map(e=>{const line=routes.get(e.edge_key);return `<g class="gd-edge" data-live-edge="${esc(e.edge_key)}" data-live-relation="${esc(e.edge_key)}" role="button" tabindex="0" aria-label="${esc(title(byId.get(e.source))+' '+(links[e.kind]||e.kind)+' '+title(byId.get(e.target)))}"><path class="gd-edge-hit" d="${line.path}"/><path class="gd-edge-line" marker-end="url(#live-arrow)" d="${line.path}"/><circle class="gd-port" cx="${line.start.x}" cy="${line.start.y}" r="3"/><rect class="gd-edge-label-bg" rx="5"/><text x="${line.x}" y="${line.y-7}">${esc(links[e.kind]||e.kind)}</text></g>`;}).join('')}</svg>${viewNodes.map(n=>{const p=positions.get(n.entity_key);return `<button class="gd-node ${n.kind==='Project'?'is-root':''}" style="left:${p.x}px;top:${p.y}px;height:${p.height}px;min-height:${p.height}px" data-live-node="${esc(n.entity_key)}" data-live-depth="${p.depth}"><span class="gd-node-top"><span class="gd-node-icon">${icon(kinds[n.kind]?.[1]||'file-text')}</span><span class="gd-node-kind">${esc(kinds[n.kind]?.[0])}</span></span><strong>${esc(title(n))}</strong><span class="gd-node-description">${esc(n.is_current_revision?uiText("graph.currentRevision"):(states[n.status]|| (n.kind==='Revision'?uiText("Propuesta de cambio"):'')))}</span></button>`;}).join('')}</div></section><div class="gd-map-controls" role="group" aria-label="${uiText("Navegar por el mapa")}"><button class="gd-filter" data-live-zoom="out">${uiText("Alejar")}</button><output data-live-scale aria-label="${uiText("Nivel de zoom")}">100%</output><button class="gd-filter" data-live-zoom="in">${uiText("Acercar")}</button><button class="gd-filter" data-live-fit>${uiText("Ajustar")}</button><button class="gd-filter" data-live-center>${uiText("Ir al proyecto")}</button></div><span class="gd-navigation-hint">${uiText("Arrastra para moverte · Rueda para ampliar")}</span><aside class="gd-inspector" aria-label="${uiText("Detalle del elemento seleccionado")}" aria-live="polite" ${detailsOpen?'':'hidden'}></aside></div>`;
 viewport=root.querySelector('.gd-map');scene=root.querySelector('.gd-scene');
 resizeObserver?.disconnect();resizeObserver=new ResizeObserver(()=>{if(!disposed&&scene?.isConnected)applyView();});resizeObserver.observe(viewport);
 viewport.addEventListener('wheel',wheel,{passive:false});
 viewport.addEventListener('pointerdown',pointerDown);viewport.addEventListener('pointermove',pointerMove);viewport.addEventListener('pointerup',pointerUp);viewport.addEventListener('pointercancel',pointerUp);
 centerReference();
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
  placeRelationLabels();
  return;
 }
 const description=node.scope_summary||(node.business_kind==='email_request'?uiText("Conversación que respalda el pedido del cliente."):node.kind==='Acceptance'?uiText("Aceptación registrada mediante revisión manual del documento devuelto."):node.kind==='Payment'?(node.status==='completed'?uiText("Pago confirmado por el backend."):uiText("Este pago aún no está confirmado.")):uiText("Registro del proyecto y sus conexiones documentadas."));
 aside.innerHTML=close+`<span class="gd-eyebrow">${esc(kinds[node.kind]?.[0])}</span><h2>${esc(title(node))}</h2><p class="gd-detail-copy">${esc(description)}</p><div class="gd-connections"><h3>${uiText("Conectado con")}</h3><div class="gd-connection-legend" aria-label="${uiText("graph.directionLegend")}"><span>${icon('arrow-left')}${uiText("graph.incoming")}</span><span>${icon('arrow-right')}${uiText("graph.outgoing")}</span></div>${related.map(e=>{const other=byId.get(e.source===selected?e.target:e.source);return `<button class="gd-connection" data-live-select="${esc(other.entity_key)}">${icon(kinds[other.kind]?.[1]||'file-text')}<span>${esc(title(other))}<small>${e.source===selected?'→':'←'} ${esc(links[e.kind]||e.kind)}</small></span>${icon('chevron-right')}</button>`;}).join('')||("<p class=\"gd-detail-copy\">"+uiText("Sin conexiones registradas.")+"</p>")}</div>${node.kind==='Document'?`<button class="gd-document-action" data-live-document="${esc(node.source_id)}">${icon('file-text')}${uiText("Ver documento fuente")}</button>`:''}`;
  placeRelationLabels();
 }
 function applyView(){
  if(!scene)return;scene.style.transform=`translate(${view.x}px,${view.y}px) scale(${view.scale})`;scene.style.setProperty('--gd-label-scale','1');
  placeRelationLabels();
  const output=root.querySelector('[data-live-scale]');if(output)output.textContent=Math.round(view.scale*100)+'%';
 }
 function availableMapWidth(){return Math.max(240,viewport.clientWidth-(detailsOpen?Math.min(330,viewport.clientWidth*.4):0));}
 function centerReference(){
  if(!viewport||!layout)return;
  view.scale=1;
  view.x=(layout.anchorId===all.find(n=>n.kind==='Project')?.entity_key?160:availableMapWidth()/2)-layout.centerX;view.y=viewport.clientHeight/2-layout.centerY;applyView();
 }
 function centerProject(){
  const project=all.find(n=>n.kind==='Project');if(!project)return;
  view.scale=1;focusNode(project.entity_key);
 }
 // Position labels in the gaps, avoiding cards and other active labels.
 function placeRelationLabels(){
  if(!scene||!layout)return;
  const boxes=[...layout.positions.values()].map(p=>({x:p.x-122,y:p.y-p.height/2-10,w:244,h:p.height+20}));
  const overlaps=(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;
  const segments=[...routes.values()].flatMap(route=>route.points.slice(1).map((end,index)=>[route.points[index],end]));
  const crossesLine=box=>segments.some(([a,b])=>a.y===b.y
   ?a.y>box.y-8&&a.y<box.y+box.h+8&&Math.max(a.x,b.x)>box.x-8&&Math.min(a.x,b.x)<box.x+box.w+8
   :a.x>box.x-8&&a.x<box.x+box.w+8&&Math.max(a.y,b.y)>box.y-8&&Math.min(a.y,b.y)<box.y+box.h+8);
  const placed=[];
  for(const group of root.querySelectorAll('.gd-edge')){
   const label=group.querySelector('text');if(!label)continue;
   label.classList.remove('is-crowded');group.classList.remove('has-label');if(!group.classList.contains('is-active'))continue;
   const edge=edges.find(e=>e.edge_key===group.dataset.liveEdge);
   const geometry=routes.get(edge.edge_key);
   const bounds=label.getBBox(),w=bounds.width+24,h=28;
   let chosen;
   for(const t of [.5,.65,.35,.8,.2,.92,.08]){
    const point=geometry.point(t);
    for(const dy of [-18,28,-48,58,-84,94,-120,130]){
     const box={x:point.x-w/2,y:point.y+dy-h,w,h};
     if(!boxes.some(b=>overlaps(box,b))&&!placed.some(b=>overlaps(box,b))&&!crossesLine(box)){chosen=box;break;}
    }
    if(chosen)break;
   }
   // In a dense overview the inspector still lists every factual connection.
   if(!chosen){label.classList.add('is-crowded');continue;}
   placed.push(chosen);group.classList.add('has-label');label.setAttribute('x',chosen.x+w/2);label.setAttribute('y',chosen.y+h-9);
   const background=group.querySelector('.gd-edge-label-bg');
   for(const [key,value] of Object.entries({x:chosen.x,y:chosen.y,width:w,height:h}))background.setAttribute(key,String(value));
  }
 }
 function fit(){
  const availableWidth=Math.max(200,viewport.clientWidth-(detailsOpen?Math.min(320,viewport.clientWidth*.4):0));
  const points=[...layout.positions.values()];
  const left=Math.min(...points.map(p=>p.x))-130,right=Math.max(...points.map(p=>p.x))+130;
  const top=Math.min(...points.map(p=>p.y-p.height/2))-24,bottom=Math.max(...points.map(p=>p.y+p.height/2))+24;
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
 function focusNode(id){const p=layout?.positions.get(id);if(!p)return;view.scale=Math.max(.85,view.scale);view.x=availableMapWidth()/2-p.x*view.scale;view.y=viewport.clientHeight/2-p.y*view.scale;applyView();}
 let bodyOverflow;
 function setExpanded(value){
  if(value===expanded)return;expanded=value;root.classList.toggle('is-expanded',value);
  if(value){bodyOverflow=document.body.style.overflow;document.body.style.overflow='hidden';}else if(bodyOverflow!==undefined){document.body.style.overflow=bodyOverflow;bodyOverflow=undefined;}
  const button=root.querySelector('[data-live-expand]');if(button){button.textContent=value?uiText("Reducir mapa"):uiText("Ampliar mapa");button.setAttribute('aria-pressed',String(value));}
  if(viewport&&layout){if(detailsOpen)focusNode(selected);else centerReference();}
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
 if(Date.now()<ignoreClickUntil&&viewport?.contains(event.target))return;
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
