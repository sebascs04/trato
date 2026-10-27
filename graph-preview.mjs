import {icon} from './icons.mjs';

const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const money=value=>new Intl.NumberFormat('es-PE',{style:'currency',currency:'USD'}).format(value);
const date=value=>new Intl.DateTimeFormat('es-PE',{day:'numeric',month:'short',year:'numeric',timeZone:'America/Lima'}).format(new Date(value));

function buildExample(data){
  const project=data.projects.find(item=>item.id==='SP-001');
  const client=data.clients.find(item=>item.id===project?.clientId);
  const request=data.requests.find(item=>item.id==='REQ-SP-001');
  const message=data.messages.find(item=>item.id===request?.sourceMessageId);
  const agreement=data.documentVersions.find(item=>item.id===request?.sourceVersionId);
  const source=data.documents.find(item=>item.id===request?.sourceDocumentId);
  const proposal=data.documents.find(item=>item.id==='DOC-SP-001-propuesta');
  const proposalVersion=data.documentVersions.find(item=>item.documentId===proposal?.id);
  const payment=data.invoices.find(item=>item.id==='INV-SP-001-BASE');
  if(![project,client,request,message,agreement,source,proposal,proposalVersion,payment].every(Boolean)) throw new Error('Faltan datos para abrir el ejemplo del mapa.');
  const nodes=[
    {id:'project',x:500,y:82,type:'Proyecto',icon:'layout-dashboard',title:project.name,subtitle:client.name,status:'En curso',description:'El espacio donde se reúnen las fuentes, los pedidos y los acuerdos de este trabajo.',meta:[['Cliente',client.name],['Servicio',project.service]]},
    {id:'agreement',x:165,y:282,type:'Acuerdo inicial',icon:'file-text',title:'Presupuesto y alcance',subtitle:'Video horizontal · 60 segundos',status:'Registrado',description:agreement.content,quote:'No incluye adaptaciones a otros formatos ni subtítulos.',meta:[['Versión','v'+agreement.version],['Registrado',date(agreement.acceptedAt)]],doc:agreement.documentId},
    {id:'request',x:500,y:282,type:'Pedido del cliente',icon:'mail',title:'Adaptaciones para redes',subtitle:'Tres versiones verticales y subtítulos',status:'Por revisar',description:'El cliente pide añadir formatos y subtítulos al video del proyecto.',quote:message.content,meta:[['Recibido',date(request.createdAt)],['Adicional propuesto',money(request.amount)]],doc:source.id},
    {id:'adenda',x:835,y:282,type:'Adenda',icon:'pencil',title:'Propuesta de cambio',subtitle:'Alcance y condiciones del adicional',status:'Borrador',description:'Un borrador para revisar la ampliación del trabajo antes de enviarlo al cliente.',quote:proposalVersion.content,meta:[['Versión','v'+proposalVersion.version],['Estado','Pendiente de revisión']],doc:proposal.id},
    {id:'payment',x:165,y:493,type:'Pago del acuerdo',icon:'credit-card',title:money(payment.amount),subtitle:'Corresponde al trabajo inicial',status:'Pagado',paid:true,description:'El pago registrado en este ejemplo pertenece al acuerdo inicial. El adicional del pedido todavía no tiene un pago asociado.',meta:[['Fecha',date(payment.paidAt)],['Moneda',payment.currency],['Corresponde a','Acuerdo inicial']]},
    {id:'source',x:500,y:493,type:'Documento fuente',icon:'paperclip',title:'Correo del cliente',subtitle:'Conversación que respalda el pedido',status:'PDF',description:'El documento aportado como respaldo del pedido nuevo. Se conserva separado de lo conversado al inicio.',meta:[['Documento',source.title],['Incorporado',date(source.addedAt)]],doc:source.id},
    {id:'pdf',x:835,y:493,type:'Documento de adenda',icon:'file-text',title:'Adenda v'+proposalVersion.version,subtitle:'Documento para revisar',status:'PDF',description:'El documento de la propuesta de este ejemplo. Abrirlo no lo envía ni registra una aceptación.',meta:[['Versión','v'+proposalVersion.version],['Incorporado',date(proposal.addedAt)]],doc:proposal.id}
  ];
  const edges=[
    {id:'project-agreement',from:'project',to:'agreement',label:'Incluye el acuerdo',path:'M390 82 H207 Q165 82 165 124 V230',lx:260,ly:66},
    {id:'project-request',from:'project',to:'request',label:'Recibe un pedido',path:'M500 128 V230',lx:556,ly:183},
    {id:'request-agreement',from:'request',to:'agreement',label:'Se compara con',path:'M390 282 H275',lx:332,ly:265},
    {id:'request-adenda',from:'request',to:'adenda',label:'Origina',path:'M610 282 H725',lx:668,ly:265},
    {id:'agreement-payment',from:'agreement',to:'payment',label:'Tiene un pago',path:'M165 334 V441',lx:213,ly:391},
    {id:'request-source',from:'request',to:'source',label:'Se respalda en',path:'M500 334 V441',lx:551,ly:391},
    {id:'adenda-pdf',from:'adenda',to:'pdf',label:'Tiene su documento',path:'M835 334 V441',lx:895,ly:391}
  ];
  return {project,client,nodes,edges};
}

function buildRefundExample(data){
  const project=data.projects.find(item=>item.id==='SP-003');
  const client=data.clients.find(item=>item.id===project?.clientId);
  const request=data.requests.find(item=>item.id==='REQ-SP-003');
  const refund=data.refunds.find(item=>item.requestId===request?.id);
  const payment=data.invoices.find(item=>item.id===refund?.invoiceId);
  const message=data.messages.find(item=>item.id===request?.sourceMessageId);
  const agreement=data.documentVersions.find(item=>item.id===request?.sourceVersionId);
  if(![project,client,request,refund,payment,message,agreement].every(Boolean)
    ||payment.projectId!==project.id||request.projectId!==project.id) throw new Error('Faltan datos del caso de devolución.');
  const nodes=[
    {id:'project',x:500,y:82,type:'Proyecto',icon:'layout-dashboard',title:project.name,subtitle:client.name,status:'En curso',description:'El proyecto conserva el acuerdo y su pago, junto con la solicitud de cancelación que debe revisarse.',meta:[['Cliente',client.name],['Servicio',project.service]]},
    {id:'agreement',x:165,y:282,type:'Acuerdo inicial',icon:'file-text',title:'Reserva y cancelación',subtitle:'Condiciones de la sesión',status:'Registrado',description:agreement.content,quote:'Cancelación con más de 48 horas de anticipación permite reembolso completo.',meta:[['Versión','v'+agreement.version],['Registrado',date(agreement.acceptedAt)]],doc:agreement.documentId},
    {id:'request',x:500,y:282,type:'Solicitud del cliente',icon:'mail',title:'Cancelar la sesión',subtitle:'El cliente solicita su reserva',status:'Por revisar',description:'La solicitud de cancelación inicia una revisión independiente del pago ya registrado.',quote:message.content,meta:[['Recibido',date(request.createdAt)],['Solicita devolver',money(refund.amount)]]},
    {id:'closure',x:835,y:282,type:'Propuesta de cierre',icon:'pencil',title:'Cierre por acordar',subtitle:'Condiciones y devolución',status:'Por preparar',planned:true,description:'Aquí se prepararía el acuerdo de cierre con el motivo, las condiciones y el importe propuesto. Requiere revisión y aprobación antes de solicitar un reembolso.',meta:[['Estado','Sin acuerdo de cierre'],['Siguiente paso','Revisar la solicitud']],foot:'El cierre es independiente de una adenda por trabajo adicional. Todavía no está aprobado.'},
    {id:'payment',x:165,y:493,type:'Pago original',icon:'credit-card',title:money(payment.amount),subtitle:'Reserva pagada por el cliente',status:'Pagado',paid:true,description:'Este es el cobro original de la reserva. Se conserva como pagado mientras la devolución sigue pendiente, sin borrar ni reemplazar el registro.',meta:[['Recibido',date(payment.paidAt)],['Importe cobrado',money(payment.amount)],['Devolución','Solicitada, no completada']],foot:'Cobro y devolución son operaciones distintas, enlazadas entre sí.'},
    {id:'source',x:500,y:493,type:'Mensaje fuente',icon:'mail',title:'Conversación del cliente',subtitle:'Mensaje que solicita cancelar',status:'Mensaje',description:'El mensaje aportado por el cliente explica qué solicita. Su contenido respalda la revisión, pero no ejecuta una devolución.',quote:message.content,meta:[['Recibido',date(message.createdAt)],['Cliente',client.name]]},
    {id:'refund',x:835,y:493,type:'Devolución',icon:'undo-2',title:money(refund.amount),subtitle:'Devolución solicitada',status:'Pendiente',pending:true,description:'La devolución está solicitada sobre el cobro original. Aún no se ha aprobado ni hay confirmación de dinero devuelto.',meta:[['Solicitado',date(refund.createdAt)],['Pago original',money(payment.amount)],['Estado','Pendiente de aprobación']],foot:'Sólo una confirmación del backend y PayPal permitiría mostrarla como devuelta.'}
  ];
  const edges=[
    {id:'project-agreement',from:'project',to:'agreement',label:'Incluye el acuerdo',path:'M390 82 H207 Q165 82 165 124 V230',lx:260,ly:66},
    {id:'project-request',from:'project',to:'request',label:'Recibe la solicitud',path:'M500 128 V230',lx:560,ly:183},
    {id:'request-agreement',from:'request',to:'agreement',label:'Consulta condiciones',path:'M390 282 H275',lx:332,ly:265},
    {id:'request-closure',from:'request',to:'closure',label:'Requiere un cierre',path:'M610 282 H725',lx:668,ly:265,planned:true},
    {id:'agreement-payment',from:'agreement',to:'payment',label:'Tiene un pago',path:'M165 334 V441',lx:213,ly:391},
    {id:'request-source',from:'request',to:'source',label:'Se respalda en',path:'M500 334 V441',lx:551,ly:391},
    {id:'closure-refund',from:'closure',to:'refund',label:'Define la devolución',path:'M835 334 V441',lx:904,ly:391,planned:true},
    {id:'refund-payment',from:'refund',to:'payment',label:'Sobre el pago original',path:'M835 545 V566 Q835 584 817 584 H183 Q165 584 165 566 V545',lx:500,ly:575}
  ];
  return {project,client,nodes,edges};
}

const changeFilters={
  all:{label:'Todo el proyecto',nodes:null},
  origin:{label:'Origen del pedido',nodes:['agreement','request','source'],selected:'request'},
  adenda:{label:'Adenda y respaldo',nodes:['agreement','request','source','adenda','pdf'],selected:'adenda'}
};
const refundFilters={all:{label:'Todo el proyecto',nodes:null},origin:{label:'Motivo y condiciones',nodes:['agreement','request','source'],selected:'request'},refund:{label:'Pago y devolución',nodes:['request','closure','refund','payment'],selected:'refund'}};

export async function mountGraphPreview(root,{onBack=()=>history.back(),scenario='change'}={}){
  root.classList.add('graph-design');
  root.innerHTML='<p class="gd-loading" role="status">Preparando el mapa…</p>';
  let data,sourceData;
  try{
    const response=await fetch('/data/demo.json',{cache:'no-store'});
    if(!response.ok) throw new Error('No se pudo cargar el ejemplo.');
    sourceData=await response.json();
    data=scenario==='refund'?buildRefundExample(sourceData):buildExample(sourceData);
  }catch{
    root.innerHTML=`<section class="gd-error"><h1>No se pudo abrir el mapa</h1><p>Vuelve al proyecto e inténtalo de nuevo.</p><button class="gd-back" data-gd-back>${icon('arrow-left')}Volver a Trato</button></section>`;
    root.querySelector('[data-gd-back]').addEventListener('click',onBack);
    return;
  }
  let selected=scenario==='refund'?'refund':'request',filter='all';
  let {nodes,edges,project,client}=data;
  let byId=new Map(nodes.map(node=>[node.id,node]));
  let filters=scenario==='refund'?refundFilters:changeFilters;
  const renderCanvas=()=>{
  root.dataset.gdScenario=scenario;
  root.innerHTML=`<header class="gd-top"><div class="gd-top-line"><button type="button" class="gd-back" data-gd-back>${icon('arrow-left')}<span>Volver al proyecto</span></button><span class="gd-preview-label">Vista previa · ejemplo</span><div class="gd-scenarios" role="group" aria-label="Proyecto de ejemplo"><button type="button" data-gd-scenario="change" aria-pressed="${scenario==='change'}">Con un cambio</button><button type="button" data-gd-scenario="refund" aria-pressed="${scenario==='refund'}">Con una devolución</button></div><span class="gd-brand">trato<span>.</span></span></div><div class="gd-heading"><div><span class="gd-eyebrow">CADA ACUERDO TIENE UN ORIGEN</span><h1>Mapa del proyecto</h1><p class="gd-intro">Sigue el hilo entre lo conversado, lo que cambió y lo acordado.</p></div><div class="gd-project-chip"><span class="gd-avatar">${escape(client.initials)}</span><div><strong>${escape(project.name)}</strong><small>${escape(client.name)}</small></div></div></div><div class="gd-toolbar"><div class="gd-filters" role="group" aria-label="Recorridos del mapa">${Object.entries(filters).map(([id,value])=>`<button type="button" class="gd-filter" data-gd-filter="${id}" aria-pressed="${id===filter}">${value.label}</button>`).join('')}</div><span class="gd-hint">${icon('eye')}Selecciona un elemento para ver sus conexiones</span></div></header><div class="gd-body"><section class="gd-map" aria-label="Relaciones del proyecto"><div class="gd-scene"><svg class="gd-lines" viewBox="0 0 1000 620" preserveAspectRatio="none" aria-hidden="true"><defs><marker id="gd-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0 L8 4 L0 8" fill="#cbd0de" stroke="none"/></marker></defs>${edges.map(edge=>`<g class="gd-edge ${edge.planned?'is-planned':''}" data-gd-edge="${edge.id}"><path d="${edge.path}" marker-end="url(#gd-arrow)"/><text x="${edge.lx}" y="${edge.ly}">${edge.label}</text></g>`).join('')}</svg>${nodes.map(node=>`<button type="button" class="gd-node ${node.id==='project'?'is-root':''} ${node.planned?'is-planned':''}" data-gd-node="${node.id}" style="left:${node.x/10}%;top:${node.y/6.2}%" aria-pressed="${node.id===selected}" aria-label="${escape(node.type)}: ${escape(node.title)}"><span class="gd-node-top"><span class="gd-node-icon">${icon(node.icon)}</span><span class="gd-node-kind">${escape(({project:'Proyecto',agreement:'Acuerdo',request:'Pedido',adenda:'Adenda',payment:'Pago inicial',source:'Fuente',pdf:'PDF de adenda',closure:'Cierre',refund:'Devolución'})[node.id])}</span><span class="gd-node-status ${node.paid?'is-paid':node.pending?'is-pending':''}">${escape(node.status)}</span></span><strong>${escape(node.title)}</strong><span class="gd-node-description">${escape(node.subtitle)}</span></button>`).join('')}</div><div class="gd-map-footer"><span class="gd-legend">Conexiones del proyecto</span><span>${nodes.length} elementos · ${edges.length} relaciones</span>${scenario==='refund'?'<span class="gd-legend is-planned">Por acordar</span>':''}</div></section><aside class="gd-inspector" aria-label="Detalle del elemento seleccionado" aria-live="polite" aria-atomic="true"></aside></div>`;
  };

  const renderSelection=()=>{
    const node=byId.get(selected);
    const related=edges.filter(edge=>edge.from===selected||edge.to===selected);
    const activeNodes=new Set(filter==='all'?nodes.map(n=>n.id):filters[filter].nodes);
    for(const button of root.querySelectorAll('[data-gd-node]')){
      button.setAttribute('aria-pressed',String(button.dataset.gdNode===selected));
      button.classList.toggle('is-dim',!activeNodes.has(button.dataset.gdNode));
    }
    for(const element of root.querySelectorAll('[data-gd-edge]')){
      const edge=edges.find(item=>item.id===element.dataset.gdEdge);
      element.classList.toggle('is-active',edge.from===selected||edge.to===selected);
      element.classList.toggle('is-dim',!activeNodes.has(edge.from)||!activeNodes.has(edge.to));
    }
    for(const button of root.querySelectorAll('[data-gd-filter]'))button.setAttribute('aria-pressed',String(button.dataset.gdFilter===filter));
    root.querySelector('.gd-inspector').innerHTML=`<div class="gd-inspector-top"><span class="gd-detail-icon">${icon(node.icon)}</span><span class="gd-chip ${node.paid?'is-paid':node.pending?'is-pending':''}">${escape(node.status)}</span></div><span class="gd-eyebrow">${escape(node.type)}</span><h2>${escape(node.title)}</h2><p class="gd-detail-copy">${escape(node.description)}</p>${node.quote?`<blockquote class="gd-quote">“${escape(node.quote)}”</blockquote>`:''}<div class="gd-meta">${node.meta.map(([key,value])=>`<div><span>${escape(key)}</span><strong>${escape(value)}</strong></div>`).join('')}</div><div class="gd-connections"><h3>Conectado con</h3>${related.map(edge=>{
      const other=byId.get(edge.from===selected?edge.to:edge.from);
      return `<button type="button" class="gd-connection" data-gd-select="${other.id}">${icon(other.icon)}<span>${escape(other.title)}<small>${escape(edge.label)}</small></span>${icon('chevron-right')}</button>`;
    }).join('')}</div>${node.doc?`<button type="button" class="gd-document-action" data-gd-document="${escape(node.doc)}">${icon('file-text')}Ver documento fuente${icon('arrow-up-right')}</button>`:''}<p class="gd-detail-foot">${node.foot?escape(node.foot):node.id==='payment'?'Este cobro corresponde al acuerdo inicial, no al pedido adicional.':node.id==='adenda'||node.id==='pdf'?'El borrador conserva su propio documento; todavía no registra aceptación.':'Las conexiones te permiten consultar de dónde viene cada elemento.'}</p>`;
  };
  root.addEventListener('click',event=>{
    const back=event.target.closest('[data-gd-back]');
    if(back){onBack();return;}
    const example=event.target.closest('button[data-gd-scenario]');
    if(example){
      const next=example.dataset.gdScenario;
      if(next===scenario)return;
      try{
        const nextData=next==='refund'?buildRefundExample(sourceData):buildExample(sourceData);
        scenario=next;({nodes,edges,project,client}=nextData);
        byId=new Map(nodes.map(node=>[node.id,node]));
        filters=scenario==='refund'?refundFilters:changeFilters;
        selected=scenario==='refund'?'refund':'request';filter='all';
        renderCanvas();renderSelection();
        root.querySelector(`[data-gd-scenario="${scenario}"]`).focus();
      }catch{
        root.querySelector('.gd-inspector').innerHTML='<h2>No se pudo abrir ese ejemplo</h2><p>Faltan datos para representar este proyecto.</p>';
      }
      return;
    }
    const choice=event.target.closest('[data-gd-node],[data-gd-select]');
    if(choice){
      selected=choice.dataset.gdNode||choice.dataset.gdSelect;
      if(filter!=='all'&&!filters[filter].nodes.includes(selected))filter='all';
      renderSelection();return;
    }
    const selectedFilter=event.target.closest('[data-gd-filter]');
    if(selectedFilter){filter=selectedFilter.dataset.gdFilter;selected=filters[filter].selected||'request';renderSelection();return;}
    const documentButton=event.target.closest('[data-gd-document]');
    if(documentButton){
      const id=documentButton.dataset.gdDocument;
      const doc=byId.get(selected);
      if(!nodes.some(n=>n.doc===id))return;
      const dialog=document.createElement('dialog');dialog.className='gd-pdf-dialog';dialog.setAttribute('aria-label',doc.title);
      dialog.innerHTML=`<div class="gd-pdf-head"><strong>${escape(doc.title)}</strong><button type="button" aria-label="Cerrar documento" title="Cerrar documento">${icon('x')}</button></div><iframe title="Documento fuente del ejemplo" src="/data/pdfs/${encodeURIComponent(id)}.pdf"></iframe>`;
      document.body.append(dialog);
      dialog.querySelector('button').addEventListener('click',()=>dialog.close());
      dialog.addEventListener('close',()=>{dialog.remove();documentButton.focus();},{once:true});
      dialog.showModal();
    }
  });
  renderCanvas();
  renderSelection();
}

let stylesheet;
export async function openGraphPreview({returnFocus}={}){
  if(document.querySelector('.gd-dialog'))return;
  if(!stylesheet){
    stylesheet=new Promise((resolve,reject)=>{
      const link=document.createElement('link');link.rel='stylesheet';link.href='/graph-preview.css';
      link.onload=resolve;link.onerror=()=>{stylesheet=null;link.remove();reject(new Error('No se pudo abrir el mapa.'));};
      document.head.append(link);
    });
  }
  await stylesheet;
  const dialog=document.createElement('dialog');dialog.className='gd-dialog';dialog.setAttribute('aria-label','Vista previa del mapa del proyecto');
  const root=document.createElement('div');dialog.append(root);document.body.append(dialog);
  dialog.addEventListener('close',()=>{dialog.remove();if(returnFocus?.isConnected)returnFocus.focus();},{once:true});
  dialog.showModal();
  await mountGraphPreview(root,{onBack:()=>dialog.close()});
}
