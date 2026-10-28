import {uiText,uiLocale} from './i18n.mjs';
import {icon} from './icons.mjs';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=minor=>new Intl.NumberFormat(uiLocale(),{style:'currency',currency:'USD'}).format(minor/100);
const stages={review_refund_case:0,clarify_refund:1,review_refund:1,send_refund:2,refund_client_decision:3,authorize_refund:4,refund_provider_result:4};
const labels=[uiText("Solicitud"),uiText("Análisis y propuesta"),uiText("Revisar y enviar"),uiText("Respuesta"),uiText("Devolución")];
const storageKey='trato:refund-simulation:current';
let dialog,view,thread,fixture='partial',result,error='',busy=false,edit=false,feedback=false,focusBack;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function terms(){return result?.revisions?.at(-1)?.proposal.terms||uiText("Se entregan las propuestas iniciales y se cierra el trabajo pendiente. La devolución corresponde al anticipo no reconocido como trabajo realizado.");}
function saved(){try{return JSON.parse(sessionStorage.getItem(storageKey)||'null');}catch{return null;}}
function inputMinor(value){if(!/^\d{1,3}(?:\.\d{1,2})?$/.test(value))throw Error(uiText("Escribe un importe entre 0 y 300 USD, con hasta dos decimales."));const [a,b='']=value.split('.');const minor=Number(a)*100+Number(b.padEnd(2,'0'));if(minor>30000)throw Error(uiText("El trabajo reconocido no puede superar el pago de este ejemplo."));return minor;}
function calc(work){const c=result.case,refund=Math.max(c.gross_minor-work-c.previous_refunds_minor,0);return {gross_minor:c.gross_minor,original_fee_minor:c.fee_minor,original_net_minor:c.gross_minor-c.fee_minor,previous_refunds_minor:c.previous_refunds_minor,recognized_work_minor:work,proposed_refund_minor:refund,net_after_refund_minor:c.gross_minor-c.fee_minor-c.previous_refunds_minor-refund};}
function breakdown(c){return `<dl class="refund-breakdown"><div><dt>${uiText("Pago original")}</dt><dd>${money(c.gross_minor)}</dd></div><div><dt>${uiText("Comisión original")}</dt><dd>${money(c.original_fee_minor)}</dd></div><div><dt>${uiText("Neto recibido por este cobro")}</dt><dd>${money(c.original_net_minor)}</dd></div>${c.previous_refunds_minor?`<div><dt>${uiText("Devuelto anteriormente")}</dt><dd>${money(c.previous_refunds_minor)}</dd></div>`:''}<div><dt>${uiText("Trabajo reconocido en la propuesta")}</dt><dd>${money(c.recognized_work_minor)}</dd></div><div class="refund-total"><dt>${uiText("Propuesta para el cliente")}</dt><dd>${money(c.proposed_refund_minor)}</dd></div><div><dt>${uiText("Neto de este cobro tras la devolución")}</dt><dd>${money(c.net_after_refund_minor)}</dd></div></dl><p class="refund-fine">${uiText("La comisión de USD 10 es un importe ficticio de este caso, no una tarifa de PayPal. Se muestra como costo del vendedor y no se descuenta de la devolución propuesta al cliente.")}</p>`;}
// Read-only projection of this checkpoint. It never queries another example or writes business state.
export function buildRefundEvidenceGraph(state){
 const nodes=[],edges=[],ids=new Set();
 const add=(id,title,detail)=>{if(ids.has(id))throw Error(uiText("Identidad duplicada en las conexiones del caso."));ids.add(id);nodes.push({id,title,detail});return id;};
 const link=(from,to,label,quote='')=>{if(!ids.has(from)||!ids.has(to))throw Error(uiText("Falta una fuente de las conexiones del caso."));edges.push({from,to,label,quote});};
 const payment=add('payment:'+state.case.capture_id,uiText("Pago original"),`USD ${(state.case.gross_minor/100).toFixed(2)} · ${state.case.payment_status}`);
 const sourceIds=new Map();
 for(const source of state.sources){const id=add('source:'+source.id,source.title,source.text);sourceIds.set(source.id,id);}
 for(const source of state.sources.filter(s=>s.kind==='request'))link(sourceIds.get(source.id),payment,uiText("Solicita revisar este pago"));
 const policies=new Map();
 const addPolicy=policy=>{
  // A saved revision retains its own policy text/date, even when the current catalogue changes.
  const id='policy:'+JSON.stringify([policy.id,policy.url,policy.reviewed_at,policy.summary,policy.scope]);
  if(!policies.has(id)){add(id,policy.title,`${policy.summary} · ${policy.scope} ${uiText("· Consultado:")} ${policy.reviewed_at}`);policies.set(id,true);}
  return id;
 };
 for(const revision of state.revisions){
  const id=add('revision:'+revision.snapshot_id,`${uiText("Propuesta de cierre v")}${revision.version}`,revision.proposal.terms);
  link(id,payment,uiText("Propone devolver sobre este pago"));
  for(const ref of revision.source_refs){
   const source=state.sources.find(s=>s.id===ref.source_id);
   if(!source||typeof ref.quote!=='string'||!ref.quote||!source.text.includes(ref.quote))throw Error(uiText("La cita de la propuesta no coincide con su fuente."));
   link(id,sourceIds.get(ref.source_id),uiText("Utiliza esta fuente"),ref.quote);
  }
  for(const policy of revision.policy_refs)link(id,addPolicy(policy),uiText("Consulta condiciones del proveedor"));
  if(revision.feedback_document_id)link(id,sourceIds.get(revision.feedback_document_id),uiText("Responde a ajustes del cliente"));
  for(const [eventName,label] of [['revision_sent',uiText("Envío registrado")],['client_accept',uiText("Aceptación registrada")],['client_reject',uiText("Rechazo registrado")],['client_request_revision',uiText("Ajustes solicitados")],['refund_authorized',uiText("Devolución autorizada")]]){
   const event=state.events.find(e=>e.event===eventName&&e.snapshot_id===revision.snapshot_id);
   if(event){const eventId=add(eventName+':'+revision.snapshot_id,`${label} · v${revision.version}`,event.at);link(eventId,id,uiText("Corresponde a esta versión"));}
  }
 }
 if(state.refund){
  if(state.refund.capture_id!==state.case.capture_id)throw Error(uiText("La devolución no corresponde al pago original."));
  const id=add('refund:'+state.refund.id,uiText("Devolución"),`${state.refund.currency} ${(state.refund.amount_minor/100).toFixed(2)} · ${state.refund.status} ${uiText("· Resultado simulado")}`);
  link(id,payment,uiText("Devuelve parte de este pago"));
  link(id,'revision:'+state.refund.snapshot_id,uiText("Ejecuta el importe de esta versión"));
 }
 return {nodes,edges};
}
function evidenceMap(){
 try{
  const graph=buildRefundEvidenceGraph(result),byId=new Map(graph.nodes.map(n=>[n.id,n]));
  return `<details class="refund-connections"><summary>${icon('eye')}${uiText("Conexiones de esta devolución")}<span class="refund-source-chevron">${icon('chevron-down')}</span></summary><p>${uiText("Relaciones del recorrido guardado. Abre un elemento para consultar qué lo respalda.")}</p><ul aria-label="${uiText("Mapa de respaldo de la devolución")}">${graph.nodes.map(node=>`<li><details><summary>${esc(node.title)}</summary><p>${esc(node.detail)}</p>${graph.edges.filter(edge=>edge.from===node.id).map(edge=>`<div class="refund-connection-edge"><span>${esc(edge.label)} ${icon('arrow-right')}</span><strong>${esc(byId.get(edge.to).title)}</strong>${edge.quote?`<blockquote>${esc(edge.quote)}</blockquote>`:''}</div>`).join('')}</details></li>`).join('')}</ul><p class="refund-fine">${uiText("Este mapa pertenece a la simulación actual; todavía no consulta Neo4j.")}</p></details>`;
 }catch(issue){return `<p class="refund-error" role="alert">${uiText("No se pudo construir el mapa de respaldo:")} ${esc(issue.message)}</p>`;}
}
function sources(){if(!result)return '';
 return `<aside class="refund-evidence" aria-label="${uiText("Fuentes del caso")}"><h3>${uiText("En qué nos basamos")}</h3>${evidenceMap()}<p>${uiText("Proyecto e información del proveedor, con su procedencia separada.")}</p><h4>${uiText("Documentos del proyecto · ejemplo")}</h4>${result.sources.map(s=>`<details><summary>${icon('file-text')}${esc(s.title)}<span class="refund-source-chevron">${icon('chevron-down')}</span></summary><blockquote>${esc(s.text)}</blockquote></details>`).join('')}<h4>${uiText("Fuentes oficiales de PayPal")}</h4>${result.policy_sources.map(s=>`<details><summary>${icon('arrow-up-right')}${esc(s.title)}<span class="refund-source-chevron">${icon('chevron-down')}</span></summary><p>${esc(s.summary)}</p><small>${esc(s.scope)} ${uiText("· Consultado:")} ${esc(s.reviewed_at)}</small><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${uiText("Abrir fuente oficial")} ${icon('arrow-up-right')}</a></details>`).join('')}<p class="refund-fine">${uiText("Las reglas del ejemplo corresponden a Perú y Payments API v2. No se aplican automáticamente a otros países o productos. No estimamos conversiones ni plazos de abono.")}</p></aside>`;
}
function reviewForm(action='approve_refund_proposal',work=result.case.recognized_work_minor??20000){return `<form data-refund-form="${action}"><label>${uiText("Trabajo reconocido en USD")}<input name="work" value="${(work/100).toFixed(2)}" inputmode="decimal" required autocomplete="off"></label><p class="refund-fine">${uiText("Este valor debe ser revisado por ambas partes; el sistema no lo deduce de un porcentaje de tareas.")}</p><div data-refund-estimate>${breakdown(calc(work))}</div><label>${uiText("Condiciones del cierre")}<textarea name="terms" rows="4" required maxlength="4000">${esc(terms())}</textarea></label><p class="refund-fine">${uiText("Guardar y simular envío conserva la propuesta y registra su envío en este recorrido. Revisa el importe y las condiciones antes de continuar.")}</p><div class="refund-actions"><button class="button" type="submit" name="intent" value="send">${uiText("Guardar y simular envío")} ${icon('send')}</button><button class="button secondary" type="submit" name="intent" value="draft">${action==='edit_draft'?uiText("Guardar borrador revisado"):uiText("Guardar propuesta de cierre")}</button></div>${action==='edit_draft'?("<button class=\"text-button\" type=\"button\" data-refund-action=\"cancel-edit\">"+uiText("Cancelar edición")+"</button>"):''}</form>`;}
function main(){
 if(!result)return `<span class="eyebrow">${uiText("ELIGE UN CASO DE PRUEBA")}</span><h2>${uiText("Del pedido de devolución al cierre acordado")}</h2><p>${uiText("Revisa las fuentes, prepara una propuesta y recorre su aceptación y devolución. Los datos pertenecen a Estudio Norte, un proyecto ficticio separado del que tienes abierto.")}</p><label>${uiText("Caso")}<select data-refund-scenario><option value="partial">${uiText("Devolución parcial · USD 300 pagados, USD 200 de trabajo")}</option><option value="unclear">${uiText("Falta acordar el valor del trabajo")}</option><option value="previous_refund">${uiText("Existe una devolución parcial anterior")}</option><option value="expired">${uiText("Pago fuera del plazo de 180 días")}</option></select></label><button class="button" data-refund-action="start">${uiText("Comenzar recorrido")} ${icon('arrow-right')}</button>${saved()?("<button class=\"text-button\" data-refund-action=\"restore\">"+uiText("Continuar recorrido guardado")+"</button>"):''}`;
 const pending=result.pending,stage=pending?.stage,c=result.case,revision=result.revisions.at(-1);
 if(edit)return `<span class="eyebrow">${uiText("BORRADOR V")}${revision.version}</span><h2>${uiText("Ajusta la propuesta antes de enviarla")}</h2>${reviewForm('edit_draft',revision.proposal.recognized_work_minor)}`;
 if(stage==='review_refund_case')return `<span class="eyebrow">${uiText('1 · SOLICITUD REGISTRADA')}</span><h2>${uiText("¿Qué está pidiendo el cliente?")}</h2><blockquote>${esc(result.sources.find(s=>s.kind==='request').text)}</blockquote><div class="refund-case"><strong>${esc(c.client)} · ${esc(c.project)}</strong><span>${uiText("Pago original:")} ${money(c.gross_minor)} · ${esc(c.paid_on)}</span><span>${uiText("País del ejemplo: Perú · Bienes y servicios")}</span><span>${uiText("Estado del pago original: Pagado")}</span></div><p>${uiText("Revisa el acuerdo y la respuesta sobre el trabajo realizado en las fuentes. Confirmar esta revisión no acepta la cancelación ni devuelve dinero.")}</p><button class="button" data-refund-action="confirm_case">${uiText("Revisar análisis y condiciones")} ${icon('arrow-right')}</button>`;
 if(stage==='clarify_refund')return `<span class="eyebrow">${uiText("2 · FALTA INFORMACIÓN")}</span><h2>${uiText("Primero aclaremos el valor del trabajo")}</h2><p>${uiText("No hay un importe reconocido en las fuentes del ejemplo. Sin ese dato no prepararemos una propuesta automática.")}</p><form data-refund-form="clarify"><label>${uiText("Valor propuesto del trabajo en USD")}<input name="work" inputmode="decimal" required></label><label>${uiText("Aclaración y respaldo del ejemplo")}<textarea name="notes" required minlength="3" maxlength="2000" rows="3"></textarea></label><button type="submit" class="button">${uiText("Registrar aclaración y revisar")}</button></form>`;
 if(stage==='review_refund')return `<span class="eyebrow">${uiText("2 · ANÁLISIS DEL CASO")}</span><h2>${uiText("Lo acordado y lo que permite PayPal")}</h2><p>${esc(result.analysis.summary)}</p>${result.analysis.client_feedback?`<blockquote><strong>${uiText("Ajustes solicitados por el cliente")}</strong><p>${esc(result.analysis.client_feedback)}</p></blockquote>`:''}<ul class="refund-findings"><li>${uiText("El pago del caso tiene")} ${result.analysis.days_since_payment} ${uiText("días, dentro del plazo de 180 días documentado para este ejemplo.")}</li><li>${uiText("La devolución se vincula a la captura original. No puede superar lo que queda por devolver.")}</li><li>${uiText("La comisión original se muestra aparte. El importe del trabajo y el cierre requieren revisión de ambas partes.")}</li></ul><p class="refund-fine">${uiText("Lectura preparada con datos del caso; todavía no interviene un agente.")}</p>${reviewForm()}`;
 if(stage==='send_refund')return `<span class="eyebrow">3 · PROPUESTA V${revision.version}</span><h2>${uiText("Revisa antes de enviarla")}</h2>${breakdown(revision.calculation)}<div class="refund-terms"><strong>${uiText("Condiciones")}</strong><p>${esc(revision.proposal.terms)}</p></div><div class="refund-actions"><button class="button" data-refund-action="simulate_send">${uiText("Simular envío al cliente")} ${icon('send')}</button><button class="button secondary" data-refund-action="edit">${uiText("Editar borrador")}</button></div>`;
 if(stage==='refund_client_decision')return `<span class="eyebrow">${uiText('4 · ESPERANDO RESPUESTA')}</span><h2>${uiText("El cliente revisa la propuesta v")}${revision.version}</h2><p>${uiText("Importe propuesto:")} <strong>${money(revision.proposal.refund_minor)}</strong>${uiText(". Esta versión necesita su propia aceptación.")}</p><div class="refund-terms"><p>${esc(revision.proposal.terms)}</p></div><div class="refund-actions"><button class="button" data-refund-action="accept">${uiText("Simular aceptación")}</button><button class="button secondary" data-refund-action="feedback">${uiText("El cliente pide ajustes")}</button><button class="text-button" data-refund-action="reject">${uiText("Simular rechazo")}</button></div>${feedback?("<form data-refund-form=\"feedback\"><label>"+uiText("Qué pide cambiar el cliente")+"<textarea name=\"notes\" required minlength=\"3\" maxlength=\"2000\" rows=\"3\"></textarea></label><p class=\"refund-fine\">"+uiText("Se conserva como una respuesta de ejemplo, sin atribuirle una firma ni un PDF real.")+"</p><button type=\"submit\" class=\"button\">"+uiText("Registrar ajustes y preparar nueva versión")+"</button></form>"):''}`;
 if(stage==='authorize_refund')return `<span class="eyebrow">${uiText('5 · PROPUESTA ACEPTADA')}</span><h2>${uiText("Autoriza la devolución de esta versión")}</h2>${breakdown(result.calculation)}<p>${uiText("La aprobación del cierre no ejecuta la devolución. Es una operación aparte, vinculada al pago original y al importe aceptado de v")}${revision.version}.</p><button class="button" data-refund-action="authorize_simulated_refund">${uiText("Autorizar devolución simulada")} ${icon('undo-2')}</button>`;
 if(stage==='refund_provider_result')return `<span class="eyebrow">${uiText('5 · REEMBOLSO PENDIENTE')}</span><h2>${uiText("Falta confirmar el resultado de la operación")}</h2><p>${uiText("Importe autorizado:")} <strong>${money(revision.proposal.refund_minor)}</strong>. ${result.refund?.status==='PENDING'?uiText("El resultado de prueba sigue en PENDING: todavía no está completado."):uiText("Elige una respuesta del proveedor para probar el recorrido.")}</p><div class="refund-actions"><button class="button" data-refund-action="simulate_completed">${uiText("Simular resultado completado")}</button><button class="button secondary" data-refund-action="simulate_pending">${uiText("Simular resultado pendiente")}</button><button class="text-button" data-refund-action="simulate_failed">${uiText("Simular fallo")}</button></div><p class="refund-fine">${uiText("En la integración conectada este estado sólo podrá confirmarlo el backend a partir de PayPal.")}</p>`;
 if(result.status==='blocked')return `<span class="eyebrow">${uiText("REQUIERE REVISIÓN")}</span><h2>${uiText("El pago supera el plazo de este recorrido")}</h2><p>${uiText("En la fecha del ejemplo, el pago tiene")} ${result.analysis.days_since_payment} ${uiText("días. No habilitamos la ejecución de un reembolso por esta vía. Consulta la fuente de PayPal y revisa el caso; esto no decide derechos contractuales.")}</p>`;
 return `<span class="eyebrow">${uiText("RESULTADO DEL RECORRIDO")}</span><h2>${esc(uiText(result.business_status))}</h2>${result.calculation?breakdown(result.calculation):''}${result.refund?`<div class="refund-outcome" role="status"><strong>${esc(result.refund.status)}</strong><p>${result.refund.status==='COMPLETED'?uiText("Resultado completado exclusivamente en esta simulación."): uiText("La devolución no se completó. No se cambia a otra operación ni se registra un éxito.")}</p><small>${esc(result.refund.id)}</small></div>`:''}<p>${uiText("El pago original conserva su registro. La devolución y las versiones del cierre se consultan por separado.")}</p>`;
}
function render(){
 const active=stages[result?.pending?.stage]??(result?4:0);
 view.innerHTML=`<header class="refund-preview-header"><div><span class="eyebrow">${uiText('TRATO · FLUJO SIMULADO')}</span><strong>${uiText("Devolución y cierre acordado")}</strong></div><button class="cloud-icon-button" data-refund-action="close" aria-label="${uiText("Cerrar devolución simulada")}" title="${uiText("Cerrar devolución simulada")}">${icon('x')}</button></header><p class="refund-preview-mode" id="refund-preview-mode">${uiText("Caso de ejemplo independiente. Sin agente, envíos ni operaciones PayPal reales.")}</p><ol class="refund-stepper" aria-label="${uiText("Etapas de la devolución")}">${labels.map((label,index)=>`<li ${index===active?'aria-current="step"':''}><span>${index+1}</span>${label}</li>`).join('')}</ol><div class="refund-preview-layout"><main class="refund-main" aria-busy="${busy}">${error?`<p class="refund-error" role="alert">${esc(error)}</p><button class="text-button" data-refund-action="restore">${uiText("Consultar recorrido guardado")}</button>`:''}${busy?("<p class=\"refund-busy\" role=\"status\">"+uiText("Guardando el paso del recorrido…")+"</p>"):''}${main()}${result?.revisions.length?`<details class="refund-versions"><summary>${uiText("Versiones de la propuesta ·")} ${result.revisions.length}</summary>${[...result.revisions].reverse().map(r=>`<article><strong>${uiText("Versión")} ${r.version} · ${money(r.proposal.refund_minor)}</strong><p>${esc(r.proposal.terms)}</p><small>${r.draft_sequence} ${r.draft_sequence===1?uiText("borrador guardado"):uiText("borradores conservados")}</small></article>`).join('')}</details>`:''}${result?("<button class=\"text-button refund-restart\" data-refund-action=\"new\">"+uiText("Elegir otro caso de prueba")+"</button>"):''}</main>${sources()}</div>`;
 view.querySelectorAll('button:not([data-refund-action="close"]),input,textarea,select').forEach(el=>{el.disabled=busy;});
 const selector=view.querySelector('[data-refund-scenario]');if(selector)selector.value=fixture;
 dialog.scrollTop=0;
}
async function command(action,input){
 if(busy)return false;busy=true;error='';let completed=false;render();
 try{
  const message={type:'thread',schema_version:1,mode:'simulation',workflow:'manage_refund',thread_id:thread,event_id:crypto.randomUUID(),action,context:{},payload:action==='start'?{request_id:crypto.randomUUID(),fixture_id:fixture}:action==='resume'?{interrupt_id:result.pending.interrupt_id,input}: {}};
  const response=await fetch('/api/simulation/threads',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(message)});
  const operation=await response.json();if(!response.ok)throw Error(operation.error||uiText("No se pudo registrar el paso."));
  const deadline=Date.now()+24000;
  while(true){
   if(Date.now()>deadline)throw Error(uiText("No pudimos confirmar el resultado a tiempo. Consulta el recorrido antes de repetir una acción."));
   await pause(250);
   const check=await fetch(operation.status_url,{cache:'no-store'}),body=await check.json();
   if(check.status===202)continue;
   if(!check.ok)throw Error(body.error||uiText("La simulación no pudo continuar."));
   if(body.data?.mode!=='simulation'||body.data.workflow!=='manage_refund'||body.data.thread_id!==thread)throw Error(uiText("La respuesta no corresponde a este recorrido."));
   result=body.data.result;sessionStorage.setItem(storageKey,JSON.stringify({thread,fixture}));edit=false;feedback=false;completed=true;break;
  }
 }catch(issue){error=issue.message;}finally{busy=false;render();}
 return completed;
}
async function act(event){
 const button=event.target.closest('[data-refund-action]');if(!button)return;
 const action=button.dataset.refundAction;
 if(action==='close'){dialog.close();return;}if(busy)return;
 if(action==='start'){fixture=view.querySelector('[data-refund-scenario]').value;thread=crypto.randomUUID();result=null;await command('start');return;}
 if(action==='restore'){const old=saved();if(!old){error=uiText("No hay un recorrido guardado en esta sesión.");render();return;}thread=old.thread;fixture=old.fixture;await command('get');return;}
 if(action==='new'){result=null;edit=false;feedback=false;error='';render();return;}
 if(action==='edit'){edit=true;render();return;}if(action==='cancel-edit'){edit=false;render();return;}if(action==='feedback'){feedback=true;render();return;}
 await command('resume',{action});
}
async function submit(event){
 const form=event.target.closest('[data-refund-form]');if(!form)return;event.preventDefault();
 if(busy)return;
 const values=new FormData(form);let input;
 try{
  if(form.dataset.refundForm==='feedback')input={action:'request_revision',feedback_notes:values.get('notes'),feedback_document_id:crypto.randomUUID()};
  else if(form.dataset.refundForm==='clarify')input={action:'provide_clarification',recognized_work_minor:inputMinor(values.get('work')),notes:values.get('notes')};
  else input={action:form.dataset.refundForm,recognized_work_minor:inputMinor(values.get('work')),terms:values.get('terms')};
 }catch(issue){error=issue.message;const node=view.querySelector('[role="alert"]');if(node)node.textContent=error;else form.insertAdjacentHTML('afterbegin',`<p class="refund-error" role="alert">${esc(error)}</p>`);return;}
 const sendWithSave=event.submitter?.value==='send';
 const completed=await command('resume',input);
 if(sendWithSave&&completed){
  if(result.pending?.stage!=='send_refund'){error=uiText("El recorrido no está listo para enviar esta propuesta.");render();return;}
  await command('resume',{action:'simulate_send'});
 }
}
export async function openRefundPreview({returnFocus}={}){
 focusBack=returnFocus;
 if(!document.querySelector('link[data-refund-preview-css]')){const css=document.createElement('link');css.rel='stylesheet';css.href='/refund-preview.css';css.dataset.refundPreviewCss='';document.head.append(css);}
 if(!dialog){
  dialog=document.createElement('dialog');dialog.className='refund-preview';dialog.setAttribute('aria-label',uiText("Devolución y cierre acordado · simulación"));dialog.setAttribute('aria-describedby','refund-preview-mode');view=document.createElement('div');dialog.append(view);document.body.append(dialog);
  view.addEventListener('click',act);view.addEventListener('submit',submit);
  view.addEventListener('input',event=>{if(event.target.name!=='work'||!view.querySelector('[data-refund-estimate]'))return;try{view.querySelector('[data-refund-estimate]').innerHTML=breakdown(calc(inputMinor(event.target.value)));}catch{/* The submitted value is validated before any command. */}});
  dialog.addEventListener('close',()=>focusBack?.isConnected&&focusBack.focus());
 }
 render();if(!dialog.open)dialog.showModal();
}
