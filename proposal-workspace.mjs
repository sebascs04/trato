import {icon as uiIcon} from './icons.mjs';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const amount=minor=>new Intl.NumberFormat('es-PE',{style:'currency',currency:'USD'}).format(minor/100);
const when=value=>new Intl.DateTimeFormat('es-PE',{dateStyle:'medium',timeStyle:'short',timeZone:'America/Lima'}).format(new Date(value));
export function installProposalWorkspace(cloud){
 cloud.requestStatus=null;cloud.proposals=[];cloud.proposalDetails=null;cloud.proposalLoading=false;cloud.proposalError='';
 const originalDocuments=cloud.renderDocuments.bind(cloud),originalLoad=cloud.loadProject.bind(cloud),originalReview=cloud.renderChangeReview.bind(cloud),originalRows=cloud.requestRows.bind(cloud),originalClick=cloud.click.bind(cloud),originalSubmit=cloud.submit.bind(cloud),originalReset=cloud.reset.bind(cloud);
 cloud.reset=function(){originalReset();this.requestStatus=null;this.proposals=[];this.proposalDetails=null;this.proposalError='';};
 cloud.loadProject=async function(){
  const id=this.projectId,epoch=this.epoch;this.requestStatus=null;this.proposals=[];this.proposalDetails=null;this.proposalError='';
  if(!id){await originalLoad();return;}
  try{
   const [,proposals,status]=await Promise.all([originalLoad(),this.request(`/api/v1/projects/${id}/proposals`),this.request(`/api/v1/projects/${id}/request-status`)]);
   if(id!==this.projectId||epoch!==this.epoch)return;
   if(typeof status.can_register!=='boolean'||!Array.isArray(status.closures))throw new Error('No pudimos comprobar los pedidos abiertos.');
   this.proposals=proposals;this.requestStatus=status;
  }
  catch(error){this.proposalError=error.message;throw error;}
  finally{this.notify();}
 };
 let synchronizing=false;
 cloud.syncBusinessState=async function(){
  if(synchronizing||!this.active||!this.projectId||this.loading||this.directoryLoading||this.proposalLoading||this.busy||this.modal.open)return;
  const project=this.projectId,epoch=this.epoch,generation=this.historyGeneration,request=this.requestId,tab=this.tab;
  const current=()=>this.active&&project===this.projectId&&epoch===this.epoch&&generation===this.historyGeneration&&request===this.requestId&&tab===this.tab;
  synchronizing=true;
  try{
   const [proposals,status]=await Promise.all([this.request(`/api/v1/projects/${project}/proposals`),this.request(`/api/v1/projects/${project}/request-status`)]);
   if(!current())return;
   if(typeof status.can_register!=='boolean'||!Array.isArray(status.closures))throw new Error('No pudimos comprobar los pedidos abiertos.');
   const proposal=proposals.find(p=>p.request_document_id===request);
   const revision=this.proposalDetails?.revision;
   const revisionId=revision&&this.proposalDetails.proposal.current_revision_id!==revision.id?revision.id:proposal?.current_revision_id;
   const details=tab==='gestion'&&proposal?await this.request(`/api/v1/proposals/${proposal.id}/revisions/${revisionId}`):null;
   if(!current())return;
   this.proposals=proposals;this.requestStatus=status;
   if(tab==='gestion')this.proposalDetails=details;
   this.historyGeneration++;this.historyLoaded=false;this.historyPending=null;this.projectActivity=[];
   this.proposalError='';this.message='';this.notify();
  }catch(error){if(current()){this.message=`No pudimos actualizar el estado del pedido. ${error.message}`;this.notify();}}
  finally{synchronizing=false;}
 };
 let wasHidden=cloud.document.visibilityState==='hidden';
 cloud.document.addEventListener('visibilitychange',()=>{
  if(cloud.document.visibilityState==='hidden'){wasHidden=true;return;}
  if(wasHidden){wasHidden=false;void cloud.syncBusinessState();}
 });
 cloud.renderDocuments=function(panel){
  originalDocuments(panel);
  for(const doc of this.documents.filter(d=>d.kind==='addendum')){
   const row=[...panel.querySelectorAll('.cloud-document-row')].find(row=>row.querySelector('.document-button')?.dataset.cloudId===doc.id);
   if(!row)continue;
   const button=row.querySelector('.document-button');button.dataset.cloudAction='text';
   row.querySelector('[data-document-status]')?.remove();
   row.querySelector('[data-cloud-action="retry"]')?.remove();
  }
 };
 const summary=id=>cloud.proposals.find(p=>p.request_document_id===id);
 const base=data=>`/api/v1/proposals/${data.proposal.id}/revisions/${data.revision.id}`;
 async function refresh(id=cloud.requestId,revision){
  const project=cloud.projectId,epoch=cloud.epoch;cloud.proposalLoading=true;cloud.proposalError='';cloud.notify();
  try{
   const proposals=await cloud.request(`/api/v1/projects/${project}/proposals`);if(project!==cloud.projectId||epoch!==cloud.epoch)return;
   cloud.proposals=proposals;const p=summary(id);
   const details=p?await cloud.request(`/api/v1/proposals/${p.id}/revisions/${revision||p.current_revision_id}`):null;
   if(project!==cloud.projectId||epoch!==cloud.epoch)return;
   cloud.requestId=id;cloud.proposalDetails=details;cloud.tab='gestion';
  }catch(error){cloud.proposalError=error.message;throw error;}
  finally{if(project===cloud.projectId&&epoch===cloud.epoch){cloud.proposalLoading=false;cloud.notify();}}
 }
 cloud.requestRows=function(requests){
  const container=this.document.createElement('div');container.innerHTML=originalRows(requests);
  for(const row of container.children){const id=row.querySelector('[data-request-primary]')?.dataset.cloudId,p=summary(id),closure=this.requestStatus?.closures.find(c=>c.request_document_id===id);
   if(closure&&!p){row.querySelector('[data-request-status]').textContent='Cerrado';row.querySelector('[data-request-primary]').remove();continue;}
   if(!p)continue;
   row.querySelector('[data-request-status]').textContent=p.business_status;
   const version=row.querySelector('[data-request-version]');version.hidden=false;version.textContent=`Adenda v${p.revision_no}`;
   const button=row.querySelector('[data-request-primary]');button.dataset.cloudAction='manage-change';button.textContent=['Finalizado','Cerrado'].includes(p.business_status)?'Ver detalles →':'Continuar cambio →';
  }
  return container.innerHTML;
 };
 cloud.renderChangeReview=function(panel){
  originalReview(panel);
  const comparison=this.comparison;
  if(!comparison||comparison.loading||comparison.error||comparison.projectId!==this.projectId)return;
  const p=summary(comparison.id);
  if(this.requestStatus?.closures.some(c=>c.request_document_id===comparison.id))return;
  panel.querySelector('.cloud-change-review')?.insertAdjacentHTML('beforeend',`<div class="cloud-tools cloud-flow-actions"><p class="cloud-notice">${p?'Consulta la propuesta guardada y continúa con su revisión.':'Después de revisar las fuentes, define el alcance, el adicional y la fecha de tu propuesta.'}</p><button class="button" ${p?`data-cloud-action="manage-change" data-cloud-id="${esc(comparison.id)}"`:'data-proposal-action="prepare"'}>${p?(p.business_status==='Finalizado'?'Ver detalles →':'Continuar propuesta →'):'Preparar propuesta manual →'}</button>${!p?'<button class="text-button" data-proposal-action="close-request">Cerrar pedido</button>':''}</div>`);
 };
 cloud.renderChangeManagement=function(panel){
  if(this.proposalLoading){panel.innerHTML=this.renderSkeleton('project','Cargando versiones de la adenda…');return;}
  if(this.proposalError){panel.insertAdjacentHTML('afterbegin',`<p role="alert" class="cloud-error">${esc(this.proposalError)}</p>`);return;}
  const p=summary(this.requestId),data=this.proposalDetails;
  if(!p){this.renderRequests(panel);return;}
  if(!data||data.proposal.id!==p.id){panel.insertAdjacentHTML('afterbegin','<button class="button" data-proposal-action="refresh">Cargar adenda y versiones →</button>');return;}
  const r=data.revision,current=data.proposal.current_revision_id===r.id,paid=!!data.proposal.locked_at,payment=data.payments[0],artifact=data.artifacts[0];
  const sent=data.deliveries.some(d=>d.kind==='adenda'&&d.status==='accepted_by_gmail');
  const controls=[];
  if(artifact)controls.push(`<button class="button secondary" data-proposal-action="pdf">Ver PDF v${r.revision_no} ↗</button>`);
  if(current&&!paid){
   if(!artifact)controls.push('<button class="button" data-proposal-action="save-pdf">Guardar PDF de esta versión →</button>');
   else if(!data.reviews.length)controls.push('<button class="button" data-proposal-action="review">Revisar adenda y correo →</button>');
   else if(!data.acceptances.length){
    if(!sent)controls.push('<button class="button" data-proposal-action="preview" data-kind="adenda">Revisar correo de la adenda →</button>');
    if(sent)controls.push('<button class="button secondary" data-proposal-action="accept">Registrar aceptación recibida →</button>');
   }else if(data.payment_required){
    if(!payment)controls.push('<button class="button" data-proposal-action="payment">Preparar cobro →</button>');
    else{if(payment.status==='pending_approval'&&!data.deliveries.some(d=>d.kind==='payment'&&d.status==='accepted_by_gmail'))controls.push('<button class="button" data-proposal-action="preview" data-kind="payment">Revisar correo del cobro →</button>');controls.push('<button class="button secondary" data-proposal-action="reconcile">Verificar pago ↻</button>');}
   }
   const attempted=data.deliveries.some(d=>['sending','accepted_by_gmail','delivery_uncertain'].includes(d.status));
   if(!payment&&!data.acceptances.length&&!attempted)controls.push('<button class="button secondary" data-proposal-action="edit">Editar borrador</button>');
   if(!payment&&!data.acceptances.length)controls.push('<button class="text-button" data-proposal-action="close-request">Cerrar pedido</button>');
   if(!payment&&!data.acceptances.length&&sent)controls.push('<button class="text-button" data-proposal-action="revise">Registrar ajustes del cliente</button>');
  }
  panel.innerHTML=`<div class="cloud-tracking"><button class="text-button" data-cloud-action="tab" data-cloud-tab="solicitudes">← Volver a los pedidos</button><header class="cloud-view-heading"><span class="eyebrow">DETALLES DEL PEDIDO</span><h3>${esc(this.documents.find(d=>d.id===this.requestId)?.title)}</h3></header><section class="workspace-panel"><div class="cloud-panel-heading"><h3>${esc(p.business_status)}</h3><span class="badge review">Adenda v${r.revision_no}${current?'':' · anterior'}</span></div><p>${esc(r.scope_summary)}</p><p><strong>${esc(amount(r.additional_minor))}</strong> · Entrega: ${esc(r.deadline)}</p><p>${esc(r.conditions)}</p><div class="cloud-tools cloud-flow-actions">${controls.join('')}</div>${paid?'<p>Este cambio está finalizado y se conserva para consulta.</p>':''}</section><section class="workspace-panel"><h3>Versiones de la adenda</h3><div data-proposal-versions><button class="text-button" data-proposal-action="versions">Consultar todas las versiones ↗</button></div></section></div>`;
 };
 function prepare(mode='create'){
  const old=mode!=='create'?cloud.proposalDetails:null,r=old?.revision,item=old?.line_items?.[0];
  cloud.proposalForm={old,mode,key:crypto.randomUUID(),saved:null};
  cloud.show(mode==='edit'?'Editar borrador':mode==='revise'?'Ajustes solicitados por el cliente':'Preparar propuesta',`<p>Define el cambio, su adicional y la fecha de entrega. Se guardará con sus fuentes del proyecto.</p><form data-cloud-form="proposal-terms">${mode==='revise'?'<label class="field">PDF con los ajustes del cliente<input class="context-box" type="file" name="feedbackFile" accept=".pdf" required></label><label class="field">¿Qué pidió ajustar el cliente?<textarea class="context-box" name="feedbackNotes" required maxlength="4000"></textarea></label>':''}<label class="field">Alcance del cambio<textarea class="context-box" name="scope" required maxlength="12000">${esc(r?.scope_summary)}</textarea></label><label class="field">Condiciones<textarea class="context-box" name="conditions" maxlength="12000">${esc(r?.conditions)}</textarea></label><label class="field">Detalle del adicional<input class="context-box" name="description" required maxlength="1000" value="${esc(item?.description)}"></label><label class="field">Adicional total en USD<input class="context-box" name="amount" inputmode="decimal" required pattern="[0-9]+([.,][0-9]{1,2})?" value="${r?(r.additional_minor/100).toFixed(2):''}" placeholder="0.10"></label><label class="field">Fecha de entrega<input class="context-box" name="deadline" type="date" required value="${esc(r?.deadline)}"></label><button class="button" type="submit">${mode==='edit'?'Guardar cambios del borrador →':'Guardar adenda →'}</button></form>`);
 }
 async function preview(kind){
  const data=cloud.proposalDetails,value=await cloud.request(base(data)+`/email-preview?kind=${kind}`);
  cloud.proposalPreview={kind,value,data};
  cloud.show(kind==='adenda'?'Enviar adenda al cliente':'Enviar solicitud de pago',`<div class="cloud-mail-content"><div class="cloud-mail-context"><span class="cloud-mail-label">${kind==='adenda'?'Propuesta de cambio':'Solicitud de pago'}</span><span>Adenda v${data.revision.revision_no}</span></div><section class="cloud-mail-envelope" aria-label="Vista previa del correo"><dl class="cloud-mail-addresses"><div><dt>De</dt><dd>${esc(value.sender)}<span class="cloud-mail-provider">Gmail</span></dd></div><div><dt>Para</dt><dd><span class="cloud-mail-recipient">${esc(value.recipient)}</span></dd></div></dl><div class="cloud-mail-message"><span class="cloud-mail-field-label">ASUNTO</span><h3>${esc(value.subject)}</h3><div class="cloud-mail-body">${esc(value.body)}</div></div></section><button type="button" class="cloud-mail-attachment" data-proposal-action="pdf" aria-label="Ver PDF adjunto ${esc(value.filename)}"><span class="cloud-mail-pdf" aria-hidden="true">PDF</span><span class="cloud-mail-file"><strong>${esc(value.filename)}</strong><small>Adenda v${data.revision.revision_no} · Documento adjunto</small></span><span class="cloud-mail-file-action">Ver PDF <span aria-hidden="true">↗</span></span></button></div><form data-cloud-form="proposal-send" class="cloud-mail-footer"><button class="button secondary" type="button" data-cloud-close>Cancelar</button><button class="button" type="submit">${uiIcon('send')}Enviar correo →</button></form>`);
  cloud.modal.classList.add('cloud-mail-dialog');
 }
 cloud.click=function(event){
  const button=event.target.closest('[data-proposal-action]');
  if(!button){if(this.busy&&event.target.closest('[data-cloud-action="manage-change"]'))return;const manage=event.target.closest('[data-cloud-action="manage-change"]');originalClick(event);if(manage)this.run(()=>refresh(manage.dataset.cloudId));return;}
  if(!this.active)return;
  const action=button.dataset.proposalAction,data=this.proposalDetails;
  if(action==='prepare'){prepare();return;}if(action==='edit'){prepare('edit');return;}if(action==='revise'){prepare('revise');return;}
  if(action==='close-request'){
   this.closingRequestId=this.requestId;
   this.show('Cerrar pedido',`<p>Registra por qué no continuará este pedido. Sus documentos y versiones quedarán disponibles para consulta.</p><form data-cloud-form="proposal-close-request"><label class="field" for="request-close-reason">Motivo</label><select id="request-close-reason" class="context-box" name="reason" required><option value="" selected disabled>Selecciona un motivo</option value="rejected">El cliente rechazó la propuesta</option><option value="withdrawn">El cliente retiró el pedido</option></select><label class="field">Detalle<textarea class="context-box" name="notes" required maxlength="4000"></textarea></label><div class="dialog-actions"><button class="button" type="submit">Cerrar pedido</button><button class="button secondary" type="button" data-cloud-close>Volver</button></div></form>`);
   return;
  }
  this.run(async()=>{
   if(action==='refresh')await refresh();
   if(action==='pdf'){
    const doc=data.artifacts[0];await this.previewDocument(doc.document_id,{title:`Adenda v${data.revision.revision_no}`,original_filename:`adenda-v${data.revision.revision_no}.pdf`,mime_type:'application/pdf'});
   }
   if(action==='save-pdf'){await this.request(base(data)+'/pdf',{method:'POST'});await refresh();}
   if(action==='review'){
    this.show('Revisar adenda',`<p>${esc(data.revision.scope_summary)}</p><p>${esc(amount(data.revision.additional_minor))} · Entrega: ${esc(data.revision.deadline)}</p><p>${esc(data.revision.conditions)}</p><button class="text-button" data-proposal-action="pdf">Ver PDF completo ↗</button><form data-cloud-form="proposal-review"><label class="field"><input type="checkbox" name="confirmed" required> Revisé esta versión y quiero preparar el correo.</label><button class="button" type="submit">Confirmar revisión →</button></form>`);
   }
   if(action==='preview')await preview(button.dataset.kind);
   if(action==='accept'){
    const docs=this.documents.filter(d=>d.kind==='addendum'&&d.id!==data.artifacts[0].document_id);
    this.show('Registrar aceptación recibida',`<p>Adjunta el PDF que devolvió el cliente y revisa que corresponde a la adenda v${data.revision.revision_no}.</p><form data-cloud-form="proposal-accept"><label class="field">PDF devuelto por el cliente<input class="context-box" name="file" type="file" accept=".pdf" required></label><label class="field">Resultado de tu revisión<textarea class="context-box" name="notes" required maxlength="4000"></textarea></label><label class="field"><input type="checkbox" name="confirmed" required> Revisé la aceptación de esta versión.</label><p>Tu revisión registra la aceptación; no verifica criptográficamente una firma.</p><button class="button" type="submit">Guardar aceptación revisada →</button></form>`);
   }
   if(action==='payment'){await this.request(base(data)+'/payment',{method:'POST'});await refresh();await preview('payment');}
   if(action==='reconcile'){await this.request(base(data)+'/reconcile',{method:'POST'});this.historyGeneration++;this.historyLoaded=false;this.historyPending=null;this.projectActivity=[];await refresh();}
   if(action==='versions'){
    const result=await this.request(`/api/v1/proposals/${data.proposal.id}`);
    this.show('Versiones de la adenda',result.revisions.sort((a,b)=>b.revision_no-a.revision_no).map(r=>`<article class="cloud-client-row"><div><strong>Adenda v${r.revision_no}</strong><p>${esc(amount(r.additional_minor))} · ${esc(r.deadline)}</p></div><button class="text-button" data-proposal-action="version" data-revision="${esc(r.id)}">Consultar →</button></article>`).join(''));
   }
   if(action==='version'){this.modal.close();await refresh(this.requestId,button.dataset.revision);}
  });
 };
 cloud.submit=async function(event){
  const kind=event.target.dataset.cloudForm;if(!kind?.startsWith('proposal-'))return originalSubmit(event);
  const values=new FormData(event.target);
  await this.run(async()=>{
   let data=this.proposalDetails;
   if(kind==='proposal-close-request'){
    const id=this.closingRequestId;
    await this.request(`/api/v1/requests/${id}/close`,this.json({reason:values.get('reason'),notes:values.get('notes')}));
    this.modal.close();this.tab='acuerdo';await this.loadProject();return;
   }
   if(kind==='proposal-terms'){
    const state=this.proposalForm;
    if(!state.saved){
     const raw=String(values.get('amount')).replace(',','.');if(!/^\d+(\.\d{1,2})?$/.test(raw))throw Error('Escribe el importe con un máximo de dos decimales.');
     const [units,cents='']=raw.split('.'),minor=Number(units)*100+Number(cents.padEnd(2,'0'));if(!Number.isSafeInteger(minor)||minor>99999999999)throw Error('El importe supera el máximo permitido.');
     const terms={scope_summary:values.get('scope'),conditions:values.get('conditions'),currency:'USD',deadline:values.get('deadline'),line_items:[{description:values.get('description'),quantity:1,unit_amount_minor:minor}]};
     const sources=state.old?state.old.sources.map(s=>s.document_id):[...this.initialSources().filter(d=>this.sourceReady(d)).map(d=>d.id),this.requestId];
     if(state.mode==='revise'){
      if(!state.feedbackId){
       const file=values.get('feedbackFile');if(!file?.size||file.size>10485760)throw new Error('Adjunta el PDF con los ajustes del cliente, de hasta 10 MB.');
       const upload=await this.request(`/api/v1/projects/${this.projectId}/documents?${new URLSearchParams({filename:file.name,title:`Ajustes del cliente a la adenda v${state.old.revision.revision_no}`,kind:'reference'})}`,{method:'POST',body:file,headers:{'Content-Type':'application/pdf','Idempotency-Key':'feedback-'+state.key}});
       state.feedbackId=upload.document.id;
      }
      sources.push(state.feedbackId);
     }
     const body=state.old?{expected_revision_id:state.old.revision.id,terms,source_document_ids:sources}:{request_document_id:this.requestId,terms,source_document_ids:sources};
     if(state.mode==='revise'){body.feedback_document_id=state.feedbackId;body.feedback_notes=values.get('feedbackNotes');}
     const url=state.old?`/api/v1/proposals/${state.old.proposal.id}/${state.mode==='edit'?'draft':'revisions'}`:`/api/v1/projects/${this.projectId}/proposals`;
     state.saved=await this.request(url,{...this.json(body),headers:{'Content-Type':'application/json','Idempotency-Key':state.key}});
    }
    await this.request(`/api/v1/proposals/${state.saved.proposal_id}/revisions/${state.saved.revision_id}/pdf`,{method:'POST'});
   }
   if(kind==='proposal-review'){
    await this.request(`/api/v1/proposals/${data.proposal.id}/review`,{...this.json({expected_revision_id:data.revision.id,document_id:data.artifacts[0].document_id,confirmed:true}),headers:{'Content-Type':'application/json','Idempotency-Key':'review-'+data.revision.id}});
    this.proposalDetails=await this.request(base(data));
    await preview('adenda');
    this.notify();
    return;
   }
   if(kind==='proposal-send'){
    const {kind:mailKind,value,data:saved}=this.proposalPreview;
    await this.request(base(saved)+`/email?kind=${mailKind}`,this.json({digest:value.digest,confirmed:true}));
   }
   if(kind==='proposal-accept'){
    const file=values.get('file');if(!file?.size||file.size>10485760)throw Error('Selecciona un PDF de hasta 10 MB.');
    const upload=await this.request(base(data)+`/returned-pdf?${new URLSearchParams({filename:file.name})}`,{method:'POST',body:file,headers:{'Content-Type':'application/pdf','Idempotency-Key':'return-'+data.revision.id}});
    await this.request(`/api/v1/proposals/${data.proposal.id}/acceptance`,{...this.json({expected_revision_id:data.revision.id,document_id:upload.document_id,confirmed:true,review_notes:values.get('notes')}),headers:{'Content-Type':'application/json','Idempotency-Key':'accept-'+data.revision.id}});
   }
   this.modal.close();await this.loadProject();await refresh();
  });
 };
}
