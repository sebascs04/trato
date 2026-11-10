import {installChangeProposalAssistant} from './change-proposal-assistant.mjs';
import {installChangeReplyAssistant,renderRevisionComparison,wordDiff} from './change-reply-assistant.mjs';
import {installCaseAssistant} from './case-assistant.mjs';
import {uiText,uiLocale} from './i18n.mjs';
import {icon as uiIcon} from './icons.mjs';
import {createAgentPanel} from './agent-panel.mjs';
import {renderAIActivity} from './ai-activity.mjs';
import {fillInvoiceConcept} from './plan-payments.mjs';
import {uiLanguage} from './i18n.mjs';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const amount=minor=>new Intl.NumberFormat(uiLocale(),{style:'currency',currency:'USD'}).format(minor/100);
const when=value=>new Intl.DateTimeFormat(uiLocale(),{dateStyle:'medium',timeStyle:'short',timeZone:'America/Lima'}).format(new Date(value));
// A deadline is a calendar date (YYYY-MM-DD): format it without shifting the day.
const deadlineLabel=value=>{const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value||''));if(!match)return String(value||'');const day=new Date(Date.UTC(+match[1],+match[2]-1,+match[3]));return Number.isNaN(day.getTime())?String(value):new Intl.DateTimeFormat(uiLocale(),{dateStyle:'long',timeZone:'UTC'}).format(day);};
// What the freelancer most wants to know once a change is finished: PayPal confirmed the money.
const paidAmount=payment=>new Intl.NumberFormat(uiLocale(),{style:'currency',currency:payment.currency||'USD'}).format(payment.amount_minor/100);
// Beside the version, the first thing the freelancer reads.
export function paidBadge(payment){
 if(payment?.status!=='completed')return '';
 // Same words the client reads in their space once money went back.
 const refunded=payment.refunded_minor>0,key=!refunded?'proposal.paidBadge':payment.refunded_minor>=payment.amount_minor?'proposal.refundedBadge':'proposal.partiallyRefundedBadge';
 return `<span class="badge proposal-paid-badge">${uiIcon(refunded?'undo-2':'check')}${uiText(key,{amount:paidAmount(refunded?{...payment,amount_minor:payment.refunded_minor}:payment)})}</span>`;
}
export function paymentRecord(payment,when){
 if(payment?.status!=='completed')return '';
 const amount=paidAmount(payment);
 const refund=payment.refunded_minor>0?`<article class="client-accepted"><header><span class="client-accepted-icon" aria-hidden="true">${uiIcon('undo-2')}</span><div><strong>${uiText('clientReply.refunded',{amount:paidAmount({...payment,amount_minor:payment.refunded_minor})})}</strong></div></header></article>`:'';
 return `<article class="client-accepted"><header><span class="client-accepted-icon" aria-hidden="true">${uiIcon('credit-card')}</span><div><strong>${uiText('clientReply.paid',{amount})}</strong><time datetime="${esc(payment.updated_at)}">${uiText('clientReply.paidAt',{date:when(payment.updated_at)})}</time></div></header></article>${refund}`;
}
export function installProposalWorkspace(cloud){
 installCaseAssistant(cloud);
 installChangeProposalAssistant(cloud);
 const openReplyAssistant=installChangeReplyAssistant(cloud,{
  apply:(message,result)=>prepare('revise',message,result),
  reviewAcceptance:(message,result)=>openAcceptance(cloud.proposalDetails,message,result)
 });
 cloud.requestStatus=null;cloud.proposals=[];cloud.proposalDetails=null;cloud.proposalRetryRevision=null;cloud.proposalLoading=false;cloud.proposalError='';
 cloud.gmailReplies=[];cloud.gmailReplyError='';cloud.gmailImportedFeedbackDocs=new Map();cloud.gmailProjectId=cloud.projectId||'';
 const originalLoad=cloud.loadProject.bind(cloud),originalReview=cloud.renderChangeReview.bind(cloud),originalRows=cloud.requestRows.bind(cloud),originalClick=cloud.click.bind(cloud),originalSubmit=cloud.submit.bind(cloud),originalReset=cloud.reset.bind(cloud);
 cloud.reset=function(){originalReset();this.portalRequests=[];this.requestStatus=null;this.proposals=[];this.proposalDetails=null;this.proposalRetryRevision=null;this.proposalLoading=false;this.proposalError='';this.gmailReplies=[];this.gmailReplyError='';this.gmailImportedFeedbackDocs=new Map();this.selectedGmailReply=null;this.gmailProjectId='';};
 cloud.loadProject=async function(){
  const id=this.projectId,epoch=this.epoch;this.requestStatus=null;this.proposals=[];this.proposalDetails=null;this.proposalRetryRevision=null;this.proposalLoading=false;this.proposalError='';
  if(id!==this.gmailProjectId){this.gmailProjectId=id||'';this.gmailReplies=[];this.gmailReplyError='';this.gmailImportedFeedbackDocs=new Map();this.selectedGmailReply=null;}
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
   let replies=[],replyError='';
   if(details){
    try{replies=await this.request(`/api/v1/proposals/${proposal.id}/gmail-replies`);}
    catch(error){replyError=error.message;}
    try{this.portalRequests=await this.request(`/api/v1/proposals/${proposal.id}/portal-requests`);}catch{this.portalRequests=[];}
   }
   if(!current())return;
   this.proposals=proposals;this.requestStatus=status;
   if(tab==='gestion'){this.proposalDetails=details;this.gmailReplies=replies;this.gmailReplyError=replyError;}
   // Refresh history in the background; keep the loaded entries visible meanwhile.
   this.historyGeneration++;this.historyLoaded=false;this.historyPending=null;
   this.proposalError='';this.message='';this.notify();
  }catch(error){if(current()){this.message=`${uiText("No pudimos actualizar el estado del pedido.")} ${error.message}`;this.notify();}}
  finally{synchronizing=false;}
 };
 let wasHidden=cloud.document.visibilityState==='hidden';
 cloud.document.addEventListener('visibilitychange',()=>{
  if(cloud.document.visibilityState==='hidden'){wasHidden=true;return;}
  if(wasHidden){wasHidden=false;void cloud.syncBusinessState();}
 });
 const summary=id=>cloud.proposals.find(p=>p.request_document_id===id);
 const base=data=>`/api/v1/proposals/${data.proposal.id}/revisions/${data.revision.id}`;
 const gmailFeedbackKey=(message,index)=>`${message.id}:${index}`;
 const gmailFeedbackTitle=(message,index,attachment)=>`Gmail reply ${message.id} ${index+1} · ${attachment.filename}`;
 function gmailImportedDocumentId(message,index,attachment){
  const key=gmailFeedbackKey(message,index),cached=cloud.gmailImportedFeedbackDocs.get(key);
  if(cached)return cached;
  const document=cloud.documents.find(item=>item.title===gmailFeedbackTitle(message,index,attachment));
  if(document){cloud.gmailImportedFeedbackDocs.set(key,document.id);return document.id;}
  return null;
 }
 let detailGeneration=0;
 // quiet: update the open request in the background, keeping what is on screen until the new data arrives.
 async function refresh(id=cloud.requestId,revision,{reloadList=true,reloadStatus=false,quiet=false}={}){
  const project=cloud.projectId,epoch=cloud.epoch,generation=++detailGeneration;
  const current=()=>project===cloud.projectId&&epoch===cloud.epoch&&generation===detailGeneration&&cloud.requestId===id&&cloud.tab==='gestion';
  cloud.requestId=id;cloud.proposalRetryRevision=revision||summary(id)?.current_revision_id||null;cloud.tab='gestion';
  if(!quiet){cloud.proposalLoading=true;cloud.proposalError='';cloud.gmailReplies=[];cloud.gmailReplyError='';cloud.message='';cloud.notify();}
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
   try{cloud.portalRequests=await cloud.request(`/api/v1/proposals/${p.id}/portal-requests`);}catch{cloud.portalRequests=[];}
   try{const replies=await cloud.request(`/api/v1/proposals/${p.id}/gmail-replies`);if(!current())return;cloud.gmailReplies=replies;cloud.gmailReplyError='';}
   catch(error){if(!current())return;cloud.gmailReplies=[];cloud.gmailReplyError=error.message;}
  }catch(error){if(current()){cloud.proposalError=error.message;error.uiHandled=true;throw error;}}
  finally{if(project===cloud.projectId&&epoch===cloud.epoch&&generation===detailGeneration){cloud.proposalLoading=false;cloud.notify();}}
 }
 cloud.restoreProposalNavigation=(id,revision)=>refresh(id,revision,{reloadList:false});
 cloud.requestRows=function(requests){
  const container=this.document.createElement('div');container.innerHTML=originalRows(requests);
  for(const row of container.children){const id=row.querySelector('[data-request-primary]')?.dataset.cloudId,p=summary(id),closure=this.requestStatus?.closures.find(c=>c.request_document_id===id);
   if(closure&&!p){row.querySelector('[data-request-status]').textContent=uiText("Cerrado");row.querySelector('[data-request-primary]').remove();continue;}
   if(!p)continue;
   row.querySelector('[data-request-status]').textContent=p.refunded_minor>0?uiText(p.refunded_minor>=p.paid_minor?'clientAccount.state.refunded':'clientAccount.state.partiallyRefunded'):uiText(p.business_status);
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
  panel.querySelector('.cloud-change-review')?.insertAdjacentHTML('beforeend',`<div class="cloud-tools cloud-flow-actions"><p class="cloud-notice">${p?uiText("Consulta la propuesta guardada y continúa con su revisión."):uiText("Después de revisar las fuentes, define el alcance, el adicional y la fecha de tu propuesta.")}</p><button class="button" ${p?`data-cloud-action="manage-change" data-cloud-id="${esc(comparison.id)}"`:'data-proposal-action="prepare"'}>${p?(p.business_status==='Finalizado'?uiText("Ver detalles →"):uiText("Continuar propuesta →")):uiText("Preparar propuesta manual →")}</button></div>`);
  // Closing the request is a secondary decision: keep it at the top, next to the way back.
  const review=panel.querySelector('.cloud-change-review'),back=review?.querySelector(':scope>.text-button');
  if(!p&&back){const top=this.document.createElement('div');top.className='cloud-review-top';back.before(top);top.append(back);top.insertAdjacentHTML('beforeend',`<button type="button" class="text-button cloud-review-close" data-proposal-action="close-request">${uiIcon('trash-2')}${uiText("Cerrar pedido")}</button>`);}
 };
 let replySync=null;
 // Same 30 s pause the backend enforces between searches, shown as a countdown instead of an error after the click.
 const SYNC_PAUSE_MS=30000,syncStarted=new Map();let syncNotice=null,countdownTimer=null;
 const syncWait=()=>Math.max(0,Math.ceil((SYNC_PAUSE_MS-(Date.now()-(syncStarted.get(cloud.projectId)||0)))/1000));
 function tickCountdown(){
  clearTimeout(countdownTimer);
  const button=cloud.document.querySelector('[data-proposal-action="gmail-sync"][data-sync-wait]');if(!button)return;
  const wait=syncWait();
  if(wait>0){button.lastElementChild.textContent=uiText('gmailSync.waitSeconds',{seconds:wait});countdownTimer=setTimeout(tickCountdown,1000);}
  else{button.disabled=false;button.removeAttribute('data-sync-wait');button.lastElementChild.textContent=uiText("Buscar respuestas en Gmail");}
 }
 function renderReplyPanel(data,sent,current,paid){
  const r=data.revision;
  const checking=replySync?.project===cloud.projectId&&replySync?.revision===r.id;
  const wait=checking?0:syncWait();if(wait>0)setTimeout(tickCountdown,0);
  const notice=syncNotice?.revision===r.id&&!checking?`<p class="cloud-notice" role="status">${esc(syncNotice.text)}</p>`:'';
  const replies=this.gmailReplies.filter(message=>message.revision_id===r.id);
  // Changes the client asked for from the portal: same role as a Gmail reply, used once to prepare the next version.
  const portalRequests=(this.portalRequests||[]).filter(item=>item.revision_id===r.id);
  // A closed or previous version only shows replies that already exist; there is nothing left to look for.
  // Every answer the client gave to this version, whether found in Gmail or registered by hand (e.g. a returned PDF).
  const accepted=data.acceptances[0]||null,acceptedDoc=accepted?.returned_document_id?this.documents.find(d=>d.id===accepted.returned_document_id):null;
  const recorded=accepted?`<article class="client-accepted">
    <header><span class="client-accepted-icon" aria-hidden="true">${uiIcon('check')}</span>
     <div><strong>${uiText('clientReply.accepted',{version:r.revision_no})}</strong><time datetime="${esc(accepted.created_at)}">${uiText(accepted.method==='client_portal'?'clientReply.portalAcceptedAt':'clientReply.recordedAt',{date:when(accepted.created_at)})}</time></div>
    </header>
    ${accepted.review_notes?.trim()?`<blockquote>${esc(accepted.review_notes)}</blockquote>`:''}
    ${accepted.returned_document_id?`<button type="button" class="change-cited-source" data-proposal-action="view-reply-doc" data-document-id="${esc(accepted.returned_document_id)}">${uiIcon('file-text')}<span>${esc(acceptedDoc?.title||uiText('clientReply.returnedDocument'))}</span>${uiIcon('arrow-up-right')}</button>`:''}
   </article>${paymentRecord(data.payments?.[0],when)}`:'';
  return sent&&(current&&!paid||replies.length||accepted)?`<section class="workspace-panel cloud-gmail-replies" aria-busy="${checking}">
   <header class="cloud-replies-heading">
    <h3>${uiIcon('mail')}${uiText("Respuestas de Gmail")}</h3>
    <div class="cloud-reply-actions">
     ${accepted?'':current&&!paid?`<button class="button secondary" data-proposal-action="gmail-sync" ${checking||wait?'disabled':''} ${wait?'data-sync-wait':''}>${uiIcon('refresh-cw')}<span>${wait?uiText('gmailSync.waitSeconds',{seconds:wait}):uiText("Buscar respuestas en Gmail")}</span></button>`:`<button class="text-button" data-proposal-action="refresh">${uiIcon('refresh-cw')}${uiText("Actualizar respuestas")}</button>`}
    </div>
   </header>
   ${accepted?'':notice}
   ${checking?`<p class="cloud-notice" role="status">${uiText('clientReply.checking')}</p>`:''}
   ${recorded}
   ${portalRequests.map(item=>`<article class="cloud-email-reply cloud-portal-request"><header><span class="cloud-reply-avatar" aria-hidden="true">${uiIcon('messages-square')}</span><div><strong>${uiText('portalRequest.title')}</strong><time datetime="${esc(item.updated_at)}">${esc(when(item.updated_at))}</time></div></header><p class="cloud-email-reply-body">${esc(item.notes)}</p>${current&&!paid&&!accepted?`<div class="cloud-reply-actions cloud-reply-footer"><button class="button" data-proposal-action="use-portal-request" data-request-id="${esc(item.id)}" ${item.used_at?'disabled':''}>${item.used_at?'':uiIcon('sparkles')}${uiText(item.used_at?"Respuesta ya utilizada":'portalRequest.use')}</button></div>`:''}</article>`).join('')}
   ${this.gmailReplyError?`<p class="cloud-error" role="alert">${esc(this.gmailReplyError)}</p>`:''}
   ${replies.length?replies.map(message=>{
    const messageId=esc(message.id);
    const importedIds=message.attachment_metadata.map((attachment,index)=>gmailImportedDocumentId(message,index,attachment)).filter(Boolean);
    const pendingImported=importedIds.some(id=>{const doc=this.documents.find(item=>item.id===id);return !doc||!this.sourceReady(doc);});
    const attachments=message.attachment_metadata.map((attachment,index)=>{
     if(attachment.mime_type?.toLowerCase().startsWith('image/')&&
        ['noname','attachment.pdf'].includes(attachment.filename?.trim().toLowerCase()))return '';
     const imported=!!gmailImportedDocumentId(message,index,attachment);
     return `<div class="cloud-email-attachment">${attachment.supported?'<span class="cloud-mail-pdf" aria-hidden="true">PDF</span>':''}
      <strong>${esc(attachment.filename)}</strong>
      ${attachment.supported?`<div class="cloud-reply-actions">
       <button class="text-button" data-proposal-action="view-gmail-pdf" data-message-id="${messageId}" data-attachment-index="${index}">${uiText("Ver PDF adjunto")}</button>
       <button class="text-button" data-proposal-action="import-gmail-pdf" data-message-id="${messageId}" data-attachment-index="${index}" ${imported?'disabled':''}>${uiText(imported?"PDF importado":"Importar PDF al proyecto")}</button>
      </div>`:`<span>${uiText("Formato no admitido")}</span>`}
     </div>`;
    }).join('');
    // Removed from Trato's central mailbox (Trash or deleted): kept as evidence, shown dimmed and without actions.
    const removed=message.mailbox_removed_reason==='trash'||message.mailbox_removed_reason==='deleted'?message.mailbox_removed_reason:null;
    return `<article class="cloud-email-reply ${removed?'is-removed':''}">
     <header><span class="cloud-reply-avatar" aria-hidden="true">${uiIcon('user-round')}</span>
      <div><strong>${esc(message.from_email)}</strong><time datetime="${esc(message.received_at)}">${esc(when(message.received_at))}</time></div>
      ${removed?`<span class="cloud-reply-removed" title="${uiText('mailRemoved.help')}">${uiIcon('trash-2')}${uiText(removed==='trash'?'mailRemoved.trash':'mailRemoved.deleted')}</span>`:''}
     </header>
     ${message.reply_text?`<p class="cloud-email-reply-body">${esc(message.reply_text)}</p>`:''}
     ${attachments}
     ${pendingImported?`<p class="cloud-notice">${uiText("Espera a que termine la lectura del PDF importado antes de usar esta respuesta.")}</p>`:''}
     ${current&&!paid&&!removed?`<div class="cloud-reply-actions cloud-reply-footer">
      ${!data.acceptances.length&&message.reply_text?.trim()&&!message.used_at?`<button class="button" data-proposal-action="analyze-gmail-reply" data-message-id="${messageId}" ${pendingImported?'disabled':''}>${uiIcon('sparkles')}${uiText('changeReply.analyze')}</button>`:''}
      <button class="text-button" data-proposal-action="use-gmail-reply" data-message-id="${messageId}" ${message.used_at||pendingImported?'disabled':''}>${uiText(message.used_at?"Respuesta ya utilizada":"Registrar ajustes manualmente")}</button>
     </div>`:''}
    </article>`;
   }).join(''):this.gmailReplyError||accepted||checking||portalRequests.length?'':`<p class="cloud-notice">${uiText("No se encontraron respuestas vinculadas a esta versión.")}</p>`}
  </section>`:'';

 }
 // With more than two secondary actions, they fold into one "More" menu so the next step stays the visible choice.
 // Same disclosure as the client-reply menu (cloud-reply-other).
 function secondaryActions(items){
  if(items.length<=2)return items.join('');
  const menu=items.join('').replace(/class="button secondary"/g,'class="cloud-reply-menu-item" role="menuitem"');
  return `<details class="cloud-reply-other"><summary class="button secondary">${uiText('proposalCard.more')}${uiIcon('chevron-down')}</summary><div class="cloud-reply-menu" role="menu" style="left:0;right:auto">${menu}</div></details>`;
 }
 cloud.renderChangeManagement=function(panel){
  if(this.proposalLoading){panel.innerHTML=`<div class="cloud-detail-loading"><span aria-hidden="true">${uiIcon('refresh-cw')}</span><span>${uiText("Cargando detalles…")}</span></div>${this.renderSkeleton('project',uiText("Cargando detalles del pedido…"))}`;return;}
  if(this.proposalError){panel.innerHTML=`<section class="workspace-panel"><h3>${uiText("No se pudieron cargar los detalles")}</h3><p role="alert" class="cloud-error">${esc(this.proposalError)}</p><div class="cloud-tools"><button class="button" data-proposal-action="retry-details">${uiText("Reintentar")}</button><button class="button secondary" data-cloud-action="tab" data-cloud-tab="solicitudes">${uiText("Volver a los pedidos")}</button></div></section>`;return;}
  const p=summary(this.requestId),data=this.proposalDetails;
  if(!p){this.renderRequests(panel);return;}
  if(!data||data.proposal.id!==p.id){panel.insertAdjacentHTML('afterbegin',("<button class=\"button\" data-proposal-action=\"refresh\">"+uiText("Cargar adenda y versiones →")+"</button>"));return;}
  const r=data.revision,current=data.proposal.current_revision_id===r.id,paid=!!data.proposal.locked_at,payment=data.payments[0],artifact=data.artifacts[0];
  const sent=data.deliveries.some(d=>d.kind==='adenda'&&d.status==='accepted_by_gmail');
  const replyPanel=renderReplyPanel.call(this,data,sent,current,paid);

  const controls=[];
  // While waiting for the client's answer or payment: if the email is not found, it may be in Spam.
  const paymentSent=data.deliveries.some(d=>d.kind==='payment'&&d.status==='accepted_by_gmail');
  const waitingClient=current&&!paid&&(sent&&!data.acceptances.length||paymentSent&&payment&&payment.status!=='completed');
  const spamHint=waitingClient?`<p class="mail-spam-hint">${uiIcon('info')}<span>${uiText('mailSent.spamHint')}</span></p>`:'';
  // Sandbox only: open the same PayPal checkout the client receives by email. Payment is still verified by the backend.
  // Addendum payments are made by the client from the portal; the freelancer no longer opens the client's checkout to test it.
  const secondary=[],replyDecision=[];let closeControl='',editControl='';
  if(current&&!paid&&payment&&payment.status!=='completed')secondary.push(`<button class="button secondary" data-proposal-action="payment-detective">${uiIcon('messages-square')}${uiText('paymentDetective.ask')}</button>`);
  if(artifact)secondary.push(`<button class="button secondary" data-proposal-action="pdf">${uiIcon('file-text')}${uiText("Ver PDF v")}${r.revision_no}${uiIcon('arrow-up-right')}</button>`);
  if(current&&!paid){
   if(!artifact)controls.push(("<button class=\"button\" data-proposal-action=\"save-pdf\">"+uiText("Guardar PDF de esta versión →")+"</button>"));
   else if(!data.reviews.length)controls.push(("<button class=\"button\" data-proposal-action=\"preview\" data-kind=\"adenda\">"+uiText("Enviar adenda →")+"</button>"));
   else if(!data.acceptances.length){
    if(!sent)controls.push(("<button class=\"button\" data-proposal-action=\"preview\" data-kind=\"adenda\">"+uiText("Enviar adenda →")+"</button>"));
    if(sent)replyDecision.push(("<button class=\"button\" data-proposal-action=\"accept\">"+uiText("Registrar aceptación recibida →")+"</button>"));
   }else if(data.payment_required){
    // TeTrato can collect the addendum with a PayPal invoice instead of the checkout, while nobody can have paid the order.
    // Only before the payment email: an addendum keeps one payment email, and the invoice needs its own to carry its link.
    const invoiceable=!paymentSent&&(!payment||payment.method!=='invoice'&&!payment.capture_attempted&&['pending_approval','failed','cancelled'].includes(payment.status));
    if(invoiceable)secondary.push(`<button class="button secondary" data-proposal-action="invoice">${uiIcon('sparkles')}${uiText('invoice.send')}</button>`);
    if(!payment)controls.push(("<button class=\"button\" data-proposal-action=\"payment\">"+uiText("Preparar cobro →")+"</button>"));
    else if(payment.method==='invoice'){
     if(payment.invoice_url)secondary.push(`<a class="button secondary" href="${esc(payment.invoice_url)}" target="_blank" rel="noopener">${uiIcon('file-text')}${uiText('invoice.open')}${uiIcon('arrow-up-right')}</a>`);
     if(payment.status==='reconciliation_required'||payment.status==='creating')controls.push(`<button class="button" data-proposal-action="invoice">${uiText('invoice.retry')}</button>`);
     else{if(payment.status==='pending_approval'&&!paymentSent)controls.push(`<button class="button" data-proposal-action="preview" data-kind="payment">${uiText('invoice.email')}</button>`);controls.push(("<button class=\"button secondary\" data-proposal-action=\"reconcile\">"+uiText("Verificar pago ↻")+"</button>"));}
    }
    else{if(payment.status==='pending_approval'&&!data.deliveries.some(d=>d.kind==='payment'&&d.status==='accepted_by_gmail'))controls.push(("<button class=\"button\" data-proposal-action=\"preview\" data-kind=\"payment\">"+uiText("Enviar solicitud de pago →")+"</button>"));controls.push(("<button class=\"button secondary\" data-proposal-action=\"reconcile\">"+uiText("Verificar pago ↻")+"</button>"));}
   }
   const attempted=data.deliveries.some(d=>['sending','accepted_by_gmail','delivery_uncertain'].includes(d.status));
   if(!payment&&!data.acceptances.length&&!attempted)editControl=`<button type="button" class="icon-button proposal-edit" data-proposal-action="edit" aria-label="${uiText("Editar borrador")}" title="${uiText("Editar borrador")}">${uiIcon('pencil')}</button>`;
   if(!payment&&!data.acceptances.length)closeControl=`<button type="button" class="text-button cloud-review-close" data-proposal-action="close-request">${uiIcon('trash-2')}${uiText("Cerrar pedido")}</button>`;
   if(!payment&&!data.acceptances.length&&sent)replyDecision.unshift(("<button class=\"button secondary\" data-proposal-action=\"revise\">"+uiText("Registrar ajustes del cliente")+"</button>"));
  }
  panel.innerHTML=`<div class="cloud-tracking"><div class="cloud-review-top"><button class="text-button" data-cloud-action="tab" data-cloud-tab="solicitudes">${uiText("← Volver a los pedidos")}</button>${closeControl}</div><header class="cloud-view-heading"><span class="eyebrow">${uiText("DETALLES DEL PEDIDO")}</span><h3>${esc(this.documents.find(d=>d.id===this.requestId)?.title)}</h3></header><section class="workspace-panel"><div class="cloud-panel-heading"><div class="proposal-heading-title"><h3>${esc(uiText(p.business_status))}</h3><span class="badge review">${uiText("Adenda v")}${r.revision_no}${current?'':' · '+uiText('anterior')}</span>${paidBadge(payment)}</div><div class="proposal-heading-actions"><button type="button" class="text-button" data-proposal-action="analysis" aria-haspopup="dialog">${uiIcon('sparkles')}${uiText('proposalCard.analysis')}</button>${p.revision_no>1?`<button type="button" class="text-button" data-proposal-action="versions" aria-haspopup="dialog">${uiIcon('history')}${uiText('proposalCard.versions',{count:p.revision_no})}</button>`:''}${editControl}</div></div><div class="proposal-summary"><button type="button" class="proposal-summary-open" data-proposal-action="details" aria-haspopup="dialog" title="${uiText('proposalCard.seeDetail')}"><span class="proposal-summary-label">${uiText("Alcance del cambio")}<span class="proposal-summary-more">${uiText('proposalCard.seeDetail')}${uiIcon('arrow-up-right')}</span></span><span class="proposal-summary-clamp">${esc(r.scope_summary)}</span></button><dl class="proposal-summary-terms"><div><dt>${uiText('changeReply.amount')}</dt><dd>${esc(amount(r.additional_minor))}</dd></div><div><dt>${uiText("Fecha de entrega")}</dt><dd>${esc(deadlineLabel(r.deadline))}</dd></div></dl></div>${renderRevisionComparison(data.previous_sent,r)}<div class="cloud-tools cloud-flow-actions tracking-actions"><div class="tracking-secondary">${secondaryActions(secondary)}</div>${controls.length?`<div class="tracking-primary">${controls.join('')}</div>`:''}</div>${spamHint}${paid?("<p>"+uiText("Este cambio está finalizado y se conserva para consulta.")+"</p>"):''}</section></div>`;
  if(replyPanel)panel.querySelector('.cloud-tracking')?.insertAdjacentHTML('beforeend',replyPanel);
  // What the client answered decides the next step, so those actions live with the replies.
  // Shown first, right under the heading: what to do next is the main question once the client has answered.
  // A pending portal request already says what the client wants: its own button is the main action, and the
  // manual ways to record an answer (PDF adjustments, acceptance received elsewhere) step back into a disclosure.
  const portalPending=(this.portalRequests||[]).some(item=>item.revision_id===r.id&&!item.used_at);
  // With a pending portal request, the menu sits next to "Check client replies" in the panel heading.
  if(replyDecision.length&&portalPending)panel.querySelector('.cloud-gmail-replies .cloud-replies-heading .cloud-reply-actions')?.insertAdjacentHTML('beforeend',
   `<details class="cloud-reply-other" ${this.replyOtherOpen?'open':''}><summary class="button secondary">${uiText('portalRequest.otherWays')}${uiIcon('chevron-down')}</summary><div class="cloud-reply-menu" role="menu">${replyDecision.join('').replace(/class="button(?: secondary)?"/g,'class="cloud-reply-menu-item" role="menuitem"').replace(/\s*→/g,'')}</div></details>`);
  else if(replyDecision.length)panel.querySelector('.cloud-gmail-replies .cloud-replies-heading')?.insertAdjacentHTML('afterend',`<div class="cloud-reply-decision is-top">${replyDecision.join('')}</div>`);
  // The panel re-renders on a timer (Gmail countdown): remember whether the menu is open so it does not fold by itself.
  const other=portalPending?panel.querySelector('.cloud-reply-other'):null;
  if(other){other.addEventListener('toggle',()=>{this.replyOtherOpen=other.open;});other.querySelector('.cloud-reply-menu')?.addEventListener('click',()=>{this.replyOtherOpen=false;});}
 };
 function prepare(mode='create',emailReply=null,analysis=null){
  const old=mode!=='create'?cloud.proposalDetails:null,r=old?.revision,item=old?.line_items?.[0];
  const recipient=cloud.clients.find(client=>client.id===cloud.project()?.client_id)?.contact_email || '';
  cloud.proposalForm={old,mode,key:crypto.randomUUID(),saved:null,recipient,emailFeedbackId:emailReply&&emailReply.kind!=='portal'?emailReply.id:null,portalRequestId:emailReply?.kind==='portal'?emailReply.id:null};
  // A v2 prepared by TeTrato recalculates its additional from the user's rate; it never inherits v1's amount or a past date.
  const portalReply=emailReply?.kind==='portal';
  const aiRevision=mode==='revise'&&(!emailReply||portalReply),today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Lima'}).format(new Date());
  cloud.show(mode==='edit'?uiText("Editar borrador"):mode==='revise'?uiText("Ajustes solicitados por el cliente"):uiText("Preparar propuesta"),`<p>${mode==='revise'?uiText("changeSteps.revisionIntro"):uiText("Define el cambio, su adicional y la fecha de entrega. Se guardará con sus fuentes del proyecto.")}</p><form data-cloud-form="proposal-terms">${mode==='create'||mode==='revise'&&(!emailReply||emailReply.kind==='portal')?`<section class="change-auto"><div data-change-auto aria-live="polite"></div></section>`:''}${mode==='revise'?`<section class="change-feedback-box"><label class="field">${uiText('PDF con los ajustes del cliente')}<input class="context-box" type="file" name="feedbackFile" accept=".pdf" required></label><label class="field">${uiText("changeSteps.extraContext")}<textarea class="context-box" name="feedbackNotes" maxlength="4000" placeholder="${uiText('changeSteps.extraContextExample')}"></textarea></label></section>`:''}<label class="field">${uiText("Alcance del cambio")}<textarea class="context-box" name="scope" required maxlength="12000">${esc(r?.scope_summary)}</textarea></label><label class="field">${uiText("Condiciones")}<textarea class="context-box" name="conditions" maxlength="12000">${esc(r?.conditions)}</textarea></label><label class="field">${uiText("Detalle del adicional")}<input class="context-box" name="description" required maxlength="1000" value="${esc(item?.description)}"><small class="field-help">${uiText('proposalCard.descriptionHelp')}</small></label><label class="field">${uiText("Adicional total en USD")}<input class="context-box" name="amount" inputmode="decimal" required pattern="[0-9]+([.,][0-9]{1,2})?" value="${r&&!aiRevision?(r.additional_minor/100).toFixed(2):''}" placeholder="0.10"></label><label class="field">${uiText("Fecha de entrega")}<input class="context-box" name="deadline" type="date" max="9999-12-31" required min="${today}" value="${esc(r?.deadline&&r.deadline>=today?r.deadline:'')}"></label><section class="cloud-proposal-send-context"><strong>${recipient?esc(uiText('proposal.sendTo',{recipient})):uiText("El cliente no tiene un correo registrado")}</strong><p>${recipient?uiText("Guardar y enviar conserva esta versión, genera su PDF y envía la adenda a este destinatario. Revisa el alcance, el importe y la fecha antes de continuar."):uiText("Puedes guardar el borrador. Registra el correo del cliente antes de enviarlo.")}</p></section><div class="dialog-actions"><button class="button" type="submit" name="intent" value="send" ${recipient?'':'disabled'}>${uiText("Guardar y revisar envío →")}</button><button class="button secondary" type="submit" name="intent" value="draft">${mode==='edit'?uiText("Guardar cambios del borrador →"):uiText("Guardar borrador")}</button></div></form>`);
  if(emailReply){
   const form=cloud.modal.querySelector('[data-cloud-form="proposal-terms"]'),file=form?.querySelector('[name="feedbackFile"]'),notes=form?.querySelector('[name="feedbackNotes"]'),body=emailReply.reply_text||'';
   file?.closest('.field')?.remove();
   if(notes){notes.required=true;notes.parentElement.firstChild.textContent=uiText('¿Qué pidió ajustar el cliente?');notes.value=analysis?.summary??(body.length<=4000?body:'');notes.parentElement.insertAdjacentHTML('beforebegin',`<section class="cloud-client-feedback"><strong>${uiText(emailReply.kind==='portal'?'portalRequest.title':"Respuesta recibida desde Gmail")}${emailReply.from_email?' · '+esc(emailReply.from_email):''}</strong><p class="cloud-email-reply-body">${esc(body)}</p></section>`);if(body.length>4000)notes.parentElement.insertAdjacentHTML('afterend',`<p class="cloud-notice">${uiText("El correo original se conserva íntegro como evidencia. Resume aquí los cambios en un máximo de 4.000 caracteres.")}</p>`);}
   // From the portal the client already wrote exactly what to change: use it as the feedback notes, without asking again.
   if(emailReply.kind==='portal'&&notes){notes.value=body;notes.required=false;notes.parentElement.hidden=true;}
  }
  const form=cloud.modal.querySelector('[data-cloud-form="proposal-terms"]');
  if(analysis?.draft){
   form.elements.scope.value=analysis.draft.scope_summary;
   form.elements.conditions.value=analysis.draft.conditions;
   form.elements.description.value=analysis.draft.description;
   form.elements.amount.value=(analysis.reviewed_amount_minor/100).toFixed(2);
   form.elements.deadline.value=analysis.reviewed_deadline;
   form.insertAdjacentHTML('afterbegin',`<p class="cloud-notice">${uiText('changeReply.draftHelp')}</p>`);
  }
  const previous=mode==='revise'?r:old?.previous_sent,previousItem=mode==='revise'?item:null;
  if(previous){
   const comparison=cloud.document.createElement('div');comparison.dataset.revisionComparison='';
   form.querySelector('.cloud-proposal-send-context').before(comparison);
   const update=()=>{
    const raw=form.elements.amount.value.trim().replace(',','.');
    const minor=/^\d+(\.\d{1,2})?$/.test(raw)?Math.round(Number(raw)*100):null;
    comparison.innerHTML=renderRevisionComparison({...previous,description:previousItem?.description},{scope_summary:form.elements.scope.value,
     conditions:form.elements.conditions.value,description:form.elements.description.value,additional_minor:minor,deadline:form.elements.deadline.value});
   };
   form.addEventListener('input',update);update();
  }
  if(mode==='revise'&&(!emailReply||portalReply)){
   const state=cloud.proposalForm;
   // A portal request has no PDF to upload: TeTrato analyses the client's words directly.
   cloud.installRevisionProposalSteps(form,portalReply?async()=>false:async()=>{
    const file=form.elements.feedbackFile.files[0];
    if(!file?.size||file.size>10485760)throw Error(uiText('Adjunta el PDF con los ajustes del cliente, de hasta 10 MB.'));
    const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer())),byte=>byte.toString(16).padStart(2,'0')).join('');
    const notes=form.elements.feedbackNotes.value.trim(),fingerprint=sha+'|'+notes;
    if(state.feedbackFingerprint===fingerprint)return false;
    // Same PDF and file name for the same sent version → same document, also after reopening the form,
    // so TeTrato's earlier analysis of it can be reused instead of reading a duplicate.
    const hex=bytes=>Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('');
    const uploadKey=hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(sha+'|'+file.name)));
    const upload=await cloud.request(`/api/v1/projects/${cloud.projectId}/documents?${new URLSearchParams({filename:file.name,title:`${uiText('Ajustes del cliente a la adenda v')}${state.old.revision.revision_no}`,kind:'reference',purpose:'addendum_adjustments',revision_id:state.old.revision.id})}`,{method:'POST',body:file,headers:{'Content-Type':'application/pdf','Idempotency-Key':'feedback-'+state.old.revision.id+'-'+uploadKey}});
    if(cloud.proposalForm!==state)throw Error(uiText('changeSteps.prepareFailed'));
    state.feedbackId=upload.document.id;state.feedbackSha=sha;state.feedbackFingerprint=fingerprint;
    return true;
   });
  }
  if(mode==='create')cloud.autoDraftChangeProposal?.();
 }
 // Like the saved initial plan: the card stays compact and the full addendum opens in the right-side drawer.
 let revisionPanel=null,lastAnalysis=null,compareFields=[],lastReview=null,floating=null;
 // Floating dialog over the analysis drawer, for the side-by-side comparison and TeTrato's full review.
 function showFloating(kind,eyebrow,title,body){
  if(!floating){
   floating=cloud.document.createElement('dialog');floating.setAttribute('aria-labelledby','proposal-floating-title');cloud.document.body.append(floating);
   floating.addEventListener('click',event=>{if(event.target===floating||event.target.closest('[data-proposal-floating-close]'))floating.close();});
  }
  floating.className=`cloud-dialog proposal-floating-dialog is-${kind}`;
  floating.innerHTML=`<div class="upload-modal-header"><div><span class="eyebrow">${esc(eyebrow)}</span><h2 id="proposal-floating-title">${title}</h2></div><button type="button" class="close" data-proposal-floating-close aria-label="${uiText('Cerrar')}" title="${uiText('Cerrar')}">${uiIcon('x')}</button></div>${body}`;
  if(!floating.open)floating.showModal();
 }
 function openCompare(field){
  if(!compareFields.length)return;
  const c=key=>uiText(`proposalCard.${key}`);
  showFloating('compare',compareFields.eyebrow,c('compareTitle'),`<div class="proposal-compare-head" aria-hidden="true"><span>${c('proposed')}</span><span>${c('saved')}</span></div>${compareFields.map(f=>{const d=wordDiff(f.before,f.after);return `<section class="proposal-compare-field" data-compare-field="${f.key}"><h3>${esc(f.label)}</h3><div class="proposal-compare-columns"><div><small>${c('proposed')}</small><p>${d.left}</p></div><div><small>${c('saved')}</small><p>${d.right}</p></div></div></section>`;}).join('')}`);
  floating.querySelector(`[data-compare-field="${field}"]`)?.scrollIntoView({block:'start'});
 }
 function openReview(){
  if(!lastReview)return;
  const c=key=>uiText(`proposalCard.${key}`),{review,eyebrow}=lastReview;
  const labels={scope:uiText("Alcance del cambio"),conditions:uiText("Condiciones"),description:c('description'),amount:uiText('changeReply.amount'),deadline:uiText("Fecha de entrega")};
  showFloating('review',eyebrow,`${uiIcon(review.material_change?'flag':'check')}${c(review.material_change?'material':'notMaterial')}`,`<div class="proposal-ai-verdict ${review.material_change?'is-material':''}"><p>${esc(review.summary)}</p>${review.changes.map(change=>`<p><b>${esc(labels[change.field]||change.field)}:</b> ${esc(change.assessment)}</p>`).join('')}</div>`);
 }
 // Every version of the addendum in the same right-side drawer as «See detail», newest first.
 async function openVersions(button,data){
  const title=uiText("Versiones de la adenda");
  revisionPanel??=createAgentPanel({cloud,id:'proposal-detail-title',className:'plan-recommendation-drawer proposal-detail-drawer'});
  const shell=body=>`<div class="case-agent-shell"><header class="case-agent-header"><div class="case-agent-heading"><div><span>${uiText("DETALLES DEL PEDIDO")}</span><h2 id="proposal-detail-title">${esc(title)}</h2></div></div><button type="button" class="case-agent-close" data-agent-close aria-label="${uiText('Cerrar')}" title="${uiText('Cerrar')}">${uiIcon('x')}</button></header><div class="case-agent-chat" data-agent-chat role="region" aria-label="${esc(title)}">${body}</div></div>`;
  revisionPanel.render(shell(`<p class="cloud-notice" role="status">${uiText('proposalCard.loading')}</p>`));revisionPanel.open(button);
  try{
   const result=await cloud.request(`/api/v1/proposals/${data.proposal.id}?summary=true`);
   if(!revisionPanel.element.open||cloud.proposalDetails?.proposal?.id!==data.proposal.id)return;
   const shown=data.revision.id;
   revisionPanel.render(shell(`<section class="plan-recommended-stages"><ol>${result.revisions.sort((a,b)=>b.revision_no-a.revision_no).map(v=>`<li><span class="plan-reasoning-number">${v.revision_no}</span><div><header><strong>${uiText("Adenda v")}${v.revision_no}</strong></header><p>${esc(amount(v.additional_minor))} · ${esc(deadlineLabel(v.deadline))}</p>${v.id===shown?`<span class="proposal-ai-tag">${uiText('proposalCard.versionShown')}</span>`:`<button type="button" class="text-button" data-proposal-action="version" data-revision="${esc(v.id)}">${uiText("Consultar →")}</button>`}</div></li>`).join('')}</ol></section>`));
  }catch(error){if(revisionPanel.element.open)revisionPanel.render(shell(`<p class="cloud-error" role="alert">${esc(error.message)}</p>`));}
 }
 function openRevisionDetails(button){
  const data=cloud.proposalDetails;if(!data?.revision)return;
  const r=data.revision,title=`${uiText("Adenda v")}${r.revision_no}`;
  revisionPanel??=createAgentPanel({cloud,id:'proposal-detail-title',className:'plan-recommendation-drawer proposal-detail-drawer'});
  const items=(data.line_items||[]).map(item=>`<p>${esc(item.description)} · ${esc(amount(Number(item.unit_amount_minor)*Number(item.quantity||1)))}</p>`).join('');
  const rows=[[uiText("Alcance del cambio"),`<p>${esc(r.scope_summary)}</p>`],[uiText("Condiciones"),r.conditions?`<p>${esc(r.conditions)}</p>`:''],
   [uiText('changeReply.amount'),`<p><strong>${esc(amount(r.additional_minor))}</strong></p>${items}`],[uiText("Fecha de entrega"),`<p>${esc(deadlineLabel(r.deadline))}</p>`]].filter(([,body])=>body);
  revisionPanel.render(`<div class="case-agent-shell"><header class="case-agent-header"><div class="case-agent-heading"><div><span>${uiText("DETALLES DEL PEDIDO")}</span><h2 id="proposal-detail-title">${esc(title)}</h2></div></div><button type="button" class="case-agent-close" data-agent-close aria-label="${uiText('Cerrar')}" title="${uiText('Cerrar')}">${uiIcon('x')}</button></header><div class="case-agent-chat" data-agent-chat role="region" aria-label="${esc(title)}"><section class="plan-recommended-stages"><ol>${rows.map(([label,body],i)=>`<li><span class="plan-reasoning-number">${i+1}</span><div><header><strong>${label}</strong></header>${body}</div></li>`).join('')}</ol></section></div></div>`);
  revisionPanel.element.querySelector('[data-agent-chat]').scrollTop=0;revisionPanel.open(button);
 }
 // TeTrato's original proposal next to what was saved: edited fields are shown side by side.
 async function openRevisionAnalysis(button){
  const data=cloud.proposalDetails;if(!data?.revision)return;
  const r=data.revision,title=uiText('proposalCard.analysis'),c=(key,values)=>uiText(`proposalCard.${key}`,values);
  revisionPanel??=createAgentPanel({cloud,id:'proposal-detail-title',className:'plan-recommendation-drawer proposal-detail-drawer'});
  const eyebrow=`TeTrato · ${uiText("Adenda v")}${r.revision_no}`;
  const shell=body=>`<div class="case-agent-shell"><header class="case-agent-header"><div class="case-agent-heading"><img class="case-agent-mascot" src="/assets/mascot/trato-guide.png" alt="" width="44" height="44"><div><span>${esc(eyebrow)}</span><h2 id="proposal-detail-title">${esc(title)}</h2></div></div><button type="button" class="case-agent-close" data-agent-close aria-label="${uiText('Cerrar')}" title="${uiText('Cerrar')}">${uiIcon('x')}</button></header><div class="case-agent-chat" data-agent-chat role="region" aria-label="${esc(title)}">${body}</div></div>`;
  const live=()=>revisionPanel.element.open&&cloud.proposalDetails?.revision?.id===data.revision.id,paint=body=>revisionPanel.render(shell(body));
  paint(`<p class="cloud-notice" role="status">${c('loading')}</p>`);revisionPanel.open(button);
  let value;
  try{value=await cloud.request(base(data)+'/ai-analysis');}
  catch(error){if(live())paint(`<p class="cloud-error" role="alert">${esc(error.message)}</p>`);return;}
  if(!live())return;
  if(!value){paint(`<p class="cloud-notice">${c('noAnalysis')}</p>`);return;}
  const p=value.proposal,norm=v=>String(v??'').replace(/\s+/g,' ').trim();
  const saved={scope_summary:r.scope_summary,conditions:r.conditions||'',description:data.line_items?.[0]?.description||''};
  const fields=[['scope_summary',uiText("Alcance del cambio")],['conditions',uiText("Condiciones")],['description',c('description')]];
  const edited=fields.filter(([key])=>norm(p[key])!==norm(saved[key]));
  // One row per cited document, opening the same PDF viewer as the proposal; its exact quotes stay underneath.
  const cited=new Map();
  for(const cite of p.citations||[]){if(!cite.file_id)continue;if(!cited.has(cite.file_id))cited.set(cite.file_id,{title:cite.title,quotes:[]});cited.get(cite.file_id).quotes.push(cite.quote);}
  const sources=cited.size?`<ul class="change-cited-sources">${[...cited].map(([id,doc])=>`<li><button type="button" class="change-cited-source" data-proposal-action="analysis-source" data-document-id="${esc(id)}" data-document-title="${esc(doc.title)}">${uiIcon('file-text')}<span>${esc(doc.title)}</span>${uiIcon('arrow-up-right')}</button><details class="plan-stage-deliverables"><summary>${uiText('changeDraft.quotesCount',{count:doc.quotes.length})}</summary>${doc.quotes.map(q=>`<blockquote>${esc(q)}</blockquote>`).join('')}</details></li>`).join('')}</ul>`:`<p>—</p>`;
  const rows=[[c('why'),`<p>${esc(p.reasoning)}</p>${p.estimated_hours?`<p class="proposal-ai-hours">${esc(c('hours',{hours:p.estimated_hours}))}</p>`:''}`],
   ...fields.map(([key,label])=>[label,edited.some(([k])=>k===key)
    ?`<span class="proposal-ai-tag is-edited">${c('edited')}</span><p class="proposal-ai-clamp">${esc(saved[key])}</p><button type="button" class="text-button proposal-ai-compare-open" data-proposal-action="analysis-compare" data-field="${key}">${uiIcon('git-compare-arrows')}${c('compareOpen')}</button>`
    :`<span class="proposal-ai-tag">${c('unchanged')}</span><p>${esc(p[key])}</p>`]),
   [c('sources'),sources]];
  compareFields=Object.assign(edited.map(([key,label])=>({key,label,before:String(p[key]??''),after:String(saved[key]??'')})),{eyebrow});lastReview=null;
  paint(`${edited.length?'<section class="proposal-ai-review" data-proposal-ai-review aria-live="polite"></section>':''}<section class="plan-recommended-stages"><ol>${rows.map(([label,body],i)=>`<li><span class="plan-reasoning-number">${i+1}</span><div><header><strong>${label}</strong></header>${body}</div></li>`).join('')}</ol></section>`);
  lastAnalysis={data,value};if(edited.length)void loadReview(data,value);
 }
 // TeTrato's review of the edited version, like the reviewed initial plan. Bound to the exact saved terms.
 async function loadReview(data,value,retry=false){
  const c=(key,values)=>uiText(`proposalCard.${key}`,values),slot=()=>revisionPanel?.element.open&&cloud.proposalDetails?.revision?.id===data.revision.id?revisionPanel.element.querySelector('[data-proposal-ai-review]'):null;
  // The drawer keeps a one-line verdict; the full review opens in a floating dialog.
  const show=review=>{const target=slot();if(!target)return;lastReview={review,eyebrow:`TeTrato · ${uiText("Adenda v")}${data.revision.revision_no}`};
   target.innerHTML=`<div class="proposal-ai-verdict-line ${review.material_change?'is-material':''}"><strong>${uiIcon(review.material_change?'flag':'check')}${c(review.material_change?'material':'notMaterial')}</strong><button type="button" class="text-button" data-proposal-action="analysis-review-open">${c('reviewOpen')}${uiIcon('arrow-up-right')}</button></div>`;};
  const fail=error=>{const target=slot();if(target)target.innerHTML=`<p class="cloud-error" role="alert">${esc(error?.message||c('reviewError'))}</p><button type="button" class="text-button" data-proposal-action="analysis-review-retry">${uiText('Reintentar')}</button>`;};
  if(value.review&&!retry){show(value.review);return;}
  const target=slot();if(!target)return;target.innerHTML=renderAIActivity({label:c('reviewing'),compact:true});
  const reviewBase=base(data)+'/ai-analysis/review';
  try{
   let job=await cloud.request(reviewBase,{method:'POST',headers:{'Content-Type':'application/json',...(retry?{'Idempotency-Key':crypto.randomUUID()}:{})},body:JSON.stringify({output_language:uiLanguage()})});
   while(job.status!=='completed'){
    if(['failed','unavailable'].includes(job.status))throw Error(c('reviewError'));
    await new Promise(resolve=>setTimeout(resolve,2000));if(!slot())return;
    job=await cloud.request(`${reviewBase}/${job.id}`);
   }
   if(slot())show(job.result);
  }catch(error){fail(error);}
 }
 function showSaving(form){
  form.hidden=true;
  const box=cloud.document.createElement('div');box.dataset.proposalSaving='';box.setAttribute('aria-busy','true');
  box.innerHTML=renderAIActivity({label:uiText('proposalCard.preparingEmail'),compact:true});form.after(box);
  return {restore(){if(box.isConnected)box.remove();if(form.isConnected)form.hidden=false;}};
 }
 async function preview(kind){
  const data=cloud.proposalDetails,project=cloud.projectId;
  cloud.show(kind==='adenda'?uiText('Enviar adenda al cliente'):uiText('Enviar solicitud de pago'),`<div data-mail-preview-loading aria-busy="true">${renderAIActivity({label:uiText('proposalCard.preparingEmail'),compact:true})}</div>`);
  const loading=cloud.modal.querySelector('[data-mail-preview-loading]');
  const current=()=>cloud.modal.open&&cloud.modal.querySelector('[data-mail-preview-loading]')===loading&&cloud.projectId===project&&cloud.proposalDetails?.revision.id===data.revision.id;
  let value;
  try{value=await cloud.request(base(data)+`/email-preview?kind=${kind}`);}
  catch(error){if(!current())error.uiHandled=true;throw error;}
  if(!current())return;
  if(!value.body_html)throw Error(uiText("No pudimos mostrar la vista previa del correo."));
  cloud.proposalPreview={kind,value,data};
  const mailBody=`<iframe class="cloud-mail-frame" sandbox="allow-same-origin" title="${esc(uiText("Vista previa del correo"))}"></iframe>`;
  cloud.show(kind==='adenda'?uiText("Enviar adenda al cliente"):uiText("Enviar solicitud de pago"),`<div class="cloud-mail-content"><div class="cloud-mail-context"><span class="cloud-mail-label">${kind==='adenda'?uiText("Propuesta de cambio"):uiText("Solicitud de pago")}</span><span>${uiText("Adenda v")}${data.revision.revision_no}</span></div><section class="cloud-mail-envelope" aria-label="${uiText("Vista previa del correo")}"><dl class="cloud-mail-addresses"><div><dt>${uiText("De")}</dt><dd>${esc(value.sender)}<span class="cloud-mail-provider">Gmail</span></dd></div><div><dt>${uiText("Para")}</dt><dd><span class="cloud-mail-recipient">${esc(value.recipient)}</span></dd></div></dl><div class="cloud-mail-message"><span class="cloud-mail-field-label">${uiText("ASUNTO")}</span><h3>${esc(value.subject)}</h3>${mailBody}</div></section>${kind==='adenda'?renderRevisionComparison(data.previous_sent,data.revision):''}<button type="button" class="cloud-mail-attachment" data-proposal-action="mail-pdf" aria-expanded="false" aria-controls="proposal-mail-pdf" aria-label="${uiText("Ver PDF adjunto")} ${esc(value.filename)}"><span class="cloud-mail-pdf" aria-hidden="true">PDF</span><span class="cloud-mail-file"><strong>${esc(value.filename)}</strong><small>${uiText("Adenda v")}${data.revision.revision_no} ${uiText("· Documento adjunto")}</small></span><span class="cloud-mail-file-action">${uiText("Ver PDF")} <span aria-hidden="true">↗</span></span></button><div id="proposal-mail-pdf" data-mail-pdf hidden></div></div><form data-cloud-form="proposal-send" class="cloud-mail-footer">${kind==='adenda'&&!data.reviews.length?`<p class="cloud-notice cloud-mail-confirmation">${uiText("Al enviar confirmas que revisaste esta versión y su PDF adjunto.")}</p>`:''}<button class="button secondary" type="button" data-cloud-close>${uiText("Cancelar")}</button><button class="button" type="submit">${uiIcon('send')}${uiText("Enviar correo →")}</button></form>`);
  cloud.modal.classList.add('cloud-mail-dialog');
  const frame=cloud.modal.querySelector('.cloud-mail-frame');
  if(frame){
   frame.addEventListener('load',()=>{
    const body=frame.contentDocument.body;
    const fit=()=>{frame.style.height=`${body.scrollHeight}px`;};
    fit();
    new frame.contentWindow.ResizeObserver(fit).observe(body);
   },{once:true});
   frame.srcdoc=value.body_html.replace('src="cid:mascot@trato"','src="/assets/mascot/trato-guide.png"')
    .replace(/ href="[^"]*"/g,' aria-disabled="true"')
    .replace('<head>',`<head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'"><meta name="referrer" content="no-referrer">`);
  }
  const footer=cloud.modal.querySelector('[data-cloud-form="proposal-send"]');
  const alert=cloud.modal.querySelector('[data-cloud-error]');
  if(footer&&alert)footer.prepend(alert);
  cloud.modal.scrollTop=0;
 }
 function openAcceptance(data,message=null,analysis=null){
  if(!data||data.proposal.current_revision_id!==data.revision.id||data.proposal.locked_at||data.acceptances.length||
     !data.deliveries.some(delivery=>delivery.kind==='adenda'&&delivery.status==='accepted_by_gmail')||
     (message&&message.revision_id!==data.revision.id))return;
  const attachments=(message?.attachment_metadata||[]).map((attachment,index)=>attachment.supported?
   `<button type="button" class="button secondary" data-proposal-action="acceptance-attachment" data-attachment-index="${index}">${uiIcon('file-text')}${esc(attachment.filename)}</button>`:'').join('');
  cloud.show(uiText("Registrar aceptación recibida"),`
   <p>${uiText("Adjunta el PDF que devolvió el cliente y revisa que corresponde a la adenda v")}${data.revision.revision_no}.</p>
   ${analysis?`<section class="cloud-client-feedback"><strong>${uiText('changeReply.evidence')}</strong>
    <blockquote class="cloud-email-reply-body">${esc(analysis.quote)}</blockquote></section>`:''}
   <form data-cloud-form="proposal-accept" data-revision-id="${esc(data.revision.id)}" data-message-id="${esc(message?.id)}">
    ${attachments?`<div class="cloud-tools">${attachments}</div>
     <iframe data-acceptance-pdf class="cloud-pdf-frame" title="${uiText("Vista previa del documento PDF")}" hidden></iframe>`:''}
    <label class="field">${uiText('PDF devuelto por el cliente')}<input class="context-box" name="file" type="file" accept=".pdf" required></label>
    <label class="field">${uiText("Resultado de tu revisión")}<textarea class="context-box" name="notes" required maxlength="4000">${esc(analysis?`${analysis.summary}\n\n${analysis.quote}`:'')}</textarea></label>
    <p>${uiText("Al guardar confirmas que revisaste la aceptación de esta versión. No se verifica criptográficamente una firma.")}</p>
    <button class="button" type="submit">${uiText("Guardar aceptación revisada →")}</button>
   </form>`);
  if(attachments){
   const form=cloud.modal.querySelector('[data-cloud-form="proposal-accept"]');
   form.elements.file.addEventListener('change',()=>{
    const frame=form.querySelector('[data-acceptance-pdf]');
    frame.hidden=true;frame.removeAttribute('src');cloud.releasePreview();
   });
  }
 }
 function showGmailReadConsent(){
  cloud.show(uiText("Buscar respuestas en Gmail"),`<p class="cloud-notice">${uiText("Para buscar respuestas, Google pedirá a Trato permiso de solo lectura para tu buzón. Ese permiso técnicamente permite acceder a los mensajes del buzón; Trato solo consultará, cuando lo solicites, los hilos de adendas enviados desde Trato. Guardará el texto plano y los datos necesarios para vincular cada respuesta a su versión. No almacenará los archivos adjuntos al sincronizar; podrás importar cada PDF por separado como documento privado del proyecto. Las respuestas no se aceptan ni generan nuevas adendas automáticamente.")}</p><form data-cloud-form="gmail-read-consent"><div class="dialog-actions"><button class="button secondary" type="button" data-cloud-close>${uiText("Cancelar")}</button><button class="button" type="submit">${uiText("Continuar a Google para autorizar")}</button></div></form>`);
 }
 async function checkClientReplies(data,{authorized=false}={}){
  if(!data||replySync||cloud.busy||cloud.proposalDetails?.revision.id!==data.revision.id)return;
  const state={project:cloud.projectId,epoch:cloud.epoch,revision:data.revision.id};
  const current=()=>cloud.projectId===state.project&&cloud.epoch===state.epoch&&cloud.tab==='gestion'&&cloud.proposalDetails?.revision.id===state.revision;
  const paint=()=>{
   if(!current())return;
   const panel=cloud.document.querySelector('.cloud-gmail-replies');
   if(!panel)return;
   const decision=panel.querySelector('.cloud-reply-decision');
   panel.insertAdjacentHTML('beforebegin',renderReplyPanel.call(cloud,data,true,true,false));
   if(decision)panel.previousElementSibling.querySelector('.cloud-replies-heading').after(decision);
   panel.remove();
  };
  replySync=state;cloud.gmailReplyError='';paint();
  try{
   if(!authorized){
    const status=await cloud.refreshGmailStatus();
    if(!current())return;
    if(!status.connected||!status.can_send)throw Error(status.delivery_mode==='trato'?uiText('gmailCentral.pending'):uiText("Conecta Gmail desde tu perfil antes de buscar respuestas."));
    if(!status.can_read){showGmailReadConsent();return;}
   }
   const before=new Set(cloud.gmailReplies.filter(m=>m.revision_id===state.revision).map(m=>m.id));
   syncStarted.set(state.project,Date.now());syncNotice=null;
   await cloud.request(`/api/v1/projects/${state.project}/gmail-replies/sync`,{method:'POST',body:'{}'});
   if(!current())return;
   const replies=await cloud.request(`/api/v1/proposals/${data.proposal.id}/gmail-replies`);
   if(current()){
    cloud.gmailReplies=replies;
    // Nothing new yet: the client's email can take a few minutes to reach the mailbox.
    const fresh=replies.some(m=>m.revision_id===state.revision&&!before.has(m.id));
    syncNotice=fresh?null:{revision:state.revision,text:uiText('gmailSync.noneYet')};
   }
  }catch(error){
   if(error.code==='GMAIL_SYNC_RATE_LIMITED'&&!syncStarted.has(state.project))syncStarted.set(state.project,Date.now());
   if(current())cloud.gmailReplyError=error.name==='TimeoutError'?uiText("La operación tardó demasiado. Actualiza antes de reintentar."):error.message;
  }finally{replySync=null;paint();}
 }
 cloud.click=function(event){
  const button=event.target.closest('[data-proposal-action]');
  if(!button){if(this.busy&&event.target.closest('[data-cloud-action="manage-change"]'))return;const manage=event.target.closest('[data-cloud-action="manage-change"]');originalClick(event);if(manage)this.run(()=>refresh(manage.dataset.cloudId,undefined,{reloadList:false}));return;}
  if(!this.active)return;
  const action=button.dataset.proposalAction,data=this.proposalDetails;
  if(action==='payment-detective'){this.openPaymentDetective?.(button,uiText('paymentDetective.focus'));return;}
  if(action==='prepare'){prepare();return;}if(action==='edit'){prepare('edit');return;}if(action==='revise'){prepare('revise');return;}
  if(action==='use-portal-request'||action==='analyze-portal-request'){
   const request=(this.portalRequests||[]).find(row=>row.id===button.dataset.requestId&&row.revision_id===data?.revision.id);
   if(button.disabled||!request||request.used_at||data.proposal.current_revision_id!==data.revision.id||data.proposal.locked_at||data.acceptances.length)return;
   const message={id:request.id,reply_text:request.notes,from_email:'',kind:'portal'};
   if(action==='analyze-portal-request')openReplyAssistant(button,message);else prepare('revise',message);return;
  }
  if(action==='use-gmail-reply'||action==='analyze-gmail-reply'){
   const message=this.gmailReplies.find(row=>row.id===button.dataset.messageId&&row.revision_id===data?.revision.id);
   if(button.disabled||!message||message.used_at||data.proposal.current_revision_id!==data.revision.id||data.proposal.locked_at||data.acceptances.length)return;
   if(action==='analyze-gmail-reply')openReplyAssistant(button,message);
   else prepare('revise',message);
   return;
  }
  if(action==='close-request'){
   this.closingRequestId=this.requestId;
   this.show(uiText("Cerrar pedido"),`<p>${uiText("Registra por qué no continuará este pedido. Sus documentos y versiones quedarán disponibles para consulta.")}</p><form data-cloud-form="proposal-close-request"><fieldset class="close-reason-choices"><legend class="field">${uiText("Motivo")}</legend>${[['rejected','x',"El cliente rechazó la propuesta"],['withdrawn','undo-2',"El cliente retiró el pedido"]].map(([value,glyph,label])=>`<label class="close-reason-choice"><input type="radio" name="reason" value="${value}" required><span class="close-reason-icon" aria-hidden="true">${uiIcon(glyph)}</span><span class="close-reason-label">${uiText(label)}</span></label>`).join('')}</fieldset><label class="field">${uiText("Detalle (opcional)")}<textarea class="context-box" name="notes" maxlength="4000"></textarea></label><div class="dialog-actions"><button class="button" type="submit">${uiText("Cerrar pedido")}</button><button class="button secondary" type="button" data-cloud-close>${uiText("Volver")}</button></div></form>`);
   return;
  }
  if(action==='invoice'){
   // The freelancer confirms what TeTrato will send: amount and recipient come from the accepted addendum.
   if(!data||data.proposal.current_revision_id!==data.revision.id||data.proposal.locked_at)return;
   const recipient=this.clients.find(client=>client.id===this.project()?.client_id)?.contact_email||'';
   this.show(uiText('invoice.title'),`<form data-cloud-form="proposal-invoice"><p>${uiText('invoice.intro')}</p><dl class="proposal-summary-terms"><div><dt>${uiText('changeReply.amount')}</dt><dd>${esc(amount(data.revision.additional_minor))}</dd></div><div><dt>${uiText('invoice.recipient')}</dt><dd>${esc(recipient)}</dd></div></dl><label class="field">${uiText('invoice.concept')}<input class="context-box" name="concept" required maxlength="200"></label><div data-invoice-concept-status></div><p class="field-help">${uiText('invoice.oneWay')}</p><div class="dialog-actions"><button class="button" type="submit">${uiIcon('send')}${uiText('invoice.confirm')}</button><button class="button secondary" type="button" data-cloud-close>${uiText('Volver')}</button></div></form>`);
   fillInvoiceConcept(this,this.modal.querySelector('[data-cloud-form="proposal-invoice"]'),{target:'addendum',proposal_id:data.proposal.id,revision_id:data.revision.id});
   return;
  }
  if(action==='gmail-sync'){void checkClientReplies(data);return;}
  this.run(async()=>{
   if(action==='view-gmail-pdf'){
    const project=this.projectId,epoch=this.epoch,message=this.gmailReplies.find(row=>row.id===button.dataset.messageId),index=Number(button.dataset.attachmentIndex),attachment=message?.attachment_metadata?.[index];
    if(!message||!attachment?.supported)throw Error(uiText("Solo se pueden importar adjuntos PDF compatibles."));
    const blob=await this.request(`/api/v1/proposals/${data.proposal.id}/gmail-replies/${message.id}/attachments/${index}`,{},true);
    if(project!==this.projectId||epoch!==this.epoch)return;
    if(blob.type.split(';')[0]!=='application/pdf'||blob.size>10485760)throw Error(uiText("El servidor no devolvió un documento PDF."));
    this.show(uiText("Ver PDF adjunto"),`<div class="cloud-preview-toolbar"><span>${esc(attachment.filename)}</span><a class="text-button" data-preview-download>${uiText("Descargar PDF ↗")}</a></div><iframe class="cloud-pdf-frame" title="${uiText("Vista previa del documento PDF")}"></iframe>`);
    this.modal.classList.add('cloud-document-preview');this.previewUrl=URL.createObjectURL(blob);
    this.modal.querySelector('iframe').src=this.previewUrl+'#view=FitH';
    const link=this.modal.querySelector('[data-preview-download]');link.href=this.previewUrl;link.download=attachment.filename;return;
   }
   if(action==='import-gmail-pdf'){
    const message=this.gmailReplies.find(row=>row.id===button.dataset.messageId),index=Number(button.dataset.attachmentIndex),attachment=message?.attachment_metadata?.[index];
    if(!message||!attachment?.supported)throw Error(uiText("Solo se pueden importar adjuntos PDF compatibles."));
    const blob=await this.request(`/api/v1/proposals/${data.proposal.id}/gmail-replies/${message.id}/attachments/${index}`,{},true);
    if(blob.type!=='application/pdf'||blob.size>10485760)throw Error(uiText("Solo se pueden importar adjuntos PDF compatibles."));
    const title=gmailFeedbackTitle(message,index,attachment);
    const idempotency=`gmail-feedback-${message.id}-${index}`;
    await this.request(`/api/v1/projects/${this.projectId}/documents?${new URLSearchParams({filename:attachment.filename,title,kind:'reference',purpose:'addendum_adjustments',revision_id:data.revision.id})}`,{method:'POST',body:blob,headers:{'Content-Type':'application/pdf','Idempotency-Key':idempotency}});
    await this.loadProject();const imported=this.documents.find(doc=>doc.title===title);
    if(!imported)throw Error(uiText("No se pudo vincular el adjunto importado al proyecto."));
    this.gmailImportedFeedbackDocs.set(`${message.id}:${index}`,imported.id);
    await refresh(this.requestId,undefined,{reloadList:true});this.message=uiText("Se importó el adjunto. Espera a que termine la lectura del documento antes de preparar la nueva adenda.");this.notify();return;
   }
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
   if(action==='details'){openRevisionDetails(button);return;}
   if(action==='analysis'){await openRevisionAnalysis(button);return;}
   if(action==='analysis-compare'){openCompare(button.dataset.field);return;}
   if(action==='analysis-review-open'){openReview();return;}
   if(action==='analysis-source'){await cloud.previewCitedDocument?.(button.dataset.documentId,button.dataset.documentTitle);return;}
   if(action==='analysis-review-retry'&&lastAnalysis){void loadReview(lastAnalysis.data,lastAnalysis.value,true);return;}
   if(action==='pdf'){
    const doc=data.artifacts[0];await this.previewDocument(doc.document_id,{title:`${uiText("Adenda v")}${data.revision.revision_no}`,original_filename:`adenda-v${data.revision.revision_no}.pdf`,mime_type:'application/pdf'});
   }
   if(action==='save-pdf'){await this.request(base(data)+'/pdf',{method:'POST'});await refresh();}
   if(action==='preview')await preview(button.dataset.kind);
   if(action==='accept')openAcceptance(data);
   if(action==='acceptance-attachment'){
    const form=button.closest('[data-cloud-form="proposal-accept"]');
    const message=cloud.gmailReplies.find(row=>row.id===form?.dataset.messageId&&row.revision_id===data?.revision.id);
    const index=Number(button.dataset.attachmentIndex),attachment=message?.attachment_metadata?.[index];
    if(!attachment?.supported||form.dataset.revisionId!==data.revision.id)return;
    const blob=await this.request(`/api/v1/proposals/${data.proposal.id}/gmail-replies/${message.id}/attachments/${index}`,{},true);
    if(!form.isConnected||!this.modal.open||data.revision.id!==this.proposalDetails?.revision.id)return;
    if(blob.type.split(';')[0]!=='application/pdf'||!blob.size||blob.size>10485760)throw Error(uiText("Selecciona un PDF de hasta 10 MB."));
    const files=new DataTransfer();
    files.items.add(new File([blob],attachment.filename,{type:'application/pdf'}));
    form.elements.file.files=files.files;
    this.releasePreview();this.previewUrl=URL.createObjectURL(blob);
    const frame=form.querySelector('[data-acceptance-pdf]');
    frame.src=this.previewUrl+'#view=FitH';frame.hidden=false;
   }
   if(action==='payment'){
    // Open the payment request at once; the charge is created and the card updated quietly behind it.
    this.show(uiText("Enviar solicitud de pago"),renderAIActivity({label:uiText('proposalCard.preparingPayment'),compact:true}));this.modal.classList.add('cloud-mail-dialog');
    try{await this.request(base(data)+'/payment',{method:'POST'});await refresh(this.requestId,undefined,{reloadStatus:true,quiet:true});await preview('payment');}
    catch(error){if(this.modal.open)this.show(uiText("Enviar solicitud de pago"),`<p class="cloud-error" role="alert">${esc(error.message)}</p>`);error.uiHandled=true;await refresh(this.requestId,undefined,{quiet:true}).catch(()=>{});}
   }
   if(action==='reconcile'){
    // PayPal takes a couple of seconds: the button says so at once, so the click is never in doubt.
    button.disabled=true;button.innerHTML=`${uiIcon('refresh-cw')}${uiText('payment.checking')}`;
    await this.request(base(data)+'/reconcile',{method:'POST'});this.historyGeneration++;this.historyLoaded=false;this.historyPending=null;this.projectActivity=[];await refresh(this.requestId,undefined,{reloadStatus:true});}
   if(action==='versions'){await openVersions(button,data);return;}
   if(action==='view-reply-doc'){
    const doc=this.documents.find(d=>d.id===button.dataset.documentId);
    await this.previewDocument(button.dataset.documentId,{title:doc?.title||uiText('clientReply.returnedDocument'),original_filename:doc?.original_filename||'respuesta.pdf',mime_type:doc?.mime_type||'application/pdf'});return;
   }
   if(action==='version'){revisionPanel?.element.open&&revisionPanel.element.close();await refresh(this.requestId,button.dataset.revision,{reloadList:false});}
  });
 };
 cloud.submit=async function(event){
  const kind=event.target.dataset.cloudForm;
  if(kind==='gmail-read-consent'){
   const data=this.proposalDetails;
   let authorized=false;
   await this.run(async()=>{
    const status=await this.authorizeGmailRead();
    if(!status?.can_read)throw Error(uiText("El permiso de lectura de Gmail no está activo."));
    this.modal.close();authorized=true;
   });
   if(authorized)await checkClientReplies(data,{authorized});
   return;
  }
  if(!kind?.startsWith('proposal-'))return originalSubmit(event);
  const values=new FormData(event.target),sendWithSave=event.submitter?.value==='send';let reviewBeforeSend=false,saving=null;
  await this.run(async()=>{try{
   // «Save and review email» answers at once: the form gives way to TeTrato's activity, and comes back if anything fails.
   if(kind==='proposal-terms'&&sendWithSave)saving=showSaving(event.target);
   let data=this.proposalDetails;
   if(kind==='proposal-invoice'){
    if(!data||data.proposal.current_revision_id!==data.revision.id)throw Error(uiText('invoice.changed'));
    const form=event.target;form.querySelectorAll('button,input,textarea').forEach(b=>b.disabled=true);
    form.insertAdjacentHTML('beforeend',`<div data-invoice-sending style="margin-top:20px">${renderAIActivity({label:uiText('invoice.sending'),compact:true})}</div>`);
    try{await this.request(base(data)+'/invoice',this.json({concept:values.get('concept'),confirmed:true}));}
    catch(error){form.querySelectorAll('button,input,textarea').forEach(b=>b.disabled=false);form.querySelector('[data-invoice-sending]')?.remove();throw error;}
    // PayPal Sandbox does not email real inboxes: Trato's own payment email carries the invoice link, sent in the same step.
    // The activity stays until that email is out too, so the window never looks idle while it works.
    let mailed=true;
    try{const mail=await this.request(base(data)+'/email-preview?kind=payment');await this.request(base(data)+'/email?kind=payment',this.json({digest:mail.digest,confirmed:true}));}
    catch{mailed=false;}
    // The result in the same window, at once; the request card updates quietly behind it instead of reloading the view.
    this.show(uiText(mailed?'invoice.sentTitle':'invoice.sentNoEmailTitle'),`<p role="status">${esc(uiText(mailed?'invoice.sentWithEmail':'invoice.emailFailed'))}</p><div class="dialog-actions"><button type="button" class="button" data-cloud-close>${uiText('Cerrar')}</button></div>`);
    this.historyGeneration++;this.historyLoaded=false;this.historyPending=null;this.projectActivity=[];
    void refresh(this.requestId,undefined,{reloadStatus:true,quiet:true}).catch(error=>{this.message=error.message;this.notify();});
    return;
   }
   if(kind==='proposal-close-request'){
    const id=this.closingRequestId;
    await this.request(`/api/v1/requests/${id}/close`,this.json({reason:values.get('reason'),notes:values.get('notes')}));
    this.modal.close();this.tab='acuerdo';await this.loadProject();return;
   }
   if(kind==='proposal-terms'){
    const state=this.proposalForm;
    if(state.mode==='revise'&&!state.emailFeedbackId&&!state.portalRequestId){
     const file=values.get('feedbackFile');
     const sha=file?.size?Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer())),byte=>byte.toString(16).padStart(2,'0')).join(''):null;
     if(sha!==state.feedbackSha||cloud.revisionDraftNotes?.()==null)throw Error(uiText('changeSteps.feedbackChanged'));
    }
    if(sendWithSave&&!state.recipient)throw Error(uiText("El cliente necesita un correo registrado antes de enviar."));
    const fingerprint=JSON.stringify([...values.entries()].map(([name,value])=>[name,typeof value==='string'?value:{name:value.name,size:value.size,lastModified:value.lastModified}]));
    if(state.saved&&state.savedFingerprint!==fingerprint)throw Error(uiText("Esta adenda ya se guardó. Cierra esta ventana y consulta la adenda guardada antes de cambiarla."));
    if(!state.saved){
     const raw=String(values.get('amount')).replace(',','.');if(!/^\d+(\.\d{1,2})?$/.test(raw))throw Error(uiText("Escribe el importe con un máximo de dos decimales."));
     const [units,cents='']=raw.split('.'),minor=Number(units)*100+Number(cents.padEnd(2,'0'));if(!Number.isSafeInteger(minor)||minor>99999999999)throw Error(uiText("El importe supera el máximo permitido."));
     const terms={scope_summary:values.get('scope'),conditions:values.get('conditions'),currency:'USD',deadline:values.get('deadline'),line_items:[{description:values.get('description'),quantity:1,unit_amount_minor:minor}]};
     const sources=state.old?state.old.sources.map(s=>s.document_id):[...this.initialSources().filter(d=>this.sourceReady(d)).map(d=>d.id),this.requestId];
     if(state.mode==='revise'){
      if(state.emailFeedbackId){
       const reply=this.gmailReplies.find(message=>message.id===state.emailFeedbackId);
       const importedIds=(reply?.attachment_metadata||[]).map((attachment,index)=>gmailImportedDocumentId(reply,index,attachment)).filter(Boolean);
       for(const importedId of importedIds){const doc=this.documents.find(item=>item.id===importedId);if(this.sourceReady(doc)&&!sources.includes(importedId))sources.push(importedId);}
      }else if(!state.feedbackId&&!state.portalRequestId){
       const file=values.get('feedbackFile');if(!file?.size||file.size>10485760)throw new Error(uiText("Adjunta el PDF con los ajustes del cliente, de hasta 10 MB."));
       const upload=await this.request(`/api/v1/projects/${this.projectId}/documents?${new URLSearchParams({filename:file.name,title:`${uiText("Ajustes del cliente a la adenda v")}${state.old.revision.revision_no}`,kind:'reference',purpose:'addendum_adjustments',revision_id:state.old.revision.id})}`,{method:'POST',body:file,headers:{'Content-Type':'application/pdf','Idempotency-Key':'feedback-'+state.key}});
       state.feedbackId=upload.document.id;
      }
      if(state.feedbackId)sources.push(state.feedbackId);
     }
     const body=state.old?{expected_revision_id:state.old.revision.id,terms,source_document_ids:sources}:{request_document_id:this.requestId,terms,source_document_ids:sources};
     if(state.mode==='revise'){
      if(state.emailFeedbackId){body.feedback_email_id=state.emailFeedbackId;const reply=this.gmailReplies.find(message=>message.id===state.emailFeedbackId),importedId=(reply?.attachment_metadata||[]).map((attachment,index)=>gmailImportedDocumentId(reply,index,attachment)).find(id=>id&&sources.includes(id));if(importedId)body.feedback_document_id=importedId;}
      else if(state.portalRequestId)body.feedback_portal_request_id=state.portalRequestId;
      else body.feedback_document_id=state.feedbackId;
      body.feedback_notes=state.emailFeedbackId||state.portalRequestId?values.get('feedbackNotes'):cloud.revisionDraftNotes();
     }
     const url=state.old?`/api/v1/proposals/${state.old.proposal.id}/${state.mode==='edit'?'draft':'revisions'}`:`/api/v1/projects/${this.projectId}/proposals`;
     state.saved=await this.request(url,{...this.json(body),headers:{'Content-Type':'application/json','Idempotency-Key':state.key}});
     state.savedFingerprint=fingerprint;
    }
    const savedBase=`/api/v1/proposals/${state.saved.proposal_id}/revisions/${state.saved.revision_id}`;
    // Keep TeTrato's original proposal with this version, so later edits can be compared with it. Retried on resubmit.
    if((!state.old||state.mode==='revise'&&!state.emailFeedbackId)&&!state.analysisSaved){const draftJob=this.changeDraftAnalysisJob?.();if(draftJob)await this.request(savedBase+'/ai-analysis',this.json({change_proposal_job_id:draftJob}));state.analysisSaved=true;}
    const artifact=await this.request(savedBase+'/pdf',{method:'POST'});
    if(sendWithSave){
     const value=await this.request(savedBase+'/email-preview?kind=adenda');
     if(value.recipient.toLowerCase()!==state.recipient.toLowerCase())throw Error(uiText("El correo del cliente cambió. Revisa el destinatario antes de enviar la adenda guardada."));
     // Nothing reaches the client yet: the exact email and PDF are shown first; review and sending happen on confirmation.
     reviewBeforeSend=true;
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
    if(event.target.dataset.revisionId!==data?.revision.id)throw Error(uiText('changeReply.unavailable'));
    const file=values.get('file');if(!file?.size||file.size>10485760)throw Error(uiText("Selecciona un PDF de hasta 10 MB."));
    // Preserve retries of the same upload while allowing a corrected returned PDF.
    const uploadDigest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await new Blob([file.name,'\0',file]).arrayBuffer())),byte=>byte.toString(16).padStart(2,'0')).join('');
    const upload=await this.request(base(data)+`/returned-pdf?${new URLSearchParams({filename:file.name})}`,{method:'POST',body:file,headers:{'Content-Type':'application/pdf','Idempotency-Key':'return-'+data.revision.id+'-'+uploadDigest}});
    await this.request(`/api/v1/proposals/${data.proposal.id}/acceptance`,{...this.json({expected_revision_id:data.revision.id,document_id:upload.document_id,confirmed:true,review_notes:values.get('notes')}),headers:{'Content-Type':'application/json','Idempotency-Key':'accept-'+data.revision.id}});
   }
   if(!reviewBeforeSend)this.modal.close();
   if(kind==='proposal-send'){
    const sentKind=this.proposalPreview?.kind;
    this.historyGeneration++;this.historyLoaded=false;this.historyPending=null;this.projectActivity=[];await refresh();
    // Confirm the send once the card reflects it; the Spam hint stays on the card while waiting for the client.
    this.message=uiText(sentKind==='payment'?'mailSent.payment':'mailSent.adenda');this.notify();
   }
   else if(reviewBeforeSend){
    // Straight to the addendum email: the saved version is read quietly behind the open window, without reloading the view.
    try{await refresh(this.requestId,undefined,{reloadList:true,reloadStatus:true,quiet:true});}
    catch(error){error.uiHandled=false;throw error;}
    saving=null;await preview('adenda');
    void this.refreshDocumentList?.().catch(()=>{});
   }
   else {await this.loadProject();await refresh(this.requestId,undefined,{reloadList:false});}
  }catch(error){saving?.restore();throw error;}});
 };
}
