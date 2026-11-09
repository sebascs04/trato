import {createAgentPanel,agentShell,agentMascot} from './agent-panel.mjs';
import {renderAIActivity,submitChatOnEnter} from './ai-activity.mjs';
import {validateProjectAnswer,projectDocumentError} from './project-assistant.mjs';
import {uiText,uiLanguage,uiLocale} from './i18n.mjs';
import {icon as uiIcon} from './icons.mjs';
import {documentProgressLabel} from './document-progress.mjs';
import {installChangeProposalSteps} from './change-proposal-steps.mjs';
import {renderFileLoading} from './connected-workspace.mjs';
const t=(key,values)=>uiText(`changeDraft.${key}`,values);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function rateMinor(value){const normalized=String(value).trim().replace(',','.');if(!/^\d{1,9}(\.\d{1,2})?$/.test(normalized))throw Error('INVALID_RATE');const [whole,part='']=normalized.split('.');const minor=Number(whole)*100+Number(part.padEnd(2,'0'));if(!Number.isSafeInteger(minor)||minor<0)throw Error('INVALID_RATE');return minor;}
export function validateChangeDraft(result,project,request){if(!result||result.kind!=='change_proposal'||result.project_id!==project||result.request_document_id!==request||!['ready','insufficient_evidence'].includes(result.status)||!Array.isArray(result.citations)||!Array.isArray(result.sources)||!Array.isArray(result.missing_information))throw Error('AI_INVALID_RESPONSE');if(result.status==='ready'&&!result.citations.length)throw Error('AI_INVALID_RESPONSE');for(const citation of result.citations)if(typeof citation.quote!=='string'||!citation.quote.trim()||!result.sources.some(source=>source.source_id===citation.source_id&&source.source_kind==='original'))throw Error('AI_INVALID_RESPONSE');return result;}
// Same rules as the API's calculate_price: hours 0–10000 with up to two decimals, half-up rounding to the cent.
export function priceFor(rate_minor,hoursInput){const hours=String(hoursInput).trim().replace(',','.');if(!Number.isSafeInteger(rate_minor)||rate_minor<0||!/^\d{1,5}(\.\d{1,2})?$/.test(hours))throw Error('INVALID_HOURS');
 const [whole,part='']=hours.split('.'),hundredths=BigInt(whole)*100n+BigInt(part.padEnd(2,'0'));if(hundredths<=0n||hundredths>1000000n)throw Error('INVALID_HOURS');
 const total=(BigInt(rate_minor)*hundredths+50n)/100n;if(total>99999999999n)throw Error('INVALID_AMOUNT');return {additional_minor:Number(total),currency:'USD',rate_minor,confirmed_hours:hours};}
// What the form shows while the user types rate and hours: the price and the amount written into «Adicional».
export function livePrice(result,rate,hours){const price=priceFor(rateMinor(rate),hours);return {price,amount:draftFields(result,price).amount};}
// The date the client asked for in their reply, ready for the freelancer to confirm. Never a past date, which the form rejects.
export function requestedDeadline(result,mode,today){
 const value=result?.suggested_deadline;
 return mode==='revise'&&typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&value>=today?value:null;
}
export function draftFields(result,price){if(result?.kind!=='change_proposal'||result.status!=='ready'||!Number.isSafeInteger(price?.additional_minor)||price.additional_minor<0||price.currency!=='USD')throw Error('AI_INVALID_RESPONSE');for(const key of ['scope_summary','conditions','description'])if(typeof result[key]!=='string')throw Error('AI_INVALID_RESPONSE');return {scope:result.scope_summary,conditions:result.conditions,description:result.description,amount:(price.additional_minor/100).toFixed(2)};}
export function installChangeProposalAssistant(cloud){
 if(cloud.openChangeProposalAssistant)return;
 let state=null,previewUrl=null,previewRun=0;
 // Same look and loading sequence as the main document viewer, in its own dialog so the open proposal form is kept.
 const preview=cloud.document.createElement('dialog');preview.className='cloud-dialog cloud-document-preview';preview.setAttribute('aria-labelledby','change-draft-source-title');cloud.document.body.append(preview);
 function closePreview(){previewRun++;if(preview.open)preview.close();if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl=null;}preview.innerHTML='';}
 preview.addEventListener('cancel',event=>{event.preventDefault();closePreview();});preview.addEventListener('click',event=>{if(event.target.closest('[data-change-draft-preview-close]'))closePreview();});
 function previewSource(s,id){
  const source=s.result?.sources?.find(item=>item.file_id===id)||s.files.find(item=>item.id===id);
  return previewDocument(id,source?.title||t('sources'),source?.original_filename||source?.title||'',()=>current(s));
 }
 // Also used by the saved addendum's TeTrato analysis, so cited sources open the same viewer everywhere.
 cloud.previewCitedDocument=(id,title)=>previewDocument(id,title||t('sources'),title||'');
 async function previewDocument(id,title,filename,alive=()=>true){
  closePreview();const run=previewRun;
  preview.innerHTML=`<div class="upload-modal-header"><div><span class="eyebrow">${uiText("TU ESPACIO EN TRATO")}</span><h2 id="change-draft-source-title">${esc(title)}</h2></div><button type="button" class="close" data-change-draft-preview-close aria-label="${uiText("Cerrar")}" title="${uiText("Cerrar")}">${uiIcon('x')}</button></div><div data-change-preview-body>${renderFileLoading(filename)}</div>`;
  preview.showModal();
  const body=preview.querySelector('[data-change-preview-body]'),live=()=>run===previewRun&&preview.open&&alive();
  try{
   const blob=await cloud.request(`/api/v1/documents/${id}/file`,{},true);if(!live())return;
   if(blob.type.split(';')[0]!=='application/pdf')throw Error(uiText("El servidor no devolvió un documento PDF."));
   previewUrl=URL.createObjectURL(blob);
   body.innerHTML=`<div class="cloud-preview-toolbar"><span>${esc(filename)}</span><a class="text-button" data-preview-download>${uiText("Descargar PDF ↗")}</a></div><div class="cloud-file-preview-stage">${renderFileLoading(filename)}<iframe class="cloud-pdf-frame" title="${uiText("Vista previa del documento PDF")}" aria-busy="true"></iframe></div>`;
   const frame=body.querySelector('iframe'),loading=body.querySelector('[data-file-loading]');
   frame.addEventListener('load',()=>{loading.hidden=true;frame.setAttribute('aria-busy','false');},{once:true});
   frame.src=previewUrl+'#view=FitH';
   const link=body.querySelector('[data-preview-download]');link.href=previewUrl;link.download=filename||'document.pdf';
  }catch(error){if(live())body.innerHTML=`<p class="cloud-error" role="alert">${esc(error?.message||t('error'))}</p>`;}
 }

 const panel=createAgentPanel({cloud,id:'change-draft-title',className:'change-draft-agent',onClose(){if(state)state.open=false;}});
 // Same right-side drawer as the initial plan recommendation: each proposal part opens with its full text.
 const detailPanel=createAgentPanel({cloud,id:'change-detail-title',className:'plan-recommendation-drawer change-detail-drawer'});
 const DETAILS=['scope','conditions','effort','why','sources'];
 function detailRows(result){
  const cited=(result.citations||[]).filter(c=>result.sources?.some(source=>source.source_id===c.source_id)).length;
  return {scope:result.scope_summary,conditions:result.conditions,effort:t('hoursValue',{hours:result.estimated_hours||'—'}),why:result.reasoning,sources:t('sourcesCount',{count:cited})};
 }
 // Like «Recommended order» in the initial plan: one row in the form, the numbered parts in the right drawer.
 function openDetail(s,button){
  const result=s.result;if(result?.status!=='ready')return;
  const rows=detailRows(result),title=t('openProposal');
  // One row per cited document: opening it shows the original PDF; its exact quotes stay underneath.
  const cited=new Map();
  for(const c of result.citations||[]){const source=result.sources?.find(item=>item.source_id===c.source_id);if(!source?.file_id)continue;if(!cited.has(source.file_id))cited.set(source.file_id,{title:source.title,quotes:[]});cited.get(source.file_id).quotes.push(c.quote);}
  const sources=`<ul class="change-cited-sources">${[...cited].map(([id,doc])=>`<li><button type="button" class="change-cited-source" data-change-draft-action="source" data-document-id="${esc(id)}">${uiIcon('file-text')}<span>${esc(doc.title)}</span>${uiIcon('arrow-up-right')}</button><details class="plan-stage-deliverables"><summary>${t('quotesCount',{count:doc.quotes.length})}</summary>${doc.quotes.map(q=>`<blockquote>${esc(q)}</blockquote>`).join('')}</details></li>`).join('')}</ul>`;
  const body=key=>key==='sources'?`<p>${esc(rows.sources)}</p>${sources}`:key==='effort'?`<p>${esc(rows.effort)}</p><p>${esc(result.description)}</p>`:`<p>${esc(rows[key])}</p>`;
  detailPanel.render(`<div class="case-agent-shell"><header class="case-agent-header"><div class="case-agent-heading"><img class="case-agent-mascot" src="/assets/mascot/trato-guide.png" alt="" width="44" height="44"><div><span>TeTrato</span><h2 id="change-detail-title">${esc(title)}</h2></div></div><button type="button" class="case-agent-close" data-agent-close aria-label="${uiText('Cerrar')}" title="${uiText('Cerrar')}">${uiIcon('x')}</button></header><div class="case-agent-chat" data-agent-chat role="region" aria-label="${esc(title)}"><section class="plan-recommended-stages"><ol>${DETAILS.map((key,i)=>`<li><span class="plan-reasoning-number">${i+1}</span><div><header><strong>${t('detail_'+key)}</strong></header>${body(key)}</div></li>`).join('')}</ol></section></div></div>`);
  detailPanel.element.querySelector('[data-agent-chat]').scrollTop=0;detailPanel.open(button);
 }
 const current=s=>state===s&&cloud.active&&cloud.navigationOwner===s.owner&&cloud.projectId===s.project&&cloud.proposalForm===s.formState&&s.form.isConnected;
 const busy=s=>!!s.pending||s.pricing||s.sourcesLoading;
 function clear(){if(state)clearTimeout(state.timer);closePreview();panel.close();detailPanel.close();state=null;}
 function citations(result){return (result?.citations||[]).map(c=>{const source=result.sources?.find(item=>item.source_id===c.source_id);return source?`<article class="project-assistant-source"><button type="button" class="text-button" data-change-draft-action="source" data-document-id="${esc(source.file_id)}">${esc(source.title)}</button><blockquote>${esc(c.quote)}</blockquote></article>`:'';}).join('');}
 // Inline draft inside the proposal form: Trato prepares the terms automatically and the user reviews them.
 function setField(s,name,value,{onlyEmpty=false}={}){const field=s.form.elements.namedItem(name);if(!field||onlyEmpty&&String(field.value||'').trim())return;field.value=value;field.dispatchEvent(new Event('input',{bubbles:true}));}
 function inline(s){
  // While TeTrato reads the client's PDF, the source cannot be swapped underneath the running analysis.
  const analyzing=!!(s.waitingRequest||s.sourcesLoading||s.reusing||s.pending?.mode==='draft');if((s.form.dataset.changeAnalyzing==='true')!==analyzing){s.form.dataset.changeAnalyzing=String(analyzing);s.form.changeSteps?.refresh();}
  const host=s.form.querySelector('[data-change-auto]');if(!host)return;const result=s.result;let html='';const priceHost=s.form.querySelector('[data-change-auto-price]');
  if(s.uploadError)html=`<p class="cloud-error" role="alert">${esc(s.uploadError)}</p><button type="button" class="button secondary" data-change-auto="retry-upload">${t('retry')}</button>`;
  else if(s.waitingRequest){const waiting=requiredIds(s).map(id=>s.files.find(f=>f.id===id)).find(f=>f&&!(f.status==='ready'&&f.summary_status==='ready'));
   html=renderAIActivity({label:t(s.formState.mode==='revise'?'readingAdjustments':'readingRequest'),hint:documentProgressLabel(waiting)||undefined,compact:true});}
  else if(s.requestError)html=`<p class="cloud-error" role="alert">${s.requestError.code==='MODEL_QUOTA_EXCEEDED'?t('requestQuota'):s.requestError.reprocess?t('requestReadFailed'):t('requestNotReady')}</p><button type="button" class="button secondary" data-change-auto="retry-request">${s.requestError.reprocess?t('retryReading'):t('retry')}</button>`;
  else if(s.sourcesLoading||s.reusing||s.pending?.mode==='draft')html=renderAIActivity({label:t('thinking'),compact:true});
  else if(s.sourceError||s.error&&(s.failedMode==='draft'||!result))html=`<p class="cloud-error" role="alert">${s.sourceError?t('documentsError'):projectDocumentError(s.error)||(s.error==='AI_INVALID_CITATION'?uiText('projectAssistant.invalidEvidence'):t('error'))}</p><button type="button" class="button secondary" data-change-auto="retry">${t('retry')}</button>`;
  else if(result?.status==='ready'){
   if(!s.filled){s.filled=true;for(const [name,key] of [['scope','scope_summary'],['conditions','conditions'],['description','description']])if(typeof result[key]==='string')setField(s,name,result[key],{onlyEmpty:s.formState.mode!=='revise'});const requested=requestedDeadline(result,s.formState.mode,new Intl.DateTimeFormat('en-CA',{timeZone:'America/Lima'}).format(new Date()));if(requested)setField(s,'deadline',requested);}
   html=`<div class="plan-reasoning change-reasoning"><div class="plan-reasoning-summary"><img src="/assets/mascot/trato-guide.png" alt="" width="84" height="84"><p>${t('readyIntro')}</p></div><button type="button" class="plan-recommendation-open" data-change-auto="detail" aria-haspopup="dialog">${uiIcon('file-text')}<strong>${t('openProposal')}</strong>${uiIcon('arrow-up-right')}</button><p class="change-auto-note">${t('autoFilled')}</p></div>`;
   if(priceHost)priceHost.innerHTML=`<div class="change-auto-price"><label class="field">${t('rate')}<input class="context-box" name="auto_rate" inputmode="decimal" value="${esc(s.rate)}" ${s.pricing?'disabled':''}></label><label class="field">${t('hours')}<input class="context-box" name="auto_hours" inputmode="decimal" value="${esc(s.hours)}" ${s.pricing?'disabled':''}></label>${s.pricing?renderAIActivity({label:t('calculating'),compact:true}):''}</div>${s.error?`<p class="cloud-error" role="alert">${projectDocumentError(s.error)||t('error')}</p>`:''}`;
  }else if(result)html=`<p>${esc(result.reasoning)}</p>${result.missing_information?.length?`<p>${esc(result.missing_information.join(' '))}</p>`:''}`;
  host.innerHTML=html;s.form.dataset.changeDraftReady=String(result?.status==='ready'&&!busy(s));s.form.changeSteps?.refresh();}
 function render(s){if(!current(s))return;inline(s);if(!s.open)return;
  const ready=s.files.filter(file=>file.summary_status==='ready'),pending=s.files.filter(file=>file.summary_status!=='ready');
  // Sources are not listed here: the assistant uses the project's ready documents automatically (see start()).
  const choice='';
  const result=s.result;
  const proposal=result?`<section class="change-draft-result" data-change-draft-result>
   <h3>${t('proposal')}</h3>
   ${result.status==='ready'?`
    <div class="change-draft-terms">
     <h4>${t('scope')}</h4><p>${esc(result.scope_summary)}</p>
     <h4>${t('conditions')}</h4><p>${esc(result.conditions)}</p>
    </div>
    <section class="change-draft-calculation" aria-label="${t('pricingTitle')}">
     <h4>${t('pricingTitle')}</h4>
     <p class="change-draft-effort">${t('effort',{hours:result.estimated_hours||'—'})}</p>
     <form data-change-draft-price>
      <div class="change-draft-inputs">
       <label class="field">${t('rate')}<input class="context-box" name="rate" inputmode="decimal" required ${s.pricing?'disabled':''} value="${esc(s.rate)}"></label>
       <label class="field">${t('hours')}<input class="context-box" name="hours" inputmode="decimal" required ${s.pricing?'disabled':''} value="${esc(s.hours)}"></label>
      </div>
      <button type="submit" class="button secondary" ${busy(s)?'disabled':''}>${t('calculate')}</button>
     </form>
     ${s.price?`<div class="change-draft-total" data-change-draft-total>
      <p role="status"><span>${t('additionalTotal')}</span><strong>${new Intl.NumberFormat(uiLocale(),{style:'currency',currency:'USD'}).format(s.price.additional_minor/100)}</strong></p>
      <button type="button" class="button" data-change-draft-action="apply" ${busy(s)?'disabled':''}>${t('apply')}</button>
     </div>`:''}
    </section>
    <details class="change-draft-detail" data-agent-source="change-draft-reasoning"><summary>${t('reasoning')}</summary><p>${esc(result.reasoning)}</p></details>
   `:`<p>${esc(result.reasoning)}</p><p>${esc(result.missing_information?.join(' '))}</p>`}
   <details class="change-draft-detail" data-agent-source="change-draft-sources"><summary>${t('sources')}</summary>${citations(result)}</details>
  </section>`:'';
  panel.render(agentShell({id:'change-draft-title',title:t('title'),label:t('conversation'),closeLabel:t('close'),headerActions:'',content:`${s.sourcesLoading?`<p role="status">${t('loadingDocuments')}</p>`:''}${choice}${s.sourceError?`<p class="cloud-error" role="alert">${t('documentsError')}</p><button class="text-button" data-change-draft-action="reload" type="button">${t('retry')}</button>`:''}${!s.messages.length&&!result?`<div class="case-agent-empty">${agentMascot()}<h3>${t('welcome')}</h3><p>${t('hint')}</p></div>`:''}${s.messages.map(m=>`<article class="case-agent-message ${m.user?'is-user':''}"><div class="case-agent-bubble"><p>${esc(m.text)}</p>${m.result?`<details><summary>${t('sources')}</summary>${citations(m.result)}</details>`:''}</div></article>`).join('')}${proposal}${s.pending&&!s.error?renderAIActivity({label:t('thinking'),compact:true}):''}${s.error?`<p class="cloud-error" role="alert">${projectDocumentError(s.error)||(s.error==='AI_INVALID_CITATION'?uiText('projectAssistant.invalidEvidence'):t('error'))}</p>${s.pending||s.failedMode?`<button type="button" class="text-button" data-change-draft-action="retry">${t('retry')}</button>`:''}`:''}`,composer:`<form class="case-agent-composer change-draft-composer" data-change-draft-question><label class="sr-only" for="change-draft-question">${t('question')}</label><textarea id="change-draft-question" class="context-box" name="question" rows="2" maxlength="4000" placeholder="${t('placeholder')}" ${busy(s)?'disabled':''}>${esc(s.question)}</textarea><div class="dialog-actions"><button type="submit" class="button secondary" ${busy(s)?'disabled':''}>${t('ask')}</button><button type="button" class="button" data-change-draft-action="draft" ${busy(s)?'disabled':''}>${t('prepare')}</button></div></form>`}));
 }
 async function load(s){s.sourceError=false;s.sourcesLoading=true;render(s);try{const files=[];let offset=0;do{const value=await cloud.request(`/api/v1/projects/${s.project}/sources?offset=${offset}&limit=100`);if(!current(s))return;if(!Array.isArray(value.files)||!Number.isInteger(value.total))throw Error('AI_INVALID_RESPONSE');files.push(...value.files);offset=value.next_offset;if(files.length>1000||offset!==null&&(!Number.isInteger(offset)||offset<files.length))throw Error('AI_INVALID_RESPONSE');}while(offset!==null);s.files=files;}catch{if(current(s))s.sourceError=true;}finally{s.sourcesLoading=false;render(s);}}
 function accept(s,job){if(!current(s)||job.id!==s.pending.id)return;if(job.status==='completed'){const result=job.result;if(!result||result.project_id!==s.project)throw Error('AI_INVALID_RESPONSE');if(s.pending.mode==='draft'){validateChangeDraft(result,s.project,s.request);s.result=result;s.resultJob=job.id;rememberDraft(s,job.id);s.price=null;s.hours=result.estimated_hours||'';}else{validateProjectAnswer(result,s.project);s.messages.push({text:result.answer,result});s.history.push(job.id);}s.pending=null;s.error='';}else if(job.status==='failed'){s.error=job.error_code||'AI_REQUEST_FAILED';s.question=s.pending.userQuestion||'';s.failedMode=s.pending.mode;s.pending=null;}else if(['queued','running'].includes(job.status))s.timer=setTimeout(()=>poll(s),1500);else throw Error('AI_INVALID_RESPONSE');render(s);}
 async function poll(s){if(!current(s)||!s.pending)return;try{const job=await cloud.request(s.pending.poll);if(current(s)){s.pending.uncertain=false;accept(s,job);}}catch(error){if(current(s)){s.error=error.code||'AI_REQUEST_FAILED';render(s);}}}
 // Like the initial plan: reopening with the same inputs reuses TeTrato's validated proposal instead of asking again.
 const draftKey=s=>`${cloud.session.key}:change-draft:${s.owner}:${s.project}:${s.request}:${s.revision||'new'}`;
 const draftFingerprint=s=>JSON.stringify([s.request,s.revision||null,s.formState.mode==='revise'?[s.formState.feedbackId||null,s.formState.portalRequestId||null,s.feedbackNotes]:null,uiLanguage(),s.selected||null,
  s.files.filter(file=>file.summary_status==='ready').map(file=>file.id+':'+(file.generation||'')).sort()]);
 function rememberDraft(s,jobId){try{cloud.storage.setItem(draftKey(s),JSON.stringify({version:1,job:jobId,fingerprint:s.draftFingerprint||draftFingerprint(s)}));}catch{}}
 async function reuseDraft(s){
  let saved=null;try{saved=JSON.parse(cloud.storage.getItem(draftKey(s))||'null');}catch{}
  const fingerprint=draftFingerprint(s);
  if(saved?.version!==1||typeof saved.job!=='string'||saved.fingerprint!==fingerprint)return false;
  // While the saved proposal is fetched, show the same waiting state instead of an empty section.
  s.reusing=true;render(s);
  try{
   const job=await cloud.request(`/api/v1/ai/change-proposals/${encodeURIComponent(saved.job)}`);
   s.reusing=false;
   if(!current(s))return true;
   if(job?.id!==saved.job||!['queued','running','completed'].includes(job.status))return false;
   // Same inputs: resume that analysis (still running or finished) instead of starting another one.
   s.draftFingerprint=fingerprint;s.pending={id:job.id,mode:'draft',userQuestion:'',body:null,path:'',poll:`/api/v1/ai/change-proposals/${job.id}`,uncertain:false};
   accept(s,job);console.info(job.status==='completed'?'[TeTrato] reused previous proposal':'[TeTrato] resumed running proposal',{job:job.id,status:job.status});
   return !!s.result||!!s.pending;
  }catch(error){
   // The earlier job expired or no longer validates: forget it and analyze again with the current inputs.
   console.info('[TeTrato] previous proposal not reusable',error.code||error.message);try{cloud.storage.removeItem(draftKey(s));}catch{}
   if(current(s)){s.pending=null;s.error='';}return false;
  }finally{s.reusing=false;}
 }
 async function start(s,mode,{repeat=false}={}){if(!current(s)||s.pending||s.pricing)return;if(mode==='draft')s.draftFingerprint=draftFingerprint(s);const question=s.question.trim();if(mode==='question'&&!question)return;s.error='';s.failedMode=null;const readyIds=s.files.filter(file=>file.summary_status==='ready').map(file=>file.id),hasPending=s.files.some(file=>file.summary_status!=='ready');const id=crypto.randomUUID(),selected=s.selected?{document_ids:s.selected}:hasPending&&readyIds.length?{document_ids:readyIds}:{};
  const body=mode==='draft'?{project_id:s.project,request_document_id:s.request,output_language:uiLanguage(),question,history_ids:s.history.slice(-6),...selected,...(s.proposal?{proposal_id:s.proposal,revision_id:s.revision}:{}),...(s.formState.mode==='revise'?(s.formState.portalRequestId?{feedback_portal_request_id:s.formState.portalRequestId}:{feedback_document_id:s.formState.feedbackId,feedback_notes:s.feedbackNotes}):{})}:{project_id:s.project,question:`${t('context',{title:s.requestTitle})}\n${question}`,output_language:uiLanguage(),...(s.resultJob?{change_proposal_job_id:s.resultJob}:{}),...selected};
  s.pending={id,mode,userQuestion:question,body,path:mode==='draft'?'/api/v1/ai/change-proposals':'/api/v1/ai/project-questions',poll:mode==='draft'?`/api/v1/ai/change-proposals/${id}`:`/api/v1/ai/jobs/${id}`,uncertain:true};if(question&&!repeat)s.messages.push({user:true,text:question});s.question='';if(mode==='draft')rememberDraft(s,id);render(s);await submit(s);
 }
 async function submit(s){if(!current(s)||!s.pending||s.submitting)return;s.submitting=true;s.error='';try{const job=await cloud.request(s.pending.path,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':s.pending.id},body:JSON.stringify(s.pending.body)});if(current(s)){s.pending.uncertain=false;accept(s,job);}}catch(error){
  if(current(s)){
   s.error=error.code||'AI_REQUEST_FAILED';
   if(error.status>=400&&error.status<500){
    s.question=s.pending.userQuestion;
    s.failedMode=s.pending.mode;
    s.pending=null;
   }
  }
 }finally{s.submitting=false;render(s);}}
 function newState(form,open){const old=cloud.proposalForm.old;return {project:cloud.projectId,request:cloud.requestId,requestTitle:cloud.documents.find(d=>d.id===cloud.requestId)?.title||'',owner:cloud.navigationOwner,form,formState:cloud.proposalForm,proposal:old?.proposal.id,revision:old?.revision.id,feedbackNotes:form.elements.feedbackNotes?.value.trim()||'',open,files:[],sourceError:false,selected:null,messages:[],history:[],question:'',result:null,pending:null,rate:'',hours:'',price:null,pricing:false,filled:false};}
 cloud.openChangeProposalAssistant=function(button){const form=cloud.modal.querySelector('[data-cloud-form="proposal-terms"]');if(!form||!cloud.proposalForm)return;const previous=state;if(!previous||previous.formState!==cloud.proposalForm){clear();state=newState(form,true);}state.open=true;render(state);panel.open(button);load(state);};
 // A new proposal starts drafted by Trato; every field stays editable and the amount needs the user's rate.
 // TeTrato must read the client's request itself: wait until it is processed instead of drafting without it.
 const requiredIds=s=>[s.request,...(s.formState.mode==='revise'&&!s.formState.portalRequestId?[s.formState.feedbackId]:[])];
 const requestReady=s=>requiredIds(s).every(id=>{const file=s.files.find(f=>f.id===id);return file?.status==='ready'&&file.summary_status==='ready';});
 // A failed reading stops the wait at once and keeps its real error code for the message.
 // extract: the text extraction failed; process: extraction is ready but TeTrato's reading/indexing failed.
 const requestFailure=file=>!file?null:file.extraction_status==='error'?{code:file.extraction_error_code||'',reprocess:'extract'}
  :['index_error','source_error'].includes(file.status)?{code:file.error_code||'',reprocess:file.status==='index_error'?'process':null}:null;
 const fail=(s,code,reprocess,fileId)=>{if(current(s)){s.waitingRequest=false;s.requestError={code,reprocess,fileId};render(s);}};
 // Same explicit reprocessing as Documents: the same original, model and provider; a new failure is shown, never replaced.
 async function retryRequest(s){
  const mode=s.requestError?.reprocess,target=s.requestError?.fileId||s.request;
  console.info('[TeTrato] retry request PDF',{request:s.request,mode,error:s.requestError?.code});
  if(mode){
   s.requestError=null;s.waitingRequest=true;render(s);
   try{
    if(mode==='extract')await cloud.request(`/api/v1/documents/${target}/retry`,{method:'POST'});
    else{
     await cloud.retryDocumentProcessing(target);
     const job=cloud.documentProcessingJobs?.get(`${cloud.navigationOwner}:${cloud.projectId}:${target}`);
     console.info('[TeTrato] reprocess job',job?{id:job.state.id,status:job.state.status,error:job.state.error}:'not started');
     if(!job)return fail(s,'',null,target);
     while(current(s)&&['queued','running'].includes(job.state.status))await new Promise(resolve=>setTimeout(resolve,3000));
     console.info('[TeTrato] reprocess finished',{id:job.state.id,status:job.state.status,error:job.state.error});
     if(!current(s))return;
     if(job.state.status!=='completed')return fail(s,job.state.error||'AI_REQUEST_FAILED','process',target);
    }
   }catch(error){console.warn('[TeTrato] reprocess error',error.code||error.message);return fail(s,error.code||'AI_REQUEST_FAILED',mode,target);}
  }
  await autoDraft(s);
 }
 // Timing log for the wait before drafting: how long each inventory load takes and each required PDF's state.
 const since=s=>Math.round(performance.now()-(s.waitStart??performance.now()))+'ms';
 // While waiting, only the request/adjustment PDFs can change: refresh just those instead of the whole project.
 async function loadRequired(s){
  const ids=requiredIds(s).filter(Boolean);
  try{
   const value=await cloud.request(`/api/v1/projects/${s.project}/sources?limit=100&file_ids=${ids.map(encodeURIComponent).join(',')}`);
   if(!current(s))return;
   if(!Array.isArray(value.files)||value.files.some(file=>!ids.includes(file.id)))throw Error('AI_INVALID_RESPONSE');
   for(const file of value.files){const i=s.files.findIndex(item=>item.id===file.id);if(i<0)s.files.push(file);else s.files[i]=file;}
  }catch{if(current(s)){s.sourceError=true;render(s);}}
 }
 async function timedLoad(s,attempt){
  if(!attempt)s.waitStart=performance.now();
  const started=performance.now();await (attempt&&!s.sourceError?loadRequired(s):load(s));
  console.info('[TeTrato] wait',{attempt,since:since(s),loadMs:Math.round(performance.now()-started),
   files:requiredIds(s).map(id=>{const f=s.files.find(x=>x.id===id);return f?`${id.slice(0,8)} status=${f.status} summary=${f.summary_status} extraction=${f.extraction_status??'-'}`:`${id?.slice(0,8)} missing`;})});
 }
 async function autoDraft(s){
  s.requestError=null;await timedLoad(s,0);
  for(let attempt=0;attempt<120&&current(s)&&!s.sourceError&&!requestReady(s);attempt++){
   const failed=requiredIds(s).map(id=>({id,file:s.files.find(f=>f.id===id)})).find(({file})=>requestFailure(file));
   const failure=failed?{...requestFailure(failed.file),fileId:failed.id}:null;
   if(failure){
    s.waitingRequest=false;s.requestError=failure;
    // Opening «Prepare proposal» is the user's request to read the PDF: re-read a previous failure once, then show any new error.
    if(failure.reprocess&&!s.autoReread){s.autoReread=true;console.info('[TeTrato] previous reading failed, reading again',failure);return retryRequest(s);}
    render(s);return;
   }
   s.waitingRequest=true;render(s);
   await new Promise(resolve=>setTimeout(resolve,3000));if(!current(s))return;
   await timedLoad(s,attempt+1);
  }
  s.waitingRequest=false;if(!current(s)||s.sourceError)return;
  if(!requestReady(s)){s.requestError={code:'',reprocess:null};render(s);return;}
  console.info('[TeTrato] sources ready, drafting',{since:since(s),pending:!!s.pending,hasResult:!!s.result});
  if(!s.pending&&!s.result&&!(await reuseDraft(s))&&current(s))await start(s,'draft');
 }
 cloud.changeDraftAnalysisJob=function(){const s=state;return s&&current(s)&&s.result?.status==='ready'&&s.resultJob?s.resultJob:null;};
 cloud.installRevisionProposalSteps=function(form,prepareFeedback){
  async function uploadAndDraft(s,fresh){
   s.uploadError=null;s.waitingRequest=true;render(s);
   const started=performance.now();
   try{
    const changed=await prepareFeedback();
    console.info('[TeTrato] adjustments PDF registered',{ms:Math.round(performance.now()-started),changed});
    if(!current(s))return;
    if(changed&&!fresh){clear();state=newState(s.form,false);s=state;}
    if(fresh||changed||!s.result&&!s.pending)await autoDraft(s);
    else{s.waitingRequest=false;render(s);}
   }catch(error){
    console.warn('[TeTrato] adjustments PDF upload failed',error.code||error.message);
    if(current(s)){s.waitingRequest=false;s.uploadError=error.code?projectDocumentError(error.code)||t('error'):error.message||t('error');render(s);}
   }
  }
  cloud.retryRevisionUpload=()=>{const s=state;if(s&&current(s))void uploadAndDraft(s,true);};
  installChangeProposalSteps(form,{mode:'revise',errorMessage:error=>error.code?projectDocumentError(error.code)||t('error'):error.message,async beforeLeave(step){
   if(step===0){
    // Move to TeTrato's step at once; the upload and reading progress (or their error) are shown there.
    const fresh=!state||state.formState!==cloud.proposalForm||state.feedbackNotes!==(form.elements.feedbackNotes?.value.trim()||'');
    if(fresh){clear();state=newState(form,false);}
    void uploadAndDraft(state,fresh);
    return true;
   }
   const s=state;
   if(step===1&&(!s||s.feedbackNotes!==(form.elements.feedbackNotes?.value.trim()||'')))throw Error(uiText('changeSteps.feedbackChanged'));
   if(step!==3||!s||!current(s)||!s.result||!String(s.rate).trim()||!String(s.hours).trim())return true;
   if(s.price&&s.priceKey===s.rate+'|'+s.hours)return true;
   await inlinePrice(s);return current(s)&&!!s.price&&!s.error;
  }});
 };
 cloud.revisionDraftNotes=function(){const s=state;return s&&current(s)&&s.formState.mode==='revise'&&s.result?.status==='ready'&&s.feedbackNotes===(s.form.elements.feedbackNotes?.value.trim()||'')?s.result.feedback_notes:null;};
 cloud.autoDraftChangeProposal=function(){const form=cloud.modal.querySelector('[data-cloud-form="proposal-terms"]');if(!form||!cloud.proposalForm||!form.querySelector('[data-change-auto]'))return;clear();state=newState(form,false);installChangeProposalSteps(form,{async beforeLeave(step){
  // Leaving «Price and date» calculates the additional when rate and hours changed or were never calculated.
  const s=state;if(step!==2||!s||!current(s)||!s.result||!String(s.rate).trim()||!String(s.hours).trim())return true;
  if(s.price&&s.priceKey===s.rate+'|'+s.hours)return true;
  await inlinePrice(s);return current(s)&&!!s.price&&s.priceKey===s.rate+'|'+s.hours&&!s.error;}});void autoDraft(state);};
 // The additional is rate × hours, computed here as the user types; the saved amount is still validated by the API.
 function applyPrice(s,showErrors){if(!s.result)return false;
  try{const {price,amount}=livePrice(s.result,s.rate,s.hours);s.price=price;s.priceKey=s.rate+'|'+s.hours;s.error='';setField(s,'amount',amount);return true;}
  catch(error){s.price=null;if(showErrors)s.error=error.message==='INVALID_RATE'?'INVALID_RATE':'AI_INVALID_INPUT';return false;}}
 async function inlinePrice(s){applyPrice(s,true);render(s);}
 cloud.document.addEventListener('click',event=>{const button=event.target.closest('[data-change-auto]');const s=state;if(!button||!s||!current(s)||!s.form.contains(button))return;const action=button.dataset.changeAuto;if(action==='detail'){openDetail(s,button);return;}if(action==='retry-request'){void retryRequest(s);return;}if(action==='retry-upload'){cloud.retryRevisionUpload?.();return;}
  if(action==='price')void inlinePrice(s);
  if(action==='retry'){if(s.sourceError){void autoDraft(s);}else if(s.pending){if(s.pending.uncertain)submit(s);else poll(s);}else{s.error='';s.failedMode=null;void start(s,'draft',{repeat:true});}}});
 cloud.document.addEventListener('input',event=>{const s=state;if(!s||!current(s)||!s.form.contains(event.target))return;const name=event.target.name;if(name==='feedbackFile'||name==='feedbackNotes'){s.form.dataset.changeDraftReady='false';s.form.changeSteps?.refresh();return;}if(name!=='auto_rate'&&name!=='auto_hours')return;s[name==='auto_rate'?'rate':'hours']=event.target.value;
  if(String(s.rate).trim()&&String(s.hours).trim())applyPrice(s,false);else{s.price=null;}s.form.querySelector('.change-auto-total')?.remove();});
 cloud.document.addEventListener('input',event=>{if(!state||!panel.element.contains(event.target))return;const name=event.target.name;if(name==='question')state.question=event.target.value;if(name==='rate'||name==='hours'){state[name]=event.target.value;if(state.price){state.price=null;panel.element.querySelector('[data-change-draft-total]')?.remove();}}});
 cloud.document.addEventListener('submit',async event=>{if(!state||!panel.element.contains(event.target))return;const s=state;if(event.target.matches('[data-change-draft-question]')){event.preventDefault();start(s,'question');}if(event.target.matches('[data-change-draft-price]')){event.preventDefault();if(busy(s))return;s.error='';s.pricing=true;const rateInput=s.rate,hoursInput=s.hours;render(s);try{const rate=rateMinor(s.rate),hours=s.hours.trim().replace(',','.');const price=await cloud.request(`/api/v1/ai/change-proposals/${s.resultJob}/price`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rate_minor:rate,confirmed_hours:hours})});if(current(s)&&s.rate===rateInput&&s.hours===hoursInput){draftFields(s.result,price);s.price=price;}}catch(error){if(current(s))s.error=error.code||'AI_REQUEST_FAILED';}finally{s.pricing=false;render(s);}}});
 cloud.document.addEventListener('click',async event=>{const button=event.target.closest('[data-change-draft-action]');if(!button)return;if(button.dataset.changeDraftAction==='open'){cloud.openChangeProposalAssistant(button);return;}const s=state;if(!s||!current(s)||!(panel.element.contains(button)||detailPanel.element.contains(button)))return;const action=button.dataset.changeDraftAction;if(action==='choose'&&!busy(s)){s.selected=s.files.filter(f=>f.summary_status==='ready').map(f=>f.id);if(!s.selected.length||s.selected.length>100)s.selected=null;render(s);}if(action==='all-documents'&&!busy(s)){s.selected=null;render(s);}
 if(action==='reload')load(s);
 if(action==='documents')cloud.openProjectDocuments(button,()=>{if(current(s))load(s);});if(action==='draft')start(s,'draft');if(action==='retry'){
  if(s.pending){if(s.pending.uncertain)submit(s);else poll(s);}
  else if(s.failedMode)start(s,s.failedMode,{repeat:true});
 }if(action==='source')cloud.run(()=>previewSource(s,button.dataset.documentId));if(action==='apply'&&s.price&&!busy(s)){const chosenPrice=s.price;s.pricing=true;render(s);s.error='';try{const price=await cloud.request(`/api/v1/ai/change-proposals/${s.resultJob}/price`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rate_minor:s.price.rate_minor,confirmed_hours:s.price.confirmed_hours})});if(!current(s)||s.price!==chosenPrice)return;for(const [name,value] of Object.entries(draftFields(s.result,price))){const field=s.form.elements.namedItem(name);if(field)field.value=value;}panel.close();s.form.querySelector('[name="deadline"]')?.focus();}catch(error){if(current(s))s.error=error.code||'AI_REQUEST_FAILED';}finally{s.pricing=false;render(s);}}});
 cloud.document.addEventListener('keydown',event=>submitChatOnEnter(event,'#change-draft-question'));
 const reset=cloud.reset.bind(cloud);cloud.reset=function(){clear();return reset();};
}
