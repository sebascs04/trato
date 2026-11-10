// Addendum view shared by the emailed-link page (portal.html) and the client account inside Trato.
// The caller provides `api(action, body, {binary})`; this module only renders and calls actions.
import {uiText,uiLocale} from './i18n.mjs';
import {icon} from './icons.mjs';
import {createPortalAssistant} from './portal-assistant.mjs';
import {PROBLEM_REASONS,PAYPAL_RESOLUTION_CENTER,problemDialogsHtml,problemCardHtml,problemConversationHtml} from './problem-thread.mjs';

const t=(key,values)=>uiText(`portal.${key}`,values);
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// When a dispute closes, the client reads first who won and what happens to the money.
// A request already sent is the freelancer's turn: the client decides again on the new version.
export const canDecide=(accepted,view)=>!accepted&&!view?.change_request;
export const refundedByDispute=item=>item?.status==='RESOLVED'&&['RESOLVED_BUYER_FAVOUR','ACCEPTED'].includes(item.outcome);
// Report a problem takes the place of Request changes once PayPal confirmed the payment: a paid addendum is read-only.
// Not while a PayPal dispute exists: the client is already talking to PayPal.
export {PROBLEM_REASONS,PAYPAL_RESOLUTION_CENTER};
export const canReportProblem=(view,dispute,problem,disputeLoading=false)=>view?.status==='accepted'&&view?.payment_status==='completed'&&!disputeLoading&&!dispute&&!problem;
export function closedResult(item){
 if(item.status!=='RESOLVED')return '';
 const outcome=['RESOLVED_BUYER_FAVOUR','RESOLVED_SELLER_FAVOUR','CANCELED_BY_BUYER','RESOLVED_WITH_PAYOUT','ACCEPTED','DENIED'].includes(item.outcome)?item.outcome:'OTHER';
 const value=Number(item.amount?.value);
 const amount=Number.isFinite(value)&&/^[A-Z]{3}$/.test(item.amount?.currency||'')?new Intl.NumberFormat(uiLocale(),{style:'currency',currency:item.amount.currency}).format(value):'';
 return `<p class="portal-dispute-result" role="status">${t(`dispute.resultNote.${outcome}`,{amount})}</p>`;
}
// paidActions (client account only): extra actions for a paid addendum, such as Request a refund, drawn inside this card.
export function mountAgreement(root,{api,linkMode=false,inDisputeHint=false,paidActions=null}){
 // The hint comes from the list the client just saw, so the state is right at once; PayPal then confirms it.
 let view=null,pdfUrl='',disputeUrl='',dispute=null,disputeError=false,disputeLoading=false,disputeHint=inDisputeHint,conversationHtml='',problem=null,problemError=false,problemChecked=false;
 const doc=root.ownerDocument;
 const q=selector=>root.querySelector(selector);
 const money=minor=>new Intl.NumberFormat(uiLocale(),{style:'currency',currency:view.currency||'USD'}).format(minor/100);
 const day=value=>value?new Intl.DateTimeFormat(uiLocale(),{dateStyle:'long',timeZone:'UTC'}).format(new Date(value.length===10?value+'T00:00:00Z':value)):'';
 // Dialogs live inside the root so the view can be mounted and removed as a unit.
 const dialogs=doc.createElement('div');
 dialogs.innerHTML=`<dialog class="portal-dialog portal-pdf-dialog" data-pdf><div class="portal-dialog-head"><strong data-pdf-title></strong><button type="button" class="portal-icon-button" data-close aria-label="${t('closePdf')}">${icon('x')}</button></div><iframe data-pdf-frame title=""></iframe></dialog>
 <dialog class="portal-dialog portal-confirm-dialog" data-changes><h2>${t('changesTitle')}</h2><p>${t('changesCopy')}</p><textarea class="portal-textarea" data-changes-notes maxlength="4000" rows="5" aria-label="${t('changesTitle')}"></textarea><p class="portal-error" data-changes-error role="alert"></p><div class="portal-actions"><button type="button" class="portal-button secondary" data-close>${t('cancel')}</button><button type="button" class="portal-button" data-changes-send>${t('changesSend')}</button></div></dialog>
 <dialog class="portal-dialog portal-confirm-dialog" data-confirm><h2>${t('confirmTitle')}</h2><p data-confirm-copy></p><p class="portal-error" data-confirm-error role="alert"></p><div class="portal-actions"><button type="button" class="portal-button secondary" data-close>${t('cancel')}</button><button type="button" class="portal-button" data-confirm-accept>${t('confirmAccept')}</button></div></dialog>
 <dialog class="portal-dialog portal-side-dialog" data-conditions aria-labelledby="portal-conditions-title"><div class="portal-dialog-head"><strong id="portal-conditions-title">${t('conditions')}</strong><button type="button" class="portal-icon-button" data-close aria-label="${t('close')}" title="${t('close')}">${icon('x')}</button></div><p class="portal-conditions-text" data-conditions-text></p></dialog>
 <dialog class="portal-dialog portal-side-dialog" data-conversation aria-labelledby="portal-conversation-title"><div class="portal-dialog-head"><strong id="portal-conversation-title">${t('dispute.conversationTitle')}</strong><button type="button" class="portal-icon-button" data-close aria-label="${t('close')}" title="${t('close')}">${icon('x')}</button></div><div data-conversation-body></div></dialog>
 ${problemDialogsHtml()}
 <dialog class="portal-dialog portal-confirm-dialog" data-dispute-list><div class="portal-dialog-head"><strong data-dispute-list-title></strong><button type="button" class="portal-icon-button" data-close aria-label="${t('closePdf')}">${icon('x')}</button></div><div class="portal-dispute-doc-list" data-dispute-list-rows></div><p class="portal-error" data-dispute-list-error role="alert"></p></dialog>`;
 const card=doc.createElement('section');card.className='portal-card';card.setAttribute('aria-live','polite');
 root.replaceChildren(card,dialogs);
 for(const button of dialogs.querySelectorAll('[data-close]'))button.addEventListener('click',()=>button.closest('dialog').close());
 // TeTrato drafts the change request; the client reviews it in the same form as always and sends it.
 const assistant=createPortalAssistant({doc,api,onDraft:text=>{q('[data-changes-notes]').value=text;q('[data-changes-error]').textContent='';q('[data-changes]').showModal();},
  // TeTrato drafts the problem report; the client still picks the reason and sends it. Not if one was sent or a PayPal dispute exists.
  onProblemDraft:text=>{if(canReportProblem(view,dispute,problem,disputeLoading))openNewProblem(text);else{assistant.changesDismissed();if(problem)openProblem();}},
  // «Accept it» / «pay it»: the same buttons and confirmations the page always shows.
  onAccept:()=>{const button=doc.querySelector('[data-accept]');if(!button||button.disabled)return false;button.click();return true;},
  onPay:()=>{const button=doc.querySelector('[data-pay]');if(!button||button.disabled)return false;button.click();return true;}});
 dialogs.append(assistant.element);

 function message(kind){
  card.innerHTML=`<div class="portal-message"><span class="portal-message-icon" aria-hidden="true">${icon(kind==='superseded'?'history':'lock-keyhole')}</span><h1>${t(kind+'Title')}</h1><p>${t(kind+'Copy')}</p></div>`;
 }
 function payment(amount){
  // Paid only when PayPal confirms it (the return page captures and verifies the order).
  if(view.payment_status==='completed'){
   if(view.refunded_minor>0){
    const refunded=new Intl.NumberFormat(uiLocale(),{style:'currency',currency:view.currency}).format(view.refunded_minor/100);
    return `<section class="portal-payment paid">${icon('undo-2')}<div><strong>${t(view.refunded_minor>=view.additional_minor?'refundedTitle':'partialRefundTitle')}</strong><p>${t('refundConfirmed',{amount:refunded})}</p></div></section>`;
   }
   // A report lives in Trato, so it shows at once; if PayPal then answers with a dispute, the card switches to it.
   if(disputeLoading&&!disputeHint&&problem)return problemCard(amount);
   // Until Trato knows whether there is a report, PayPal is not named: the report, not PayPal, may be what this shows.
   if(disputeLoading&&!disputeHint&&!problemChecked)return `<section class="portal-payment" role="status"><div><strong>${t('problem.checkingPayment')}</strong></div></section>`;
   if(disputeLoading&&!disputeHint)return `<section class="portal-payment" role="status"><div><strong>${t('dispute.checking')}</strong></div></section>`;
   if(refundedByDispute(dispute))return `<section class="portal-payment" role="status">${icon('flag')}<div><strong>${t('refundVerificationPending')}</strong></div></section>`;
   const open=dispute?dispute.status!=='RESOLVED':disputeHint;
   // A report in Trato is part of the payment's state too, like a dispute: paid, but not settled for the client.
   const reported=!open&&['open','resolved','unresolved'].includes(problem?.status)?problem.status:'';
   // One card: the payment's state and the report together, never the same news twice.
   if(reported)return problemCard(amount);
   return `<section class="portal-payment paid ${open?'in-dispute':''}">${icon(open?'flag':'circle-check')}<div><strong>${t(open?'paidInDisputeTitle':'paidTitle')}</strong><p>${t(open?'paidInDisputeCopy':'paidCopy',{amount})}</p></div></section>`;
  }
  // A PayPal invoice is named as such, with its number, so the client recognizes PayPal's own email for it.
  const invoice=view.payment_method==='invoice'&&view.invoice_number;
  if(invoice)return `<section class="portal-payment"><div><strong>${t('invoiceTitle',{amount})}</strong><p>${t('invoiceCopy',{number:view.invoice_number})}</p><p class="portal-error" data-pay-error role="alert"></p></div><button type="button" class="portal-button" data-pay>${icon('file-text')}${t('invoiceAction')}</button></section>`;
  return `<section class="portal-payment"><div><strong>${t('payTitle',{amount})}</strong><p>${t('payCopy')}</p><p class="portal-error" data-pay-error role="alert"></p></div><button type="button" class="portal-button" data-pay>${icon('wallet')}${t('payAction')}</button></section>`;
 }
 function disputeMarkup(){
  if(disputeError)return `<p class="portal-error" role="alert">${t('dispute.error')}</p>`;
  if(disputeLoading&&disputeHint)return `<p class="portal-note" role="status">${t('dispute.checking')}</p>`;
  if(!dispute)return '';
  const known=(list,value)=>list.includes(value)?value:'OTHER';
  const when=value=>value?new Intl.DateTimeFormat(uiLocale(),{dateStyle:'medium',timeStyle:'short'}).format(new Date(value)):'';
  const item=(m,index)=>`<li class="is-${m.by==='BUYER'?'mine':'theirs'}"><small>${t(`dispute.by.${known(['BUYER','SELLER','ARBITER'],m.by)}`)}${m.at?` · ${escape(when(m.at))}`:''}</small><p>${escape(m.text)}</p>${m.documents?.length?`<button type="button" class="portal-link portal-dispute-docs" data-dispute-docs="${index}">${icon('paperclip')}${t('dispute.documentsAttached',{count:m.documents.length})}</button>`:''}</li>`;
  const messages=dispute.messages||[];
  conversationHtml=`<ol class="portal-dispute-messages">${messages.map((m,i)=>item(m,i)).join('')}</ol>`;
  return `<section class="portal-dispute"><span class="portal-eyebrow">${t('dispute.eyebrow')}</span><h2>${t(`dispute.reason.${known(['MERCHANDISE_OR_SERVICE_NOT_RECEIVED','MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED'],dispute.reason)}`)}</h2><p class="portal-dispute-status">${t(`dispute.status.${known(['WAITING_FOR_BUYER_RESPONSE','WAITING_FOR_SELLER_RESPONSE','UNDER_REVIEW','RESOLVED'],dispute.status)}`)}${dispute.outcome?` · ${t(`dispute.outcome.${known(['RESOLVED_BUYER_FAVOUR','RESOLVED_SELLER_FAVOUR','CANCELED_BY_BUYER','RESOLVED_WITH_PAYOUT','ACCEPTED','DENIED'],dispute.outcome)}`)}`:''} · ${t('dispute.case')} ${escape(dispute.dispute_id)}</p>${refundedByDispute(dispute)?'':closedResult(dispute)}${messages.length?`<button type="button" class="portal-link portal-dispute-conversation" data-dispute-conversation aria-haspopup="dialog">${icon('messages-square')}${t('dispute.conversation',{count:messages.length})}</button>`:''}${dispute.reply_url?`<a class="portal-button secondary" href="${escape(dispute.reply_url)}" target="_blank" rel="noopener noreferrer">${icon('arrow-up-right')}${t('dispute.reply')}</a><p class="portal-note">${t('dispute.replyNote')}</p>`:''}</section>`;
 }
 function problemMarkup(){
  if(problemError)return `<p class="portal-error" role="alert">${t('problem.loadError')}</p>`;
  if(!problem)return '';
  // Usually the payment card already carries the report; with a PayPal dispute open it speaks of the dispute instead.
  const disputeOpen=dispute?dispute.status!=='RESOLVED':disputeHint;
  if(!disputeOpen&&view?.payment_required)return '';
  return problemCard(null);
 }
 const problemCard=amount=>problemCardHtml(problem,{amount});
 const problemConversation=()=>problemConversationHtml(problem);
 function openProblem(){
  const body=q('[data-problem-body]');body.innerHTML=problemConversation();
  body.querySelector('[data-problem-reply-send]')?.addEventListener('click',()=>problemAction('problem-message',()=>{const text=body.querySelector('[data-problem-reply]').value.trim();return text?{body:text}:null;}));
  for(const button of body.querySelectorAll('[data-problem-close]'))button.addEventListener('click',()=>problemAction('close-problem',()=>({status:button.dataset.problemClose})));
  if(!q('[data-problem]').open)q('[data-problem]').showModal();
 }
 async function problemAction(action,payload){
  const body=q('[data-problem-body]'),error=body.querySelector('[data-problem-error]'),data=payload();
  if(!data){error.textContent=t('problem.replyRequired');return;}
  for(const button of body.querySelectorAll('button'))button.disabled=true;
  try{problem=await api(action,data);render();openProblem();}
  catch(failure){
   if(['PROBLEM_CLOSED','PROBLEM_AWAITING_FREELANCER'].includes(failure.code||failure.message)){q('[data-problem]').close();return loadProblem();}
   error.textContent=t(failure.status===404?'expiredCopy':'problem.actionError');
   for(const button of body.querySelectorAll('button'))button.disabled=false;
  }
 }
 async function loadProblem(){
  if(view?.status!=='accepted'||view?.payment_status!=='completed')return;
  try{problem=await api('problem',{});problemError=false;}catch{problem=null;problemError=true;}
  problemChecked=true;render();
 }
 async function loadDispute(){
  if(view?.payment_status!=='completed')return;
  const started=Date.now();
  try{dispute=await api('dispute',{});disputeError=false;console.info('[Trato] addendum dispute',{ms:Date.now()-started,status:dispute?.status??null,outcome:dispute?.outcome??null});}catch(error){dispute=null;disputeError=true;console.info('[Trato] addendum dispute failed',{ms:Date.now()-started,code:error?.code??null});}
  disputeLoading=false;disputeHint=false;render();
 }
 function render(){
  const accepted=view.status==='accepted',superseded=view.status==='superseded'||!view.is_current;
  if(superseded&&!accepted)return message('superseded');
  const amount=view.additional_minor>0?money(view.additional_minor):t('noCharge');
  const state=accepted?`<p class="portal-state accepted">${icon('circle-check')}<span>${t('acceptedOn',{date:day(view.accepted_at)})}</span></p>`:view.change_request?`<p class="portal-state waiting">${icon('history')}<span>${t('changesWaiting')}</span></p>`:`<p class="portal-state">${icon('info')}<span>${t('pending')}</span></p>`;
  card.innerHTML=`<div class="portal-card-head"><div class="portal-card-title"><span class="portal-eyebrow">${t('eyebrow',{number:view.revision_no})}</span><h1>${escape(view.project_name)}</h1><p class="portal-for">${t('forClient',{name:escape(view.client_name)})}</p></div><div class="portal-card-tools" role="group" aria-label="${t('actions.learn')}"><button type="button" class="portal-button secondary" data-open-pdf>${icon('file-text')}${t('viewPdf')}</button><button type="button" class="tetrato-fab tetrato-fab-local" data-ask-assistant aria-haspopup="dialog" aria-label="${t('assistant.open')}" title="${t('assistant.open')}"><img src="/assets/mascot/trato-guide.png" alt="" width="40" height="40"><span>TeTrato</span></button></div></div>${state}
  <dl class="portal-facts"><div><dt>${t('amount')}</dt><dd>${amount}</dd></div><div><dt>${t('deadline')}</dt><dd>${day(view.deadline)}</dd></div><div><dt>${t('version')}</dt><dd>v${escape(view.revision_no)}</dd></div></dl>
  <section class="portal-scope"><h2>${t('scope')}</h2><p class="portal-scope-text" data-scope>${escape(view.scope_summary)}</p><button type="button" class="portal-link" data-scope-more hidden>${t('showMore')}</button>${view.conditions?`<button type="button" class="portal-link" data-open-conditions aria-haspopup="dialog">${t('viewConditions')}</button>`:''}</section>
  ${accepted&&view.payment_required?payment(amount):''}
  ${disputeMarkup()}
  ${problemMarkup()}
  ${(()=>{const report=canReportProblem(view,dispute,problem,disputeLoading)&&!problemError?`<button type="button" class="portal-button secondary" data-report-problem aria-haspopup="dialog">${icon('flag')}${t('problem.action')}</button>`:'';
   const extra=view.payment_status==='completed'&&paidActions?paidActions()||{}:{};
   const shown=extra.hideReport?'':report;
    return `${extra.notice||''}${shown||extra.button?`<div class="portal-actions" role="group" aria-label="${t('actions.decide')}">${shown}${extra.button||''}</div>`:''}`;})()}
  ${!accepted&&view.change_request?`<section class="portal-request">${icon('messages-square')}<div><strong>${t('changesSent',{date:day(view.change_request.requested_at)})}</strong><p>${escape(view.change_request.notes)}</p><small>${t('changesNext')}</small></div></section>`:''}
  ${!canDecide(accepted,view)?'':`<div class="portal-actions" role="group" aria-label="${t('actions.decide')}"><button type="button" class="portal-button secondary" data-request-changes>${icon('pencil')}${t('changesAction')}</button><button type="button" class="portal-button" data-accept>${icon('check')}${t('accept')}</button></div>`}
  ${accepted?(view.payment_required?'':`<p class="portal-next">${t('acceptedNoPayment')}</p>`):canDecide(accepted,view)?`<p class="portal-note">${t('acceptNote')}</p>`:''}
  ${linkMode?`<p class="portal-save"><span aria-hidden="true">${icon('user-round')}</span><span>${t('accountHint')}</span></p>`:''}`;
  const scope=card.querySelector('[data-scope]'),more=card.querySelector('[data-scope-more]');
  if(scope.scrollHeight>scope.clientHeight+4){more.hidden=false;more.onclick=()=>{scope.classList.toggle('open');more.textContent=t(scope.classList.contains('open')?'showLess':'showMore');};}
  card.querySelector('[data-open-pdf]').onclick=openPdf;
  card.querySelector('[data-ask-assistant]').onclick=()=>assistant.open();
  const conditions=card.querySelector('[data-open-conditions]');
  if(conditions)conditions.onclick=()=>{q('[data-conditions-text]').textContent=view.conditions;q('[data-conditions]').showModal();};
  for(const button of card.querySelectorAll('[data-dispute-docs]'))button.onclick=()=>openAttachments(Number(button.dataset.disputeDocs));
  const conversation=card.querySelector('[data-dispute-conversation]');
  if(conversation)conversation.onclick=()=>{
   const body=q('[data-conversation-body]');body.innerHTML=conversationHtml;
   for(const button of body.querySelectorAll('[data-dispute-docs]'))button.onclick=()=>openAttachments(Number(button.dataset.disputeDocs));
   q('[data-conversation]').showModal();
  };
  card.querySelector('[data-pay]')?.addEventListener('click',pay);
  card.querySelector('[data-problem-open]')?.addEventListener('click',openProblem);
  card.querySelector('[data-report-problem]')?.addEventListener('click',()=>{assistant.changesDismissed();openNewProblem();});
  card.querySelector('[data-request-changes]')?.addEventListener('click',()=>{assistant.changesDismissed();q('[data-changes-notes]').value=view.change_request?.notes||'';q('[data-changes-error]').textContent='';q('[data-changes]').showModal();});
  card.querySelector('[data-accept]')?.addEventListener('click',()=>{q('[data-confirm-copy]').textContent=t('confirmCopy',{number:view.revision_no,amount});q('[data-confirm-error]').textContent='';q('[data-confirm]').showModal();});
 }
 async function pay(){
  const button=card.querySelector('[data-pay]');button.disabled=true;card.querySelector('[data-pay-error]').textContent='';
  try{
   const result=await api('pay',{});
   if(result.status==='completed'){view=await api('view',{});return render();}
   if(!/^https:\/\/www\.sandbox\.paypal\.com\//.test(result.approval_url||''))throw new Error('PAYMENT_NOT_READY');
   doc.defaultView.location.assign(result.approval_url);
  }catch{card.querySelector('[data-pay-error]').textContent=t('payError');button.disabled=false;}
 }
 function openAttachments(message){
  const names=dispute?.messages?.[message]?.documents||[],list=q('[data-dispute-list]');
  list.querySelector('[data-dispute-list-title]').textContent=t('dispute.documentsAttached',{count:names.length});
  list.querySelector('[data-dispute-list-error]').textContent='';
  const rows=list.querySelector('[data-dispute-list-rows]');rows.replaceChildren();
  names.forEach((name,document)=>{
   const button=doc.createElement('button');button.type='button';button.className='portal-button secondary';button.innerHTML=`${icon('eye')}<span>${escape(name)}</span>`;
   button.onclick=()=>openDisputeDocument(button,message,document,name);rows.append(button);
  });
  list.showModal();
 }
 async function openDisputeDocument(button,message,document,name){
  button.disabled=true;
  try{
   const blob=await api('dispute-document',{message,document},{binary:true});
   if(disputeUrl)URL.revokeObjectURL(disputeUrl);
   disputeUrl=URL.createObjectURL(blob);
   q('[data-pdf-title]').textContent=name;q('[data-pdf-frame]').title=name;q('[data-pdf-frame]').src=disputeUrl;q('[data-pdf]').showModal();
  }catch{q('[data-dispute-list-error]').textContent=t('dispute.previewError');}
  finally{button.disabled=false;}
 }
 async function openPdf(){
  const button=card.querySelector('[data-open-pdf]');button.disabled=true;
  try{
   if(!pdfUrl)pdfUrl=URL.createObjectURL(await api('document',{},{binary:true}));
   const title=t('pdfTitle',{number:view.revision_no});q('[data-pdf-title]').textContent=title;q('[data-pdf-frame]').title=title;q('[data-pdf-frame]').src=pdfUrl;q('[data-pdf]').showModal();
  }catch{doc.defaultView.alert(t('pdfError'));}
  finally{button.disabled=false;}
 }
 q('[data-changes-send]').addEventListener('click',async()=>{
  const button=q('[data-changes-send]'),notes=q('[data-changes-notes]').value.trim();
  q('[data-changes-error]').textContent='';
  if(!notes){q('[data-changes-error]').textContent=t('changesRequired');return;}
  button.disabled=true;
  try{view=await api('request-changes',{notes});assistant.changesSent();q('[data-changes]').close();render();}
  catch(error){
   if(['PROPOSAL_REVISION_CONFLICT','PROPOSAL_ALREADY_ACCEPTED','CHANGE_REQUEST_PENDING'].includes(error.code||error.message)){q('[data-changes]').close();return load();}
   q('[data-changes-error]').textContent=t(error.status===404?'expiredCopy':'changesError');
  }finally{button.disabled=false;}
 });
 function openNewProblem(draft=''){
  // TeTrato may prefill the description; the client still chooses the reason and sends it.
  q('[data-problem-notes]').value=draft;q('[data-problem-new-error]').textContent='';
  q('[data-problem-reason]').value='';
  q('[data-problem-new]').showModal();
 }
 q('[data-problem-send]').addEventListener('click',async()=>{
  const button=q('[data-problem-send]'),error=q('[data-problem-new-error]');
  const reason=q('[data-problem-reason]').value,notes=q('[data-problem-notes]').value.trim();
  error.textContent='';
  if(!reason){error.textContent=t('problem.reasonRequired');return;}
  if(!notes){error.textContent=t('problem.notesRequired');return;}
  button.disabled=true;
  try{problem=await api('report-problem',{reason,notes});assistant.changesSent();q('[data-problem-new]').close();render();}
  catch(failure){
   const code=failure.code||failure.message;
   if(code==='PROBLEM_ALREADY_REPORTED'){q('[data-problem-new]').close();return loadProblem();}
   error.textContent=t(failure.status===404?'expiredCopy':code==='PROBLEM_REQUIRES_PAYMENT'?'problem.requiresPayment':'problem.sendError');
  }finally{button.disabled=false;}
 });
 q('[data-confirm-accept]').addEventListener('click',async()=>{
  const button=q('[data-confirm-accept]');button.disabled=true;q('[data-confirm-error]').textContent='';
  try{view=await api('accept',{revision_id:view.revision_id,addendum_sha256:view.addendum_sha256});q('[data-confirm]').close();render();}
  catch(error){
   if(['PROPOSAL_REVISION_CONFLICT','ADDENDUM_CHANGED','CHANGE_REQUEST_PENDING'].includes(error.code||error.message)){q('[data-confirm]').close();return load();}
   q('[data-confirm-error]').textContent=t(error.status===404?'expiredCopy':'acceptError');
  }finally{button.disabled=false;}
 });
 async function load(){
  card.innerHTML=`<p class="portal-loading">${t('loading')}</p>`;
  try{view=await api('view',{});disputeLoading=view.payment_status==='completed';render();void loadDispute();void loadProblem();}
  catch(error){
   if(error.status===404)return message('expired');
   card.innerHTML=`<div class="portal-message"><h1>${t('errorTitle')}</h1><p>${t('errorCopy')}</p><button type="button" class="portal-button" data-retry>${t('retry')}</button></div>`;
   card.querySelector('[data-retry]').addEventListener('click',load);
  }
 }
 load();
 return {reload:()=>view?render():load(),reportProblem:openNewProblem,release:()=>{if(pdfUrl)URL.revokeObjectURL(pdfUrl);if(disputeUrl)URL.revokeObjectURL(disputeUrl);}};
}
