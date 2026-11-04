import {AIJobClient} from './ai-jobs.mjs';
import {renderAIActivity} from './ai-activity.mjs';
import {uiLanguage} from './i18n.mjs';
import {uiText,uiLocale} from './i18n.mjs';
import {icon} from './icons.mjs';
const t=(key,values)=>uiText(`projectStart.${key}`,values);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const currency=value=>new Intl.NumberFormat(uiLocale(),{style:'currency',currency:'USD'}).format(value);

// UI drafts are explicitly scoped to the signed-in owner and project. They are
// never a substitute for a failed business write or an agent response.
export function installProjectPlanning(cloud){
 const drafts=new Map();let planAI=null,savedPlan=null,savedPlanStatus='idle',savedPlanGeneration=0;let wizard=null,uploading=false,boundModal=null;let root=null,loading=false,loadError='',profile=null,reviews=[],reviewsLoaded=false,backgroundOpen=false,nextOffset=null,lookupEmail='',requestGeneration=0;
 const owner=()=>cloud.navigationOwner;
 const project=()=>wizard?.project||cloud.project();
 const setupKey=id=>`${cloud.session.key}:project-setup:${owner()}:${id}`;
 const key=()=>`${cloud.session.key}:project-plan-draft:${owner()}:${project().id}`;
 let currentKey='';
 const visible=()=>cloud.active&&((wizard&&cloud.modal.open&&root?.isConnected)||(!wizard&&cloud.tab==='plan'&&cloud.projectId&&cloud.location.hash==='#clientes'));
 function defaults(){return {version:1,project_id:project().id,client_id:project().client_id,step:1,brief:'',budget:'',date:'',stages:Array.from({length:3},()=>({title:'',body:'',percent:'',when:''}))};}
 function draft(){
  const id=key();if(drafts.has(id))return drafts.get(id);
  let value=defaults();
  try{const saved=JSON.parse(cloud.storage.getItem(id)||'null');if(saved?.version===1&&saved.project_id===value.project_id&&saved.client_id===value.client_id&&[1,2,3].includes(saved.step)&&Array.isArray(saved.stages)&&saved.stages.length>=1&&saved.stages.length<=8){
   for(const f of ['brief','budget','date'])if(typeof saved[f]==='string')value[f]=saved[f].slice(0,4000);
   value.plan_job_id=typeof saved.plan_job_id==='string'?saved.plan_job_id:null;value.analysis=saved.analysis;value.step=saved.step;value.stages=saved.stages.map(stage=>Object.fromEntries(['title','body','percent','when'].map(f=>[f,typeof stage[f]==='string'?stage[f].slice(0,2000):''])));
  }}catch{value.storageError=t('draftReadError');}
  drafts.set(id,value);return value;
 }
 function save(){try{cloud.storage.setItem(key(),JSON.stringify(draft()));return true;}catch{draft().storageError=t('draftSaveError');return false;}}
 function resetContext(){requestGeneration++;loading=false;loadError='';profile=null;reviews=[];reviewsLoaded=false;backgroundOpen=false;nextOffset=null;lookupEmail=cloud.clients.find(c=>c.id===project()?.client_id)?.contact_email||'';}
 const originalReset=cloud.reset.bind(cloud);cloud.reset=function(){requestGeneration++;planAI?.dispose();planAI=null;savedPlanGeneration++;savedPlan=null;savedPlanStatus='idle';if(wizard){wizard=null;cloud.modal.close();}uploading=false;for(const id of drafts.keys())try{cloud.storage.removeItem(id);}catch{}drafts.clear();currentKey='';root=null;return originalReset();};
 function background(){
  return `<section class="plan-background" aria-label="${t('reputationTitle')}"><header><div><span class="eyebrow">${t('reputationTitle')}</span><h3>${t('backgroundHeading')}</h3></div>${icon('users')}</header><p class="plan-client-reference">${icon('mail')}<strong>${esc(lookupEmail||t('missingClientEmail'))}</strong></p>${loadError?`<p class="cloud-error" role="alert">${esc(loadError)}</p><button type="button" class="text-button" data-plan-action="retry-background">${t('retryBackground')}</button>`:''}${loading?`<p class="plan-background-loading" role="status">${icon('refresh-cw')}${t('lookingUp')}</p>`:''}${profile?`<details class="plan-experiences" ${backgroundOpen?'open':''}><summary>${t('seeExperiences')}<span>${t('publishedExperiences',{count:profile.review_count})}</span></summary><div>${reviews.map(review=>`<article><header><strong>${esc(review.alias)}</strong><time>${new Intl.DateTimeFormat(uiLocale(),{dateStyle:'medium',timeZone:'America/Lima'}).format(new Date(review.created_at))}</time></header><p>${esc(review.body)}</p></article>`).join('')}${nextOffset!==null?`<button type="button" class="text-button" data-plan-action="more-reviews" ${loading?'disabled':''}>${t('moreExperiences')}</button>`:''}</div></details>`:!loadError&&!loading&&lookupEmail&&cloud.planLookupCompleted?`<p class="plan-empty">${t('noBackground')}</p>`:''}${!lookupEmail?`<p>${t('missingEmailHelp')}</p>`:''}<small>${t('notGuarantee')}</small></section><section class="plan-ai-context"><header><span>${icon('sparkles')}${t('aiContextTitle')}</span><small>${t('aiConnected')}</small></header><p>${t('aiConnectedCopy')}</p><div class="plan-payment-context">${icon('credit-card')}<strong>PayPal Sandbox</strong><span>${t('sandboxRole')}</span></div></section>`;
 }
 function updateBackground(){const old=root?.querySelector('.plan-background');if(!old||!visible())return;const context=root.querySelector('.plan-ai-context');if(context)context.remove();old.outerHTML=background();}

 function sources(){const docs=wizard?wizard.documents.filter(doc=>doc.kind==='initial_agreement'):cloud.initialSources();return `<section class="plan-sources"><div><h3>${t('sourceOptional')}</h3><p>${wizard?.route==='ongoing'?uiText("Añade el contrato o la conversación inicial."):t('sourceHint')}</p></div><button type="button" class="button secondary" data-plan-action="upload" ${uploading?'disabled':''}>${icon('plus')}${t(uploading?'uploadingSource':'addPdf')}</button>${wizard?'<input type="file" accept=".pdf,application/pdf" data-plan-setup-file hidden>':''}${docs.length?`<div class="plan-source-list">${wizard?docs.map(doc=>`<article class="plan-uploaded-source">${icon('file-text')}<div><strong>${esc(doc.title)}</strong><p>${esc(doc.original_filename)}</p></div><small>${esc(doc.pending_file?t('filePrepared'):cloud.sourceStatusLabel(doc))}</small></article>`).join(''):cloud.sourceRows(docs)}</div>`:''}</section>`;}
 function fields(d){return `<label class="field">${t('brief')}<textarea class="context-box" data-plan-field="brief" maxlength="4000" rows="4" required>${esc(d.brief)}</textarea></label><div class="plan-fields"><label class="field">${t('budget')}<input class="context-box" type="number" min="0.01" max="100000000" step="0.01" data-plan-field="budget" value="${esc(d.budget)}" required></label><label class="field">${t('target')}<input class="context-box" type="date" data-plan-field="date" value="${esc(d.date)}" required></label></div>`;}
 function stageAmounts(d){const cents=Math.round(Number(d.budget)*100);let used=0;return d.stages.map((stage,i)=>{const amount=i===d.stages.length-1?cents-used:Math.floor(cents*Number(stage.percent)/100);used+=amount;return amount/100;});}
 function stages(d,review=false){return d.stages.map((stage,i)=>`<article class="plan-stage"><span class="plan-stage-number">${i+1}</span><div>${review?`<header><h4>${esc(stage.title)}</h4><strong>${currency(stageAmounts(d)[i])}</strong></header><p>${esc(stage.body)}</p><small>${esc(stage.when)} · ${new Intl.NumberFormat(uiLocale()).format(Number(stage.percent))} %</small>`:`<label class="field">${t('stageName')}<input class="context-box" data-plan-stage="${i}" data-plan-part="title" value="${esc(stage.title)}" maxlength="200" required></label><label class="field">${t('deliverables')}<textarea class="context-box" data-plan-stage="${i}" data-plan-part="body" maxlength="2000" rows="2" required>${esc(stage.body)}</textarea></label><div class="plan-fields"><label class="field">${t('percent')}<input class="context-box" type="number" min="1" max="100" step="1" data-plan-stage="${i}" data-plan-part="percent" value="${esc(stage.percent)}" required></label><label class="field">${t('paymentWhen')}<input class="context-box" data-plan-stage="${i}" data-plan-part="when" value="${esc(stage.when)}" maxlength="500" required></label></div>`}</div></article>`).join('');}
 function render(){if(!root||!visible())return;if(wizard?.route==='ongoing'){renderExistingSetup();return;}const d=draft();root.innerHTML=`<section class="project-planning"><button type="button" class="text-button" data-plan-action="back">${icon('arrow-left')}${t(d.step===1?(wizard?'backClient':'returnSummary'):'back')}</button>${wizard?`<header class="plan-setup-identity"><strong>${esc(wizard.project.name)}</strong><span>${esc(cloud.clients.find(c=>c.id===wizard.project.client_id)?.name)}</span></header>`:''}<ol class="plan-steps" aria-label="${t('progress')}">${['context','plan','agreement'].map((name,i)=>`<li ${d.step===i+1?'aria-current="step"':''}><span>${i+1}</span>${t(name)}</li>`).join('')}</ol>${background()}<section class="workspace-panel plan-editor"><header class="plan-heading"><div><span class="eyebrow">${t('draftLabel')}</span><h3>${t(d.step===1?'contextTitle':d.step===2?'aiPlanTitle':'reviewTitle')}</h3><p>${t(d.step===1?'contextIntro':d.step===2?'aiPlanIntro':'reviewDraftIntro')}</p></div></header>${d.step>=2&&d.analysis?analysisMarkup(d.analysis):''}<form data-plan-form>${d.step===1?fields(d):d.step===2?stages(d):`<p class="plan-brief">${esc(d.brief)}</p>${stages(d,true)}<div class="plan-total"><span>${t('total')}</span><strong>${currency(Number(d.budget))}</strong></div>`}${d.step===1?sources():''}${planAI&&['queued','running'].includes(planAI.state.status)?renderAIActivity({label:t('aiThinking'),hint:t('aiThinkingHint')}):''}<p class="cloud-error" role="alert" data-plan-error>${esc(d.storageError||d.error||'')}</p><footer class="plan-actions">${wizard?'':`<button type="button" class="text-button" data-plan-action="save">${icon('save')}${t('saveDraft')}</button><small>${t('sessionDraft')}</small>`}<button type="submit" class="button">${t(d.step===1?'generateAiPlan':d.step===2?'reviewPlan':wizard?(wizard.isNew?(wizard.created?'finishSaving':'createFinal'):'openPreparedProject'):'openInitialAgreement')}${icon('arrow-right')}</button></footer></form><p class="plan-notice" role="status" data-plan-notice></p></section></section>`;if(uploading)root.querySelectorAll('button').forEach(button=>button.disabled=true);if(planAI&&['queued','running'].includes(planAI.state.status))root.querySelectorAll('[data-plan-field],button[type=submit]').forEach(el=>el.disabled=true);}
 function analysisMarkup(analysis){return `<section class="plan-ai-findings"><h4>${t('aiRationale')}</h4><p>${esc(analysis.summary)}</p>${analysis.observations.map(item=>`<article><strong>${esc(item.finding)}</strong><p>${esc(item.recommendation)}</p>${item.citations.map(c=>`<details><summary>${t('aiExperienceSource')}</summary><blockquote>${esc(c.quote)}</blockquote><small>${t('aiReviewVersion',{version:c.version})}</small></details>`).join('')}</article>`).join('')}<ul>${analysis.limitations.map(text=>`<li>${esc(text)}</li>`).join('')}</ul></section>`;}
 function connectPlanAI(){
  if(planAI)return;
  const contextId=currentKey;
  planAI=new AIJobClient({cloud,scope:'project-plan:'+project().id,onChange:state=>{
   if(contextId!==currentKey||!visible())return;
   const d=draft();
   if(state.status==='completed'&&state.result?.kind==='project_plan'&&d.plan_job_id!==state.id){
    if(state.payload?.brief!==d.brief||Number(state.payload?.budget)!==Number(d.budget)||state.payload?.target_date!==d.date){d.error=t('aiInputsChanged');render();return;}
    d.stages=state.result.stages.map(item=>({...item,percent:String(item.percent)}));d.analysis=state.result;d.plan_job_id=state.id;d.step=2;d.error='';save();
   }else if(state.error)d.error=t('aiFailure');
   render();
  }});
 }
 async function generatePlan(){
  const d=draft();connectPlanAI();d.error='';
  const payload={client_id:project().client_id,draft_id:project().id,brief:d.brief,budget:d.budget,target_date:d.date,output_language:uiLanguage()};
  await planAI.start('/api/v1/ai/project-plans',payload);
 }
 function renderSaved(){
  root.innerHTML=`<section class="project-planning"><button type="button" class="text-button" data-plan-action="back">${icon('arrow-left')}${t('returnSummary')}</button><section class="workspace-panel plan-editor">${savedPlanStatus==='loading'?renderAIActivity({label:t('loadingPlan'),compact:true}):savedPlanStatus==='failed'?`<p class="cloud-error" role="alert">${t('loadPlanFailed')}</p><button type="button" class="button secondary" data-plan-action="retry-plan">${t('retryBackground')}</button>`:savedPlanStatus==='none'?`<h3>${t('noSavedPlan')}</h3>`:`<header class="plan-heading"><span class="eyebrow">${t('savedAiPlan')}</span><h3>${esc(project().name)}</h3></header><p class="plan-brief">${esc(savedPlan.brief)}</p>${stages({budget:savedPlan.budget,stages:savedPlan.stages.map(st=>({title:st.title,body:st.deliverables,percent:st.percent,when:st.payment_condition}))},true)}<div class="plan-total"><span>${t('total')}</span><strong>${currency(Number(savedPlan.budget))}</strong></div>${analysisMarkup({summary:savedPlan.summary,observations:savedPlan.considerations,limitations:savedPlan.limitations})}`}</section></section>`;
 }
 async function loadSavedPlan(){
  const generation=++savedPlanGeneration,id=project().id,scope=currentKey;savedPlanStatus='loading';renderSaved();
  try{const value=await cloud.request(`/api/v1/ai/projects/${encodeURIComponent(id)}/plan`);if(scope!==currentKey||generation!==savedPlanGeneration||!visible())return;savedPlan=value;savedPlanStatus='ready';}
  catch(error){if(scope!==currentKey||generation!==savedPlanGeneration||!visible())return;savedPlanStatus=error.code==='AI_PLAN_NOT_FOUND'?'none':'failed';}
  renderSaved();
 }
 cloud.renderProjectPlan=function(panel){if(wizard)return;root=panel;if(currentKey!==key()){planAI?.dispose();planAI=null;currentKey=key();cloud.planLookupCompleted=false;resetContext();savedPlan=null;loadSavedPlan();return;}renderSaved();};

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
  planAI?.dispose();planAI=null;savedPlanGeneration++;savedPlan=null;savedPlanStatus='idle';requestGeneration++;wizard={project:selected,route,isNew,created:false,committing:false,files:[],documents:[],uploaded:new Set(),creationKey:selected.id,uploadKeys:new Map(),sourceGeneration:0,owner:owner()};uploading=false;
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
    const body=planned?{client_id:pending.project.client_id,name:pending.project.name,plan_job_id:oldDraft.plan_job_id,stages:oldDraft.stages.map(stage=>({...stage,percent:Number(stage.percent)}))}:{client_id:pending.project.client_id,name:pending.project.name};
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
   requestGeneration++;planAI?.dispose();planAI=null;wizard=null;root=null;currentKey='';cloud.modal.close();cloud.clientId=selected.client_id;cloud.projectId=selected.id;cloud.tab='acuerdo';cloud.message='';await cloud.loadProject();cloud.notify();
  }finally{
   uploading=false;pending.committing=false;if(close)close.disabled=false;
   if(current()){render();syncSetupActions();}
  }
 }
 function watchSetupModal(){if(boundModal===cloud.modal)return;boundModal=cloud.modal;
  cloud.modal.addEventListener('cancel',event=>{if(wizard?.committing)event.preventDefault();});
  cloud.modal.addEventListener('close',()=>{if(!cloud.modal.open&&wizard){
   if(wizard.isNew&&!wizard.created){const id=key();drafts.delete(id);try{cloud.storage.removeItem(id);}catch{}}
   else if(wizard.route==='new')save();
   planAI?.dispose();planAI=null;wizard=null;root=null;currentKey='';uploading=false;requestGeneration++;
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
 function validStages(d){return d.stages.every(stage=>stage.title.trim()&&stage.body.trim()&&stage.when.trim()&&Number(stage.percent)>0&&Number(stage.percent)<=100)&&d.stages.reduce((sum,stage)=>sum+Number(stage.percent),0)===100;}
 cloud.document.addEventListener('input',event=>{if(!visible()||!root?.contains(event.target))return;const el=event.target,d=draft();if(el.dataset.planField){d[el.dataset.planField]=el.value;d.plan_job_id=null;d.analysis=null;}if(el.dataset.planStage!==undefined)d.stages[Number(el.dataset.planStage)][el.dataset.planPart]=el.value;});
 cloud.document.addEventListener('submit',async event=>{
  if(!visible()||!root?.contains(event.target))return;
  if(!event.target.matches('[data-plan-form]'))return;event.preventDefault();if(wizard?.route==='ongoing'){if(wizard.documents.some(doc=>doc.kind==='initial_agreement')&&!uploading)cloud.run(finishSetup);return;}const d=draft();d.error='';if(d.step===2&&!validStages(d)){d.error=t('percentError');render();return;}
  if(d.step===1){try{await generatePlan();}catch{d.error=t('aiFailure');render();}return;}
  if(d.step<3){d.step++;save();render();}else{save();if(wizard)cloud.run(finishSetup);else{cloud.tab='acuerdo';cloud.notify();}}
 });
 cloud.document.addEventListener('click',event=>{
  if(!visible())return;const target=event.target.closest('[data-plan-action]');if(!target||!root?.contains(target))return;const d=draft();
  switch(target.dataset.planAction){
   case 'back':if(!wizard){cloud.tab='acuerdo';cloud.notify();break;}if(d.step>1){d.step--;save();render();}else if(wizard)cloud.modal.close();else{cloud.tab='acuerdo';cloud.notify();}break;
   case 'save':if(save()){const status=root.querySelector('[data-plan-notice]');status.textContent=t('draftSaved');}else render();break;
   case 'upload':if(wizard)root.querySelector('[data-plan-setup-file]').click();else{cloud.planUploadProject=cloud.projectId;cloud.openSource('initial');}break;
   case 'retry-plan':loadSavedPlan();break;
   case 'retry-background':lookup();break;
   case 'more-reviews':loadReviews(nextOffset);break;
  }
 });
 cloud.document.addEventListener('toggle',event=>{
  if(!visible()||!root?.contains(event.target)||!event.target.matches('.plan-experiences'))return;
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
