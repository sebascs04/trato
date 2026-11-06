import {uiText,uiLocale,uiLanguage} from './i18n.mjs';
import {icon} from './icons.mjs';
const t=(key,values)=>uiText(['planPayment',key].join('.'),values);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=value=>new Intl.NumberFormat(uiLocale(),{style:'currency',currency:'USD'}).format(Number(value));
export function stagePaymentEmailMarkup(value,checkoutUrl){
 let trustedLink=false;
 try{const url=new URL(checkoutUrl);trustedLink=['https:','http:'].includes(url.protocol)&&!url.username&&!url.password&&url.pathname==='/initial-payment.html'&&/^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get('checkout')||'');}catch{}
 const body=String(value.body).split('\n').filter(line=>line.trim()).map(line=>{
  if(trustedLink&&line.trim()===checkoutUrl)return `<p class="plan-mail-cta"><a href="${esc(checkoutUrl)}" target="_blank" rel="noopener noreferrer">${t('paymentLinkLabel')}${icon('arrow-up-right')}</a></p>`;
  return `<p${/^USD \d/.test(line)?' class="plan-mail-amount"':''}>${esc(line)}</p>`;
 }).join('');
 return `<form data-plan-stage-email class="plan-mail-form"><header class="plan-mail-heading"><span class="plan-mail-heading-icon" aria-hidden="true">${icon('mail')}</span><div><h3>${t('emailPreviewTitle')}</h3><p>${t('emailPreviewHelp')}</p></div></header><section class="plan-mail-envelope"><div class="plan-mail-recipient"><span>${t('recipient')}</span><strong>${esc(value.recipient)}</strong></div><div class="plan-mail-subject"><span>${t('subject')}</span><strong>${esc(value.subject)}</strong></div><div class="plan-mail-preview">${body}</div></section><footer class="dialog-actions"><button type="button" class="button secondary" data-plan-pay="reload">${uiText('Cancelar')}</button><button type="submit" class="button">${icon('send')}${t('sendEmail')}</button></footer><p class="cloud-error" role="alert" data-plan-mail-error></p></form>`;
}
export function stagePaymentStep(pay){
 if(pay.status==='completed')return 'paid';
 if(!pay.order_id)return 'prepare_order';
 if(pay.mail_status==='sent')return 'await_payment';
 if(pay.mail_status==='sending')return 'sending_email';
 if(pay.mail_status==='uncertain')return 'check_email';
 if(['not_sent','failed'].includes(pay.mail_status))return 'send_email';
 throw Error('Invalid payment email status');
}
export async function loadStagePayment(request,project,position,isCurrent=()=>true){
 const base=`/api/v1/projects/${project}/stages/${position}`;
 const pay=await request(`${base}/checkout`);
 return pay||!isCurrent()?{pay}:{pay,evidence:await request(`${base}/evidence`)};
}
export function mergeStageEvidence(existing,documents,position){
 const previous=new Map(existing.map(d=>[d.id,d]));
 return [...existing.filter(d=>d.upload_context?.stage_position!==position),...documents.map(d=>({...previous.get(d.id),...d}))]
  .sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')));
}
export function createPlanProgressLoader(request,now=Date.now){
 const entries=new Map();
 return {
  load(key,project){
   const old=entries.get(key);if(old&&(old.pending||old.until>now()))return old.promise;
   const entry={pending:true,until:0};entries.set(key,entry);
   entry.promise=(async()=>request(`/api/v1/projects/${project}/plan-progress`))().then(value=>{
    entry.pending=false;entry.until=now()+15000;return value;
   },error=>{if(entries.get(key)===entry)entries.delete(key);throw error;});return entry.promise;
  },
  clear(key){if(key)entries.delete(key);else entries.clear();}
 };
}
export function installPlanPayments(cloud){
 const doc=cloud.document;let modalState=null,timer=null,revision=0;
 const progressLoader=createPlanProgressLoader(path=>cloud.request(path));
 const scope=()=>cloud.active?`${cloud.navigationOwner}:${cloud.projectId}`:null;
 const valid=state=>scope()===state.scope&&modalState===state&&cloud.modal.open&&cloud.modal.querySelector('[data-plan-payment-content]')?.dataset.planScope===state.scope;
 const endpoint=(project,position,tail='')=>`/api/v1/projects/${project}/stages/${position}/checkout${tail}`;
 const message=error=>t(({PLAN_PREVIOUS_STAGE_UNPAID:'previousUnpaid',PLAN_EVIDENCE_REQUIRED:'evidenceRequired',PLAN_EVIDENCE_NOT_READY:'evidencePending',PLAN_EVIDENCE_INVALID:'evidenceInvalid',PLAN_EVIDENCE_PROTECTED:'evidenceProtected',PLAN_STAGE_REQUIRED:'stageRequired',PLAN_LEGACY_PAYMENT_REQUIRES_REVIEW:'legacyReview',INITIAL_PAYER_MISMATCH:'payerMismatch'})[error.code]||'error');
 const originalReset=cloud.reset.bind(cloud);cloud.reset=function(){clearTimeout(timer);modalState=null;revision++;progressLoader.clear();return originalReset();};
 async function progress(host,plan,overview=false){
  const key=scope(),project=cloud.projectId;if(!key||!host?.isConnected)return;
  const generation=++revision;
  const region=doc.createElement('div');region.className='plan-payment-progress';region.setAttribute('role','status');region.textContent=t('loading');(overview?host.querySelector('.cloud-agreement')||host:host).append(region);
  try{
   const value=await progressLoader.load(key,project);
   if(scope()!==key||!host.isConnected||generation!==revision)return;
   if(!value){region.remove();return;}
   const paid=value.stages.filter(s=>s.status==='completed').length;
   region.textContent=value.completed_at?t('completed'):t('paidCount',{paid,total:value.stages.length});
   if(!overview)region.remove();
   if(overview){region.classList.add('plan-overview-progress');return;}
   for(const [i,stage] of plan.stages.entries()){
    const position=stage.position??i+1,row=host.querySelector(`[data-plan-stage-row="${position}"]`);if(!row)continue;
    const state=value.stages.find(s=>s.position===position),allowed=value.stages.filter(s=>s.position<position).every(s=>s.status==='completed');
    const button=doc.createElement('button');button.type='button';button.className='text-button plan-stage-pay';button.textContent=t(state?.status==='completed'?'paid':allowed?'deliveryAndPayment':'locked');button.disabled=!allowed;
    button.addEventListener('click',()=>open(project,position,stage,value));row.append(button);
   }
  }catch(error){if(scope()===key&&host.isConnected){region.textContent=message(error);const retry=doc.createElement('button');retry.className='text-button';retry.textContent=t('retry');retry.addEventListener('click',()=>{region.remove();void progress(host,plan,overview);});region.append(retry);}}
 }
 cloud.renderPlanPayments=(host,plan)=>{if(plan)void progress(host,plan);};
 const renderAgreement=cloud.renderAgreement.bind(cloud);cloud.renderAgreement=function(host){renderAgreement(host);void progress(host,null,true);};
 async function open(project,position,stage,progressValue){
  clearTimeout(timer);const state={scope:scope(),project,position,stage,progress:progressValue,view:'payment',busy:false,upload:null,pay:null,files:[],ready:[],withdrawals:[],readGeneration:0,error:'',uploadKeys:new Map()};modalState=state;
  cloud.modal.addEventListener('close',()=>{if(!cloud.modal.open&&modalState===state){clearTimeout(timer);modalState=null;progressLoader.clear(state.scope);if(scope()===state.scope){cloud.historyLoaded=false;cloud.releaseProjectMap?.();cloud.notify();}}},{once:true});
  cloud.show(t('deliveryAndPayment'),`<div data-plan-payment-content data-plan-scope="${esc(state.scope)}"><section class="plan-delivery-payment"><header><div><span class="eyebrow">${t('deliverable',{number:position})}</span><h3>${esc(stage.title)}</h3></div><strong>${money(stage.amount)}</strong></header><div class="plan-stage-loading" role="status" aria-busy="true"><p>${t('loading')}</p><span aria-hidden="true"></span><span aria-hidden="true"></span></div></section></div>`);await load(state);
 }
 async function load(state){
  const run=++state.readGeneration;
  try{
   const {pay,evidence}=await loadStagePayment(path=>cloud.request(path),state.project,state.position,()=>valid(state)&&run===state.readGeneration);
   if(!valid(state)||run!==state.readGeneration)return;
   state.pay=pay;state.error='';
   if(pay){paint(state);scheduleStateRead(state);return;}
   if(!Array.isArray(evidence.documents)||!Array.isArray(evidence.files)||!Array.isArray(evidence.withdrawals))throw Error('Invalid stage evidence');
   state.withdrawals=evidence.withdrawals;
   state.files=evidence.documents.map(d=>({...d,vector_status:evidence.files.find(f=>f.id===d.id)?.status,vector_error:evidence.files.find(f=>f.id===d.id)?.error_code}));
   state.ready=state.files.filter(d=>evidence.files.some(f=>f.id===d.id&&f.status==='ready'&&f.summary_status==='ready'));
   cloud.documents=mergeStageEvidence(cloud.documents||[],evidence.documents,state.position);
   if(state.upload?.id&&state.files.some(file=>file.id===state.upload.id))state.upload=null;
   paint(state);scheduleStateRead(state);
  }catch(error){if(valid(state)&&run===state.readGeneration){state.error=message(error);paint(state);}}
 }
 function evidenceStatus(state,file){
  if(state.ready.some(f=>f.id===file.id))return 'processed';
  if(['rejected','needs_clarification'].includes(file.processing_outcome?.status)||file.vector_error==='FILE_REVIEW_REQUIRED')return 'reviewEvidence';
  if(file.extraction?.status==='error'||file.processing_outcome?.status==='error'||['index_error','source_error'].includes(file.vector_status))return 'failedEvidence';
  return 'processing';
 }
 function scheduleStateRead(state){
  clearTimeout(timer);
  if(!valid(state)||state.error||state.view==='email')return;
  if(state.pay?.status==='completed')return;
  if(!state.pay&&!state.files.some(file=>evidenceStatus(state,file)==='processing'))return;
  timer=setTimeout(()=>{if(!valid(state))return;if(state.busy){scheduleStateRead(state);return;}void load(state);},3500);
 }
 // Sandbox only: lets the freelancer open the same checkout the client receives by email. Payment is still verified by the backend.
 function sandboxCheckout(pay){
  if(pay?.sandbox!==true||typeof pay.checkout_url!=='string'||!/^https?:\/\//.test(pay.checkout_url))return '';
  return `<aside class="sandbox-checkout" role="note">${icon('info')}<div><strong>${t('sandboxTitle')}</strong><p>${t('sandboxHelp')}</p></div><a class="button secondary" href="${esc(pay.checkout_url)}" target="_blank" rel="noopener">${t('sandboxOpen')}${icon('arrow-up-right')}</a></aside>`;
 }
 function paymentActions(pay){
  const step=stagePaymentStep(pay);
  if(step==='paid')return '';
  if(step==='send_email')return `<div class="plan-payment-mail-actions"><span class="plan-payment-status">${t('readyToSend')}</span><button class="button" type="button" data-plan-pay="email">${icon('mail')}${t('reviewEmail')}</button></div>${sandboxCheckout(pay)}`;
  if(step==='await_payment')return `<div class="plan-payment-pending"><span class="plan-payment-status">${t('awaitingClientPayment')}</span><button class="button secondary" type="button" data-plan-pay="verify">${t('verify')}</button></div>${sandboxCheckout(pay)}`;
  if(step==='prepare_order')return `<div class="plan-payment-pending"><span class="plan-payment-status">${t('preparingOrder')}</span><button class="button secondary" type="button" data-plan-pay="verify">${t('checkPreparation')}</button></div>`;
  return `<div class="plan-payment-pending"><span class="plan-payment-status">${t(step==='sending_email'?'sendingEmail':'emailUnconfirmed')}</span><button class="text-button" type="button" data-plan-pay="reload">${t('checkEmailStatus')}</button></div>`;
 }
 function paint(state){
  if(!valid(state))return;const pay=state.pay,paid=pay?.status==='completed';
  cloud.modal.querySelector('[data-plan-payment-content]').innerHTML=`<section class="plan-delivery-payment"><header><div><span class="eyebrow">${t('deliverable',{number:state.position})}</span><h3>${esc(state.stage.title)}</h3></div><strong>${money(state.stage.amount)}</strong></header>${paid?`<p class="plan-payment-confirmation">${icon('circle-check')}${t('verifiedPaid')}</p>`:!pay?`<p class="plan-evidence-help">${t('uploadHelp')}</p>`:''}${state.upload?`<article class="plan-upload-pending" role="status" aria-live="polite"><span class="plan-upload-icon ${state.upload.phase!=='unconfirmed'?'is-loading':''}" aria-hidden="true">${icon(state.upload.phase==='unconfirmed'?'file-text':'refresh-cw')}</span><div><strong>${esc(state.upload.name)}</strong><small>${t(state.upload.phase==='checking'?'checkingFile':state.upload.phase==='uploading'?'uploadingFile':state.upload.phase==='unconfirmed'?'uploadUnconfirmed':'processing')}</small></div></article>`:''}${state.files.length?`<div class="plan-evidence-list">${state.files.map(d=>`<article class="plan-evidence-file"><span>${icon('file-text')}${esc(d.title)}</span><small>${t(evidenceStatus(state,d))}</small>${!pay?`<button type="button" class="text-button plan-evidence-remove" data-plan-pay="remove-evidence" data-plan-remove-id="${esc(d.id)}" aria-label="${t('removeEvidenceNamed',{name:d.title})}">${t('removeEvidence')}</button>`:''}</article>`).join('')}</div>`:''}${state.withdrawals.length?`<section class="plan-withdrawal-pending" role="status"><p>${t('cleanupPending')}</p>${state.withdrawals.map(item=>`<button type="button" class="text-button" data-plan-pay="remove-evidence" data-plan-remove-id="${esc(item.file_id)}">${t('retryCleanup')} · ${esc(item.title)}</button>`).join('')}</section>`:''}${!pay?`<label class="plan-evidence-upload" tabindex="0" role="button"><span class="plan-evidence-upload-icon" aria-hidden="true">${icon('file-up')}</span><span><strong>${t('uploadEvidence')}</strong><small>${t('pdfLimit')}</small></span><input type="file" accept=".pdf,application/pdf" data-plan-evidence-file hidden></label><footer class="plan-evidence-next"><span>${t(state.ready.length?'readyToCharge':state.files.length?'waitForEvidence':'evidenceRequired')}</span><button type="button" class="button" data-plan-pay="prepare" ${!state.ready.length?'disabled':''}>${t('preparePayment')}${icon('arrow-right')}</button></footer>${state.files.some(file=>evidenceStatus(state,file)==='processing')?`<button type="button" class="text-button" data-plan-pay="background">${t('continueWorking')}</button>`:''}`:!paid?`${paymentActions(pay)}`:''}${state.error?`<div class="plan-payment-error"><p class="cloud-error" role="alert">${esc(state.error)}</p><button type="button" class="text-button" data-plan-pay="reload">${t('retry')}</button></div>`:''}<p role="status" data-plan-pay-notice></p></section>`;
  if(state.busy)cloud.modal.querySelector('[data-plan-payment-content]').querySelectorAll('button,input').forEach(el=>el.disabled=true);
  scheduleStateRead(state);
 }
 doc.addEventListener('keydown',event=>{
  const target=event.target.closest?.('.plan-evidence-upload');
  if(target&&event.target===target&&(event.key==='Enter'||event.key===' ')){
   event.preventDefault();if(modalState&&valid(modalState)&&!modalState.busy)target.querySelector('input')?.click();
  }
 });
 doc.addEventListener('change',async event=>{
  const input=event.target;if(!input.matches('[data-plan-evidence-file]'))return;const state=modalState;if(!state||!valid(state)||state.busy)return;
  const file=input.files?.[0];if(!file)return;
  state.readGeneration++;state.busy=true;state.error='';state.upload={name:file.name,phase:'checking',id:null};paint(state);
  try{
   if(!file.name.toLowerCase().endsWith('.pdf')||file.size>10485760||!file.size||(await file.slice(0,5).text())!=='%PDF-')throw Error(t('pdfError'));
   if(!valid(state))return;
   state.upload.phase='uploading';paint(state);
   const identity=JSON.stringify([file.name,file.size,file.lastModified]);if(!state.uploadKeys.has(identity))state.uploadKeys.set(identity,crypto.randomUUID());
   const query=new URLSearchParams({filename:file.name,title:t('evidenceTitle',{number:state.position}),kind:'delivery',purpose:'delivery_evidence',stage_position:state.position});
   const uploaded=await cloud.request(`/api/v1/projects/${state.project}/documents?${query}`,{method:'POST',body:file,headers:{'Content-Type':'application/pdf','Accept-Language':uiLanguage(),'Idempotency-Key':state.uploadKeys.get(identity)}});
   if(valid(state)){state.upload.phase='processing';state.upload.id=uploaded.document?.id;paint(state);await load(state);}
  }catch(error){if(valid(state)){if(state.upload)state.upload.phase='unconfirmed';state.error=error.code?message(error):error.message;}}
  finally{state.busy=false;if(valid(state))paint(state);}
 });
 doc.addEventListener('click',async event=>{
  const button=event.target.closest('[data-plan-pay]'),state=modalState;if(!button||!state||!valid(state)||state.busy)return;
  const action=button.dataset.planPay;state.readGeneration++;state.busy=true;state.error='';paint(state);
  try{
   if(action==='remove-evidence'){
    const fileId=button.dataset.planRemoveId;
    await cloud.request(`/api/v1/projects/${state.project}/stages/${state.position}/evidence/${encodeURIComponent(fileId)}`,{method:'DELETE'});
    if(valid(state)){state.uploadKeys.clear();await load(state);}
    return;
   }
   if(action==='background'){clearTimeout(timer);cloud.modal.close();return;}
   if(action==='reload'){state.view='payment';await load(state);return;}
   if(action==='prepare'){
    if(!state.ready.length)throw {code:state.files.length?'PLAN_EVIDENCE_NOT_READY':'PLAN_EVIDENCE_REQUIRED'};
    const key=`trato:stage-payment:${state.scope}:${state.position}`;let id=cloud.storage.getItem(key);if(!id){id=crypto.randomUUID();cloud.storage.setItem(key,id);}
    state.pay=await cloud.request(endpoint(state.project,state.position),{...cloud.json({evidence_document_id:state.ready[0].id,output_language:uiLanguage(),confirmed:true}),headers:{'Content-Type':'application/json','Idempotency-Key':id}});
   }
   if(action==='verify'){state.pay=await cloud.request(endpoint(state.project,state.position,'/reconcile'),cloud.json({}));}
   if(action==='email'){
    const value=await cloud.request(endpoint(state.project,state.position,'/email-preview'));if(!valid(state))return;state.email=value;state.view='email';clearTimeout(timer);
    cloud.modal.querySelector('[data-plan-payment-content]').innerHTML=stagePaymentEmailMarkup(value,state.pay.checkout_url);return;
   }
  }catch(error){if(valid(state))state.error=message(error);}finally{state.busy=false;if(valid(state)&&(action!=='email'||state.error)){paint(state);}}
 });
 doc.addEventListener('submit',async event=>{
  if(!event.target.matches('[data-plan-stage-email]'))return;event.preventDefault();const state=modalState;if(!state||!valid(state)||state.busy)return;
  const form=event.target;state.busy=true;form.querySelectorAll('button').forEach(b=>b.disabled=true);
  try{state.pay=await cloud.request(endpoint(state.project,state.position,'/email'),cloud.json({digest:state.email.digest,confirmed:true}));if(valid(state)){state.busy=false;state.view='payment';paint(state);}}
  catch(error){if(valid(state)&&form.isConnected)form.querySelector('[data-plan-mail-error]').textContent=message(error);}
  finally{state.busy=false;if(form.isConnected)form.querySelectorAll('button').forEach(b=>b.disabled=false);}
 });
}
