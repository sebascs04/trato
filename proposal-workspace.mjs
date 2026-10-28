import {uiText,uiLocale} from './i18n.mjs';
import {icon as uiIcon} from './icons.mjs';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const amount=minor=>new Intl.NumberFormat(uiLocale(),{style:'currency',currency:'USD'}).format(minor/100);
const when=value=>new Intl.DateTimeFormat(uiLocale(),{dateStyle:'medium',timeStyle:'short',timeZone:'America/Lima'}).format(new Date(value));
export function installProposalWorkspace(cloud){
 cloud.requestStatus=null;cloud.proposals=[];cloud.proposalDetails=null;cloud.proposalRetryRevision=null;cloud.proposalLoading=false;cloud.proposalError='';
 const originalDocuments=cloud.renderDocuments.bind(cloud),originalLoad=cloud.loadProject.bind(cloud),originalReview=cloud.renderChangeReview.bind(cloud),originalRows=cloud.requestRows.bind(cloud),originalClick=cloud.click.bind(cloud),originalSubmit=cloud.submit.bind(cloud),originalReset=cloud.reset.bind(cloud);
 cloud.reset=function(){originalReset();this.requestStatus=null;this.proposals=[];this.proposalDetails=null;this.proposalRetryRevision=null;this.proposalError='';};
 cloud.loadProject=async function(){
  const id=this.projectId,epoch=this.epoch;this.requestStatus=null;this.proposals=[];this.proposalDetails=null;this.proposalRetryRevision=null;this.proposalError='';
  if(!id){await originalLoad();return;}
  try{
   const [,proposals,status]=await Promise.all([originalLoad(),this.request(`/api/v1/projects/${id}/proposals`),this.request(`/api/v1/projects/${id}/request-status`)]);
   if(id!==this.projectId||epoch!==this.epoch)return;
   if(typeof status.can_register!=='boolean'||!Array.isArray(status.closures))throw new Error(uiText("No pudimos comprobar los pedidos abiertos."));
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
   if(typeof status.can_register!=='boolean'||!Array.isArray(status.closures))throw new Error(uiText("No pudimos comprobar los pedidos abiertos."));
   const proposal=proposals.find(p=>p.request_document_id===request);
   const revision=this.proposalDetails?.revision;
   const revisionId=revision&&this.proposalDetails.proposal.current_revision_id!==revision.id?revision.id:proposal?.current_revision_id;
   const details=tab==='gestion'&&proposal?await this.request(`/api/v1/proposals/${proposal.id}/revisions/${revisionId}`):null;
   if(!current())return;
   this.proposals=proposals;this.requestStatus=status;
   if(tab==='gestion')this.proposalDetails=details;
   this.historyGeneration++;this.historyLoaded=false;this.historyPending=null;this.projectActivity=[];
   this.proposalError='';this.message='';this.notify();
  }catch(error){if(current()){this.message=`${uiText("No pudimos actualizar el estado del pedido.")} ${error.message}`;this.notify();}}
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
 let detailGeneration=0;
 async function refresh(id=cloud.requestId,revision,{reloadList=true,reloadStatus=false}={}){
  const project=cloud.projectId,epoch=cloud.epoch,generation=++detailGeneration;
  const current=()=>project===cloud.projectId&&epoch===cloud.epoch&&generation===detailGeneration&&cloud.requestId===id&&cloud.tab==='gestion';
  cloud.requestId=id;cloud.proposalRetryRevision=revision||summary(id)?.current_revision_id||null;cloud.tab='gestion';cloud.proposalLoading=true;cloud.proposalError='';cloud.message='';cloud.notify();
  try{
   if(reloadList){
    const [proposals,status]=await Promise.all([cloud.request(`/api/v1/projects/${project}/proposals`),reloadStatus?cloud.request(`/api/v1/projects/${project}/request-status`):Promise.resolve(null)]);if(!current())return;
    cloud.proposals=proposals;
    if(reloadStatus){if(typeof status.can_register!=='boolean'||!Array.isArray(status.closures))throw Error(uiText("No pudimos comprobar los pedidos abiertos."));cloud.requestStatus=status;}
   }
   const p=summary(id);
   if(!p)throw Error(uiText("No se encontró la propuesta de este pedido."));
   cloud.proposalRetryRevision=revision||p.current_revision_id;
   const details=await cloud.request(`/api/v1/proposals/${p.id}/revisions/${revision||p.current_revision_id}`);
   if(!current())return;
   cloud.proposalDetails=details;
  }catch(error){if(current()){cloud.proposalError=error.message;error.uiHandled=true;throw error;}}
  finally{if(project===cloud.projectId&&epoch===cloud.epoch&&generation===detailGeneration){cloud.proposalLoading=false;cloud.notify();}}
 }
 cloud.restoreProposalNavigation=(id,revision)=>refresh(id,revision,{reloadList:false});
 cloud.requestRows=function(requests){
  const container=this.document.createElement('div');container.innerHTML=originalRows(requests);
  for(const row of container.children){const id=row.querySelector('[data-request-primary]')?.dataset.cloudId,p=summary(id),closure=this.requestStatus?.closures.find(c=>c.request_document_id===id);
   if(closure&&!p){row.querySelector('[data-request-status]').textContent=uiText("Cerrado");row.querySelector('[data-request-primary]').remove();continue;}
   if(!p)continue;
   row.querySelector('[data-request-status]').textContent=uiText(p.business_status);
   const version=row.querySelector('[data-request-version]');version.hidden=false;version.textContent=`${uiText("Adenda v")}${p.revision_no}`;
   const button=row.querySelector('[data-request-primary]');button.dataset.cloudAction='manage-change';button.textContent=['Finalizado','Cerrado'].includes(p.business_status)?uiText("Ver detalles →"):uiText("Continuar cambio →");
  }
  return container.innerHTML;
 };
 cloud.renderChangeReview=function(panel){
  originalReview(panel);
  const comparison=this.comparison;
  if(!comparison||comparison.loading||comparison.error||comparison.projectId!==this.projectId)return;
  const p=summary(comparison.id);
  if(this.requestStatus?.closures.some(c=>c.request_document_id===comparison.id))return;
  panel.querySelector('.cloud-change-review')?.insertAdjacentHTML('beforeend',`<div class="cloud-tools cloud-flow-actions"><p class="cloud-notice">${p?uiText("Consulta la propuesta guardada y continúa con su revisión."):uiText("Después de revisar las fuentes, define el alcance, el adicional y la fecha de tu propuesta.")}</p><button class="button" ${p?`data-cloud-action="manage-change" data-cloud-id="${esc(comparison.id)}"`:'data-proposal-action="prepare"'}>${p?(p.business_status==='Finalizado'?uiText("Ver detalles →"):uiText("Continuar propuesta →")):uiText("Preparar propuesta manual →")}</button>${!p?("<button class=\"text-button\" data-proposal-action=\"close-request\">"+uiText("Cerrar pedido")+"</button>"):''}</div>`);
 };
 cloud.renderChangeManagement=function(panel){
  if(this.proposalLoading){panel.innerHTML=`<div class="cloud-detail-loading"><span aria-hidden="true">${uiIcon('refresh-cw')}</span><span>${uiText("Cargando detalles…")}</span></div>${this.renderSkeleton('project',uiText("Cargando detalles del pedido…"))}`;return;}
  if(this.proposalError){panel.innerHTML=`<section class="workspace-panel"><h3>${uiText("No se pudieron cargar los detalles")}</h3><p role="alert" class="cloud-error">${esc(this.proposalError)}</p><div class="cloud-tools"><button class="button" data-proposal-action="retry-details">${uiText("Reintentar")}</button><button class="button secondary" data-cloud-action="tab" data-cloud-tab="solicitudes">${uiText("Volver a los pedidos")}</button></div></section>`;return;}
  const p=summary(this.requestId),data=this.proposalDetails;
  if(!p){this.renderRequests(panel);return;}
  if(!data||data.proposal.id!==p.id){panel.insertAdjacentHTML('afterbegin',("<button class=\"button\" data-proposal-action=\"refresh\">"+uiText("Cargar adenda y versiones →")+"</button>"));return;}
  const r=data.revision,current=data.proposal.current_revision_id===r.id,paid=!!data.proposal.locked_at,payment=data.payments[0],artifact=data.artifacts[0];
  const sent=data.deliveries.some(d=>d.kind==='adenda'&&d.status==='accepted_by_gmail');
  const controls=[];
  if(artifact)controls.push(`<button class="button secondary" data-proposal-action="pdf">${uiText("Ver PDF v")}${r.revision_no} ↗</button>`);
  if(current&&!paid){
   if(!artifact)controls.push(("<button class=\"button\" data-proposal-action=\"save-pdf\">"+uiText("Guardar PDF de esta versión →")+"</button>"));
   else if(!data.reviews.length)controls.push(("<button class=\"button\" data-proposal-action=\"preview\" data-kind=\"adenda\">"+uiText("Enviar adenda →")+"</button>"));
   else if(!data.acceptances.length){
    if(!sent)controls.push(("<button class=\"button\" data-proposal-action=\"preview\" data-kind=\"adenda\">"+uiText("Enviar adenda →")+"</button>"));
    if(sent)controls.push(("<button class=\"button secondary\" data-proposal-action=\"accept\">"+uiText("Registrar aceptación recibida →")+"</button>"));
   }else if(data.payment_required){
    if(!payment)controls.push(("<button class=\"button\" data-proposal-action=\"payment\">"+uiText("Preparar cobro →")+"</button>"));
    else{if(payment.status==='pending_approval'&&!data.deliveries.some(d=>d.kind==='payment'&&d.status==='accepted_by_gmail'))controls.push(("<button class=\"button\" data-proposal-action=\"preview\" data-kind=\"payment\">"+uiText("Enviar solicitud de pago →")+"</button>"));controls.push(("<button class=\"button secondary\" data-proposal-action=\"reconcile\">"+uiText("Verificar pago ↻")+"</button>"));}
   }
   const attempted=data.deliveries.some(d=>['sending','accepted_by_gmail','delivery_uncertain'].includes(d.status));
   if(!payment&&!data.acceptances.length&&!attempted)controls.push(("<button class=\"button secondary\" data-proposal-action=\"edit\">"+uiText("Editar borrador")+"</button>"));
   if(!payment&&!data.acceptances.length)controls.push(("<button class=\"text-button\" data-proposal-action=\"close-request\">"+uiText("Cerrar pedido")+"</button>"));
   if(!payment&&!data.acceptances.length&&sent)controls.push(("<button class=\"text-button\" data-proposal-action=\"revise\">"+uiText("Registrar ajustes del cliente")+"</button>"));
  }
  panel.innerHTML=`<div class="cloud-tracking"><button class="text-button" data-cloud-action="tab" data-cloud-tab="solicitudes">${uiText("← Volver a los pedidos")}</button><header class="cloud-view-heading"><span class="eyebrow">${uiText("DETALLES DEL PEDIDO")}</span><h3>${esc(this.documents.find(d=>d.id===this.requestId)?.title)}</h3></header><section class="workspace-panel"><div class="cloud-panel-heading"><h3>${esc(uiText(p.business_status))}</h3><span class="badge review">${uiText("Adenda v")}${r.revision_no}${current?'':' · '+uiText('anterior')}</span></div><p>${esc(r.scope_summary)}</p><p><strong>${esc(amount(r.additional_minor))}</strong> ${uiText("· Entrega:")} ${esc(r.deadline)}</p><p>${esc(r.conditions)}</p><div class="cloud-tools cloud-flow-actions">${controls.join('')}</div>${paid?("<p>"+uiText("Este cambio está finalizado y se conserva para consulta.")+"</p>"):''}</section>${p.revision_no>1?("<section class=\"workspace-panel\"><h3>"+uiText("Versiones de la adenda")+"</h3><div data-proposal-versions><button class=\"text-button\" data-proposal-action=\"versions\">"+uiText("Ver versiones anteriores")+"</button></div></section>"):''}</div>`;
 };
 function prepare(mode='create'){
  const old=mode!=='create'?cloud.proposalDetails:null,r=old?.revision,item=old?.line_items?.[0];
  const recipient=cloud.clients.find(client=>client.id===cloud.project()?.client_id)?.contact_email || '';
  cloud.proposalForm={old,mode,key:crypto.randomUUID(),saved:null,recipient};
  cloud.show(mode==='edit'?uiText("Editar borrador"):mode==='revise'?uiText("Ajustes solicitados por el cliente"):uiText("Preparar propuesta"),`<p>${uiText("Define el cambio, su adicional y la fecha de entrega. Se guardará con sus fuentes del proyecto.")}</p><form data-cloud-form="proposal-terms">${mode==='revise'?("<label class=\"field\">${uiText('PDF con los ajustes del cliente')}<input class=\"context-box\" type=\"file\" name=\"feedbackFile\" accept=\".pdf\" required></label><label class=\"field\">"+uiText("¿Qué pidió ajustar el cliente?")+"<textarea class=\"context-box\" name=\"feedbackNotes\" required maxlength=\"4000\"></textarea></label>"):''}<label class="field">${uiText("Alcance del cambio")}<textarea class="context-box" name="scope" required maxlength="12000">${esc(r?.scope_summary)}</textarea></label><label class="field">${uiText("Condiciones")}<textarea class="context-box" name="conditions" maxlength="12000">${esc(r?.conditions)}</textarea></label><label class="field">${uiText("Detalle del adicional")}<input class="context-box" name="description" required maxlength="1000" value="${esc(item?.description)}"></label><label class="field">${uiText("Adicional total en USD")}<input class="context-box" name="amount" inputmode="decimal" required pattern="[0-9]+([.,][0-9]{1,2})?" value="${r?(r.additional_minor/100).toFixed(2):''}" placeholder="0.10"></label><label class="field">${uiText("Fecha de entrega")}<input class="context-box" name="deadline" type="date" required value="${esc(r?.deadline)}"></label><section class="cloud-proposal-send-context"><strong>${recipient?'Enviar a '+esc(recipient):uiText("El cliente no tiene un correo registrado")}</strong><p>${recipient?uiText("Guardar y enviar conserva esta versión, genera su PDF y envía la adenda a este destinatario. Revisa el alcance, el importe y la fecha antes de continuar."):uiText("Puedes guardar el borrador. Registra el correo del cliente antes de enviarlo.")}</p></section><div class="dialog-actions"><button class="button" type="submit" name="intent" value="send" ${recipient?'':'disabled'}>${uiText("Guardar y enviar al cliente →")}</button><button class="button secondary" type="submit" name="intent" value="draft">${mode==='edit'?uiText("Guardar cambios del borrador →"):uiText("Guardar borrador")}</button></div></form>`);
 }
 async function preview(kind){
  const data=cloud.proposalDetails,value=await cloud.request(base(data)+`/email-preview?kind=${kind}`);
  cloud.proposalPreview={kind,value,data};
  cloud.show(kind==='adenda'?uiText("Enviar adenda al cliente"):uiText("Enviar solicitud de pago"),`<div class="cloud-mail-content"><div class="cloud-mail-context"><span class="cloud-mail-label">${kind==='adenda'?uiText("Propuesta de cambio"):uiText("Solicitud de pago")}</span><span>${uiText("Adenda v")}${data.revision.revision_no}</span></div><section class="cloud-mail-envelope" aria-label="${uiText("Vista previa del correo")}"><dl class="cloud-mail-addresses"><div><dt>${uiText("De")}</dt><dd>${esc(value.sender)}<span class="cloud-mail-provider">Gmail</span></dd></div><div><dt>${uiText("Para")}</dt><dd><span class="cloud-mail-recipient">${esc(value.recipient)}</span></dd></div></dl><div class="cloud-mail-message"><span class="cloud-mail-field-label">${uiText("ASUNTO")}</span><h3>${esc(value.subject)}</h3><div class="cloud-mail-body">${esc(value.body)}</div></div></section><button type="button" class="cloud-mail-attachment" data-proposal-action="mail-pdf" aria-expanded="false" aria-controls="proposal-mail-pdf" aria-label="${uiText("Ver PDF adjunto")} ${esc(value.filename)}"><span class="cloud-mail-pdf" aria-hidden="true">PDF</span><span class="cloud-mail-file"><strong>${esc(value.filename)}</strong><small>${uiText("Adenda v")}${data.revision.revision_no} ${uiText("· Documento adjunto")}</small></span><span class="cloud-mail-file-action">${uiText("Ver PDF")} <span aria-hidden="true">↗</span></span></button><div id="proposal-mail-pdf" data-mail-pdf hidden></div></div>${kind==='adenda'&&!data.reviews.length?("<p class=\"cloud-notice\">"+uiText("Al enviar confirmas que revisaste esta versión y su PDF adjunto.")+"</p>"):''}<form data-cloud-form="proposal-send" class="cloud-mail-footer"><button class="button secondary" type="button" data-cloud-close>${uiText("Cancelar")}</button><button class="button" type="submit">${uiIcon('send')}${uiText("Enviar correo →")}</button></form>`);
  cloud.modal.classList.add('cloud-mail-dialog');
 }
 cloud.click=function(event){
  const button=event.target.closest('[data-proposal-action]');
  if(!button){if(this.busy&&event.target.closest('[data-cloud-action="manage-change"]'))return;const manage=event.target.closest('[data-cloud-action="manage-change"]');originalClick(event);if(manage)this.run(()=>refresh(manage.dataset.cloudId,undefined,{reloadList:false}));return;}
  if(!this.active)return;
  const action=button.dataset.proposalAction,data=this.proposalDetails;
  if(action==='prepare'){prepare();return;}if(action==='edit'){prepare('edit');return;}if(action==='revise'){prepare('revise');return;}
  if(action==='close-request'){
   this.closingRequestId=this.requestId;
   this.show(uiText("Cerrar pedido"),`<p>${uiText("Registra por qué no continuará este pedido. Sus documentos y versiones quedarán disponibles para consulta.")}</p><form data-cloud-form="proposal-close-request"><label class="field" for="request-close-reason">${uiText("Motivo")}</label><select id="request-close-reason" class="context-box" name="reason" required><option value="" selected disabled>${uiText("Selecciona un motivo")}</option value="rejected">${uiText("El cliente rechazó la propuesta")}</option><option value="withdrawn">${uiText("El cliente retiró el pedido")}</option></select><label class="field">${uiText("Detalle")}<textarea class="context-box" name="notes" required maxlength="4000"></textarea></label><div class="dialog-actions"><button class="button" type="submit">${uiText("Cerrar pedido")}</button><button class="button secondary" type="button" data-cloud-close>${uiText("Volver")}</button></div></form>`);
   return;
  }
  this.run(async()=>{
   if(action==='refresh')await refresh();
   if(action==='retry-details')await refresh(this.requestId,this.proposalRetryRevision,{reloadList:!summary(this.requestId)});
   if(action==='mail-pdf'){
    const container=this.modal.querySelector('[data-mail-pdf]');
    if(container.querySelector('iframe')){container.hidden=!container.hidden;button.setAttribute('aria-expanded',String(!container.hidden));return;}
    const blob=await this.request(`/api/v1/documents/${this.proposalPreview.value.document_id}/file`,{},true);
    if(blob.type!=='application/pdf')throw Error(uiText("El servidor no devolvió un documento PDF."));
    this.releasePreview();this.previewUrl=URL.createObjectURL(blob);
    const iframe=this.document.createElement('iframe');iframe.className='cloud-pdf-frame';iframe.title='PDF adjunto de la adenda';iframe.src=this.previewUrl+'#view=FitH';container.append(iframe);container.hidden=false;button.setAttribute('aria-expanded','true');
   }
   if(action==='pdf'){
    const doc=data.artifacts[0];await this.previewDocument(doc.document_id,{title:`${uiText("Adenda v")}${data.revision.revision_no}`,original_filename:`adenda-v${data.revision.revision_no}.pdf`,mime_type:'application/pdf'});
   }
   if(action==='save-pdf'){await this.request(base(data)+'/pdf',{method:'POST'});await refresh();}
   if(action==='preview')await preview(button.dataset.kind);
   if(action==='accept'){
    const docs=this.documents.filter(d=>d.kind==='addendum'&&d.id!==data.artifacts[0].document_id);
    this.show(uiText("Registrar aceptación recibida"),`<p>${uiText("Adjunta el PDF que devolvió el cliente y revisa que corresponde a la adenda v")}${data.revision.revision_no}.</p><form data-cloud-form="proposal-accept"><label class="field">${uiText('PDF devuelto por el cliente')}<input class="context-box" name="file" type="file" accept=".pdf" required></label><label class="field">${uiText("Resultado de tu revisión")}<textarea class="context-box" name="notes" required maxlength="4000"></textarea></label><p>${uiText("Al guardar confirmas que revisaste la aceptación de esta versión. No se verifica criptográficamente una firma.")}</p><button class="button" type="submit">${uiText("Guardar aceptación revisada →")}</button></form>`);
   }
   if(action==='payment'){await this.request(base(data)+'/payment',{method:'POST'});await refresh(this.requestId,undefined,{reloadStatus:true});await preview('payment');}
   if(action==='reconcile'){await this.request(base(data)+'/reconcile',{method:'POST'});this.historyGeneration++;this.historyLoaded=false;this.historyPending=null;this.projectActivity=[];await refresh(this.requestId,undefined,{reloadStatus:true});}
   if(action==='versions'){
    const result=await this.request(`/api/v1/proposals/${data.proposal.id}?summary=true`);
    this.document.querySelector('[data-proposal-versions]').innerHTML=result.revisions.sort((a,b)=>b.revision_no-a.revision_no).map(r=>`<article class="cloud-client-row"><div><strong>${uiText("Adenda v")}${r.revision_no}</strong><p>${esc(amount(r.additional_minor))} · ${esc(r.deadline)}</p></div><button class="text-button" data-proposal-action="version" data-revision="${esc(r.id)}">${uiText("Consultar →")}</button></article>`).join('');
   }
   if(action==='version'){await refresh(this.requestId,button.dataset.revision,{reloadList:false});}
  });
 };
 cloud.submit=async function(event){
  const kind=event.target.dataset.cloudForm;if(!kind?.startsWith('proposal-'))return originalSubmit(event);
  const values=new FormData(event.target),sendWithSave=event.submitter?.value==='send';
  await this.run(async()=>{
   let data=this.proposalDetails;
   if(kind==='proposal-close-request'){
    const id=this.closingRequestId;
    await this.request(`/api/v1/requests/${id}/close`,this.json({reason:values.get('reason'),notes:values.get('notes')}));
    this.modal.close();this.tab='acuerdo';await this.loadProject();return;
   }
   if(kind==='proposal-terms'){
    const state=this.proposalForm;
    if(sendWithSave&&!state.recipient)throw Error(uiText("El cliente necesita un correo registrado antes de enviar."));
    const fingerprint=JSON.stringify([...values.entries()].map(([name,value])=>[name,typeof value==='string'?value:{name:value.name,size:value.size,lastModified:value.lastModified}]));
    if(state.saved&&state.savedFingerprint!==fingerprint)throw Error(uiText("Esta adenda ya se guardó. Cierra esta ventana y consulta la adenda guardada antes de cambiarla."));
    if(!state.saved){
     const raw=String(values.get('amount')).replace(',','.');if(!/^\d+(\.\d{1,2})?$/.test(raw))throw Error(uiText("Escribe el importe con un máximo de dos decimales."));
     const [units,cents='']=raw.split('.'),minor=Number(units)*100+Number(cents.padEnd(2,'0'));if(!Number.isSafeInteger(minor)||minor>99999999999)throw Error(uiText("El importe supera el máximo permitido."));
     const terms={scope_summary:values.get('scope'),conditions:values.get('conditions'),currency:'USD',deadline:values.get('deadline'),line_items:[{description:values.get('description'),quantity:1,unit_amount_minor:minor}]};
     const sources=state.old?state.old.sources.map(s=>s.document_id):[...this.initialSources().filter(d=>this.sourceReady(d)).map(d=>d.id),this.requestId];
     if(state.mode==='revise'){
      if(!state.feedbackId){
       const file=values.get('feedbackFile');if(!file?.size||file.size>10485760)throw new Error(uiText("Adjunta el PDF con los ajustes del cliente, de hasta 10 MB."));
       const upload=await this.request(`/api/v1/projects/${this.projectId}/documents?${new URLSearchParams({filename:file.name,title:`${uiText("Ajustes del cliente a la adenda v")}${state.old.revision.revision_no}`,kind:'reference'})}`,{method:'POST',body:file,headers:{'Content-Type':'application/pdf','Idempotency-Key':'feedback-'+state.key}});
       state.feedbackId=upload.document.id;
      }
      sources.push(state.feedbackId);
     }
     const body=state.old?{expected_revision_id:state.old.revision.id,terms,source_document_ids:sources}:{request_document_id:this.requestId,terms,source_document_ids:sources};
     if(state.mode==='revise'){body.feedback_document_id=state.feedbackId;body.feedback_notes=values.get('feedbackNotes');}
     const url=state.old?`/api/v1/proposals/${state.old.proposal.id}/${state.mode==='edit'?'draft':'revisions'}`:`/api/v1/projects/${this.projectId}/proposals`;
     state.saved=await this.request(url,{...this.json(body),headers:{'Content-Type':'application/json','Idempotency-Key':state.key}});
     state.savedFingerprint=fingerprint;
    }
    const savedBase=`/api/v1/proposals/${state.saved.proposal_id}/revisions/${state.saved.revision_id}`;
    const artifact=await this.request(savedBase+'/pdf',{method:'POST'});
    if(sendWithSave){
     const value=await this.request(savedBase+'/email-preview?kind=adenda');
     if(value.recipient.toLowerCase()!==state.recipient.toLowerCase())throw Error(uiText("El correo del cliente cambió. Revisa el destinatario antes de enviar la adenda guardada."));
     await this.request(`/api/v1/proposals/${state.saved.proposal_id}/review`,{...this.json({expected_revision_id:state.saved.revision_id,document_id:artifact.document_id,confirmed:true}),headers:{'Content-Type':'application/json','Idempotency-Key':'review-'+state.saved.revision_id}});
     await this.request(savedBase+'/email?kind=adenda',this.json({digest:value.digest,confirmed:true}));
    }
   }
   if(kind==='proposal-send'){
    const {kind:mailKind,value,data:saved}=this.proposalPreview;
    if(mailKind==='adenda'&&!saved.reviews.length){
     await this.request(`/api/v1/proposals/${saved.proposal.id}/review`,{...this.json({expected_revision_id:saved.revision.id,document_id:value.document_id,confirmed:true}),headers:{'Content-Type':'application/json','Idempotency-Key':'review-'+saved.revision.id}});
     saved.reviews=[{addendum_document_id:value.document_id}];
    }
    await this.request(base(saved)+`/email?kind=${mailKind}`,this.json({digest:value.digest,confirmed:true}));
   }
   if(kind==='proposal-accept'){
    const file=values.get('file');if(!file?.size||file.size>10485760)throw Error(uiText("Selecciona un PDF de hasta 10 MB."));
    const upload=await this.request(base(data)+`/returned-pdf?${new URLSearchParams({filename:file.name})}`,{method:'POST',body:file,headers:{'Content-Type':'application/pdf','Idempotency-Key':'return-'+data.revision.id}});
    await this.request(`/api/v1/proposals/${data.proposal.id}/acceptance`,{...this.json({expected_revision_id:data.revision.id,document_id:upload.document_id,confirmed:true,review_notes:values.get('notes')}),headers:{'Content-Type':'application/json','Idempotency-Key':'accept-'+data.revision.id}});
   }
   this.modal.close();
   if(kind==='proposal-send'){this.historyGeneration++;this.historyLoaded=false;this.historyPending=null;this.projectActivity=[];await refresh();}
   else {await this.loadProject();await refresh(this.requestId,undefined,{reloadList:false});}
  });
 };
}
