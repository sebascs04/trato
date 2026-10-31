import {uiText,uiLocale} from './i18n.mjs';
import {icon} from './icons.mjs';
const t=(key,values)=>uiText(`projectStart.${key}`,values);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const currency=value=>new Intl.NumberFormat(uiLocale(),{style:'currency',currency:'USD'}).format(value);

// UI drafts are explicitly scoped to the signed-in owner and project. They are
// never a substitute for a failed business write or an agent response.
export function installProjectPlanning(cloud){
 const drafts=new Map();let wizard=null,uploading=false,boundModal=null;let root=null,loading=false,loadError='',profile=null,reviews=[],confirmedProfile=false,nextOffset=null,lookupEmail='',requestGeneration=0;
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
  try{const saved=JSON.parse(cloud.storage.getItem(id)||'null');if(saved?.version===1&&saved.project_id===value.project_id&&saved.client_id===value.client_id&&[1,2,3].includes(saved.step)&&Array.isArray(saved.stages)&&saved.stages.length===3){
   for(const f of ['brief','budget','date'])if(typeof saved[f]==='string')value[f]=saved[f].slice(0,4000);
   value.step=saved.step;value.stages=saved.stages.map(stage=>Object.fromEntries(['title','body','percent','when'].map(f=>[f,typeof stage[f]==='string'?stage[f].slice(0,2000):''])));
  }}catch{value.storageError=t('draftReadError');}
  drafts.set(id,value);return value;
 }
 function save(){try{cloud.storage.setItem(key(),JSON.stringify(draft()));return true;}catch{draft().storageError=t('draftSaveError');return false;}}
 function resetContext(){requestGeneration++;loading=false;loadError='';profile=null;reviews=[];confirmedProfile=false;nextOffset=null;lookupEmail=cloud.clients.find(c=>c.id===project()?.client_id)?.contact_email||'';}
 const originalReset=cloud.reset.bind(cloud);cloud.reset=function(){requestGeneration++;if(wizard){wizard=null;cloud.modal.close();}uploading=false;for(const id of drafts.keys())try{cloud.storage.removeItem(id);}catch{}drafts.clear();currentKey='';root=null;return originalReset();};
 function background(){
  return `<section class="plan-background" aria-label="${t('reputationTitle')}"><header><div><span class="eyebrow">${t('reputationTitle')}</span><h3>${t('backgroundHeading')}</h3></div>${icon('users')}</header><p>${t('backgroundPurpose')}</p><form data-plan-lookup><label class="field" for="plan-client-email">${t('clientEmail')}</label><div class="plan-lookup-row"><input class="context-box" type="email" id="plan-client-email" name="email" required maxlength="254" value="${esc(lookupEmail)}"><button class="button secondary" ${loading?'disabled':''}>${t(loading?'lookingUp':'lookupBackground')}</button></div></form>${loadError?`<p class="cloud-error" role="alert">${esc(loadError)}</p>`:''}${profile?`<div class="plan-profile"><strong>${esc(profile.public_email||t('clientEmail'))}</strong><small>${t('publishedExperiences',{count:profile.review_count})}</small>${!confirmedProfile?`<p>${t('identityHelp')}</p><button class="text-button" type="button" data-plan-action="confirm-profile">${t('confirmProfile')}${icon('arrow-right')}</button>`:`<details class="plan-experiences"><summary>${t('seeExperiences')} · ${reviews.length}</summary>${reviews.map(review=>`<article><header><strong>${esc(review.alias)}</strong><time>${new Intl.DateTimeFormat(uiLocale(),{dateStyle:'medium',timeZone:'America/Lima'}).format(new Date(review.created_at))}</time></header><p>${esc(review.body)}</p></article>`).join('')}${nextOffset!==null?`<button type="button" class="text-button" data-plan-action="more-reviews" ${loading?'disabled':''}>${t('moreExperiences')}</button>`:''}</details>`}</div>`:profile===null&&lookupEmail&&cloud.planLookupCompleted?`<p class="plan-empty">${t('noBackground')}</p>`:''}<small>${t('notGuarantee')}</small></section>`;
 }
 function sources(){const docs=wizard?wizard.documents.filter(doc=>doc.kind==='initial_agreement'):cloud.initialSources();return `<section class="plan-sources"><div><h3>${t('sourceOptional')}</h3><p>${wizard?.route==='ongoing'?uiText("Añade el contrato o la conversación inicial."):t('sourceHint')}</p></div><button type="button" class="button secondary" data-plan-action="upload" ${uploading?'disabled':''}>${icon('plus')}${t(uploading?'uploadingSource':'addPdf')}</button>${wizard?'<input type="file" accept=".pdf,application/pdf" data-plan-setup-file hidden>':''}${docs.length?`<div class="plan-source-list">${wizard?docs.map(doc=>`<article class="plan-uploaded-source">${icon('file-text')}<div><strong>${esc(doc.title)}</strong><p>${esc(doc.original_filename)}</p></div><small>${esc(cloud.sourceStatusLabel(doc))}</small></article>`).join(''):cloud.sourceRows(docs)}</div>`:''}</section>`;}
 function fields(d){return `<label class="field">${t('brief')}<textarea class="context-box" data-plan-field="brief" maxlength="4000" rows="4" required>${esc(d.brief)}</textarea></label><div class="plan-fields"><label class="field">${t('budget')}<input class="context-box" type="number" min="0.01" max="100000000" step="0.01" data-plan-field="budget" value="${esc(d.budget)}" required></label><label class="field">${t('target')}<input class="context-box" type="date" data-plan-field="date" value="${esc(d.date)}" required></label></div>`;}
 function stages(d,review=false){return d.stages.map((stage,i)=>`<article class="plan-stage"><span class="plan-stage-number">${i+1}</span><div>${review?`<header><h4>${esc(stage.title)}</h4><strong>${currency(Number(d.budget)*Number(stage.percent)/100)}</strong></header><p>${esc(stage.body)}</p><small>${esc(stage.when)} · ${new Intl.NumberFormat(uiLocale()).format(Number(stage.percent))} %</small>`:`<label class="field">${t('stageName')}<input class="context-box" data-plan-stage="${i}" data-plan-part="title" value="${esc(stage.title)}" maxlength="200" required></label><label class="field">${t('deliverables')}<textarea class="context-box" data-plan-stage="${i}" data-plan-part="body" maxlength="2000" rows="2" required>${esc(stage.body)}</textarea></label><div class="plan-fields"><label class="field">${t('percent')}<input class="context-box" type="number" min="1" max="100" step="1" data-plan-stage="${i}" data-plan-part="percent" value="${esc(stage.percent)}" required></label><label class="field">${t('paymentWhen')}<input class="context-box" data-plan-stage="${i}" data-plan-part="when" value="${esc(stage.when)}" maxlength="500" required></label></div>`}</div></article>`).join('');}
 function render(){if(!root||!visible())return;if(wizard?.route==='ongoing'){renderExistingSetup();return;}const d=draft();root.innerHTML=`<section class="project-planning"><button type="button" class="text-button" data-plan-action="back">${icon('arrow-left')}${t(d.step===1?(wizard?'backClient':'returnSummary'):'back')}</button>${wizard?`<header class="plan-setup-identity"><strong>${esc(wizard.project.name)}</strong><span>${esc(cloud.clients.find(c=>c.id===wizard.project.client_id)?.name)}</span></header>`:''}<ol class="plan-steps" aria-label="${t('progress')}">${['context','plan','agreement'].map((name,i)=>`<li ${d.step===i+1?'aria-current="step"':''}><span>${i+1}</span>${t(name)}</li>`).join('')}</ol>${background()}<section class="workspace-panel plan-editor"><header class="plan-heading"><div><span class="eyebrow">${t('draftLabel')}</span><h3>${t(d.step===1?'contextTitle':d.step===2?'manualPlanTitle':'reviewTitle')}</h3><p>${t(d.step===1?'contextIntro':d.step===2?'manualPlanIntro':'reviewDraftIntro')}</p></div></header><form data-plan-form>${d.step===1?fields(d):d.step===2?stages(d):`<p class="plan-brief">${esc(d.brief)}</p>${stages(d,true)}<div class="plan-total"><span>${t('total')}</span><strong>${currency(Number(d.budget))}</strong></div>`}${d.step===1?sources():''}<p class="cloud-error" role="alert" data-plan-error>${esc(d.storageError||d.error||'')}</p><footer class="plan-actions"><button type="button" class="text-button" data-plan-action="save">${icon('save')}${t('saveDraft')}</button><small>${t('sessionDraft')}</small><button type="submit" class="button">${t(d.step===1?'organizeStages':d.step===2?'reviewPlan':wizard?'openPreparedProject':'openInitialAgreement')}${icon('arrow-right')}</button></footer></form><p class="plan-notice" role="status" data-plan-notice></p></section></section>`;if(uploading)root.querySelectorAll('button').forEach(button=>button.disabled=true);}
 cloud.renderProjectPlan=function(panel){if(wizard)return;root=panel;if(currentKey!==key()){currentKey=key();cloud.planLookupCompleted=false;resetContext();}render();};
 const originalSubmit=cloud.submit.bind(cloud),originalClick=cloud.click.bind(cloud);
 cloud.submit=async function(event){
  if(wizard&&(event.target.matches('[data-plan-form]')||event.target.matches('[data-plan-lookup]')))return;
  if(event.target.dataset.cloudForm!=='project')return originalSubmit(event);
  const values=new FormData(event.target),route=values.get('project_start')==='ongoing'?'ongoing':'new';
  await this.run(async()=>{
   const created=await this.request('/api/v1/projects',this.json({client_id:values.get('client'),name:values.get('name')}));
   this.projects=[created,...this.projects.filter(item=>item.id!==created.id)];this.clientId=created.client_id;this.projectId='';this.documents=[];this.events=[];this.projectActivity=[];
   try{this.storage.setItem(setupKey(created.id),JSON.stringify({route,client_id:created.client_id}));}catch{drafts.set(`${this.session.key}:project-plan-draft:${owner()}:${created.id}`,{...defaultsFor(created),storageError:t('draftSaveError')});}
   this.notify();await openSetup(created,route);
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
 async function openSetup(selected,route){
  requestGeneration++;wizard={project:selected,route,documents:[],uploadKeys:new Map(),sourceGeneration:0,owner:owner()};uploading=false;
  cloud.show(t('prepareProject'),'<div data-project-setup></div>');cloud.modal.classList.add('cloud-project-setup');watchSetupModal();root=cloud.modal.querySelector('[data-project-setup]');currentKey=key();resetContext();render();
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
  root.innerHTML=`<section class="project-planning"><button type="button" class="text-button" data-plan-action="back">${icon('arrow-left')}${t('backClient')}</button><header class="plan-setup-identity"><strong>${esc(wizard.project.name)}</strong><span>${esc(cloud.clients.find(c=>c.id===wizard.project.client_id)?.name)}</span></header><section class="workspace-panel plan-editor"><header class="plan-heading"><span class="eyebrow">${t('agreement')}</span><h3>${uiText('Guarda lo que han conversado')}</h3></header><form data-plan-form>${sources()}<p class="plan-file-error cloud-error" role="alert" data-plan-error></p><footer class="plan-actions"><small>${t('filesStay')}</small><button class="button" type="submit" ${!wizard.documents.some(doc=>doc.kind==='initial_agreement')||uploading?'disabled':''}>${t('openPreparedProject')}${icon('arrow-right')}</button></footer></form></section></section>`;
 }
 async function finishSetup(){
  if(!wizard||uploading)return;const selected=wizard.project;
  if(wizard.route==='new'&&!save())return render();
  try{cloud.storage.removeItem(setupKey(selected.id));}catch{cloud.modal.querySelector('[data-cloud-error]').textContent=t('draftSaveError');return;}
  requestGeneration++;wizard=null;root=null;currentKey='';cloud.modal.close();cloud.clientId=selected.client_id;cloud.projectId=selected.id;cloud.tab='acuerdo';cloud.message='';await cloud.loadProject();cloud.notify();
 }
 function watchSetupModal(){if(boundModal===cloud.modal)return;boundModal=cloud.modal;cloud.modal.addEventListener('close',()=>{if(!cloud.modal.open&&wizard){if(wizard.route==='new')save();wizard=null;root=null;currentKey='';uploading=false;requestGeneration++;}});}
 cloud.document.addEventListener('change',async event=>{
  const input=event.target;if(!wizard||!input.matches('[data-plan-setup-file]')||!root?.contains(input)||uploading)return;
  const file=input.files[0];input.value='';if(!file)return;const pending=wizard;
  if(!/\.pdf$/i.test(file.name)||!file.size||file.size>10485760||(await file.slice(0,5).text())!=='%PDF-'){root.querySelector('[data-plan-error]').textContent=t('pdfError');return;}
  if(wizard!==pending)return;pending.sourceGeneration++;uploading=true;render();
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
 cloud.document.addEventListener('input',event=>{if(!visible()||!root?.contains(event.target))return;const el=event.target,d=draft();if(el.dataset.planField)d[el.dataset.planField]=el.value;if(el.dataset.planStage!==undefined)d.stages[Number(el.dataset.planStage)][el.dataset.planPart]=el.value;});
 cloud.document.addEventListener('submit',async event=>{
  if(!visible()||!root?.contains(event.target))return;
  if(event.target.matches('[data-plan-lookup]')){event.preventDefault();lookupEmail=new FormData(event.target).get('email').trim();await lookup();return;}
  if(!event.target.matches('[data-plan-form]'))return;event.preventDefault();if(wizard?.route==='ongoing'){if(wizard.documents.some(doc=>doc.kind==='initial_agreement')&&!uploading)cloud.run(finishSetup);return;}const d=draft();d.error='';if(d.step===2&&!validStages(d)){d.error=t('percentError');render();return;}
  if(d.step<3){d.step++;save();render();}else{save();if(wizard)cloud.run(finishSetup);else{cloud.tab='acuerdo';cloud.notify();}}
 });
 cloud.document.addEventListener('click',event=>{
  if(!visible())return;const target=event.target.closest('[data-plan-action]');if(!target||!root?.contains(target))return;const d=draft();
  switch(target.dataset.planAction){
   case 'back':if(d.step>1){d.step--;save();render();}else if(wizard)cloud.modal.close();else{cloud.tab='acuerdo';cloud.notify();}break;
   case 'save':if(save()){const status=root.querySelector('[data-plan-notice]');status.textContent=t('draftSaved');}else render();break;
   case 'upload':if(wizard)root.querySelector('[data-plan-setup-file]').click();else{cloud.planUploadProject=cloud.projectId;cloud.openSource('initial');}break;
   case 'confirm-profile':confirmedProfile=true;loadReviews();break;
   case 'more-reviews':loadReviews(nextOffset);break;
  }
 });
 async function lookup(){
  const run=++requestGeneration,id=currentKey;loading=true;loadError='';profile=null;reviews=[];confirmedProfile=false;nextOffset=null;cloud.planLookupCompleted=false;render();
  try{const result=await cloud.request('/api/v1/reputation/lookup',{method:'POST',body:JSON.stringify({public_email:lookupEmail})});if(run!==requestGeneration||id!==currentKey||!visible())return;profile=result.client;cloud.planLookupCompleted=true;}
  catch{if(run===requestGeneration&&id===currentKey)loadError=t('backgroundError');}
  finally{if(run===requestGeneration&&id===currentKey){loading=false;render();}}
 }
 async function loadReviews(offset=0){
  if(loading||!profile||!confirmedProfile)return;const run=++requestGeneration,id=currentKey,profileId=profile.id;loading=true;loadError='';render();
  try{const result=await cloud.request(`/api/v1/reputation/clients/${encodeURIComponent(profileId)}?offset=${offset}`);if(run!==requestGeneration||id!==currentKey||!visible())return;reviews=offset?[...reviews,...result.reviews]:result.reviews;nextOffset=result.next_offset;}
  catch{if(run===requestGeneration&&id===currentKey)loadError=t('backgroundError');}
  finally{if(run===requestGeneration&&id===currentKey){loading=false;render();}}
 }
}
