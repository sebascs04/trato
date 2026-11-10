// Report a problem, client side, as one component: the status card, the floating conversation and the new-report dialog.
// Used by a paid addendum (portal-view.mjs) and by a paid Work plan deliverable (stage-problems.mjs), so both look the same.
// The caller provides `api(action, body)` with the actions problem, report-problem, problem-message and close-problem.
import {uiText,uiLocale} from './i18n.mjs';
import {icon} from './icons.mjs';

const t=(key,values)=>uiText(`portal.${key}`,values);
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const PROBLEM_REASONS=['not_received','not_as_agreed','quality','other'];
export const PAYPAL_RESOLUTION_CENTER='https://www.sandbox.paypal.com/resolutioncenter';
const day=value=>value?new Intl.DateTimeFormat(uiLocale(),{dateStyle:'long',timeZone:'UTC'}).format(new Date(value.length===10?value+'T00:00:00Z':value)):'';

export function problemDialogsHtml(){
 return `<dialog class="portal-dialog portal-confirm-dialog" data-problem-new aria-labelledby="portal-problem-new-title"><h2 id="portal-problem-new-title">${t('problem.newTitle')}</h2><p>${t('problem.newCopy')}</p><label class="portal-field" for="portal-problem-reason">${t('problem.reasonLabel')}</label><select class="portal-select" id="portal-problem-reason" data-problem-reason><option value="">${t('problem.reasonChoose')}</option>${PROBLEM_REASONS.map(r=>`<option value="${r}">${t(`problem.reason.${r}`)}</option>`).join('')}</select><textarea class="portal-textarea" data-problem-notes maxlength="4000" rows="5" aria-label="${t('problem.notesLabel')}" placeholder="${t('problem.notesPlaceholder')}"></textarea><p class="portal-error" data-problem-new-error role="alert"></p><div class="portal-actions"><button type="button" class="portal-button secondary" data-close data-problem-dialog-close>${t('cancel')}</button><button type="button" class="portal-button" data-problem-send>${t('problem.send')}</button></div></dialog>
 <dialog class="portal-dialog portal-side-dialog" data-problem aria-labelledby="portal-problem-title"><div class="portal-dialog-head"><strong id="portal-problem-title">${t('problem.conversationTitle')}</strong><button type="button" class="portal-icon-button" data-close data-problem-dialog-close aria-label="${t('close')}" title="${t('close')}">${icon('x')}</button></div><div data-problem-body></div></dialog>`;
}

// amount: shown as the payment's state ("Paid · Problem reported"); null when the payment card speaks of a dispute instead.
export function problemCardHtml(problem,{amount=null}={}){
 const reason=PROBLEM_REASONS.includes(problem.reason)?problem.reason:'other';
 const state=['open','resolved','unresolved'].includes(problem.status)?problem.status:'open';
 // Registering the report as a new request is the freelancer's answer too: the client may then reply and close.
 const replied=(problem.messages||[]).some(m=>m.author==='freelancer')||!!problem.registered_as_request;
 // Paid is not the same as fixed: the reminder asks the client to close it once the fix is delivered.
 const next=state==='open'?t(problem.request_paid?'problem.next.requestPaid':problem.registered_as_request?'problem.next.registered':replied?'problem.next.replied':'problem.next.waiting'):t(`problem.next.${state}`);
 const title=amount===null?t('problem.sent',{date:day(problem.created_at)}):t(`problem.paid.${state}Title`);
 const facts=amount===null?t(`problem.reason.${reason}`):`${t('problem.paid.copy',{amount})} ${t('problem.reportedOn',{reason:t(`problem.reason.${reason}`),date:day(problem.created_at)})}`;
 return `<section class="portal-payment paid portal-problem is-${state} ${state==='resolved'?'':'in-dispute'}">${icon(state==='resolved'?'circle-check':'flag')}<div><strong>${title}</strong><p>${facts}</p><small>${next}</small>
  <div class="portal-problem-tools"><button type="button" class="portal-link" data-problem-open aria-haspopup="dialog">${icon('messages-square')}${t('problem.open',{count:(problem.messages||[]).length+1})}</button>${state==='unresolved'?`<a class="portal-button secondary" href="${PAYPAL_RESOLUTION_CENTER}" target="_blank" rel="noopener noreferrer">${icon('arrow-up-right')}${t('problem.paypal')}</a>`:''}</div></div></section>`;
}

export function problemConversationHtml(problem){
 const when=value=>value?new Intl.DateTimeFormat(uiLocale(),{dateStyle:'medium',timeStyle:'short'}).format(new Date(value)):'';
 const item=(author,body,at)=>`<li class="is-${author==='client'?'mine':'theirs'}"><small>${t(`problem.by.${author==='client'?'client':'freelancer'}`)}${at?` · ${escape(when(at))}`:''}</small><p>${escape(body)}</p></li>`;
 const list=[item('client',problem.notes,problem.created_at),...(problem.messages||[]).map(m=>item(m.author,m.body,m.created_at))].join('');
 // Until the freelancer answers there is nothing to judge: the client waits, without closing or adding to it.
 const open=problem.status==='open',replied=(problem.messages||[]).some(m=>m.author==='freelancer')||!!problem.registered_as_request;
 const registered=problem.registered_as_request?`<p class="portal-note portal-problem-registered" role="status">${icon('check')}<span>${t(problem.request_paid&&problem.status==='open'?'problem.next.requestPaid':'problem.next.registered')}</span></p>`:'';
 if(open&&!replied)return `<ol class="portal-dispute-messages">${list}</ol>${registered}<p class="portal-note" role="status">${t('problem.next.waiting')}</p>`;
 return `<ol class="portal-dispute-messages">${list}</ol>${registered}${open?`<textarea class="portal-textarea" data-problem-reply maxlength="4000" rows="3" aria-label="${t('problem.replyLabel')}" placeholder="${t('problem.replyLabel')}"></textarea><p class="portal-error" data-problem-error role="alert"></p>
  <div class="portal-actions portal-problem-actions"><button type="button" class="portal-button secondary" data-problem-close="unresolved">${t('problem.unresolved')}</button><button type="button" class="portal-button secondary" data-problem-close="resolved">${icon('check')}${t('problem.resolved')}</button><button type="button" class="portal-button" data-problem-reply-send>${t('problem.reply')}</button></div><p class="portal-note">${t('problem.closeNote')}</p>`:`<p class="portal-note">${t(`problem.next.${problem.status==='resolved'?'resolved':'unresolved'}`)}</p>`}`;
}

// Wires the two dialogs found inside `scope`. getProblem/setProblem keep the caller's state; reload re-reads it after a conflict.
export function createProblemThread({scope,api,getProblem,setProblem,reload,onSent=()=>{}}){
 const q=selector=>scope.querySelector(selector);
 for(const button of scope.querySelectorAll('[data-problem-dialog-close]'))button.addEventListener('click',()=>button.closest('dialog').close());
 function openConversation(){
  const problem=getProblem();if(!problem)return;
  const body=q('[data-problem-body]');body.innerHTML=problemConversationHtml(problem);
  body.querySelector('[data-problem-reply-send]')?.addEventListener('click',()=>act('problem-message',()=>{const text=body.querySelector('[data-problem-reply]').value.trim();return text?{body:text}:null;}));
  for(const button of body.querySelectorAll('[data-problem-close]'))button.addEventListener('click',()=>act('close-problem',()=>({status:button.dataset.problemClose})));
  if(!q('[data-problem]').open)q('[data-problem]').showModal();
 }
 async function act(action,payload){
  const body=q('[data-problem-body]'),error=body.querySelector('[data-problem-error]'),data=payload();
  if(!data){error.textContent=t('problem.replyRequired');return;}
  for(const button of body.querySelectorAll('button'))button.disabled=true;
  try{setProblem(await api(action,data));openConversation();}
  catch(failure){
   if(['PROBLEM_CLOSED','PROBLEM_AWAITING_FREELANCER'].includes(failure.code||failure.message)){q('[data-problem]').close();return reload();}
   error.textContent=t(failure.status===404?'expiredCopy':'problem.actionError');
   for(const button of body.querySelectorAll('button'))button.disabled=false;
  }
 }
 function openNew(draft=''){
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
  try{const problem=await api('report-problem',{reason,notes});onSent();q('[data-problem-new]').close();setProblem(problem);}
  catch(failure){
   const code=failure.code||failure.message;
   if(code==='PROBLEM_ALREADY_REPORTED'){q('[data-problem-new]').close();return reload();}
   error.textContent=t(failure.status===404?'expiredCopy':code==='PROBLEM_REQUIRES_PAYMENT'?'problem.requiresPayment':'problem.sendError');
  }finally{button.disabled=false;}
 });
 return {openNew,openConversation};
}
