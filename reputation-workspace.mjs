import {uiText,uiLocale,uiLanguage} from './i18n.mjs';
import {icon} from './icons.mjs';
import {renderAIActivity} from './ai-activity.mjs';
import {AIJobClient} from './ai-jobs.mjs';
const t=(key,values)=>uiText(`reputation.${key}`,values);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const count=n=>n===1?t('oneReview'):t('reviews',{count:new Intl.NumberFormat(uiLocale()).format(n)});
const number=n=>n===null?'—':new Intl.NumberFormat(uiLocale(),{maximumFractionDigits:1,minimumFractionDigits:1}).format(n);
const stars=(value=0)=>`<span class="rep-stars" aria-hidden="true">${Array.from({length:5},(_,i)=>`<span class="${i<Math.round(value)?'is-filled':''}">${icon('star')}</span>`).join('')}</span>`;
const emailLabel=client=>client.public_email||t('emailNotPublished');
const date=value=>new Intl.DateTimeFormat(uiLocale(),{dateStyle:'medium',timeZone:'America/Lima'}).format(new Date(value));
const ratingField=(key,value)=>{const label=t(key==='rating'?'overall':key);return `<fieldset class="rep-rating-input" data-rep-rating="${key}" id="rep-${key}"><legend>${label}</legend><div>${[1,2,3,4,5].map(n=>`<label class="${n<=Number(value)?'is-filled':''}" title="${t('chooseRating',{value:n})}"><input type="radio" name="${key}" value="${n}" required ${Number(value)===n?'checked':''} aria-label="${label}: ${t('chooseRating',{value:n})}"><span>${icon('star')}</span></label>`).join('')}</div></fieldset>`;};

export function installReputationWorkspace(cloud){
 let owner='',data=null,search='',selected='',offset=0,more=false,loading=false,error='',notice='',epoch=0,options=null,dialog=null,busy=false,root=null,fileDialog=null,fileUrl=null,fileEpoch=0;
 let analysis=null,analysisScope='',analysisError='';
 const visible=()=>cloud.active&&cloud.navigationOwner===owner&&cloud.location.hash==='#reputacion';
 function reset(){stopAnalysis();closeFile();owner=cloud.navigationOwner;data=null;search='';selected='';offset=0;more=false;loading=false;error='';notice='';options=null;epoch++;if(dialog){dialog.remove();dialog=null;}busy=false;}
 const originalReset=cloud.reset.bind(cloud);cloud.reset=function(){reset();return originalReset();};
 function message(issue){const codes={REPUTATION_ATTACHMENT_LIMIT:'fileLimit',REPUTATION_ATTACHMENT_FORMAT:'fileFormat',REQUEST_TOO_LARGE:'fileSize',REPUTATION_ATTACHMENT_MISMATCH:'fileMismatch',REPUTATION_ATTACHMENT_NOT_READY:'fileNotReady',REPUTATION_ATTACHMENT_NOT_FOUND:'fileUnavailable',REPUTATION_ATTACHMENT_CONFLICT:'fileConflict',REPUTATION_ATTACHMENT_INVALID:'fileUnavailable',REPUTATION_FILE_BACKEND_NOT_CONFIGURED:'fileError',REPUTATION_EMAIL_INVALID:'emailInvalid',REPUTATION_EMAIL_REQUIRED:'emailInvalid',REPUTATION_EMAIL_EXISTS:'emailExists',REPUTATION_INVALID:'invalid',REPUTATION_CONSENT_REQUIRED:'invalid',REPUTATION_CLIENT_MISMATCH:'mismatch',REPUTATION_REVIEW_EXISTS:'exists',REPUTATION_REVIEW_HIDDEN:'hidden',REPUTATION_NOT_FOUND:'notFound',PROJECT_NOT_FOUND:'notFound'};return t(codes[issue?.code]||'error');}
 function filesMarkup(files){return files?.length?`<section class="rep-evidence"><h4>${icon('paperclip')}${t('filesShared',{count:files.length})}</h4><ul>${files.map(file=>`<li><button type="button" class="text-button" data-rep-file="${esc(file.id)}" data-rep-filename="${esc(file.filename)}">${icon('file-text')}<span>${esc(file.filename)}</span>${icon('eye')}</button><small>${new Intl.NumberFormat(uiLocale(),{maximumFractionDigits:1}).format(file.size_bytes/1048576)} MB</small></li>`).join('')}</ul></section>`:'';}
 function closeFile(){fileEpoch++;if(fileDialog){fileDialog.remove();fileDialog=null;}if(fileUrl){URL.revokeObjectURL(fileUrl);fileUrl=null;}}
 async function previewFile(id,filename){
  closeFile();const run=fileEpoch,runOwner=owner;const preview=cloud.document.createElement('dialog');fileDialog=preview;preview.className='rep-dialog rep-file-preview';preview.setAttribute('aria-label',t('filePreview'));
  preview.innerHTML=`<header><div><span class="eyebrow">${t('filePreview')}</span><h2>${esc(filename)}</h2></div><button type="button" class="rep-close" data-rep-file-close aria-label="${t('close')}" title="${t('close')}">${icon('x')}</button></header><p role="status" class="rep-modal-status">${t('loading')}</p>`;
  preview.addEventListener('cancel',event=>{event.preventDefault();closeFile();});cloud.document.body.append(preview);preview.showModal();
  try{const blob=await cloud.request(`/api/v1/reputation/attachments/${encodeURIComponent(id)}/file`,{},true);if(run!==fileEpoch||owner!==runOwner||!visible())return;if(blob.type.split(';')[0]!=='application/pdf')throw new Error('Invalid evidence response');fileUrl=URL.createObjectURL(blob);preview.querySelector('.rep-modal-status').outerHTML=`<div class="rep-file-toolbar"><span>${t('fileRead')}</span><a class="text-button" data-rep-file-download>${t('fileDownload')}${icon('download')}</a></div><iframe class="rep-file-frame" title="${t('filePreview')}"></iframe>`;preview.querySelector('iframe').src=fileUrl+'#view=FitH';const link=preview.querySelector('[data-rep-file-download]');link.href=fileUrl;link.download=filename;}
  catch(issue){if(run===fileEpoch&&fileDialog===preview)preview.querySelector('.rep-modal-status').outerHTML=`<p class="rep-error rep-file-error" role="alert">${esc(message(issue))}</p>`;}
 }
 function shell(content){return `<section class="rep-workspace" data-reputation><header class="rep-heading"><div><span class="eyebrow">${t('community')}</span><h2>${t(selected?'reviewHeading':'intro')}</h2><p>${t('introCopy')}</p></div><button class="button" data-rep-action="write">${icon('pencil')}${t('write')}</button></header>${purpose()}${notice?`<p class="rep-notice" role="status">${esc(notice)}</p>`:''}${content}</section>`;}
 function purpose(){return `<details class="rep-purpose rep-purpose-compact"><summary>${icon('info')}<span>${t('howAiWorks')}</span></summary><div class="rep-purpose-content"><header>${icon('sparkles')}<div><span class="rep-ai-label">${t('aiLabel')}</span><h3>${t('purposeAiTitle')}</h3></div></header><p class="rep-purpose-main">${t('purposeCopy')} <strong>${t('purposeDecision')}</strong></p><p>${t('purposeLead')}</p><div>${[['messages-square','purposeTalk'],['credit-card','purposePay'],['git-compare-arrows','purposeChanges']].map(([glyph,key])=>`<span>${icon(glyph)}${t(key)}</span>`).join('')}</div></div></details>`;}
 function stopAnalysis(){analysis?.dispose();analysis=null;analysisScope='';analysisError='';}
 function prepareAnalysis(){
  const scope=`reputation:${selected}`;
  if(analysisScope===scope)return;
  stopAnalysis();analysisScope=scope;
  const profile=selected,runOwner=owner;
  try{analysis=new AIJobClient({cloud,scope,onChange:()=>{
   if(!visible()||selected!==profile||owner!==runOwner)return;
   const panel=root?.querySelector('[data-rep-analysis]');if(panel)panel.innerHTML=analysisMarkup();
  }});}catch{analysisError=t('ai.error');}
 }
 function analysisMarkup(){
  const state=analysis?.state||{status:'idle'};
  const waiting=['queued','running'].includes(state.status);
  const result=state.status==='completed'?state.result:null;
  const valid=result?.kind==='reputation'&&typeof result.summary==='string'&&Array.isArray(result.observations)&&Array.isArray(result.limitations)&&Number.isInteger(result.sources_read)&&typeof result.model==='string'&&result.observations.every(o=>o&&typeof o.finding==='string'&&typeof o.recommendation==='string'&&Array.isArray(o.citations)&&o.citations.every(c=>c&&typeof c.review_id==='string'&&Number.isInteger(c.version)&&typeof c.quote==='string'))&&result.limitations.every(v=>typeof v==='string');
  const failed=analysisError||['failed','unavailable'].includes(state.status)||(state.status==='completed'&&!valid);
  return `<header><div><span class="rep-ai-label">${t('aiLabel')}</span><h3>${t('ai.title')}</h3></div>${icon('sparkles')}</header><p>${t('ai.context')}</p>${waiting?renderAIActivity({label:t('ai.working'),hint:t('ai.wait'),compact:true}):''}${failed?`<p class="rep-error" role="alert">${t('ai.error')}</p>`:''}${valid?`<div class="rep-analysis-result"><p class="rep-analysis-summary">${esc(result.summary)}</p><p class="rep-analysis-meta">${t('ai.sources',{count:result.sources_read})} · ${esc(result.model)}</p>${result.observations.map(o=>`<article><h4>${esc(o.finding)}</h4><p>${esc(o.recommendation)}</p><details><summary>${t('ai.evidence',{count:o.citations.length})}</summary>${o.citations.map(c=>`<figure><blockquote>${esc(c.quote)}</blockquote><figcaption>${t('ai.version',{version:c.version})}<span class="rep-analysis-source-id">${esc(c.review_id)}</span></figcaption></figure>`).join('')}</details></article>`).join('')}${result.limitations.length?`<details class="rep-analysis-limits"><summary>${t('ai.limitations')}</summary><ul>${result.limitations.map(v=>`<li>${esc(v)}</li>`).join('')}</ul></details>`:''}</div>`:''}<div class="rep-analysis-actions">${waiting?`<button type="button" class="text-button" data-rep-action="ai-check">${t('ai.check')}</button>`:analysis?`<button type="button" class="button ${valid?'secondary':''}" data-rep-action="ai-start">${icon('sparkles')}${t(state.status==='unavailable'?(state.uncertain?'ai.retrySend':'ai.check'):state.status==='failed'?'ai.retry':valid?'ai.again':'ai.start')}</button>`:''}</div>`;
 }
 async function runAnalysis(check=false){
  if(!selected||!visible()||!analysis)return;
  const client=analysis;analysisError='';
  try{
   if(check)await client.check();
   else await client.start('/api/v1/ai/reputation',{profile_id:selected,output_language:uiLanguage()});
  }catch{
   if(visible()&&analysis===client&&analysisScope===`reputation:${selected}`){analysisError=t('ai.error');const panel=root?.querySelector('[data-rep-analysis]');if(panel)panel.innerHTML=analysisMarkup();}
  }
 }
 function publicEmail(client){return `<p class="rep-public-email">${icon('mail')}<span>${esc(client.public_email||t('emailNotPublished'))}</span></p>`;}
 function render(){
  if(!root?.isConnected||!visible())return;
  if(loading&&!data){root.innerHTML=shell(`<div class="rep-loading" role="status" aria-label="${t('loading')}"><div></div><div></div><div></div><span class="sr-only">${t('loading')}</span></div>`);return;}
  if(error){root.innerHTML=shell(`<section class="workspace-panel rep-empty" role="alert"><p>${esc(error)}</p><button class="button secondary" data-rep-action="retry">${t('retry')}</button></section>`);return;}
  if(!data)return;
  if(selected){renderDetail();return;}
  root.innerHTML=shell(`<div class="rep-directory-tools"><form data-rep-search role="search"><label for="rep-search" class="sr-only">${t('search')}</label><span aria-hidden="true">${icon('search')}</span><input id="rep-search" name="search" type="search" maxlength="254" value="${esc(search)}" placeholder="${t('searchPlaceholder')}"><button class="button secondary">${t('searchAction')}</button></form><span>${icon('users')}${t('private')}</span></div>${data.clients.length?`<div class="rep-directory" aria-label="${t('directory')}">${data.clients.map(client=>`<article class="rep-client-card"><header><span class="rep-client-avatar">${esc((client.public_email||'').slice(0,2).toUpperCase())}</span><div><span class="rep-client-label">${t('clientLabel')}</span><h3>${esc(emailLabel(client))}</h3></div></header><div class="rep-card-rating"><strong>${number(client.rating)}</strong>${stars(client.rating)}<span>${count(client.review_count)}</span></div>${client.latest_review?`<p class="rep-card-excerpt">“${esc(client.latest_review.excerpt)}”</p>`:''}<button class="text-button" data-rep-action="open" data-rep-id="${esc(client.id)}">${t('open')}${icon('arrow-right')}</button></article>`).join('')}</div>${more?`<button class="button secondary rep-more" data-rep-action="more" ${loading?'disabled':''}>${t('more')}</button>`:''}`:`<section class="rep-empty workspace-panel"><span class="rep-empty-icon">${icon('star')}</span><h3>${t(search?'noResults':'emptyTitle')}</h3>${!search?`<p>${t('emptyCopy')}</p>`:''}${search?`<button class="button secondary" data-rep-action="clear">${t('all')}</button>`:''}</section>`}<aside class="rep-community-note">${icon('users')}<div><strong>${t('opinion')}</strong><p>${t('privateCopy')}</p></div></aside>`);
 }
 function renderDetail(){
  const c=data.client;prepareAnalysis();
  root.innerHTML=shell(`<button class="text-button rep-back" data-rep-action="back">${icon('arrow-left')}${t('back')}</button><section class="rep-profile workspace-panel"><div class="rep-profile-identity"><span class="rep-client-avatar">${esc((c.public_email||'').slice(0,2).toUpperCase())}</span><div><span class="rep-client-label">${t('clientLabel')}</span><h2>${esc(emailLabel(c))}</h2></div></div><div class="rep-profile-score"><strong>${number(c.rating)}</strong>${stars(c.rating)}<span>${count(c.review_count)}</span></div><div class="rep-score-breakdown"><div><span>${t('communication')}</span><strong>${number(c.communication)}<small> / 5</small></strong></div><div><span>${t('collaboration')}</span><strong>${number(c.collaboration??null)}<small> / 5</small></strong></div></div></section><section class="rep-analysis workspace-panel" data-rep-analysis aria-label="${t('ai.title')}">${analysisMarkup()}</section><div class="rep-review-list">${data.reviews.map(r=>`<article class="rep-review workspace-panel"><header><div class="rep-author"><span>${esc(r.alias.slice(0,2).toUpperCase())}</span><div><strong>${esc(r.alias)}</strong><small>${r.mine?t('own'):t('author')}</small></div></div><time datetime="${esc(r.created_at)}">${date(r.created_at)}</time></header><div class="rep-review-rating"><span aria-label="${t('rating',{value:r.rating})}">${stars(r.rating)}</span><span class="rep-project-badge" title="${t('linkedHelp')}">${icon('file-text')}${t('linked')}</span></div><p class="rep-review-copy">${esc(r.body)}</p>${filesMarkup(r.attachments)}<div class="rep-review-facts"><span>${t('communication')}: ${r.communication}/5</span>${r.collaboration!=null?`<span>${t('collaboration')}: ${r.collaboration}/5</span>`:''}</div><footer>${r.updated_at!==r.created_at?`<small>${t('updated',{date:date(r.updated_at)})}</small>`:'<span></span>'}<div>${r.mine?`<button class="text-button" data-rep-action="edit" data-rep-id="${esc(r.id)}">${icon('pencil')}${t('edit')}</button><button class="text-button" data-rep-action="withdraw" data-rep-id="${esc(r.id)}">${t('withdraw')}</button>`:`<button class="text-button" data-rep-action="report" data-rep-id="${esc(r.id)}">${icon('flag')}${t('report')}</button>`}</div></footer></article>`).join('')}</div>${more?`<button class="button secondary rep-more" data-rep-action="more" ${loading?'disabled':''}>${t('more')}</button>`:''}<p class="rep-evidence-note">${t('linkedHelp')}</p>`);
 }
 async function load(append=false){
  const run=++epoch;loading=true;error='';if(!append)data=null;render();
  try{
   const result=await cloud.request(selected?`/api/v1/reputation/clients/${encodeURIComponent(selected)}?offset=${offset}`:`/api/v1/reputation?search=${encodeURIComponent(search)}&offset=${offset}`);
   if(run!==epoch||!visible())return;
   if(append){if(selected)result.reviews=[...data.reviews,...result.reviews];else result.clients=[...data.clients,...result.clients];}
   data=result;more=result.next_offset!==null;loading=false;render();
  }catch(issue){if(run!==epoch||!visible())return;error=t('loadError');loading=false;render();}
 }
 cloud.renderReputationWorkspace=function(container){
  root=container;if(owner!==cloud.navigationOwner)reset();
  render();if(!data&&!loading&&!error)load();
 };
 function close(){if(busy)return;closeFile();dialog?.close();dialog?.remove();dialog=null;}
 function openDialog(title,body){
  close();dialog=cloud.document.createElement('dialog');dialog.className='rep-dialog';dialog.setAttribute('aria-labelledby','rep-dialog-title');
  dialog.innerHTML=`<header><div><span class="eyebrow">${t('community')}</span><h2 id="rep-dialog-title">${title}</h2></div><button type="button" class="rep-close" data-rep-close aria-label="${t('close')}" title="${t('close')}">${icon('x')}</button></header>${body}`;
  cloud.document.body.append(dialog);dialog.addEventListener('cancel',event=>{event.preventDefault();close();});dialog.addEventListener('close',()=>{if(dialog&&!dialog.open&&!busy){dialog.remove();dialog=null;}});dialog.showModal();return dialog;
 }
 async function write(review){
  openDialog(t(review?'edit':'write'),`<p role="status" class="rep-modal-status">${t('loading')}</p>`);
  const current=dialog,runOwner=owner;
  try{
   options=await cloud.request('/api/v1/reputation/review-options');if(current!==dialog||owner!==runOwner||!visible())return;
   if(!options.projects.length){current.querySelector('.rep-modal-status').outerHTML=`<div class="rep-empty"><p>${t('noProjects')}</p><a class="button" href="#clientes" data-rep-close>${t('goClients')}</a></div>`;return;}
   const ownProject=review?options.projects.find(p=>p.id===review.project_id):null;
   if(review&&!ownProject)throw new Error('Review project unavailable');
   const profile=review?data.client:null;
   let step=review?2:1,lookupBusy=false,matchingProjects=[];
   const draft={client:profile,email:profile?.public_email||(!review&&selected?data.client.public_email||'':''),alias:options.alias||'',project_id:ownProject?.id||'',rating:review?.rating||0,communication:review?.communication||'',collaboration:review?.collaboration||'',body:review?.body||'',attachments:[...(review?.attachments||[])],pending:[],filesError:'',uploading:false,filesLoading:false,filesLoadedFor:'',fileRun:0,uploadKeys:new Map()};
   const stage=cloud.document.createElement('div');stage.className='rep-write-stage';current.querySelector('.rep-modal-status').replaceWith(stage);
   const identity=()=>`<section class="rep-write-identity"><span class="rep-client-avatar">${esc((draft.email||'').slice(0,2).toUpperCase())}</span><div><strong>${esc(draft.email||t('emailNotPublished'))}</strong></div></section>`;
   function drawStep(){
    const progress=`<ol class="rep-write-steps" aria-label="${t('writeSteps')}">${[1,2,3].map(n=>`<li ${step===n?'aria-current="step"':''}>${n} · ${t('step'+n)}</li>`).join('')}</ol>`;
    if(step===1){
     stage.innerHTML=`${progress}<form data-rep-identify><p class="rep-form-hint">${t('emailFirst')}</p><label class="field" for="rep-public-email">${t('publicEmail')}</label><input class="context-box" id="rep-public-email" name="public_email" type="email" maxlength="254" required value="${esc(draft.email)}" autocomplete="off" aria-describedby="rep-email-help"><p class="rep-field-help" id="rep-email-help">${t('emailHelp')}</p><p class="rep-error" role="alert" data-rep-error></p><div class="rep-form-actions"><button type="submit" class="button">${t('continue')}${icon('arrow-right')}</button></div></form>`;
     const form=stage.querySelector('form');form.addEventListener('submit',event=>{event.preventDefault();lookup();});
     form.elements.public_email.addEventListener('input',()=>{draft.client=null;draft.project_id='';draft.attachments=[];draft.pending=[];draft.filesLoadedFor='';draft.email=form.elements.public_email.value;matchingProjects=[];});
    }else if(step===2){
     const defaultProject=matchingProjects.some(p=>p.id===draft.project_id)?draft.project_id:(matchingProjects.length===1?matchingProjects[0].id:'');draft.project_id=defaultProject;
     stage.innerHTML=`${progress}${identity()}<form data-rep-review><label class="field" for="rep-alias">${t('alias')}</label><input class="context-box" id="rep-alias" name="alias" required minlength="2" maxlength="60" value="${esc(draft.alias)}"><div class="rep-rating-grid">${['rating','communication','collaboration'].map(key=>ratingField(key,draft[key])).join('')}</div><label class="field" for="rep-body">${t('body')}</label><textarea class="context-box" id="rep-body" name="body" rows="5" required minlength="20" maxlength="3000" aria-describedby="rep-body-help">${esc(draft.body)}</textarea><p class="rep-field-help" id="rep-body-help">${t('bodyHint')}</p><div data-rep-attachments-slot></div><details class="rep-private-proof" ${defaultProject?'':'open'}><summary>${icon('lock-keyhole')}${t('privateProof')}</summary><label class="field" for="rep-project">${t('project')}</label><select class="context-box" id="rep-project" name="project_id" required ${review?'disabled':''}><option value="">${t('select')}</option>${matchingProjects.map(p=>`<option value="${esc(p.id)}" ${p.id===defaultProject?'selected':''}>${esc(p.name)}</option>`).join('')}</select><p class="rep-field-help">${t(matchingProjects.length?'projectHelp':'noClientProjects')}</p>${!matchingProjects.length?`<a class="text-button" href="#clientes" data-rep-close>${t('goClients')}</a>`:''}</details><p class="rep-error" role="alert" data-rep-error></p><div class="rep-form-actions">${!review?`<button type="button" class="button secondary" data-rep-prev>${t('changeClient')}</button>`:''}<button class="button" type="submit">${t('preview')}${icon('arrow-right')}</button></div></form>`;
     const form=stage.querySelector('form');form.addEventListener('change',event=>{const input=event.target,field=input.closest('[data-rep-rating]');if(!field||input.type!=='radio')return;const value=Number(input.value);field.querySelectorAll('label').forEach(label=>label.classList.toggle('is-filled',Number(label.querySelector('input').value)<=value));});form.noValidate=true;form.addEventListener('submit',event=>{event.preventDefault();const proof=form.querySelector('details');if(!form.elements.project_id.value)proof.open=true;if(draft.uploading||draft.filesLoading)return;if(!form.reportValidity())return;capture();step=3;drawStep();});
     form.querySelector('[data-rep-prev]')?.addEventListener('click',()=>{capture();step=1;drawStep();});
     form.elements.project_id.addEventListener('change',()=>{const next=form.elements.project_id.value;if(next!==draft.project_id){if(draft.attachments.length&&!window.confirm(t('filesChangeProject'))){form.elements.project_id.value=draft.project_id;return;}draft.project_id=next;draft.attachments=[];draft.pending=[];draft.filesLoadedFor='';loadPending();}});
     renderFiles();if(defaultProject&&draft.filesLoadedFor!==defaultProject)loadPending();
    }else{
     stage.innerHTML=`${progress}<h3 class="rep-preview-title">${t('previewTitle')}</h3>${identity()}<section class="rep-public-preview"><header><strong>${esc(draft.alias)}</strong><span>${stars(draft.rating)}</span></header><p>${esc(draft.body)}</p><footer><span>${t('communication')}: ${esc(draft.communication)}/5</span><span>${t('collaboration')}: ${esc(draft.collaboration)}/5</span></footer></section>${filesMarkup(draft.attachments)}<p class="rep-field-help">${icon('lock-keyhole')}${t('privateProofHelp')}</p><form data-rep-publish><label class="rep-consent"><input type="checkbox" name="consent" required><span>${t('consent')}</span></label><p class="rep-error" role="alert" data-rep-error></p><div class="rep-form-actions"><button class="button secondary" type="button" data-rep-prev>${t('backToDraft')}</button><button class="button" type="submit">${icon('send')}${t(review?'update':'publish')}</button></div></form>`;
     const form=stage.querySelector('form');form.querySelector('[data-rep-prev]').addEventListener('click',()=>{step=2;drawStep();});
     form.addEventListener('submit',async event=>{event.preventDefault();if(busy||draft.uploading||!form.reportValidity())return;const payload={attachment_ids:draft.attachments.map(file=>file.id),project_id:draft.project_id,profile_id:draft.client?.id||null,review_id:review?.id||null,public_email:draft.email||null,alias:draft.alias,rating:draft.rating,communication:Number(draft.communication),collaboration:Number(draft.collaboration),body:draft.body,consent:form.elements.consent.checked};await mutate(form,()=>cloud.request('/api/v1/reputation/reviews',{method:'POST',body:JSON.stringify(payload)}),result=>{selected=result.profile_id;offset=0;notice=t('saved');load();});});
    }
   }
   function renderFiles(){
    const slot=stage.querySelector('[data-rep-attachments-slot]');if(!slot)return;
    const blocked=draft.uploading||draft.filesLoading||!draft.project_id;
    slot.innerHTML=`<section class="rep-attachment-editor"><header><div><strong>${icon('paperclip')}${t('filesTitle')}</strong><span>${draft.attachments.length}/3</span></div><button type="button" class="button secondary" data-rep-add-file ${blocked||draft.attachments.length>=3?'disabled':''}>${icon('plus')}${t('fileAdd')}</button><input type="file" accept="application/pdf,.pdf" multiple hidden data-rep-files aria-label="${t('fileAdd')}"></header><p class="rep-field-help">${t(draft.project_id?'filesHelp':'filesNeedProject')}</p><ul class="rep-draft-files">${draft.attachments.map(file=>`<li><button class="text-button" type="button" data-rep-file="${esc(file.id)}" data-rep-filename="${esc(file.filename)}">${icon('file-text')}<span>${esc(file.filename)}</span>${icon('eye')}</button><button class="text-button" type="button" data-remove-file="${esc(file.id)}" ${blocked?'disabled':''}>${icon('trash-2')}${t('fileRemove')}</button></li>`).join('')}</ul>${draft.pending.length?`<div class="rep-pending-files"><strong>${t('filesPending')}</strong>${draft.pending.map(file=>`<div><span>${esc(file.filename)}${file.status==='reserved'?` · ${t('fileNotReady')}`:''}</span><div>${file.status==='ready'?`<button class="text-button" type="button" data-include-file="${esc(file.id)}" ${blocked||draft.attachments.length>=3?'disabled':''}>${t('fileInclude')}</button>`:''}<button class="text-button" type="button" data-remove-pending="${esc(file.id)}" ${blocked?'disabled':''}>${t('fileRemove')}</button></div></div>`).join('')}</div>`:''}${draft.uploading||draft.filesLoading?`<p class="rep-file-status" role="status">${t(draft.uploading?'fileUploading':'loading')}</p>`:''}${draft.filesError?`<p class="rep-error" role="alert">${esc(draft.filesError)}</p><button class="text-button" type="button" data-rep-files-reload ${blocked?'disabled':''}>${t('filesRefresh')}</button>`:''}</section>`;
    slot.querySelector('[data-rep-add-file]').addEventListener('click',()=>slot.querySelector('[data-rep-files]').click());
    slot.querySelector('[data-rep-files]').addEventListener('change',event=>{const files=[...event.target.files];event.target.value='';uploadFiles(files);});
    slot.querySelectorAll('[data-remove-file]').forEach(button=>button.addEventListener('click',()=>removeFile(button.dataset.removeFile,false)));
    slot.querySelectorAll('[data-remove-pending]').forEach(button=>button.addEventListener('click',()=>removeFile(button.dataset.removePending,true)));
    slot.querySelectorAll('[data-include-file]').forEach(button=>button.addEventListener('click',()=>{if(draft.attachments.length>=3)return;const file=draft.pending.find(f=>f.id===button.dataset.includeFile);draft.attachments.push(file);draft.pending=draft.pending.filter(f=>f.id!==file.id);renderFiles();}));
    slot.querySelector('[data-rep-files-reload]')?.addEventListener('click',()=>loadPending());
    const form=stage.querySelector('[data-rep-review]');if(form){form.querySelector('[type="submit"]').disabled=draft.uploading||draft.filesLoading;form.elements.project_id.disabled=Boolean(review)||draft.uploading;form.querySelector('[data-rep-prev]')?.toggleAttribute('disabled',draft.uploading);}
   }
   async function loadPending(){
    const project=draft.project_id;if(!project){renderFiles();return;}const run=++draft.fileRun;draft.filesLoading=true;renderFiles();
    try{const result=await cloud.request(`/api/v1/reputation/attachments?project_id=${encodeURIComponent(project)}`);if(dialog!==current||runOwner!==owner||run!==draft.fileRun)return;draft.pending=result.attachments.filter(file=>!draft.attachments.some(f=>f.id===file.id));draft.filesLoadedFor=project;draft.filesError='';}
    catch(issue){if(dialog===current&&run===draft.fileRun)draft.filesError=message(issue);}
    finally{if(dialog===current&&run===draft.fileRun){draft.filesLoading=false;renderFiles();}}
   }
   async function uploadFiles(files){
    if(!files.length||draft.uploading||!draft.project_id)return;
    if(files.length+draft.attachments.length>3){draft.filesError=t('fileLimit');renderFiles();return;}
    if(files.some(file=>!file.name.toLowerCase().endsWith('.pdf')||(file.type&&file.type!=='application/pdf'))){draft.filesError=t('fileFormat');renderFiles();return;}
    if(files.some(file=>file.size>10485760||file.size<5)){draft.filesError=t('fileSize');renderFiles();return;}
    capture();const project=draft.project_id;draft.uploading=true;draft.filesError='';renderFiles();
    try{for(const file of files){const fingerprint=`${file.name}:${file.size}:${file.lastModified}`;if(!draft.uploadKeys.has(fingerprint))draft.uploadKeys.set(fingerprint,crypto.randomUUID());const result=await cloud.request(`/api/v1/reputation/attachments?project_id=${encodeURIComponent(project)}&filename=${encodeURIComponent(file.name)}`,{method:'POST',headers:{'Content-Type':'application/pdf','Idempotency-Key':draft.uploadKeys.get(fingerprint)},body:file});if(dialog!==current||runOwner!==owner||!visible())return;if(!result.id||!['ready','attached'].includes(result.status))throw new Error('Invalid attachment response');if(!draft.attachments.some(f=>f.id===result.id))draft.attachments.push(result);draft.pending=draft.pending.filter(f=>f.id!==result.id);renderFiles();}}
    catch(issue){if(dialog===current)draft.filesError=message(issue);}
    finally{if(dialog===current){draft.uploading=false;renderFiles();}}
   }
   async function removeFile(id,pending){
    if(draft.uploading)return;const file=(pending?draft.pending:draft.attachments).find(f=>f.id===id);if(!file)return;draft.uploading=true;renderFiles();
    try{if(file.status!=='attached')await cloud.request(`/api/v1/reputation/attachments/${encodeURIComponent(id)}`,{method:'DELETE'});if(dialog!==current||runOwner!==owner)return;draft.attachments=draft.attachments.filter(f=>f.id!==id);draft.pending=draft.pending.filter(f=>f.id!==id);draft.filesError='';}
    catch(issue){if(dialog===current)draft.filesError=message(issue);}
    finally{if(dialog===current){draft.uploading=false;renderFiles();}}
   }
   async function lookup(){
    if(lookupBusy)return;const form=stage.querySelector('form'),input=form.elements.public_email;if(!form.reportValidity())return;
    draft.email=input.value.trim().toLowerCase();lookupBusy=true;const button=form.querySelector('[type="submit"]');button.disabled=true;input.disabled=true;button.setAttribute('aria-busy','true');button.textContent=t('loading');form.querySelector('[data-rep-error]').textContent='';
    try{
     const result=await cloud.request('/api/v1/reputation/lookup',{method:'POST',body:JSON.stringify({public_email:draft.email})});
     if(dialog!==current||runOwner!==owner||!visible())return;
     draft.client=result.client;draft.email=result.client?.public_email||draft.email;
     if(await loadClientProjects()){step=2;drawStep();}
    }catch(issue){if(dialog===current&&form.isConnected)form.querySelector('[data-rep-error]').textContent=message(issue);}
    finally{lookupBusy=false;if(dialog===current&&form.isConnected){button.disabled=false;input.disabled=false;button.removeAttribute('aria-busy');button.innerHTML=t('continue')+icon('arrow-right');}}
   }
   async function loadClientProjects(){
    const email=draft.email.trim().toLowerCase(),clientId=draft.client?.id;
    const result=await cloud.request('/api/v1/reputation/review-options'+(email?'?public_email='+encodeURIComponent(email):''));
    if(dialog!==current||owner!==runOwner||!visible())return false;
    matchingProjects=result.projects.filter(project=>project.profile_id?project.profile_id===clientId:email&&String(project.client_email||'').trim().toLowerCase()===email);
    return true;
   }
   function capture(){const form=stage.querySelector('form');draft.alias=form.elements.alias.value;draft.body=form.elements.body.value;draft.rating=Number(form.elements.rating.value);draft.communication=form.elements.communication.value;draft.collaboration=form.elements.collaboration.value;draft.project_id=ownProject?.id||form.elements.project_id.value;}
   if(review&&!await loadClientProjects())return;
   drawStep();
  }catch(issue){if(current===dialog){const status=current.querySelector('.rep-modal-status');if(status)status.outerHTML=`<div class="rep-empty" role="alert"><p>${esc(message(issue))}</p><button class="button secondary" data-rep-close>${t('close')}</button></div>`;}}
 }
 async function mutate(form,operation,done){
  if(busy)return;busy=true;const buttons=[...dialog.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);const current=dialog,runOwner=owner;
  try{const result=await operation();if(current!==dialog||runOwner!==owner||!visible())return;busy=false;close();done(result);}
  catch(issue){if(current===dialog&&runOwner===owner){form.querySelector('[data-rep-error]').textContent=message(issue);}}
  finally{if(current===dialog){busy=false;buttons.forEach(b=>b.disabled=false);}}
 }
 function report(id){
  const current=openDialog(t('report'),`<form data-rep-report><label class="field" for="rep-reason">${t('reason')}</label><select class="context-box" id="rep-reason" name="reason" required><option value="">${t('select')}</option>${['identity','privacy','abuse','other'].map(r=>`<option value="${r}">${t(r)}</option>`).join('')}</select><label class="field" for="rep-details">${t('reportDetails')}</label><textarea class="context-box" id="rep-details" name="details" required minlength="10" maxlength="1500" rows="4"></textarea><p role="alert" class="rep-error" data-rep-error></p><div class="rep-form-actions"><button type="button" class="button secondary" data-rep-close>${t('cancel')}</button><button class="button">${t('sendReport')}</button></div></form>`);
  const form=current.querySelector('form');form.addEventListener('submit',async event=>{event.preventDefault();if(!form.reportValidity())return;await mutate(form,()=>cloud.request('/api/v1/reputation/reviews/report',{method:'POST',body:JSON.stringify({review_id:id,...Object.fromEntries(new FormData(form))})}),()=>{notice=t('reported');render();});});
 }
 cloud.document.addEventListener('submit',event=>{
  if(!event.target.matches('[data-rep-search]'))return;event.preventDefault();search=String(new FormData(event.target).get('search')||'').trim();offset=0;notice='';load();
 });
 cloud.document.addEventListener('click',async event=>{
  if(event.target.closest('[data-rep-file-close]')){closeFile();return;}
  const fileButton=event.target.closest('[data-rep-file]');if(fileButton&&visible()){previewFile(fileButton.dataset.repFile,fileButton.dataset.repFilename);return;}
  if(event.target.closest('[data-rep-close]')){close();return;}
  const action=event.target.closest('[data-rep-action]');if(!action||!visible())return;
  const id=action.dataset.repId;
  switch(action.dataset.repAction){
   case 'ai-start':await runAnalysis();break;
   case 'ai-check':await runAnalysis(true);break;
   case 'open':stopAnalysis();selected=id;offset=0;notice='';load();break;
   case 'back':stopAnalysis();selected='';offset=0;notice='';load();break;
   case 'clear':search='';offset=0;load();break;
   case 'retry':load();break;
   case 'more':offset=data.next_offset;load(true);break;
   case 'write':write();break;
   case 'edit':write(data.reviews.find(r=>r.id===id&&r.mine));break;
   case 'report':report(id);break;
   case 'withdraw':{
    if(!window.confirm(t('withdrawConfirm')))break;
    action.disabled=true;
    try{await cloud.request('/api/v1/reputation/reviews/withdraw',{method:'POST',body:JSON.stringify({review_id:id})});notice=t('withdrawn');selected='';offset=0;load();}catch(issue){notice=message(issue);render();}break;
   }
  }
 });
 window.addEventListener('hashchange',()=>{if(cloud.location.hash!=='#reputacion'){stopAnalysis();closeFile();epoch++;loading=false;if(dialog){dialog.remove();dialog=null;}busy=false;}});
}
