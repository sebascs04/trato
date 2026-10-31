import {renderAIActivity} from './ai-activity.mjs';
import {icon} from './icons.mjs';
import {uiText,uiLanguage} from './i18n.mjs';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const scenarios={scope:{request:'REQ-SP-001',label:'practice.scope'},payment:{request:'REQ-SP-002',label:'practice.payment'},refund:{request:'REQ-SP-003',label:'practice.refund'}};
const traits=[['patience','practice.patience','practice.impatient','practice.patient'],['flexibility','practice.flexibility','practice.rigid','practice.flexible'],['price','practice.price','practice.low','practice.high']];
export function validatePracticeSettings(value){
 if(!value||value.version!==1||!Object.hasOwn(scenarios,value.scenario))throw Error(uiText('practice.invalidCase'));
 if(!value.persona||Object.keys(value.persona).length!==3||traits.some(([name])=>!Number.isInteger(value.persona[name])||value.persona[name]<1||value.persona[name]>5))throw Error(uiText('practice.invalidTrait'));
 return {version:1,scenario:value.scenario,persona:{...value.persona}};
}
export function buildPracticeContext(settings,data,language=uiLanguage()){
 const config=validatePracticeSettings(settings);
 if(!['es','en'].includes(language))throw Error('Unsupported rehearsal language');
 const request=data.requests.find(item=>item.id===scenarios[config.scenario].request);
 const message=data.messages.find(item=>item.id===request?.sourceMessageId);
 const agreement=data.documentVersions.find(item=>item.id===request?.sourceVersionId);
 const conversation=data.conversations.find(item=>item.id===message?.conversationId),document=data.documents.find(item=>item.id===agreement?.documentId);
 if(!request||!message||!agreement||conversation?.projectId!==request.projectId||document?.projectId!==request.projectId)throw Error(uiText('practice.invalidCase'));
 return {type:'practice_configuration',schema_version:1,mode:'rehearsal',output_language:language,
  persona:{patience:config.persona.patience,flexibility:config.persona.flexibility,price_sensitivity:config.persona.price},
  goal_key:`practice.goalDefault.${config.scenario}`,scenario_id:config.scenario,
  source_context:{kind:'fixture',project_id:request.projectId,request_id:request.id,agreement_version_id:agreement.id,message_id:message.id},
  sources:{request:message.content,agreement:agreement.content},
  allowed_tools:[],affects_business_state:false};
}
function renderAIWait(label,hint){return renderAIActivity({label:uiText(label),hint:uiText(hint)});}
function renderPracticeEvaluation(state){
 const data=state.evaluation,selected=state.evaluationIndex;
 if(!data){
  const pending=['queued','running'].includes(state.evaluationStatus),busy=state.evaluationSubmitting;
  return `<section class="practice-evaluation" aria-label="${uiText('eval.title')}" aria-busy="${pending||busy}">${pending||busy?renderAIWait(pending&&state.evaluationStatus==='queued'?'practice.evalQueued':'practice.evalRunning','practice.analysisWaitHint'):`<p>${uiText('practice.evalReady')}</p>`}${state.evaluationError?`<p class="cloud-error" role="alert">${esc(state.evaluationError)}</p>`:''}${pending||busy?'':`<button class="button" type="button" data-practice-evaluate>${icon('sparkles')}${uiText(state.submissionUncertain?'practice.evalRetry':state.jobId&&state.evaluationStatus!=='failed'?'practice.evalCheck':'practice.evalStart')}</button>`}</section>`;
 }
 return `<section class="practice-evaluation" aria-label="${uiText('eval.title')}"><header><h3>${uiText('eval.title')}</h3><p>${esc(data.summary)}</p><small>${esc(uiText('practice.evalSourcesRead',{count:data.sources_read}))}</small></header><nav class="practice-message-switcher" aria-label="${uiText('eval.messages')}">${data.items.map((_,i)=>`<button type="button" data-practice-evaluation="${i}" aria-pressed="${i===selected}">${uiText('eval.message',{number:i+1})}</button>`).join('')}</nav>${data.items.map((item,i)=>{const client=state.messages[item.message_index-1];return `<article class="practice-evaluation-card" ${i===selected?'':'hidden'}><h4>${uiText('eval.message',{number:i+1})}</h4><div class="practice-evaluation-exchange"><div><small>${uiText('eval.yourMessage')}</small><blockquote class="practice-evidence">${esc(item.evidence_quote)}</blockquote></div><div><small>${uiText('eval.clientMessage')}</small><p>${esc(client?.text)}</p></div></div><section class="practice-evaluation-finding"><span class="badge review">${uiText(`practice.evalAssessment.${item.assessment}`)}</span><strong>${uiText('eval.finding')}</strong><p>${esc(item.finding)}</p></section>${item.suggestion?`<section class="practice-evaluation-example"><strong>${uiText('eval.suggestedReply')}</strong><p>${esc(item.suggestion)}</p></section>`:''}<div class="practice-evaluation-reason"><strong>${uiText('practice.expertBasis')}</strong><p>${esc(item.why)}</p>${item.citations.map(c=>{const locator=c.locator.kind==='page'?uiText('practice.evalPage',{number:c.locator.page}):c.locator.kind==='paragraph'?uiText('practice.evalParagraph',{number:c.locator.paragraph}):c.locator.section;const href=typeof c.url==='string'&&c.url.startsWith('https://')?c.url:'';return `<section class="practice-source-citation"><header><span>${esc(uiText('practice.expertReference',{author:c.author}))}</span><strong>${esc(c.title)}</strong><small>${esc(locator)}</small></header><blockquote>${esc(c.quote)}</blockquote>${href?`<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${uiText('practice.originalDocument')}${icon('arrow-up-right')}</a>`:''}</section>`;}).join('')}</div></article>`;}).join('')}<div class="practice-message-pager"><button class="button secondary" data-practice-evaluation="previous" ${selected===0?'disabled':''}>${icon('arrow-left')}${uiText('eval.previous')}</button><span role="status">${uiText('eval.position',{number:selected+1,total:data.items.length})}</span><button class="button secondary" data-practice-evaluation="next" ${selected===data.items.length-1?'disabled':''}>${uiText('eval.nextMessage')}${icon('arrow-right')}</button></div><p class="practice-note">${uiText('eval.noScore')}</p></section>`;
}
export function installPracticeWorkspace(cloud){
 window.addEventListener('hashchange',()=>{if(window.location.hash!=='#ensayos'&&cloud.active)cloud.scheduleIngestionPolling();});
 let owner='',settings,baseline='',error='',rehearsal=null,pollTimer=null,replyTimer=null;
 const key=()=>{if(!cloud.navigationOwner||!cloud.session?.key)throw Error(uiText('practice.invalid'));return `${cloud.session.key}:practice:${cloud.navigationOwner}`;};
 function load(){
  if(owner===cloud.navigationOwner&&settings)return;
  owner=cloud.navigationOwner;baseline='';error='';rehearsal=null;
  const raw=cloud.storage.getItem(key());
  if(raw!==null){try{settings=validatePracticeSettings(JSON.parse(raw));baseline=JSON.stringify(settings);}catch{settings=null;error=uiText('practice.invalid');}}
  else {settings={version:1,scenario:'scope',persona:{patience:3,flexibility:3,price:3}};baseline=JSON.stringify(settings);}
  const saved=cloud.storage.getItem(key()+':evaluation');
  if(saved!==null&&settings){
   try{
    const record=JSON.parse(saved),config=validatePracticeSettings(record.settings);
    if(record.version!==1||!/^[-0-9a-f]{36}$/.test(record.jobId)||!Array.isArray(record.messages)||record.messages.length<2||record.messages.some((m,i)=>m.role!==(i%2?'user':'client')||typeof m.text!=='string'||!m.text||m.text.length>4000))throw Error('Invalid saved evaluation');
    rehearsal={context:buildPracticeContext(config,window.TRATO_DATA),ended:true,view:'analysis',evaluationIndex:0,messages:record.messages,jobId:record.jobId,evaluationPayload:record.payload,submissionUncertain:!record.submitted,evaluationStatus:'unavailable'};
    if(record.submitted)pollTimer=setTimeout(()=>pollEvaluation(rehearsal),0);
   }catch{settings=null;error=uiText('practice.invalid');}
  }
  if(!rehearsal&&settings){
   const savedDialogue=cloud.storage.getItem(key()+':dialogue');
   if(savedDialogue!==null){try{
    const record=JSON.parse(savedDialogue),config=validatePracticeSettings(record.settings);
    if(record.version!==1||!['es','en'].includes(record.output_language)||!Array.isArray(record.messages)||record.messages.some((m,i)=>m.role!==(i%2?'user':'client')||typeof m.text!=='string'||!m.text))throw Error('Invalid dialogue');
    rehearsal={context:buildPracticeContext(config,window.TRATO_DATA,record.output_language),ended:record.ended===true,view:record.ended?'analysis':'conversation',evaluationIndex:0,messages:record.messages,replyJobId:record.jobId,replyPayload:record.payload,replyStatus:record.jobId?'unavailable':'idle',replyUncertain:record.uncertain};
    if(record.jobId&&!record.uncertain&&!record.ended)replyTimer=setTimeout(()=>pollReply(rehearsal),0);
   }catch{settings=null;error=uiText('practice.invalid');}}
  }
 }
 cloud.renderPracticeWorkspace=function(root){
  try{load();}catch{root.innerHTML=`<p class="cloud-error" role="alert">${esc(uiText('practice.storageError'))}</p>`;return;}
  if(!settings){root.innerHTML=`<section class="workspace-panel"><p class="cloud-error" role="alert">${esc(error)}</p><button class="button" data-practice-reset>${uiText('practice.reset')}</button></section>`;return;}
  if(rehearsal){renderConversation(root);return;}
  const slider=([name,label,low,high])=>`<section class="practice-trait"><div class="practice-trait-heading"><label for="practice-${name}">${uiText(label)}</label><output for="practice-${name}" data-practice-level="${name}">${settings.persona[name]}<small>/ 5</small></output></div><input id="practice-${name}" name="${name}" type="range" min="1" max="5" step="1" value="${settings.persona[name]}" aria-describedby="practice-${name}-help" aria-valuetext="${esc(uiText('practice.level',{value:settings.persona[name]}))}"><div class="practice-scale"><span>${uiText(low)}</span><span>${uiText(high)}</span></div><p id="practice-${name}-help" data-practice-description="${name}">${uiText(`practice.${name}.${settings.persona[name]}`)}</p></section>`;
  root.innerHTML=`<section class="practice-introduction"><h2>${uiText('practice.introTitle')}</h2><p>${uiText('practice.intro')}</p></section><div class="practice-workspace"><form class="workspace-panel practice-form" data-practice-form><header class="practice-config-header"><span class="practice-config-icon" aria-hidden="true">${icon('messages-square')}</span><div><span class="eyebrow">${uiText('practice.eyebrow')}</span><h2>${uiText('practice.configure')}</h2></div></header><label class="field" for="practice-case">${uiText('practice.case')}</label><select class="context-box" id="practice-case" name="scenario">${Object.entries(scenarios).map(([id,value])=>`<option value="${id}" ${settings.scenario===id?'selected':''}>${uiText(value.label)}</option>`).join('')}</select><div class="practice-persona-heading"><h3>${uiText('practice.persona')}</h3><p>${uiText('practice.personaHint')}</p></div><div class="practice-traits-grid">${traits.map(slider).join('')}</div><p class="practice-note">${uiText('practice.respect')}</p><p class="practice-note">${uiText('practice.savedHint')}</p><div class="practice-config-actions"><button class="button" type="button" data-practice-start>${icon('messages-square')}${uiText('practice.start')}</button><button class="button secondary" type="submit" data-practice-save>${icon('save')}<span data-practice-save-label>${uiText('practice.save')}</span></button></div><p role="status" data-practice-status></p><p class="cloud-error" role="alert" data-practice-error>${esc(error)}</p></form></div>`;
  updateSaveState();
 };
 function updateSaveState(){
  const button=cloud.document.querySelector('[data-practice-save]');if(!button)return;
  const dirty=JSON.stringify(validatePracticeSettings(settings))!==baseline;
  button.classList.toggle('has-unsaved-changes',dirty);
  button.querySelector('[data-practice-save-label]').textContent=uiText(dirty?'practice.saveChanges':'practice.save');
  const status=cloud.document.querySelector('[data-practice-status]');
  status.textContent=dirty?uiText('practice.unsaved'):'';
 }
 function persist(){
  const context=buildPracticeContext(settings,window.TRATO_DATA);
  cloud.storage.setItem(key(),JSON.stringify(validatePracticeSettings(settings)));
  cloud.practiceContext=context;baseline=JSON.stringify(validatePracticeSettings(settings));return context;
 }
 function renderConversation(root){
  const {context,messages}=rehearsal,finished=rehearsal.ended,analysis=rehearsal.view==='analysis',replyBusy=rehearsal.replySubmitting||['queued','running'].includes(rehearsal.replyStatus);
  root.innerHTML=`<section class="workspace-panel practice-conversation"><header class="practice-conversation-heading"><div><span class="eyebrow">${uiText('practice.simulation')}</span><h2 id="practice-conversation-title" tabindex="-1">${uiText(scenarios[context.scenario_id].label)}</h2><p>${uiText('practice.scriptHint')}</p></div><button class="text-button" data-practice-back>${uiText('practice.back')}</button></header><ol class="practice-stepper" aria-label="${uiText('practice.steps')}">${[['conversation','practice.stepConversation'],['analysis','eval.title']].map(([id,label],index)=>`<li><button type="button" data-practice-step="${id}" ${rehearsal.view===id?'aria-current="step"':''} ${id==='analysis'&&!finished?'disabled':''}><span>${index+1}</span><strong>${uiText(label)}</strong>${id==='conversation'&&finished?icon('check'):''}</button></li>`).join('')}</ol><div class="practice-stage-content">${analysis?`<section class="practice-finished"><h3 id="practice-finish" tabindex="-1">${uiText('practice.finished')}</h3>${renderPracticeEvaluation(rehearsal)}</section>`:`<div class="practice-chat" role="log" aria-label="${uiText('practice.conversation')}" aria-live="polite">${messages.map(message=>`<article class="practice-message ${message.role==='user'?'is-user':''}"><span class="practice-message-avatar" aria-hidden="true">${message.role==='user'?esc(cloud.profile.textContent.trim()):icon('user-round')}</span><div class="practice-message-bubble"><strong>${uiText(message.role==='user'?'practice.you':'practice.client')}</strong><p>${esc(message.text)}</p></div></article>`).join('')}</div>${replyBusy?renderAIWait('practice.replyThinking','practice.replyThinkingHint'):''}${rehearsal.replyError?`<div class="cloud-error" role="alert">${esc(rehearsal.replyError)}</div><button class="button secondary" data-practice-reply-retry>${uiText(rehearsal.replyUncertain||rehearsal.replyStatus==='failed'?'practice.replyRetry':'practice.replyCheck')}</button>`:''}${finished?`<p class="practice-note">${uiText('practice.finished')}</p>`:`<form data-practice-chat><div class="practice-chat-label"><label for="practice-response">${uiText('practice.reply')}</label><span>${uiText('practice.exchange',{number:messages.filter(m=>m.role==='user').length+1})}</span></div><textarea id="practice-response" name="response" rows="3" maxlength="4000" required ${replyBusy?'disabled':''} placeholder="${uiText('practice.replyPlaceholder')}"></textarea><button class="button" type="submit" ${replyBusy||rehearsal.replyError?'disabled':''}>${uiText('practice.respond')}${icon('arrow-right')}</button></form>${messages.some(m=>m.role==='user')?`<button type="button" class="text-button practice-end" data-practice-end ${replyBusy?'disabled':''}>${uiText('practice.endConversation')}${icon('arrow-right')}</button>`:''}`}`}</div>${finished?`<button class="button" data-practice-retry>${uiText('practice.retry')}</button>`:''}</section>`;
 }
 function start(){
  clearTimeout(pollTimer);pollTimer=null;
  cloud.storage.removeItem(key()+':evaluation');
  clearTimeout(replyTimer);cloud.storage.removeItem(key()+':dialogue');
  const context=persist();rehearsal={context,ended:false,view:'conversation',evaluationIndex:0,messages:[]};cloud.notify();requestReply();cloud.document.querySelector('.practice-conversation')?.scrollIntoView({block:'start'});cloud.document.querySelector('#practice-conversation-title')?.focus({preventScroll:true});
 }
 function saveDialogue(state){
  cloud.storage.setItem(key()+':dialogue',JSON.stringify({version:1,settings:validatePracticeSettings(settings),output_language:state.context.output_language,messages:state.messages,ended:state.ended===true,jobId:state.replyJobId||null,payload:state.replyPayload,uncertain:state.replyUncertain===true}));
 }
 async function pollReply(state){
  if(rehearsal!==state||owner!==cloud.navigationOwner)return;
  const pollingId=state.replyJobId;if(!pollingId)return;
  try{
   const job=await cloud.request(`/api/v1/rehearsals/replies/${encodeURIComponent(pollingId)}`);
   if(rehearsal!==state||owner!==cloud.navigationOwner||state.replyJobId!==pollingId)return;
   state.replyStatus=job.status;state.replyError='';
   if(job.status==='completed'){
    const reply=job.reply;
    if(!reply||typeof reply.message!=='string'||!reply.message.trim()||typeof reply.ended!=='boolean')throw Error('Invalid reply');
    state.messages.push({role:'client',text:reply.message});state.ended=reply.ended;state.replyJobId=null;state.replyPayload=null;
    if(reply.ended)state.view='analysis';
   }else if(job.status==='failed')state.replyError=replyError({code:job.error_code});
   else if(!['queued','running'].includes(job.status))throw Error('Invalid reply status');
   saveDialogue(state);cloud.notify();
   if(['queued','running'].includes(job.status))replyTimer=setTimeout(()=>pollReply(state),2000);
  }catch(issue){if(rehearsal!==state||owner!==cloud.navigationOwner)return;state.replyStatus=issue.code==='REHEARSAL_NOT_FOUND'?'failed':'unavailable';state.replyError=replyError(issue);cloud.notify();}
 }
 function replyError(issue){return uiText(issue?.code?.includes('CONTEXT')?'practice.replyContextError':'practice.replyFailed');}
 async function requestReply(){
  const state=rehearsal;if(!state||state.ended||state.replySubmitting||['queued','running'].includes(state.replyStatus))return;
  if(state.replyJobId&&state.replyStatus!=='failed'&&!state.replyUncertain){pollReply(state);return;}
  state.replySubmitting=true;state.replyError='';
  const jobId=state.replyUncertain?state.replyJobId:crypto.randomUUID();state.replyJobId=jobId;
  const payload=state.replyUncertain?state.replyPayload:{action:'reply',scenario:state.context.scenario_id,output_language:state.context.output_language,persona:state.context.persona,messages:structuredClone(state.messages)};
  state.replyPayload=payload;state.replyUncertain=true;saveDialogue(state);cloud.notify();
  try{
   const job=await cloud.request('/api/v1/rehearsals/replies',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':jobId},body:JSON.stringify(payload)});
   if(rehearsal!==state||owner!==cloud.navigationOwner)return;
   state.replySubmitting=false;state.replyUncertain=false;state.replyStatus=job.status;state.replyJobId=job.id;saveDialogue(state);cloud.notify();pollReply(state);
  }catch(issue){if(rehearsal!==state||owner!==cloud.navigationOwner)return;state.replySubmitting=false;state.replyStatus='unavailable';state.replyError=replyError(issue);saveDialogue(state);cloud.notify();}
 }
 function evaluationError(issue){
  const code=issue?.code||'';
  const key=code.includes('SOURCE')?'practice.evalSourceError':code.includes('CONTEXT')?'practice.evalContextError':code.includes('CITATION')?'practice.evalCitationError':code.includes('NOT_CONFIGURED')?'practice.evalNotConfigured':code.includes('LOCAL_MODEL')?'practice.evalModelError':'practice.evalFailed';
  return uiText(key);
 }
 async function pollEvaluation(state){
  if(rehearsal!==state||owner!==cloud.navigationOwner)return;
  try{
   const job=await cloud.request(`/api/v1/rehearsals/evaluations/${encodeURIComponent(state.jobId)}`);
   if(rehearsal!==state||owner!==cloud.navigationOwner)return;
   const previousStatus=state.evaluationStatus,previousError=state.evaluationError;
   state.evaluationStatus=job.status;state.evaluationError='';
   if(job.status==='completed')state.evaluation=job.evaluation;
   else if(job.status==='failed')state.evaluationError=evaluationError({code:job.error_code});
   else if(!['queued','running'].includes(job.status))throw Error('Invalid evaluation status');
   if(previousStatus!==job.status||previousError||['completed','failed'].includes(job.status))cloud.notify();
   if(['queued','running'].includes(job.status))pollTimer=setTimeout(()=>pollEvaluation(state),2000);
  }catch(issue){if(rehearsal!==state||owner!==cloud.navigationOwner)return;state.evaluationStatus=issue.code==='REHEARSAL_NOT_FOUND'?'failed':'unavailable';state.evaluationError=evaluationError(issue);cloud.notify();}
 }
 async function requestEvaluation(){
  const state=rehearsal;if(!state||!state.ended||!state.messages.some(m=>m.role==='user')||state.evaluationSubmitting||state.evaluation)return;
  if(state.jobId&&state.evaluationStatus!=='failed'&&!state.submissionUncertain){pollEvaluation(state);return;}
  state.evaluationSubmitting=true;state.evaluationError='';cloud.notify();
  const jobId=state.submissionUncertain?state.jobId:crypto.randomUUID();
  state.jobId=jobId;
  try{
   const payload=state.submissionUncertain?state.evaluationPayload:{action:'evaluate',scenario:state.context.scenario_id,output_language:state.context.output_language,persona:state.context.persona,messages:state.messages};
   state.evaluationPayload=payload;
   cloud.storage.setItem(key()+':evaluation',JSON.stringify({version:1,settings:validatePracticeSettings(settings),messages:state.messages,jobId,payload,submitted:false}));
   const job=await cloud.request('/api/v1/rehearsals/evaluations',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':jobId},body:JSON.stringify(payload)});
   if(rehearsal!==state||owner!==cloud.navigationOwner)return;
   state.jobId=job.id;state.evaluationStatus=job.status;state.evaluationSubmitting=false;state.submissionUncertain=false;
   cloud.storage.setItem(key()+':evaluation',JSON.stringify({version:1,settings:validatePracticeSettings(settings),messages:state.messages,jobId:job.id,payload,submitted:true}));
   cloud.notify();pollEvaluation(state);
  }catch(issue){if(rehearsal!==state||owner!==cloud.navigationOwner)return;state.evaluationSubmitting=false;state.submissionUncertain=true;state.evaluationStatus='unavailable';state.evaluationError=evaluationError(issue);cloud.notify();}
 }
 cloud.document.addEventListener('input',event=>{
  if(!event.target.closest('[data-practice-form]'))return;
  const name=event.target.name;
  if(!traits.some(([id])=>id===name))return;
  const value=Number(event.target.value);if(!Number.isInteger(value)||value<1||value>5)return;
  settings.persona[name]=value;
  const root=event.target.closest('.practice-workspace');root.querySelector(`[data-practice-level="${name}"]`).innerHTML=`${value}<small>/ 5</small>`;
  root.querySelector(`[data-practice-description="${name}"]`).textContent=uiText(`practice.${name}.${value}`);

  updateSaveState();event.target.setAttribute('aria-valuetext',uiText('practice.level',{value}));
 });
 cloud.document.addEventListener('change',event=>{if(!event.target.matches('#practice-case'))return;settings.scenario=event.target.value;updateSaveState();});
 cloud.document.addEventListener('submit',event=>{
  if(event.target.matches('[data-practice-chat]')){
   event.preventDefault();if(!rehearsal||rehearsal.ended||rehearsal.replySubmitting||['queued','running'].includes(rehearsal.replyStatus)||rehearsal.replyError)return;
   const text=event.target.elements.response.value.trim();if(!text)return;
   rehearsal.messages.push({role:'user',text});requestReply();return;
  }
  if(!event.target.matches('[data-practice-form]'))return;event.preventDefault();
  try{persist();updateSaveState();event.target.querySelector('[data-practice-error]').textContent='';}
  catch(issue){event.target.querySelector('[data-practice-error]').textContent=issue.message;}
 });
 cloud.document.addEventListener('click',event=>{
  if(event.target.closest('[data-practice-reply-retry]')){requestReply();return;}
  if(event.target.closest('[data-practice-end]')){if(rehearsal&&!rehearsal.replySubmitting&&!['queued','running'].includes(rehearsal.replyStatus)){rehearsal.ended=true;rehearsal.view='analysis';saveDialogue(rehearsal);cloud.notify();}return;}
  if(event.target.closest('[data-practice-evaluate]')){requestEvaluation();return;}
  const pager=event.target.closest('[data-practice-evaluation]');
  if(pager){
   if(!rehearsal||!rehearsal.evaluation||rehearsal.view!=='analysis'||pager.disabled)return;
   const value=pager.dataset.practiceEvaluation,count=rehearsal.messages.filter(message=>message.role==='user').length;
   const next=value==='next'?rehearsal.evaluationIndex+1:value==='previous'?rehearsal.evaluationIndex-1:Number(value);
   if(!Number.isInteger(next)||next<0||next>=count||next===rehearsal.evaluationIndex)return;
   rehearsal.evaluationIndex=next;cloud.notify();
   const target=cloud.document.querySelector(`[data-practice-evaluation="${value}"]`);
   (target&&!target.disabled?target:cloud.document.querySelector(`[data-practice-evaluation="${next}"]`))?.focus({preventScroll:true});return;
  }
  const step=event.target.closest('[data-practice-step]');
  if(step){if(!rehearsal||step.dataset.practiceStep===rehearsal.view||!['conversation','analysis'].includes(step.dataset.practiceStep)||(step.dataset.practiceStep==='analysis'&&!rehearsal.ended))return;rehearsal.view=step.dataset.practiceStep;cloud.notify();cloud.document.querySelector(`[data-practice-step="${rehearsal.view}"]`)?.focus({preventScroll:true});return;}
  if(event.target.closest('[data-practice-start],[data-practice-retry]')){
   try{start();}catch(issue){const target=cloud.document.querySelector('[data-practice-error]');if(target)target.textContent=issue.message;else{cloud.message=issue.message;cloud.notify();}}return;
  }
  if(event.target.closest('[data-practice-back]')){rehearsal=null;cloud.notify();cloud.document.querySelector('.practice-introduction')?.scrollIntoView({block:'start'});return;}
  if(!event.target.closest('[data-practice-reset]'))return;try{cloud.storage.removeItem(key());owner='';settings=null;cloud.notify();}catch{cloud.message=uiText('practice.storageError');cloud.notify();}});
}
