import {uiText,uiLocale} from './i18n.mjs';
import {icon} from './icons.mjs';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const kinds={Dispute:[uiText('graph.dispute'),'messages-square'],ProblemReport:[uiText('graph.problemReport'),'flag'],StageReview:[uiText('graph.stageReview'),'circle-check'],ClientChangeRequest:[uiText('graph.clientChangeRequest'),'messages-square'],Refund:[uiText('graph.refund'),'undo-2'],RefundVersion:[uiText('graph.refundProposal'),'file-text'],RefundReceipt:[uiText('graph.refundReceipt'),'credit-card'],Plan:[uiText('graph.initialPlan'),'layout-dashboard'],PlanStage:[uiText('graph.planStage'),'file-text'],Project:[uiText("Proyecto"),'layout-dashboard'],Document:[uiText("Documento"),'file-text'],Extraction:[uiText("Texto extraído"),'file-text'],Proposal:[uiText("Propuesta"),'git-compare-arrows'],Revision:[uiText("Adenda"),'pencil'],Review:[uiText("Revisión"),'eye'],Acceptance:[uiText("Aceptación"),'file-text'],Delivery:[uiText("Envío"),'send'],Payment:[uiText("Pago"),'credit-card']};
const links={
 HAS_DISPUTE:uiText('graph.hasDispute'),DISPUTE_CONFIRMED_REFUND:uiText('graph.disputeConfirmedRefund'),REPORTS_PROBLEM_ON:uiText('graph.reportsProblemOn'),HAS_PROBLEM_REPORT:uiText('graph.reportsProblemOn'),BECAME_REQUEST:uiText('graph.becameRequest'),
 CLIENT_STAGE_REVIEW:uiText('graph.clientStageReview'),REVIEWS_DELIVERY:uiText('graph.reviewsDelivery'),HAS_CHANGE_REQUEST:uiText('graph.hasChangeRequest'),HAS_NEW_WORK:uiText('graph.hasNewWork'),
 HAS_REFUND:uiText('graph.hasRefund'),HAS_REFUND_VERSION:uiText('graph.hasRefundVersion'),
 REFUND_EVIDENCE:uiText('graph.refundEvidence'),REFUND_PDF:uiText('graph.refundPdf'),
 REFUND_ACCEPTANCE_EVIDENCE:uiText('graph.refundAcceptanceEvidence'),REFUND_FEEDBACK_EVIDENCE:uiText('graph.refundFeedbackEvidence'),
 REFUND_ORIGINAL_PAYMENT:uiText('graph.refundOriginalPayment'),REFUND_CONFIRMED_RECEIPT:uiText('graph.refundConfirmedReceipt'),
 REFUND_APPLIES_TO_PAYMENT:uiText('graph.refundAppliesToPayment'),HAS_PLAN:uiText('graph.hasPlan'),HAS_STAGE:uiText('graph.hasStage'),DELIVERY_EVIDENCE:uiText('graph.deliveryEvidence'),STAGE_PAYMENT:uiText('graph.stagePayment'),PAYMENT_EVIDENCE:uiText('graph.paymentEvidence'),HAS_INITIAL_AGREEMENT:uiText('graph.hasInitialAgreement'),RECEIVES_REQUEST:uiText('graph.receivesRequest'),HAS_CHANGE_PROPOSAL:uiText('graph.hasChangeProposal'),HAS_DOCUMENT:uiText("Contiene"),HAS_EXTRACTION:uiText("Tiene texto extraído"),HAS_PROPOSAL:uiText("Incluye propuesta"),RESPONDS_TO:uiText("Responde al pedido"),HAS_REVISION:uiText("Tiene adenda"),CURRENT_REVISION:uiText("Tiene como vigente"),SUPPORTED_BY:uiText("Usa como fuente"),HAS_PDF:uiText("Tiene PDF"),HAS_REVIEW:uiText("Tiene revisión"),REVIEWED_PDF:uiText("Revisa"),ACCEPTS_REVISION:uiText("Acepta esta adenda"),EVIDENCED_BY:uiText("Se respalda en"),FOR_REVISION:uiText("Corresponde a"),FOLLOWS_ACCEPTANCE:uiText("Sigue a"),REPLACES_DRAFT:uiText("Reemplaza"),REQUESTED_CHANGES_FROM:uiText("Recoge ajustes de"),BASED_ON_ACCEPTANCE:uiText("Se basa en"),CURRENT_ACCEPTANCE:uiText("Tiene acuerdo vigente")};
const states={open:uiText('graph.disputeOpen'),escalated:uiText('graph.disputeEscalated'),resolved:uiText('graph.disputeResolved'),unresolved:uiText('graph.problemUnresolved'),approved:uiText('graph.stageApproved'),changes_requested:uiText('graph.stageChangesRequested'),planned:uiText('graph.planActive'),finished:uiText('graph.planCompleted'),draft:uiText("Borrador"),active:uiText("Activo"),closed:uiText("Cerrado"),queued:uiText("Por leer"),ready:uiText("Disponible"),error:uiText("Error"),accepted:uiText("Aceptado"),ready_for_review:uiText("Por revisar"),completed:uiText("Pagado"),created:uiText("Pendiente"),sending:uiText("Enviando"),accepted_by_gmail:uiText("Envío registrado"),failed:uiText("Falló"),delivery_uncertain:uiText("Envío por verificar")};
const formatDate=value=>value?new Intl.DateTimeFormat(uiLocale(),{dateStyle:'medium',timeStyle:'short',timeZone:'America/Lima'}).format(new Date(value)):'';
// The client's own steps say what happened and when, from the recorded fields only.
const problemReasons=['not_received','not_as_agreed','quality','other'];
const problemReportDetail=n=>uiText(n.status==='open'?'graph.problemReportOpen':n.status==='resolved'?'graph.problemReportResolved':'graph.problemReportUnresolved',
 {reason:uiText(`problems.reason.${problemReasons.includes(n.reason)?n.reason:'other'}`),date:formatDate(n.created_at)});
const stageReviewDetail=n=>uiText(n.status==='approved'?'graph.stageReviewApproved':'graph.stageReviewChanges',{number:n.stage_position,date:formatDate(n.created_at)});
const refundDocumentLinks=['REFUND_EVIDENCE','REFUND_PDF','REFUND_ACCEPTANCE_EVIDENCE','REFUND_FEEDBACK_EVIDENCE'];
const scopeKeys={plan:'project_start_plans:',change:'documents:',refund:'refund_settlements:'};
const caseRoot=n=>['Plan','Refund'].includes(n.kind)||n.kind==='Document'&&n.business_kind==='email_request';
const title=n=>n.title||(n.kind==='RefundVersion'?uiText('graph.refundVersion',{version:n.revision_no}):null)||(n.kind==='Plan'?uiText('graph.initialPlan'):null)||(n.kind==='Revision'?`${uiText("Adenda v")}${n.revision_no}`:n.kind==='Document'?n.title:['Payment','RefundReceipt'].includes(n.kind)?new Intl.NumberFormat(uiLocale(),{style:'currency',currency:n.currency}).format(n.amount_minor/100):kinds[n.kind]?.[0]||uiText("Registro"));
// User-facing graph: keep business records, fold verified extraction paths into documents.
// The persisted Neo4j projection and its audit metadata are never rewritten here.
export function presentProjectGraph(data){
 const records=new Map(data.nodes.map(node=>[node.entity_key,node]));
 const replaced=new Set(data.edges.filter(e=>e.kind==='REPLACES_DRAFT').map(e=>e.target));
 const referenced=new Set(data.edges.filter(e=>['ACCEPTS_REVISION','FOR_REVISION'].includes(e.kind)).map(e=>e.target));
 const businessKinds=new Set(['Project','Document','Proposal','Revision','Acceptance','Payment','Plan','PlanStage','ClientChangeRequest','Dispute','ProblemReport','StageReview','Refund','RefundVersion','RefundReceipt']);
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
 return keyProjectGraph(data,{nodes:nodes.map(n=>currentNodes.has(n.entity_key)?{...n,is_current_revision:true}:n),edges});
}

// Presentation only: a version and its exact PDF are one card, not two milestones.
function keyProjectGraph(original,presentation){
 const records=new Map(presentation.nodes.map(n=>[n.entity_key,n]));
 const attachments=new Map(),folded=new Map(),proposalRequests=new Map();
 for(const proposal of presentation.nodes.filter(n=>n.kind==='Proposal')){
  const requests=presentation.edges.filter(e=>e.source===proposal.entity_key&&e.kind==='RESPONDS_TO'&&records.get(e.target)?.business_kind==='email_request');
  if(requests.length===1)proposalRequests.set(proposal.entity_key,requests[0]);
 }
 for(const edge of presentation.edges){
  const owner=records.get(edge.source),doc=records.get(edge.target);
  if(!doc||doc.kind!=='Document'||['initial_agreement','email_request'].includes(doc.business_kind))continue;
  if(!(edge.kind==='HAS_PDF'&&owner?.kind==='Revision'||edge.kind==='EVIDENCED_BY'&&owner?.kind==='Acceptance'))continue;
  if(!attachments.has(doc.entity_key))attachments.set(doc.entity_key,[]);attachments.get(doc.entity_key).push(edge);
 }
 for(const [id,links] of attachments)if(new Set(links.map(e=>e.source)).size===1)folded.set(id,links[0].source);
 const nodes=presentation.nodes.filter(n=>!folded.has(n.entity_key)&&!proposalRequests.has(n.entity_key)).map(n=>{
  const documents=[...attachments].filter(([id,links])=>folded.get(id)===n.entity_key).map(([id,links])=>({id:records.get(id).source_id,title:records.get(id).title,role:links[0].kind==='HAS_PDF'?'pdf':'acceptance'}));
  if(n.kind!=='Revision')return documents.length?{...n,documents}:n;
  const accepted=original.edges.some(e=>e.kind==='ACCEPTS_REVISION'&&e.target===n.entity_key);
  const sent=original.edges.some(e=>e.kind==='FOR_REVISION'&&e.target===n.entity_key&&original.nodes.some(source=>source.entity_key===e.source&&source.kind==='Delivery'&&source.business_kind==='adenda'&&source.status==='accepted_by_gmail'));
  return {...n,documents,milestone:accepted?'accepted':n.status==='rejected'?'rejected':sent?'sent':'created'};
 });
 const visible=new Set(nodes.map(n=>n.entity_key)),edges=[];
 const add=e=>{if(e.source!==e.target&&visible.has(e.source)&&visible.has(e.target)&&!edges.some(x=>x.source===e.source&&x.target===e.target&&x.kind===e.kind))edges.push(e);};
 for(const edge of presentation.edges){
  if(edge.kind==='HAS_REVISION'&&proposalRequests.has(edge.source)){
   const request=proposalRequests.get(edge.source);
   add({...edge,edge_key:'version-request:'+edge.edge_key,source:edge.target,target:request.target,kind:'RESPONDS_TO',evidence_edges:[edge.edge_key,request.edge_key]});continue;
  }
  if(folded.has(edge.target)){
   // Project containment and the artifact relation are represented by the card itself.
   if(['HAS_DOCUMENT','HAS_PDF','EVIDENCED_BY'].includes(edge.kind))continue;
   add({...edge,target:folded.get(edge.target),evidence_edges:[...(edge.evidence_edges||[edge.edge_key]),...attachments.get(edge.target).map(e=>e.edge_key)]});continue;
  }
  add(edge);
 }
 return assignProjectGraphCases(readableProjectGraph({nodes,edges}));
}
// Inverse reading labels describe the same verified relationship from the request.
// Source evidence stays available in details instead of drawing a parallel arrow.
export function readableProjectGraph(graph){
 const byId=new Map(graph.nodes.map(n=>[n.entity_key,n]));
 const edges=graph.edges.map(e=>{
  const source=byId.get(e.source),target=byId.get(e.target);
  if(e.kind==='HAS_DOCUMENT'&&source?.kind==='Project'&&target?.business_kind==='initial_agreement')return {...e,kind:'HAS_INITIAL_AGREEMENT',original_kind:e.kind};
  if(e.kind==='HAS_DOCUMENT'&&source?.kind==='Project'&&target?.business_kind==='email_request')return {...e,kind:'RECEIVES_REQUEST',original_kind:e.kind};
  if(e.kind==='RESPONDS_TO'&&source?.kind==='Revision'&&target?.business_kind==='email_request')return {...e,kind:'HAS_CHANGE_PROPOSAL',source:e.target,target:e.source,original_kind:e.kind,original_source:e.source,original_target:e.target};
  return {...e};
 });
 const folded=new Set();
 for(const primary of edges.filter(e=>e.kind==='HAS_CHANGE_PROPOSAL')){
  const evidence=edges.filter(e=>e.kind==='SUPPORTED_BY'&&e.source===primary.target&&e.target===primary.source);
  if(!evidence.length)continue;
  primary.evidence_relations=evidence;
  primary.evidence_edges=[...new Set([...(primary.evidence_edges||[primary.edge_key]),...evidence.flatMap(e=>e.evidence_edges||[e.edge_key])])];
  evidence.forEach(e=>folded.add(e));
 }
 return {nodes:graph.nodes,edges:edges.filter(e=>!folded.has(e))};
}
export function renderProjectGraphReading(){
 const samples=[
  [uiText('graph.readExampleProject'),uiText('graph.hasInitialAgreement'),uiText('graph.readExampleAgreement')],
  [uiText('graph.readExampleRequest'),uiText('graph.hasChangeProposal'),uiText('graph.readExampleAddendum')]
 ];
 return `<details class="gd-reading-guide"><summary>${uiText('graph.howToRead')}</summary><p>${uiText('graph.readArrow')}</p>${samples.map(([source,relation,target])=>`<p class="gd-reading-example"><strong>${esc(source)}</strong><span> → ${esc(relation)} → </span><strong>${esc(target)}</strong></p>`).join('')}</details>`;
}

export function projectGraphMilestone(node){
 const milestones={created:uiText('graph.version.created'),sent:uiText('graph.version.sent'),accepted:uiText('graph.version.accepted'),rejected:uiText('graph.version.rejected')};
 if(node.kind==='Refund')return uiText(`refund.status.${node.status}`);
 if(node.kind==='RefundReceipt')return uiText('graph.refundVerified');
 if(node.kind==='RefundVersion')return node.status==='accepted'?uiText('graph.version.accepted'):'';
 if(node.kind==='PlanStage')return uiText('graph.stageNumber',{number:node.position})+' · '+new Intl.NumberFormat(uiLocale(),{style:'currency',currency:'USD'}).format(Number(node.amount));
 return node.kind==='Revision'?milestones[node.milestone||'created']:(states[node.status]||'');
}

// Colors identify a request's story, never its payment or acceptance status.
export function assignProjectGraphCases(graph){
 const requests=graph.nodes.filter(caseRoot).sort((a,b)=>(a.created_at||'').localeCompare(b.created_at||'')||a.entity_key.localeCompare(b.entity_key));
 const palette=[['#7350b5','#f2edf9'],['#1476a8','#eaf5fc'],['#b15c13','#fff3e8'],['#14806e','#e8f7f3'],['#bd3c6c','#fceef4'],['#5168b5','#eef1fc'],['#7a771a','#f6f5e7'],['#a4472b','#fcf0eb']];
 const cases=requests.map((n,index)=>{const [color,soft]=palette[index]||[`hsl(${(index*137.508)%360} 55% 37%)`,`hsl(${(index*137.508)%360} 60% 96%)`];return {id:n.entity_key,index,title:n.kind==='Plan'?uiText('graph.initialPlan'):n.kind==='Refund'?uiText('graph.refundCase',{number:requests.slice(0,index+1).filter(x=>x.kind==='Refund').length}):n.title||uiText('graph.unnamedRequest',{number:index+1}),color,soft};});
 const memberships=new Map(graph.nodes.map(n=>[n.entity_key,new Set(caseRoot(n)?[n.entity_key]:[])]));
 for(let pass=0;pass<graph.nodes.length;pass++){
  let changed=false;
  for(const e of graph.edges){
   let from,to;
   if(['RESPONDS_TO','ACCEPTS_REVISION','FOR_REVISION','FOLLOWS_ACCEPTANCE'].includes(e.kind)){from=e.target;to=e.source;}
   else if(['HAS_CHANGE_PROPOSAL','HAS_REVISION','HAS_PDF','EVIDENCED_BY','HAS_STAGE','DELIVERY_EVIDENCE','STAGE_PAYMENT','PAYMENT_EVIDENCE','HAS_REFUND_VERSION','REFUND_ORIGINAL_PAYMENT','REFUND_CONFIRMED_RECEIPT','HAS_DISPUTE','DISPUTE_CONFIRMED_REFUND',...refundDocumentLinks].includes(e.kind)){from=e.source;to=e.target;}
   else continue;
   for(const id of memberships.get(from)||[])if(memberships.has(to)&&!memberships.get(to).has(id)){memberships.get(to).add(id);changed=true;}
  }
  if(!changed)break;
 }
 const nodes=graph.nodes.map(n=>{const ids=memberships.get(n.entity_key);const item=ids.size===1?cases.find(c=>ids.has(c.id)):null;return item?{...n,case_id:item.id,case_title:item.title,case_index:item.index,case_color:item.color,case_soft:item.soft}:n;});
 const byId=new Map(nodes.map(n=>[n.entity_key,n]));
 const edges=graph.edges.map(e=>{const source=byId.get(e.source),target=byId.get(e.target);const item=source?.case_id&&target?.case_id&&source.case_id!==target.case_id?null:source?.case_id?source:target?.case_id?target:null;return item?{...e,case_id:item.case_id,case_index:item.case_index,case_color:item.case_color}:e;});
 return {nodes,edges,cases};
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
  if(n.kind==='Document')parent=incoming(id,'HAS_CHANGE_REQUEST')||incoming(id,'HAS_NEW_WORK')||incoming(id,'DELIVERY_EVIDENCE')||incoming(id,'HAS_PDF')||incoming(id,'EVIDENCED_BY')||refundDocumentLinks.map(kind=>incoming(id,kind)).find(Boolean)||root;
  else if(n.kind==='Refund')parent=incoming(id,'HAS_REFUND')||root;
  else if(n.kind==='RefundVersion')parent=incoming(id,'HAS_REFUND_VERSION')||root;
  else if(n.kind==='RefundReceipt')parent=incoming(id,'DISPUTE_CONFIRMED_REFUND')||incoming(id,'REFUND_CONFIRMED_RECEIPT')||outgoing(id,'REFUND_APPLIES_TO_PAYMENT')||root;
  else if(n.kind==='Plan')parent=incoming(id,'HAS_PLAN')||root;
  else if(n.kind==='PlanStage')parent=incoming(id,'HAS_STAGE')||root;
  else if(n.kind==='Proposal')parent=outgoing(id,'RESPONDS_TO')||root;
  else if(n.kind==='Revision')parent=incoming(id,'HAS_CHANGE_PROPOSAL')||outgoing(id,'RESPONDS_TO')||incoming(id,'HAS_REVISION')||root;
  else if(n.kind==='Extraction')parent=incoming(id,'HAS_EXTRACTION')||root;
  else if(n.kind==='Review')parent=incoming(id,'HAS_REVIEW')||root;
  else if(n.kind==='Acceptance')parent=outgoing(id,'ACCEPTS_REVISION')||root;
  else if(n.kind==='ClientChangeRequest')parent=outgoing(id,'ASKS_TO_CHANGE')||root;
  else if(n.kind==='Dispute')parent=incoming(id,'HAS_DISPUTE')||root;
  else if(n.kind==='ProblemReport')parent=outgoing(id,'REPORTS_PROBLEM_ON')||incoming(id,'HAS_PROBLEM_REPORT')||root;
  else if(n.kind==='StageReview')parent=incoming(id,'CLIENT_STAGE_REVIEW')||root;
  else if(n.kind==='Delivery')parent=outgoing(id,'FOR_REVISION')||root;
  else if(n.kind==='Payment')parent=incoming(id,'STAGE_PAYMENT')||outgoing(id,'FOLLOWS_ACCEPTANCE')||outgoing(id,'FOR_REVISION')||incoming(id,'REFUND_ORIGINAL_PAYMENT')||root;
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
 const cardHeight=id=>Math.max(byId.get(id)?.case_id?148:112,((degree.get(id)||0)+1)*16);
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
// One read per selection. A late success/error cannot replace the user's newer choice.
export function createProjectGraphReader({projectId,request,isCurrent=()=>true}){
 let epoch=0;
 return {
  invalidate(){epoch++;},
  async read(option={scope:'all'},expectedGeneration){
   const run=++epoch,scope=option.scope;
   const caseScope=scope==='change'||scope==='refund';
   if(scope!=='all'&&!Object.hasOwn(scopeKeys,scope)||caseScope&&!/^[a-f0-9-]{36}$/i.test(option.id||''))throw new Error(uiText("Las conexiones recibidas no corresponden al proyecto."));
   const base=`/api/v1/projects/${encodeURIComponent(projectId)}/graph`;
   const url=base+(scope==='all'?'':'?scope='+scope+(caseScope?'&request_id='+encodeURIComponent(option.id):''));
   try{
    const value=await request(url);
    if(run!==epoch||!isCurrent())return null;
    const root=value?.nodes?.find(n=>n.kind==='Project'&&n.source_id===projectId),ids=new Set((value?.nodes||[]).map(n=>n.entity_key));
    if(!root||!Array.isArray(value.edges)||!Array.isArray(value.scopes)||!Number.isInteger(value.generation)
     ||expectedGeneration!==undefined&&value.generation!==expectedGeneration
     ||value.scope?.kind!==scope||(value.scope.request_id??null)!==(caseScope?option.id:null)
     ||value.nodes.some(n=>n.project_id!==projectId||n.owner_id!==root.owner_id||n.generation!==value.generation)
     ||value.edges.some(e=>!ids.has(e.source)||!ids.has(e.target)||e.owner_id!==root.owner_id||e.project_id!==projectId)
     ||value.scopes.some(o=>!o||!Object.hasOwn(scopeKeys,o.scope)||typeof o.title!=='string'||typeof o.id!=='string'
       ||o.key!==scopeKeys[o.scope]+o.id||o.scope==='plan'&&o.id!==projectId)
     ||new Set(value.scopes.map(o=>o.key)).size!==value.scopes.length
     ||scope!=='all'&&!value.scopes.some(o=>o.scope===scope&&o.id===(scope==='plan'?projectId:option.id)))throw new Error(uiText("Las conexiones recibidas no corresponden al proyecto."));
    return value;
   }catch(error){if(run!==epoch||!isCurrent())return null;throw error;}
  }
 };
}
function graphError(error){
 const messages={GRAPH_NOT_CONFIGURED:'graph.notConfigured',GRAPH_UNAVAILABLE:'graph.unavailable',GRAPH_STALE:'graph.stale',
  GRAPH_PROJECTION_VERSION_UNSUPPORTED:'graph.syncFailed'};
 return messages[error.code]?uiText(messages[error.code]):error.message;
}
export async function openProjectGraph({projectId,request,returnFocus,isCurrent=()=>true,container}){
 if(!container&&document.querySelector('.gd-dialog'))return;
 await loadStyles();if(!isCurrent())return;
 const embedded=Boolean(container),dialog=container||document.createElement('dialog');
 if(!embedded){dialog.className='gd-dialog';dialog.setAttribute('aria-label',uiText("Mapa del proyecto"));document.body.append(dialog);}
 const root=document.createElement('div');root.className='graph-design graph-live'+(embedded?' graph-live-embedded':'');dialog.replaceChildren(root);
 let scopeOptions=[],scopeBusy=false,scopeError=null;
 let generation=0,data,selected,all=[],edges=[],cases=[],byId=new Map(),objectUrl,pdfDialog,observer,disposed=false,requestFilter='all',selectedRelation=null,detailsOpen=false,expanded=false,view={x:0,y:0,scale:1},layout,routes=new Map(),viewport,scene,resizeObserver,drag,ignoreClickUntil=0;
 const current=run=>!disposed&&(embedded?root.isConnected:dialog.open)&&run===generation&&isCurrent();
 const scopeReader=createProjectGraphReader({projectId,request,isCurrent:()=>!disposed&&(embedded?root.isConnected:dialog.open)&&isCurrent()});
 const header=()=>embedded?`<header class="gd-top"><div class="gd-heading"><h3>${uiText("Mapa del proyecto")}</h3><button class="gd-filter" data-live-refresh>${uiText("Actualizar mapa")}</button></div></header>`:`<header class="gd-top"><div class="gd-top-line"><button class="gd-back" data-live-back>${icon('arrow-left')}${uiText("Volver al proyecto")}</button><span class="gd-preview-label">${uiText("Datos del proyecto")}</span><span class="gd-brand">trato.</span></div><div class="gd-heading"><div><span class="gd-eyebrow">${uiText("SEGUIMIENTO")}</span><h1>${uiText("Mapa del proyecto")}</h1><p class="gd-intro">${uiText("Sigue las conexiones entre tus documentos, acuerdos y pagos.")}</p></div><button class="gd-filter" data-live-refresh>${uiText("Actualizar mapa")}</button></div></header>`;
 const cleanup=()=>{if(disposed)return;setExpanded(false);resizeObserver?.disconnect();disposed=true;generation++;scopeReader.invalidate();observer?.disconnect();if(pdfDialog?.open)pdfDialog.close();if(objectUrl){URL.revokeObjectURL(objectUrl);objectUrl=null;}if(embedded)root.remove();else dialog.remove();if(returnFocus?.isConnected)returnFocus.focus();};
 if(!embedded){dialog.addEventListener('close',cleanup,{once:true});dialog.showModal();}
 else {observer=new MutationObserver(()=>{if(!root.isConnected)cleanup();});observer.observe(document.body,{childList:true,subtree:true});}
 async function load(){
 const run=++generation;scopeReader.invalidate();scopeBusy=false;scopeError=null;root.innerHTML=header()+'<p class="gd-loading" role="status">'+uiText('Actualizando las conexiones del proyecto…')+'</p>';
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
  if(job.status!=='ready')throw Object.assign(new Error(uiText('graph.syncFailed')),{code:job.error_code});
  data=await scopeReader.read();
  if(!current(run)||!data)return;
  scopeOptions=data.scopes;requestFilter='all';
  ({nodes:all,edges,cases}=presentProjectGraph(data));byId=new Map(all.map(n=>[n.entity_key,n]));
  selected=byId.has(selected)?selected:all.find(n=>n.kind==='Project').entity_key;
  render();
 }catch(error){if(current(run))root.innerHTML=header()+`<section class="gd-error" role="alert"><h2>${uiText("No se pudo abrir el mapa")}</h2><p>${esc(graphError(error))}</p><button class="gd-filter" data-live-refresh>${uiText("Volver a intentar")}</button></section>`;}
 }
 async function showScope(value){
  const mapRun=generation,option=value==='all'?{scope:'all'}:scopeOptions.find(o=>o.key===value);
  if(!option)return;
  const expectedGeneration=data.generation;
  requestFilter=value;scopeBusy=true;scopeError=null;selectedRelation=null;render();
  try{
   const scoped=await scopeReader.read(option,expectedGeneration);
   if(!scoped||!current(mapRun))return;
   data=scoped;scopeOptions=scoped.scopes;scopeBusy=false;
   ({nodes:all,edges,cases}=presentProjectGraph(scoped));byId=new Map(all.map(n=>[n.entity_key,n]));
   selected=byId.has(value)?value:all.find(n=>n.kind==='Project').entity_key;
   render();
  }catch(error){if(!current(mapRun))return;scopeBusy=false;scopeError=error;render();}
 }
 async function showScope(value){
  const mapRun=generation,option=value==='all'?{scope:'all'}:scopeOptions.find(o=>o.key===value);
  if(!option)return;
  const expectedGeneration=data.generation;
  requestFilter=value;scopeBusy=true;scopeError=null;selectedRelation=null;render();
  try{
   const scoped=await scopeReader.read(option,expectedGeneration);
   if(!scoped||!current(mapRun))return;
   data=scoped;scopeOptions=scoped.scopes;scopeBusy=false;
   ({nodes:all,edges,cases}=presentProjectGraph(scoped));byId=new Map(all.map(n=>[n.entity_key,n]));
   selected=byId.has(value)?value:all.find(n=>n.kind==='Project').entity_key;
   render();
  }catch(error){if(!current(mapRun))return;scopeBusy=false;scopeError=error;render();}
 }
 function render(){
 const requests=scopeOptions.map((o,index)=>({entity_key:o.key,label:o.scope==='plan'?uiText('graph.initialPlan'):o.scope==='refund'?uiText('graph.refundCase',{number:scopeOptions.slice(0,index+1).filter(x=>x.scope==='refund').length}):o.title||uiText('graph.unnamedRequest',{number:index+1})}));
 const toolbar=`<div class="gd-toolbar"><label>${uiText("Ver")} <select data-live-request aria-label="${uiText("graph.filterStory")}"><option value="all" ${requestFilter==='all'?'selected':''}>${uiText("Todo el proyecto")}</option>${requests.map(n=>`<option value="${esc(n.entity_key)}" ${n.entity_key===requestFilter?'selected':''}>${esc(n.label)}</option>`).join('')}</select></label>`;
 if(scopeBusy||scopeError){
  resizeObserver?.disconnect();viewport=null;scene=null;
  root.innerHTML=header()+toolbar+'</div>'+(scopeBusy?`<p class="gd-loading" role="status">${uiText('graph.loadingScope')}</p>`:`<section class="gd-error" role="alert"><h2>${uiText("No se pudo abrir el mapa")}</h2><p>${esc(scopeError.message)}</p><button class="gd-filter" data-live-scope-retry>${uiText("Volver a intentar")}</button></section>`);
  return;
 }
 const viewNodes=all,viewEdges=edges;
 if(!byId.has(selected))selected=all.find(n=>n.kind==='Project').entity_key;
 layout=layoutProjectGraph(viewNodes,viewEdges);
 const {positions,width,height,centerX,centerY}=layout;
 routes=routeProjectGraph(viewEdges,positions);
 root.innerHTML=header()+toolbar+`<span data-live-status role="status">${uiText("graph.count",{nodes:new Intl.NumberFormat(uiLocale()).format(viewNodes.length),edges:new Intl.NumberFormat(uiLocale()).format(viewEdges.length)})}</span><div class="gd-space-actions"><button class="gd-filter" data-live-details aria-expanded="${detailsOpen}">${uiText("Detalles")}</button><button class="gd-filter" data-live-expand aria-pressed="${expanded}">${expanded?uiText("Reducir mapa"):uiText("Ampliar mapa")}</button></div></div>${cases.length?`<div class="gd-case-legend" role="list" aria-label="${uiText('graph.caseLegend')}"><span class="gd-case-legend-heading">${uiText('graph.caseLegend')}</span>${cases.filter(item=>requestFilter==='all'||item.id===requestFilter).map(item=>`<span class="gd-case-legend-item" role="listitem" style="--gd-case-color:${item.color}" title="${esc(item.title)}"><i aria-hidden="true"></i>${esc(item.title)}</span>`).join('')}</div>`:''}${renderProjectGraphReading()}<div class="gd-body"><section class="gd-map" aria-label="${uiText("Relaciones del proyecto")}" tabindex="0"><div class="gd-scene" style="width:${width}px;height:${height}px"><svg class="gd-lines" viewBox="0 0 ${width} ${height}" aria-label="${uiText("Relaciones entre elementos")}"><defs><marker id="live-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto"><path d="M0 0 L8 4 L0 8" fill="#9b8bd3"/></marker>${cases.map(item=>`<marker id="live-arrow-case-${item.index}" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto"><path d="M0 0 L8 4 L0 8" fill="${item.color}"/></marker>`).join('')}</defs><g class="gd-orbits" aria-hidden="true">${layout.radii.map(r=>`<circle cx="${centerX}" cy="${centerY}" r="${r}"/>`).join('')}</g>${viewEdges.map(e=>{const line=routes.get(e.edge_key);return `<g class="gd-edge" ${e.case_id?`data-live-case="${esc(e.case_id)}" style="--gd-case-color:${e.case_color}"`:''} data-live-edge="${esc(e.edge_key)}" data-live-relation="${esc(e.edge_key)}" role="button" tabindex="0" aria-label="${esc(title(byId.get(e.source))+' '+(links[e.kind]||e.kind)+' '+title(byId.get(e.target)))}"><path class="gd-edge-hit" d="${line.path}"/><path class="gd-edge-line" marker-end="url(#${e.case_id?'live-arrow-case-'+e.case_index:'live-arrow'})" d="${line.path}"/><circle class="gd-port" cx="${line.start.x}" cy="${line.start.y}" r="3"/><rect class="gd-edge-label-bg" rx="5"/><text x="${line.x}" y="${line.y-7}">${esc(links[e.kind]||e.kind)}</text></g>`;}).join('')}</svg>${viewNodes.map(n=>{const p=positions.get(n.entity_key);return `<button class="gd-node ${n.kind==='Project'?'is-root':''}" style="${n.case_id?`--gd-case-color:${n.case_color};--gd-case-soft:${n.case_soft};`:''}left:${p.x}px;top:${p.y}px;height:${p.height}px;min-height:${p.height}px" ${n.case_id?`data-live-case="${esc(n.case_id)}"`:''} data-live-node="${esc(n.entity_key)}" data-live-depth="${p.depth}"><span class="gd-node-top"><span class="gd-node-icon">${icon(kinds[n.kind]?.[1]||'file-text')}</span><span class="gd-node-kind">${esc(kinds[n.kind]?.[0])}</span></span><strong>${esc(title(n))}</strong><span class="gd-node-description">${esc(projectGraphMilestone(n))}</span>${n.case_id&&n.entity_key!==n.case_id?`<span class="gd-node-case" title="${esc(n.case_title)}">${esc(n.case_title)}</span>`:''}</button>`;}).join('')}</div></section><div class="gd-map-controls" role="group" aria-label="${uiText("Navegar por el mapa")}"><button class="gd-filter" data-live-zoom="out">${uiText("Alejar")}</button><output data-live-scale aria-label="${uiText("Nivel de zoom")}">100%</output><button class="gd-filter" data-live-zoom="in">${uiText("Acercar")}</button><button class="gd-filter" data-live-fit>${uiText("Ajustar")}</button><button class="gd-filter" data-live-center>${uiText("Ir al proyecto")}</button></div><span class="gd-navigation-hint">${uiText("Arrastra para moverte · Rueda para ampliar")}</span><aside class="gd-inspector" aria-label="${uiText("Detalle del elemento seleccionado")}" aria-live="polite" ${detailsOpen?'':'hidden'}></aside></div>`;
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
  aside.innerHTML=close+`<span class="gd-eyebrow">${uiText("RELACIÓN")}</span><h2>${esc(links[edge.kind]||edge.kind)}</h2><div class="gd-relation-summary"><button class="gd-connection" data-live-select="${esc(source.entity_key)}">${icon(kinds[source.kind]?.[1]||'file-text')}<span>${esc(title(source))}<small>${uiText("Origen")}</small></span></button><p>${esc(links[edge.kind]||edge.kind)} ${icon('arrow-right')}</p><button class="gd-connection" data-live-select="${esc(target.entity_key)}">${icon(kinds[target.kind]?.[1]||'file-text')}<span>${esc(title(target))}<small>${uiText("Destino")}</small></span></button></div>${edge.evidence_relations?.some(e=>e.kind==='SUPPORTED_BY')?`<p class="gd-relation-evidence">${uiText('graph.requestSourceNote')}</p>`:''}`;
  placeRelationLabels();
  return;
 }
 const description=node.scope_summary||node.deliverables||node.summary||(node.business_kind==='email_request'?uiText("Conversación que respalda el pedido del cliente."):node.kind==='Acceptance'?uiText(node.method==='client_portal'?'graph.portalAcceptance':"Aceptación registrada mediante revisión manual del documento devuelto."):node.kind==='Dispute'?uiText('graph.disputeDetail'):node.kind==='ClientChangeRequest'?uiText('graph.clientChangeRequestDetail'):node.kind==='ProblemReport'?problemReportDetail(node):node.kind==='StageReview'?stageReviewDetail(node):node.kind==='Payment'?(node.status==='completed'?uiText("Pago confirmado por el backend."):uiText("Este pago aún no está confirmado.")):uiText("Registro del proyecto y sus conexiones documentadas."));
 aside.innerHTML=close+`<span class="gd-eyebrow">${esc(kinds[node.kind]?.[0])}</span><h2>${esc(title(node))}</h2><p class="gd-detail-copy">${esc(description)}</p>${node.kind==='PlanStage'?`<p class="gd-detail-copy"><strong>${uiText('graph.paymentCondition')}</strong><br>${esc(node.payment_condition)}</p>`:''}${node.kind==='Payment'&&['order','invoice'].includes(node.method)?`<p class="gd-detail-copy"><strong>${uiText('graph.paymentMethod')}</strong><br>${uiText(node.method==='invoice'?'graph.paymentMethodInvoice':'graph.paymentMethodOrder')}</p>`:''}${related.some(e=>e.evidence_relations?.some(source=>source.kind==='SUPPORTED_BY'))?`<p class="gd-relation-evidence">${uiText('graph.requestSourceNote')}</p>`:''}<div class="gd-connections"><h3>${uiText("Conectado con")}</h3><div class="gd-connection-legend" aria-label="${uiText("graph.directionLegend")}"><span>${icon('arrow-left')}${uiText("graph.incoming")}</span><span>${icon('arrow-right')}${uiText("graph.outgoing")}</span></div>${related.map(e=>{const other=byId.get(e.source===selected?e.target:e.source);return `<button class="gd-connection" data-live-select="${esc(other.entity_key)}">${icon(kinds[other.kind]?.[1]||'file-text')}<span>${esc(title(other))}<small>${e.source===selected?'→':'←'} ${esc(links[e.kind]||e.kind)}</small></span>${icon('chevron-right')}</button>`;}).join('')||("<p class=\"gd-detail-copy\">"+uiText("Sin conexiones registradas.")+"</p>")}</div>${node.kind==='Document'?`<button class="gd-document-action" data-live-document="${esc(node.source_id)}">${icon('file-text')}${uiText("Ver documento fuente")}</button>`:(node.documents||[]).map(doc=>`<button class="gd-document-action" data-live-document="${esc(doc.id)}">${icon('file-text')}${uiText(doc.role==='pdf'?'graph.openVersionPdf':'graph.openAcceptancePdf')}</button>`).join('')}`;
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
 root.addEventListener('change',event=>{if(event.target.matches('[data-live-request]')){void showScope(event.target.value);}});
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
 if(event.target.closest('[data-live-scope-retry]')){void showScope(requestFilter);return;}
 const choice=event.target.closest('[data-live-node],[data-live-select]');if(choice){const fromInspector=Boolean(choice.dataset.liveSelect);selected=choice.dataset.liveNode||choice.dataset.liveSelect;selectedRelation=null;detailsOpen=true;inspect();if(fromInspector)focusNode(selected);return;}
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
