import {rateMinor} from './change-proposal-assistant.mjs';
import {agentShell, createAgentPanel} from './agent-panel.mjs';
import {renderAIActivity} from './ai-activity.mjs';
import {uiLanguage, uiLocale, uiText} from './i18n.mjs';

const t=(key,params)=>uiText(`changeReply.${key}`,params);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// Word-level comparison: removed words are marked on the earlier side, added words on the new side.
export function wordDiff(before,after){
 const a=String(before??'').split(/\s+/).filter(Boolean),b=String(after??'').split(/\s+/).filter(Boolean);
 if(a.length*b.length>250000)return {left:esc(before),right:esc(after)};
 const dp=Array.from({length:a.length+1},()=>new Uint16Array(b.length+1));
 for(let i=a.length-1;i>=0;i--)for(let j=b.length-1;j>=0;j--)dp[i][j]=a[i]===b[j]?dp[i+1][j+1]+1:Math.max(dp[i+1][j],dp[i][j+1]);
 const left=[],right=[];let i=0,j=0;
 while(i<a.length||j<b.length){
  if(i<a.length&&j<b.length&&a[i]===b[j]){left.push(esc(a[i]));right.push(esc(b[j]));i++;j++;}
  else if(j<b.length&&(i===a.length||dp[i][j+1]>=dp[i+1][j])){right.push(`<ins>${esc(b[j])}</ins>`);j++;}
  else{left.push(`<del>${esc(a[i])}</del>`);i++;}
 }
 return {left:left.join(' ').replace(/<\/del> <del>/g,' '),right:right.join(' ').replace(/<\/ins> <ins>/g,' ')};
}

// Sent version on the left, this version on the right; only the fields that changed are listed.
export function renderRevisionComparison(previous, next){
 if(!previous)return '';
 const currency=new Intl.NumberFormat(uiLocale(),{style:'currency',currency:'USD'});
 const date=new Intl.DateTimeFormat(uiLocale(),{dateStyle:'medium',timeZone:'UTC'});
 const price=value=>Number.isSafeInteger(value)?currency.format(value/100):t('pending');
 const deadline=value=>value&&Number.isFinite(Date.parse(value))?date.format(new Date(value)):t('pending');
 const norm=value=>String(value??'').replace(/\s+/g,' ').trim();
 const rows=[];
 for(const [key,label] of [['scope_summary',uiText("Alcance del cambio")],['conditions',uiText("Condiciones")],['description',uiText("Detalle del adicional")]]){
  if(next[key]===undefined||previous[key]===undefined||norm(previous[key])===norm(next[key]))continue;
  const d=wordDiff(norm(previous[key]),norm(next[key]));rows.push([label,d.left||'—',d.right||esc(t('pending'))]);
 }
 if(previous.additional_minor!==next.additional_minor)rows.push([t('amount'),esc(price(previous.additional_minor)),`<ins>${esc(price(next.additional_minor))}</ins>`]);
 if(previous.deadline!==next.deadline)rows.push([t('deadline'),esc(deadline(previous.deadline)),`<ins>${esc(deadline(next.deadline))}</ins>`]);
 const sent=t('sentVersion',{version:previous.revision_no}),current=t('thisVersion');
 return `<section class="change-revision-comparison">
  <h4>${t('compare',{version:previous.revision_no})}</h4>
  ${rows.length?`<div class="proposal-compare-head" aria-hidden="true"><span>${sent}</span><span>${current}</span></div>${rows.map(([label,left,right])=>`<section class="proposal-compare-field"><h3>${label}</h3><div class="proposal-compare-columns"><div><small>${sent}</small><p>${left}</p></div><div><small>${current}</small><p>${right}</p></div></div></section>`).join('')}`:`<p class="cloud-notice">${t('noChanges',{version:previous.revision_no})}</p>`}
 </section>`;
}

function renderReplyDraft(result){
 const draft=result.draft;
 const base=result.base_amount_minor;
 const format=new Intl.NumberFormat(uiLocale(),{style:'currency',currency:'USD'});
 return `<form class="change-reply-draft" data-change-reply-draft>
  <h4>${t('proposedTerms')}</h4>
  <label class="field">${t('revised')}<textarea class="context-box" name="scope" rows="4" maxlength="12000" required>${esc(draft.scope_summary)}</textarea></label>
  <label class="field">${t('conditions')}<textarea class="context-box" name="conditions" rows="3" maxlength="12000">${esc(draft.conditions)}</textarea></label>
  <label class="field">${t('extraWork')}<textarea class="context-box" name="description" rows="2" maxlength="1000" required>${esc(draft.description)}</textarea></label>
  <div class="change-reply-term-grid">
   <label class="field">${t('totalUsd')}<input class="context-box" name="amount" inputmode="decimal" required value="${(result.proposed_amount_minor/100).toFixed(2)}"></label>
   <label class="field">${t('deadline')}<input class="context-box" name="deadline" type="date" max="9999-12-31" required value="${esc(result.proposed_deadline)}"></label>
  </div>
  <p class="change-reply-hint">${t('priceBreakdown',{base:format.format(base/100),extra:format.format(draft.estimated_extra_minor/100)})} ${t(draft.deadline_basis||'needs_confirmation')}</p>
  ${draft.estimated_extra_hours!=null?`<p class="change-reply-hint">${t('estimatedHours',{hours:new Intl.NumberFormat(uiLocale(),{maximumFractionDigits:2}).format(Number(draft.estimated_extra_hours))})}</p>`:''}
  <p class="cloud-error" data-change-reply-form-error role="alert" hidden></p>
  <button type="submit" class="button">${t('apply')}</button>
 </form>`;
}

export function installChangeReplyAssistant(cloud, {apply, reviewAcceptance}){
 let state=null;
 function clear(){if(state)clearTimeout(state.timer);state=null;}
 const panel=createAgentPanel({cloud,id:'change-reply-title',className:'change-reply-agent',onClose:clear});
 const current=s=>state===s&&cloud.active&&s.owner===cloud.navigationOwner&&s.project===cloud.projectId&&
  s.revision===cloud.proposalDetails?.revision.id&&s.proposal===cloud.proposalDetails?.proposal.id;
 function render(s){
  if(!current(s))return;
  const {result,error}=s;
  const content=error?`<div class="case-agent-error"><p role="alert">${t(error==='CHANGE_REPLY_OUTDATED'?'outdated':error==='CHANGE_REPLY_UNAVAILABLE'||error==='AI_CONTEXT_CHANGED'?'unavailable':'error')}</p>
   ${error==='CHANGE_REPLY_UNAVAILABLE'||error==='AI_CONTEXT_CHANGED'?'':`<button type="button" class="button secondary" data-change-reply="retry">${uiText("Reintentar")}</button>`}</div>`
   :result?`<section class="change-draft-result">
    <h3>${t(result.classification)}</h3><p>${esc(result.summary)}</p>
    ${result.analysis?`<p class="change-reply-analysis">${esc(result.analysis)}</p>`: ''}
    <div class="project-assistant-source"><strong>${t('evidence')}</strong><blockquote>${esc(result.quote)}</blockquote></div>
    ${result.draft?renderReplyDraft(result):result.classification==='acceptance'?`<div class="change-draft-result">
     <p>${t('acceptanceHelp')}</p>
     <button type="button" class="button" data-change-reply="accept">${uiText("Registrar aceptación recibida →")}</button>
    </div>`:''}
   </section>`:renderAIActivity({label:t('working')});
  panel.render(agentShell({id:'change-reply-title',title:t('title'),label:t('title'),closeLabel:uiText("Cerrar"),
   content,composer:`<div class="case-agent-composer"><small>${t('emailOnly')}</small></div>`}));
 }
 async function fetchJob(s, start){
  if(!current(s)||s.fetching)return;
  s.fetching=true;s.error=null;render(s);
  try{
   const job=start
    ? await cloud.request(s.path,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':s.id},body:JSON.stringify({revision_id:s.revision,output_language:s.language})})
    : await cloud.request(`/api/v1/ai/change-replies/${s.id}`);
   if(!current(s))return;
   if(job.id!==s.id)throw Error('AI_INVALID_RESPONSE');
   s.submitted=true;
   if(job.status==='queued'||job.status==='running'){
    s.timer=setTimeout(()=>fetchJob(s,false),1200);return;
   }
   if(job.status==='failed'){s.failed=true;s.error=job.error_code||'AI_REQUEST_FAILED';return;}
   const result=job.result;
   if(job.status!=='completed'||result?.proposal_id!==s.proposal||result?.revision_id!==s.revision||result?.message_id!==s.message.id||
      !['acceptance','adjustments','ambiguous'].includes(result.classification))throw Error('AI_INVALID_RESPONSE');
   if(result.draft&&(!Number.isSafeInteger(result.proposed_amount_minor)||!result.analysis)){
    s.failed=true;s.error='CHANGE_REPLY_OUTDATED';return;
   }
   s.result=result;
  }catch(error){
   if(current(s)){
    s.error=error.code||'AI_REQUEST_FAILED';
    if(s.error==='AI_NOT_FOUND')s.failed=true;
   }
  }
  finally{s.fetching=false;if(current(s))render(s);}
 }
 panel.element.addEventListener('click',event=>{
  const action=event.target.closest('[data-change-reply]')?.dataset.changeReply;
  const s=state;if(!action||!s||!current(s))return;
  if(action==='accept'&&s.result?.classification==='acceptance'){
   panel.close();reviewAcceptance(s.message,s.result);
   return;
  }
  if(action==='retry'){
   if(s.failed){s.id=crypto.randomUUID();s.submitted=false;s.failed=false;}
   void fetchJob(s,!s.submitted);
  }
 });
 panel.element.addEventListener('submit',event=>{
  const form=event.target;
  if(!form.matches('[data-change-reply-draft]'))return;
  event.preventDefault();
  const s=state;if(!s||!current(s)||!s.result?.draft)return;
  const error=form.querySelector('[data-change-reply-form-error]');
  try{
   const amountMinor=rateMinor(form.elements.amount.value);
   const [scope,conditions,description]=['scope','conditions','description'].map(name=>form.elements[name].value.trim());
   if(!scope||!description)throw Error('INVALID_TERMS');
   const result={...s.result,draft:{...s.result.draft,scope_summary:scope,conditions,description},
    reviewed_amount_minor:amountMinor,reviewed_deadline:form.elements.deadline.value};
   panel.close();apply(s.message,result);
  }catch{error.textContent=t('invalidTerms');error.hidden=false;}
 });
 const reset=cloud.reset.bind(cloud);
 cloud.reset=function(){panel.close();return reset();};
 return (button,message)=>{
  const {proposal,revision}=cloud.proposalDetails;
  clear();
  // Same analysis for a Gmail reply or a client portal request; only the source of the client text differs.
  const path=`/api/v1/proposals/${proposal.id}/${message.kind==='portal'?'portal-requests':'gmail-replies'}/${message.id}/analysis`;
  state={id:crypto.randomUUID(),owner:cloud.navigationOwner,project:cloud.projectId,proposal:proposal.id,
   revision:revision.id,message,path,language:uiLanguage()};
  render(state);panel.open(button);void fetchJob(state,true);
 };
}
