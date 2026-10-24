/* Executable local demo; no model, signature, email or payment provider is called. */
let workflowRun=null;
let workflowBusy=false;
const workflowDialog=document.createElement('dialog');
workflowDialog.className='workflow-dialog';
workflowDialog.setAttribute('aria-label','Flujo de prueba con LangGraph');
document.body.append(workflowDialog);
const wfEscape=value=>String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function workflowApi(payload){
  const response=await fetch('/api/workflows',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const data=await response.json();if(!response.ok)throw new Error(data.error || 'Error de flujo');return data;
}
function workflowHeader(title){return `<div class="upload-modal-header"><div><span class="eyebrow">LANGGRAPH · SIMULACIÓN LOCAL</span><h2>${wfEscape(title)}</h2></div><button type="button" class="close" data-wf-close aria-label="Cerrar flujo">×</button></div>`;}
function renderWorkflow(){
  const {state:s,pending:p}=workflowRun;
  const project=projects.find(item=>item.id===s.project_id);
  const final={blocked:'Pedido ajeno: flujo bloqueado',cancelled:'Solicitud cancelada',simulation_complete:'Recorrido de prueba completado',draft_rejected:'Borrador rechazado'};
  let html=workflowHeader(p?.title || final[s.status] || s.status);
  html+=`<p class="muted">${wfEscape(project?.name || s.project_id)} · ${wfEscape(s.subject)}</p><div class="workflow-storage-note">Estado guardado localmente en SQLite. Supabase aún no está conectado. IA, firmas, correo y pagos siguen sin integración.</div>`;
  if(!p){
    html+=`<div class="change-guard"><strong>${wfEscape(final[s.status] || s.status)}</strong><p>${s.status==='simulation_complete'?'La firma se simuló. El contrato original sigue vigente: no hubo firma real, nueva versión aceptada ni cobro.':'Puedes iniciar una nueva prueba con un pedido corregido. No se modificó el contrato.'}</p></div>`;
  }else{
    html+=`<p class="workflow-description">${wfEscape(p.description)}</p>`;
    if(p.step==='confirm')html+=`<div class="change-comparison"><article><span class="eyebrow">PEDIDO APORTADO</span><p>${wfEscape(s.message)}</p><small>${wfEscape(s.sender)} · ${wfEscape(s.email_date)}</small></article><article><span class="eyebrow">ACUERDO DE REFERENCIA · EJEMPLO</span><p>${wfEscape(s.agreement)}</p></article></div><div class="dialog-actions"><button class="button secondary" data-wf-answer='{"confirmed":false}'>Cancelar solicitud</button><button class="button" data-wf-answer='{"confirmed":true}'>Confirmar datos →</button></div>`;
    if(p.step==='pertinence')html+=`<div class="workflow-choices"><button class="button" data-wf-answer='{"relation":"matches"}'>Corresponde al proyecto</button><button class="button secondary" data-wf-answer='{"relation":"unclear"}'>Necesita aclaración</button><button class="button secondary" data-wf-answer='{"relation":"unrelated"}'>Es ajeno: bloquear</button></div>`;
    if(p.step==='clarification')html+=`<form data-wf-form="clarification"><label class="field" for="wf-message">Aclara o corrige el pedido</label><textarea id="wf-message" name="message" minlength="10" maxlength="6000" required rows="5">${wfEscape(s.message)}</textarea><button class="button">Volver a confirmar →</button></form>`;
    if(p.step==='analysis')html+=`<article class="change-finding"><strong>Análisis simulado, no generado por IA</strong><p>${wfEscape(s.analysis.conclusion)}</p><span class="eyebrow">FUENTES RELACIONADAS</span><p>Acuerdo: ${wfEscape(s.agreement_id)}<br>Solicitud: ${wfEscape(s.request_id)}</p><span class="eyebrow">DATOS QUE FALTAN</span><ul>${s.analysis.missing.map(item=>`<li>${wfEscape(item)}</li>`).join('')}</ul></article><div class="dialog-actions"><button class="button" data-wf-answer='{"reviewed":true}'>Definir alternativa de prueba →</button></div>`;
    if(p.step==='proposal')html+=`<form data-wf-form="proposal"><label class="field" for="wf-option">Alternativa</label><select id="wf-option" name="option" class="context-box"><option value="extra">Ampliar el alcance</option><option value="swap">Intercambiar entregables sin adicional</option><option value="phase">Separar en fases</option></select><label class="field" for="wf-scope">Qué se agrega, sustituye o entrega en otra fase</label><textarea id="wf-scope" name="scope" minlength="10" maxlength="2000" required rows="4"></textarea><div class="change-form-grid"><div><label class="field" for="wf-amount">Adicional · USD</label><input id="wf-amount" name="amount" type="number" min="0" max="100000" step="0.01" required class="context-box"></div><div><label class="field" for="wf-days">Días adicionales</label><input id="wf-days" name="days" type="number" min="0" max="365" step="1" required class="context-box"></div></div><label class="field" for="wf-terms">Condiciones propuestas</label><textarea id="wf-terms" name="terms" maxlength="2000" rows="2"></textarea><div class="dialog-actions"><button class="button">Preparar adenda de prueba →</button></div></form>`;
    if(p.step==='signature')html+=`<article class="change-addendum"><span class="badge pending">Sin firma real</span><h3>Adenda · borrador</h3><p>${wfEscape(s.adenda.scope)}</p><dl><dt>Adicional</dt><dd>USD ${wfEscape(s.adenda.amount)}</dd><dt>Días adicionales</dt><dd>${s.adenda.days}</dd><dt>Condiciones</dt><dd>${wfEscape(s.adenda.terms || 'Por revisar')}</dd><dt>Motivo</dt><dd>${wfEscape(s.adenda.reason)}</dd></dl></article><div class="dialog-actions"><button class="button secondary" data-wf-answer='{"signed":false}'>Simular rechazo</button><button class="button" data-wf-answer='{"signed":true}'>Simular firma de ambas partes</button></div>`;
  }
  html+='<p id="workflow-error" role="alert"></p><small>Simulación ejecutada por un grafo real. Cerrar pausa la interacción; el estado permanece guardado para esta sesión del navegador.</small>';
  workflowDialog.innerHTML=html;
}
async function workflowAction(task){
  if(workflowBusy)return;
  workflowBusy=true;
  try{await task();}catch(error){const target=workflowDialog.querySelector('#workflow-error');if(target)target.textContent=error.message;else workflowDialog.innerHTML=workflowHeader('No se pudo abrir el flujo')+`<p role="alert">${wfEscape(error.message)}</p>`;}
  finally{workflowBusy=false;}
}
async function resumeWorkflow(value){
  const data=await workflowApi({action:'resume',run_id:workflowRun.run_id,expected_step:workflowRun.pending.step,value});workflowRun=data;renderWorkflow();
}
document.addEventListener('click',event=>{
  const start=event.target.closest('[data-start-workflow]');
  const saved=event.target.closest('[data-saved-workflows]');
  const demo=event.target.closest('[data-start-demo-workflow]');
  if(!start && !saved && !demo)return;
  workflowAction(async()=>{
    workflowDialog.innerHTML=workflowHeader('Abriendo el flujo…')+'<p>Consultando el motor local.</p>';
    if(!workflowDialog.open)workflowDialog.showModal();
    if(start){
      const request=localChangeRequests.find(item=>item.id===start.dataset.startWorkflow);
      if(!request)throw new Error('No se encontró la solicitud local.');
      workflowRun=await workflowApi({action:'create',input:{project_id:request.projectId,request_id:request.id,subject:request.subject,message:request.message,sender:request.sender,email_date:request.emailDate}});renderWorkflow();
    }else if(demo){
      const projectId=demo.dataset.startDemoWorkflow;
      workflowRun=await workflowApi({action:'create',input:{project_id:projectId,request_id:`demo-${projectId}`,subject:'Solicitud de cambio · caso ficticio',message:cases[projectId].message,sender:'cliente@example.com',email_date:'2026-10-14'}});renderWorkflow();
    }else{
      const data=await workflowApi({action:'list'});
      const runs=data.runs.filter(run=>run.state.project_id===selectedProjectId);
      workflowDialog.innerHTML=workflowHeader('Flujos de prueba guardados')+(runs.length?runs.map(run=>`<button class="local-request-row" data-wf-run="${wfEscape(run.run_id)}"><span><strong>${wfEscape(run.state.subject)}</strong><small>${wfEscape(run.pending?.title || run.state.status)}</small></span><span>Continuar ↗</span></button>`).join(''):'<p>No hay flujos guardados en este proyecto y sesión de navegador. Crea una solicitud y pulsa Probar flujo con LangGraph.</p>')+'<p id="workflow-error" role="alert"></p>';
    }
  });
});
workflowDialog.addEventListener('click',event=>{
  if(event.target.closest('[data-wf-close]')){workflowDialog.close();return;}
  const answer=event.target.closest('[data-wf-answer]');
  if(answer)workflowAction(()=>resumeWorkflow(JSON.parse(answer.dataset.wfAnswer)));
  const run=event.target.closest('[data-wf-run]');
  if(run)workflowAction(async()=>{workflowRun=await workflowApi({action:'get',run_id:run.dataset.wfRun});renderWorkflow();});
});
workflowDialog.addEventListener('change',event=>{
  if(event.target.id==='wf-option'){
    const input=workflowDialog.querySelector('#wf-amount');input.readOnly=event.target.value==='swap';if(input.readOnly)input.value='0';
  }
});
workflowDialog.addEventListener('submit',event=>{
  event.preventDefault();if(!event.target.reportValidity())return;
  const data=Object.fromEntries(new FormData(event.target));
  if(event.target.dataset.wfForm==='proposal')data.days=Number(data.days);
  workflowAction(()=>resumeWorkflow(data));
});
