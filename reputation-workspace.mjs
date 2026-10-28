import {uiText,uiLocale} from './i18n.mjs';
import {icon} from './icons.mjs';
const t=(key,values)=>uiText(`reputation.${key}`,values);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const count=n=>n===1?t('oneReview'):t('reviews',{count:new Intl.NumberFormat(uiLocale()).format(n)});
const number=n=>n===null?'—':new Intl.NumberFormat(uiLocale(),{maximumFractionDigits:1,minimumFractionDigits:1}).format(n);
const stars=(value=0)=>`<span class="rep-stars" aria-hidden="true">${Array.from({length:5},(_,i)=>`<span class="${i<Math.round(value)?'is-filled':''}">${icon('star')}</span>`).join('')}</span>`;
const date=value=>new Intl.DateTimeFormat(uiLocale(),{dateStyle:'medium',timeZone:'America/Lima'}).format(new Date(value));
const ratingOptions=value=>`<option value="">${t('select')}</option>${[1,2,3,4,5].map(n=>`<option value="${n}" ${Number(value)===n?'selected':''}>${t('rating',{value:n})}</option>`).join('')}`;
export function installReputationWorkspace(cloud){
 let owner='',data=null,search='',selected='',offset=0,more=false,loading=false,error='',notice='',epoch=0,options=null,dialog=null,busy=false,root=null;
 const visible=()=>cloud.active&&cloud.navigationOwner===owner&&cloud.location.hash==='#reputacion';
 function reset(){owner=cloud.navigationOwner;data=null;search='';selected='';offset=0;more=false;loading=false;error='';notice='';options=null;epoch++;if(dialog){dialog.remove();dialog=null;}busy=false;}
 const originalReset=cloud.reset.bind(cloud);cloud.reset=function(){reset();return originalReset();};
 function message(issue){const codes={REPUTATION_INVALID:'invalid',REPUTATION_CONSENT_REQUIRED:'invalid',REPUTATION_CLIENT_MISMATCH:'mismatch',REPUTATION_REVIEW_EXISTS:'exists',REPUTATION_REVIEW_HIDDEN:'hidden',REPUTATION_NOT_FOUND:'notFound',PROJECT_NOT_FOUND:'notFound'};return t(codes[issue?.code]||'error');}
 function shell(content){return `<section class="rep-workspace" data-reputation><header class="rep-heading"><div><span class="eyebrow">${t('community')}</span><h2>${t(selected?'reviewHeading':'intro')}</h2><p>${t('introCopy')}</p></div><button class="button" data-rep-action="write">${icon('pencil')}${t('write')}</button></header>${notice?`<p class="rep-notice" role="status">${esc(notice)}</p>`:''}${content}</section>`;}
 function render(){
  if(!root?.isConnected||!visible())return;
  if(loading&&!data){root.innerHTML=shell(`<div class="rep-loading" role="status" aria-label="${t('loading')}"><div></div><div></div><div></div><span class="sr-only">${t('loading')}</span></div>`);return;}
  if(error){root.innerHTML=shell(`<section class="workspace-panel rep-empty" role="alert"><p>${esc(error)}</p><button class="button secondary" data-rep-action="retry">${t('retry')}</button></section>`);return;}
  if(!data)return;
  if(selected){renderDetail();return;}
  root.innerHTML=shell(`<div class="rep-directory-tools"><form data-rep-search role="search"><label for="rep-search" class="sr-only">${t('search')}</label><span aria-hidden="true">${icon('search')}</span><input id="rep-search" name="search" type="search" maxlength="160" value="${esc(search)}" placeholder="${t('searchPlaceholder')}"><button class="button secondary">${t('searchAction')}</button></form><span>${icon('users')}${t('private')}</span></div>${data.clients.length?`<div class="rep-directory" aria-label="${t('directory')}">${data.clients.map(client=>`<article class="rep-client-card"><header><span class="rep-client-avatar">${esc(client.name.slice(0,2).toUpperCase())}</span><div><h3>${esc(client.name)}</h3>${client.location?`<p>${icon('map-pin')}${esc(client.location)}</p>`:''}</div></header><div class="rep-card-rating"><strong>${number(client.rating)}</strong>${stars(client.rating)}<span>${count(client.review_count)}</span></div><button class="text-button" data-rep-action="open" data-rep-id="${esc(client.id)}">${t('open')}${icon('arrow-right')}</button></article>`).join('')}</div>${more?`<button class="button secondary rep-more" data-rep-action="more" ${loading?'disabled':''}>${t('more')}</button>`:''}`:`<section class="rep-empty workspace-panel"><span class="rep-empty-icon">${icon('star')}</span><h3>${t(search?'noResults':'emptyTitle')}</h3>${!search?`<p>${t('emptyCopy')}</p>`:''}${search?`<button class="button secondary" data-rep-action="clear">${t('all')}</button>`:''}</section>`}<aside class="rep-community-note">${icon('users')}<div><strong>${t('opinion')}</strong><p>${t('privateCopy')}</p></div></aside>`);
 }
 function renderDetail(){
  const c=data.client;
  root.innerHTML=shell(`<button class="text-button rep-back" data-rep-action="back">${icon('arrow-left')}${t('back')}</button><section class="rep-profile workspace-panel"><div class="rep-profile-identity"><span class="rep-client-avatar">${esc(c.name.slice(0,2).toUpperCase())}</span><div><h2>${esc(c.name)}</h2>${c.location?`<p>${icon('map-pin')}${esc(c.location)}</p>`:''}${c.website?`<a href="${esc(c.website)}" target="_blank" rel="noopener noreferrer">${icon('globe')}${esc(c.website)}${icon('arrow-up-right')}</a>`:''}</div></div><div class="rep-profile-score"><strong>${number(c.rating)}</strong>${stars(c.rating)}<span>${count(c.review_count)}</span></div><div class="rep-score-breakdown"><div><span>${t('communication')}</span><strong>${number(c.communication)}<small> / 5</small></strong></div><div><span>${t('scope')}</span><strong>${number(c.scope)}<small> / 5</small></strong></div></div></section><div class="rep-review-list">${data.reviews.map(r=>`<article class="rep-review workspace-panel"><header><div class="rep-author"><span>${esc(r.alias.slice(0,2).toUpperCase())}</span><div><strong>${esc(r.alias)}</strong><small>${r.mine?t('own'):t('author')}</small></div></div><time datetime="${esc(r.created_at)}">${date(r.created_at)}</time></header><div class="rep-review-rating"><span aria-label="${t('rating',{value:r.rating})}">${stars(r.rating)}</span><span class="rep-project-badge" title="${t('linkedHelp')}">${icon('file-text')}${t('linked')}</span></div><p class="rep-review-copy">${esc(r.body)}</p><div class="rep-review-facts"><span>${icon('credit-card')}${t(r.payment)}</span><span>${t('communication')}: ${r.communication}/5</span><span>${t('scope')}: ${r.scope}/5</span></div><footer>${r.updated_at!==r.created_at?`<small>${t('updated',{date:date(r.updated_at)})}</small>`:'<span></span>'}<div>${r.mine?`<button class="text-button" data-rep-action="edit" data-rep-id="${esc(r.id)}">${icon('pencil')}${t('edit')}</button><button class="text-button" data-rep-action="withdraw" data-rep-id="${esc(r.id)}">${t('withdraw')}</button>`:`<button class="text-button" data-rep-action="report" data-rep-id="${esc(r.id)}">${icon('flag')}${t('report')}</button>`}</div></footer></article>`).join('')}</div>${more?`<button class="button secondary rep-more" data-rep-action="more" ${loading?'disabled':''}>${t('more')}</button>`:''}<p class="rep-evidence-note">${t('linkedHelp')}</p>`);
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
 function close(){if(busy)return;dialog?.close();dialog?.remove();dialog=null;}
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
   const project=review?options.projects.find(p=>p.id===review.project_id):null;
   const profiles=data?.clients||[data?.client].filter(Boolean);const initialProfile=project?.profile_id||selected;
   const starsInput=`<fieldset class="rep-rating-input"><legend>${t('overall')}</legend><div>${[1,2,3,4,5].map(n=>`<label title="${t('chooseRating',{value:n})}"><input type="radio" name="rating" value="${n}" required ${review?.rating===n?'checked':''} aria-label="${t('chooseRating',{value:n})}"><span>${icon('star')}</span></label>`).join('')}</div></fieldset>`;
   current.querySelector('.rep-modal-status').outerHTML=`<form data-rep-review><p class="rep-form-hint">${t('formHint')}</p><label class="field" for="rep-project">${t('project')}</label><select class="context-box" id="rep-project" name="project_id" required ${review?'disabled':''}><option value="">${t('select')}</option>${options.projects.map(p=>`<option value="${esc(p.id)}" ${project?.id===p.id?'selected':''}>${esc(p.client_name)} · ${esc(p.name)}</option>`).join('')}</select><p class="rep-field-help">${t('projectHelp')}</p><label class="field" for="rep-profile">${t('profile')}</label><select class="context-box" id="rep-profile" name="profile_id" ${review?'disabled':''}><option value="">${t('newProfile')}</option>${profiles.map(c=>`<option value="${esc(c.id)}" ${c.id===initialProfile?'selected':''}>${esc(c.name)}</option>`).join('')}${initialProfile&&!profiles.some(c=>c.id===initialProfile)?`<option value="${esc(initialProfile)}" selected>${esc(project?.profile_name||'')}</option>`:''}</select><p class="rep-field-help">${t('profileHelp')}</p><div data-rep-new-profile ${initialProfile?'hidden':''}><label class="field" for="rep-name">${t('name')}</label><input class="context-box" id="rep-name" name="name" maxlength="160" minlength="2" ${initialProfile?'':'required'}><div class="rep-form-columns"><div><label class="field" for="rep-location">${t('location')}</label><input class="context-box" id="rep-location" name="location" maxlength="120"></div><div><label class="field" for="rep-website">${t('website')}</label><input class="context-box" id="rep-website" name="website" type="url" maxlength="300" placeholder="https://"></div></div></div><label class="field" for="rep-alias">${t('alias')}</label><input class="context-box" id="rep-alias" name="alias" required minlength="2" maxlength="60" value="${esc(options.alias||'')}">${starsInput}<label class="field" for="rep-payment">${t('paymentExperience')}</label><select class="context-box" id="rep-payment" name="payment" required><option value="">${t('select')}</option>${['on_time','late','unpaid','not_applicable'].map(key=>`<option value="${key}" ${review?.payment===key?'selected':''}>${t(key)}</option>`).join('')}</select><div class="rep-form-columns">${['communication','scope'].map(key=>`<div><label class="field" for="rep-${key}">${t(key)}</label><select class="context-box" name="${key}" id="rep-${key}" required>${ratingOptions(review?.[key])}</select></div>`).join('')}</div><label class="field" for="rep-body">${t('body')}</label><textarea class="context-box" id="rep-body" name="body" rows="5" required minlength="20" maxlength="3000" aria-describedby="rep-body-help">${esc(review?.body||'')}</textarea><p class="rep-field-help" id="rep-body-help">${t('bodyHint')}</p><label class="rep-consent"><input type="checkbox" name="consent" required><span>${t('consent')}</span></label><p class="rep-error" role="alert" data-rep-error></p><div class="rep-form-actions"><button type="button" class="button secondary" data-rep-close>${t('cancel')}</button><button class="button" type="submit">${icon('send')}${t(review?'update':'publish')}</button></div></form>`;
   const form=current.querySelector('form');
   form.addEventListener('change',event=>{
    if(event.target.name==='project_id'){
     const p=options.projects.find(p=>p.id===event.target.value),picker=form.elements.profile_id;
     if(p?.profile_id){if(![...picker.options].some(o=>o.value===p.profile_id))picker.add(new Option(p.profile_name,p.profile_id));picker.value=p.profile_id;}
     if(p&&!form.elements.name.value)form.elements.name.value=p.client_name;
    }
    const fresh=!form.elements.profile_id.value;form.querySelector('[data-rep-new-profile]').hidden=!fresh;form.elements.name.required=fresh;
   });
   form.addEventListener('submit',async event=>{
    event.preventDefault();if(busy||!form.reportValidity())return;
    const payload=Object.fromEntries(new FormData(form));payload.project_id=project?.id||payload.project_id;payload.profile_id=initialProfile&&review?initialProfile:payload.profile_id||null;payload.review_id=review?.id||null;
    for(const key of ['rating','communication','scope'])payload[key]=Number(payload[key]);payload.consent=payload.consent==='on';
    await mutate(form,()=>cloud.request('/api/v1/reputation/reviews',{method:'POST',body:JSON.stringify(payload)}),result=>{selected=result.profile_id;offset=0;notice=t('saved');load();});
   });
  }catch(issue){if(current===dialog)current.querySelector('.rep-modal-status').outerHTML=`<div class="rep-empty" role="alert"><p>${esc(message(issue))}</p><button class="button secondary" data-rep-close>${t('close')}</button></div>`;}
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
  if(event.target.closest('[data-rep-close]')){close();return;}
  const action=event.target.closest('[data-rep-action]');if(!action||!visible())return;
  const id=action.dataset.repId;
  switch(action.dataset.repAction){
   case 'open':selected=id;offset=0;notice='';load();break;
   case 'back':selected='';offset=0;notice='';load();break;
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
 window.addEventListener('hashchange',()=>{if(cloud.location.hash!=='#reputacion'){epoch++;loading=false;if(dialog){dialog.remove();dialog=null;}busy=false;}});
}
