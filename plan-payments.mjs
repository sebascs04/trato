import {uiText,uiLocale,uiLanguage} from './i18n.mjs';
import {icon} from './icons.mjs';
import {renderAIActivity} from './ai-activity.mjs';
import {createPortalAssistant} from './portal-assistant.mjs';
import {mountPayPalButtons} from './paypal-buttons.mjs';
import {installRefundRequestThread,refundRequestNotice,refundRequestActive,refundRequestClosed} from './refund-request-thread.mjs';
const t=(key,values)=>uiText(['planPayment',key].join('.'),values);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=value=>new Intl.NumberFormat(uiLocale(),{style:'currency',currency:'USD'}).format(Number(value));
// TeTrato drafts the invoice concept (addendum or deliverable) from facts the backend reads; the freelancer reviews it.
// If it fails, the error is shown and the field stays editable, with a retry: nothing is filled in silently.
export async function draftInvoiceConcept(cloud,body,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))){
 const job=await cloud.request('/api/v1/ai/invoice-concepts',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify({...body,output_language:uiLanguage()})});
 let current=job;const until=Date.now()+90000;
 while(['queued','running'].includes(current.status)){
  if(Date.now()>until)throw Error(uiText('invoice.conceptFailed'));
  await wait(1500);current=await cloud.request(`/api/v1/ai/jobs/${encodeURIComponent(job.id)}`);
 }
 if(current.status!=='completed'||typeof current.result?.concept!=='string'||!current.result.concept.trim())throw Error(uiText('invoice.conceptFailed'));
 return current.result.concept;
}
export function fillInvoiceConcept(cloud,form,body){
 const input=form.querySelector('[name="concept"]'),status=form.querySelector('[data-invoice-concept-status]');if(!input||!status)return;
 // While TeTrato writes, only TeTrato is shown; the invoice form appears whole once the concept is ready.
 const waiting=form.ownerDocument.createElement('div');form.before(waiting);
 const run=async()=>{
  form.hidden=true;status.innerHTML='';waiting.innerHTML=renderAIActivity({label:uiText('invoice.conceptDrafting'),compact:true});
  try{const concept=await draftInvoiceConcept(cloud,body);if(!form.isConnected)return;input.value=concept.slice(0,200);status.innerHTML=`<p class="field-help">${icon('sparkles')}${uiText('invoice.conceptDrafted')}</p>`;}
  catch(error){if(!form.isConnected)return;status.innerHTML=`<p class="cloud-error" role="alert">${esc(error.message)}</p><button type="button" class="text-button" data-invoice-concept-retry>${uiText('invoice.conceptRetry')}</button>`;status.querySelector('[data-invoice-concept-retry]').addEventListener('click',run);}
  finally{if(form.isConnected){waiting.innerHTML='';form.hidden=false;input.focus();}}
 };
 void run();
}
export function stagePaymentEmailMarkup(value,checkoutUrl){
 let trustedLink=false;
 try{const url=new URL(checkoutUrl);trustedLink=['https:','http:'].includes(url.protocol)&&!url.username&&!url.password&&url.pathname==='/initial-payment.html'&&/^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get('checkout')||'')
  ||url.protocol==='https:'&&url.hostname==='www.sandbox.paypal.com'&&url.pathname==='/invoice/p/'&&!url.username&&!url.password;}catch{}
 const body=String(value.body).split('\n').filter(line=>line.trim()).map(line=>{
  if(trustedLink&&line.trim()===checkoutUrl)return `<p class="plan-mail-cta"><a href="${esc(checkoutUrl)}" target="_blank" rel="noopener noreferrer">${t('paymentLinkLabel')}${icon('arrow-up-right')}</a></p>`;
  return `<p${/^USD \d/.test(line)?' class="plan-mail-amount"':''}>${esc(line)}</p>`;
 }).join('');
 return `<form data-plan-stage-email class="plan-mail-form"><header class="plan-mail-heading"><span class="plan-mail-heading-icon" aria-hidden="true">${icon('mail')}</span><div><h3>${t('emailPreviewTitle')}</h3><p>${t('emailPreviewHelp')}</p></div></header><section class="plan-mail-envelope"><div class="plan-mail-recipient"><span>${t('recipient')}</span><strong>${esc(value.recipient)}</strong></div><div class="plan-mail-subject"><span>${t('subject')}</span><strong>${esc(value.subject)}</strong></div><div class="plan-mail-preview">${body}</div></section><footer class="dialog-actions"><button type="button" class="button secondary" data-plan-pay="reload">${uiText('Cancelar')}</button><button type="submit" class="button">${icon('send')}${t('sendEmail')}</button></footer><p class="cloud-error" role="alert" data-plan-mail-error></p></form>`;
}
export function stagePaymentStep(pay){
 if(pay.status==='completed')return 'paid';
 if(pay.method==='invoice'&&!pay.invoice_url)return 'finish_invoice';
 if(!pay.order_id&&pay.method!=='invoice')return 'prepare_order';
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
 // The client's refund request as a conversation; which open request a Report a problem button is about.
 installRefundRequestThread(cloud,{requestFor:trigger=>{
  const requests=[...(cloud.clientRefundRequests||[])].reverse();
  const slot=trigger.closest?.('[data-stage-problem]');
  if(slot)return requests.find(r=>r.project_id===slot.dataset.project&&r.stage_position===Number(slot.dataset.position)&&r.status==='open');
  return requests.find(r=>r.proposal_id&&r.proposal_id===cloud.clientProposal&&r.status==='open');
 }});
 const scope=()=>cloud.active?`${cloud.navigationOwner}:${cloud.projectId}`:null;
 const valid=state=>scope()===state.scope&&modalState===state&&cloud.modal.open&&cloud.modal.querySelector('[data-plan-payment-content]')?.dataset.planScope===state.scope;
 const endpoint=(project,position,tail='')=>`/api/v1/projects/${project}/stages/${position}/checkout${tail}`;
 const message=error=>t(({PLAN_PREVIOUS_STAGE_UNPAID:'previousUnpaid',PLAN_EVIDENCE_REQUIRED:'evidenceRequired',PLAN_EVIDENCE_NOT_READY:'evidencePending',PLAN_EVIDENCE_INVALID:'evidenceInvalid',PLAN_EVIDENCE_PROTECTED:'evidenceProtected',PLAN_STAGE_REQUIRED:'stageRequired',PLAN_LEGACY_PAYMENT_REQUIRES_REVIEW:'legacyReview',PLAN_STAGE_ALREADY_REQUESTED:'alreadyRequested',INITIAL_PAYER_MISMATCH:'payerMismatch'})[error.code]||'error')+(error?.code&&!['PLAN_PREVIOUS_STAGE_UNPAID','PLAN_EVIDENCE_REQUIRED','PLAN_EVIDENCE_NOT_READY','PLAN_EVIDENCE_INVALID','PLAN_EVIDENCE_PROTECTED','PLAN_STAGE_REQUIRED','PLAN_LEGACY_PAYMENT_REQUIRES_REVIEW','PLAN_STAGE_ALREADY_REQUESTED','INITIAL_PAYER_MISMATCH'].includes(error.code)&&/^[A-Z][A-Z0-9_]{2,60}$/.test(error.code)?` (${error.code})`:'');
 const originalReset=cloud.reset.bind(cloud);cloud.reset=function(){clearTimeout(timer);modalState=null;revision++;progressLoader.clear();cloud.clientPlans=undefined;cloud.clientPlansFailed=false;cloud.clientDisputesSettled=false;cloud.clientProblemsSettled=false;return originalReset();};
 // Last progress per project: a re-render repaints it at once and refreshes quietly, without a loading line.
 const lastProgress=new Map();
 function paintProgress(host,plan,value,project,region,overview){
  // Clear what an earlier paint added, so a repaint never duplicates buttons.
  if(typeof host.querySelectorAll==='function'){host.querySelectorAll('.plan-stage-pay,.plan-stage-edit-open').forEach(el=>el.remove());
   host.querySelectorAll('.plan-stage-title-cell').forEach(cell=>{const name=cell.querySelector(':scope > strong');if(name)cell.replaceWith(name);});}
  if(!value){region?.remove();return;}
  const paid=value.stages.filter(s=>s.status==='completed').length;
  if(region)region.textContent=value.completed_at?t('completed'):t('paidCount',{paid,total:value.stages.length});
  if(overview){region?.classList.add('plan-overview-progress');return;}
  region?.remove();
  for(const [i,stage] of plan.stages.entries()){
    const position=stage.position??i+1,row=host.querySelector(`[data-plan-stage-row="${position}"]`);if(!row)continue;
    const state=value.stages.find(s=>s.position===position),allowed=value.stages.filter(s=>s.position<position).every(s=>s.status==='completed');
    const button=doc.createElement('button');button.type='button';button.className='text-button plan-stage-pay';button.textContent=t(state?.status==='completed'?'paid':allowed?'deliveryAndPayment':'locked');button.disabled=!allowed;
    // What the client did with the last delivery sent, so the freelancer sees it without opening the deliverable.
    const client=value.client?.[String(position)];
    // Shown as the deliverable's own button text, so the row keeps its columns.
    // The same tag the client sees, inside a plain button that still opens the deliverable.
    // A refund PayPal confirmed on this stage's payment, as Refunds and the client's Work plan show it.
    const refunded=state?.status==='completed'&&state.refunded_minor>0?(state.paid_minor&&state.refunded_minor<state.paid_minor?'clientAccount.state.partiallyRefunded':'clientAccount.state.refunded'):'';
    // The client asked for this stage's money back: said here like on the client's side, until the refund ends.
    const asked=state?.status==='completed'&&state.refund_request?['waiting',state.refund_request==='open'?'clientPlan.refundRequested':'clientPlan.refundInProgress']:null;
    const tag=asked?asked:refunded?['paid',refunded]:state?.status==='completed'?['paid','clientPlan.paid']:client&&allowed?(client.decision==='changes_requested'?['waiting','clientAccount.state.changesRequested']:client.decision==='approved'?['done','clientPlan.approved']:['open','clientPlan.rowWaiting']):null;
    button.addEventListener('click',()=>open(project,position,stage,value));
    // The colored state is the button itself: a border, an arrow and the hand cursor say it opens the deliverable.
    if(tag){button.className=`plan-stage-pay cloud-client-agreement-state ${tag[0]}`;button.style.cssText='border:1px solid currentColor;cursor:pointer;display:inline-flex;align-items:center;gap:6px;padding:5px 14px;font:inherit;font-size:12px;font-weight:600';
     button.textContent=uiText(tag[1]);button.insertAdjacentHTML('beforeend',icon('arrow-right'));const arrow=button.querySelector('svg');if(arrow){arrow.setAttribute('width','14');arrow.setAttribute('height','14');}}
    row.append(button);
    // A deliverable without checkout or delivery evidence has not started: its wording can still be corrected.
    if(!value.completed_at&&!state?.payment_id&&!state?.evidence_document_id&&cloud.openPlanStageEdit){const edit=doc.createElement('button');edit.type='button';edit.className='icon-button proposal-edit plan-stage-edit-open';edit.innerHTML=icon('pencil');edit.setAttribute('aria-label',uiText('planEdit.title',{number:position}));edit.title=uiText('planEdit.title',{number:position});edit.addEventListener('click',()=>cloud.openPlanStageEdit(position));
      // Pencil next to the deliverable's name, in the same grid cell, like the addendum card's edit button.
      const name=row.querySelector(':scope > strong');if(name){const cell=doc.createElement('span');cell.className='plan-stage-title-cell';name.before(cell);cell.append(name,edit);}else row.append(edit);}
   }
 }
 async function progress(host,plan,overview=false){
  const key=scope(),project=cloud.projectId;if(!key||!host?.isConnected)return;
  const generation=++revision,known=lastProgress.has(key)?lastProgress.get(key):undefined;
  let region=null;
  if(overview||known===undefined){region=doc.createElement('div');region.className='plan-payment-progress';region.setAttribute('role','status');region.textContent=t('loading');(overview?host.querySelector('.cloud-agreement')||host:host).append(region);}
  if(known!==undefined)paintProgress(host,plan,known,project,region,overview);
  try{
   // The plan's payments and the client's answers are read together, so each row is painted once.
   const [loaded,client]=await Promise.all([progressLoader.load(key,project),overview?null:cloud.request(`/api/v1/projects/${project}/stage-client-status`).catch(()=>null)]);
   const value=loaded&&{...loaded,client};
   if(scope()!==key||!host.isConnected||generation!==revision)return;
   const changed=known===undefined||JSON.stringify(known)!==JSON.stringify(value);lastProgress.set(key,value);
   if(changed)paintProgress(host,plan,value,project,region,overview);
  }catch(error){if(scope()===key&&host.isConnected){if(!region){region=doc.createElement('div');region.className='plan-payment-progress';region.setAttribute('role','status');(overview?host.querySelector('.cloud-agreement')||host:host).append(region);}region.textContent=message(error);const retry=doc.createElement('button');retry.className='text-button';retry.textContent=t('retry');retry.addEventListener('click',()=>{region.remove();void progress(host,plan,overview);});region.append(retry);}}
 }
 cloud.renderPlanPayments=(host,plan)=>{if(plan)void progress(host,plan);};
 // Client account: how each project goes. Read-only deliverables with their amount and payment state; an invoice or
 // checkout already sent can be paid from here (the same link the client received).
 cloud.loadClientPlans=async function(){
  const epoch=this.epoch;
  try{const value=await this.request('/api/v1/portal/account/plans');if(epoch!==this.epoch)return;if(!Array.isArray(value))throw Error('Invalid plans');this.clientPlans=value;this.clientPlansFailed=false;}
  catch{if(epoch!==this.epoch)return;this.clientPlans=null;this.clientPlansFailed=true;}
  // The client's refund requests: a stage they already asked about shows the request instead of the button.
  try{const requests=await this.request('/api/v1/portal/account/refund-requests');if(epoch!==this.epoch)return;this.clientRefundRequests=Array.isArray(requests)?requests:null;}
  catch{if(epoch!==this.epoch)return;this.clientRefundRequests=null;}
  this.notify();
 };
 // Like the freelancer's side: back on the tab, the client's space quietly reloads, so a refund or payment made meanwhile
 // shows without pressing F5. Never while a form is open, so nothing the client is typing is lost.
 let clientHidden=cloud.document?.visibilityState==='hidden';
 cloud.document?.addEventListener?.('visibilitychange',()=>{
  if(cloud.document.visibilityState==='hidden'){clientHidden=true;return;}
  if(!clientHidden)return;clientHidden=false;
  if(cloud.role!=='client'||cloud.modal?.open)return;
  if(cloud.agreementHost?.isConnected&&cloud.agreementView?.reload)void cloud.agreementView.reload();
  void cloud.loadClientAgreements?.().then(()=>cloud.notify(),()=>{});
 });
 // Client: what needs their answer in a deliverable — review its delivery, or pay what was already sent.
 const stageNeedsReview=item=>item.delivery_document_id&&!item.review_decision&&item.payment_status!=='completed';
 const stagePending=item=>stageNeedsReview(item)||!!item.pay_url&&item.payment_status!=='completed';
 const badge=count=>count?` <span class="cloud-client-count" aria-label="${uiText('clientPlan.pendingCount',{count})}">(${count})</span>`:'';
 // The client's latest refund request on a stage that is not yet settled: open, or registered with a refund still in progress.
 const stageRefundRequest=item=>[...(cloud.clientRefundRequests||[])].reverse().find(r=>r.project_id===item.project_id&&r.stage_position===item.position&&refundRequestActive(r));
 // Declined or withdrawn: that payment is not asked again; the client goes on with Report a problem.
 const stageRefundClosed=item=>[...(cloud.clientRefundRequests||[])].reverse().find(r=>r.project_id===item.project_id&&r.stage_position===item.position&&refundRequestClosed(r));
 const addendumRefundClosed=item=>[...(cloud.clientRefundRequests||[])].reverse().find(r=>r.project_id===item.project_id&&r.proposal_id===item.proposal_id&&refundRequestClosed(r));
 const refundLeft=item=>item.payment_status==='completed'&&item.paid_minor?item.paid_minor-(item.refunded_minor||0):0;
 // Addenda: the same request, on a paid addendum of the client's agreements (refunded_minor comes from PayPal-verified refunds).
 const addendumRefundLeft=item=>item.payment_status==='completed'&&item.additional_minor>0?item.additional_minor-Math.min(item.additional_minor,item.refunded_minor||0):0;
 const unsettled=refundRequestActive;
 const usd=minor=>new Intl.NumberFormat(uiLocale(),{style:'currency',currency:'USD'}).format(minor/100);
 function refundForm(project,target,left,back){
  cloud.show(uiText('clientPlan.refundTitle'),`<form data-client-refund-request data-project="${esc(project)}" ${target} data-left="${left}"><p>${uiText('clientPlan.refundCopy')}</p><label class="field">${uiText('clientPlan.refundAmount')}<input class="context-box" name="amount" inputmode="decimal" required pattern="[0-9]+([.,][0-9]{1,2})?" value="${(left/100).toFixed(2)}"><small class="field-help">${uiText('clientPlan.refundAmountHelp',{amount:usd(left)})}</small></label><label class="field">${uiText('clientPlan.refundReason')}<textarea class="context-box" name="reason" required maxlength="4000"></textarea></label><p class="cloud-error" role="alert" data-client-plan-error></p><div class="dialog-actions">${back}<button type="submit" class="button">${uiText('clientPlan.refundConfirm')}</button></div></form>`);
 }
 // Inside the addendum card (portal-view paidActions): the Request a refund button, or the state of the request already sent.
 cloud.agreementRefundParts=function(proposalId){
  const item=(cloud.clientAgreements||[]).find(a=>a.proposal_id===proposalId);if(!item)return {};
  const request=[...(cloud.clientRefundRequests||[])].reverse().find(r=>r.project_id===item.project_id&&r.proposal_id===proposalId&&unsettled(r));
  // One open path per payment: while the refund request is open or on its way, Report a problem is not offered beside it.
  if(request)return {notice:refundRequestNotice(request,{portal:true}),hideReport:true};
  // Only a request the freelancer declined closes this path; after withdrawing their own, the client can ask again.
  const closed=addendumRefundClosed(item);if(closed?.status==='declined')return {notice:refundRequestNotice(closed,{portal:true})};
  // One open path per payment: with a problem reported and open, the refund is talked about there.
  if(cloud.clientProblems?.[proposalId]?.status==='open')return {};
  // Same with a PayPal dispute still open on it: PayPal decides that money, so no refund is asked beside it.
  const dispute=cloud.clientDisputes?.[proposalId];
  if(dispute&&dispute.status!=='RESOLVED')return {};
  return addendumRefundLeft(item)>0?{button:`<button type="button" class="portal-button secondary" data-client-plan="refund-addendum" data-proposal="${esc(proposalId)}" aria-haspopup="dialog">${icon('undo-2')}${uiText('clientPlan.refundAction')}</button>`}:{};
 };
 // An addendum whose refund the client asked for reads like a stage does: «Refund requested», then «Refund in progress».
 const addendumRefundRequest=item=>item?.payment_status==='completed'?[...(cloud.clientRefundRequests||[])].reverse().find(r=>r.project_id===item.project_id&&r.proposal_id===item.proposal_id&&unsettled(r)):null;
 const agreementState=cloud.clientAgreementState?.bind(cloud);
 if(agreementState)cloud.clientAgreementState=function(item){
  const request=addendumRefundRequest(item);
  return request?['paid',request.status==='open'?'clientPlan.refundRequested':'clientPlan.refundInProgress']:agreementState(item);
 };
 const REFUNDED_PROBLEM={
  'clientAccount.state.partiallyRefunded':{'clientAccount.state.problemOpen':'clientAccount.state.partialProblemOpen','clientAccount.state.problemToClose':'clientAccount.state.partialProblemToClose','clientAccount.state.problemResolved':'clientAccount.state.partialProblemResolved','clientAccount.state.problemUnresolved':'clientAccount.state.partialProblemUnresolved'},
  'clientAccount.state.refunded':{'clientAccount.state.problemOpen':'clientAccount.state.refundedProblemOpen','clientAccount.state.problemToClose':'clientAccount.state.refundedProblemToClose','clientAccount.state.problemResolved':'clientAccount.state.refundedProblemResolved','clientAccount.state.problemUnresolved':'clientAccount.state.refundedProblemUnresolved'}};
 function clientStageState(item){
  const invoice=item.payment_method==='invoice'&&item.pay_url,done=item.payment_status==='completed';
  // A refund PayPal confirmed on the stage payment, as the addenda show it (clientAgreementState).
  const refunded=done&&item.refunded_minor>0?(item.paid_minor&&item.refunded_minor<item.paid_minor?'clientAccount.state.partiallyRefunded':'clientAccount.state.refunded'):'';
  const request=done?stageRefundRequest(item):null;
  // A problem the client reported on this paid deliverable (stage-problems.mjs), named like on an addendum.
  const problem=done?cloud.clientProblems?.[`stage:${item.project_id}:${item.position}`]:null;
  const reported=problem?(problem.status==='open'&&problem.request_paid?['pay','clientAccount.state.problemToClose']:{open:['dispute','clientAccount.state.problemOpen'],unresolved:['dispute','clientAccount.state.problemUnresolved'],resolved:['paid','clientAccount.state.problemResolved']}[problem.status]):null;
  // A refund already confirmed stays in the label when the client also reported a problem.
  const refundedReport=refunded&&reported?[reported[0],REFUNDED_PROBLEM[refunded]?.[reported[1]]||reported[1]]:null;
  return request?['waiting',request.status==='open'?'clientPlan.refundRequested':'clientPlan.refundInProgress']:refundedReport?refundedReport:reported?reported:refunded?['paid',refunded]:done?['paid','clientPlan.paid']:stageNeedsReview(item)?['open','clientPlan.reviewDelivery']:item.review_decision==='changes_requested'?['waiting','clientAccount.state.changesRequested']:invoice?['pay','clientAccount.state.invoiceToPay']:item.pay_url?['pay','clientAccount.state.toPay']:item.review_decision==='approved'?['done','clientPlan.approved']:['open','clientPlan.upcoming'];
 }
 // The client's overview counts deliverables with the same states and rows as the work plan (connected-workspace.mjs).
 cloud.clientStageState=item=>clientStageState(item);
 cloud.clientStageRow=(item,options)=>clientStageRow(item,options);
 // The list stays short: one row per deliverable; its delivery, decision and payment open in their own view.
 function clientStageRow(item,{withProject=false}={}){
  const [kind,label]=clientStageState(item);
  return `<li><button type="button" class="cloud-client-agreement-row" data-client-plan="stage" data-project="${esc(item.project_id)}" data-position="${item.position}"><span class="cloud-client-agreement-text"><strong>${t('deliverable',{number:item.position})} · ${esc(item.title)}</strong><small>${withProject?`${esc(item.project_name)} · `:''}${money(item.amount)}</small></span><span class="cloud-client-agreement-state ${kind}">${uiText(label)}</span>${icon('arrow-right')}</button></li>`;
 }
 // Pay a deliverable without leaving the window: PayPal's own buttons for the order already sent to the client.
 // The checkout token is the one in the client's own payment link; the server captures and verifies as on that page.
 async function stageButtons(item){
  const host=cloud.modal.querySelector('[data-stage-paypal]');if(!host||item.payment_method==='invoice')return;
  // The link waits hidden while PayPal's buttons load in their fixed box; it appears only if they cannot load.
  const showLink=()=>{const link=cloud.modal.querySelector('[data-stage-pay-link]');if(link)link.hidden=false;host.classList.remove('is-loading');};
  host.classList.add('is-loading');
  let token='';try{token=new URL(item.pay_url,cloud.location.origin).searchParams.get('checkout')||'';}catch{}
  if(!/^[A-Za-z0-9_-]{43}$/.test(token)){showLink();return;}
  const base=`/api/v1/initial-checkout/${encodeURIComponent(token)}`;
  const shown=await mountPayPalButtons({doc,host,
   order:async()=>{const response=await fetch(base,{cache:'no-store'});const result=await response.json();if(!response.ok)throw new Error('PAYMENT_NOT_READY');return result.data?.order_id||null;},
   approved:async()=>{
    const response=await fetch(base+'/capture',{method:'POST',cache:'no-store'});
    if(!response.ok){host.insertAdjacentHTML('afterend',`<p class="cloud-error" role="alert">${uiText('portal.payError')}</p>`);return;}
    await cloud.loadClientPlans?.();const fresh=(cloud.clientPlans||[]).find(stage=>stage.project_id===item.project_id&&stage.position===item.position);
    if(fresh&&cloud.modal.open){cloud.show(t('deliverable',{number:fresh.position}),clientStageView(fresh));}cloud.notify();
   },
   failed:()=>host.insertAdjacentHTML('afterend',`<p class="cloud-error" role="alert">${uiText('portal.payError')}</p>`)});
  host.classList.remove('is-loading');if(!shown)showLink();
 }
 function clientStageView(item){
  const [kind,label]=clientStageState(item),invoice=item.payment_method==='invoice'&&item.pay_url,done=item.payment_status==='completed';
  const data=`data-project="${esc(item.project_id)}" data-position="${item.position}" data-document="${esc(item.delivery_document_id||'')}"`;
  const delivery=item.delivery_document_id?`<article class="plan-evidence-file"><span>${icon('file-text')}${esc(item.delivery_title||uiText('clientPlan.viewDelivery'))}</span><button type="button" class="text-button" data-client-plan="delivery" ${data}>${uiText('clientPlan.viewDelivery')}${icon('arrow-up-right')}</button></article>`:`<p class="plan-evidence-help">${uiText('clientPlan.noDelivery')}</p>`;
  const note=item.review_decision==='changes_requested'&&item.review_notes?`<div class="cloud-notice" role="status"><strong>${uiText('clientPlan.yourRequest')}</strong><p>${esc(item.review_notes)}</p></div>`:'';
  // Asking for changes here fixes what was agreed for this deliverable; new work is a change to the agreement.
  const review=stageNeedsReview(item)?`<p class="plan-evidence-help">${uiText('clientPlan.scopeHint')}</p><footer class="dialog-actions"><button type="button" class="button secondary" data-client-plan="changes" ${data}>${uiText('clientPlan.requestChanges')}</button><button type="button" class="button" data-client-plan="approve" ${data}>${icon('check')}${uiText('clientPlan.approve')}</button></footer>`:'';
  const pay=!done&&item.pay_url?`<footer class="dialog-actions">${invoice?'':`<div class="client-stage-paypal" data-stage-paypal data-project="${esc(item.project_id)}" data-position="${item.position}"></div>`}<a class="button" data-stage-pay-link href="${esc(item.pay_url)}" target="_blank" rel="noopener" ${invoice?'':'hidden'}>${icon(invoice?'file-text':'wallet')}${uiText(invoice?'portal.invoiceAction':'portal.payAction')}${icon('arrow-up-right')}</a></footer>`:'';
  // Paid: the client can ask for money back. It is a request the freelancer reviews in Refunds; only PayPal confirms a refund.
  const request=done?stageRefundRequest(item):null,cents=minor=>new Intl.NumberFormat(uiLocale(),{style:'currency',currency:'USD'}).format(minor/100);
  // Only a request the freelancer declined closes this path; after withdrawing their own, the client can ask again.
  const closedRequest=done&&!request?stageRefundClosed(item):null,declined=closedRequest?.status==='declined'?closedRequest:null;void cents;
  const refund=request||declined?refundRequestNotice(request||declined)
   :refundLeft(item)>0&&cloud.clientProblems?.[`stage:${item.project_id}:${item.position}`]?.status!=='open'?`<footer class="dialog-actions"><button type="button" class="button secondary" data-client-plan="refund" ${data}>${icon('undo-2')}${uiText('clientPlan.refundAction')}</button></footer>`:'';
  return `<section class="plan-delivery-payment"><header><div><span class="eyebrow">${t('deliverable',{number:item.position})}</span><h3>${esc(item.title)}</h3></div><strong>${money(item.amount)}</strong></header><p><span class="cloud-client-agreement-state ${kind}">${uiText(label)}</span></p>${item.payment_condition?`<p class="plan-evidence-help">${esc(item.payment_condition)}</p>`:''}${delivery}${note}${review}${pay}${refund}${done&&!(request&&!cloud.clientProblems?.[`stage:${item.project_id}:${item.position}`])?cloud.stageProblemMarkup?.(item)||'':''}</section>`;
 }
 function clientProjects(){
  const projects=new Map();
  const add=(id,name,email)=>{if(!projects.has(id))projects.set(id,{id,name,email,stages:[],items:[]});return projects.get(id);};
  for(const item of cloud.clientAgreements||[])add(item.project_id,item.project_name,item.freelancer_email).items.push(item);
  for(const stage of cloud.clientPlans||[])add(stage.project_id,stage.project_name,stage.freelancer_email).stages.push(stage);
  for(const project of projects.values()){
   project.planPending=project.stages.filter(stagePending).length;
   project.changesPending=project.items.filter(item=>['open','pay'].includes(cloud.clientAgreementState(item)[0])).length;
  }
  return projects;
 }
 const remember=(key,value)=>{try{value?cloud.storage.setItem(key,value):cloud.storage.removeItem(key);}catch{}};
 const recall=key=>{try{return cloud.storage.getItem(key)||'';}catch{return '';}};
 // TeTrato across the client's account: the addendum's assistant, asking the account endpoints. It only answers;
 // what it cites opens in the project's own tab, where the client accepts, pays or approves.
 const assistants=new Map();
 const accountAssistant=(project='',name='')=>{
  if(assistants.has(project))return assistants.get(project);
  const api=(action,body)=>cloud.request(`/api/v1/portal/account/${action}`,cloud.json(project&&action==='assistant'?{...body,project_id:project}:body));
  const assistant=createPortalAssistant({doc,api,intro:project?uiText('clientAssistant.projectIntro',{name}):uiText('clientAssistant.intro'),placeholder:uiText(project?'clientAssistant.projectPlaceholder':'clientAssistant.placeholder'),
   sourceLabel:source=>source.label||'',
   // A cited item opens itself: a deliverable in the same window its row opens, an addendum in its own view.
   onSource:source=>{if(!source.project_id)return;remember('trato:client-project',source.project_id);remember('trato:client-project-tab',source.type==='stage'?'plan':'changes');
    if(source.type==='addendum'&&source.proposal_id&&cloud.rememberClientAgreement){cloud.rememberClientAgreement(source.proposal_id);if(cloud.location.hash!=='#acuerdos')cloud.location.hash='acuerdos';cloud.notify();return;}
    if(cloud.location.hash!=='#acuerdos')cloud.location.hash='acuerdos';cloud.notify();
    const item=source.type==='stage'&&(cloud.clientPlans||[]).find(stage=>stage.project_id===source.project_id&&stage.position===source.position);
    if(item)cloud.show(t('deliverable',{number:item.position}),clientStageView(item));void stageButtons(item);}});
  doc.body.append(assistant.element);assistants.set(project,assistant);
  assistant.element.addEventListener('close',updateFab);
  return assistant;
 };
 // Same corner button as the freelancer's TeTrato (project-assistant.mjs). Inside a project it answers about that project;
 // anywhere else in the account, about all of them. An addendum keeps its own Ask TeTrato, so the button hides there.
 const fab=doc.body?doc.createElement('button'):null;
 if(fab){fab.type='button';fab.className='tetrato-fab';fab.hidden=true;fab.setAttribute('aria-haspopup','dialog');
  fab.innerHTML='<img src="/assets/mascot/trato-guide.png" alt="" width="40" height="40"><span>TeTrato</span>';doc.body.append(fab);}
 const assistantScope=()=>{const id=cloud.location.hash==='#acuerdos'?recall('trato:client-project'):'';const project=id?clientProjects().get(id):null;return project?{id,name:project.name}:{id:'',name:''};};
 function updateFab(){
  if(!fab)return;
  const anyOpen=[...assistants.values()].some(item=>item.element.open);
  fab.hidden=!(cloud.active&&cloud.role==='client'&&!cloud.clientProposal&&!['#ensayos','#reputacion'].includes(cloud.location.hash)&&!anyOpen);
  const label=uiText(assistantScope().id?'clientAssistant.projectOpen':'clientAssistant.open');fab.setAttribute('aria-label',label);fab.title=label;
  const launcher=doc.querySelector?.('.guide-launcher'),width=launcher&&!launcher.hidden?launcher.getBoundingClientRect?.().width:0;
  fab.style.right=width?`${Math.round(28+width+12)}px`:'';
  doc.documentElement?.style?.setProperty?.('--tetrato-fab-right',fab.style.right||'28px');
 }
 fab?.addEventListener('click',()=>{const {id,name}=assistantScope();accountAssistant(id,name).open();updateFab();});
 // A prepared question for the client's TeTrato (e.g. whether their refund request fits the policies); the client sends it.
 cloud.askClientTeTrato=question=>{const {id,name}=assistantScope();accountAssistant(id,name).open(question);updateFab();};
 const syncChrome=cloud.syncChrome?.bind(cloud);
 cloud.syncChrome=function(){syncChrome?.();updateFab();};
 doc.defaultView?.addEventListener?.('hashchange',updateFab);
 for(const [method,flag] of [['loadClientDisputes','clientDisputesSettled'],['loadClientProblems','clientProblemsSettled']]){
  const original=cloud[method]?.bind(cloud);if(!original)continue;
  // Only the first answer is waited for (reset() clears the flag for another account). A quiet reload, such as coming
  // back to the tab, keeps the view on screen while PayPal answers, which can take half a minute.
  cloud[method]=async function(){try{return await original();}finally{this[flag]=true;this.notify();}};
 }
 cloud.renderClientProjects=function(workspace){
  // Plans arrive after the agreements: wait for them so a project never opens on the wrong tab and then reorders.
  // Meetings too: the Meetings tab must not appear after the tabs are painted.
  if((this.clientPlans===undefined&&!this.clientPlansFailed)||this.clientMeetings===undefined){workspace.innerHTML=`<section class="workspace-panel cloud-initial-loading">${this.renderSkeleton('list',uiText('clientPlan.loading'))}</section>`;return;}
  const projects=clientProjects();
  if(!projects.size){workspace.innerHTML=`<section class="workspace-panel cloud-home-intro"><img src="/assets/mascot/trato-guide.png" alt="" width="120" height="120"><div><h2>${uiText('clientAccount.emptyTitle')}</h2><p>${uiText('clientAccount.emptyCopy')}</p></div></section>`;return;}
  const open=projects.get(recall('trato:client-project'));
  if(!open){
   // One card per freelancer, with the projects the client has with them: how each goes and what waits for the client.
   const byFreelancer=new Map();for(const project of projects.values()){if(!byFreelancer.has(project.email))byFreelancer.set(project.email,[]);byFreelancer.get(project.email).push(project);}
   const row=project=>{const paid=project.stages.filter(s=>s.payment_status==='completed').length,total=project.stages.length;
    const progress=total?`<small>${uiText('clientPlan.progress',{paid,total})}</small><span class="cloud-client-progress" aria-hidden="true"><span style="width:${Math.round(100*paid/total)}%"></span></span>`:'';
    return `<li><button type="button" class="cloud-client-agreement-row" data-client-plan="open" data-project="${esc(project.id)}"><span class="cloud-client-agreement-text"><strong>${esc(project.name)}${badge(project.planPending)}</strong>${progress}</span>${icon('arrow-right')}</button></li>`;};
   // Same identity block as the freelancer's client directory: initials, who it is and how many projects.
   const header=(email,list)=>`<header class="cloud-directory-identity"><span class="cloud-directory-avatar" aria-hidden="true">${esc((email||'').slice(0,2).toUpperCase())}</span><div><span class="eyebrow">${uiText('clientAccount.freelancer')}</span><strong>${esc(email)}</strong><small class="cloud-directory-count">${list.length===1?uiText('clientAccount.oneProject'):uiText('clientAccount.projectCount',{count:list.length})}</small></div></header>`;
   workspace.innerHTML=`<div class="cloud-client-projects">${[...byFreelancer].map(([email,list])=>`<section class="workspace-panel cloud-client-freelancer cloud-client-agreements">${header(email,list)}<ul>${list.map(row).join('')}</ul></section>`).join('')}</div>`;return;
  }
  const dispute=item=>this.clientDisputes?.[item.proposal_id],problem=item=>item.payment_status==='completed'?this.clientProblems?.[item.proposal_id]:null;
  const disputed=open.items.filter(dispute),reported=open.items.filter(problem);
  // Refunds the client asked for in this project, newest first, as the same rows the plan and the changes show.
  const asked=(this.clientRefundRequests||[]).filter(r=>r.project_id===open.id).sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')));
  const seen=new Set(),refundRows=asked.map(r=>{
   const id=r.stage_position?`s${r.stage_position}`:`a${r.proposal_id}`;if(seen.has(id))return '';seen.add(id);
   const stage=r.stage_position?open.stages.find(s=>s.position===r.stage_position):null,item=r.proposal_id?open.items.find(i=>i.proposal_id===r.proposal_id):null;
   return stage?clientStageRow(stage):item?this.clientAgreementRow(item,{withProject:false}):'';
  }).join('');
  // Tabs stay put while each one loads its own data: a paid addendum is what can carry a dispute or a reported problem.
  // Upcoming Google Meet calls the freelancer scheduled for this project (see project-meetings.mjs).
  const meetings=(this.clientMeetings||[]).filter(m=>m.project_id===open.id);
  const saved=recall('trato:client-project-tab'),available={plan:true,changes:true,issues:true,meetings:true};
  const tab=available[saved]?saved:open.stages.length?'plan':open.items.length?'changes':'plan';
  const paid=open.stages.filter(s=>s.payment_status==='completed').length;
  const tabs=[['plan','wallet','clientPlan.title',open.planPending,available.plan],['changes','git-compare-arrows','clientPlan.changes',0,available.changes],['issues','shield-check','clientPlan.issues',0,available.issues],['meetings','users','meetings.clientTab',meetings.length,available.meetings]].filter(([, , , ,shown])=>shown);
  const nav=`<nav class="cloud-project-navigation" aria-label="${uiText('Secciones del proyecto')}">${tabs.map(([id,glyph,title,count])=>`<button type="button" data-client-plan="tab" data-tab="${id}" ${tab===id?'aria-current="page"':''}>${icon(glyph)}<span><strong>${uiText(title)}${badge(count)}</strong><small>${uiText(id==='plan'?'clientPlan.planHint':id==='changes'?'clientPlan.changesHint':id==='meetings'?'meetings.clientTabHint':'clientPlan.issuesHint')}</small></span></button>`).join('')}</nav>`;
  const when=m=>{const d=new Date(m.starts_at);return Number.isFinite(d.getTime())?new Intl.DateTimeFormat(uiLocale(),{dateStyle:'medium',timeStyle:'short'}).format(d):'';};
  const meetingsPanel=`<section class="workspace-panel cloud-client-plan"><h3>${uiText('meetings.clientTab')}</h3>${meetings.length?`<ul class="cloud-client-agreements-list">${meetings.map(m=>`<li><div class="cloud-client-agreement-row"><span class="cloud-client-agreement-text"><strong>${esc(m.title)}</strong><small>${esc(when(m))}</small></span><a class="button" href="${esc(m.meet_url)}" target="_blank" rel="noopener noreferrer">${icon('arrow-up-right')}${uiText('meetings.clientJoin')}</a></div></li>`).join('')}</ul>`:`<p class="cloud-client-empty">${uiText('meetings.clientEmpty')}</p>`}</section>`;
  const plan=this.clientPlansFailed?`<p class="cloud-error" role="alert">${uiText('clientPlan.error')}</p>`:`<section class="workspace-panel cloud-client-plan"><h3>${uiText('clientPlan.title')}${open.stages.length?' · '+uiText('clientPlan.progress',{paid,total:open.stages.length}):''}</h3>${open.stages.length?`<ul class="cloud-client-agreements-list">${open.stages.map(clientStageRow).join('')}</ul>`:`<p class="cloud-client-empty">${uiText('clientPlan.noPlan')}</p>`}</section>`;
  // Addenda grouped by what they mean for the client: what waits for them, what has an open issue, what is closed.
  const rows=items=>`<ul class="cloud-client-agreements-list">${items.map(item=>this.clientAgreementRow(item,{withProject:false})).join('')}</ul>`;
  const blocks=list=>list.filter(([,items])=>items.length).map(([title,items])=>`<h4>${uiText(title)}</h4>${rows(items)}`).join('');
  const waiting=item=>['open','pay','waiting'].includes(this.clientAgreementState(item)[0]);
  const changes=`<section class="workspace-panel cloud-client-plan"><h3>${uiText('clientPlan.changes')}</h3>${open.items.length?'':`<p class="cloud-client-empty">${uiText('clientPlan.noChanges')}</p>`}${blocks([['clientPlan.groupPending',open.items.filter(waiting)],['clientPlan.groupClosed',open.items.filter(item=>!waiting(item)&&!dispute(item)&&!problem(item))]])}</section>`;
  // Same split as the freelancer's Disputes tab: claims opened in PayPal, and problems reported in Trato.
  const issues=`<section class="workspace-panel cloud-client-plan"><h3>${uiText('clientPlan.issues')}</h3>${blocks([['clientPlan.paypalDisputes',disputed],['clientPlan.problemsReported',reported]])}${refundRows?`<h4>${uiText('clientPlan.refunds')}</h4><ul class="cloud-client-agreements-list">${refundRows}</ul>`:''}${!disputed.length&&!reported.length&&!refundRows?`<p class="cloud-client-empty">${uiText('clientPlan.noIssues')}</p>`:''}</section>`;
  workspace.innerHTML=`<div class="cloud-breadcrumb"><button class="text-button" data-client-plan="back">${uiText('portal.backToProjects')}</button></div><div class="client-banner"><span class="client-avatar">${esc((open.email||'').slice(0,2).toUpperCase())}</span><div><span class="eyebrow">${uiText('clientAccount.freelancer')}: ${esc(open.email)}</span><h2>${esc(open.name)}</h2></div></div>${nav}${tab==='plan'?(this.clientProblemsSettled?plan:`<section class="workspace-panel cloud-initial-loading">${this.renderSkeleton('list',uiText('clientPlan.loading'))}</section>`):tab==='meetings'?meetingsPanel:!this.clientDisputesSettled||!this.clientProblemsSettled?`<section class="workspace-panel cloud-initial-loading">${this.renderSkeleton('list',uiText('clientPlan.loading'))}</section>`:tab==='changes'?changes:issues}`;
 };
 async function showDelivery(project,position){
  const blob=await cloud.request(`/api/v1/portal/account/projects/${encodeURIComponent(project)}/stages/${position}/delivery`,{},true);
  if(blob.type.split(';')[0]!=='application/pdf')throw Error(uiText('clientPlan.deliveryError'));
  // Back to the deliverable, where the client approves it or asks for changes after reading it.
  cloud.show(uiText('clientPlan.viewDelivery'),`<div class="cloud-preview-toolbar"><button type="button" class="text-button" data-client-plan="stage" data-project="${esc(project)}" data-position="${position}">← ${t('deliverable',{number:position})}</button></div><iframe class="cloud-pdf-frame" title="${uiText('clientPlan.viewDelivery')}"></iframe>`);
  cloud.modal.classList.add('cloud-document-preview');cloud.releasePreview?.();cloud.previewUrl=URL.createObjectURL(blob);
  cloud.modal.querySelector('iframe').src=cloud.previewUrl+'#view=FitH';
 }
 doc.addEventListener('click',async event=>{
  const button=event.target.closest('[data-client-plan]');if(!button||cloud.role!=='client')return;
  const action=button.dataset.clientPlan,project=button.dataset.project,position=Number(button.dataset.position);
  if(action==='open'){remember('trato:client-project',project);remember('trato:client-project-tab','');cloud.notify();return;}
  if(action==='back'){remember('trato:client-project','');cloud.notify();return;}
  if(action==='tab'){remember('trato:client-project-tab',button.dataset.tab);if(button.dataset.tab==='meetings')void cloud.refreshClientMeetings?.();cloud.notify();return;}
  if(action==='stage'){
   const item=(cloud.clientPlans||[]).find(stage=>stage.project_id===project&&stage.position===position);if(!item)return;
   cloud.show(t('deliverable',{number:position}),clientStageView(item));void stageButtons(item);return;
  }
  if(action==='delivery'){try{await showDelivery(project,position);}catch(error){cloud.show(uiText('clientPlan.viewDelivery'),`<p class="cloud-error" role="alert">${esc(error.message)}</p>`);}return;}
  if(action==='refund'){
   const item=(cloud.clientPlans||[]).find(stage=>stage.project_id===project&&stage.position===position),left=item?refundLeft(item):0;if(!left)return;
   refundForm(project,`data-position="${position}"`,left,`<button type="button" class="button secondary" data-client-plan="stage" data-project="${esc(project)}" data-position="${position}">${uiText('Volver')}</button>`);
   return;
  }
  if(action==='refund-addendum'){
   const item=(cloud.clientAgreements||[]).find(a=>a.proposal_id===button.dataset.proposal),left=item?addendumRefundLeft(item):0;if(!left)return;
   refundForm(item.project_id,`data-proposal="${esc(item.proposal_id)}"`,left,`<button type="button" class="button secondary" data-cloud-close>${uiText('Volver')}</button>`);
   return;
  }
  if(action==='approve'||action==='changes'){
   // Same decision as an addendum: approve what was delivered, or say what to change. Recorded once per delivery.
   const approve=action==='approve';
   cloud.show(uiText(approve?'clientPlan.approveTitle':'clientPlan.changesTitle'),`<form data-client-plan-review data-project="${esc(project)}" data-position="${position}" data-document="${esc(button.dataset.document)}" data-decision="${approve?'approved':'changes_requested'}"><p>${uiText(approve?'clientPlan.approveCopy':'clientPlan.changesCopy')}</p>${approve?'':`<label class="field">${uiText('clientPlan.changesLabel')}<textarea class="context-box" name="notes" required maxlength="4000"></textarea></label>`}<p class="cloud-error" role="alert" data-client-plan-error></p><div class="dialog-actions"><button type="button" class="button secondary" data-cloud-close>${uiText('Volver')}</button><button type="submit" class="button">${uiText(approve?'clientPlan.approveConfirm':'clientPlan.changesConfirm')}</button></div></form>`);
  }
 });
 doc.addEventListener('submit',async event=>{
  const request=event.target.closest?.('[data-client-refund-request]');
  if(request){
   event.preventDefault();
   const error=request.querySelector('[data-client-plan-error]'),raw=request.elements.amount.value.trim().replace(',','.'),left=Number(request.dataset.left);
   const minor=/^\d+(\.\d{1,2})?$/.test(raw)?Math.round(Number(raw)*100):0;
   if(!minor||minor>left){error.textContent=uiText('clientPlan.refundAmountInvalid',{amount:new Intl.NumberFormat(uiLocale(),{style:'currency',currency:'USD'}).format(left/100)});return;}
   request.querySelectorAll('button').forEach(b=>b.disabled=true);
   try{
    const target=request.dataset.proposal?{proposal_id:request.dataset.proposal}:{stage_position:Number(request.dataset.position)};
    cloud.clientRefundRequests=await cloud.request(`/api/v1/portal/account/projects/${encodeURIComponent(request.dataset.project)}/refund-requests`,cloud.json({...target,amount_minor:minor,reason:request.elements.reason.value.trim()}));
    const item=request.dataset.proposal?null:(cloud.clientPlans||[]).find(stage=>stage.project_id===request.dataset.project&&stage.position===Number(request.dataset.position));
    if(item){cloud.show(t('deliverable',{number:item.position}),clientStageView(item));void stageButtons(item);}else{cloud.modal.close();cloud.agreementView?.reload?.();}
    cloud.notify();
   }catch(failure){error.textContent=failure.message;request.querySelectorAll('button').forEach(b=>b.disabled=false);}
   return;
  }
  const form=event.target.closest?.('[data-client-plan-review]');if(!form)return;event.preventDefault();
  form.querySelectorAll('button').forEach(b=>b.disabled=true);
  try{
   const notes=form.elements.notes?.value||null;
   cloud.clientPlans=await cloud.request(`/api/v1/portal/account/projects/${encodeURIComponent(form.dataset.project)}/stages/${form.dataset.position}/review`,cloud.json({document_id:form.dataset.document,decision:form.dataset.decision,notes}));
   cloud.modal.close();cloud.notify();
  }catch(error){form.querySelector('[data-client-plan-error]').textContent=error.message;form.querySelectorAll('button').forEach(b=>b.disabled=false);}
 });
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
   // The client's answer to this delivery, from their account: shown to the freelancer next to the deliverable.
   const base=endpoint(state.project,state.position).replace('/checkout','');
   [state.review,state.sent]=await Promise.all([cloud.request(base+'/client-review').catch(()=>state.review||null),cloud.request(base+'/client-delivery').catch(()=>state.sent||null)]);
   if(!valid(state)||run!==state.readGeneration)return;
   state.pay=pay;state.error='';
   if(pay&&!state.checked&&pay.status!=='completed'&&stagePaymentStep(pay)==='await_payment'){
    state.checked=true;
    try{const fresh=await cloud.request(endpoint(state.project,state.position,'/reconcile'),cloud.json({}));if(valid(state)&&run===state.readGeneration)state.pay=fresh;}catch{}
   }
   if(state.pay){paint(state);scheduleStateRead(state);return;}
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
 // TeTrato can collect the deliverable with a PayPal invoice instead of the checkout, while nobody can have paid the order.
 function invoiceActions(pay){
  if(pay.method==='invoice')return pay.invoice_url?`<div class="plan-payment-pending"><a class="button secondary" href="${esc(pay.invoice_url)}" target="_blank" rel="noopener">${icon('file-text')}${uiText('invoice.open')}${icon('arrow-up-right')}</a></div>`:'';
  return ['pending_approval','failed','cancelled'].includes(pay.status)?`<div class="plan-payment-pending"><button class="button secondary" type="button" data-plan-pay="invoice">${icon('sparkles')}${uiText('invoice.send')}</button></div>`:'';
 }
 // The payment email is the usual way to charge; a formal PayPal invoice is TeTrato's follow-up while it stays unpaid.
 function invoiceFollowUp(pay){
  if(pay.method==='invoice'||!['pending_approval','failed','cancelled'].includes(pay.status))return '';
  return `<article class="plan-upload-pending" role="note"><span class="plan-upload-icon" aria-hidden="true">${icon('sparkles')}</span><div><strong>${uiText('invoice.followUpTitle')}</strong><small>${uiText('invoice.followUpCopy')}</small><div class="plan-payment-pending"><button class="text-button" type="button" data-plan-pay="detective">${icon('messages-square')}${uiText('paymentDetective.ask')}</button><button class="button secondary" type="button" data-plan-pay="invoice">${icon('sparkles')}${uiText('invoice.send')}</button></div></div></article>`;
 }
 // A sent invoice: one card with what was sent and when, and the two things to do while it is unpaid.
 function invoiceSent(pay){
  const sent=(pay.events||[]).filter(e=>e.kind==='email_sent').map(e=>e.created_at).sort().pop();
  const when=sent?new Intl.DateTimeFormat(uiLocale(),{dateStyle:'medium',timeStyle:'short'}).format(new Date(sent)):'';
  return `<article class="plan-upload-pending" role="status"><span class="plan-upload-icon" aria-hidden="true">${icon('file-text')}</span><div><strong>${uiText('invoice.sentTitle',{number:pay.invoice_number||''})}</strong><small>${when?esc(when)+' · ':''}${uiText('invoice.waitingPayment')}</small><div class="plan-payment-pending"><button class="text-button" type="button" data-plan-pay="detective">${icon('messages-square')}${uiText('paymentDetective.ask')}</button>${pay.invoice_url?`<a class="button secondary" href="${esc(pay.invoice_url)}" target="_blank" rel="noopener">${uiText('invoice.open')}${icon('arrow-up-right')}</a>`:''}</div></div></article>`;
 }
 function emailSentOn(pay){
  const sent=(pay.events||[]).filter(e=>e.kind==='email_sent').map(e=>e.created_at).sort().pop();
  return sent?uiText('invoice.emailSentOn',{date:new Intl.DateTimeFormat(uiLocale(),{dateStyle:'medium',timeStyle:'short'}).format(new Date(sent))}):t('awaitingClientPayment');
 }
 function paymentActions(pay){
  const step=stagePaymentStep(pay);
  if(step==='paid')return '';
  if(step==='finish_invoice')return `<div class="plan-payment-pending"><button class="button" type="button" data-plan-pay="invoice">${uiText('invoice.retry')}</button></div>`;
  // Until something is sent both ways stay open: the payment email, or a PayPal invoice (also after closing its preview).
  if(step==='send_email')return `<div class="plan-payment-mail-actions"><span class="plan-payment-status">${t('readyToSend')}</span><button class="button" type="button" data-plan-pay="email">${icon('mail')}${pay.method==='invoice'?uiText('invoice.email'):t('reviewEmail')}</button></div>${invoiceActions(pay)}`;
  if(step==='await_payment')return pay.method==='invoice'?invoiceSent(pay):`<p class="plan-payment-status">${esc(emailSentOn(pay))}</p>${invoiceFollowUp(pay)}`;
  if(step==='prepare_order')return `<div class="plan-payment-pending"><span class="plan-payment-status">${t('preparingOrder')}</span><button class="button secondary" type="button" data-plan-pay="verify">${t('checkPreparation')}</button></div>`;
  return `<div class="plan-payment-pending"><span class="plan-payment-status">${t(step==='sending_email'?'sendingEmail':'emailUnconfirmed')}</span><button class="text-button" type="button" data-plan-pay="reload">${t('checkEmailStatus')}</button></div>`;
 }
 // Order of a deliverable: send the delivery, the client reviews it, and only an approved delivery is charged.
 function clientReview(review){
  if(!review)return '';
  const when=new Intl.DateTimeFormat(uiLocale(),{dateStyle:'medium',timeStyle:'short'}).format(new Date(review.created_at));
  if(review.decision==='approved')return `<p class="plan-payment-confirmation">${icon('circle-check')}${uiText('clientPlan.freelancerApproved',{date:when})}</p>`;
  return `<div class="cloud-notice" role="status"><strong>${uiText('clientPlan.freelancerChanges',{date:when})}</strong><p>${esc(review.notes||'')}</p></div>`;
 }
 function paint(state){
  if(!valid(state))return;const pay=state.pay,paid=pay?.status==='completed',sent=state.sent;
  // The client's answer counts only for the delivery that was sent last.
  const review=sent?.shared_at&&state.review?.document_id===sent.document_id?state.review:null;
  const approved=review?.decision==='approved',waiting=!!sent?.shared_at&&!review&&!state.pendingFile;
  const when=value=>new Intl.DateTimeFormat(uiLocale(),{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
  const upload=state.upload?`<article class="plan-upload-pending" role="status" aria-live="polite"><span class="plan-upload-icon ${!['unconfirmed','ready'].includes(state.upload.phase)?'is-loading':''}" aria-hidden="true">${icon(['unconfirmed','ready'].includes(state.upload.phase)?'file-text':'refresh-cw')}</span><div><strong>${esc(state.upload.name)}</strong><small>${state.upload.phase==='ready'?uiText('clientPlan.fileReady'):t(state.upload.phase==='checking'?'checkingFile':state.upload.phase==='uploading'?'uploadingFile':state.upload.phase==='unconfirmed'?'uploadUnconfirmed':'processing')}</small></div></article>`:'';
  const files=state.files.length?`<div class="plan-evidence-list">${state.files.map(d=>`<article class="plan-evidence-file"><span>${icon('file-text')}${esc(d.title)}</span><small>${t(evidenceStatus(state,d))}</small>${!pay&&!sent?.shared_at?`<button type="button" class="text-button plan-evidence-remove" data-plan-pay="remove-evidence" data-plan-remove-id="${esc(d.id)}" aria-label="${t('removeEvidenceNamed',{name:d.title})}">${t('removeEvidence')}</button>`:''}</article>`).join('')}</div>`:'';
  const withdrawals=state.withdrawals.length?`<section class="plan-withdrawal-pending" role="status"><p>${t('cleanupPending')}</p>${state.withdrawals.map(item=>`<button type="button" class="text-button" data-plan-pay="remove-evidence" data-plan-remove-id="${esc(item.file_id)}">${t('retryCleanup')} · ${esc(item.title)}</button>`).join('')}</section>`:'';
  const chooser=`<label class="plan-evidence-upload" tabindex="0" role="button"><span class="plan-evidence-upload-icon" aria-hidden="true">${icon('file-up')}</span><span><strong>${t('uploadEvidence')}</strong><small>${t('pdfLimit')}</small></span><input type="file" accept=".pdf,application/pdf" data-plan-evidence-file hidden></label>`;
  const send=!pay&&state.pendingFile||sent&&!sent.shared_at&&!state.replacing?`<footer class="plan-evidence-next"><span>${uiText(state.pendingFile?'clientPlan.fileReady':'clientPlan.notSent')}</span><button type="button" class="button" data-plan-pay="send-delivery">${icon('send')}${uiText('clientPlan.send')}</button></footer>`:'';
  // Sent the wrong PDF? Until a payment request exists, a new delivery can replace it; the client reviews the new one.
  const replaceLink=!pay?`<p class="plan-replace-delivery"><button type="button" class="text-button" data-plan-pay="replace-delivery">${icon('refresh-cw')}${uiText('clientPlan.replaceDelivery')}</button></p>`:'';
  let body='';
  if(paid)body=`<p class="plan-payment-confirmation">${icon('circle-check')}${t('verifiedPaid')}</p>${clientReview(review)}`;
  else if(approved&&!state.replacing)body=clientReview(review)+(!pay?`${files}<footer class="plan-evidence-next"><span>${t('readyToCharge')}</span><span class="plan-charge-actions"><button type="button" class="button secondary" data-plan-pay="invoice">${icon('sparkles')}${uiText('invoice.send')}</button><button type="button" class="button" data-plan-pay="prepare">${t('preparePayment')}${icon('arrow-right')}</button></span></footer>${replaceLink}`:paymentActions(pay));
  // Same card as an upload in progress: what happened, when, and what comes next.
  else if(waiting&&!state.replacing)body=`${files}<article class="plan-upload-pending" role="status"><span class="plan-upload-icon" aria-hidden="true">${icon('send')}</span><div><strong>${uiText('clientPlan.sentTitle')}</strong><small>${esc(when(sent.shared_at))} · ${uiText('clientPlan.waitingReview')}</small></div></article>${replaceLink}`;
  else body=`${state.replacing?'':clientReview(review)}<p class="plan-evidence-help">${state.replacing?uiText('clientPlan.replaceHelp'):t(pay?'sendPreparedHelp':'uploadHelp')}</p>${pay?'':upload}${files}${withdrawals}${pay?'':chooser}${send}`;
  cloud.modal.querySelector('[data-plan-payment-content]').innerHTML=`<section class="plan-delivery-payment"><header><div><span class="eyebrow">${t('deliverable',{number:state.position})}</span><h3>${esc(state.stage.title)}</h3></div><strong>${money(state.stage.amount)}</strong></header>${body}${state.error?`<div class="plan-payment-error"><p class="cloud-error" role="alert">${esc(state.error)}</p><button type="button" class="text-button" data-plan-pay="reload">${t('retry')}</button></div>`:''}<p role="status" data-plan-pay-notice></p></section>`;
  if(state.busy)cloud.modal.querySelector('[data-plan-payment-content]').querySelectorAll('button,input').forEach(el=>el.disabled=true);
  scheduleStateRead(state);
 }
 doc.addEventListener('keydown',event=>{
  const target=event.target.closest?.('.plan-evidence-upload');
  if(target&&event.target===target&&(event.key==='Enter'||event.key===' ')){
   event.preventDefault();if(modalState&&valid(modalState)&&!modalState.busy)target.querySelector('input')?.click();
  }
 });
 // Choosing the PDF keeps it in the browser; it is uploaded, read by Trato and shown to the client only when sent.
 doc.addEventListener('change',async event=>{
  const input=event.target;if(!input.matches('[data-plan-evidence-file]'))return;const state=modalState;if(!state||!valid(state)||state.busy)return;
  const file=input.files?.[0];if(!file)return;
  state.error='';
  if(!file.name.toLowerCase().endsWith('.pdf')||file.size>10485760||!file.size||(await file.slice(0,5).text())!=='%PDF-'){state.error=t('pdfError');paint(state);return;}
  if(!valid(state))return;
  state.pendingFile=file;state.upload={name:file.name,phase:'ready',id:null};paint(state);
 });
 // The delivery the client approved is the evidence of the charge; before that, a document Trato finished reading.
 function chargeEvidence(state){
  const approved=state.sent?.shared_at&&state.review?.decision==='approved'&&state.review.document_id===state.sent.document_id?state.files.find(file=>file.id===state.review.document_id):null;
  return approved||state.ready[0]||null;
 }
 async function prepareStagePayment(state){
  const evidence=chargeEvidence(state);
  if(!evidence)throw {code:state.files.length?'PLAN_EVIDENCE_NOT_READY':'PLAN_EVIDENCE_REQUIRED'};
  const key=`trato:stage-payment:${state.scope}:${state.position}`;let id=cloud.storage.getItem(key);if(!id){id=crypto.randomUUID();cloud.storage.setItem(key,id);}
  state.pay=await cloud.request(endpoint(state.project,state.position),{...cloud.json({evidence_document_id:evidence.id,output_language:uiLanguage(),confirmed:true}),headers:{'Content-Type':'application/json','Idempotency-Key':id}});
 }
 // The freelancer's click sends it: Trato builds the payment email from the reviewed request and sends it at once.
 async function sendPaymentEmail(state){
  const mail=await cloud.request(endpoint(state.project,state.position,'/email-preview'));if(!valid(state))return;
  state.pay=await cloud.request(endpoint(state.project,state.position,'/email'),cloud.json({digest:mail.digest,confirmed:true}));
 }
 async function uploadEvidence(state,file){
  state.upload={name:file.name,phase:'uploading',id:null};paint(state);
  const identity=JSON.stringify([file.name,file.size,file.lastModified]);if(!state.uploadKeys.has(identity))state.uploadKeys.set(identity,crypto.randomUUID());
  const query=new URLSearchParams({filename:file.name,title:t('evidenceTitle',{number:state.position}),kind:'delivery',purpose:'delivery_evidence',stage_position:state.position});
  const uploaded=await cloud.request(`/api/v1/projects/${state.project}/documents?${query}`,{method:'POST',body:file,headers:{'Content-Type':'application/pdf','Accept-Language':uiLanguage(),'Idempotency-Key':state.uploadKeys.get(identity)}});
  state.pendingFile=null;state.upload={name:file.name,phase:'processing',id:uploaded.document?.id};
 }
 doc.addEventListener('click',async event=>{
  const button=event.target.closest('[data-plan-pay]'),state=modalState;if(!button||!state||!valid(state)||state.busy)return;
  if(button.dataset.planPay==='detective'){cloud.openPaymentDetective?.(button,uiText('paymentDetective.focus'));return;}
  const action=button.dataset.planPay;state.readGeneration++;state.busy=true;state.error='';paint(state);
  try{
   if(action==='remove-evidence'){
    const fileId=button.dataset.planRemoveId;
    await cloud.request(`/api/v1/projects/${state.project}/stages/${state.position}/evidence/${encodeURIComponent(fileId)}`,{method:'DELETE'});
    if(valid(state)){state.uploadKeys.clear();await load(state);}
    return;
   }
   if(action==='replace-delivery'){state.replacing=true;state.pendingFile=null;state.upload=null;return;}
   if(action==='background'){clearTimeout(timer);cloud.modal.close();return;}
   if(action==='reload'){state.view='payment';await load(state);return;}
   if(action==='prepare'){
    await prepareStagePayment(state);
    // One click: the payment request is prepared and emailed to the client in the same step.
    if(valid(state)&&state.pay&&stagePaymentStep(state.pay)==='send_email')await sendPaymentEmail(state);
   }
   if(action==='verify'){state.pay=await cloud.request(endpoint(state.project,state.position,'/reconcile'),cloud.json({}));}
   if(action==='send-delivery'){
    if(state.pendingFile&&!state.pay){try{await uploadEvidence(state,state.pendingFile);}catch(error){if(state.upload)state.upload.phase='unconfirmed';throw error;}}
    if(!valid(state))return;
    state.sent=await cloud.request(endpoint(state.project,state.position).replace('/checkout','/client-delivery'),cloud.json({}));state.review=null;state.replacing=false;
    await load(state);
   }
   if(action==='invoice'){
    // Straight from an approved delivery: the payment request is prepared first, then collected with the invoice.
    if(!state.pay){await prepareStagePayment(state);if(!valid(state)||!state.pay)return;}
    // The freelancer confirms what TeTrato will send: amount and recipient come from the plan and the client.
    clearTimeout(timer);state.view='invoice';
    cloud.modal.querySelector('[data-plan-payment-content]').innerHTML=`<form data-plan-stage-invoice class="plan-mail-form"><header class="plan-mail-heading"><span class="plan-mail-heading-icon" aria-hidden="true">${icon('sparkles')}</span><div><h3>${uiText('invoice.title')}</h3><p>${uiText('invoice.intro')}</p></div></header><dl class="proposal-summary-terms"><div><dt>${uiText('invoice.stageAmount')}</dt><dd>${esc(money(state.stage.amount))}</dd></div></dl><label class="field">${uiText('invoice.concept')}<input class="context-box" name="concept" required maxlength="200"></label><div data-invoice-concept-status></div><p class="field-help">${uiText('invoice.stageOneWay')}</p><footer class="dialog-actions"><button type="button" class="button secondary" data-plan-pay="reload">${uiText('Volver')}</button><button type="submit" class="button">${icon('send')}${uiText('invoice.confirm')}</button></footer><div data-invoice-sending></div><p class="cloud-error" role="alert" data-plan-invoice-error></p></form>`;
    fillInvoiceConcept(cloud,cloud.modal.querySelector('[data-plan-stage-invoice]'),{target:'stage',project_id:state.project,position:state.position});return;
   }
   if(action==='email')await sendPaymentEmail(state);
  }catch(error){if(valid(state))state.error=error?.code==='PLAN_EVIDENCE_NOT_READY'&&state.files.some(file=>evidenceStatus(state,file)==='reviewEvidence')?t('evidenceNeedsReview'):message(error);}finally{state.busy=false;if(valid(state)&&(action!=='invoice'||state.error)){paint(state);}}
 });
 doc.addEventListener('submit',async event=>{
  if(!event.target.matches('[data-plan-stage-invoice]'))return;event.preventDefault();const state=modalState;if(!state||!valid(state)||state.busy)return;
  const form=event.target,concept=new FormData(form).get('concept');state.busy=true;form.querySelectorAll('button,input,textarea').forEach(b=>b.disabled=true);
  form.querySelector('[data-invoice-sending]').innerHTML=`<div style="margin-top:20px">${renderAIActivity({label:uiText('invoice.sending'),compact:true})}</div>`;
  try{
   state.pay=await cloud.request(endpoint(state.project,state.position,'/invoice'),cloud.json({concept,confirmed:true}));
   if(!valid(state))return;
   // PayPal Sandbox does not email real inboxes: Trato's own payment email carries the invoice link, sent in the same step.
   try{const mail=await cloud.request(endpoint(state.project,state.position,'/email-preview'));state.pay=await cloud.request(endpoint(state.project,state.position,'/email'),cloud.json({digest:mail.digest,confirmed:true}));}
   catch{state.error=uiText('invoice.emailFailed');}
   if(!valid(state))return;state.view='payment';await load(state);
  }catch(error){if(valid(state)&&form.isConnected){form.querySelector('[data-invoice-sending]').innerHTML='';form.querySelector('[data-plan-invoice-error]').textContent=error.code?message(error):error.message;}}
  finally{state.busy=false;if(form.isConnected)form.querySelectorAll('button,input,textarea').forEach(b=>b.disabled=false);}
 });
 doc.addEventListener('submit',async event=>{
  if(!event.target.matches('[data-plan-stage-email]'))return;event.preventDefault();const state=modalState;if(!state||!valid(state)||state.busy)return;
  const form=event.target;state.busy=true;form.querySelectorAll('button').forEach(b=>b.disabled=true);
  try{state.pay=await cloud.request(endpoint(state.project,state.position,'/email'),cloud.json({digest:state.email.digest,confirmed:true}));if(valid(state)){state.busy=false;state.view='payment';paint(state);}}
  catch(error){if(valid(state)&&form.isConnected)form.querySelector('[data-plan-mail-error]').textContent=message(error);}
  finally{state.busy=false;if(form.isConnected)form.querySelectorAll('button').forEach(b=>b.disabled=false);}
 });
}
