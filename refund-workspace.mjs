import {uiText,uiLocale,uiLanguage} from './i18n.mjs';
import {icon} from './icons.mjs';
import {renderRefundDocuments,renderInitialPayment,documentAction,documentInput,documentSubmit} from './refund-documents.mjs';
import {isFinancialAction,financialPath,financeError,renderRefundFinance,renderFinancialPending,loadRefundFinance,financialAction,financialInput,financialSubmit} from './refund-finance.mjs';
import {parseRefundMoney,refundInputMoney,percentageMinor,previewRefund,allocateRefund} from './refund-form.mjs';
import {confirmPayPalRefund} from './refund-paypal-modal.mjs';

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const t=(key,values)=>uiText(`refund.${key}`,values);
const money=v=>new Intl.NumberFormat(uiLocale(),{style:'currency',currency:'USD'}).format(v/100);
const date=v=>new Intl.DateTimeFormat(uiLocale(),{dateStyle:'medium',timeStyle:'short',timeZone:'America/Lima'}).format(new Date(v));
const button=(action,key,attrs='')=>`<button type="button" class="button secondary" data-refund-action="${action}" ${attrs}>${t(key)}</button>`;
const option=(value,label,selected)=>`<option value="${esc(value)}" ${value===selected?'selected':''}>${esc(label)}</option>`;
const statuses=['draft','awaiting_response','adjustments_requested','accepted','refund_pending','completed','closed_without_refund','rejected','withdrawn'];
const terminalStatuses=['completed','closed_without_refund','rejected','withdrawn'];
const detailAction=status=>terminalStatuses.includes(status)?'wizard.viewDetails':'wizard.resume';
const codes={REFUND_ALLOCATION_REQUIRED:'allocationMismatch',REFUND_ALLOCATION_MISMATCH:'allocationMismatch',REFUND_PAYMENTS_CHANGED:'paymentsChanged',REFUND_PAYMENTS_REVIEW_REQUIRED:'reviewRequired',REFUND_PAYMENT_CONTEXT_MISMATCH:'paymentUnavailable',REFUND_INITIAL_REFERENCE_REQUIRED:'initialReference',REFUND_PAYER_MISMATCH:'payerMismatch',REFUND_PDF_REQUIRED:'pdfRequired',REFUND_REVIEW_REQUIRED:'pdfRequired',REFUND_PDF_LANGUAGE_LOCKED:'pdfLanguageLocked',REFUND_PDF_HASH_MISMATCH:'pdfHashMismatch',REFUND_SEND_REQUIRED:'sendRequired',EMAIL_PREVIEW_CHANGED:'emailChanged',EMAIL_DELIVERY_UNCERTAIN:'emailUncertain',GMAIL_SENDER_CHANGED:'emailChanged',GMAIL_NOT_CONNECTED:'gmailRequired',GMAIL_READ_PERMISSION_REQUIRED:'gmailRequired',GMAIL_READ_NOT_AUTHORIZED:'gmailRequired',GMAIL_SEND_FAILED:'gmailFailed',GMAIL_READ_FAILED:'gmailFailed',INVALID_REFUND_AMOUNT:'invalidMoney',REFUND_DUPLICATE_CONCEPT:'duplicateConcept',REFUND_AMOUNT_OVERFLOW:'invalidMoney',REFUND_PERCENTAGE_MISMATCH:'invalidRate',REFUND_EVIDENCE_REQUIRED:'evidenceRequired',INVALID_IDEMPOTENCY_KEY:'invalidForm',REFUND_EVIDENCE_MISMATCH:'evidenceMismatch',REFUND_REVISION_CONFLICT:'revisionConflict',REFUND_SETTLEMENT_READ_ONLY:'readOnly',REFUND_PAYMENT_NOT_ELIGIBLE:'paymentUnavailable',PAYMENT_NOT_FOUND:'paymentUnavailable',REFUND_NOT_FOUND:'notFound',REFUND_SNAPSHOT_NOT_FOUND:'notFound',PROJECT_HAS_OPEN_REQUEST:'openRequest',REFUND_PROPOSAL_AMOUNT_MISMATCH:'amountMismatch',REFUND_EXCEEDS_AVAILABLE:'exceeds',REFUND_PRIOR_SETTLEMENT_CONFLICT:'priorConflict',IDEMPOTENCY_KEY_CONFLICT:'keyConflict',INVALID_REQUEST:'invalidForm',INVALID_REFUND_INPUT:'invalidForm'};
function message(error){
 if(error?.code==='GMAIL_RECONNECT_REQUIRED')return t('gmailReconnectRequired');
 if(error?.code==='REFUND_PAYMENT_IN_DISPUTE')return t('paymentInDispute');
 if(error?.message?.startsWith('refundFinance.')||error?.code&&/^(REFUND_(FINANCIAL|RECOVERY|REPLAY|RECONCILIATION|REFERENCE|EXECUTION|PREVIOUS_OPERATION|RECEIPT|CAPTURE)|PAYPAL_)/.test(error.code))return financeError(error);
 if(error?.code&&codes[error.code])return t(codes[error.code]);
 if(typeof error?.message==='string'&&/^refund\./.test(error.message))return uiText(error.message);
 return t('apiError');
}
const emptyItem=()=>({concept_id:crypto.randomUUID(),kind:'recognized_work',beneficiary:'seller',description:'',amount:'',mode:'fixed',base:'',rate:'',evidence:[]});
function editItem(item){return {...item,amount:refundInputMoney(item.amount_minor),mode:item.percentage?'percent':'fixed',base:item.percentage?refundInputMoney(item.percentage.base_minor):'',rate:item.percentage?refundInputMoney(item.percentage.basis_points):'',evidence:item.evidence.map(c=>({...c}))};}
export function buildRefundTerms(editor,payment){
 if(!payment)throw Error('refund.paymentUnavailable');
 const adjustments=editor.items.map(item=>{
  const percentage=item.mode==='percent'?percentageMinor(item.base,item.rate):null;
  if(!item.description.trim()||!item.evidence.length)throw Error('refund.evidenceRequired');
  return {concept_id:item.concept_id,kind:item.kind,beneficiary:item.beneficiary,description:item.description.trim(),
   amount_minor:percentage?percentage.amount_minor:parseRefundMoney(item.amount),
   percentage:percentage?{base_minor:percentage.base_minor,basis_points:percentage.basis_points}:null,
   evidence:item.evidence.map(c=>({...c}))};
 });
 if(!editor.conditions.trim())throw Error('refund.conditionsRequired');
 const result=previewRefund(payment.amount_minor,payment.local_previous_refunds_minor,adjustments);
 const allocations=payment.scope==='project_closure'?allocateRefund(result.refund_minor,payment.members):null;
 if(allocations&&(allocations.length!==payment.members.length||new Set(allocations.map(a=>a.payment_id)).size!==payment.members.length||allocations.some(a=>!payment.members.some(p=>p.id===a.payment_id&&a.refund_minor<=p.amount_minor-p.local_previous_refunds_minor))||allocations.reduce((sum,a)=>sum+a.refund_minor,0)!==result.refund_minor))throw Error('refund.allocationMismatch');
 return {terms:{currency:'USD',adjustments,conditions:editor.conditions.trim(),proposed_refund_minor:result.refund_minor,...(allocations?{allocations}:{})},result};
}

export function installRefundWorkspace(cloud){
 const originalReset=cloud.reset.bind(cloud);
 const wizard=cloud.document.createElement('dialog');wizard.className='refund-dialog';wizard.setAttribute('aria-label',t('wizard.title'));cloud.document.body.append(wizard);
 const releaseReader=s=>{if(s?.reader?.url)URL.revokeObjectURL(s.reader.url);if(s)s.reader=null;};
 cloud.reset=function(){releaseReader(this.refundState);wizard.close();this.refundState=null;originalReset();};
 wizard.addEventListener('cancel',event=>{event.preventDefault();const s=cloud.refundState;if(s&&!s.busy){s.wizardOpen=false;s.financeForm=null;if(s.editor)s.editor.reviewed=false;wizard.close();notify(s);}});
 function uploadContext(s){
  const parent=s.detail?.settlement;
  const payment=parent?.payment_id||s.request?.payment_id||(s.request?.scope==='project_closure'?[...s.payments].sort((a,b)=>a.id.localeCompare(b.id))[0]?.id:null);
  return {purpose:parent?'refund_evidence':'refund_request',...(parent?.id?{refund_case_id:parent.id}:{}),
   ...(s.snapshot?.id&&parent?{snapshot_id:s.snapshot.id}:{}),...(payment?{payment_id:payment}:{})};
 }
 let uploadModal=null;
 function bindUploadModal(){
  if(uploadModal===cloud.modal)return;
  uploadModal=cloud.modal;
  uploadModal.addEventListener('close',()=>{setTimeout(()=>{const s=cloud.refundState;if(s?.resumeAfterUpload&&current(s)&&!cloud.modal.open){s.resumeAfterUpload=false;s.wizardOpen=true;notify(s);}},0);});
 }
 const identity=()=>cloud.session?.session?.user?.id;
 function state(){
  const context=identity()+':'+cloud.projectId;
  if(cloud.refundState?.context!==context){releaseReader(cloud.refundState);wizard.close();}
  if(cloud.refundState?.context!==context){
   const s={wizardOpen:false,step:null,reader:null,context,project:cloud.projectId,owner:identity(),loaded:false,loading:false,busy:false,error:'',items:[],payments:[],status:null,view:'list',pdfLanguage:uiLanguage(),documentData:null,workflowForm:null,emailPreview:null,financeData:null,financeCheck:null,financeForm:null,financeError:'',financeNotice:'',notice:'',detail:null,snapshot:null,editor:null,request:null,pick:null,pending:null,pendingBody:null};
   cloud.refundState=s;
   try{s.pending=JSON.parse(cloud.storage.getItem(storageKey(s))||'null');if(s.pending&&(!/^[a-z0-9-]{1,128}$/i.test(s.pending.key)||!['create','edit_draft','close','initial','pdf','review','send','feedback','acceptance'].includes(s.pending.action)&&!isFinancialAction(s.pending.action)))throw Error();if(isFinancialAction(s.pending?.action))s.pendingBody=s.pending.body||null;}
   catch{s.storageError=true;s.error=t('storageError');}
  }
  return cloud.refundState;
 }
 const storageKey=s=>`trato:refund-operation:${s.owner}:${s.project}`;
 const current=s=>cloud.refundState===s&&cloud.active&&identity()===s.owner&&cloud.projectId===s.project;
 const notify=s=>{if(current(s))cloud.notify();};
 cloud.invalidateRefundList=project=>{
  const s=cloud.refundState;
  if(s?.project===project&&s.owner===identity())s.refreshPayments=true;
 };
 // Back on the tab, the refund list reloads by itself (like the rest of Trato), never in the middle of a step.
 let refundsHidden=cloud.document?.visibilityState==='hidden';
 cloud.document?.addEventListener?.('visibilitychange',()=>{
  if(cloud.document.visibilityState==='hidden'){refundsHidden=true;return;}
  if(!refundsHidden)return;refundsHidden=false;
  const s=cloud.refundState;
  if(s&&current(s)&&cloud.tab==='devoluciones'&&s.loaded&&!s.busy&&!s.pending&&!s.wizardOpen&&!cloud.modal?.open)void load(s);
 });
 // Never for money or email sends (those keep their explicit recovery): only registering, drafts, reviews and closes.
 const autoRecoverable=p=>!!p&&!isFinancialAction(p.action)&&p.action!=='send';
 async function autoRecover(s){
  try{await queryPending(s);}catch{}
  if(!current(s)||!s.pending){if(current(s))s.error='';return;}
  s.error='';
  if(s.pendingBody){try{await sendPending(s);}catch(error){if(current(s)&&!s.pending)s.error=message(error);}}
  else clearPending(s);
 }
 function clearPending(s){cloud.storage.removeItem(storageKey(s));s.pending=null;s.pendingBody=null;}
 async function run(s,fn){
  if(s.busy||!current(s))return;
  s.busy=true;s.error='';s.notice='';notify(s);
  try{await fn();}catch(error){if(current(s))s.error=message(error);}
  finally{if(current(s)){s.busy=false;notify(s);}}
 }
 async function load(s){
  if(s.loading)return;s.loading=true;s.error='';s.refreshPayments=false;
  try{
   // A busy or briefly unavailable server (for example while PayPal Sandbox is slow) is retried quietly a few times;
   // only a failure that persists is shown. A screen already loaded keeps its data meanwhile.
   const read=async()=>{for(let attempt=0;;attempt++){try{return await readAll();}catch(error){
    if(attempt>=3||error?.status&&error.status<500&&error.status!==429||!current(s))throw error;
    await new Promise(resolve=>setTimeout(resolve,1500*(attempt+1)));}}};
   const readAll=()=>Promise.all([cloud.request(`/api/v1/projects/${s.project}/refunds`),cloud.request(`/api/v1/projects/${s.project}/refund-payments`),cloud.request(`/api/v1/projects/${s.project}/request-status`),
    cloud.request(`/api/v1/projects/${s.project}/client-refund-requests`).catch(()=>null)]);
   const [items,payments,status,requests]=await read();
   if(!current(s))return;
   if(!Array.isArray(items)||items.some(x=>x.project_id!==s.project||!statuses.includes(x.status))||!Array.isArray(payments)||typeof status?.can_register!=='boolean')throw Error();
   s.items=items;s.payments=payments;s.status=status;s.loaded=true;cloud.requestStatus=status;
   s.clientRequests=Array.isArray(requests)?requests.filter(r=>r.project_id===s.project):null;
  }catch(error){if(current(s))s.error=message(error);}
  finally{if(current(s)){s.loading=false;notify(s);}}
 }
 async function openDetail(s,id,snapshotId){
  const detail=await cloud.request(`/api/v1/refunds/${id}`);
  if(!current(s))return;
  if(detail.settlement?.id!==id||detail.settlement.project_id!==s.project)throw Error();
  const selected=snapshotId||detail.settlement.current_snapshot_id;
  const data=selected?await cloud.request(`/api/v1/refunds/${id}/snapshots/${selected}`):null;
  if(!current(s))return;
  if(data&&(data.settlement?.id!==id||data.settlement.project_id!==s.project||data.snapshot?.settlement_id!==id||data.snapshot.id!==selected))throw Error();
  if(s.detail?.settlement.id!==id||s.snapshot?.id!==selected){s.financeData=null;s.financeCheck=null;}
  s.financeForm=null;s.financeNotice='';
  s.detail=detail;s.snapshot=data?.snapshot||null;s.documentData=data;s.workflowForm=null;s.emailPreview=null;if(s.mailNoteSnapshot!==selected){s.mailNote='';s.mailNoteSnapshot=selected;}s.editor=null;s.closure=null;s.pick=null;s.view='detail';s.wizardOpen=true;s.step=null;
  await loadRefundFinance(s,cloud,{current});
 }
 function payment(s){
  const parent=s.detail?.settlement;
  if(parent?.scope!=='project_closure')return s.payments.find(p=>p.id===parent?.payment_id);
  const ids=s.detail.payments.map(p=>p.payment_id),members=s.payments.filter(p=>ids.includes(p.id));
  if(members.length!==ids.length)return null;
  return {scope:'project_closure',members,amount_minor:members.reduce((n,p)=>n+p.amount_minor,0),local_previous_refunds_minor:members.reduce((n,p)=>n+p.local_previous_refunds_minor,0)};
 }
 // The client asked for everything still refundable on that payment: one button refunds it, without a proposal email.
 function quickRefund(s,r){
  const p=s.payments.find(x=>x.id===r.received_payment_id);
  return !!p&&r.status==='open'&&r.requested_minor===p.amount_minor-p.local_previous_refunds_minor;
 }
 // Registered by that button (no documentary evidence) and not finished yet.
 function quickUnfinished(s,r){
  const x=r.status==='registered'&&s.items.find(i=>i.id===r.settlement_id);
  return !!x&&Array.isArray(x.request_evidence)&&!x.request_evidence.length&&['draft','accepted','refund_pending'].includes(x.status);
 }
 // The row opens the conversation, like a reported problem; refunding or declining is decided there.
 function clientRequestActions(s,r){
  if(s.refundingRequest===r.id)return `<button type="button" class="button" disabled>${t('clientRequests.refunding')}</button>`;
  return `<button type="button" class="button" data-refund-action="client-thread" data-id="${esc(r.id)}" ${s.busy||s.pending||s.storageError?'disabled':''}>${icon('messages-square')}${t('clientRequests.open',{count:(r.messages||[]).length+1})}</button>`;
 }
 function clientThreadHtml(s,r){
  const item=(author,body,at)=>`<li class="is-${author==='client'?'buyer':'seller'}"><small>${uiText(author==='client'?'problems.by.client':'problems.by.you')}${at?` · ${esc(date(at))}`:''}</small><p>${esc(body)}</p></li>`;
  const list=[item('client',r.reason,r.created_at),...(r.messages||[]).map(m=>item(m.author,m.body,m.created_at))].join('');
  const quick=quickRefund(s,r)||quickUnfinished(s,r),another=r.status==='open'&&s.items.some(x=>!['completed','closed_without_refund','rejected','withdrawn'].includes(x.status));
  const refund=quick?`<button type="button" class="button" data-client-thread="refund" ${another?'disabled':''}>${t('clientRequests.refund',{amount:money(r.requested_minor)})}</button>`
   :`<button type="button" class="button" data-client-thread="review" ${s.status?.can_register!==true?'disabled':''}>${t('clientRequests.review')}</button>`;
  // One row of actions under the reply: send the reply, decline, or the main step (refund or review), last and primary.
  const decide=r.status==='open'?`<div class="problem-register" data-client-thread-declining hidden><label class="field" for="client-thread-note">${t('clientRequests.declineNote')}</label><textarea class="context-box" id="client-thread-note" rows="3" maxlength="4000" data-client-thread-note></textarea><div class="refund-actions tetrato-decide"><button type="button" class="button" data-client-thread="decline-confirm">${t('clientRequests.declineConfirm')}</button><button type="button" class="text-button" data-client-thread="decline-cancel">${uiText('Cancelar')}</button></div></div>`
   :quick?`<div class="refund-actions tetrato-decide">${refund}</div>`:'';
  const reply=r.status==='open'?`<form class="problem-reply" data-client-thread-reply><label class="field" for="client-thread-text">${uiText('problems.replyLabel')}</label><textarea class="context-box" id="client-thread-text" rows="3" maxlength="4000" data-client-thread-text></textarea><footer class="refund-actions tetrato-decide refund-thread-actions" data-client-thread-decide><button type="submit" class="button secondary">${uiText('problems.send')}</button><button type="button" class="button secondary" data-client-thread="decline">${t('clientRequests.decline')}</button>${refund}</footer></form>`:'';
  // TeTrato weighs the request against the project's documents (agreement, deliveries, the freelancer's refund policy) and PayPal's rules.
  const ask=r.status==='open'&&cloud.askTeTrato?`<button type="button" class="button secondary tetrato-ask" data-client-thread="ask"><img src="/assets/mascot/trato-guide.png" alt="" width="36" height="36">${t('clientRequests.ask')}</button>`:'';
  return `<header><h2 id="client-thread-title">${t('clientRequests.conversation',{amount:money(r.requested_minor)})}</h2><button type="button" class="text-button" data-client-thread="close" aria-label="${uiText('Cerrar')}" title="${uiText('Cerrar')}">${icon('x')}</button></header><div class="problem-conversation refund-thread"><ol class="dispute-messages">${list}</ol>${ask}${reply}<p class="cloud-error" role="alert" data-client-thread-error></p>${decide}</div>`;
 }
 function openClientThread(s,id){
  const find=()=>(s.clientRequests||[]).find(r=>r.id===id);if(!find())return;
  const dialog=cloud.document.createElement('dialog');dialog.className='dispute-docs-dialog dispute-side-dialog problem-side-dialog';dialog.setAttribute('aria-labelledby','client-thread-title');
  const close=()=>{dialog.close();dialog.remove();};
  const paint=()=>{const r=find();if(r)dialog.innerHTML=clientThreadHtml(s,r);else close();};
  const post=(suffix,body)=>cloud.request(`/api/v1/projects/${s.project}/client-refund-requests/${id}/${suffix}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const fail=()=>{const error=dialog.querySelector('[data-client-thread-error]');if(error)error.textContent=t('clientRequests.actionError');dialog.querySelectorAll('button').forEach(b=>b.disabled=false);};
  dialog.addEventListener('click',async event=>{
   if(event.target===dialog){close();return;}
   const button=event.target.closest('[data-client-thread]');if(!button)return;
   const what=button.dataset.clientThread;
   if(what==='close'){close();return;}
   if(what==='ask'){
    const r=find();close();
    const item=r.stage_position?t('clientRequests.stage',{number:r.stage_position}):t('clientRequests.addendum');
    cloud.askTeTrato(cloud.document.querySelector(`[data-refund-action="client-thread"][data-id="${id}"]`),{title:t('clientRequests.conversation',{amount:money(r.requested_minor)}),
     question:t('clientRequests.askPrompt',{amount:money(r.requested_minor),item,reason:r.reason})});
    return;
   }
   if(what==='decline'||what==='decline-cancel'){
    // Declining shows only its note: the reply box and TeTrato step aside, and what was typed as a reply becomes the note.
    const declining=what==='decline',replyBox=dialog.querySelector('[data-client-thread-text]'),note=dialog.querySelector('[data-client-thread-note]');
    dialog.querySelector('[data-client-thread-decide]').hidden=declining;dialog.querySelector('[data-client-thread-declining]').hidden=!declining;
    for(const el of dialog.querySelectorAll('[data-client-thread-reply],[data-client-thread="ask"]'))el.hidden=declining;
    if(declining){if(replyBox?.value.trim()&&!note.value){note.value=replyBox.value.trim();replyBox.value='';}note.focus();}
    return;
   }
   if(what==='refund'||what==='review'){close();void run(s,()=>action(s,what==='refund'?'client-refund':'client-request',{dataset:{id}}));return;}
   if(what==='decline-confirm'){
    dialog.querySelectorAll('button').forEach(b=>b.disabled=true);
    try{s.clientRequests=await post('decline',{note:dialog.querySelector('[data-client-thread-note]').value});close();s.notice=t('clientRequests.declined');notify(s);}catch{fail();}
   }
  });
  dialog.addEventListener('submit',async event=>{
   event.preventDefault();const text=dialog.querySelector('[data-client-thread-text]').value.trim();if(!text)return;
   dialog.querySelectorAll('button').forEach(b=>b.disabled=true);
   try{s.clientRequests=await post('messages',{body:text});paint();notify(s);}catch{fail();}
  });
  paint();cloud.document.body.append(dialog);dialog.showModal();
 }
 function editable(s){return ['draft','adjustments_requested'].includes(s.detail?.settlement.status)&&(!s.snapshot||s.snapshot.id===s.detail.settlement.current_snapshot_id);}
 async function acceptResult(s,result){
  if(!current(s))return;
  if(s.pending?.action==='initial'){if(result?.project_id!==s.project||!result.payment?.id)throw Error();clearPending(s);s.initial=null;s.pick=null;s.view='list';s.wizardOpen=false;await load(s);return;}
  if(!result?.settlement?.id||result.settlement.project_id!==s.project||s.pending?.settlementId&&result.settlement.id!==s.pending.settlementId)throw Error();
  if(s.pending?.action==='edit_draft'&&!result.snapshot)throw Error();
  const financial=isFinancialAction(s.pending?.action),reviewRequired=result.application_recorded===false;
  const clientRequest=s.pending?.action==='create'?s.pending.client_request_id:null;
  const created=s.pending?.action==='create';
  clearPending(s);
  s.items=[result.settlement,...s.items.filter(x=>x.id!==result.settlement.id)];
  // Registered from the client's own request: it now points to this refund, so the client sees it in progress.
  if(clientRequest)try{s.clientRequests=await cloud.request(`/api/v1/projects/${s.project}/client-refund-requests/${clientRequest}/registered`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({settlement_id:result.settlement.id})});}
   catch{if(current(s))s.notice=t('clientRequests.linkFailed');}
  s.editor=null;s.request=null;s.pick=null;
  await openDetail(s,result.settlement.id);await load(s);
  if(result.delivery?.status==='failed'&&current(s))s.error=message({code:result.delivery.error_code||'GMAIL_SEND_FAILED'});
  if(result.evidence_processing_error&&current(s))s.error=t('evidenceProcessingError');
  // Registering a request proposes the full refund by default, so the next screen is already Refund.
  if(created&&current(s)&&s.detail?.settlement.status==='draft'&&!s.snapshot&&payment(s)){
   try{
    let editor={items:[],conditions:t('create.fullRefundTerms')};
    if(s.autoRefund){s.editor={simple:true,...s.autoRefund};try{editor=simpleEditor(s);}finally{s.editor=null;s.autoRefund=null;}}
    const {terms}=buildRefundTerms(editor,payment(s));await write(s,'edit_draft',{expected_snapshot_id:null,terms});
   }
   catch{if(current(s))s.step=2;}
   return;
  }
  if(financial&&current(s)){s.financeNotice=uiText(reviewRequired?'refundFinance.reviewNeeded':'refundFinance.recorded');cloud.historyLoaded=false;}
 }
 async function write(s,action,body,metadata={}){
  if(s.storageError)throw Error('refund.storageError');
  if(s.pending)throw Error('refund.uncertain');
  const pending={...metadata,...(isFinancialAction(action)?{body:structuredClone(body)}:{}),key:crypto.randomUUID(),action,settlementId:body.settlement_id||(['create','initial'].includes(action)?null:s.detail?.settlement.id),...(['pdf','send','review','feedback','acceptance'].includes(action)?{snapshotId:s.snapshot?.id}:{})};
  try{cloud.storage.setItem(storageKey(s),JSON.stringify(pending));}catch{throw Error('refund.storageError');}
  s.pending=pending;s.pendingBody=structuredClone(body);
  await sendPending(s);
 }
 async function sendPending(s){
  const pending=s.pending,body=s.pendingBody;
  if(!pending||!body)throw Error('refund.uncertain');
  const suffix={close:'close',edit_draft:'draft',review:'review',feedback:'feedback',acceptance:'acceptance'};
  const path=isFinancialAction(pending.action)?financialPath(pending):pending.action==='create'?`/api/v1/projects/${s.project}/refunds`:pending.action==='initial'?`/api/v1/projects/${s.project}/initial-payments`:['pdf','send'].includes(pending.action)?`/api/v1/refunds/${pending.settlementId}/snapshots/${pending.snapshotId}/${pending.action==='pdf'?'pdf':'email'}`:`/api/v1/refunds/${pending.settlementId}/${suffix[pending.action]}`;
  let result;
  try{result=await cloud.request(path,{...cloud.json(body),headers:{'Content-Type':'application/json','Idempotency-Key':pending.key}});}
  catch(error){
   if(current(s)&&error.status>=400&&error.status<500&&![408,429].includes(error.status)&&!['IDEMPOTENCY_KEY_CONFLICT','EMAIL_DELIVERY_UNCERTAIN'].includes(error.code))clearPending(s);
   throw error;
  }
  if(current(s))await acceptResult(s,result);
 }
 async function queryPending(s){
  if(!s.pending)return;
  const data=await cloud.request(`/api/v1/projects/${s.project}/refund-operations/${encodeURIComponent(s.pending.key)}`);
  if(!current(s))return;
  if(data?.state==='confirmed')await acceptResult(s,data.result);
  else if(data?.state==='unconfirmed')s.error=t('unconfirmed');else throw Error();
 }
 async function chooseDocument(s,id){
  const pick=s.pick;if(!pick)return;
  pick.data=null;pick.quote='';pick.docid=id;
  if(!id)return;
  const data=await cloud.request(`/api/v1/documents/${id}/extraction`);
  if(!current(s)||s.pick!==pick||pick.docid!==id)return;
  if(data.document?.id!==id||data.document.project_id!==s.project||data.extraction?.status!=='ready'||!data.extraction.id||!data.document.sha256||!Array.isArray(data.segments))throw Error('refund.evidenceMismatch');
  pick.data=data;pick.segment=0;pick.quote=data.segments[0]?.text.slice(0,4000)||'';
 }
 // The request's proof in one go: save the PDF as a project document, wait until Trato has read it and cite its text.
 async function attachProof(s,file){
  if(!file?.size||file.size>10485760||!/\.pdf$/i.test(file.name))throw Error('refund.create.proofInvalid');
  s.registering='uploading';notify(s);
  const meta={filename:file.name,title:t('create.proofTitle'),kind:'reference',...uploadContext(s)};
  if(s.proofUpload?.command!==JSON.stringify([meta,file.size,file.lastModified]))s.proofUpload={command:JSON.stringify([meta,file.size,file.lastModified]),key:crypto.randomUUID()};
  const saved=await cloud.request(`/api/v1/projects/${s.project}/documents?${new URLSearchParams(meta)}`,{method:'POST',body:file,headers:{'Content-Type':'application/pdf','Idempotency-Key':s.proofUpload.key}});
  const id=saved?.document?.id;if(!id)throw Error('refund.evidenceMismatch');
  if(!cloud.documents.some(d=>d.id===id))cloud.documents=[saved.document,...cloud.documents];
  s.registering='reading';notify(s);
  return citeWhenReady(s,id);
 }
 // Waits until Trato has read a project document and cites its first passage, as the request's proof.
 async function citeWhenReady(s,id){
  for(let attempt=0;attempt<60;attempt++){
   let data=null;
   try{data=await cloud.request(`/api/v1/documents/${id}/extraction`);}catch(error){if(error.status&&error.status<500&&![404,409].includes(error.status))throw error;}
   if(!current(s))throw Error('refund.evidenceMismatch');
   if(data?.extraction?.status==='failed')throw Error('refund.create.proofUnreadable');
   const text=data?.extraction?.status==='ready'?data.segments?.find(x=>x.text?.trim())?.text:null;
   if(text&&data.document?.sha256)return {document_id:id,extraction_id:data.extraction.id,document_sha256:data.document.sha256,quote:text.trim().slice(0,4000)};
   if(data?.extraction?.status==='ready')throw Error('refund.create.proofUnreadable');
   await new Promise(resolve=>setTimeout(resolve,2000));
  }
  throw Error('refund.create.proofSlow');
 }
 // The agreed amount as the usual terms: what is not refunded is one retained item, backed by the request's proof.
 function simpleEditor(s){
  const pay=payment(s),left=pay.amount_minor-pay.local_previous_refunds_minor,refund=parseRefundMoney(s.editor.refund),note=s.editor.note.trim();
  if(!(refund>=0)||refund>left)throw Error('refund.simple.amountInvalid');
  if(!note)throw Error('refund.conditionsRequired');
  const proof=(s.detail.settlement.request_evidence||[]).slice(0,1).map(c=>({...c}));
  const kept=left-refund,previous=s.snapshot?.terms.adjustments?.[0]?.concept_id;
  return {conditions:note,items:kept>0?[{concept_id:previous||crypto.randomUUID(),kind:'other',beneficiary:'seller',description:t('simple.kept'),mode:'fixed',amount:(kept/100).toFixed(2),base:'',rate:'',evidence:proof}]:[]};
 }
 function percentAmount(item){try{return money(percentageMinor(item.base,item.rate).amount_minor);}catch{return t('invalidRate');}}
 function evidenceHtml(refs,target,readOnly=false){
  if(readOnly){
   const ids=[...new Set(refs.map(c=>c.document_id))];
   return ids.map(id=>`<button type="button" class="text-button refund-view-pdf" data-refund-action="download" data-document="${esc(id)}">${icon('file-text')}${t('viewPdf')}</button>`).join('');
  }
  const sources=refs.map((c,i)=>{
   const title=cloud.documents.find(d=>d.id===c.document_id)?.title;
   return `<li><details class="refund-fold"><summary>${icon('file-text')}<span>${esc(title||t('evidenceTitle'))}</span>${icon('chevron-down')}</summary><div class="refund-fold-body"><blockquote>${esc(c.quote)}</blockquote><div class="refund-actions">${button('download','original',`data-document="${esc(c.document_id)}"`)}${readOnly?'':button('remove-evidence','remove',`data-target="${esc(target)}" data-index="${i}"`)}</div></div></details></li>`;
  }).join('');
  return `${sources?`<ul class="refund-evidence">${sources}</ul>`:''}${readOnly?'':button('pick','addEvidence',`data-target="${esc(target)}"`)}`;
 }
 function picker(s){
  if(!s.pick)return '';
  const p=s.pick,docs=cloud.documents.filter(d=>cloud.sourceReady(d)),segments=p.data?.segments||[];
  return `<section class="refund-source-picker" aria-label="${t('sourcePicker')}"><h4>${t('sourcePicker')}</h4><label>${t('document')}<select data-refund-field="document"><option value="">${t('chooseDocument')}</option>${docs.map(d=>option(d.id,d.title,p.docid)).join('')}</select></label>${p.data?`<label>${t('segment')}<select data-refund-field="segment">${segments.map((seg,i)=>option(String(i),t('segmentNumber',{number:seg.locator_number}),String(p.segment))).join('')}</select></label><pre class="refund-source-text">${esc(segments[p.segment]?.text)}</pre><label>${t('quote')}<textarea data-refund-field="quote" maxlength="4000" rows="3">${esc(p.quote)}</textarea></label>${button('use-quote','useQuote')}`:''}${docs.length?'':`<p>${t('noSources')}</p><button type="button" class="button secondary" data-cloud-action="tab" data-cloud-tab="documentos">${t('goDocuments')}</button>`}<button type="button" class="button secondary" data-cloud-action="upload" data-cloud-purpose="reference">${t('addReference')}</button>${button('cancel-pick','cancel')}</section>`;
 }
 function preview(s){
  if(!s.editor)return '';
  try{
   const {result,terms}=buildRefundTerms(s.editor,payment(s));
   return `<strong>${t('proposed')}: ${money(result.refund_minor)}</strong>${terms.allocations?`<details><summary>${t('allocation')}</summary><p>${t('allocationHelp')}</p><ul>${terms.allocations.map(a=>`<li>${allocationLabel(s,a)} · <strong>${money(a.refund_minor)}</strong></li>`).join('')}</ul></details>`:''}${result.additional_payment_due_minor?`<p>${t('separateDue')}: ${money(result.additional_payment_due_minor)}</p>`:''}`;
  }catch(error){return `<p>${message(error)}</p>`;}
 }
 function allocationLabel(s,a){
  const member=payment(s)?.members.find(p=>p.id===a.payment_id);
  return member?t('allocationPayment',{id:a.payment_id.slice(0,8),origin:t('origin.'+member.origin),amount:money(member.amount_minor)}):t('paymentUnavailable');
 }
 function editorHtml(s){
  const e=s.editor;
  if(!e)return '';
  if(e.simple){
   const pay=payment(s),left=pay?pay.amount_minor-pay.local_previous_refunds_minor:0;
   return `<form data-refund-form="draft" class="refund-create"><label class="field">${t('simple.amount')}<input class="context-box" name="refund" inputmode="decimal" required value="${esc(e.refund)}"><small class="field-help">${t('simple.amountHelp',{amount:money(left)})}</small></label><label class="field">${t('simple.note')}<textarea class="context-box" name="note" rows="2" maxlength="4000" required>${esc(e.note)}</textarea></label><div class="dialog-actions"><button type="button" class="button secondary" data-refund-action="cancel-edit">${t('cancel')}</button><button class="button" type="submit" ${s.pending||!pay?'disabled':''}>${t('wizard.saveContinue')}</button></div></form>`;
  }
  return `<form data-refund-form="draft" class="refund-create"><p class="refund-wizard-help">${t('deductionsHelp')}</p>${e.items.map((x,i)=>`<fieldset class="refund-concept" data-concept="${x.concept_id}"><legend>${t('conceptNumber',{number:i+1})}</legend><div class="refund-grid"><label>${t('kind')}<select data-refund-item="${x.concept_id}" name="kind">${['recognized_work','expense','penalty','other'].map(k=>option(k,t('kind.'+k),x.kind)).join('')}</select></label><label>${t('beneficiary')}<select data-refund-item="${x.concept_id}" name="beneficiary">${['seller','customer'].map(k=>option(k,t('beneficiary.'+k),x.beneficiary)).join('')}</select></label></div><label>${t('description')}<input data-refund-item="${x.concept_id}" name="description" value="${esc(x.description)}" maxlength="4000" required></label><label>${t('method')}<select data-refund-item="${x.concept_id}" name="mode">${['fixed','percent'].map(k=>option(k,t(k),x.mode)).join('')}</select></label>${x.mode==='fixed'?`<label>${t('amount')}<input data-refund-item="${x.concept_id}" name="amount" inputmode="decimal" value="${esc(x.amount)}" required></label>`:`<div class="refund-grid"><label>${t('base')}<input data-refund-item="${x.concept_id}" name="base" inputmode="decimal" value="${esc(x.base)}" required></label><label>${t('rate')}<input data-refund-item="${x.concept_id}" name="rate" inputmode="decimal" value="${esc(x.rate)}" required></label></div><p>${t('rounding')}</p><output data-refund-item-total="${x.concept_id}">${percentAmount(x)}</output>`}${evidenceHtml(x.evidence,x.concept_id)}${button('remove-concept','removeConcept',`data-id="${x.concept_id}"`)}</fieldset>`).join('')}${button('add-concept','addConcept')}<label>${t('conditions')}<textarea name="conditions" maxlength="4000" required>${esc(e.conditions)}</textarea></label><output data-refund-preview aria-live="polite">${preview(s)}</output><div class="refund-step-next"><button type="button" class="text-button" data-refund-action="cancel-edit">${t('cancel')}</button><button class="button" type="submit" ${s.pending||!payment(s)?'disabled':''}>${t('wizard.saveContinue')}</button></div></form>`;
 }
 function requestHtml(s){
  const r=s.request;if(!r)return '';
  // One short form: what is refunded, why, and the proof. Payments with nothing left are not offered;
  // closing the whole project is the last choice of the same list, and who asked stays folded (the client, by default).
  const left=p=>p.amount_minor-Math.min(p.amount_minor,p.local_previous_refunds_minor||0);
  const payments=s.payments.filter(p=>left(p)>0||p.id===r.payment_id),total=payments.reduce((n,p)=>n+left(p),0);
  const blocked=s.status?.can_register===false?`<div class="refund-notice"><p role="status">${uiText('refundAI.intakeBlocked')}</p>${s.status.active_request?.title?`<p><strong>${esc(s.status.active_request.title)}</strong></p>`:''}</div>`:'';
  const target=r.scope==='project_closure'?'__project__':r.payment_id||'';
  const what=`<label class="field">${t('create.what')}<select class="context-box" name="refund_target" required><option value="">${t('choosePayment')}</option>${payments.map(p=>option(p.id,`${t(p.origin==='initial'?'origin.initial':'origin.change')} · ${money(left(p))} · ${date(p.updated_at)}`,target)).join('')}${payments.length>1?option('__project__',`${t('create.wholeProject')} · ${money(total)}`,target):''}</select></label>`;
  const chosen=r.scope==='payment_only'?payments.find(p=>p.id===r.payment_id):null;
  const amount=chosen?`<label class="field">${t('simple.amount')}<input class="context-box" name="amount" inputmode="decimal" required value="${esc(r.amount??(left(chosen)/100).toFixed(2))}"><small class="field-help">${t('simple.amountHelp',{amount:money(left(chosen))})}</small></label>`:'';
  const closure=r.scope==='project_closure'?`<label class="refund-checkbox"><input name="payments_reviewed" type="checkbox" ${r.payments_reviewed?'checked':''} required>${t('create.wholeProjectConfirm')}</label>`:'';
  // The proof is attached right here: on Register, Trato uploads it, reads it and cites it. Nothing else to open.
  const proof=r.fixedProof?(r.evidence.length?`<p class="refund-create-file">${evidenceHtml(r.evidence,'request',true)}</p>`:'')
   :r.evidence.length?`<p class="refund-create-file">${evidenceHtml(r.evidence,'request',true)}<button type="button" class="text-button" data-refund-action="clear-evidence">${t('create.changeProof')}</button></p>`
   :r.file?`<p class="refund-create-file">${icon('file-text')}<span>${esc(r.file.name)}</span><button type="button" class="text-button" data-refund-action="clear-evidence">${t('create.changeProof')}</button></p>`
   :`<input class="context-box" type="file" name="evidence_file" accept=".pdf,application/pdf" required><button type="button" class="text-button" data-refund-action="pick" data-target="request">${t('create.useProjectDocument')}</button>`;
  const working=s.registering?`<p class="refund-create-progress" role="status" aria-busy="true">${t('create.'+s.registering)}</p>`:'';
  return `<form data-refund-form="create" class="refund-create">${blocked}${what}${amount}${closure}<label class="field">${t('reason')}<textarea class="context-box" name="reason" maxlength="4000" rows="3" required>${esc(r.reason)}</textarea></label>
   <div class="field refund-create-evidence">${t('create.evidence')}${proof}</div>${working}
   <div class="dialog-actions"><button type="button" class="button secondary" data-refund-action="cancel-create">${t('cancel')}</button><button class="button" type="submit" ${s.pending||s.status?.can_register!==true?'disabled':''}>${t('register')}</button></div></form>`;
 }
 function activeStep(s){
  if(s.view==='create'||s.view==='initial')return 1;
  // Three steps: Request → Proposal → Refund. Registering the request is already the agreement, so
  // there is no proposal email nor reply to wait for; the last step refunds with one click. Internally it keeps number 6.
  const status=s.detail?.settlement.status;
  if(['completed','closed_without_refund','rejected','withdrawn','refund_pending','accepted','awaiting_response'].includes(status))return 6;
  return s.snapshot&&!s.editor&&status!=='adjustments_requested'?6:2;
 }
 function assistantFocus(s,task='guide',response=null,support=null){
  const step=s.step||activeStep(s);
  if(s.view==='list')return {step:1,task:'intake'};
  if(s.view==='create')return {step,task:task==='guide'?'intake':task,scope:s.request.scope,
   payment_id:s.request.scope==='payment_only'?(s.request.payment_id||null):null,
   evidence_ids:[...new Set(s.request.evidence.map(item=>item.document_id))].sort()};
  return {step,task,settlement_id:s.detail.settlement.id,snapshot_id:s.snapshot?.id||null,response_id:response,support_document_id:support};
 }
 cloud.canApplyRefundSuggestion=function(focus){
  const s=cloud.refundState;
  if(!focus||!s||!current(s)||s.pending||s.busy)return false;
  if(focus.task==='intake')return s.loaded&&!s.storageError&&s.payments.length>0&&
    (!s.wizardOpen||s.view==='create'&&!s.request.reason.trim());
  if(!s.wizardOpen)return false;
  if(focus.task==='request'&&s.view==='create'){
   const active=assistantFocus(s,'request');
   return focus.scope===active.scope&&focus.payment_id===active.payment_id
    &&JSON.stringify(focus.evidence_ids)===JSON.stringify(active.evidence_ids);
  }
  if(focus.task==='email')return s.view==='detail'&&s.detail.settlement.status==='draft'&&editable(s)
   &&focus.settlement_id===s.detail.settlement.id&&focus.snapshot_id===s.snapshot?.id&&(s.step||activeStep(s))===3
   &&!s.mailNote?.trim()&&!s.emailPreview;
  return focus.task==='proposal'&&s.view==='detail'&&editable(s)&&focus.settlement_id===s.detail.settlement.id
   &&focus.snapshot_id===(s.snapshot?.id||null)&&(s.step||activeStep(s))===2;
 };
 cloud.refundConditionsForReview=function(focus,proposed){
  if(focus?.task!=='proposal'||!proposed||!cloud.canApplyRefundSuggestion(focus))return '';
  const s=cloud.refundState,currentTerms=(s.editor?.conditions??s.snapshot?.terms.conditions??'').trim();
  return currentTerms!==proposed.trim()?currentTerms:'';
 };
 cloud.applyRefundSuggestion=function({focus,guidance},replaceConditions=false){
  if(!cloud.canApplyRefundSuggestion(focus))return false;
  const s=cloud.refundState;
  if(focus.task==='intake'){
   const draft=guidance.intake,previous=s.view==='create'?s.request:null;
   if(!draft||draft.scope==='payment_only'&&(!s.payments.some(p=>p.id===draft.payment_id)||
     previous?.payment_id&&previous.payment_id!==draft.payment_id))return false;
   if(previous?.evidence.length&&(previous.scope!==draft.scope||previous.payment_id!==(draft.payment_id||'')))return false;
   s.request={...draft,payment_id:draft.payment_id||'',payments_reviewed:false,evidence:previous?.evidence||[]};
   s.view='create';s.step=null;s.wizardOpen=true;
  }else if(focus.task==='request')s.request.reason=guidance.reason;
  else if(focus.task==='email'){s.mailNote=guidance.email_note;s.mailNoteSnapshot=s.snapshot.id;}
  else{
   const editor=s.editor||{items:(s.snapshot?.terms.adjustments||[]).map(editItem),conditions:s.snapshot?.terms.conditions||'',reviewed:false};
   const normalize=value=>value.trim().replace(/\s+/g,' ').toLowerCase();
   const additions=guidance.concepts.filter((item,index,all)=>!editor.items.some(existing=>normalize(existing.description)===normalize(item.description))
    &&all.findIndex(other=>normalize(other.description)===normalize(item.description))===index);
   if(editor.items.length+additions.length>100)return false;
   if((!editor.conditions.trim()||replaceConditions)&&guidance.conditions)editor.conditions=guidance.conditions;
   editor.items.push(...additions.map(item=>({...emptyItem(),kind:item.kind,beneficiary:item.beneficiary,
    description:item.description,evidence:structuredClone(item.evidence)})));
   editor.reviewed=false;s.editor=editor;s.step=2;
  }
  notify(s);
  return true;
 };
 function assistantButton(task,key){
  const main=task==='guide'||task==='list';
  // Ask TeTrato is the floating TeTrato of every screen, bottom right, not one more button inside the view.
  if(main)return `<button type="button" class="tetrato-fab tetrato-fab-local" data-refund-assistant="${task}" aria-haspopup="dialog" aria-label="${uiText(`refundAI.${key}`)}" title="${uiText(`refundAI.${key}`)}"><img src="/assets/mascot/trato-guide.png" alt="" width="40" height="40"><span>TeTrato</span></button>`;
  return `<button type="button" class="button refund-ai-trigger ${main?'refund-ai-primary':'secondary'}" data-refund-assistant="${task}" aria-haspopup="dialog">${main?'<img src="/assets/mascot/trato-guide.png" alt="" width="28" height="28">':icon('sparkles')}${uiText(`refundAI.${key}`)}</button>`;
 }
 // Rarely needed actions go in «…»: linking an initial payment Trato has not seen, and reading refunds made in PayPal.
 // The list reloads by itself when the user comes back to the tab, so it has no refresh button.
 function listMore(s){
  const item=(action,label)=>`<button type="button" class="cloud-reply-menu-item" role="menuitem" data-refund-action="${action}">${label}</button>`;
  const items=[item('add-policy',t('policy.add')),s.status?.can_register===true&&!s.pending?item('doc-initial',uiText('refundDoc.initial')):'',s.payments.length?item('sync-payments',t('syncPayments')):''].join('');
  return items?`<details class="cloud-reply-other"><summary class="button secondary" aria-label="${t('clientRequests.more')}" title="${t('clientRequests.more')}">…</summary><div class="cloud-reply-menu" role="menu">${items}</div></details>`:'';
 }
 function listHtml(s){
  const external=s.payments.filter(p=>p.external_refund_minor>0);
  const actions=`<div class="refund-actions">
   <button type="button" class="button" data-refund-action="new" ${s.status?.can_register!==true||!s.payments.length||s.pending||s.storageError?'disabled':''}>${t('register')}</button>
   ${listMore(s)}
  </div>`;
  const hint=s.status?.can_register===false?'openRequest':s.payments.length?'':'noPayments';
  // Requests the client sent from their space, waiting for the freelancer to register them as a refund.
  // A one-click refund that was cut halfway stays here, so the same button finishes it.
  const open=(s.clientRequests||[]).filter(r=>r.status==='open'||quickUnfinished(s,r));
  const requests=s.clientRequests===null?`<p class="cloud-error" role="alert">${t('clientRequests.error')}</p>`:open.length?`<section class="refund-client-requests" aria-label="${t('clientRequests.title')}"><h4>${t('clientRequests.title')}</h4><ul class="refund-list">${open.map(r=>`<li>
   <div class="refund-list-record"><span class="refund-mark">${icon('messages-square')}</span><div><strong>${esc(r.reason.length>120?r.reason.slice(0,120)+'…':r.reason)}</strong><small>${r.stage_position?t('clientRequests.stage',{number:r.stage_position}):t('clientRequests.addendum')} · ${date(r.created_at)}</small></div></div>
   <div class="refund-list-meta"><strong>${money(r.requested_minor)}</strong></div>
   ${clientRequestActions(s,r)}
  </li>`).join('')}</ul></section>`:'';
  return `${actions}${requests}${hint?`<p class="refund-list-hint">${t(hint)}</p>`:''}${s.items.length||external.length?`<ul class="refund-list">${external.map(p=>`<li>
   <div class="refund-list-record"><span class="refund-mark">${icon('undo-2')}</span><div><strong>${t('externalRefund')}</strong><small>${t(p.origin==='initial'?'origin.initial':'origin.change')} · ${t('originalPaymentDate',{date:date(p.updated_at)})}</small></div></div>
   <div class="refund-list-meta"><span class="refund-status" data-status="completed">${t('status.completed')}</span><strong>${money(p.external_refund_minor)}</strong></div>
  </li>`).join('')}${s.items.map(x=>`<li>
   <div class="refund-list-record"><span class="refund-mark">${icon('undo-2')}</span><div><strong>${esc(x.reason)}</strong><small>${t('scope.'+x.scope)}</small></div></div>
   <div class="refund-list-meta"><span class="refund-status" data-status="${esc(x.status)}">${t('status.'+x.status)}</span>${x.status==='completed'&&x.confirmed_refund_minor>0?`<strong>${money(x.confirmed_refund_minor)}</strong>`:''}</div>
   <button type="button" class="button secondary" data-refund-action="open" data-id="${esc(x.id)}">${t(detailAction(x.status))}${icon('chevron-right')}</button>
  </li>`).join('')}</ul>`:open.length?'':`<div class="refund-empty"><span class="refund-mark">${icon('undo-2')}</span><p>${t('empty')}</p></div>`}`;
 }
 const WIZARD_STEPS=[1,6];
 function wizardHeader(s){
  const step=s.step||activeStep(s),project=cloud.projects.find(p=>p.id===s.project);
  const item=s.view==='detail'?s.detail?.settlement:null;
  const total=s.snapshot&&item?(item.status==='completed'?item.confirmed_refund_minor:s.snapshot.breakdown.refund_minor):null;
  return `<header class="refund-wizard-header"><div>
   <span class="eyebrow">${s.view==='initial'?t('title'):t('wizard.progress',{step:WIZARD_STEPS.indexOf(step)+1||step})}</span>
   <h2 tabindex="-1">${s.view==='initial'?uiText('refundDoc.initial'):t('wizard.step'+step)}</h2>
   <div class="refund-wizard-meta">${esc(project?.name||'')}${item?`<span class="refund-status" data-status="${esc(item.status)}">${t('status.'+item.status)}</span>`:''}</div>
  </div><div class="refund-wizard-tools">${s.view==='initial'?'':assistantButton('guide','open')}<button type="button" data-refund-action="wizard-close" aria-label="${t('wizard.close')}" title="${t('wizard.close')}">${icon('x')}</button></div></header>
  ${s.view==='initial'?'':`<nav class="refund-wizard-steps" aria-label="${t('wizard.stages')}">${WIZARD_STEPS.map((i,n)=>`<button type="button" data-refund-action="wizard-step" data-step="${i}" ${i>activeStep(s)||s.editor||s.pending||s.view!=='detail'?'disabled':''} ${step===i?'aria-current="step"':''} ${i<step?'data-done':''}><span>${i<step?icon('check'):n+1}</span>${t('wizard.step'+i)}</button>`).join('')}</nav><p class="refund-wizard-help">${t('wizard.help'+step)}</p>`}`;void total;
 }
 async function previewDocument(s,id){
  const blob=await cloud.request(`/api/v1/documents/${id}/file`,{},true);if(!current(s))return;
  releaseReader(s);s.reader={url:URL.createObjectURL(blob),pdf:blob.type.split(';')[0]==='application/pdf'};
 }
 // The last step: one button refunds the saved proposal (PDF kept in the project, PayPal check, authorization and
 // execution happen behind it). Afterwards, only what matters: how much went back and the record.
 function refundStepHtml(s,parent,snap,saved){
  const amount=parent.status==='completed'?parent.confirmed_refund_minor:snap?.breakdown.refund_minor;
  const pdf=s.documentData?.artifacts?.find(a=>a.document_id);
  const record=pdf?`<button type="button" class="text-button" data-refund-action="download" data-document="${esc(pdf.document_id)}">${icon('file-text')}${t('wizard.viewRecord')}</button>`:'';
  if(parent.status==='completed')return `<article class="refund-card refund-result-card"><span class="refund-result-check" aria-hidden="true">${icon('check')}</span><strong class="refund-result-amount">${money(amount)}</strong><h3>${t('wizard.refundedShort')}</h3><p>${t('wizard.refundedCopy')}</p>${record}</article>`;
  if(['closed_without_refund','rejected','withdrawn'].includes(parent.status))return `<article class="refund-card"><h3>${t('status.'+parent.status)}</h3>${record}</article>`;
  const zero=!(amount>0),busy=s.quickRefunding;
  const details=parent.status==='refund_pending'&&s.financeData?`<details class="refund-fold"><summary>${icon('file-text')}<span>${t('wizard.paymentDetails')}</span>${icon('chevron-down')}</summary><div class="refund-fold-body">${renderRefundFinance(s,6)}</div></details>`:'';
  const label=busy?t('clientRequests.refunding'):zero?t('wizard.closeNoRefund'):t('clientRequests.refund',{amount:money(amount)});
  return `<article class="refund-card refund-confirm-card"><h3>${zero?t('wizard.closeNoRefundTitle'):t('wizard.refundTitle',{amount:money(amount)})}</h3><p>${t(zero?'wizard.closeNoRefundCopy':'wizard.refundCopy')}</p>${saved}<div class="refund-actions"><button type="button" class="button" data-refund-action="quick-refund" ${busy?'disabled':''}>${label}</button>${editable(s)&&!busy&&!zero?`<button type="button" class="button secondary" data-refund-action="edit">${icon('pencil')}${t('wizard.changeAmount')}</button>`:''}</div></article>${details}`;
 }
 function detailHtml(s){
  const parent=s.detail?.settlement;if(!parent)return '';
  const snap=s.snapshot,original=payment(s)?.amount_minor??snap?.breakdown.gross_minor;
  const step=s.step||activeStep(s),terminal=terminalStatuses.includes(parent.status);
  // The amount first, then the terms: what the freelancer needs to read at a glance.
  const saved=snap?`<article class="refund-card refund-proposal-summary"><header class="refund-amount-head"><span>${parent.status==='completed'?uiText('refundFinance.confirmed'):t('proposed')}</span><strong>${money(parent.status==='completed'?parent.confirmed_refund_minor:snap.breakdown.refund_minor)}</strong></header>
   <p class="refund-preserved">${esc(snap.terms.conditions)}</p>
   ${snap.terms.adjustments.length?`<ul class="refund-adjustment-list">${snap.terms.adjustments.map(x=>`<li><div><strong>${esc(x.description)}</strong><span>${money(x.amount_minor)}</span></div>${evidenceHtml(x.evidence,x.concept_id,true)}</li>`).join('')}</ul>`:''}</article>`:`<p class="refund-list-hint">${t('noProposal')}</p>`;
  const history=`<details class="refund-fold"><summary>${icon('history')}<span>${t('history')}</span>${icon('chevron-down')}</summary><ul class="refund-history refund-fold-body">${s.detail.snapshots.map(x=>`<li><span>${date(x.created_at)}</span><button type="button" class="button secondary" data-refund-action="snapshot" data-id="${esc(x.id)}" ${s.editor?'disabled':''}>${t('snapshotTitle',{version:x.version_no,sequence:x.draft_sequence})}</button></li>`).join('')}</ul></details>`;
  let content='';
  const next=to=>`<div class="refund-step-next"><button type="button" class="button" data-refund-action="wizard-step" data-step="${to}">${t('wizard.next')}${icon('arrow-right')}</button></div>`;
  if(step===1)content=`<article class="refund-card refund-request-card">
   ${Number.isSafeInteger(original)?`<header class="refund-amount-head"><span>${t(parent.scope==='project_closure'?'originalTotal':'gross')} · ${t('scope.'+parent.scope)}</span><strong>${money(original)}</strong></header>`:''}
   <h3>${t('reason')}</h3><blockquote class="refund-reason">${esc(parent.reason)}</blockquote>
   ${(parent.request_evidence||[]).length?evidenceHtml(parent.request_evidence,'request',true):''}
  </article>${next(6)}`;
  if(step===2)content=`${s.editor?`${s.editor.simple?'':assistantButton('proposal','prepareProposal')}${editorHtml(s)}`:`${saved}${snap?next(6):''}`}`;void history;
  if(step===6)content=refundStepHtml(s,parent,snap,saved);
  if(step===3||step===4)content=renderRefundDocuments(s,cloud,evidenceHtml,step);
  if(step===3&&activeStep(s)>=4&&s.documentData?.deliveries?.some(d=>d.status==='accepted_by_gmail'))content+=`<div class="refund-response-actions"><button type="button" class="button" data-refund-action="wizard-step" data-step="4">${t('wizard.toReply')}</button></div>`;
  if(step===4)content+=`${activeStep(s)<5?`<p>${t('wizard.acceptFirst')}</p>`:''}<div class="refund-response-actions"><button type="button" class="button" data-refund-action="wizard-step" data-step="${snap?.breakdown.refund_minor===0?6:5}" ${activeStep(s)<5?'disabled':''}>${t('wizard.toAuthorize')}</button></div>`;
  if(step===5)content=`${terminal&&!s.financeData?`<p class="refund-result" role="status">${t('status.'+parent.status)}</p>`:''}${renderRefundFinance(s,step)}<details class="refund-fold"><summary>${icon('file-text')}<span>${t('wizard.proposalDetails')}</span>${icon('chevron-down')}</summary><div class="refund-fold-body">${saved}${history}${renderRefundDocuments(s,cloud,evidenceHtml,6)}</div></details>`;
  if(step===5&&s.financeData?.authorizations.some(a=>a.snapshot_id===s.snapshot?.id))content+=`<div class="refund-response-actions"><button type="button" class="button" data-refund-action="wizard-step" data-step="6">${t('wizard.toExecute')}</button></div>`;
  const close=parent.status==='draft'&&!s.editor?`<details class="refund-cancel-request"><summary class="text-button">${t('wizard.cancelRequest')}</summary><form data-refund-form="close" class="refund-create"><input type="hidden" name="reason" value="withdrawn"><label class="field">${t('wizard.cancelWhy')}<textarea class="context-box" name="notes" maxlength="4000" rows="2" required>${esc(s.closure?.notes||'')}</textarea></label><div class="dialog-actions"><button class="button secondary" type="submit">${t('wizard.cancelConfirm')}</button></div></form></details>`:'';
  return `<section class="refund-stage">${content}</section>${close}`;
 }
 async function action(s,a,target){
  if(a==='wizard-close'){s.wizardOpen=false;s.financeForm=null;s.emailPreview=null;if(s.workflowForm)s.workflowForm.confirmed=false;if(s.editor)s.editor.reviewed=false;releaseReader(s);wizard.close();return;}
  if(a==='wizard-resume'){s.wizardOpen=true;return;}
  if(a==='wizard-step'){const step=Number(target.dataset.step);if(!s.editor&&step>=1&&step<=activeStep(s)){s.step=step;s.financeForm=null;s.workflowForm=null;s.emailPreview=null;s.pick=null;releaseReader(s);}return;}
  if(a==='reader-close'){releaseReader(s);return;}

  if(a==='reload'){await load(s);if(current(s)&&s.view==='detail'&&s.detail&&!s.pending)await openDetail(s,s.detail.settlement.id);return;}
  if(a==='sync-payments'){
   try{await cloud.request(`/api/v1/projects/${s.project}/refund-payments/sync`,{method:'POST'});}
   finally{if(current(s))await load(s);}
   return;
  }
  if(a==='query'){await queryPending(s);return;}
  if(a==='reconcile-send'){
   const op=s.pending;const data=await cloud.request(`/api/v1/refunds/${op.settlementId}/snapshots/${op.snapshotId}/email/reconcile`,{method:'POST',headers:{'Idempotency-Key':op.key}});
   if(current(s)){if(data.state==='confirmed')await acceptResult(s,data.result);else s.error=uiText('refundDoc.uncertain');}return;
  }
  if(a==='retry-operation'){if(isFinancialAction(s.pending?.action))return;await sendPending(s);return;}
  if(await financialAction(s,cloud,a,target,{current,write,resend:sendPending,openDetail}))return;
  if(await documentAction(s,cloud,a,target,{write,openDetail,load,current,acceptResult,preview:id=>previewDocument(s,id),upload:()=>{s.resumeAfterUpload=true;wizard.close();cloud.openSource('reference',uploadContext(s));}}))return;
  if(a==='download'){await previewDocument(s,target.dataset.document);return;}
  if(a==='new'){if(s.status?.can_register!==true||s.pending||s.storageError)return;s.request={scope:'payment_only',payments_reviewed:false,payment_id:'',reason:'',requested_by:'customer',evidence:[]};s.view='create';s.wizardOpen=true;s.step=null;}
  if(a==='client-thread'){openClientThread(s,target.dataset.id);return;}
  if(a==='clear-evidence'&&s.request){s.request.evidence=[];s.request.file=null;return;}
  if(a==='add-policy'){
   // The freelancer's refund policy as one more project document: TeTrato reads and cites it when weighing a request.
   cloud.openSource('reference');
   const title=cloud.modal?.open?cloud.modal.querySelector('[data-cloud-form="upload"] input[name="title"]'):null;
   if(title)title.value=t('policy.documentTitle');
   return;
  }
  if(a==='quick-refund'){
   // Same safe repeat as the client's request: the key is fixed for this version, so a cut never refunds twice.
   const parent=s.detail?.settlement,snap=s.snapshot;if(!parent||!snap||s.pending||s.storageError)return;
   // Confirmed and followed in PayPal's window; the page reloads from the server afterwards, whatever happened.
   const result=await confirmPayPalRefund({doc:cloud.document,amount:money(snap.breakdown.refund_minor),
    execute:()=>cloud.request(`/api/v1/refunds/${parent.id}/refund`,{method:'POST',headers:{'Content-Type':'application/json','Accept-Language':uiLanguage(),'Idempotency-Key':`refund-${parent.id}-${snap.id}`},body:JSON.stringify({expected_snapshot_id:snap.id,confirmed:true})})});
   if(!current(s))return;
   cloud.historyLoaded=false;
   await openDetail(s,parent.id);if(current(s))await load(s);
   if(current(s)&&result?.settlement?.status!=='completed'&&result?.settlement?.status!=='closed_without_refund')s.notice=t('clientRequests.refundPending',{amount:money(snap.breakdown.refund_minor)});
   return;
  }
  if(a==='client-refund'){
   // The button shows the exact amount, so it is the confirmation. The key is fixed per request: repeating it resumes, never refunds twice.
   const req=(s.clientRequests||[]).find(r=>r.id===target.dataset.id&&(quickRefund(s,r)||quickUnfinished(s,r)));
   if(!req||s.pending||s.storageError)return;
   const result=await confirmPayPalRefund({doc:cloud.document,amount:money(req.requested_minor),
    execute:()=>cloud.request(`/api/v1/refunds/client-requests/${req.id}`,{method:'POST',headers:{'Content-Type':'application/json','Accept-Language':uiLanguage(),'Idempotency-Key':`client-request-${req.id}`},body:JSON.stringify({project_id:s.project,confirmed:true})})});
   if(!current(s))return;
   cloud.historyLoaded=false;
   await load(s);
   if(current(s))s.notice=t(result?.settlement?.status==='completed'?'clientRequests.refunded':'clientRequests.refundPending',{amount:money(req.requested_minor)});
   return;
  }
  if(a==='client-request'){
   // The usual «Register refund request», filled from the client's request, with their own words as a PDF to cite as evidence.
   const req=(s.clientRequests||[]).find(r=>r.id===target.dataset.id&&r.status==='open');
   if(!req||s.status?.can_register!==true||s.pending||s.storageError)return;
   if(!s.payments.some(p=>p.id===req.received_payment_id))throw Error('refund.paymentUnavailable');
   // Filled from the client's request: the amount they asked for, and their own request as the proof, fixed. Trato saves that
   // PDF once (the request id is the upload's idempotency key), waits until it is read and cites it; no upload window opens.
   s.request={scope:'payment_only',payments_reviewed:false,payment_id:req.received_payment_id,reason:req.reason,requested_by:'customer',evidence:[],
    client_request_id:req.id,amount:(req.requested_minor/100).toFixed(2),fixedProof:true};
   s.view='create';s.step=null;s.wizardOpen=true;s.registering='reading';notify(s);
   try{
    const filename=`client-refund-request-${req.id.slice(0,8)}.pdf`;
    let doc=(cloud.documents||[]).find(d=>d.original_filename===filename&&!d.deleted_at);
    if(!doc){
     const blob=await cloud.request(`/api/v1/projects/${s.project}/client-refund-requests/${req.id}/pdf`,{},true);
     if(!current(s))return;
     const meta={filename,title:t('clientRequests.documentTitle'),kind:'reference',...uploadContext(s)};
     const saved=await cloud.request(`/api/v1/projects/${s.project}/documents?${new URLSearchParams(meta)}`,{method:'POST',body:blob,headers:{'Content-Type':'application/pdf','Idempotency-Key':req.id}});
     doc=saved?.document;if(!doc?.id)throw Error('refund.evidenceMismatch');
     if(!cloud.documents.some(d=>d.id===doc.id))cloud.documents=[doc,...cloud.documents];
    }
    const citation=await citeWhenReady(s,doc.id);
    if(current(s)&&s.request?.client_request_id===req.id)s.request.evidence=[citation];
   }finally{if(current(s))s.registering=null;}
   return;
  }
  if(a==='open'){if(s.detail?.settlement.id===target.dataset.id&&s.editor)s.wizardOpen=true;else await openDetail(s,target.dataset.id);}
  if(a==='list'){s.view='list';s.pick=null;s.wizardOpen=false;}
  if(a==='cancel-create'){s.request=null;s.pick=null;s.view='list';s.wizardOpen=false;}
  if(a==='edit'&&editable(s)&&!s.pending){
   s.step=2;
   const kept=s.snapshot?.terms.adjustments||[],proof=s.detail?.settlement.request_evidence||[];
   if(proof.length&&kept.length<=1&&payment(s))s.editor={simple:true,refund:s.snapshot?(s.snapshot.breakdown.refund_minor/100).toFixed(2):'',note:s.snapshot?.terms.conditions||kept[0]?.description||''};
   else s.editor={items:kept.map(editItem),conditions:s.snapshot?.terms.conditions||'',reviewed:false};
  }
  if(a==='cancel-edit'){s.editor=null;s.pick=null;s.step=null;}
  if(a==='add-concept'&&s.editor&&s.editor.items.length<100){s.editor.items.push(emptyItem());s.editor.reviewed=false;}
  if(a==='remove-concept'&&s.editor){s.editor.items=s.editor.items.filter(x=>x.concept_id!==target.dataset.id);s.editor.reviewed=false;}
  if(a==='snapshot'){await openDetail(s,s.detail.settlement.id,target.dataset.id);if(current(s))s.step=3;}
  if(a==='pick')s.pick={target:target.dataset.target,docid:'',data:null,segment:0,quote:''};
  if(a==='cancel-pick')s.pick=null;
  if(a==='remove-evidence'){
   const refs=target.dataset.target==='request'?s.request?.evidence:target.dataset.target==='initial'?s.initial?.evidence:target.dataset.target==='workflow'?s.workflowForm?.evidence:s.editor?.items.find(x=>x.concept_id===target.dataset.target)?.evidence;
   refs?.splice(Number(target.dataset.index),1);if(s.editor)s.editor.reviewed=false;
  }
  if(a==='use-quote'){
   const pick=s.pick,quote=pick?.quote.trim(),data=pick?.data,segment=data?.segments[pick.segment];
   if(!quote||quote.length>4000||!segment?.text.includes(quote))throw Error('refund.evidenceMismatch');
   const citation={document_id:data.document.id,extraction_id:data.extraction.id,document_sha256:data.document.sha256,quote};
   const refs=pick.target==='request'?s.request?.evidence:pick.target==='initial'?s.initial?.evidence:pick.target==='workflow'?s.workflowForm?.evidence:s.editor?.items.find(x=>x.concept_id===pick.target)?.evidence;
   if(!refs||refs.length>=20)throw Error('refund.invalidForm');refs.push(citation);s.pick=null;if(s.editor)s.editor.reviewed=false;
  }
 }
 cloud.renderRefunds=function(panel){
  bindUploadModal();
  const s=state(),host=panel;wizard.setAttribute('aria-label',t('wizard.title'));
  if(s.resumeAfterUpload){host.innerHTML=`<p>${t('wizard.uploading')}</p>`;return;}
  if(s.wizardOpen){
   const status=s.detail?.settlement.status;
   host.innerHTML=`<section class="workspace-panel"><h3>${t('title')}</h3><p>${t(terminalStatuses.includes(status)?'status.'+status:'wizard.inProgress')}</p>${button('wizard-resume',detailAction(status))}</section>`;
   host.onclick=()=>{if(!wizard.open)wizard.showModal();};
   panel=wizard;
  }else{
   if(wizard.open)wizard.close();
   wizard.innerHTML='';
  }
  if(!s.loading&&(s.refreshPayments||!s.loaded&&!s.error))void load(s);
  const oldFocus=cloud.document.activeElement;const focusState=panel.contains(oldFocus)?{tag:oldFocus.tagName,name:oldFocus.name,data:{...oldFocus.dataset},start:oldFocus.selectionStart,end:oldFocus.selectionEnd}:null;
  const heading=s.wizardOpen?wizardHeader(s):`<header class="refund-list-heading"><div class="refund-list-record"><span class="refund-mark">${icon('undo-2')}</span><div><span class="eyebrow">${t('realRecords')}</span><h3>${t('title')}</h3></div></div>${assistantButton('list','open')}</header>`;
  if(autoRecoverable(s.pending)&&!s.busy&&s.recoverTried!==s.pending.key){s.recoverTried=s.pending.key;queueMicrotask(()=>void run(s,()=>autoRecover(s)));}
  const recovery=s.pending&&!(autoRecoverable(s.pending)&&(s.busy||s.recoverTried!==s.pending.key))?`<aside class="refund-notice" role="status"><p>${t('uncertain')}</p><div class="refund-actions">${button('query','query')}${s.pending.action==='send'?button('reconcile-send','reconcileSend'):''}${isFinancialAction(s.pending.action)?renderFinancialPending(s):s.pendingBody?button('retry-operation','retrySame'):''}</div></aside>`:'';
  // Inside the window, work in progress (saving, reading the PDF, registering, recovering) shows one loading state and then
  // the next step, instead of each intermediate message in turn.
  const working=s.wizardOpen&&!s.error&&(s.busy||s.registering||autoRecoverable(s.pending));
  const body=s.loaded?(working?(cloud.renderSkeleton?.('list',t('wizard.working'))||`<p role="status">${t('wizard.working')}</p>`):!s.wizardOpen?listHtml(s):s.view==='create'?requestHtml(s):s.view==='initial'?renderInitialPayment(s,evidenceHtml):detailHtml(s)):'';
  panel.innerHTML=`<section class="workspace-panel cloud-refunds refund-workspace" aria-label="${t('title')}">
   ${heading}${s.notice&&!working?`<p role="status">${esc(s.notice)}</p>`:''}${s.error?`<p role="alert" class="cloud-error">${esc(s.error)}</p>${button('reload',s.editor?'reloadDiscard':'retry')}`:''}
   ${s.storageError?`<p role="alert">${t('storageError')}</p>`:''}${working?'':recovery}${s.loading&&!s.loaded?(cloud.renderSkeleton?.('list',t('loading'))||''):''}
   <fieldset class="refund-body" ${s.busy||(s.loading&&!s.loaded)||s.pending||s.storageError?'disabled':''}>${body}</fieldset>
  </section>`;

  if(s.wizardOpen){
   if(s.pick)panel.querySelector('.refund-body').innerHTML=picker(s);
   if(s.reader)panel.querySelector('.refund-body').innerHTML=`<section class="refund-reader"><button type="button" class="text-button" data-refund-action="reader-close">${icon('arrow-left')}${t('wizard.back')}</button>${s.reader.pdf?`<iframe title="${t('original')}" src="${esc(s.reader.url)}"></iframe>`:''}</section>`;
   if(!wizard.open)wizard.showModal();
   if(focusState){const match=[...panel.querySelectorAll('button,input,select,textarea')].find(el=>el.tagName===focusState.tag&&el.name===focusState.name&&Object.entries(focusState.data).every(([k,v])=>el.dataset[k]===v));if(match&&!match.disabled){match.focus();if(typeof focusState.start==='number'&&match.setSelectionRange&&['text','search','url','tel','password','textarea'].includes(match.type))match.setSelectionRange(focusState.start,focusState.end);}else panel.querySelector('h2')?.focus();}
  }
  panel.onclick=event=>{
   const assist=event.target.closest('[data-refund-assistant]');
   if(assist&&(s.wizardOpen||assist.dataset.refundAssistant==='list')){
    event.preventDefault();
    cloud.openRefundAssistant?.(assist,assist.dataset.refundAssistant==='list'?{step:1,task:'intake'}:assistantFocus(s,assist.dataset.refundAssistant,assist.dataset.response||null,assist.dataset.support||null));
    return;
   }
   const upload=event.target.closest('[data-cloud-action="upload"], [data-cloud-action="tab"]');
   if(upload&&s.wizardOpen){event.preventDefault();event.stopPropagation();s.resumeAfterUpload=true;wizard.close();cloud.openSource('reference',uploadContext(s));return;}
   const target=event.target.closest('[data-refund-action]');if(!target||target.disabled||s.busy)return;event.preventDefault();void run(s,()=>action(s,target.dataset.refundAction,target));};
  panel.oninput=event=>{
   const el=event.target;
   if(financialInput(s,el))return;
   const docChange=documentInput(s,el);if(docChange){if(docChange==='render')notify(s);return;}
   if(el.dataset.refundField==='quote'&&s.pick){s.pick.quote=el.value;return;}
   const kind=el.closest('[data-refund-form]')?.dataset.refundForm;
   if(kind==='create'&&s.request&&el.name==='evidence_file'){s.request.file=el.files?.[0]||null;notify(s);return;}
   if(kind==='create'&&s.request&&el.name==='refund_target'){const all=el.value==='__project__';s.request.scope=all?'project_closure':'payment_only';s.request.payment_id=all?'':el.value;s.request.amount=undefined;if(!all)s.request.payments_reviewed=false;notify(s);return;}
   if(kind==='create'&&s.request&&el.name){s.request[el.name]=el.type==='checkbox'?el.checked:el.value;if(el.name==='scope')notify(s);}
   if(kind==='close'&&el.name){s.closure={...(s.closure||{}),[el.name]:el.value};}
   if(kind==='draft'&&s.editor?.simple){if(el.name)s.editor[el.name]=el.value;return;}
   if(kind==='draft'&&s.editor){

    const item=el.dataset.refundItem?s.editor.items.find(x=>x.concept_id===el.dataset.refundItem):null;
    if(item)item[el.name]=el.value;else if(el.name==='conditions')s.editor.conditions=el.value;
    s.editor.reviewed=el.name==='reviewed'?el.checked:false;
    const check=panel.querySelector('[name="reviewed"]');if(check)check.checked=s.editor.reviewed;
    if(el.name==='mode'){notify(s);return;}
    if(item?.mode==='percent'){const total=panel.querySelector(`[data-refund-item-total="${item.concept_id}"]`);if(total)total.textContent=percentAmount(item);}
    const output=panel.querySelector('[data-refund-preview]');if(output)output.innerHTML=preview(s);
   }
  };
  panel.onchange=event=>{
   const el=event.target;
   // The choice is kept at once, so a redraw never shows «Choose document» again, and the document's text loads on its own:
   // another action in progress no longer swallows the choice. chooseDocument ignores answers for an older choice.
   if(el.dataset.refundField==='document'&&s.pick){
    s.pick.docid=el.value;s.pick.data=null;s.pick.quote='';s.error='';notify(s);
    void chooseDocument(s,el.value).then(()=>{if(current(s))notify(s);},error=>{if(current(s)){s.error=message(error);notify(s);}});
   }
   if(el.dataset.refundField==='segment'&&s.pick){s.pick.segment=Number(el.value);s.pick.quote=s.pick.data?.segments[s.pick.segment]?.text.slice(0,4000)||'';notify(s);}
  };
  panel.onsubmit=event=>{
   const form=event.target;if(!form.dataset.refundForm)return;event.preventDefault();event.stopPropagation();
   if(s.busy||s.pending&&form.dataset.refundForm!=='finance-resume')return;
   void run(s,async()=>{
    if(await financialSubmit(s,cloud,form,{write,resend:sendPending}))return;
    if(await documentSubmit(s,cloud,form,{write}))return;
    if(form.dataset.refundForm==='create'){
     if(s.status?.can_register!==true)throw Error('refund.openRequest');
     const r=s.request;if((r.scope==='payment_only'&&!s.payments.some(p=>p.id===r.payment_id))||!r.evidence.length&&!r.file||!r.reason.trim())throw Error('refund.evidenceRequired');
     s.autoRefund=null;
     if(r.scope==='payment_only'){
      const pay=s.payments.find(p=>p.id===r.payment_id),left=pay.amount_minor-Math.min(pay.amount_minor,pay.local_previous_refunds_minor||0);
      const asked=r.amount===undefined?left:parseRefundMoney(r.amount);
      if(!(asked>0)||asked>left)throw Error('refund.simple.amountInvalid');
      if(asked<left)s.autoRefund={refund:(asked/100).toFixed(2),note:r.reason.trim()};
     }
     if(!r.evidence.length){
      try{r.evidence=[await attachProof(s,r.file)];r.file=null;}
      finally{s.registering=null;}
      if(!current(s))return;
     }
     await write(s,'create',{...(r.scope==='payment_only'?{payment_id:r.payment_id}:{payment_ids:s.payments.map(p=>p.id),payments_reviewed:r.payments_reviewed}),scope:r.scope,reason:r.reason.trim(),requested_by:r.requested_by,request_evidence:r.evidence},
      r.client_request_id?{client_request_id:r.client_request_id}:{});
    }else if(form.dataset.refundForm==='draft'){
     if(!editable(s)||!s.editor)throw Error('refund.reviewRequired');
     const {terms}=buildRefundTerms(s.editor.simple?simpleEditor(s):s.editor,payment(s));
     await write(s,'edit_draft',{expected_snapshot_id:s.detail.settlement.current_snapshot_id,terms});
    }else if(form.dataset.refundForm==='close'){
     const values=new FormData(form);
     await write(s,'close',{reason:values.get('reason'),notes:values.get('notes').trim()});
    }
   });
  };
 };
}
