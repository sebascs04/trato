import {uiText,uiLocale} from './i18n.mjs';
import {icon} from './icons.mjs';
const t=(k,v)=>uiText(`refundFinance.${k}`,v);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>Number.isSafeInteger(v)?new Intl.NumberFormat(uiLocale(),{style:'currency',currency:'USD'}).format(v/100):t('notConsulted');
const date=v=>new Intl.DateTimeFormat(uiLocale(),{dateStyle:'medium',timeStyle:'short',timeZone:'America/Lima'}).format(new Date(v));
const btn=(action,label,attrs='',values)=>`<button type="button" class="button secondary" data-refund-action="fin-${action}" ${attrs}>${t(label,values)}</button>`;
export const FINANCIAL_ACTIONS=['finance-authorize','finance-execute','finance-replay','finance-external','finance-retry'];
export const isFinancialAction=a=>FINANCIAL_ACTIONS.includes(a);
export const financeEligible=s=>!!s.snapshot&&s.detail?.settlement.current_snapshot_id===s.snapshot.id&&['accepted','refund_pending','completed'].includes(s.detail.settlement.status)&&s.snapshot.breakdown.refund_minor>0;
export function financialPath(p){
 const base=`/api/v1/refunds/${encodeURIComponent(p.settlementId)}`;
 if(p.action==='finance-authorize')return base+'/financial-authorizations';
 if(p.action==='finance-execute')return base+`/financial-authorizations/${encodeURIComponent(p.authorizationId)}/execute`;
 const suffix={'finance-replay':'replay','finance-external':'external-receipts','finance-retry':'retry-authorizations'}[p.action];
 if(!suffix)throw Error('refundFinance.requestError');
 return base+`/financial-operations/${encodeURIComponent(p.operationId)}/${suffix}`;
}
export function latestAttempt(data,operationId){return data.attempts.filter(a=>a.operation_id===operationId).reduce((last,a)=>!last||a.attempt_no>last.attempt_no?a:last,null);}
function outstanding(data,op){const applied=new Set(data.applications.filter(a=>a.operation_id===op.id).map(a=>a.receipt_id));return op.amount_minor-data.receipts.filter(r=>applied.has(r.id)&&r.status==='completed').reduce((n,r)=>n+r.amount_minor,0);}
export function financeError(error){
 const code=error?.code;
 if(typeof error?.message==='string'&&error.message.startsWith('refundFinance.'))return uiText(error.message);
 if(['REFUND_FINANCIAL_CHECK_EXPIRED','REFUND_RECOVERY_CHECK_MISMATCH'].includes(code))return t('expired');
 if(['REFUND_REPLAY_NOT_ALLOWED','REFUND_REPLAY_WINDOW_EXPIRED'].includes(code))return t('replayBlocked');
 if(['REFUND_REVISION_CONFLICT','REFUND_RECOVERY_CONFIRMATION_REQUIRED'].includes(code))return t('changed');
 if(['REFUND_RECONCILIATION_REQUIRED','REFUND_REFERENCE_UNCERTAIN','REFUND_FINANCIAL_RESULT_UNCERTAIN','REFUND_RECEIPT_NOT_APPLICABLE','REFUND_RECEIPT_EXCEEDS_ALLOCATION'].includes(code))return t('reviewNeeded');
 if(['REFUND_EXECUTION_IN_PROGRESS','REFUND_PREVIOUS_OPERATION_PENDING'].includes(code))return t('inProgress');
 if(code==='IDEMPOTENCY_KEY_CONFLICT')return t('keyConflict');
 if(['REFUND_EXCEEDS_AVAILABLE','REFUND_CAPTURE_EXPIRED','REFUND_CAPTURE_NOT_ELIGIBLE'].includes(code))return t('ineligible');
 return t('requestError');
}
export function renderFinancialPending(s){
 const p=s.pending;if(!isFinancialAction(p?.action))return '';
 return `<p>${t('uncertain')}</p>${btn('inspect','inspect')}${s.pendingBody?`<details><summary>${t('repeatRequest')}</summary><form data-refund-form="finance-resume"><p>${t('repeatHelp')}</p><label class="refund-checkbox"><input type="checkbox" name="confirmed" required>${t('repeatConfirm')}</label><button class="button" type="submit">${t('repeatRequest')}</button></form></details>`:''}`;
}
function facts(s,check){
 const evidence=Array.isArray(check?.evidence)?check.evidence:check?.evidence?[check.evidence]:[];
 if(!evidence.length)return '';
 return `<div class="refund-finance-facts">${evidence.map(e=>`<article><strong>${t('capture',{id:e.capture_id})}</strong><dl>${[['gross',e.gross_minor],['fee',e.original_fee_minor],['net',e.original_net_minor],['previous',e.previous_refunds_minor],['remaining',e.provider_remaining_minor]].map(([k,v])=>`<div><dt>${t(k)}</dt><dd>${money(v)}</dd></div>`).join('')}</dl></article>`).join('')}<p>${t('feeHelp')}</p><p>${t('expires',{date:date(check.expires_at)})}</p></div>`;
}
function sources(check){
 const p=check?.policy;if(!p)return '';
 return `<details class="refund-finance-sources"><summary>${t('sources')}</summary><p>${t('policyScope',{country:p.reference_country,currency:p.currency})}</p>${p.sources.map(source=>{
  const url=new URL(source.url);if(url.protocol!=='https:'||!['developer.paypal.com','www.paypal.com'].includes(url.hostname))throw Error('refundFinance.requestError');
  return `<p><a href="${esc(url.href)}" target="_blank" rel="noopener noreferrer">${esc(url.href)}</a> · ${esc(source.consulted_on)}</p>`;
 }).join('')}</details>`;
}
function form(s){
 const f=s.financeForm;if(!f)return '';
 const check=f.check;
 return `<form data-refund-form="finance" class="refund-finance-confirm"><h4>${t('action.'+f.kind)}</h4><p>${t('help.'+f.kind)}</p><p><strong>${t('amount')}: ${money(f.amount)}</strong></p>${facts(s,check)}${sources(check)}${f.kind==='external'?`<p>${t('receipt')}: <code>${esc(f.refundId)}</code></p>`:''}${f.kind==='execute'?'':`<label>${t('notes')}<textarea name="notes" maxlength="4000" required>${esc(f.notes)}</textarea></label>`}<label class="refund-checkbox"><input type="checkbox" name="confirmed" required ${f.confirmed?'checked':''}>${t('confirm.'+f.kind)}</label><button class="button" type="submit">${t('action.'+f.kind)}</button>${btn('cancel','cancel')}</form>`;
}
export function renderRefundFinance(s,stage=0){
 if(!financeEligible(s))return '';
 const d=s.financeData,check=s.financeCheck;
 let body='';
 if(stage===5){
  const auth=d?.authorizations.find(a=>a.snapshot_id===s.snapshot.id),blocked=d?.incidents.length>0;
  return `<section class="refund-finance"><h3>${t('authorizeTitle')}</h3><p>${t('authorizeHelp')}</p>${s.financeError?`<p role="alert" class="cloud-error">${esc(s.financeError)}</p>`:''}${s.financeNotice?`<p role="status">${esc(s.financeNotice)}</p>`:''}${auth?`<p class="refund-result">${t('alreadyAuthorized')}</p><p>${t('authorizedAmount',{amount:money(s.snapshot.breakdown.refund_minor)})}</p>`:!d?`<p>${t('inspectHelp')}</p>${btn('inspect','inspect')}`:blocked?`<p role="alert">${t('incident')}</p>`:s.financeForm?form(s):`<p><strong>${t('agreed')}: ${money(s.snapshot.breakdown.refund_minor)}</strong></p><p>${t('checkHelp')}</p>${btn('check','check')}`}</section>`;
 }
 if(d){
  const incidents=d.incidents.length>0;
  const auth=d.authorizations.find(a=>a.snapshot_id===s.snapshot.id);
  body=`<dl class="refund-finance-totals">${[['agreed',s.snapshot.breakdown.refund_minor],['confirmed',d.confirmed_minor],['reserved',d.reserved_minor]].map(([k,v])=>`<div><dt>${t(k)}</dt><dd>${money(v)}</dd></div>`).join('')}</dl>${incidents?`<p role="alert" class="cloud-error">${t('incident')}</p><details><summary>${t('incidentDetails')}</summary><ul>${d.incidents.map(i=>`<li><code>${esc(i.code)}</code> · ${esc(i.reference)}</li>`).join('')}</ul></details>`:''}
  ${stage!==6&&!auth&&d.settlement.status==='accepted'&&!incidents?btn('check','check'):''}
  ${auth&&d.operations.some(o=>o.status==='reserved')&&!incidents&&!d.runs.some(r=>r.status==='running')?btn('execute','execute',`data-authorization="${esc(auth.id)}"`):''}
  ${d.runs.some(r=>r.status==='running')?`<p>${t('runPending')}</p>`:''}
  ${stage===6||s.financeForm||!check?'':`<details><summary>${t('check')}</summary>${facts(s,check)}${sources(check)}</details>`}
  <div class="refund-finance-operations">${d.operations.map(op=>{
   const a=latestAttempt(d,op.id),pay=s.payments.find(p=>p.id===op.payment_id),remaining=outstanding(d,op);
   const uncertain=a&&['dispatching','uncertain'].includes(a.status);
   const active=d.attempts.some(x=>x.operation_id===op.id&&['dispatching','uncertain','pending'].includes(x.status));
   const replayAllowed=uncertain&&!a.replay_in_progress&&a.dispatched_at&&Date.now()-Date.parse(a.dispatched_at)<44*86400000;
   const terminal=a&&['failed','cancelled'].includes(a.status)&&!active&&remaining>0;
   const external=d.receipts.filter(r=>r.payment_id===op.payment_id&&r.status==='completed'&&!d.applications.some(x=>x.receipt_id===r.id));
   return `<article class="refund-finance-operation"><h4>${t('paymentTitle',{origin:pay?uiText(`refund.origin.${pay.origin}`):t('notConsulted'),id:op.payment_id.slice(0,8)})}</h4><dl><div><dt>${t('gross')}</dt><dd>${money(pay?.amount_minor)}</dd></div><div><dt>${t('agreed')}</dt><dd>${money(op.amount_minor)}</dd></div><div><dt>${t('outstanding')}</dt><dd>${money(remaining)}</dd></div></dl><p>${t('status.'+op.status)}</p>
    ${op.status!=='completed'&&(a?.dispatched_at||d.runs.some(r=>r.status==='running')||external.length)?`<p>${t('reconcileHelp')}</p>${btn('reconcile','reconcile',`data-operation="${esc(op.id)}"`)}`:''}
    ${op.status!=='completed'&&a?.provider_refund_id?`<p>${t('refreshHelp')}</p>${btn('refresh','refresh',`data-operation="${esc(op.id)}"`)}`:''}
    ${replayAllowed&&!incidents?btn('replay','replay',`data-operation="${esc(op.id)}"`):''}${uncertain&&!replayAllowed?`<p>${t('replayBlocked')}</p>`:''}
    ${terminal&&!incidents?btn('retry-check','retryCheck',`data-operation="${esc(op.id)}"`):''}
    ${!active&&!incidents&&remaining>0?external.map(r=>btn('external','applyExternal',`data-operation="${esc(op.id)}" data-receipt="${esc(r.id)}"`,{amount:money(r.amount_minor),id:r.refund_id})).join(''):''}
    <details><summary>${t('attempts')}</summary><ol>${d.attempts.filter(x=>x.operation_id===op.id).sort((a,b)=>a.attempt_no-b.attempt_no).map(x=>`<li>${t('attemptNumber',{number:x.attempt_no})} · ${money(x.amount_minor)} · ${t('status.'+x.status)}${x.provider_refund_id?`<p>${t('receipt')}: <code>${esc(x.provider_refund_id)}</code></p>`:''}</li>`).join('')}</ol></details></article>`;
  }).join('')}</div>
  ${d.receipts.length?`<h4>${t('receipts')}</h4><ul>${d.receipts.map(r=>`<li><code>${esc(r.refund_id)}</code> · ${money(r.amount_minor)} · ${t('status.'+r.status)} · ${t(d.applications.some(a=>a.receipt_id===r.id)?'applied':'external')}</li>`).join('')}</ul>`:''}`;
 }
 return `<section class="refund-finance" aria-label="${t('title')}"><h3>${icon('credit-card')} ${t(stage===6?(d?.settlement.status==='completed'?'resultTitle':'executeTitle'):'title')}</h3><p>${t(stage===6?(d?.settlement.status==='completed'?'resultHelp':'executeHelp'):'intro')}</p><p>${t('bankHelp')}</p>${s.financeError?`<p role="alert" class="cloud-error">${esc(s.financeError)}</p>`:''}${s.financeNotice?`<p role="status">${esc(s.financeNotice)}</p>`:''}${!d?`<p>${t('inspectHelp')}</p>${btn('inspect','inspect')}`:stage===6&&d.settlement.status!=='completed'?`<details><summary>${t('moreQueries')}</summary><p>${t('inspectHelp')}</p>${btn('inspect','inspect')}</details>`:''}${body}${form(s)}</section>`;
}
export function financialInput(s,el){
 if(el.closest('[data-refund-form]')?.dataset.refundForm!=='finance'||!s.financeForm||!el.name)return false;
 s.financeForm[el.name]=el.type==='checkbox'?el.checked:el.value;return true;
}
function validate(s,d){
 if(d?.settlement?.id!==s.detail.settlement.id||d.settlement.project_id!==s.project||d.settlement.owner_id!==s.owner||['authorizations','operations','attempts','receipts','applications','incidents','runs'].some(k=>!Array.isArray(d[k])))throw Error('refundFinance.requestError');
 if(d.operations.some(o=>o.settlement_id!==d.settlement.id)||d.attempts.some(a=>!Number.isInteger(a.attempt_no)))throw Error('refundFinance.requestError');
 return d;
}
export async function loadRefundFinance(s,cloud,h){
 const parent=s.detail?.settlement.id,snapshot=s.snapshot?.id;s.financeError='';
 if(!financeEligible(s)){s.financeData=null;s.financeForm=null;s.financeCheck=null;return;}
 try{
  const d=await cloud.request(`/api/v1/refunds/${parent}/financial`);
  if(h.current(s)&&s.detail?.settlement.id===parent&&s.snapshot?.id===snapshot){
   if(snapshot!==d?.settlement?.current_snapshot_id)throw Error('refundFinance.changed');
   s.financeData=validate(s,d);s.detail.settlement=d.settlement;
   s.items=s.items.map(x=>x.id===parent?d.settlement:x);
  }
 }catch(error){if(h.current(s)&&s.detail?.settlement.id===parent){s.financeData=null;s.financeError=financeError(error);}}
}
export async function financialAction(s,cloud,action,target,h){
 if(!action.startsWith('fin-'))return false;
 const a=action.slice(4),parent=s.detail?.settlement.id,base=`/api/v1/refunds/${parent}`;
 s.financeError='';s.financeNotice='';
 if(a==='cancel'){s.financeForm=null;return true;}
 if(a==='inspect'){s.financeForm=null;if(!parent&&s.pending?.settlementId)await h.openDetail(s,s.pending.settlementId);else await loadRefundFinance(s,cloud,h);if(h.current(s)&&!s.financeError)s.financeNotice=t('consulted');return true;}
 try{
  if(!financeEligible(s)||!s.financeData)throw Error('refundFinance.requestError');
  const d=s.financeData,op=d.operations.find(o=>o.id===target.dataset.operation),attempt=op?latestAttempt(d,op.id):null;
  if(['check','retry-check'].includes(a)){
   s.financeForm=null;
   const result=await cloud.request(a==='check'?base+'/financial-checks':base+`/financial-operations/${op.id}/retry-checks`,cloud.json({expected_snapshot_id:s.snapshot.id}));
   if(!h.current(s)||s.detail?.settlement.id!==parent)return true;
   if(result.check?.snapshot_id!==s.snapshot.id||a==='retry-check'&&(result.check.operation_id!==op.id||result.check.attempt_id!==attempt.id))throw Error('refundFinance.changed');
   if(a==='check')s.financeCheck=result.check;
   s.financeForm={kind:a==='check'?'authorize':'retry',check:result.check,amount:a==='check'?s.snapshot.breakdown.refund_minor:result.check.amount_minor,operationId:op?.id,attemptId:attempt?.id,revision:attempt?.revision,notes:'',confirmed:false};
  }
  if(a==='execute'){
   const authorization=d.authorizations.find(x=>x.id===target.dataset.authorization&&x.snapshot_id===s.snapshot.id);if(!authorization)throw Error('refundFinance.changed');
   s.financeForm={kind:'execute',authorizationId:authorization.id,amount:d.operations.filter(o=>o.authorization_id===authorization.id&&o.status==='reserved').reduce((n,o)=>n+outstanding(d,o),0),confirmed:false};
  }
  if(['refresh','reconcile'].includes(a)){
   if(!op)throw Error('refundFinance.changed');s.financeForm=null;
   const result=await cloud.request(base+`/financial-operations/${op.id}/${a}`,cloud.json({}));
   if(h.current(s)&&s.detail?.settlement.id===parent){s.financeData=validate(s,result);s.detail.settlement=result.settlement;s.financeNotice=t(result.reconciliation?.attribution==='unresolved'||result.reconciliation?.attribution==='ambiguous'?'reviewNeeded':'consulted');}
  }
  if(['replay','external'].includes(a)){
   if(!attempt)throw Error('refundFinance.changed');
   const receipt=a==='external'?d.receipts.find(r=>r.id===target.dataset.receipt&&r.payment_id===op.payment_id):null;
   if(a==='external'&&!receipt)throw Error('refundFinance.changed');
   s.financeForm={kind:a,operationId:op.id,attemptId:attempt.id,revision:attempt.revision,receiptId:receipt?.id,refundId:receipt?.refund_id,amount:a==='external'?receipt.amount_minor:attempt.amount_minor,notes:'',confirmed:false};
  }
 }catch(error){if(h.current(s)){s.financeError=financeError(error);s.financeForm=null;}}
 return true;
}
export async function financialSubmit(s,cloud,form,h){
 if(form.dataset.refundForm==='finance-resume'){
  if(!new FormData(form).get('confirmed')||!isFinancialAction(s.pending?.action)||!s.pendingBody)throw Error('refundFinance.confirmRequired');
  await h.resend(s);return true;
 }
 if(form.dataset.refundForm!=='finance')return false;
 const f=s.financeForm;
 if(!f?.confirmed||f.kind!=='execute'&&!f.notes?.trim())throw Error('refundFinance.confirmRequired');
 const body={confirmed:true};
 if(f.kind!=='execute')Object.assign(body,{expected_snapshot_id:s.snapshot.id,notes:f.notes.trim()});
 if(['authorize','retry'].includes(f.kind))Object.assign(body,{check_id:f.check.id,digest:f.check.digest});
 if(['retry','external','replay'].includes(f.kind))Object.assign(body,{attempt_id:f.attemptId,expected_revision:f.revision});
 if(f.kind==='external')body.receipt_id=f.receiptId;
 if(f.check&&Date.parse(f.check.expires_at)<=Date.now())throw Error('refundFinance.expired');
 const action={authorize:'finance-authorize',execute:'finance-execute',retry:'finance-retry',external:'finance-external',replay:'finance-replay'}[f.kind];
 await h.write(s,action,body,{operationId:f.operationId,authorizationId:f.authorizationId});return true;
}
