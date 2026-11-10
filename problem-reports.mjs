// Report a problem, freelancer side: the client's complaints about paid addenda, shown above the project's PayPal disputes
// and in the home warning. The freelancer replies here; only the client closes a report. Nothing here moves money.
import {uiText,uiLocale} from './i18n.mjs';
import {icon} from './icons.mjs';
const t=(key,values)=>uiText(['problems',key].join('.'),values);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const REASONS=['not_received','not_as_agreed','quality','other'];
const STATUSES=['open','resolved','unresolved'];
const known=(list,value)=>list.includes(value)?value:list.at(-1);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const date=(value,withTime=false)=>{const d=new Date(value);return Number.isFinite(d.getTime())?new Intl.DateTimeFormat(uiLocale(),withTime?{dateStyle:'medium',timeStyle:'short'}:{dateStyle:'medium'}).format(d):'';};

export function validateProblemAttention(value){
 if(!value||!Array.isArray(value.reports))throw new Error('Invalid problem reports');
 if(value.reports.some(r=>!r||!UUID.test(r.report_id||'')||!UUID.test(r.project_id||'')||typeof r.client_id!=='string'||typeof r.project_name!=='string'||typeof r.your_turn!=='boolean'))throw new Error('Invalid problem reports');
 return value;
}
export function validateProjectProblems(value){
 if(!value||!Array.isArray(value.reports))throw new Error('Invalid problem reports');
 for(const r of value.reports)if(!r||!UUID.test(r.id||'')||typeof r.notes!=='string'||!Array.isArray(r.messages)||typeof r.your_turn!=='boolean')throw new Error('Invalid problem reports');
 return value;
}
// Rows for the home warning, in the same list as the open disputes so there is one warning, not two.
export function problemAttentionRows(reports){
 return reports.map(r=>`<li><div><strong>${esc(r.project_name)}</strong><span>${t('attention.kind')} · ${esc(t(`reason.${known(REASONS,r.reason)}`))}</span><span class="dispute-due">${icon('messages-square')}${t(r.your_turn?'attention.yourTurn':'attention.waiting')}</span></div><button type="button" class="button ${r.your_turn?'':'secondary'}" data-problem-attention-open="${esc(r.report_id)}" aria-label="${esc(t('attention.openFor',{project:r.project_name}))}">${t('attention.open')}${icon('arrow-right')}</button></li>`).join('');
}
export function problemAttentionHeading(reports){
 const yours=reports.filter(r=>r.your_turn).length;
 return {title:t(reports.length===1?'attention.titleOne':'attention.titleMany',{count:reports.length}),copy:t(yours?'attention.copyYourTurn':'attention.copyWaiting',{count:yours})};
}
const badge=r=>r.status==='open'?(r.your_turn?['review','badgeYourTurn']:['','badgeWaiting']):[r.status==='resolved'?'ok':'',`status.${known(STATUSES,r.status)}`];
export function renderProblemReport(r){
 const [tone,key]=badge(r);
 return `<article class="workspace-panel dispute-card problem-card" data-problem-report="${esc(r.id)}"><header><span class="dispute-icon" aria-hidden="true">${icon('flag')}</span><div><small>${t('kind')}${r.stage_position?` · ${esc(t('stage',{number:r.stage_position,title:r.stage_title||''}))}`:r.revision_no?` · v${esc(r.revision_no)}`:''} ·${esc(date(r.created_at))}</small><h3>${esc(t(`reason.${known(REASONS,r.reason)}`))}</h3></div><span class="badge ${tone}">${t(key)}</span></header>
 <p class="problem-notes">${esc(r.notes)}</p>
 <div class="dispute-next"><p>${t(r.status==='open'?(r.your_turn?'next.yourTurn':r.request_document_id&&!r.messages.some(m=>m.author==='freelancer')?'next.registered':'next.waiting'):`next.${known(STATUSES,r.status)}`)}</p><button type="button" class="button ${r.your_turn?'':'secondary'}" data-problem-open="${esc(r.id)}" aria-haspopup="dialog">${icon('messages-square')}${t(r.status==='open'?'reply':'view',{count:r.messages.length+1})}</button></div></article>`;
}
// Open items first; closed ones stay one click away, so the count and the screen show only what needs attention.
export function closedSection(items,open,render,attr){
 if(!items.length)return '';
 return `<div class="dispute-closed"><button type="button" class="text-button" ${attr} aria-expanded="${open}">${icon(open?'chevron-down':'chevron-right')}${t(open?'closedHide':'closedShow',{count:items.length})}</button>${open?items.map(render).join(''):''}</div>`;
}
export function renderProblemConversation(r){
 const item=(author,body,at)=>`<li class="is-${author==='client'?'buyer':'seller'}"><small>${t(`by.${author==='client'?'client':'you'}`)}${at?` · ${esc(date(at,true))}`:''}</small><p>${esc(body)}</p></li>`;
 const list=[item('client',r.notes,r.created_at),...r.messages.map(m=>item(m.author,m.body,m.created_at))].join('');
 // New work goes through the usual request: its own addendum, acceptance and payment. The report stays open for the client to close.
 const request=r.request_document_id?`<p class="problem-registered" role="status">${icon('check')}<span>${t('registered')}</span></p>`
  :r.status==='open'?`<div class="problem-register"><p class="dispute-muted">${t('registerHint')}</p><button type="button" class="button secondary" data-problem-register="${esc(r.id)}">${icon('file-up')}${t('register')}</button><p class="cloud-error" role="alert" data-problem-register-error></p></div>`:'';
 const compose=r.status==='open'?`${request}<form class="problem-reply" data-problem-reply-form="${esc(r.id)}"><label class="field" for="problem-reply-text">${t('replyLabel')}</label><textarea class="context-box" id="problem-reply-text" rows="4" maxlength="4000" data-problem-reply-text></textarea><p class="cloud-error" role="alert" data-problem-reply-error></p><p class="dispute-muted">${t('replyNote')}</p><footer><button type="submit" class="button">${t('send')}</button></footer></form>`:`${request}<p class="dispute-muted">${t(`next.${known(STATUSES,r.status)}`)}</p>`;
 return `<header><h2 id="problem-conversation-title">${t('conversationTitle')}</h2><button type="button" class="text-button" data-docs-close aria-label="${uiText('Cerrar')}" title="${uiText('Cerrar')}">${icon('x')}</button></header><div class="problem-conversation"><ol class="dispute-messages">${list}</ol>${compose}</div>`;
}

export function installProblemReports(cloud){
 const states=new Map();
 const key=project=>`${cloud.navigationOwner}:${project}`;
 async function load(state,project){
  state.loading=true;state.error='';
  try{state.data=validateProjectProblems(await cloud.request(`/api/v1/projects/${encodeURIComponent(project)}/problem-reports`));}
  catch{state.error=t('error');}
  finally{state.loading=false;if(cloud.projectId===project)cloud.notify();}
 }
 function stateOf(project){
  let state=states.get(key(project));
  if(!state){state={loading:false,data:null,error:''};states.set(key(project),state);void load(state,project);}
  return state;
 }
 // For the switch between PayPal disputes and client problems: how many, and whether one waits for the freelancer.
 cloud.problemReportsSummary=function(project){
  const state=stateOf(project),reports=state.data?.reports||[];
  return {count:reports.filter(r=>r.status==='open').length,yourTurn:reports.some(r=>r.your_turn),loading:state.loading&&!state.data,error:!!state.error};
 };
 // The "Client problems" view of the project's Disputes tab.
 cloud.problemReportsMarkup=function(project){
  const state=stateOf(project);
  if(state.error)return `<p class="cloud-error" role="alert">${esc(state.error)}</p>`;
  if(state.loading&&!state.data)return `<p class="dispute-muted" role="status">${t('loading')}</p>`;
  const reports=state.data?.reports||[];
  if(!reports.length)return `<section class="workspace-panel dispute-empty">${icon('messages-square')}<div><h3>${t('emptyTitle')}</h3><p>${t('emptyCopy')}</p></div></section>`;
  const open=reports.filter(r=>r.status==='open'),closed=reports.filter(r=>r.status!=='open');
  return `<section class="problem-reports" aria-label="${t('title')}">${open.length?open.map(renderProblemReport).join(''):`<p class="dispute-muted">${t('noneOpen')}</p>`}${closedSection(closed,!!state.showClosed,renderProblemReport,'data-problem-closed-toggle')}</section>`;
 };
 cloud.forgetProblemReports=project=>states.delete(key(project));
 function openConversation(button){
  const project=cloud.projectId,state=states.get(key(project));
  const report=state?.data?.reports.find(r=>r.id===button.dataset.problemOpen);if(!report)return;
  const dialog=cloud.document.createElement('dialog');dialog.className='dispute-docs-dialog dispute-side-dialog problem-side-dialog';dialog.setAttribute('aria-labelledby','problem-conversation-title');
  const close=()=>{dialog.close();dialog.remove();if(button.isConnected)button.focus();};
  const paint=r=>{dialog.innerHTML=renderProblemConversation(r);};
  paint(report);
  dialog.addEventListener('click',event=>{
   if(event.target.closest('[data-docs-close]')||event.target===dialog){close();return;}
   const register=event.target.closest('[data-problem-register]');
   if(register)void registerAsRequest(register,project,state,report,close);
  });
  dialog.addEventListener('submit',async event=>{
   event.preventDefault();
   const form=event.target,text=form.querySelector('[data-problem-reply-text]').value.trim(),error=form.querySelector('[data-problem-reply-error]'),send=form.querySelector('button[type="submit"]');
   if(!text){error.textContent=t('replyRequired');return;}
   send.disabled=true;error.textContent='';
   try{
    const result=validateProjectProblems(await cloud.request(`/api/v1/projects/${encodeURIComponent(project)}/problem-reports/${encodeURIComponent(report.id)}/messages`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({body:text})}));
    state.data=result;cloud.notify();
    const fresh=result.reports.find(r=>r.id===report.id);if(fresh)paint(fresh);
   }catch(failure){
    // The client may have closed it meanwhile: read it again instead of keeping a stale form.
    if(failure.code==='PROBLEM_CLOSED'){close();void load(state,project);return;}
    error.textContent=t('replyError');send.disabled=false;
   }
  });
  cloud.document.body.append(dialog);dialog.showModal();dialog.querySelector('[data-problem-reply-text]')?.focus();
 }
 // Reuses the usual «Register client request» form, with the report as its PDF. Only once that request is saved is it linked.
 async function registerAsRequest(button,project,state,report,closeConversation){
  const error=button.parentElement.querySelector('[data-problem-register-error]');error.textContent='';
  if(cloud.requestStatus?.can_register!==true){
   error.textContent=uiText(cloud.requestStatus?.can_register===false?"Este proyecto ya tiene un pedido abierto. Termínalo o ciérralo antes de registrar otro.":"Estamos comprobando los pedidos del proyecto. Vuelve a intentar en unos momentos.");
   return;
  }
  button.disabled=true;
  let blob;
  try{blob=await cloud.request(`/api/v1/projects/${encodeURIComponent(project)}/problem-reports/${encodeURIComponent(report.id)}/request-pdf`,{},true);}
  catch{error.textContent=t('registerError');button.disabled=false;return;}
  closeConversation();
  const follow=async documentId=>{
   await cloud.request(`/api/v1/projects/${encodeURIComponent(project)}/problem-reports/${encodeURIComponent(report.id)}/request`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({document_id:documentId})});
   states.delete(key(project));
  };
  cloud.afterRequestSaved=follow;
  cloud.openSource('request');
  const modal=cloud.modal,form=modal?.querySelector('[data-cloud-form="upload"]');
  // The form may not open (for example, the initial agreement is not ready yet): then nothing waits for it.
  if(!modal?.open||!form){if(cloud.afterRequestSaved===follow)cloud.afterRequestSaved=null;return;}
  modal.addEventListener('close',()=>{if(cloud.afterRequestSaved===follow)cloud.afterRequestSaved=null;},{once:true});
  form.querySelector('input[name="title"]').value=t('requestTitle',{reason:t(`reason.${known(REASONS,report.reason)}`)});
  const files=new DataTransfer();files.items.add(new File([blob],`client-report-${report.id.slice(0,8)}.pdf`,{type:'application/pdf'}));
  form.querySelector('input[name="file"]').files=files.files;
 }
 cloud.document.addEventListener('click',event=>{
  const open=event.target.closest?.('[data-problem-open]');
  if(open){openConversation(open);return;}
  if(event.target.closest?.('[data-problem-closed-toggle]')&&cloud.projectId){const state=states.get(key(cloud.projectId));if(state){state.showClosed=!state.showClosed;cloud.notify();}}
 });
}
