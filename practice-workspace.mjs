import {icon} from './icons.mjs';
import {uiText,uiLanguage} from './i18n.mjs';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const scenarios={scope:{request:'REQ-SP-001',label:'practice.scope'},payment:{request:'REQ-SP-002',label:'practice.payment'},refund:{request:'REQ-SP-003',label:'practice.refund'}};
const traits=[['patience','practice.patience','practice.impatient','practice.patient'],['flexibility','practice.flexibility','practice.rigid','practice.flexible'],['price','practice.price','practice.low','practice.high']];
export function validatePracticeSettings(value){
 if(!value||value.version!==1||!Object.hasOwn(scenarios,value.scenario))throw Error(uiText('practice.invalidCase'));
 if(!value.persona||Object.keys(value.persona).length!==3||traits.some(([name])=>!Number.isInteger(value.persona[name])||value.persona[name]<1||value.persona[name]>5))throw Error(uiText('practice.invalidTrait'));
 if(typeof value.goal!=='string'||value.goal.length>2000)throw Error(uiText('practice.invalid'));
 return {version:1,scenario:value.scenario,persona:{...value.persona},goal:value.goal};
}
export function buildPracticeContext(settings,data,language=uiLanguage()){
 const config=validatePracticeSettings(settings);
 if(!['es','en'].includes(language))throw Error('Unsupported rehearsal language');
 const request=data.requests.find(item=>item.id===scenarios[config.scenario].request);
 const message=data.messages.find(item=>item.id===request?.sourceMessageId);
 const agreement=data.documentVersions.find(item=>item.id===request?.sourceVersionId);
 const conversation=data.conversations.find(item=>item.id===message?.conversationId),document=data.documents.find(item=>item.id===agreement?.documentId);
 if(!request||!message||!agreement||conversation?.projectId!==request.projectId||document?.projectId!==request.projectId)throw Error(uiText('practice.invalidCase'));
 return {type:'practice_configuration',schema_version:1,mode:'rehearsal',language,
  persona:{patience:config.persona.patience,flexibility:config.persona.flexibility,price_sensitivity:config.persona.price},
  goal:config.goal,scenario_id:config.scenario,
  source_context:{kind:'fixture',project_id:request.projectId,request_id:request.id,agreement_version_id:agreement.id,message_id:message.id},
  sources:{request:message.content,agreement:agreement.content},
  allowed_tools:[],affects_business_state:false};
}
export function buildPracticePrompt(context){
 if(context.language!==uiLanguage())throw Error('Rehearsal prompt language does not match the selected interface');
 const behavior={patience:uiText(`practice.patience.${context.persona.patience}`),flexibility:uiText(`practice.flexibility.${context.persona.flexibility}`),price_sensitivity:uiText(`practice.price.${context.persona.price_sensitivity}`)};
 return ['ROLE',uiText('practice.promptRole'),'CONTEXT',JSON.stringify({...context,behavior},null,2),'PRE-TASK CHECKLIST',uiText('practice.promptCheck'),'TASK',uiText('practice.promptTask'),'FORMAT',uiText('practice.promptFormat')].join('\n\n');
}
export function scriptedPracticeLine(context,turn){
 if(!Number.isInteger(turn)||turn<0||turn>3)throw Error('Invalid rehearsal turn');
 if(turn===0)return [context.persona.patience<=2?uiText('practice.direct'):context.persona.patience>=4?uiText('practice.patientLine'):'',uiText(`practice.open.${context.scenario_id}`)].filter(Boolean).join(' ');
 if(turn===1)return [uiText(`practice.follow.${context.scenario_id}`),context.persona.price_sensitivity>=4?uiText('practice.costLine'):context.persona.price_sensitivity<=2?uiText('practice.valueLine'):''].filter(Boolean).join(' ');
 if(turn===2)return uiText(context.persona.flexibility>=3?'practice.last.flexible':'practice.last.firm');
 return uiText('practice.endLine');
}
export function installPracticeWorkspace(cloud){
 window.addEventListener('hashchange',()=>{if(window.location.hash!=='#ensayos'&&cloud.active)cloud.scheduleIngestionPolling();});
 let owner='',settings,baseline='',error='',rehearsal=null;
 const key=()=>{if(!cloud.navigationOwner||!cloud.session?.key)throw Error(uiText('practice.invalid'));return `${cloud.session.key}:practice:${cloud.navigationOwner}`;};
 function load(){
  if(owner===cloud.navigationOwner&&settings)return;
  owner=cloud.navigationOwner;baseline='';error='';rehearsal=null;
  const raw=cloud.storage.getItem(key());
  if(raw!==null){try{settings=validatePracticeSettings(JSON.parse(raw));baseline=JSON.stringify(settings);}catch{settings=null;error=uiText('practice.invalid');}}
  else {settings={version:1,scenario:'scope',persona:{patience:3,flexibility:3,price:3},goal:''};baseline=JSON.stringify(settings);}
 }
 cloud.renderPracticeWorkspace=function(root){
  try{load();}catch{root.innerHTML=`<p class="cloud-error" role="alert">${esc(uiText('practice.storageError'))}</p>`;return;}
  if(!settings){root.innerHTML=`<section class="workspace-panel"><p class="cloud-error" role="alert">${esc(error)}</p><button class="button" data-practice-reset>${uiText('practice.reset')}</button></section>`;return;}
  if(rehearsal){renderConversation(root);return;}
  const slider=([name,label,low,high])=>`<section class="practice-trait"><div class="practice-trait-heading"><label for="practice-${name}">${uiText(label)}</label><output for="practice-${name}" data-practice-level="${name}">${settings.persona[name]}<small>/ 5</small></output></div><input id="practice-${name}" name="${name}" type="range" min="1" max="5" step="1" value="${settings.persona[name]}" aria-describedby="practice-${name}-help" aria-valuetext="${esc(uiText('practice.level',{value:settings.persona[name]}))}"><div class="practice-scale"><span>${uiText(low)}</span><span>${uiText(high)}</span></div><p id="practice-${name}-help" data-practice-description="${name}">${uiText(`practice.${name}.${settings.persona[name]}`)}</p></section>`;
  root.innerHTML=`<section class="practice-introduction"><h2>${uiText('practice.introTitle')}</h2><p>${uiText('practice.intro')}</p></section><div class="practice-workspace"><form class="workspace-panel practice-form" data-practice-form><header><span class="eyebrow">${uiText('practice.eyebrow')}</span><h2>${uiText('practice.configure')}</h2></header><label class="field" for="practice-case">${uiText('practice.case')}</label><select class="context-box" id="practice-case" name="scenario">${Object.entries(scenarios).map(([id,value])=>`<option value="${id}" ${settings.scenario===id?'selected':''}>${uiText(value.label)}</option>`).join('')}</select><div class="practice-persona-heading"><h3>${uiText('practice.persona')}</h3><p>${uiText('practice.personaHint')}</p></div>${traits.map(slider).join('')}<label class="field" for="practice-goal">${uiText('practice.goal')}</label><textarea class="context-box" id="practice-goal" name="goal" rows="3" maxlength="2000" placeholder="${esc(uiText('practice.goalPlaceholder'))}">${esc(settings.goal)}</textarea><p class="practice-note">${uiText('practice.respect')}</p><p class="practice-note">${uiText('practice.savedHint')}</p><div class="practice-config-actions"><button class="button" type="button" data-practice-start>${icon('messages-square')}${uiText('practice.start')}</button><button class="button secondary" type="submit" data-practice-save>${icon('save')}<span data-practice-save-label>${uiText('practice.save')}</span></button></div><p role="status" data-practice-status></p><p class="cloud-error" role="alert" data-practice-error>${esc(error)}</p></form></div>`;
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
  const {context,messages,turn}=rehearsal,finished=turn===3;
  root.innerHTML=`<section class="workspace-panel practice-conversation"><header class="practice-conversation-heading"><div><span class="eyebrow">${uiText('practice.simulation')}</span><h2 id="practice-conversation-title" tabindex="-1">${uiText(scenarios[context.scenario_id].label)}</h2><p>${uiText('practice.scriptHint')}</p></div><button class="text-button" data-practice-back>${uiText('practice.back')}</button></header><div class="practice-brief"><strong>${uiText('practice.goal')}</strong><p>${esc(context.goal||uiText(`practice.goalDefault.${context.scenario_id}`))}</p></div><div class="practice-chat" role="log" aria-label="${uiText('practice.conversation')}" aria-live="polite">${messages.map(message=>`<article class="practice-message ${message.role==='user'?'is-user':''}"><strong>${uiText(message.role==='user'?'practice.you':'practice.client')}</strong><p>${esc(message.text)}</p></article>`).join('')}</div>${finished?`<section class="practice-finished" role="status"><h3 id="practice-finish" tabindex="-1">${uiText('practice.finished')}</h3><p>${uiText('practice.reflection')}</p><button class="button" data-practice-retry>${uiText('practice.retry')}</button></section>`:`<form data-practice-chat><div class="practice-chat-label"><label for="practice-response">${uiText('practice.reply')}</label><span>${uiText('practice.round',{value:turn+1})}</span></div><textarea id="practice-response" name="response" rows="3" maxlength="4000" required placeholder="${uiText('practice.replyPlaceholder')}"></textarea><button class="button" type="submit">${uiText('practice.respond')}${icon('arrow-right')}</button></form>`}<details class="practice-instructions"><summary>${uiText('practice.instructions')}</summary><pre>${esc(buildPracticePrompt(context))}</pre></details></section>`;
 }
 function start(){
  const context=persist();rehearsal={context,turn:0,messages:[{role:'client',text:scriptedPracticeLine(context,0)}]};cloud.notify();cloud.document.querySelector('.practice-conversation')?.scrollIntoView({block:'start'});cloud.document.querySelector('#practice-conversation-title')?.focus({preventScroll:true});
 }
 cloud.document.addEventListener('input',event=>{
  if(!event.target.closest('[data-practice-form]'))return;
  const name=event.target.name;if(name==='goal'){settings.goal=event.target.value;updateSaveState();return;}
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
   event.preventDefault();if(!rehearsal||rehearsal.turn>=3)return;
   const text=event.target.elements.response.value.trim();if(!text)return;
   rehearsal.messages.push({role:'user',text});rehearsal.turn++;
   rehearsal.messages.push({role:'client',text:scriptedPracticeLine(rehearsal.context,rehearsal.turn)});
   cloud.notify();cloud.document.querySelector('#practice-response,#practice-finish')?.focus();return;
  }
  if(!event.target.matches('[data-practice-form]'))return;event.preventDefault();
  try{persist();updateSaveState();event.target.querySelector('[data-practice-error]').textContent='';}
  catch(issue){event.target.querySelector('[data-practice-error]').textContent=issue.message;}
 });
 cloud.document.addEventListener('click',event=>{
  if(event.target.closest('[data-practice-start],[data-practice-retry]')){
   try{start();}catch(issue){const target=cloud.document.querySelector('[data-practice-error]');if(target)target.textContent=issue.message;else{cloud.message=issue.message;cloud.notify();}}return;
  }
  if(event.target.closest('[data-practice-back]')){rehearsal=null;cloud.notify();cloud.document.querySelector('.practice-introduction')?.scrollIntoView({block:'start'});return;}
  if(!event.target.closest('[data-practice-reset]'))return;try{cloud.storage.removeItem(key());owner='';settings=null;cloud.notify();}catch{cloud.message=uiText('practice.storageError');cloud.notify();}});
}
