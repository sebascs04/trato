import {uiText,uiLocale,uiLanguage} from './i18n.mjs';
import {icon} from './icons.mjs';
const t=(key,values)=>uiText(`initialPayment.${key}`,values);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=value=>new Intl.NumberFormat(uiLocale(),{style:'currency',currency:'USD'}).format(value/100);
export function initialAmount(value){
 if(typeof value!=='string'||!/^\d{1,9}(\.\d{1,2})?$/.test(value))throw Error(t('invalidAmount'));
 const [whole,decimal='']=value.split('.'),minor=Number(whole)*100+Number(decimal.padEnd(2,'0'));
 if(!Number.isSafeInteger(minor)||minor<1||minor>99999999999)throw Error(t('invalidAmount'));
 return minor;
}
export function initialLabel(status){return t(status==='completed'?'paid':status==='creating'?'preparing':'pending');}
export function installInitialPayments(cloud){
 const document=cloud.document,states=new Map();
 const owner=()=>cloud.navigationOwner||'';
 const scope=()=>cloud.active&&owner()&&cloud.projectId?owner()+':'+cloud.projectId:null;
 const request=(project,tail='',options={})=>cloud.request(`/api/v1/projects/${encodeURIComponent(project)}/initial-checkout${tail}`,options);
 const current=key=>scope()===key;
 const stateFor=key=>{if(!states.has(key))states.set(key,{status:'idle',pay:null,plan:null,busy:false});return states.get(key);};
 const errorText=error=>{const code=error.code||'';const known={INITIAL_PAYER_MISMATCH:'payerMismatch',INITIAL_PAYMENT_BUSY:'busy',INITIAL_PAYMENT_EXCEEDS_BUDGET:'budgetExceeded',INITIAL_PAYMENT_ALREADY_RECEIVED:'alreadyPaid',INITIAL_PAYMENT_ALREADY_CREATED:'alreadyPrepared',GMAIL_NOT_CONNECTED:'connectMail',EMAIL_DELIVERY_UNCERTAIN:'emailUncertain',INITIAL_ORDER_RECONCILIATION_REQUIRED:'orderUncertain',PROJECT_NOT_ACTIVE:'closed'};return known[code]?t(known[code]):t('error')+(code?' ('+code+')':'');};
 const when=value=>new Intl.DateTimeFormat(uiLocale(),{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
 function render(host,plan){
  const key=scope();if(!key||!host?.isConnected)return;
  const state=stateFor(key);if(plan)state.plan=plan;
  host.querySelector('[data-initial-card]')?.remove();
  const box=document.createElement('section');box.className='workspace-panel initial-payment';box.dataset.initialCard=key;host.append(box);
  const p=state.pay;
  box.innerHTML=`<header class="initial-payment-heading"><div><span class="eyebrow">PayPal Sandbox</span><h3>${t('title')}</h3></div>${p?`<span class="initial-payment-badge ${p.status==='completed'?'is-paid':''}">${initialLabel(p.status)}</span>`:''}</header>${state.status==='loading'?`<p role="status">${t('loading')}</p>`:state.status==='failed'?`<p class="cloud-error" role="alert">${esc(state.error)}</p><button class="button secondary" data-initial-action="reload">${t('retry')}</button>`:!p?`<p>${t('intro')}</p><button class="button" data-initial-action="review">${icon('wallet')}${t('review')}</button>`:`<div class="initial-payment-amount"><strong>${money(p.amount_minor)}</strong><span>${p.paid_at?when(p.paid_at):t('initial')}</span></div><p class="initial-payment-conditions">${esc(p.conditions)}</p><div class="initial-payment-actions">${p.status!=='completed'?`<button class="button secondary" data-initial-action="reconcile">${icon('refresh-cw')}${t(p.order_id?'verify':'retryOrder')}</button>${p.order_id?`<button class="button" data-initial-action="preview" ${p.mail_status==='sent'||p.mail_status==='sending'||p.mail_status==='uncertain'?'disabled':''}>${icon('mail')}${t(p.mail_status==='sent'?'sent':p.mail_status==='sending'||p.mail_status==='uncertain'?'mailUncertain':'send')}</button><button class="text-button" data-initial-action="copy">${icon('copy')}${t('copy')}</button>`:''}`:`<p class="initial-payment-confirmation">${icon('check')}${t('verified')}</p>`}</div>${p.events?.length?`<details class="initial-payment-history"><summary>${t('history')}</summary><ol>${p.events.map(e=>`<li><span>${t('event.'+e.kind)}</span><time>${when(e.created_at)}</time></li>`).join('')}</ol></details>`:''}`}
  <p class="cloud-error" data-initial-error role="alert">${state.error?esc(state.error):p?.last_error?esc(errorText({code:p.last_error})):''}</p><p data-initial-notice role="status"></p>`;
  if(state.busy)box.querySelectorAll('button').forEach(b=>b.disabled=true);
  if(state.status==='idle')void load(key,cloud.projectId,host);
 }
 async function load(key,project,host){
  const state=stateFor(key);state.status='loading';render(host);
  try{const p=await request(project);if(!current(key)){state.status='idle';return;}state.pay=p;state.status='ready';state.error='';}
  catch(error){if(!current(key)){state.status='idle';return;}state.status='failed';state.error=errorText(error);}
  if(current(key)&&host.isConnected)render(host);
 }
 cloud.renderInitialPayment=render;
 function review(key,project,state){
  const first=state.plan?.stages?.[0];const amount=first?.amount??'';
  cloud.show(t('review'),`<form data-initial-form="prepare" data-initial-scope="${esc(key)}"><p class="initial-payment-intro">${t('reviewIntro')}</p><div class="initial-payment-fields"><label class="field">${t('amount')}<input class="context-box" name="amount" inputmode="decimal" type="text" required value="${esc(amount)}" autocomplete="off"></label><label class="field">${t('conditions')}<textarea class="context-box" name="conditions" rows="4" maxlength="2000" required>${esc(first?.payment_condition||'')}</textarea></label></div><p class="cloud-error" role="alert" data-initial-form-error></p><div class="dialog-actions"><button class="button secondary" type="button" data-cloud-close>${t('cancel')}</button><button class="button" type="submit">${t('prepare')}</button></div></form>`);
 }
 async function preview(key,project){
  const value=await request(project,'/email-preview');if(!current(key))return;
  cloud.show(t('sendTitle'),`<form data-initial-form="send" data-initial-scope="${esc(key)}" data-initial-digest="${esc(value.digest)}"><dl class="initial-payment-recipient"><div><dt>${t('to')}</dt><dd>${esc(value.recipient)}</dd></div><div><dt>${t('subject')}</dt><dd>${esc(value.subject)}</dd></div></dl><div class="initial-payment-mail">${esc(value.body)}</div><p class="cloud-error" role="alert" data-initial-form-error></p><div class="dialog-actions"><button class="button secondary" type="button" data-cloud-close>${t('cancel')}</button><button class="button" type="submit">${icon('mail')}${t('sendConfirm')}</button></div></form>`);
 }
 document.addEventListener('click',async event=>{
  const button=event.target.closest('[data-initial-action]');if(!button)return;
  const card=button.closest('[data-initial-card]'),key=card?.dataset.initialCard;if(!key||!current(key))return;
  const project=cloud.projectId,state=stateFor(key),host=card.parentElement;if(state.busy)return;
  state.error='';const action=button.dataset.initialAction;
  if(action==='review'){
   state.busy=true;
   try{if(!state.plan){try{state.plan=await cloud.request(`/api/v1/ai/projects/${encodeURIComponent(project)}/plan`);}catch(error){if(error.code!=='AI_PLAN_NOT_FOUND')throw error;}}if(current(key))review(key,project,state);}
   catch(error){state.error=errorText(error);}
   finally{state.busy=false;if(current(key)&&host.isConnected)render(host);}return;
  }
  if(action==='reload'){state.status='idle';render(host);return;}
  state.busy=true;render(host);
  try{
   if(action==='reconcile'){state.pay=await request(project,'/reconcile',cloud.json({}));}
   if(action==='preview')await preview(key,project);
   if(action==='copy'){await navigator.clipboard.writeText(state.pay.checkout_url);if(current(key))host.querySelector('[data-initial-notice]').textContent=t('copied');}
  }catch(error){if(current(key))state.error=errorText(error);}
  finally{state.busy=false;if(current(key)&&host.isConnected){render(host);if(action==='copy'&&!state.error)host.querySelector('[data-initial-notice]').textContent=t('copied');}}
 });
 document.addEventListener('submit',async event=>{
  const form=event.target.closest('[data-initial-form]');if(!form)return;event.preventDefault();
  const key=form.dataset.initialScope;if(!current(key))return;const state=stateFor(key),project=cloud.projectId;if(state.busy)return;
  state.busy=true;form.querySelectorAll('button').forEach(b=>b.disabled=true);const errorBox=form.querySelector('[data-initial-form-error]');errorBox.textContent='';
  try{
   if(form.dataset.initialForm==='prepare'){
    const values=new FormData(form),amount=initialAmount(values.get('amount')),conditions=String(values.get('conditions')).trim();
    if(!conditions)throw Error(t('conditionsRequired'));
    const storage='trato:initial-payment:'+key;let id=sessionStorage.getItem(storage);if(!id){id=crypto.randomUUID();sessionStorage.setItem(storage,id);}
    const body={amount_minor:amount,conditions,output_language:uiLanguage(),confirmed:true};
    state.pay=await request(project,'',{...cloud.json(body),headers:{'Content-Type':'application/json','Idempotency-Key':id}});
   }else state.pay=await request(project,'/email',cloud.json({digest:form.dataset.initialDigest,confirmed:true}));
   if(current(key)){cloud.modal.close();const card=document.querySelector('[data-initial-card]');if(card)render(card.parentElement);}
  }catch(error){if(current(key)&&form.isConnected)errorBox.textContent=error.code?errorText(error):error.message;}
  finally{state.busy=false;if(current(key)){form.querySelectorAll('button').forEach(b=>b.disabled=false);const card=document.querySelector('[data-initial-card]');if(card)render(card.parentElement);}}
 });
}
