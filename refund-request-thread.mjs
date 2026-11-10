// A refund request, client side, as a conversation: the same side panel and look as Report a problem (problem-thread.mjs).
// The client explains and replies; the freelancer refunds or declines; the client may withdraw it. Once declined or
// withdrawn, that payment goes on with Report a problem, which can escalate. Reporting a problem while a refund request
// is open first closes the request, so there is one open path at a time.
import {uiText,uiLocale} from './i18n.mjs';
import {icon} from './icons.mjs';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const usd=minor=>new Intl.NumberFormat(uiLocale(),{style:'currency',currency:'USD'}).format(minor/100);
const when=value=>value?new Intl.DateTimeFormat(uiLocale(),{dateStyle:'medium',timeStyle:'short'}).format(new Date(value)):'';
const TERMINAL=['completed','closed_without_refund','rejected','withdrawn'];

// open: waiting for the freelancer; registered: refund on its way; declined/withdrawn: closed, Report a problem goes on.
export const refundRequestActive=r=>r.status==='open'||r.status==='registered'&&!TERMINAL.includes(r.refund_status);
export const refundRequestClosed=r=>r.status==='declined'||r.status==='withdrawn';

// The card on a paid deliverable or addendum. portal: the addendum card style; otherwise the Work plan dialog style.
export function refundRequestNotice(request,{portal=false}={}){
 const state=request.status==='open'?'requested':request.status==='registered'?(request.refund_status==='completed'?'refunded':'inProgress'):request.status;
 const title=uiText(`clientPlan.refundState.${state}`),copy=uiText(`clientPlan.refundState.${state}Copy`,{amount:usd(request.requested_minor)});
 const note=request.status==='declined'&&request.closed_note?`<p class="portal-note">«${esc(request.closed_note)}»</p>`:'';
 const count=(request.messages||[]).length+1;
 const open=`<button type="button" class="${portal?'portal-link':'text-button'}" data-refund-thread-open="${esc(request.id)}" aria-haspopup="dialog">${icon('messages-square')}${uiText('clientPlan.refundMessages',{count})}</button>`;
 return portal
  ?`<section class="portal-request" role="status">${icon('undo-2')}<div><strong>${title}</strong><p>${copy}</p>${note}${open}</div></section>`
  :`<div class="cloud-notice" role="status"><strong>${title}</strong><p>${copy}</p>${note}${open}</div>`;
}

export function installRefundRequestThread(cloud,{requestFor}){
 const doc=cloud.document;if(!doc?.createElement)return;
 const find=id=>(cloud.clientRefundRequests||[]).find(r=>r.id===id);
 // How a request that is no longer open ended: the panel says it plainly, in its own color, instead of looking like an open chat.
 const stateOf=r=>r.status==='registered'?(r.refund_status==='completed'?'refunded':'inProgress'):r.status==='open'?'requested':r.status;
 function closedBanner(r){
  const state=stateOf(r),bad=state==='declined'||state==='withdrawn';
  const note=state==='declined'&&r.closed_note?`<blockquote>${esc(r.closed_note)}</blockquote>`:'';
  return `<section class="refund-thread-closed is-${state}" role="status">${icon(bad?'x':state==='refunded'?'circle-check':'undo-2')}<div><strong>${uiText(`clientPlan.refundState.${state}`)}${r.closed_at?` · ${esc(when(r.closed_at))}`:''}</strong>${note}<p>${uiText(`clientPlan.refundState.${state}Copy`,{amount:usd(r.requested_minor)})}</p></div></section>`;
 }
 function conversation(r){
  const item=(author,body,at)=>`<li class="is-${author==='client'?'mine':'theirs'}"><small>${uiText(author==='client'?'portal.problem.by.client':'portal.problem.by.freelancer')}${at?` · ${esc(when(at))}`:''}</small><p>${esc(body)}</p></li>`;
  const list=[item('client',r.reason,r.created_at),...(r.messages||[]).map(m=>item(m.author,m.body,m.created_at))].join('');
  // Like a reported problem: after writing, the client waits for the freelancer's answer before writing again.
  const waiting=r.status==='open'&&(r.messages||[]).at(-1)?.author!=='freelancer';
  const compose=waiting?`<p class="portal-note" role="status">${uiText('clientPlan.refundWaiting')}</p><p class="portal-error" data-refund-thread-error role="alert"></p><div class="portal-actions"><button type="button" class="portal-button secondary" data-refund-thread-withdraw>${uiText('clientPlan.refundWithdraw')}</button></div>`
   :r.status==='open'?`<p class="portal-note" role="note">${uiText('clientPlan.refundOneMessage')}</p><textarea class="portal-textarea" data-refund-thread-text maxlength="4000" rows="3" aria-label="${uiText('portal.problem.replyLabel')}" placeholder="${uiText('portal.problem.replyLabel')}"></textarea><p class="portal-error" data-refund-thread-error role="alert"></p>
   <div class="portal-actions"><button type="button" class="portal-button secondary" data-refund-thread-withdraw>${uiText('clientPlan.refundWithdraw')}</button><button type="button" class="portal-button" data-refund-thread-send>${uiText('portal.problem.reply')}</button></div>`
   :closedBanner(r);
  const ask=r.status==='open'&&cloud.askClientTeTrato?`<button type="button" class="portal-button secondary tetrato-ask" data-refund-thread-ask><img src="/assets/mascot/trato-guide.png" alt="" width="36" height="36">${uiText('clientPlan.refundAsk')}</button>`:'';
  return `<div class="portal-dialog-head"><strong id="refund-thread-title">${uiText(r.status==='open'?'clientPlan.refundConversation':`clientPlan.refundState.${stateOf(r)}`)}</strong><button type="button" class="portal-icon-button" data-refund-thread-close aria-label="${uiText('portal.close')}" title="${uiText('portal.close')}">${icon('x')}</button></div><ol class="portal-dispute-messages">${list}</ol>${ask}${compose}`;
 }
 async function call(path,body){
  const result=await cloud.request(`/api/v1/portal/account/refund-requests/${encodeURIComponent(path)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})});
  if(Array.isArray(result))cloud.clientRefundRequests=result;
  if(cloud.agreementHost?.isConnected)void cloud.agreementView?.reload?.();
  cloud.notify();
  return result;
 }
 function open(id,trigger){
  const request=find(id);if(!request)return;
  const dialog=doc.createElement('dialog');dialog.className='portal-dialog portal-side-dialog';dialog.setAttribute('aria-labelledby','refund-thread-title');
  const close=()=>{dialog.close();dialog.remove();if(trigger?.isConnected)trigger.focus();};
  const paint=r=>{dialog.innerHTML=conversation(r);};
  paint(request);
  dialog.addEventListener('click',async event=>{
   if(event.target.closest('[data-refund-thread-close]')||event.target===dialog){close();return;}
   if(event.target.closest('[data-refund-thread-ask]')){
    const r=find(id);close();
    cloud.askClientTeTrato(uiText('clientPlan.refundAskPrompt',{amount:usd(r.requested_minor),reason:r.reason}));
    return;
   }
   const send=event.target.closest('[data-refund-thread-send]'),withdraw=event.target.closest('[data-refund-thread-withdraw]');
   if(!send&&!withdraw)return;
   const error=dialog.querySelector('[data-refund-thread-error]'),text=dialog.querySelector('[data-refund-thread-text]')?.value.trim();
   if(send&&!text){error.textContent=uiText('portal.problem.replyRequired');return;}
   dialog.querySelectorAll('button').forEach(b=>b.disabled=true);error.textContent='';
   try{await call(`${id}/${send?'messages':'withdraw'}`,send?{body:text}:{});const fresh=find(id);if(fresh)paint(fresh);else close();}
   catch{error.textContent=uiText('portal.problem.actionError');dialog.querySelectorAll('button').forEach(b=>b.disabled=false);}
  });
  doc.body.append(dialog);dialog.showModal();dialog.querySelector('[data-refund-thread-text]')?.focus();
 }
 doc.addEventListener('click',event=>{
  const trigger=event.target.closest?.('[data-refund-thread-open]');
  if(trigger){event.preventDefault();open(trigger.dataset.refundThreadOpen,trigger);}
 });
 // One open path at a time: reporting a problem on a payment with an open refund request closes that request first.
 doc.addEventListener('click',event=>{
  if(cloud.role!=='client')return;
  const trigger=event.target.closest?.('[data-report-problem],[data-stage-problem-new]');if(!trigger||trigger.dataset.refundCleared)return;
  const request=requestFor(trigger);if(!request||request.status!=='open')return;
  event.preventDefault();event.stopImmediatePropagation();
  const dialog=doc.createElement('dialog');dialog.className='portal-dialog portal-confirm-dialog';
  dialog.innerHTML=`<h2>${uiText('clientPlan.refundBeforeProblemTitle')}</h2><p>${uiText('clientPlan.refundBeforeProblemCopy')}</p><p class="portal-error" role="alert" data-refund-thread-error></p><div class="portal-actions"><button type="button" class="portal-button secondary" data-refund-thread-close>${uiText('portal.cancel')}</button><button type="button" class="portal-button" data-refund-thread-withdraw>${uiText('clientPlan.refundBeforeProblemConfirm')}</button></div>`;
  const close=()=>{dialog.close();dialog.remove();};
  dialog.addEventListener('click',async e=>{
   if(e.target.closest('[data-refund-thread-close]')||e.target===dialog){close();return;}
   if(!e.target.closest('[data-refund-thread-withdraw]'))return;
   dialog.querySelectorAll('button').forEach(b=>b.disabled=true);
   try{await call(`${request.id}/withdraw`);close();
    // The same button again, now with nothing open in the way.
    const again=doc.querySelector(trigger.matches('[data-stage-problem-new]')?'[data-stage-problem-new]':'[data-report-problem]');
    if(again){again.dataset.refundCleared='1';again.click();}
   }catch{dialog.querySelector('[data-refund-thread-error]').textContent=uiText('portal.problem.actionError');dialog.querySelectorAll('button').forEach(b=>b.disabled=false);}
  });
  doc.body.append(dialog);dialog.showModal();
 },true);
}
