import {createAgentPanel} from './agent-panel.mjs';
import {AIJobClient} from './ai-jobs.mjs';
import {renderAIActivity} from './ai-activity.mjs';
import {uiLanguage} from './i18n.mjs';
import {uiText,uiLocale} from './i18n.mjs';
import {icon} from './icons.mjs';
const t=(key,values)=>uiText(`projectStart.${key}`,values);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const projectToday=()=>{const parts=new Intl.DateTimeFormat('en',{timeZone:'America/Lima',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const part=type=>parts.find(item=>item.type===type).value;return `${part('year')}-${part('month')}-${part('day')}`;};
const currency=value=>new Intl.NumberFormat(uiLocale(),{style:'currency',currency:'USD'}).format(value);

// UI drafts are explicitly scoped to the signed-in owner and project. They are
// never a substitute for a failed business write or an agent response.
export function installProjectPlanning(cloud){
 const drafts=new Map();let planAI=null,planReview=null,savedPlan=null,savedPlanStatus='idle',savedPlanGeneration=0;let wizard=null,uploading=false,boundModal=null;let root=null,loading=false,loadError='',profile=null,reviews=[],reviewsLoaded=false,backgroundOpen=false,nextOffset=null,lookupEmail='',requestGeneration=0;
 const owner=()=>cloud.navigationOwner;
 const project=()=>wizard?.project||cloud.project();
 const setupKey=id=>`${cloud.session.key}:project-setup:${owner()}:${id}`;
 const key=()=>`${cloud.session.key}:project-plan-draft:${owner()}:${project().id}`;
 let currentKey='';let contextPanel=null,recommendationPanel=null;
 function closeContext(){if(contextPanel?.element.open)contextPanel.close();if(recommendationPanel?.element.open)recommendationPanel.close();}
 const visible=()=>cloud.active&&((wizard&&cloud.modal.open&&root?.isConnected)||(!wizard&&cloud.tab==='plan'&&cloud.projectId&&cloud.location.hash==='#clientes'));
 function defaults(){return {version:1,project_id:project().id,client_id:project().client_id,step:1,brief:'',budget:'',date:'',stages:Array.from({length:3},()=>({title:'',body:'',percent:'',when:''}))};}
 function draft(){
  const id=key();if(drafts.has(id))return drafts.get(id);
  let value=defaults();
  try{const saved=JSON.parse(cloud.storage.getItem(id)||'null');if(saved?.version===1&&saved.project_id===value.project_id&&saved.client_id===value.client_id&&[1,2,3].includes(saved.step)&&Array.isArray(saved.stages)&&saved.stages.length>=1&&saved.stages.length<=8){
   for(const f of ['brief','budget','date'])if(typeof saved[f]==='string')value[f]=saved[f].slice(0,4000);
   value.planView=saved.planView==='edit'?'edit':'rationale';value.stageIndex=Number.isInteger(saved.stageIndex)?Math.max(0,Math.min(saved.stageIndex,saved.stages.length-1)):0;
   value.plan_job_id=typeof saved.plan_job_id==='string'?saved.plan_job_id:null;value.analysis=saved.analysis;value.review_job_id=saved.review_job_id;value.reviewed=saved.reviewed;value.step=saved.step;value.stages=saved.stages.map(stage=>Object.fromEntries(['title','body','percent','when'].map(f=>[f,typeof stage[f]==='string'?stage[f].slice(0,2000):''])));
  }}catch{value.storageError=t('draftReadError');}
  drafts.set(id,value);return value;
 }
 function save(){try{cloud.storage.setItem(key(),JSON.stringify(draft()));return true;}catch{draft().storageError=t('draftSaveError');return false;}}
 function resetContext(){closeContext();requestGeneration++;loading=false;loadError='';profile=null;reviews=[];reviewsLoaded=false;backgroundOpen=false;nextOffset=null;lookupEmail=cloud.clients.find(c=>c.id===project()?.client_id)?.contact_email||'';}
 const originalReset=cloud.reset.bind(cloud);cloud.reset=function(){recommendationPanel?.dispose();recommendationPanel=null;contextPanel?.dispose();contextPanel=null;requestGeneration++;planAI?.dispose();planAI=null;planReview?.dispose();planReview=null;savedPlanGeneration++;savedPlan=null;savedPlanStatus='idle';if(wizard){wizard=null;cloud.modal.close();}uploading=false;for(const id of drafts.keys())try{cloud.storage.removeItem(id);}catch{}drafts.clear();currentKey='';root=null;return originalReset();};
 function contextDetails(){
  return `<section class="plan-background" aria-label="${t('reputationTitle')}"><header><h3>${t('reputationTitle')}</h3>${icon('users')}</header><p>${t('contextReputationCopy')}</p><p class="plan-client-reference">${icon('mail')}<strong>${esc(lookupEmail||t('missingClientEmail'))}</strong></p>${loadError?`<p class="cloud-error" role="alert">${esc(loadError)}</p><button type="button" class="text-button" data-plan-action="retry-background">${t('retryBackground')}</button>`:''}${loading?`<p class="plan-background-loading" role="status">${icon('refresh-cw')}${t('lookingUp')}</p>`:''}${profile?`<details class="plan-experiences" ${backgroundOpen?'open':''}><summary>${t('seeExperiences')}<span>${t('publishedExperiences',{count:profile.review_count})}</span></summary><div>${reviews.map(review=>`<article><header><strong>${esc(review.alias)}</strong><time>${new Intl.DateTimeFormat(uiLocale(),{dateStyle:'medium',timeZone:'America/Lima'}).format(new Date(review.created_at))}</time></header><p>${esc(review.body)}</p></article>`).join('')}${nextOffset!==null?`<button type="button" class="text-button" data-plan-action="more-reviews" ${loading?'disabled':''}>${t('moreExperiences')}</button>`:''}</div></details>`:!loadError&&!loading&&lookupEmail&&cloud.planLookupCompleted?`<p class="plan-empty">${t('noBackground')}</p>`:''}${!lookupEmail?`<p>${t('missingEmailHelp')}</p>`:''}</section><section class="plan-ai-context"><header><span>${icon('sparkles')}${t('aiContextTitle')}</span><small>${t('aiConnected')}</small></header><p>${t('aiConnectedCopy')}</p><div class="plan-payment-context">${icon('credit-card')}<strong>PayPal Sandbox</strong><span>${t('sandboxRole')}</span></div></section>`;
 }
 function contextStatus(){
  if(loadError)return loadError;
  if(loading)return t('lookingUp');
  if(profile)return t('publishedExperiences',{count:profile.review_count});
  if(!lookupEmail)return t('missingClientEmail');
  return t(cloud.planLookupCompleted?'contextNoReviews':'contextSummary');
 }
 function background(){
  return `<div class="plan-context-summary"><button type="button" class="plan-context-open" data-plan-action="open-context" aria-haspopup="dialog">${icon('sparkles')}<span><strong>${t('contextAction')}</strong><small ${loadError?'class="cloud-error" role="alert"':loading?'role="status"':''}>${esc(contextStatus())}</small></span><span class="plan-context-payment">PayPal Sandbox</span>${icon('arrow-up-right')}</button></div>`;
 }
 function renderContextPanel(){
  if(!contextPanel||!visible())return;
  const top=contextPanel.element.querySelector('[data-plan-context-body]')?.scrollTop||0;
  contextPanel.render(`<div class="case-agent-shell"><header class="case-agent-header"><div class="case-agent-heading"><div><span>Trato</span><h2 id="plan-context-title">${t('contextDrawerTitle')}</h2></div></div><button type="button" class="case-agent-close" data-agent-close aria-label="${uiText('Cerrar')}" title="${uiText('Cerrar')}">${icon('x')}</button></header><div class="case-agent-chat" data-agent-chat data-plan-context-body role="region" aria-label="${t('contextDrawerTitle')}">${contextDetails()}</div></div>`);
  contextPanel.element.querySelector('[data-plan-context-body]').scrollTop=top;
 }
 function openContext(button){
  if(!contextPanel)contextPanel=createAgentPanel({cloud,id:'plan-context-title',className:'plan-context-drawer',trigger:()=>root?.querySelector('[data-plan-action="open-context"]')});
  renderContextPanel();contextPanel.open(button);
 }
 function updateBackground(){
  if(!visible())return;
  const old=root?.querySelector('.plan-context-summary');if(old)old.outerHTML=background();
  if(contextPanel?.element.open)renderContextPanel();
 }


 function sources(){const docs=wizard?wizard.documents.filter(doc=>doc.kind==='initial_agreement'):cloud.initialSources();return `<section class="plan-sources"><div><h3>${wizard?t('sourceOptional'):uiText('Acuerdo inicial')}</h3><p>${wizard?.route==='ongoing'?uiText("Añade el contrato o la conversación inicial."):wizard?t('sourceHint'):uiText('projectSummary.agreementHelp')}</p></div><button type="button" class="button secondary" data-plan-action="upload" ${uploading?'disabled':''}>${icon('plus')}${t(uploading?'uploadingSource':'addPdf')}</button>${wizard?'<input type="file" accept=".pdf,application/pdf" data-plan-setup-file hidden>':''}${docs.length?`<div class="plan-source-list">${wizard?docs.map(doc=>`<article class="plan-uploaded-source">${icon('file-text')}<div><strong>${esc(doc.title)}</strong><p>${esc(doc.original_filename)}</p></div><small>${esc(doc.pending_file?t('filePrepared'):cloud.sourceStatusLabel(doc))}</small></article>`).join(''):cloud.sourceRows(docs)}</div>`:''}</section>`;}
 function fields(d){return `<label class="field">${t('brief')}<textarea class="context-box" data-plan-field="brief" maxlength="4000" rows="4" required>${esc(d.brief)}</textarea></label><div class="plan-fields"><label class="field">${t('budget')}<input class="context-box" type="number" min="0.01" max="100000000" step="0.01" data-plan-field="budget" value="${esc(d.budget)}" required></label><label class="field">${t('target')}<input class="context-box" type="date" min="${projectToday()}" data-plan-field="date" value="${esc(d.date)}" required></label></div>`;}
 function stageAmounts(d){const cents=Math.round(Number(d.budget)*100);let used=0;return d.stages.map((stage,i)=>{const amount=i===d.stages.length-1?cents-used:Math.floor(cents*Number(stage.percent)/100);used+=amount;return amount/100;});}
 function stages(d,review=false,only=null){return d.stages.map((stage,i)=>only!==null&&i!==only?'':`<article class="plan-stage"><span class="plan-stage-number">${i+1}</span><div>${review?`<header><h4>${esc(stage.title)}</h4><strong>${currency(stageAmounts(d)[i])}</strong></header><p>${esc(stage.body)}</p><small>${esc(stage.when)} · ${new Intl.NumberFormat(uiLocale()).format(Number(stage.percent))} %</small>`:`<label class="field">${t('stageName')}<input class="context-box" data-plan-stage="${i}" data-plan-part="title" value="${esc(stage.title)}" maxlength="200" required></label><label class="field">${t('deliverables')}<textarea class="context-box" data-plan-stage="${i}" data-plan-part="body" maxlength="2000" rows="2" required>${esc(stage.body)}</textarea></label><div class="plan-fields"><label class="field">${t('percent')}<input class="context-box" type="number" min="1" max="100" step="1" data-plan-stage="${i}" data-plan-part="percent" value="${esc(stage.percent)}" required></label><div class="plan-payment-preview"><label for="plan-when-${i}">${t('paymentWhen')}</label><textarea id="plan-when-${i}" class="context-box" rows="2" maxlength="500" data-plan-stage="${i}" data-plan-part="when" required>${esc(stage.when)}</textarea></div></div>`}</div></article>`).join('');}
 function render(){
  if(!root||!visible())return;
  if(wizard?.route==='ongoing'){renderExistingSetup();return;}
  const d=draft(),rationale=d.step===2&&d.planView!=='edit';
  const progress=d.step===1?0:rationale?1:d.step===2?2:3;
  const title=d.step===1?'contextTitle':rationale?'rationaleTitle':d.step===2?'aiPlanTitle':'reviewTitle';
  const intro=d.step===1?'contextIntro':rationale?'rationaleIntro':d.step===2?'aiPlanIntro':'reviewDraftIntro';
  root.innerHTML=`<section class="project-planning">${wizard||d.step>1?`<button type="button" class="text-button" data-plan-action="back">${icon('arrow-left')}${t(d.step===1?'backClient':'back')}</button>`:''}${wizard?`<header class="plan-setup-identity"><strong>${esc(wizard.project.name)}</strong><span>${esc(cloud.clients.find(c=>c.id===wizard.project.client_id)?.name)}</span></header>`:''}<ol class="plan-steps" aria-label="${t('progress')}">${['context','rationaleStep','plan','agreement'].map((name,i)=>`<li ${progress===i?'aria-current="step"':''}><span>${i+1}</span>${t(name)}</li>`).join('')}</ol>${d.step===1?background():''}<section class="workspace-panel plan-editor ${rationale?'plan-rationale-view':''}"><header class="plan-heading"><div><span class="eyebrow">${rationale?'TeTrato':t('draftLabel')}</span><h3 tabindex="-1" data-plan-heading>${t(title)}</h3><p>${t(intro)}</p></div></header><form data-plan-form>${d.step===1?fields(d):rationale?proposalReasoning(d):d.step===2?stageEditor(d):`<p class="plan-brief">${esc(d.brief)}</p>${stages(d,true)}<div class="plan-total"><span>${t('total')}</span><strong>${currency(Number(d.budget))}</strong></div>`}${d.step===1?sources():''}${planReview&&['queued','running'].includes(planReview.state.status)?renderAIActivity({label:t('reviewingEdits')}):''}${planAI&&['queued','running'].includes(planAI.state.status)?renderAIActivity({label:t('aiThinking'),hint:t('aiThinkingHint')}):''}<p class="cloud-error" role="alert" data-plan-error>${esc(d.storageError||d.error||'')}</p><footer class="plan-actions">${wizard?'':`<button type="button" class="text-button" data-plan-action="save">${icon('save')}${t('saveDraft')}</button><small>${t('sessionDraft')}</small>`}${d.step===2&&!rationale?`<button type="button" class="text-button" data-plan-action="show-rationale">${t('seeRationale')}</button>`:''}<button type="submit" class="button">${t(d.step===1?'generateAiPlan':rationale?'continueToPlan':d.step===2?'reviewPlan':wizard?(wizard.isNew?(wizard.created?'finishSaving':'createFinal'):'openPreparedProject'):'openInitialAgreement')}${icon('arrow-right')}</button></footer></form><p class="plan-notice" role="status" data-plan-notice></p></section></section>`;
  if(planReview&&['queued','running'].includes(planReview.state.status))root.querySelectorAll('input,textarea,button').forEach(el=>el.disabled=true);
  if(uploading)root.querySelectorAll('button').forEach(button=>button.disabled=true);
  if(planAI&&['queued','running'].includes(planAI.state.status))root.querySelectorAll('[data-plan-field],button[type=submit]').forEach(el=>el.disabled=true);
 }
 function proposalReasoning(d){
  const a=d.analysis;
  if(!a)return '';
  return `<div class="plan-reasoning"><div class="plan-reasoning-summary"><img src="/assets/mascot/trato-guide.png" alt="" width="84" height="84"><p>${esc(a.summary)}</p></div><button type="button" class="plan-recommendation-open" data-plan-action="open-recommendation" aria-haspopup="dialog">${icon('file-text')}<strong>${t('recommendedOrder')}</strong>${icon('arrow-up-right')}</button><div class="plan-reasoning-observations">${a.observations.map((item,i)=>`<article><span class="plan-reasoning-number">${i+1}</span><div><h4>${esc(item.finding)}</h4><p>${esc(item.recommendation)}</p>${item.citations.length?`<details><summary>${t('aiExperienceSource')}</summary>${item.citations.map(c=>`<blockquote>${esc(c.quote)}</blockquote>`).join('')}</details>`:''}</div></article>`).join('')}</div></div>`;
 }
 function openRecommendation(button){
  if(!recommendationPanel)recommendationPanel=createAgentPanel({cloud,id:'plan-recommendation-title',className:'plan-recommendation-drawer',trigger:()=>root?.querySelector('[data-plan-action="open-recommendation"]')});
  const d=draft();
  recommendationPanel.render(`<div class="case-agent-shell"><header class="case-agent-header"><div class="case-agent-heading"><img class="case-agent-mascot" src="/assets/mascot/trato-guide.png" alt="" width="44" height="44"><div><span>TeTrato</span><h2 id="plan-recommendation-title">${t('recommendedOrder')}</h2></div></div><button type="button" class="case-agent-close" data-agent-close aria-label="${uiText('Cerrar')}" title="${uiText('Cerrar')}">${icon('x')}</button></header><div class="case-agent-chat" data-agent-chat role="region" aria-label="${t('recommendedOrder')}"><section class="plan-recommended-stages"><ol>${d.stages.map((stage,i)=>`<li><span class="plan-reasoning-number">${i+1}</span><div><header><strong>${esc(stage.title)}</strong><span>${currency(stageAmounts(d)[i])} · ${new Intl.NumberFormat(uiLocale()).format(Number(stage.percent))} %</span></header><p class="plan-recommended-payment">${icon('credit-card')}${esc(stage.when)}</p><details class="plan-stage-deliverables"><summary>${t('seeDeliverables')}</summary><p>${esc(stage.body)}</p></details></div></li>`).join('')}</ol></section><div class="plan-total"><span>${t('total')}</span><strong>${currency(Number(d.budget))}</strong></div></div></div>`);
  recommendationPanel.element.querySelector('[data-agent-chat]').scrollTop=0;
  recommendationPanel.open(button);
 }
 function stageEditor(d){
  const index=Math.max(0,Math.min(d.stageIndex||0,d.stages.length-1));d.stageIndex=index;
  return `<div class="plan-stage-switcher" role="group" aria-label="${t('chooseStage')}">${d.stages.map((stage,i)=>`<button type="button" data-plan-action="choose-stage" data-plan-stage-index="${i}" aria-pressed="${index===i}"><span aria-hidden="true"></span>${t('deliverableTab',{number:i+1})}</button>`).join('')}</div><div class="plan-stage-editor">${stages(d,false,index)}</div><div class="plan-total"><span>${t('total')}</span><strong>${currency(Number(d.budget))}</strong></div>`;
 }
 function movePlanView(){if(recommendationPanel?.element.open)recommendationPanel.close();render();root?.querySelector('[data-plan-heading]')?.focus({preventScroll:true});if(wizard)cloud.modal.scrollTop=0;else root?.scrollIntoView?.({block:'start',behavior:'instant'});}
 function analysisMarkup(analysis){return `<section class="plan-ai-findings"><h4>${t('aiRationale')}</h4><p>${esc(analysis.summary)}</p>${analysis.observations.map(item=>`<article><strong>${esc(item.finding)}</strong><p>${esc(item.recommendation)}</p>${item.citations.map(c=>`<details><summary>${t('aiExperienceSource')}</summary><blockquote>${esc(c.quote)}</blockquote><small>${t('aiReviewVersion',{version:c.version})}</small></details>`).join('')}</article>`).join('')}<ul>${analysis.limitations.map(text=>`<li>${esc(text)}</li>`).join('')}</ul></section>`;}
 function connectPlanAI(){
  if(planAI)return;
  const contextId=currentKey;
  planAI=new AIJobClient({cloud,scope:'project-plan:'+project().id,onChange:state=>{
   if(contextId!==currentKey||!visible())return;
   const d=draft();
   if(state.status==='completed'&&state.result?.kind==='project_plan'&&d.plan_job_id!==state.id){
    if(state.payload?.brief!==d.brief||Number(state.payload?.budget)!==Number(d.budget)||state.payload?.target_date!==d.date){d.error=t('aiInputsChanged');render();return;}
    d.stages=state.result.stages.map(item=>({...item,percent:String(item.percent)}));d.analysis=state.result;d.plan_job_id=state.id;d.step=2;d.planView='rationale';d.stageIndex=0;d.review_job_id=null;d.reviewed=null;d.error='';save();movePlanView();return;
   }else if(state.error)d.error=t('aiFailure');
   render();
  }});
 }
 const canonicalStages=stages=>(stages||[]).map(st=>({title:st.title,body:st.body,percent:Number(st.percent),when:st.when}));
 const confirmedStages=d=>canonicalStages(d.stages);
 const needsPlanReview=d=>JSON.stringify(confirmedStages(d))!==JSON.stringify(canonicalStages(d.analysis?.stages));
 async function reviewEdits(){
  const d=draft(),contextId=currentKey;
  if(!planReview)planReview=new AIJobClient({cloud,scope:'project-plan-review:'+project().id,onChange:state=>{
   if(contextId!==currentKey||!visible())return;
   const current=draft();
   if(state.status==='completed'){
    if(state.payload?.plan_job_id!==current.plan_job_id||JSON.stringify(state.payload?.stages)!==JSON.stringify(confirmedStages(current))){current.error=t('aiInputsChanged');render();return;}
    if(state.result?.kind!=='project_plan'){current.error=t('aiFailure');render();return;}
    current.review_job_id=state.id;current.reviewed=state.result;current.step=3;current.error='';save();movePlanView();return;
   }
   if(state.error)current.error=t('aiFailure');render();
  }});
  await planReview.start('/api/v1/ai/project-plans/review',{plan_job_id:d.plan_job_id,stages:confirmedStages(d),output_language:uiLanguage()});
 }
 // Local PDFs are only read to extract text (the API does not persist them); originals upload when the project is confirmed.
 async function planSources(){
  const pending=wizard;if(!pending?.files?.length)return [];
  pending.sourceText??=new Map();const sources=[];
  for(const {file,key} of pending.files.slice(0,5)){
   if(!pending.sourceText.has(key)){
    const result=await cloud.request('/api/v1/documents/extract?filename='+encodeURIComponent(file.name),{method:'POST',headers:{'Content-Type':'application/pdf'},body:file});
    const text=String(result?.text||'').trim();if(!text)throw Error(t('pdfError'));
    pending.sourceText.set(key,text.slice(0,60000));
   }
   sources.push({filename:file.name.slice(0,255),text:pending.sourceText.get(key)});
  }
  return sources;
 }
 async function generatePlan(){
  const d=draft();connectPlanAI();d.error='';
  let sources;
  try{sources=await planSources();}
  catch(error){d.error=error?.message||t('aiFailure');render();return;}
  const payload={client_id:project().client_id,draft_id:project().id,brief:d.brief,budget:d.budget,target_date:d.date,sources,output_language:uiLanguage()};
  await planAI.start('/api/v1/ai/project-plans',payload);
 }
 function savedPlanOverview(){
  const date=new Intl.DateTimeFormat(uiLocale(),{dateStyle:'medium',timeZone:'America/Lima'}).format(new Date(savedPlan.target_date+'T12:00:00-05:00'));
  return `<header class="plan-saved-heading"><div><span class="eyebrow">${t('savedAiPlan')}</span><h3>${t('planSaved')}</h3></div><div class="plan-saved-header-actions"><button type="button" class="text-button" data-plan-action="saved-sources" aria-haspopup="dialog">${icon('file-text')}${uiText('Acuerdo inicial')}</button><button type="button" class="text-button" data-plan-action="saved-reasoning" aria-haspopup="dialog">${icon('sparkles')}${t('originalReasoning')}</button></div></header><dl class="plan-saved-facts"><div><dt>${t('total')}</dt><dd>${currency(Number(savedPlan.budget))}</dd></div><div><dt>${t('dateLabel')}</dt><dd>${date}</dd></div></dl><ol class="plan-saved-stages">${savedPlan.stages.map((stage,i)=>`<li data-plan-stage-row="${stage.position??i+1}"><span class="plan-reasoning-number">${i+1}</span><strong>${esc(stage.title)}</strong><span class="plan-saved-amount">${currency(Number(stage.amount))}</span><small class="plan-saved-percent">${new Intl.NumberFormat(uiLocale()).format(Number(stage.percent))} %</small><button type="button" class="text-button" data-plan-action="saved-stage" data-saved-stage="${i}" aria-haspopup="dialog" aria-label="${t('stageDetails',{number:i+1})}">${t('seeDetail')}${icon('arrow-up-right')}</button></li>`).join('')}</ol>`;
 }
 function openSavedDetails(button){
  const initial=button.dataset.planAction==='saved-sources';
  if(!initial&&(savedPlanStatus!=='ready'||!savedPlan))return;
  const rationale=button.dataset.planAction==='saved-reasoning',stage=savedPlan?.stages[Number(button.dataset.savedStage)];
  if(!initial&&!rationale&&!stage)return;
  if(!recommendationPanel)recommendationPanel=createAgentPanel({cloud,id:'plan-recommendation-title',className:'plan-recommendation-drawer',trigger:()=>root?.querySelector(`[data-plan-action="${rationale?'saved-reasoning':'saved-stage'}"]`)});
  const title=initial?uiText('Acuerdo inicial'):rationale?t('originalReasoning'):stage.title;
  const content=initial?sources():rationale?analysisMarkup({summary:savedPlan.summary,observations:savedPlan.considerations,limitations:[]}):`<div class="plan-saved-detail"><div class="plan-total"><strong>${currency(Number(stage.amount))}</strong><span>${new Intl.NumberFormat(uiLocale()).format(Number(stage.percent))} %</span></div><section><h3>${t('deliverables')}</h3><p>${esc(stage.deliverables)}</p></section><section><h3>${t('paymentWhen')}</h3><p>${esc(stage.payment_condition)}</p></section></div>`;
  recommendationPanel.render(`<div class="case-agent-shell"><header class="case-agent-header"><div class="case-agent-heading"><div><span>${rationale?'TeTrato':t('savedAiPlan')}</span><h2 id="plan-recommendation-title">${esc(title)}</h2></div></div><button type="button" class="case-agent-close" data-agent-close aria-label="${uiText('Cerrar')}" title="${uiText('Cerrar')}">${icon('x')}</button></header><div class="case-agent-chat" data-agent-chat role="region" aria-label="${esc(title)}">${content}</div></div>`);
  recommendationPanel.element.querySelector('[data-agent-chat]').scrollTop=0;
  if(initial)recommendationPanel.element.querySelector('.plan-sources').addEventListener('click',event=>{if(event.target.closest('[data-cloud-action]'))recommendationPanel.close();},true);
  recommendationPanel.open(button);
 }
 function renderSaved(){
  root.innerHTML=`<section class="project-planning"><section class="workspace-panel plan-editor">${savedPlanStatus==='loading'?renderAIActivity({label:t('loadingPlan'),compact:true}):savedPlanStatus==='failed'?`<p class="cloud-error" role="alert">${t('loadPlanFailed')}</p><button type="button" class="button secondary" data-plan-action="retry-plan">${t('retryBackground')}</button>`:savedPlanStatus==='none'?`<h3>${t('noSavedPlan')}</h3><button type="button" class="text-button" data-plan-action="saved-sources" aria-haspopup="dialog">${icon('file-text')}${uiText('Acuerdo inicial')}</button>`:`${savedPlanOverview()}`}</section></section>`;
  cloud.renderPlanPayments?.(root,savedPlan);
 }
 async function loadSavedPlan(){
  const generation=++savedPlanGeneration,id=project().id,scope=currentKey;savedPlanStatus='loading';renderSaved();
  try{const value=await cloud.request(`/api/v1/ai/projects/${encodeURIComponent(id)}/plan`);if(scope!==currentKey||generation!==savedPlanGeneration)return;savedPlan=value;savedPlanStatus='ready';}
  catch(error){if(scope!==currentKey||generation!==savedPlanGeneration)return;savedPlanStatus=error.code==='AI_PLAN_NOT_FOUND'?'none':'failed';}
  if(visible())renderSaved();
 }
 cloud.renderProjectPlan=function(panel){if(wizard)return;root=panel;if(currentKey!==key()){planAI?.dispose();planAI=null;planReview?.dispose();planReview=null;currentKey=key();cloud.planLookupCompleted=false;resetContext();savedPlan=null;loadSavedPlan();return;}renderSaved();};

 const originalSubmit=cloud.submit.bind(cloud),originalClick=cloud.click.bind(cloud);
 cloud.submit=async function(event){
  if(wizard&&(event.target.matches('[data-plan-form]')||event.target.matches('[data-plan-lookup]')))return;
  if(event.target.dataset.cloudForm!=='project')return originalSubmit(event);
  const values=new FormData(event.target),route=values.get('project_start')==='ongoing'?'ongoing':'new';
  await this.run(async()=>{
   const pending={id:crypto.randomUUID(),client_id:values.get('client'),name:values.get('name')};
   await openSetup(pending,route,true);
  });syncSetupActions();
 };

 function defaultsFor(project){return {version:1,project_id:project.id,client_id:project.client_id,step:1,brief:'',budget:'',date:'',stages:Array.from({length:3},()=>({title:'',body:'',percent:'',when:''}))};}
 cloud.click=function(event){
  const target=event.target.closest('[data-cloud-action="project-open"]');
  if(target&&this.active&&!this.busy){
   const selected=this.projects.find(item=>item.id===target.dataset.cloudId);let pending=null;
   try{pending=JSON.parse(this.storage.getItem(setupKey(selected?.id))||'null');}catch{}
   if(selected&&pending?.client_id===selected.client_id&&['new','ongoing'].includes(pending.route)){this.run(()=>openSetup(selected,pending.route)).then(syncSetupActions);return;}
  }
  return originalClick(event);
 };
 cloud.discardProjectPlan=function(id){
  const draftKey=`${this.session.key}:project-plan-draft:${owner()}:${id}`;drafts.delete(draftKey);
  try{this.storage.removeItem(draftKey);this.storage.removeItem(setupKey(id));}catch{}
 };
 async function openSetup(selected,route,isNew=false){
  closeContext();
  planAI?.dispose();planAI=null;planReview?.dispose();planReview=null;savedPlanGeneration++;savedPlan=null;savedPlanStatus='idle';requestGeneration++;wizard={project:selected,route,isNew,created:false,committing:false,files:[],documents:[],uploaded:new Set(),creationKey:selected.id,uploadKeys:new Map(),sourceGeneration:0,owner:owner()};uploading=false;
  cloud.show(t('prepareProject'),'<div data-project-setup></div>');cloud.modal.classList.add('cloud-project-setup');watchSetupModal();root=cloud.modal.querySelector('[data-project-setup]');currentKey=key();cloud.planLookupCompleted=false;resetContext();render();if(route==='new'&&lookupEmail)void lookup();
  if(isNew)return;
  const pending=wizard,sourceGeneration=pending.sourceGeneration;
  try{const documents=await cloud.request(`/api/v1/projects/${selected.id}/documents`);if(wizard===pending&&owner()===pending.owner&&pending.sourceGeneration===sourceGeneration){
   wizard.documents=documents;
   // A delayed source response must not replace fields the user is already editing.
   // Only the source section depends on this response in the new-project route.
   if(route==='ongoing')renderExistingSetup();else{const sourcePanel=root.querySelector('.plan-sources');if(sourcePanel)sourcePanel.outerHTML=sources();}
  }}
  catch(issue){if(wizard===pending)cloud.modal.querySelector('[data-cloud-error]').textContent=issue.message;}
 }
 function syncSetupActions(){
  // cloud.run releases generic submit-button locks; restore this route's business gate
  // without recreating inputs or moving focus in an editor that is already open.
  if(wizard?.route!=='ongoing'||!root?.isConnected)return;
  const submit=root.querySelector('[data-plan-form] button[type="submit"]');
  if(submit)submit.disabled=uploading||!wizard.documents.some(doc=>doc.kind==='initial_agreement');
 }
 function renderExistingSetup(){
  root.innerHTML=`<section class="project-planning"><button type="button" class="text-button" data-plan-action="back">${icon('arrow-left')}${t('backClient')}</button><header class="plan-setup-identity"><strong>${esc(wizard.project.name)}</strong><span>${esc(cloud.clients.find(c=>c.id===wizard.project.client_id)?.name)}</span></header><section class="workspace-panel plan-editor"><header class="plan-heading"><span class="eyebrow">${t('agreement')}</span><h3>${uiText('Guarda lo que han conversado')}</h3></header><form data-plan-form>${sources()}<p class="plan-file-error cloud-error" role="alert" data-plan-error></p><footer class="plan-actions"><small>${t('filesStay')}</small><button class="button" type="submit" ${!wizard.documents.some(doc=>doc.kind==='initial_agreement')||uploading?'disabled':''}>${t(wizard.isNew?(wizard.created?'finishSaving':'createFinal'):'openPreparedProject')}${icon('arrow-right')}</button></footer></form></section></section>`;
 }
 async function finishSetup(){
  if(!wizard||uploading||wizard.committing)return;
  const pending=wizard,oldDraftKey=key(),oldDraft=draft();
  if(pending.route==='new'&&!save())return render();
  if(pending.route==='ongoing'&&!pending.documents.some(doc=>doc.kind==='initial_agreement'))return;
  pending.committing=true;uploading=true;render();
  const close=cloud.modal.querySelector('[data-cloud-close]');if(close)close.disabled=true;
  const current=()=>wizard===pending&&owner()===pending.owner;
  try{
   if(pending.isNew&&!pending.created){
    const planned=pending.route==='new';
    if(planned&&!oldDraft.plan_job_id)throw Error(t('aiPlanRequired'));
    const body=planned?{client_id:pending.project.client_id,name:pending.project.name,plan_job_id:oldDraft.plan_job_id,stages:confirmedStages(oldDraft),...(oldDraft.review_job_id?{review_job_id:oldDraft.review_job_id}:{})}:{client_id:pending.project.client_id,name:pending.project.name};
    const created=await cloud.request(planned?'/api/v1/ai/projects':'/api/v1/projects',{...cloud.json(body),headers:{'Content-Type':'application/json','Idempotency-Key':pending.creationKey}});
    if(!current())return;
    pending.project=created;pending.created=true;
    cloud.projects=[created,...cloud.projects.filter(item=>item.id!==created.id)];
    if(oldDraftKey!==key()){
     drafts.delete(oldDraftKey);try{cloud.storage.removeItem(oldDraftKey);}catch{}
    }
    drafts.set(key(),{...oldDraft,project_id:created.id});save();
   }
   for(const item of pending.files){
    if(pending.uploaded.has(item.key))continue;
    const metadata=new URLSearchParams({filename:item.file.name,title:item.file.name.slice(0,200),kind:'initial_agreement'});
    await cloud.request(`/api/v1/projects/${pending.project.id}/documents?${metadata}`,{method:'POST',body:item.file,headers:{'Content-Type':'application/pdf','Idempotency-Key':item.key}});
    if(!current())return;
    pending.uploaded.add(item.key);
   }
   const selected=pending.project;
   try{cloud.storage.removeItem(setupKey(selected.id));}catch{throw Error(t('draftSaveError'));}
   requestGeneration++;planAI?.dispose();planAI=null;planReview?.dispose();planReview=null;wizard=null;root=null;currentKey='';cloud.modal.close();cloud.clientId=selected.client_id;cloud.projectId=selected.id;cloud.tab='acuerdo';cloud.message='';await cloud.loadProject();cloud.notify();
  }finally{
   uploading=false;pending.committing=false;if(close)close.disabled=false;
   if(current()){render();syncSetupActions();}
  }
 }
 function watchSetupModal(){if(boundModal===cloud.modal)return;boundModal=cloud.modal;
  cloud.modal.addEventListener('cancel',event=>{if(wizard?.committing)event.preventDefault();});
  cloud.modal.addEventListener('close',()=>{if(!cloud.modal.open&&wizard){
   closeContext();
   if(wizard.isNew&&!wizard.created){const id=key();drafts.delete(id);try{cloud.storage.removeItem(id);}catch{}}
   else if(wizard.route==='new')save();
   planAI?.dispose();planAI=null;planReview?.dispose();planReview=null;wizard=null;root=null;currentKey='';uploading=false;requestGeneration++;
  }});
 }
 cloud.document.addEventListener('change',async event=>{
  const input=event.target;if(!wizard||!input.matches('[data-plan-setup-file]')||!root?.contains(input)||uploading)return;
  const file=input.files[0];input.value='';if(!file)return;const pending=wizard;
  if(!/\.pdf$/i.test(file.name)||!file.size||file.size>10485760||(await file.slice(0,5).text())!=='%PDF-'){root.querySelector('[data-plan-error]').textContent=t('pdfError');return;}
  if(wizard!==pending)return;
  if(pending.isNew&&!pending.created){
   const command=JSON.stringify([file.name,file.size,file.lastModified]);
   if(!pending.uploadKeys.has(command)){
    const fileKey=crypto.randomUUID();pending.uploadKeys.set(command,fileKey);
    pending.files.push({file,key:fileKey});pending.documents.push({id:fileKey,kind:'initial_agreement',title:file.name,original_filename:file.name,pending_file:true});
   }
   render();return;
  }
  pending.sourceGeneration++;uploading=true;render();
  const command=JSON.stringify([file.name,file.size,file.lastModified]);if(!pending.uploadKeys.has(command))pending.uploadKeys.set(command,crypto.randomUUID());
  try{
   const metadata=new URLSearchParams({filename:file.name,title:file.name.slice(0,200),kind:'initial_agreement'});
   await cloud.request(`/api/v1/projects/${pending.project.id}/documents?${metadata}`,{method:'POST',body:file,headers:{'Content-Type':'application/pdf','Idempotency-Key':pending.uploadKeys.get(command)}});
   const documents=await cloud.request(`/api/v1/projects/${pending.project.id}/documents`);
   if(wizard===pending&&owner()===pending.owner)pending.documents=documents;
  }catch(issue){if(wizard===pending)pending.uploadError=issue.message;}
  finally{if(wizard===pending){uploading=false;render();if(pending.uploadError){root.querySelector('[data-plan-error]').textContent=pending.uploadError;pending.uploadError='';}}}
 });
 function validStages(d){return d.stages.every(stage=>stage.title.trim()&&stage.body.trim()&&stage.when.trim()&&Number.isInteger(Number(stage.percent))&&Number(stage.percent)>0&&Number(stage.percent)<=100)&&d.stages.reduce((sum,stage)=>sum+Number(stage.percent),0)===100;}
 cloud.document.addEventListener('input',event=>{if(!visible()||!root?.contains(event.target))return;const el=event.target,d=draft();if(el.dataset.planField){d[el.dataset.planField]=el.value;d.plan_job_id=null;d.analysis=null;}if(el.dataset.planStage!==undefined){d.stages[Number(el.dataset.planStage)][el.dataset.planPart]=el.value;d.review_job_id=null;d.reviewed=null;}});
 cloud.document.addEventListener('submit',async event=>{
  if(!visible()||!root?.contains(event.target))return;
  if(!event.target.matches('[data-plan-form]'))return;event.preventDefault();if(wizard?.route==='ongoing'){if(wizard.documents.some(doc=>doc.kind==='initial_agreement')&&!uploading)cloud.run(finishSetup);return;}const d=draft();d.error='';if(d.step===2&&d.planView==='edit'&&!validStages(d)){d.error=t('percentError');const invalid=d.stages.findIndex(stage=>!stage.title.trim()||!stage.body.trim()||!stage.when.trim()||!(Number.isInteger(Number(stage.percent))&&Number(stage.percent)>0&&Number(stage.percent)<=100));if(invalid>=0)d.stageIndex=invalid;movePlanView();return;}
  if(d.step===1){const dateInput=root.querySelector('[data-plan-field="date"]');if(dateInput)dateInput.min=projectToday();if(!d.date||d.date<projectToday()){d.error=t('pastDate');render();root.querySelector('[data-plan-field="date"]')?.focus();return;}try{await generatePlan();}catch{d.error=t('aiFailure');render();}return;}
  if(d.step===2&&d.planView!=='edit'){d.planView='edit';save();movePlanView();return;}
  if(d.step===2&&d.planView==='edit'&&needsPlanReview(d)&&!d.review_job_id){try{await reviewEdits();}catch{d.error=t('aiFailure');render();}return;}
  if(d.step<3){d.step++;save();movePlanView();}else{save();if(wizard)cloud.run(finishSetup);else{cloud.tab='acuerdo';cloud.notify();}}
 });
 cloud.document.addEventListener('click',event=>{
  if(!visible())return;const target=event.target.closest('[data-plan-action]');if(!target||!(root?.contains(target)||contextPanel?.element.contains(target)||recommendationPanel?.element.contains(target)))return;const d=draft();
  switch(target.dataset.planAction){
   case 'saved-sources':case 'saved-reasoning':case 'saved-stage':openSavedDetails(target);break;
   case 'open-context':openContext(target);break;
   case 'open-recommendation':openRecommendation(target);break;
   case 'show-rationale':d.planView='rationale';save();movePlanView();break;
   case 'choose-stage':{const index=Number(target.dataset.planStageIndex);if(Number.isInteger(index)&&index>=0&&index<d.stages.length){d.stageIndex=index;save();render();root.querySelector(`[data-plan-stage-index="${index}"]`)?.focus({preventScroll:true});}break;}
   case 'back':if(d.step===2&&d.planView==='edit'){d.planView='rationale';save();movePlanView();break;}if(d.step===3){d.step=2;d.planView='edit';save();movePlanView();break;}if(!wizard){cloud.tab='acuerdo';cloud.notify();break;}if(d.step>1){d.step--;save();movePlanView();}else if(wizard)cloud.modal.close();else{cloud.tab='acuerdo';cloud.notify();}break;
   case 'save':if(save()){const status=root.querySelector('[data-plan-notice]');status.textContent=t('draftSaved');}else render();break;
   case 'upload':if(recommendationPanel?.element.open)recommendationPanel.close();if(wizard)root.querySelector('[data-plan-setup-file]').click();else{cloud.planUploadProject=cloud.projectId;cloud.openSource('initial');}break;
   case 'retry-plan':loadSavedPlan();break;
   case 'retry-background':lookup();break;
   case 'more-reviews':loadReviews(nextOffset);break;
  }
 });
 cloud.document.addEventListener('toggle',event=>{
  if(!visible()||!(root?.contains(event.target)||contextPanel?.element.contains(event.target))||!event.target.matches('.plan-experiences'))return;
  backgroundOpen=event.target.open;
  if(backgroundOpen&&!reviewsLoaded&&!loading&&!loadError)void loadReviews();
 },true);
 async function lookup(){
  if(!lookupEmail||loading)return;
  const run=++requestGeneration,id=currentKey;loading=true;loadError='';profile=null;reviews=[];reviewsLoaded=false;nextOffset=null;cloud.planLookupCompleted=false;updateBackground();
  try{const result=await cloud.request('/api/v1/reputation/lookup',{method:'POST',body:JSON.stringify({public_email:lookupEmail})});if(run!==requestGeneration||id!==currentKey||!visible())return;
   if(result.client&&result.client.public_email?.trim().toLowerCase()!==lookupEmail.trim().toLowerCase())throw Error('Client identity mismatch');
   profile=result.client;cloud.planLookupCompleted=true;
  }
  catch{if(run===requestGeneration&&id===currentKey)loadError=t('backgroundError');}
  finally{if(run===requestGeneration&&id===currentKey){loading=false;updateBackground();}}
 }

 async function loadReviews(offset=0){
  if(loading||!profile)return;const run=++requestGeneration,id=currentKey,profileId=profile.id;loading=true;loadError='';updateBackground();
  try{const result=await cloud.request(`/api/v1/reputation/clients/${encodeURIComponent(profileId)}?offset=${offset}`);if(run!==requestGeneration||id!==currentKey||!visible())return;reviews=offset?[...reviews,...result.reviews]:result.reviews;nextOffset=result.next_offset;reviewsLoaded=true;}
  catch{if(run===requestGeneration&&id===currentKey)loadError=t('backgroundError');}
  finally{if(run===requestGeneration&&id===currentKey){loading=false;updateBackground();}}
 }
}
