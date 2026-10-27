// Todos los registros y resultados son ficticios y predefinidos.
// No se realizan peticiones a proveedores de IA, PayPal ni servicios externos.
const demoData = window.TRATO_DATA;
if (!demoData || demoData.meta.schemaVersion !== 1) throw new Error('Datos de Trato ausentes o incompatibles.');
// Proyecciones de presentación: la fuente normalizada se conserva en data/demo.json.
const projects = demoData.projects.map(project => {
  const client = demoData.clients.find(item => item.id === project.clientId);
  const request = demoData.requests.find(item => item.projectId === project.id);
  const invoice = demoData.invoices.find(item => item.requestId === request.id);
  const overdue = invoice && invoice.status === 'pending' && new Date(invoice.dueAt) < new Date(demoData.meta.asOf);
  return { ...project, client: `${client.name} · ${project.service}`, initials: client.initials, type: request.type, amount: request.amount, status: request.type === 'cambios' ? 'Por acordar' : request.type === 'reembolsos' ? 'En revisión' : overdue ? `${Math.round((Date.parse(demoData.meta.asOf.slice(0,10)) - Date.parse(invoice.dueAt.slice(0,10))) / 86400000)} días de atraso` : 'Dentro del plazo' };
});
const labels = { inicio: 'Vista general', cambios: 'Cambios y extras', cobros: 'Cobros pendientes', reembolsos: 'Reembolsos', clientes: 'Clientes', conversaciones: 'Asistente', kb: 'Documentos y términos' };
// Vista de diseño del primer bloque; los demás recorridos se conservan para después.
const previewViews = new Set(['inicio', 'clientes', 'conversaciones', 'kb', 'cambios']);
const typeLabels = { cambios: 'Cambio de alcance', cobros: 'Seguimiento de pago', reembolsos: 'Solicitud de reembolso' };
const descriptions = {
  clientes: 'Cada relación tiene su propio contexto. Mantén sus proyectos, acuerdos y conversaciones en un mismo lugar.',
  conversaciones: 'Pregunta sobre el acuerdo o revisa lo que te escribió tu cliente. Tú decides el siguiente paso.',
  kb: 'El contexto de cada proyecto. Consulta el alcance, las condiciones y las versiones antes de actuar.',
  cambios: 'Cada extra merece una conversación clara. Revisa lo acordado y prepara una propuesta antes de empezar.',
  cobros: 'Dale seguimiento al trabajo que ya hiciste. Revisa cada cobro y prepara una conversación con contexto.',
  reembolsos: 'Resuelve las cancelaciones con claridad. Revisa las condiciones del servicio antes de tomar una decisión.',
};
const cases = Object.fromEntries(demoData.requests.map(request => {
  const version = demoData.documentVersions.find(item => item.id === request.sourceVersionId);
  const message = demoData.messages.find(item => item.id === request.sourceMessageId);
  const scenario = demoData.demoScenarios.find(item => item.requestId === request.id);
  const result = { context: version.content, message: message.content, finding: scenario.finding, evidence: scenario.evidence };
  if (scenario.items) result.items = scenario.items.map(item => [item.description, item.unitAmount * item.quantity]);
  if (scenario.draft) result.draft = scenario.draft;
  return [request.projectId, result];
}));
const money = value => new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'USD', currencyDisplay: 'code', maximumFractionDigits: 2 }).format(value).replace('USD', 'US$');
const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
let currentView = 'inicio';
let activeProject;
let stage = 1;
let proposedTotal = 0;
const outcomes = new Map();
const dialog = document.querySelector('#flow-dialog');
const content = document.querySelector('#dialog-content');

function renderRows() {
  if (window.TratoCloud?.handlesView) {window.TratoCloud.renderRows(currentView); return;}
  const rows = projects.filter(project => currentView === 'inicio' || project.type === currentView);
  document.querySelector('#project-rows').innerHTML = rows.map(project => {
    const outcome = outcomes.get(project.id);
    const style = outcome ? 'done' : project.type === 'cambios' || project.type === 'reembolsos' ? 'review' : project.id === 'SP-002' ? 'overdue' : 'pending';
    return `<tr><td><div class="project-cell"><span class="project-mark">${project.initials}</span><div><strong>${project.name}</strong><small>${project.client}</small></div></div></td><td class="type-label">${typeLabels[project.type]}</td><td class="amount">${money(project.amount)}</td><td><span class="badge ${style}">${outcome ? outcome : project.status}</span></td><td><button class="row-button" data-project="${project.id}" aria-label="Revisar ${project.name}">↗</button></td></tr>`;
  }).join('');
  const localRequests = currentView === 'cambios' ? localChangeRequests : [];
  document.querySelector('#project-rows').innerHTML += localRequests.map(request => {
    const project=projects.find(item=>item.id===request.projectId);
    return `<tr><td><div class="project-cell"><span class="project-mark">${project.initials}</span><div><strong>${escapeHTML(request.subject)}</strong><small>${escapeHTML(project.client)}</small></div></div></td><td class="type-label">Solicitud por correo</td><td class="amount">Por definir</td><td><span class="badge review">${requestStatusLabel(request.status)}</span></td><td><button class="row-button" type="button" data-local-request="${request.id}" data-request-project="${request.projectId}" aria-label="Revisar solicitud">↗</button></td></tr>`;
  }).join('');
  document.querySelector('#empty').hidden = rows.length + localRequests.length > 0;
}

function renderView() {
  const hash = location.hash.slice(1);
  currentView = previewViews.has(hash) ? hash : 'inicio';
  if (hash === 'kb') { selectedClientTab = 'documentos'; currentView = 'clientes'; location.hash = 'clientes'; }
  if (hash && !previewViews.has(hash)) location.hash = 'inicio';
  document.querySelectorAll('[data-view]').forEach(link => {
    const selected = link.dataset.view === currentView || (currentView === 'conversaciones' && link.dataset.view === 'clientes');
    link.classList.toggle('active', selected);
    if (selected) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  });
  document.querySelector('#crumb').textContent = labels[currentView];
  const workspaceView = ['clientes', 'conversaciones', 'kb'].includes(currentView);
  document.querySelector('#client-workspace').hidden = !workspaceView;
  document.querySelector('#assistant-entry').hidden = currentView !== 'inicio';
  document.querySelector('.stats').hidden = workspaceView;
  document.querySelector('.activity').hidden = workspaceView;
  if (workspaceView) renderWorkspace();
  document.querySelector('#hero').hidden = currentView !== 'inicio';
  document.querySelector('#flow-section').hidden = currentView !== 'inicio';
  if (currentView === 'inicio') {
    document.querySelector('#page-title').innerHTML = 'Tu trabajo merece<br>estar <em>bien acordado.</em>';
    document.querySelector('#page-description').innerHTML = 'Tus clientes, proyectos y acuerdos en un mismo lugar.<br>Empieza por dejar claro qué van a hacer juntos.';
  } else {
    document.querySelector('#page-title').textContent = labels[currentView];
    document.querySelector('#page-description').textContent = descriptions[currentView];
  }
  document.querySelector('#table-title').textContent = currentView === 'inicio' ? 'Tu trabajo, en perspectiva.' : 'Solicitudes de ejemplo';
  renderRows();
  renderOverview();
  window.TratoCloud?.syncChrome();
}

function renderOverview() {
  if (window.TratoCloud?.handlesView) return;
  const totals = { cambios: 0, cobros: 0, reembolsos: 0 };
  const counts = { cambios: 0, cobros: 0, reembolsos: 0 };
  for (const request of demoData.requests) { totals[request.type] += request.amount; counts[request.type] += 1; }
  const stats = document.querySelectorAll('.stats article');
  ['cambios','cobros','reembolsos'].forEach((type,index) => { if (stats[index]) { stats[index].querySelector('strong').textContent = money(totals[type]); stats[index].querySelector('small').textContent = `${counts[type]} solicitudes de ejemplo`; } });
  document.querySelectorAll('[data-view] .count').forEach(count => { count.textContent = counts[count.closest('[data-view]').dataset.view]; });
}

let changeDraft = null;
const localChangeRequests = [];
const savedChangeDrafts = new Map();
let activeLocalRequest = null;
function updateChangeProgress() {
  for (let index=1;index<=6;index++) {
    const item=document.querySelector(`#step-${['one','two','three','four','five','six'][index-1]}`);
    item.classList.toggle('current',index===stage);
    if(index===stage)item.setAttribute('aria-current','step');else item.removeAttribute('aria-current');
  }
}
function requestStatusLabel(status) {
  return {pending_analysis:'Registrada · pendiente de análisis',analysis_simulated:'Análisis simulado disponible',analysis_reviewed:'Propuesta en revisión',draft_ready:'Adenda preparada',pending_signature_simulated:'Pendiente de firma · envío simulado',signature_review_pending:'Documento recibido · firma por verificar',signature_review_simulated:'Revisión conforme · simulación',formalized_simulated:'Cambio formalizado · simulación',formalized:'Cambio formalizado'}[status] || 'Pendiente de análisis';
}
function updateRequestStatus(status) {
  if(!activeLocalRequest)return;
  const rank={pending_analysis:0,analysis_simulated:1,analysis_reviewed:2,draft_ready:3,pending_signature_simulated:4,signature_review_pending:5,signature_review_simulated:6,formalized_simulated:7,formalized:8};
  if((rank[status]??0)<(rank[activeLocalRequest.status]??0))return;
  activeLocalRequest.status=status;
  const event=actionHistories.get(activeLocalRequest.projectId).find(item=>item.localRequestId===activeLocalRequest.id && item.id.startsWith('EVENT-'));
  if(event)event.requestStatus=status;
  if(['clientes','conversaciones','kb'].includes(currentView))renderWorkspace();
  renderRows();
  persistChangeWorkspace();
}
function openNewChange() {
  activeProject=selectedProject(); activeLocalRequest=null; stage=1; changeDraft=null;
  document.querySelector('#dialog-eyebrow').textContent='NUEVA SOLICITUD DE CAMBIO';
  document.querySelector('#dialog-title').textContent=activeProject.name;
  document.querySelector('#dialog-subtitle').textContent=`${selectedClient().name} · Un solo recorrido, del correo a la adenda · sin retroceso`;
  updateChangeProgress(); content.innerHTML=renderNewChangeModal();
  if(!dialog.open)dialog.showModal();
}
function flowExample() {
  if(!activeLocalRequest)return cases[activeProject.id];
  return {context:selectedSource().text,message:activeLocalRequest.message,
    finding:'La simulación muestra cómo se contrastaría este pedido con el acuerdo de referencia. Todavía no se ha determinado con IA si está incluido, es un extra o necesita aclaración.',
    evidence:'La fuente del pedido es el PDF aportado y el texto que confirmaste. La referencia es el acuerdo vigente de este proyecto.',items:[]};
}
function openFlow(id, requestId=null) {
  activeLocalRequest=requestId?localChangeRequests.find(item=>item.id===requestId&&item.projectId===id):null;
  activeProject=projects.find(project=>project.id===id);
  if(!activeProject||(activeProject.type!=='cambios'&&!activeLocalRequest)){location.hash='clientes';return;}
  selectedProjectId=id; stage=2;
  const estimate=activeLocalRequest?180:activeProject.amount;
  changeDraft={option:'extra',amount:estimate,days:3,scope:activeLocalRequest?activeLocalRequest.message.slice(0,2000):(cases[id].items||[]).map(([label])=>label).join('; '),note:'',prepared:false};
  const saved=savedChangeDrafts.get(requestId || id);
  if(saved){changeDraft={...saved};stage=changeDraft.resumeStage || (changeDraft.sent?6:changeDraft.prepared?5:2);}
  proposedTotal=changeDraft.amount;
  document.querySelector('#dialog-eyebrow').textContent='CAMBIO DE ALCANCE · DEMO';
  document.querySelector('#dialog-title').textContent=activeProject.name;
  document.querySelector('#dialog-subtitle').textContent=`${activeProject.client} · ${activeProject.id}`;
  renderStage();if(!dialog.open)dialog.showModal();
}
function renderStage() {
  const example=flowExample(), source=selectedSource(), client=selectedClient();
  const sourceId=activeLocalRequest?.documentId || `DOC-${activeProject.id}-solicitud`;
  const estimate=activeLocalRequest?180:activeProject.amount;
  const scope=activeLocalRequest?activeLocalRequest.message.slice(0,2000):(example.items||[]).map(([label])=>label).join('; ');
  updateChangeProgress();
  const back='';
  if(stage<=2) {
    content.innerHTML=`<div class="change-stage-heading"><span class="eyebrow">02 · LO LEÍDO Y EL ACUERDO</span><h3>Este es el pedido que vamos a revisar.</h3><p>${activeLocalRequest && !knowledgeDocuments.find(doc=>doc.id===activeLocalRequest.documentId)?.isFixture?'Texto extraído del PDF y confirmado por ti. El remitente y la firma no están verificados.':'Correo ficticio y acuerdo de ejemplo para recorrer la experiencia.'}</p></div><article class="change-email"><div class="change-email-top"><span class="mail-mark">✉</span><div><strong>${escapeHTML(activeLocalRequest?.subject || 'Solicitud de cambios en la entrega')}</strong><small>De: ${escapeHTML(activeLocalRequest?(activeLocalRequest.sender || 'No reconocido'):client.contact+' <cliente@example.com>')}</small><small>Fecha: ${escapeHTML(activeLocalRequest?(activeLocalRequest.emailDate || 'No reconocida'):'14 oct 2026 · ejemplo')}</small></div><span class="badge pending">Por revisar</span></div><p>${escapeHTML(example.message)}</p><button class="source-citation" type="button" data-preview-pdf="${sourceId}">Abrir PDF del correo ↗</button></article><div class="change-comparison"><article><span class="eyebrow">ACUERDO VIGENTE · V${source.version}</span><p>${escapeHTML(source.text)}</p><button type="button" class="source-citation" data-preview-pdf="${source.id}">Ver acuerdo en PDF ↗</button></article><article><span class="eyebrow">QUÉ REVISARÁ EL AGENTE</span><p>La relación del correo con este proyecto, los entregables incluidos, las revisiones disponibles y lo que cambiaría en esfuerzo, precio y fecha.</p><p>Esta demo aún no verifica esa relación con IA.</p></article></div><div class="dialog-actions"><button class="button" data-action="next">Ver análisis y estimaciones →</button></div>`;
  } else if(stage===3) {
    content.innerHTML=`<div class="change-stage-heading"><span class="eyebrow">03 · ANÁLISIS DEL AGENTE</span><h3>Qué cambiaría y qué implicaría para tu trabajo.</h3><p>LangGraph ejecuta este recorrido dentro del formulario. La lectura del PDF es real; la pertinencia se asume solo para esta simulación y las conclusiones y cifras son ilustrativas, no generadas por IA.</p></div><article class="change-finding"><div class="agent-analysis-heading"><strong>✳ Comparación con el acuerdo inicial</strong><span class="badge pending">Ejemplo · sin IA</span></div><div class="agent-analysis-part"><span class="eyebrow">PEDIDO REVISADO</span><p>${escapeHTML(example.message)}</p></div><div class="agent-analysis-part"><span class="eyebrow">LECTURA PROPUESTA</span><p>${escapeHTML(example.finding)}</p><blockquote>${escapeHTML(example.evidence)}</blockquote></div><div class="agent-analysis-part"><span class="eyebrow">FUENTES</span><button class="source-citation" type="button" data-preview-pdf="${source.id}">Acuerdo v${source.version} ↗</button><button class="source-citation" type="button" data-preview-pdf="${sourceId}">Correo del pedido ↗</button></div></article><div class="analysis-estimates"><article><span>Esfuerzo ilustrativo</span><strong>6 horas</strong><small>Supuesto de demo, pendiente de tu estimación</small></article><article><span>Plazo ilustrativo</span><strong>+3 días</strong><small>No consulta tu agenda ni la fecha pactada</small></article><article><span>Adicional ilustrativo</span><strong>${money(estimate)}</strong><small>Ejemplo editable, no precio inferido del PDF</small></article></div><div class="change-guard"><strong>Revisa los supuestos antes de negociar.</strong><p>Estas cifras sirven para probar el recorrido; no representan una recomendación real sobre tu documento. Con el agente conectado se pedirán tus tarifas, esfuerzo y disponibilidad si faltan.</p></div><div class="dialog-actions">${back}<button class="button" data-action="next">Ver alternativas para este pedido →</button></div>`;
  } else if(stage===4) {
    const options=[['extra','Incluir el pedido completo',`Agregar lo solicitado en el correo. Ejemplo: ${money(estimate)} adicionales y 3 días más.`],['swap','Intercambiar trabajo pendiente','Mantener el presupuesto y reemplazar un entregable que aún no empezaste. Especifica qué sale y qué entra.'],['phase','Dejar el pedido para otra fase',`Completar la entrega actual y tratar el pedido como una fase adicional. Ejemplo: ${money(estimate)} y plazo posterior por acordar.`]];
    content.innerHTML=`<div class="change-stage-heading"><span class="eyebrow">04 · ALTERNATIVAS</span><h3>Elige cómo proponer el cambio.</h3><p>Estas tarjetas ilustran cómo se presentarían opciones basadas en el análisis. En esta demo usan plantillas y cifras de ejemplo, no opciones generadas por un agente.</p></div><div class="change-request-reminder"><strong>Pedido de referencia</strong><p>${escapeHTML(example.message)}</p></div><div class="change-options">${options.map(([id,title,description])=>`<button type="button" data-change-option="${id}" class="change-option ${changeDraft.option===id?'chosen':''}" aria-pressed="${changeDraft.option===id}"><strong>${title}</strong><p>${description}</p></button>`).join('')}</div><form id="change-terms-form"><label class="field" for="change-scope">${changeDraft.option==='swap'?'Qué entregable pendiente se retira y qué se agrega':'Alcance que quieres proponer'}</label><textarea id="change-scope" rows="4" required maxlength="2000">${escapeHTML(changeDraft.scope || scope)}</textarea><div class="change-form-grid"><div><label class="field" for="change-amount">Adicional propuesto · USD</label><input class="context-box" id="change-amount" type="number" min="0" max="100000" step="0.01" required value="${changeDraft.amount}" ${changeDraft.option==='swap'?'readonly':''}></div><div><label class="field" for="change-days">Días adicionales propuestos</label><input class="context-box" id="change-days" type="number" min="0" max="365" step="1" required value="${changeDraft.days}"></div></div><label class="field" for="change-note">Condiciones que deben quedar en la adenda</label><textarea id="change-note" rows="3" maxlength="2000">${escapeHTML(changeDraft.note)}</textarea><div class="dialog-actions">${back}<button class="button" type="submit">Generar borrador de adenda →</button></div></form>`;
  } else if(stage===5) {
    const title={extra:'Ampliación del alcance',swap:'Intercambio de entregables',phase:'Trabajo en una fase adicional'}[changeDraft.option];
    content.innerHTML=`<div class="change-stage-heading"><span class="eyebrow">05 · ADENDA</span><h3>${changeDraft.prepared?'Adenda preparada. Puedes retomarla desde Solicitudes.':'Así quedaría el nuevo acuerdo.'}</h3><p>La propuesta se construye con las condiciones que revisaste. Todavía debe negociarse y firmarse; el acuerdo original sigue vigente.</p></div><article class="change-addendum"><span class="badge pending">Borrador · sin firma</span><h4>${title}</h4><dl><dt>Proyecto</dt><dd>${escapeHTML(activeProject.name)} · ${escapeHTML(client.name)}</dd><dt>Referencia</dt><dd><button class="text-button" type="button" data-preview-pdf="${source.id}">Acuerdo v${source.version} ↗</button></dd><dt>Motivo</dt><dd>${escapeHTML(example.message)}<br><button class="text-button" type="button" data-preview-pdf="${sourceId}">Correo fuente ↗</button></dd><dt>Alcance</dt><dd>${escapeHTML(changeDraft.scope)}</dd><dt>Adicional</dt><dd>${money(changeDraft.amount)}${changeDraft.amount===0?' · sin cobro adicional':''}</dd><dt>Plazo</dt><dd>${changeDraft.days} días adicionales propuestos</dd><dt>Condiciones</dt><dd>${escapeHTML(changeDraft.note || 'Las condiciones no modificadas del acuerdo original se mantienen. Firma e inicio del trabajo pendientes de acordar.')}</dd></dl><div class="change-signatures"><div><span>Freelancer</span><strong>Sin firma</strong></div><div><span>Cliente autorizado</span><strong>Sin firma</strong></div></div></article><div class="change-guard"><strong>No se ha aceptado el cambio ni enviado correos.</strong><p>No se modificó el contrato, no hay firma real y no se creó ningún cobro. La adenda se guarda localmente en este navegador. Supabase aún no está conectado.</p></div><div class="dialog-actions">${back}<button class="button" data-action="${changeDraft.prepared?'signature':'prepare'}">${changeDraft.prepared?'Continuar con la firma →':'Guardar adenda preparada'}</button></div>`;
  } else if(stage===6) {
    content.innerHTML=renderSignatureStage();
  }
  rememberFlowProgress();
}
function changePaymentKey() {return activeLocalRequest?.id || `${activeProject.id}-${changeDraft.returnedDocumentId}`;}
function changePaymentStatus(draft=changeDraft) {
  return window.TratoPayments?.getStatus(changePaymentKey()) || draft.paymentPreviewStatus || 'draft';
}
function changePaymentLabel(draft=changeDraft) {
  return {draft:'Preparar cobro',pending_approval:'Ver cobro pendiente',pending:'Ver estado del pago',completed:'Ver pago'}[changePaymentStatus(draft)] || 'Ver cobro';
}
function renderSignatureStage() {
  const d=changeDraft;
  if(d.formalizedSimulated) return `<div class="change-stage-heading"><span class="eyebrow">06 · RECORRIDO COMPLETADO</span><h3>Cambio formalizado en la demo.</h3><p>Esta es la pantalla final del flujo. Las firmas, la verificación y la activación del acuerdo se simularon; no tienen efecto legal ni actualizan un contrato real.</p></div><article class="change-addendum"><span class="badge done">Completado · simulación</span><h4>Acuerdo v${escapeHTML(d.simulatedVersion)} · versión simulada</h4><dl><dt>Nuevo alcance</dt><dd>${escapeHTML(d.scope)}</dd><dt>Adicional acordado</dt><dd>${money(d.amount)}</dd><dt>Plazo adicional</dt><dd>${d.days} días</dd><dt>Condiciones</dt><dd>${escapeHTML(d.note || 'Se mantienen las condiciones no modificadas.')}</dd><dt>Documento fuente</dt><dd><button type="button" class="text-button" data-preview-pdf="${d.returnedDocumentId}">PDF devuelto por el cliente ↗</button></dd><dt>Firmas</dt><dd>Ambas partes · resultado simulado</dd><dt>Pago</dt><dd>${d.amount>0?({draft:'Pendiente de gestionar',pending_approval:'Pendiente de pago',pending:'Confirmando el pago',completed:'Pagado'}[changePaymentStatus(d)] || 'Pendiente de gestionar'):'Sin cobro adicional'}</dd></dl></article><div class="change-guard"><strong>El acuerdo real no se ha actualizado.</strong><p>La integración futura deberá verificar las firmas antes de activar una versión. El pago siempre tendrá un estado independiente.</p></div><div class="dialog-actions">${d.amount>0?`<button class="button secondary" type="button" data-action="payment-demo">${changePaymentLabel(d)} →</button>`:''}<button class="button" data-action="finish-flow">Ver mis solicitudes →</button></div>`;
  let body=`<div class="change-stage-heading"><span class="eyebrow">06 · FIRMA Y FORMALIZACIÓN</span><h3>${d.verificationSimulated?'Revisión conforme en el ejemplo.':d.returnedDocumentId?'PDF recibido: continúa con la revisión.':d.sent?'Esperando la adenda firmada.':'Adenda preparada para el cliente.'}</h3><p>Recibir el archivo, revisar sus firmas y formalizar el cambio son pasos distintos. Puedes recorrerlos aquí en modo simulado.</p></div><ol class="signature-checklist"><li><strong>Adenda preparada</strong><span>Condiciones guardadas localmente.</span></li><li><strong>${d.sent?'Envío simulado registrado':'Enviar al cliente'}</strong><span>La prueba no envía correos reales.</span></li><li><strong>${d.returnedDocumentId?'PDF recibido · sin verificación real':'Recibir el documento firmado'}</strong><span>Adjuntar un archivo no verifica automáticamente las firmas.</span></li><li><strong>${d.verificationSimulated?'Revisión conforme · simulación':'Revisar documento y firmas'}</strong><span>La revisión debe comprobar versión, condiciones, identidad y firmas de ambas partes.</span></li><li><strong>Formalizar el cambio</strong><span>La demo permitirá ver una versión nueva simulada. El acuerdo real se mantiene.</span></li></ol>`;
  if(!d.sent) return body+'<div class="dialog-actions"><button class="button" data-action="simulate-send">Simular envío al cliente →</button></div>';
  if(!d.returnedDocumentId) return body+'<form id="signed-return-form"><label class="field" for="signed-return-file">PDF devuelto por el cliente · máximo 10 MB</label><input class="context-box" id="signed-return-file" type="file" accept=".pdf,application/pdf" required><p class="muted">Solo se registra la recepción del archivo; no se cambia el contrato ni se verifica una firma.</p><p id="signed-return-error" role="alert"></p><div class="dialog-actions"><button class="button secondary" type="button" data-action="close">Esperar y cerrar</button><button class="button" type="submit">Registrar documento recibido →</button></div></form>';
  body+=`<button class="source-citation" type="button" data-preview-pdf="${d.returnedDocumentId}">Abrir PDF devuelto ↗</button>`;
  if(!d.verificationSimulated) return body+'<div class="change-guard"><strong>No se ha formalizado el cambio.</strong><p>La verificación real aún no está conectada. Para probar el resto del frontend puedes simular un resultado conforme, sin validar realmente este PDF.</p></div><div class="dialog-actions"><button class="button" data-action="simulate-verification">Simular revisión de documento y firmas →</button></div>';
  return body+`<article class="change-finding"><strong>Resultado de revisión · completamente simulado</strong><ul><li>Versión y condiciones coincidentes: ejemplo conforme.</li><li>Firma del freelancer: ejemplo conforme.</li><li>Firma del cliente autorizado: ejemplo conforme.</li></ul><p>No se inspeccionó ni certificó ninguna firma del PDF. Este resultado solo permite recorrer la pantalla final.</p></article><div class="dialog-actions"><button class="button" data-action="simulate-formalize">Simular formalización del cambio →</button></div>`;
}
function completeSimulatedChange() {
  if(!changeDraft?.prepared || !changeDraft.sent || !changeDraft.returnedDocumentId || !changeDraft.verificationSimulated || changeDraft.formalizedSimulated)return false;
  changeDraft.formalizedSimulated=true;
  changeDraft.simulatedVersion=(Math.floor(Number.parseFloat(selectedSource().version))+1)+'.0';
  updateRequestStatus('formalized_simulated');
  outcomes.set(activeProject.id,'Formalizado · simulación');
  actionHistories.get(activeProject.id).push({id:`FORMALIZED-DEMO-${Date.now()}`,projectId:activeProject.id,type:'cambios',title:'Cambio formalizado · simulación',summary:`Versión ${changeDraft.simulatedVersion} ilustrativa. No se verificaron firmas, no se actualizó el contrato real ni se creó un cobro.`,occurredAt:new Date().toISOString(),status:'simulated',documentId:changeDraft.returnedDocumentId,localRequestId:activeLocalRequest?.id,resumeProjectId:activeProject.id,isSimulated:true});
  rememberFlowProgress();return true;
}
function rememberFlowProgress() {
  if(!activeProject || !changeDraft || stage<2)return;
  const key=activeLocalRequest?.id || activeProject.id;
  changeDraft.resumeStage=Math.max(stage,savedChangeDrafts.get(key)?.resumeStage || 2);
  savedChangeDrafts.set(key,{...changeDraft});
  persistChangeWorkspace();
}
function captureChangeTerms() {
  if (!content.querySelector('#change-terms-form')) return;
  changeDraft.scope = document.querySelector('#change-scope').value.trim();
  changeDraft.amount = Number(document.querySelector('#change-amount').value);
  changeDraft.days = Number(document.querySelector('#change-days').value);
  changeDraft.note = document.querySelector('#change-note').value.trim();
  proposedTotal = changeDraft.amount;
}
document.addEventListener('click', event => {
  const projectButton = event.target.closest('[data-project]');
  if (projectButton) openFlow(projectButton.dataset.project);
  const flowButton = event.target.closest('[data-flow]');
  if (flowButton) openFlow(projects.find(project => project.type === flowButton.dataset.flow).id);
});
let flowTransitionBusy=false;
async function graphCall(payload) {
  const response=await fetch('/api/workflows',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const result=await response.json();if(!response.ok)throw new Error(result.error || 'No se pudo continuar el flujo.');return result;
}
async function prepareInlineGraph() {
  const local=activeLocalRequest;
  const source=flowExample();
  const key=local?.id || `example-${activeProject.id}`;
  let run=changeDraft.graphRun;
  if(!run || !['confirm','pertinence','analysis','proposal'].includes(run.pending?.step)) {
    run=await graphCall({action:'create',input:{project_id:activeProject.id,request_id:`${key}-${Date.now()}`,subject:local?.subject || 'Solicitud de ejemplo',message:source.message,sender:local?local.sender:'cliente@example.com',email_date:local?local.emailDate:'2026-10-14'}});
  }
  if(run.pending?.step==='confirm')run=await graphCall({action:'resume',run_id:run.run_id,expected_step:'confirm',value:{confirmed:true}});
  // Only the demo fixture / user declaration is used here; this is not an AI verdict.
  if(run.pending?.step==='pertinence')run=await graphCall({action:'resume',run_id:run.run_id,expected_step:'pertinence',value:{relation:'matches'}});
  changeDraft.graphRun=run;
  updateRequestStatus('analysis_simulated');
  return run;
}
function showFlowError(message) {
  let target=document.querySelector('#inline-flow-error');
  if(!target){target=document.createElement('p');target.id='inline-flow-error';target.setAttribute('role','alert');content.append(target);}
  target.textContent=message;
}
content.addEventListener('submit', async event => {
  if(event.target.id==='signed-return-form') {
    event.preventDefault();
    const form=event.target, file=document.querySelector('#signed-return-file').files[0], error=document.querySelector('#signed-return-error');
    if(!file || flowTransitionBusy)return;
    const draft=changeDraft, projectId=activeProject.id, request=activeLocalRequest;
    if(!/\.pdf$/i.test(file.name)||(file.type && file.type!=='application/pdf')||!file.size||file.size>10*1024*1024){error.textContent='Selecciona un PDF de hasta 10 MB.';return;}
    flowTransitionBusy=true;
    try {
      if(await file.slice(0,5).text()!=='%PDF-'){error.textContent='El archivo no tiene una cabecera PDF válida.';return;}
      if(changeDraft!==draft||!form.isConnected)return;
      const id=`RETURN-${projectId}-${Date.now()}`;
      knowledgeDocuments.push({id,projectId,clientId:selectedClient().id,addedAt:new Date().toISOString(),title:'Adenda devuelta · firma sin verificar',text:'',version:'1.0',state:'Recibido · firma sin verificar',draft:true,filename:file.name,pdfUrl:URL.createObjectURL(file)});
      changeDraft.returnedDocumentId=id;
      savedChangeDrafts.set(request?.id || projectId,{...changeDraft});
      persistChangeWorkspace();
      updateRequestStatus('signature_review_pending');
      actionHistories.get(projectId).push({id:`EVENT-${id}`,projectId,type:'cambios',title:'Documento devuelto recibido',summary:'La firma y su correspondencia con la adenda aún no fueron verificadas. El acuerdo vigente no cambia.',occurredAt:new Date().toISOString(),status:'pending',documentId:id,isSimulated:true});
      outcomes.set(projectId,'Firma por verificar');persistChangeWorkspace();renderStage();renderRows();
      showRequestToast('Documento recibido. Pendiente de verificar las firmas.');
    }catch{error.textContent='No pudimos leer el PDF. Intenta otra vez.';}finally{flowTransitionBusy=false;}
    return;
  }
  if(event.target.id!=='change-terms-form')return;
  event.preventDefault();
  if(flowTransitionBusy || !event.target.checkValidity())return;
  captureChangeTerms();if(!changeDraft.scope){document.querySelector('#change-scope').focus();return;}
  flowTransitionBusy=true;
  const submit=event.target.querySelector('button[type="submit"]');submit.disabled=true;
  try {
    let run=await prepareInlineGraph();
    if(run.pending?.step==='analysis')run=await graphCall({action:'resume',run_id:run.run_id,expected_step:'analysis',value:{reviewed:true}});
    if(run.pending?.step!=='proposal')throw new Error('El flujo no está listo para preparar la propuesta.');
    run=await graphCall({action:'resume',run_id:run.run_id,expected_step:'proposal',value:{option:changeDraft.option,scope:changeDraft.scope,amount:String(changeDraft.amount),days:changeDraft.days,terms:changeDraft.note}});
    changeDraft.graphRun=run;changeDraft.prepared=false;stage=5;renderStage();
  }catch(error){showFlowError(error.message);}finally{flowTransitionBusy=false;submit.disabled=false;}
});
content.addEventListener('click', async event => {
  const option = event.target.closest('[data-change-option]');
  if (option) {
    captureChangeTerms();
    changeDraft.option=option.dataset.changeOption;
    changeDraft.amount=changeDraft.option==='swap'?0:(activeLocalRequest?180:activeProject.amount);
    if (changeDraft.option==='swap') changeDraft.scope='Indica qué entregable pendiente retiras y cómo lo sustituye el nuevo pedido.';
    else if (!changeDraft.scope) changeDraft.scope=activeLocalRequest?activeLocalRequest.message.slice(0,2000):(cases[activeProject.id].items||[]).map(([label])=>label).join('; ');
    changeDraft.prepared=false; renderStage(); return;
  }
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action=button.dataset.action;
  if (action==='next') {
    if(flowTransitionBusy)return;
    if(stage===2){flowTransitionBusy=true;button.disabled=true;try{await prepareInlineGraph();stage=3;renderStage();}catch(error){showFlowError(error.message);}finally{flowTransitionBusy=false;button.disabled=false;}}
    else {if(stage===3)updateRequestStatus('analysis_reviewed');stage=Math.min(5,stage+1);renderStage();}
  }
  if (action==='back') return;
  if(action==='signature'){stage=6;renderStage();}
  if(action==='simulate-verification' && changeDraft.returnedDocumentId && !changeDraft.verificationSimulated){
    changeDraft.verificationSimulated=true;updateRequestStatus('signature_review_simulated');rememberFlowProgress();renderStage();
  }
  if(action==='simulate-formalize'){
    if(flowTransitionBusy)return;
    flowTransitionBusy=true;button.disabled=true;
    try {
      const run=changeDraft.graphRun;
      if(run?.pending?.step==='signature')changeDraft.graphRun=await graphCall({action:'resume',run_id:run.run_id,expected_step:'signature',value:{signed:true}});
      if(completeSimulatedChange()){renderStage();renderRows();if(['clientes','conversaciones','kb'].includes(currentView))renderWorkspace();showRequestToast('Recorrido completado en modo simulado. Pago sin gestionar.');}
    }catch(error){showFlowError(error.message);}finally{flowTransitionBusy=false;button.disabled=false;}
  }
  if(action==='payment-demo' && changeDraft.formalizedSimulated && window.TratoPayments){window.TratoPayments.openDemo({paymentKey:changePaymentKey(),clientName:selectedClient().name,contactName:selectedClient().contact,recipientEmail:activeLocalRequest?.sender || 'cliente@example.com',projectName:activeProject.name,amount:changeDraft.amount,scope:changeDraft.scope,agreementVersion:changeDraft.simulatedVersion});}
  if(action==='finish-flow'){dialog.close();goToClientTab('solicitudes');}

  if(action==='simulate-send' && changeDraft.prepared && !changeDraft.sent){
    changeDraft.sent=true;updateRequestStatus('pending_signature_simulated');
    savedChangeDrafts.set(activeLocalRequest?.id || activeProject.id,{...changeDraft});
    persistChangeWorkspace();
    actionHistories.get(activeProject.id).push({id:`SEND-${Date.now()}`,projectId:activeProject.id,type:'cambios',resumeProjectId:activeProject.id,localRequestId:activeLocalRequest?.id,title:'Envío de adenda · simulado',summary:'No se envió un correo real. Se espera el documento firmado.',occurredAt:new Date().toISOString(),status:'simulated',isSimulated:true});
    outcomes.set(activeProject.id,'Pendiente de firma · demo');persistChangeWorkspace();renderStage();renderRows();
  }
  if (action==='prepare' && !changeDraft.prepared) {
    changeDraft.prepared=true;
    updateRequestStatus('draft_ready');
    savedChangeDrafts.set(activeLocalRequest?.id || activeProject.id,{...changeDraft});
    persistChangeWorkspace();
    showRequestToast('Adenda preparada. Aún falta el envío y las firmas.');
    outcomes.set(activeProject.id,'Borrador · sin firma');
    actionHistories.get(activeProject.id).push({id:`CHANGE-DRAFT-${Date.now()}`,projectId:activeProject.id,type:'cambios',resumeProjectId:activeProject.id,localRequestId:activeLocalRequest?.id,title:'Adenda preparada · simulación',summary:changeDraft.scope,occurredAt:new Date().toISOString(),status:'simulated',amount:changeDraft.amount,currency:'USD',sourceVersionId:`VER-${activeProject.id}-1`,isSimulated:true});
    persistChangeWorkspace();renderStage(); renderRows();
    if (['clientes','conversaciones','kb'].includes(currentView)) renderWorkspace();
  }
  if (action==='close') dialog.close();
});
document.querySelector('#close-dialog').addEventListener('click', () => dialog.close());
dialog.addEventListener('close',()=>{captureChangeTerms();rememberFlowProgress();});
dialog.addEventListener('click', event => { if (event.target === dialog) { const bounds = dialog.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close(); } });
document.querySelector('#tour').addEventListener('click', () => openFlow('SP-001'));
let toastTimeout;
document.querySelector('#reset').addEventListener('click', () => {
  outcomes.clear(); resetWorkspaceData(); resetGeneralAssistant(); renderRows(); persistChangeWorkspace();
  const toast = document.querySelector('#toast');
  toast.textContent = 'Demo restablecida. Todos los casos vuelven al estado inicial.';
  toast.hidden = false;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => { toast.hidden = true; }, 3500);
});
// Espacio de clientes: todo el contenido queda en memoria y está separado por proyecto.
let selectedProjectId = 'SP-001';
let selectedDocumentId = null;
let selectedClientTab = 'asistente';
let chatSequence = 0;
const clientRecords = demoData.projects.map(project => {
  const client = demoData.clients.find(item => item.id === project.clientId);
  return { ...client, projectId: project.id, contact: client.contactName, service: project.service };
});
const knowledgeDocuments = demoData.documents.map(doc => {
  const version = demoData.documentVersions.find(item => item.documentId === doc.id);
  const project = demoData.projects.find(item => item.id === doc.projectId);
  return { id: doc.id, addedAt: doc.addedAt, projectId: doc.projectId, clientId: project.clientId, title: doc.title, version: String(version.version) + '.0', state: version.status === 'accepted' ? 'Acordado · ejemplo' : version.status === 'draft' ? 'Borrador · ejemplo' : 'Registrado · ejemplo', text: version.content, draft: false, pdfUrl: `/data/pdfs/${doc.id}.pdf`, filename: `${doc.id}.pdf` };
});
const initialDocumentCount = knowledgeDocuments.length;
let historyFilter = 'all';
const chatHistories = new Map();
const actionHistories = new Map();
function resetWorkspaceData() {
  chatHistories.clear(); actionHistories.clear(); chatSequence = 0;
  for (const doc of knowledgeDocuments.slice(initialDocumentCount)) { if (doc.pdfUrl) URL.revokeObjectURL(doc.pdfUrl); }
  knowledgeDocuments.splice(initialDocumentCount);
  localChangeRequests.length=0; activeLocalRequest=null; savedChangeDrafts.clear();
  window.TratoPayments?.reset();
  selectedDocumentId = null;
  for (const project of projects) {
    chatHistories.set(project.id, [{role: 'assistant', text: 'Este es tu asistente para este cliente y proyecto. Puedes escribir preguntas libres. En esta demo solo las preguntas sugeridas y el mensaje de ejemplo tienen respuestas predefinidas; no hay un modelo conectado.', time: 'Inicio de la demo'}]);
    actionHistories.set(project.id, demoData.events.filter(event => event.projectId === project.id).map(event => { const related = event.invoiceId ? demoData.invoices.find(item => item.id === event.invoiceId) : event.requestId ? demoData.requests.find(item => item.id === event.requestId) : null; return related ? {...event, amount: related.amount} : {...event}; }));
    const conversation = demoData.conversations.find(item => item.projectId === project.id && item.kind === 'assistant');
    const seedMessages = demoData.messages.filter(message => message.conversationId === conversation.id);
    for (const message of seedMessages) {
      const turn = {role: message.authorType === 'assistant' ? 'assistant' : 'user', text: message.content, time: message.authorType === 'client' ? 'Mensaje del cliente · ejemplo' : 'Conversación de ejemplo'};
      if (message.sourceVersionId) { const sourceVersion = demoData.documentVersions.find(item => item.id === message.sourceVersionId); turn.source = sourceVersion.documentId; }
      chatHistories.get(project.id).push(turn);
    }
  }
}
resetWorkspaceData();
restoreChangeWorkspace(window.TRATO_SAVED_STATE);
const workspace = document.querySelector('#client-workspace');
function selectedProject() { return projects.find(project => project.id === selectedProjectId); }
function selectedClient() { return clientRecords.find(client => client.projectId === selectedProjectId); }
function selectedSource() { return knowledgeDocuments.find(doc => doc.projectId === selectedProjectId && !doc.draft); }
function getTab() { return currentView === 'kb' ? 'documentos' : currentView === 'conversaciones' ? 'asistente' : selectedClientTab; }
function tabButton(tab, text) { return `<button type="button" class="client-tab ${getTab() === tab ? 'selected' : ''}" data-client-tab="${tab}" aria-pressed="${getTab() === tab}">${text}</button>`; }
function renderWorkspace() {
  if (window.TratoCloud?.handlesView) {window.TratoCloud.renderWorkspace(workspace); return;}
  const project = selectedProject(); const client = selectedClient();
  workspace.innerHTML = `<div class="workspace-controls"><div><label for="client-picker" class="field">Cliente y proyecto</label><select id="client-picker" class="context-box">${clientRecords.map(record => `<option value="${record.projectId}" ${record.projectId === project.id ? 'selected' : ''}>${record.name} · ${projects.find(item => item.id === record.projectId).name}</option>`).join('')}</select></div><span class="demo-pill">${client.id} · ${project.id}</span></div>
  <div class="client-banner"><span class="client-avatar">${project.initials}</span><div><span class="eyebrow">CLIENTE · ${client.service.toUpperCase()}</span><h2>${client.name}</h2><p>${project.name} · Contacto de ejemplo: ${client.contact}</p></div><div class="client-banner-state"><span class="badge review">${outcomes.get(project.id) || project.status}</span><small>Contexto exclusivo de este proyecto</small><button class="button new-change-button" type="button" data-new-change>＋ Nueva solicitud de cambio</button></div></div>
  <nav class="client-tabs" aria-label="Secciones del cliente">${tabButton('asistente','✳ Asistente')}${tabButton('solicitudes','Solicitudes')}${tabButton('documentos','Documentos')}${tabButton('actividad','Historial')}</nav><div id="client-panel"></div>`;
  const panel = document.querySelector('#client-panel');
  const tab = getTab();
  if (tab === 'asistente') renderChat(panel);
  if (tab === 'solicitudes') renderClientRequests(panel);
  if (tab === 'documentos') renderKnowledge(panel);
  if (tab === 'actividad') renderClientActivity(panel);
  if (tab === 'resumen') {
    panel.innerHTML = `<div class="client-summary"><article class="workspace-panel"><span class="eyebrow">EL ACUERDO COMO PUNTO DE PARTIDA</span><h3>Antes de responder, revisa el contexto.</h3><p>${escapeHTML(cases[project.id].context)}</p><button class="text-button" data-open-source="${selectedSource().id}">Ver acuerdo v1.0 ↗</button></article><article class="workspace-panel"><span class="eyebrow">ÚLTIMO MENSAJE DE EJEMPLO</span><blockquote>${escapeHTML(cases[project.id].message)}</blockquote><button class="button" data-start-conversation>Revisar con el asistente ↗</button></article></div><div class="workspace-panel context-notice">Los documentos, mensajes y acciones se consultan dentro de ${client.name} / ${project.name}. La versión funcional deberá aplicar este aislamiento también en el backend.</div>`;
  }
}
function renderClientRequests(panel) {
  const local=localChangeRequests.filter(item=>item.projectId===selectedProjectId).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  const savedExample=savedChangeDrafts.get(selectedProjectId);
  panel.innerHTML=`<div class="requests-heading"><div><span class="eyebrow">SOLICITUDES DEL PROYECTO</span><h3>Retoma cada cambio donde lo dejaste.</h3><p>El recorrido solo avanza: si hay un error, crea una solicitud nueva. Una adenda pendiente sigue aquí para continuar con su firma. Guardado local en este navegador; Supabase aún no está conectado.</p></div><button class="button" type="button" data-new-change>＋ Nueva solicitud</button></div>${local.length || savedExample?`<div class="request-table"><div class="request-table-head"><span>Solicitud</span><span>Estado actual</span><span>Acción</span></div>${local.map(item=>{const draft=savedChangeDrafts.get(item.id);return `<div class="request-table-row"><div><strong>${escapeHTML(item.subject)}</strong><small>${new Intl.DateTimeFormat('es-PE',{dateStyle:'medium',timeZone:'America/Lima'}).format(new Date(item.createdAt))}</small></div><span class="badge review">${requestStatusLabel(item.status)}</span><button class="button secondary" type="button" data-local-request="${item.id}" data-request-project="${item.projectId}">${draft?.formalizedSimulated?'Ver resultado':draft?.returnedDocumentId?'Continuar revisión':draft?.sent?'Continuar con firma':draft?.prepared?'Abrir adenda':'Continuar solicitud'} ↗</button></div>`;}).join('')}${savedExample?`<div class="request-table-row"><div><strong>Solicitud de ejemplo · ${savedExample.prepared?'adenda guardada':'en curso'}</strong><small>Datos ficticios de este proyecto</small></div><span class="badge pending">${savedExample.formalizedSimulated?'Formalizado · simulación':savedExample.returnedDocumentId?'Firma por verificar':savedExample.sent?'Pendiente de firma · demo':savedExample.prepared?'Adenda preparada':'En curso'}</span><button class="button secondary" type="button" data-project="${selectedProjectId}">${requestResumeLabel(selectedProjectId)} ↗</button></div>`:''}</div>`:'<div class="empty-state">Todavía no hay solicitudes creadas en este proyecto. Registra un pedido para empezar.</div>'}`;
}
function persistChangeWorkspace() {
  if(!window.TratoStore)return Promise.resolve();
  const fixtureIds=new Set(demoData.events.map(item=>item.id));
  const snapshot={schemaVersion:1,requests:localChangeRequests,documents:knowledgeDocuments.slice(initialDocumentCount),drafts:[...savedChangeDrafts],outcomes:[...outcomes],paymentPreviews:window.TratoPayments?.exportState() || [],events:[...actionHistories].map(([id,events])=>[id,events.filter(event=>!fixtureIds.has(event.id))])};
  return window.TratoStore.save(snapshot).then(()=>{window.TRATO_STORAGE_WARNING=false;}).catch(()=>{window.TRATO_STORAGE_WARNING=true;showRequestToast('No se pudo guardar en el navegador. Mantén abierta la página para no perder esta sesión.');});
}
function restoreChangeWorkspace(snapshot) {
  if(!snapshot || snapshot.schemaVersion!==1)return;
  window.TratoPayments?.restoreState(snapshot.paymentPreviews);
  const ids=new Set(projects.map(item=>item.id));
  const requests=(snapshot.requests || []).filter(item=>ids.has(item.projectId));
  const docs=(snapshot.documents || []).filter(item=>ids.has(item.projectId));
  localChangeRequests.push(...requests);
  knowledgeDocuments.push(...docs);
  const requestIds=new Set(requests.map(item=>item.id));
  for(const [key,value] of snapshot.drafts || [])if(requestIds.has(key)||ids.has(key))savedChangeDrafts.set(key,value);
  for(const [id,value] of snapshot.outcomes || [])if(ids.has(id))outcomes.set(id,value);
  for(const [id,events] of snapshot.events || [])if(ids.has(id))actionHistories.get(id).push(...events.filter(event=>event.projectId===id));
}
function renderNewChangeModal() {
  return `<p class="muted">${escapeHTML(selectedClient().name)} · ${escapeHTML(selectedProject().name)}. Usa este formulario únicamente para un pedido nuevo del cliente sobre este proyecto. Sube el PDF del correo y revisa los datos antes de registrarlo. No corresponde a contratos iniciales, facturas ni documentos de otros proyectos.</p><form id="new-change-form" novalidate><div class="demo-email-entry"><strong>¿Solo quieres probar el recorrido?</strong><p>Usa un correo ficticio de este proyecto y avanza sin subir archivos ni rellenar datos.</p><button class="button" type="button" data-use-demo-email>Usar correo de ejemplo →</button></div><label class="field" for="change-email-file">O sube tu propio PDF del correo · máximo 10 MB</label><input class="context-box" id="change-email-file" type="file" accept=".pdf,application/pdf" required><button class="button" type="button" data-extract-email>Leer PDF y revisar datos →</button><p id="pdf-extraction-status" class="muted" role="status" aria-live="polite">Lectura local de texto. No se envía el archivo a un proveedor de IA. Los PDFs escaneados necesitan OCR, todavía no conectado.</p><p id="new-change-error" role="alert"></p><fieldset id="extracted-email-fields" disabled hidden><legend>2. Confirma la información del correo</legend><div class="request-scope-notice"><strong>Pedido nuevo para ${escapeHTML(selectedProject().name)}</strong><p>Comprueba que el correo solicita agregar, sustituir o modificar trabajo de este proyecto. Si el vínculo no está claro, acláralo antes de continuar.</p></div><p class="muted">Modo de prueba: puedes avanzar sin rellenar los datos que no se reconozcan. Si quieres, puedes corregirlos. El contenido incluye el texto del PDF para que selecciones el pedido relevante.</p><label class="field" for="change-subject">Asunto del correo</label><input class="context-box" id="change-subject" maxlength="160" placeholder="Opcional en esta demo"><label class="field" for="change-sender">Correo del remitente</label><input class="context-box" id="change-sender" type="email" maxlength="254" placeholder="No reconocido · opcional"><label class="field" for="change-email-date">Fecha del correo</label><input class="context-box" id="change-email-date" type="date"><label class="field" for="change-message">Contenido del pedido · revisa el texto extraído</label><textarea id="change-message" rows="6" maxlength="6000" required></textarea><p class="muted">El PDF se incorporará una sola vez a Documentos. No verificamos la identidad del remitente ni firmas. La relación con el proyecto aún no se valida con IA: quedará pendiente de análisis. La solicitud no cambia el acuerdo. Su guardado es local en este navegador.</p><button class="button" type="submit">Confirmar lectura y ver análisis →</button></fieldset></form>`;
}
function useDemoEmail() {
  const projectId=selectedProjectId;
  const request=registerLocalChange({projectId,subject:'Pedido adicional · correo ficticio',sender:'cliente@example.com',emailDate:'2026-10-14',message:cases[projectId].message,filename:`correo-ejemplo-${projectId}.pdf`,pdfUrl:`/data/pdfs/DOC-${projectId}-solicitud.pdf`});
  const doc=knowledgeDocuments.find(item=>item.id===request.documentId);
  doc.isFixture=true;doc.state='Correo ficticio · ejemplo';
  renderWorkspace();openFlow(projectId,request.id);
}
async function readEmailPdf() {
  const form=document.querySelector('#new-change-form');
  if (form.dataset.reading) return;
  const input=document.querySelector('#change-email-file');
  const file=input.files[0];
  const error=document.querySelector('#new-change-error');
  const fields=document.querySelector('#extracted-email-fields');
  const status=document.querySelector('#pdf-extraction-status');
  error.textContent=''; fields.hidden=true; fields.disabled=true;
  if (!file) { error.textContent='Elige un archivo PDF o pulsa «Usar correo de ejemplo» para probar sin subir nada.'; return; }
  if (!/\.pdf$/i.test(file.name) || (file.type && file.type!=='application/pdf') || !file.size || file.size>10*1024*1024) { error.textContent='Selecciona un PDF de hasta 10 MB.'; return; }
  const button=form.querySelector('[data-extract-email]');
  const projectId=selectedProjectId;
  form.dataset.reading='true'; button.disabled=true; input.disabled=true;
  status.textContent='Leyendo el texto del PDF…';
  try {
    const response=await fetch('/api/extract-email-pdf',{method:'POST',headers:{'Content-Type':'application/pdf'},body:file});
    const data=await response.json();
    if (!form.isConnected || selectedProjectId!==projectId || !dialog.open) return;
    if (!response.ok) throw new Error(data.error || 'No se pudo leer el documento.');
    document.querySelector('#change-subject').value=data.subject;
    document.querySelector('#change-sender').value=data.sender;
    document.querySelector('#change-email-date').value=data.emailDate;
    document.querySelector('#change-message').value=data.message;
    fields.hidden=false; fields.disabled=false;
    stage=2; updateChangeProgress();
    form.extractedFile=file;
    const missing=[!data.subject&&'asunto',!data.sender&&'remitente',!data.emailDate&&'fecha'].filter(Boolean);
    status.textContent=`Texto leído localmente, sin IA. ${missing.length?'No reconocimos '+missing.join(', ')+': puedes continuar sin completarlos en esta demo.':'Revisa los datos reconocidos antes de confirmar.'}${data.truncated?' El texto supera 6.000 caracteres; revisa el PDF y ajusta el fragmento del pedido.':''}`;
    document.querySelector('#change-subject').focus();
  } catch (issue) {
    if(form.isConnected) { error.textContent=issue.message || 'No pudimos leer el PDF.'; status.textContent='No se registró ninguna solicitud. Puedes probar con un PDF que tenga texto seleccionable.'; }
  } finally { delete form.dataset.reading; button.disabled=false; input.disabled=false; }
}
function registerLocalChange({projectId,subject,sender,emailDate,message,filename,pdfUrl}) {
  const project=projects.find(item=>item.id===projectId);
  if (!project) throw new Error('Proyecto desconocido');
  const id=`LOCAL-CHANGE-${Date.now()}-${localChangeRequests.length+1}`;
  const documentId=`DOC-${id}`;
  const addedAt=new Date().toISOString();
  knowledgeDocuments.push({id:documentId,projectId,clientId:demoData.projects.find(item=>item.id===projectId).clientId,addedAt,title:subject,text:message,version:'1.0',state:'Origen sin verificar',draft:true,filename,pdfUrl});
  const request={id,projectId,documentId,subject,sender,emailDate,message,status:'pending_analysis',createdAt:addedAt};
  localChangeRequests.push(request);
  actionHistories.get(projectId).push({id:`EVENT-${id}`,projectId,type:'cambios',title:'Solicitud de cambio registrada',summary:subject,occurredAt:addedAt,status:'pending',documentId,localRequestId:id,requestStatus:'pending_analysis',isSimulated:true});
  persistChangeWorkspace();
  showRequestToast('Solicitud registrada. Disponible en Solicitudes y en el historial.');
  return request;
}
function showRequestToast(message) {
  const toast=document.querySelector('#toast');toast.textContent=message;toast.hidden=false;
  clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>{toast.hidden=true;},3500);
}
function renderKnowledge(panel) {
  const docs = knowledgeDocuments.filter(doc => doc.projectId === selectedProjectId).sort((a,b) => Date.parse(b.addedAt) - Date.parse(a.addedAt) || a.id.localeCompare(b.id));
  panel.innerHTML = `<div class="knowledge-layout document-library"><div class="workspace-panel"><div class="library-header"><div><span class="eyebrow">BASE DE CONOCIMIENTO</span><h3>Documentos del proyecto</h3></div></div><p>Archivo de consulta: acuerdo inicial, correos de solicitudes y adendas. Los documentos se incorporan desde el paso correspondiente; no necesitas subirlos otra vez aquí.</p><div class="source-heading">${docs.length} ${docs.length === 1 ? 'DOCUMENTO' : 'DOCUMENTOS'} · PDF <span class="document-order">Más recientes primero · fecha de incorporación</span></div><div class="document-list">${docs.map(doc => `<button type="button" class="document-button" data-preview-pdf="${doc.id}"><span class="pdf-icon">PDF</span><span><strong>${escapeHTML(doc.title)}</strong><small>v${doc.version} · ${doc.state}</small><small>${doc.isFixture || !doc.draft ? 'Correo de ejemplo · origen ficticio' : 'Carga manual · correo sin verificar'}</small><small>Incorporado: ${new Intl.DateTimeFormat('es-PE', {dateStyle:'medium', timeStyle:'short', timeZone:'America/Lima'}).format(new Date(doc.addedAt))}</small></span><span>↗</span></button>`).join('')}</div><div class="mail-channel-note"><strong>El correo es el canal del acuerdo</strong><p>La conexión con Gmail u otro proveedor está pendiente. Solo un documento firmado y verificado podrá actualizar el acuerdo vigente.</p></div></div></div>`;

}
function previewPdf(id) {
  const doc = knowledgeDocuments.find(item => item.id === id && item.projectId === selectedProjectId);
  if (!doc) return;
  const preview = document.querySelector('#pdf-preview');
  document.querySelector('#pdf-preview-title').textContent = doc.title;
  document.querySelector('#pdf-preview-frame').src = doc.pdfUrl;
  document.querySelector('#pdf-preview-download').href = doc.pdfUrl;
  document.querySelector('#pdf-preview-download').download = doc.filename;
  document.querySelector('#pdf-preview-note').textContent = doc.isFixture || !doc.draft ? 'PDF ficticio de demostración · no enviado por correo ni firmado.' : 'Carga manual local · origen por correo y firma sin verificar.';
  if (!preview.open) preview.showModal();
}
function renderChat(panel) {
  const project = selectedProject();
  panel.innerHTML = `<div class="assistant-layout"><section class="workspace-panel chat-panel" aria-label="Asistente del proyecto"><div class="chat-heading"><span class="icon purple-icon">✳</span><div><h3>Pregúntale a Trato</h3><p>${selectedClient().name} · ${project.name}</p></div><span class="badge pending">Simulación</span></div><div class="chat-messages" id="chat-messages" role="log" aria-label="Historial de conversación" aria-live="polite"></div><div class="suggestions"><button data-question="terms">¿Qué acordamos?</button><button data-question="payment">¿Qué sabemos del pago?</button><button data-question="client-message">Esto me escribió mi cliente</button></div><form id="chat-form"><label class="field" for="chat-input">Tu pregunta o el mensaje de tu cliente</label><textarea id="chat-input" maxlength="4000" required rows="3" placeholder="Pregunta libremente sobre este proyecto…"></textarea><div class="chat-compose-footer"><small>Demo sin modelo · Las preguntas libres quedan registradas.</small><button class="button" type="submit">Enviar <span>↑</span></button></div></form></section><aside class="workspace-panel context-panel"><span class="eyebrow">CONTEXTO DE ESTA CONVERSACIÓN</span><h3>Una relación, su propio contexto.</h3><div class="context-entry"><small>CLIENTE</small><strong>${selectedClient().name}</strong></div><div class="context-entry"><small>PROYECTO</small><strong>${project.name}</strong></div><div class="context-entry"><small>FUENTE DEL EJEMPLO</small><button class="text-button" data-open-source="${selectedSource().id}">${selectedSource().title} · v1.0 ↗</button></div><div class="context-entry"><small>IMPORTE DEL CASO</small><strong>${money(project.amount)}</strong></div><p>El asistente propone. Tú apruebas. El estado financiero deberá confirmarse con PayPal en la versión conectada.</p></aside></div>`;
  renderMessages();
}
function renderMessages() {
  const target = document.querySelector('#chat-messages');
  if (!target) return;
  target.innerHTML = chatHistories.get(selectedProjectId).map(message => `<article class="chat-message ${message.role}"><span class="message-author">${message.role === 'user' ? 'Tú' : '✳ Trato · respuesta de ejemplo'} <small>${message.time}</small></span><p>${escapeHTML(message.text)}</p>${message.source ? `<button class="source-citation" data-open-source="${message.source}">▤ Ver fuente · acuerdo v1.0</button>` : ''}${message.action ? `<button class="button secondary" data-project="${selectedProjectId}">Revisar ${typeLabels[selectedProject().type].toLowerCase()} ↗</button>` : ''}</article>`).join('');
  target.scrollTop = target.scrollHeight;
}
function askAssistant(text, intent = null) {
  const history = chatHistories.get(selectedProjectId);
  chatSequence += 1;
  const time = `Turno ${chatSequence}`;
  history.push({role: 'user', text, time});
  const example = cases[selectedProjectId];
  if (intent === 'terms' || text === '¿Qué acordamos?') {
    history.push({role: 'assistant', text: `El acuerdo de ejemplo indica lo siguiente:\n\n${example.context}\n\nEsta respuesta está predefinida y no es una interpretación de documentos nuevos.`, source: selectedSource().id, time});
  } else if (intent === 'payment' || text === '¿Qué sabemos del pago?') {
    const project = selectedProject();
    const detail = project.type === 'cobros' ? example.context : project.type === 'cambios' ? `${money(project.amount)} es el adicional propuesto del ejemplo. No hay un pago confirmado.` : `${money(project.amount)} es el importe de la reserva del ejemplo. No hay un reembolso confirmado.`;
    history.push({role: 'assistant', text: `${detail}\n\nLos datos son ficticios. No consulté PayPal.`, source: selectedSource().id, time});
  } else if (text === example.message) {
    history.push({role: 'assistant', text: `Ejemplo de clasificación: ${typeLabels[selectedProject().type]}.\n\n${example.finding}\n\nEvidencia: ${example.evidence}\n\nRevisa la propuesta antes de aprobar cualquier acción.`, source: selectedSource().id, action: true, time});
  } else {
    history.push({role: 'assistant', text: 'Tu pregunta quedó registrada en la conversación de este cliente y proyecto. Todavía no hay un modelo conectado para responder preguntas libres. Puedes explorar «¿Qué acordamos?», «¿Qué sabemos del pago?» o el mensaje de ejemplo para ver el recorrido previsto. No he analizado tu mensaje ni ejecutado ninguna acción.', time});
  }
  renderMessages();
}
function recordAction(projectId, text) {
  const project = projects.find(item => item.id === projectId);
  actionHistories.get(projectId).push({id:`LOCAL-${projectId}-${Date.now()}`,projectId,type:project.type,title:text,summary:'Aprobación registrada en esta sesión. No se ejecutó una operación externa.',occurredAt:new Date().toISOString(),status:'simulated',amount:proposedTotal,currency:'USD',sourceVersionId:`VER-${projectId}-1`,isSimulated:true});
  chatHistories.get(projectId).push({role: 'assistant', text: `${text}. La aprobación del recorrido quedó registrada solo en esta sesión. No se realizó una operación real ni se envió un mensaje al cliente.`, time: 'Acción simulada', source: `DOC-${projectId}`});
}
const eventLabels = {acuerdo:'Acuerdo',cambios:'Cambio',cobros:'Cobro',reembolsos:'Reembolso'};
const statusLabels = {accepted:'Acordado',completed:'Completado · ejemplo',pending:'Pendiente',cancelled:'Cancelado',simulated:'Simulado'};
function requestResumeLabel(key) {
  const draft=savedChangeDrafts.get(key);
  const request=localChangeRequests.find(item=>item.id===key);
  return draft?.formalizedSimulated || request?.status==='formalized_simulated' ? 'Ver resultado' : 'Continuar solicitud';
}
function historySourceLinks(event) {
  const request=event.localRequestId?localChangeRequests.find(item=>item.id===event.localRequestId&&item.projectId===event.projectId):demoData.requests.find(item=>item.id===event.requestId&&item.projectId===event.projectId);
  const version=demoData.documentVersions.find(item=>item.id===event.sourceVersionId);
  const sourceId=request?.documentId || request?.sourceDocumentId;
  const links=[];
  if(version && knowledgeDocuments.some(doc=>doc.id===version.documentId&&doc.projectId===event.projectId))links.push(`<button class="text-button" data-open-source="${version.documentId}">Acuerdo v${version.version} ↗</button>`);
  if(sourceId && knowledgeDocuments.some(doc=>doc.id===sourceId&&doc.projectId===event.projectId))links.push(`<button class="text-button" data-preview-pdf="${sourceId}">Correo fuente ↗</button>`);
  if(event.documentId && event.documentId!==sourceId) {
    const doc=knowledgeDocuments.find(item=>item.id===event.documentId&&item.projectId===event.projectId);
    if(doc)links.push(`<button class="text-button" data-preview-pdf="${doc.id}">${doc.id.startsWith('RETURN-')?'Documento devuelto':'Documento fuente'} ↗</button>`);
  }
  return links.join('');
}
function renderClientActivity(panel) {
  const events = actionHistories.get(selectedProjectId);
  const visible = events.filter(event => historyFilter === 'all' || event.type === historyFilter).sort((a,b) => new Date(b.occurredAt) - new Date(a.occurredAt));
  const paid = demoData.invoices.filter(invoice => invoice.projectId === selectedProjectId && invoice.status === 'paid').reduce((sum, invoice) => sum + invoice.amount, 0);
  const pending = demoData.invoices.filter(invoice => invoice.projectId === selectedProjectId && invoice.status === 'pending').reduce((sum, invoice) => sum + invoice.amount, 0);
  panel.innerHTML = `<section class="history-header"><div><span class="eyebrow">LA RELACIÓN, EN UNA LÍNEA DE TIEMPO</span><h3>Lo que acordaron. Lo que pasó.</h3><p>Cambios, cobros y reembolsos de ${escapeHTML(selectedClient().name)} · Datos ficticios.</p></div><button class="button secondary" data-client-tab="asistente">Consultar al asistente ↗</button></section>
  <div class="history-metrics"><article><span>Cobrado · ejemplo</span><strong>${money(paid)}</strong><small>Pagos históricos del proyecto</small></article><article><span>Pendiente de cobro</span><strong>${money(pending)}</strong><small>No incluye propuestas sin aceptar</small></article><article><span>Movimientos</span><strong>${events.length}</strong><small>Acuerdos y eventos del proyecto</small></article></div>
  <div class="history-filters" role="group" aria-label="Filtrar historial">${[['all','Todo'],['acuerdo','Acuerdos'],['cambios','Cambios']].map(([value,label])=>`<button data-history-filter="${value}" class="${historyFilter===value?'selected':''}" aria-pressed="${historyFilter===value}">${label}</button>`).join('')}</div>
  <section class="timeline" aria-label="Historial del proyecto">${visible.length ? visible.map(event => {
    const version = demoData.documentVersions.find(item => item.id === event.sourceVersionId);
    const date = new Intl.DateTimeFormat('es-PE',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'America/Lima'}).format(new Date(event.occurredAt));
    const icon = {acuerdo:'▤',cambios:'⌘',cobros:'↗',reembolsos:'↶'}[event.type];
    return `<article class="timeline-event"><div class="timeline-marker ${event.type}">${icon}</div><div class="timeline-card"><div class="timeline-top"><span class="eyebrow">${eventLabels[event.type]}</span><time datetime="${escapeHTML(event.occurredAt)}">${date}</time></div><h4>${escapeHTML(event.title)}</h4><p>${escapeHTML(event.summary)}</p><div class="timeline-bottom"><span class="badge ${event.status==='completed'||event.status==='accepted'?'done':event.status==='pending'?'review':'pending'}">${event.requestStatus?requestStatusLabel(event.requestStatus):statusLabels[event.status]}</span>${event.amount !== undefined ? `<strong>${money(event.amount)}</strong>` : ''}${historySourceLinks(event)}${event.localRequestId?`<button class="text-button" data-local-request="${event.localRequestId}" data-request-project="${event.projectId}">${requestResumeLabel(event.localRequestId)} ↗</button>`:event.resumeProjectId?`<button class="text-button" data-project="${event.resumeProjectId}">${requestResumeLabel(event.resumeProjectId)} ↗</button>`:''}</div></div></article>`;
  }).join('') : '<div class="empty-state">No hay movimientos de este tipo en este proyecto.</div>'}</section>`;
}
function goToClientTab(tab) {
  selectedClientTab = tab;
  const destination = 'clientes';
  if (currentView === destination) renderWorkspace(); else location.hash = destination;
}
document.addEventListener('change', event => {
  if (event.target.id === 'change-email-file') { const fields=document.querySelector('#extracted-email-fields'); fields.hidden=true; fields.disabled=true; const form=document.querySelector('#new-change-form'); form.extractedFile=null; document.querySelector('#new-change-error').textContent=''; document.querySelector('#pdf-extraction-status').textContent='Archivo seleccionado. Pulsa Leer PDF para revisar sus datos.'; }
  if (event.target.id === 'client-picker') { selectedProjectId = event.target.value; selectedDocumentId = null; renderWorkspace(); }
});
document.addEventListener('click', event => {
  if (event.target.closest('[data-use-demo-email]')) useDemoEmail();
  if (event.target.closest('[data-extract-email]')) readEmailPdf();
  if (event.target.closest('[data-new-change]')) openNewChange();
  const localRequest = event.target.closest('[data-local-request]');
  if (localRequest) openFlow(localRequest.dataset.requestProject, localRequest.dataset.localRequest);
  const pdfButton = event.target.closest('[data-preview-pdf]');
  if (pdfButton) previewPdf(pdfButton.dataset.previewPdf);
  const sourceButton = event.target.closest('[data-open-source]');
  if (sourceButton) {
    const doc = knowledgeDocuments.find(item => item.id === sourceButton.dataset.openSource && item.projectId === selectedProjectId);
    if (doc) { selectedDocumentId = doc.id; previewPdf(doc.id); }
  }
  const filter = event.target.closest('[data-history-filter]');
  if (filter) { historyFilter = filter.dataset.historyFilter; renderClientActivity(document.querySelector('#client-panel')); }
  const tab = event.target.closest('[data-client-tab]');
  if (tab) goToClientTab(tab.dataset.clientTab);
  if (event.target.closest('[data-start-conversation]')) goToClientTab('asistente');
  const question = event.target.closest('[data-question]');
  if (question) {
    const intent = question.dataset.question;
    const text = intent === 'client-message' ? cases[selectedProjectId].message : intent === 'terms' ? '¿Qué acordamos?' : '¿Qué sabemos del pago?';
    document.querySelector('#chat-input').value = text;
    document.querySelector('#chat-input').focus();
  }
});
document.addEventListener('submit', async event => {
  if (!['chat-form','new-change-form'].includes(event.target.id)) return;
  event.preventDefault();
  if (event.target.id === 'chat-form') {
    const input = document.querySelector('#chat-input');
    const text = input.value.trim();
    if (!text) return;
    askAssistant(text); input.value = ''; input.focus();
  }
  if (event.target.id === 'new-change-form') {
    const form=event.target;
    if (form.dataset.busy || form.dataset.reading || !form.checkValidity()) return;
    const projectId=selectedProjectId;
    const subject=document.querySelector('#change-subject').value.trim() || document.querySelector('#change-email-file').files[0]?.name || 'Solicitud de cambio';
    const sender=document.querySelector('#change-sender').value.trim();
    const emailDate=document.querySelector('#change-email-date').value;
    const message=document.querySelector('#change-message').value.trim();
    const file=document.querySelector('#change-email-file').files[0];
    const error=document.querySelector('#new-change-error');
    if (!message || !file) return;
    if (form.extractedFile!==file) { error.textContent='Primero lee este PDF y confirma los datos extraídos.'; return; }
    if (!/\.pdf$/i.test(file.name) || (file.type && file.type!=='application/pdf') || !file.size || file.size>10*1024*1024) { error.textContent='Selecciona un PDF de hasta 10 MB.'; return; }
    form.dataset.busy='true';
    try {
      if (await file.slice(0,5).text() !== '%PDF-') { error.textContent='El archivo no tiene una cabecera PDF válida.'; return; }
      if (selectedProjectId!==projectId || !form.isConnected) return;
      const request=registerLocalChange({projectId,subject,sender,emailDate,message,filename:file.name,pdfUrl:URL.createObjectURL(file)});
      renderWorkspace(); openFlow(projectId,request.id);
    } catch { error.textContent='No pudimos leer el archivo. Intenta seleccionarlo otra vez.'; }
    finally { delete form.dataset.busy; }
  }
});
// El asistente general tiene su propio historial. No inyecta turnos en los chats de clientes.
let generalScope = 'general';
const generalHistories = new Map();
const generalPanel = document.querySelector('#general-assistant');
const generalToggle = document.querySelector('#general-assistant-toggle');
const generalSelector = document.querySelector('#general-scope');
generalSelector.innerHTML = '<option value="general">Todo mi estudio · resumen general</option>' + clientRecords.map(client => `<option value="${client.projectId}">${client.name} · ${projects.find(project => project.id === client.projectId).name}</option>`).join('');
function resetGeneralAssistant() {
  generalHistories.clear();
  generalHistories.set('general', [{role:'assistant', text:'Hola, soy tu asistente general de Trato. Aquí puedes consultar una vista de tu estudio, orientarte entre tus clientes o escribir una pregunta libre.\n\nElige un cliente para acotar el contexto. Los chats de cada proyecto conservan su propio historial. Esta es una demo con respuestas predefinidas.'}]);
  for (const project of projects) generalHistories.set(project.id, [{role:'assistant', text:`Esta conversación del asistente general está centrada en ${project.client.split(' · ')[0]} / ${project.name}. No incorpora mensajes de los otros clientes ni modifica el chat privado de este proyecto. Las respuestas son de ejemplo.`}]);
  if (!generalPanel.hidden) renderGeneralMessages();
}
resetGeneralAssistant();
function renderGeneralMessages() {
  const target = document.querySelector('#general-messages');
  target.innerHTML = generalHistories.get(generalScope).map(message => `<article class="chat-message ${message.role}"><span class="message-author">${message.role === 'user' ? 'Tú' : '✳ Trato · ejemplo'}</span><p>${escapeHTML(message.text)}</p>${message.projects ? message.projects.map(id => {const project = projects.find(item => item.id === id);return `<button class="source-citation" type="button" data-general-project="${id}">${project.client.split(' · ')[0]} · Abrir proyecto ↗</button>`;}).join('') : ''}</article>`).join('');
  target.scrollTop = target.scrollHeight;
}
function setGeneralOpen(open) {
  generalPanel.hidden = !open;
  generalToggle.setAttribute('aria-expanded', String(open));
  generalToggle.setAttribute('aria-label', open ? 'Cerrar asistente general de Trato' : 'Abrir asistente general de Trato');
  if (open) { renderGeneralMessages(); document.querySelector('#general-input').focus(); }
  else generalToggle.focus();
}
function answerGeneral(text, intent = null) {
  const history = generalHistories.get(generalScope);
  history.push({role:'user', text});
  const scopeProjects = generalScope === 'general' ? projects : projects.filter(project => project.id === generalScope);
  const summary = scopeProjects.map(project => `${project.client.split(' · ')[0]} · ${project.name}\n${typeLabels[project.type]} · ${money(project.amount)} · ${outcomes.get(project.id) || project.status}`).join('\n\n');
  if (intent === 'summary') {
    history.push({role:'assistant', text:`Este es el resumen de los casos ficticios del contexto seleccionado:\n\n${summary}\n\nSon datos de la demo, no saldos consultados a PayPal.`, projects:scopeProjects.map(project => project.id)});
  } else if (intent === 'next') {
    const nextProject = scopeProjects.find(project => project.id === 'SP-002') || scopeProjects[0];
    const explanation = nextProject.id === 'SP-002' ? 'En el ejemplo, este cobro de US$450 lleva seis días de atraso. Puedes revisar el mensaje del cliente y preparar un seguimiento.' : `Revisa la solicitud de ${typeLabels[nextProject.type].toLowerCase()} del ejemplo antes de proponer una acción.`;
    history.push({role:'assistant', text:`Sugerencia predefinida para ${nextProject.client.split(' · ')[0]} / ${nextProject.name}:\n\n${explanation}\n\nTú decides si es la prioridad. No ejecuté ninguna operación.`, projects:[nextProject.id]});
  } else if (intent === 'help') {
    history.push({role:'assistant', text:'Puedo ayudarte a explorar los tres recorridos: cambios y extras, cobros pendientes y cancelaciones/reembolsos.\n\nEn la versión conectada podrás hacer preguntas libres sobre tus acuerdos y documentos. En esta demo, las sugerencias muestran respuestas predefinidas y las demás preguntas solo se registran.\n\nLa vista general identifica cada cliente; al elegir uno, el contexto y este historial quedan acotados a su proyecto. Los chats del proyecto permanecen separados.'});
  } else {
    history.push({role:'assistant', text:'Registré tu pregunta en el contexto seleccionado. Todavía no hay un modelo conectado para responder preguntas libres. Usa «Mi resumen», «¿Qué reviso primero?» o «¿Cómo me ayudas?» para explorar las respuestas de ejemplo. No analicé tu pregunta ni ejecuté acciones.'});
  }
  renderGeneralMessages();
}
generalToggle.addEventListener('click', () => setGeneralOpen(generalPanel.hidden));
document.querySelector('#general-assistant-close').addEventListener('click', () => setGeneralOpen(false));
generalSelector.addEventListener('change', event => {
  generalScope = event.target.value;
  document.querySelector('#general-input').value = '';
  document.querySelector('#general-scope-note').textContent = generalScope === 'general' ? 'Vista transversal con cada dato identificado por cliente. Los chats de proyecto permanecen separados.' : 'Contexto de un solo cliente y proyecto. No se incorporan conversaciones de otros clientes.';
  renderGeneralMessages();
});
generalPanel.addEventListener('click', event => {
  const question = event.target.closest('[data-general-question]');
  if (question) {
    const intent = question.dataset.generalQuestion;
    answerGeneral({summary:'Muéstrame mi resumen.',next:'¿Qué reviso primero?',help:'¿Cómo me ayudas?'}[intent], intent);
  }
  const projectButton = event.target.closest('[data-general-project]');
  if (projectButton) {
    selectedProjectId = projectButton.dataset.generalProject;
    selectedDocumentId = null;
    selectedClientTab = 'asistente';
    setGeneralOpen(false);
    if (currentView === 'clientes') renderWorkspace(); else location.hash = 'clientes';
  }
});
document.querySelector('#general-chat-form').addEventListener('submit', event => {
  event.preventDefault();
  const input = document.querySelector('#general-input');
  const text = input.value.trim();
  if (!text) return;
  answerGeneral(text); input.value = ''; input.focus();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !generalPanel.hidden && !dialog.open) { setGeneralOpen(false); }
});
window.addEventListener('hashchange', renderView);
renderView();

const pdfPreview = document.querySelector('#pdf-preview');
document.querySelector('#pdf-preview-close').addEventListener('click', () => pdfPreview.close());
pdfPreview.addEventListener('close', () => { document.querySelector('#pdf-preview-frame').src = 'about:blank'; });

function setSidebarCollapsed(collapsed) {
  document.querySelector('#trato-sidebar').hidden=collapsed;
  document.querySelector('.shell').classList.toggle('sidebar-is-hidden',collapsed);
  const toggle=document.querySelector('#sidebar-toggle');
  toggle.setAttribute('aria-expanded',String(!collapsed));
  toggle.setAttribute('aria-label',collapsed?'Mostrar barra lateral':'Ocultar barra lateral');
  toggle.setAttribute('title',collapsed?'Mostrar barra lateral':'Ocultar barra lateral');
}
document.querySelector('#sidebar-toggle').addEventListener('click',()=>{
  setSidebarCollapsed(!document.querySelector('#trato-sidebar').hidden);
});

window.addEventListener('trato-payment-preview-updated', event=>{
  const {key,status}=event.detail || {};
  if(!['draft','pending_approval','pending','completed'].includes(status))return;
  for(const [id,draft] of savedChangeDrafts){
    const candidate=localChangeRequests.some(request=>request.id===id)?id:`${id}-${draft.returnedDocumentId}`;
    if(candidate===key){
      draft.paymentPreviewStatus=status;
      if(changeDraft && activeProject && changePaymentKey()===key){changeDraft.paymentPreviewStatus=status;if(stage===6&&dialog.open)renderStage();}
    }
  }
  persistChangeWorkspace();
});

window.TratoCloud?.attach(() => renderView());
