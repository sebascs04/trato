// Descriptive feedback comparison. No grading, provider call, or business action.
const assessments=new Set(['strength','improvement','insufficient_evidence']);
const ordered=value=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,ordered(value[k])])):value;
const canonicalContext=context=>JSON.stringify(ordered([context.scenario_id,context.output_language,context.persona,context.source_context,context.sources]));
export function practiceAttempt(state){
 const context=structuredClone(state.context),messages=structuredClone(state.messages),evaluation=structuredClone(state.evaluation);
 if(!context||!['es','en'].includes(context.output_language)||!['scope','payment','refund'].includes(context.scenario_id)||!context.persona||!context.source_context||!context.sources)throw Error('Invalid practice context');
 if(!Array.isArray(messages)||messages.length<2||messages.length>200||messages.some((m,i)=>m.role!==(i%2?'user':'client')||typeof m.text!=='string'||!m.text.trim()||m.text.length>4000))throw Error('Invalid practice messages');
 if(!evaluation||typeof evaluation.summary!=='string'||typeof evaluation.model!=='string'||!evaluation.model||typeof evaluation.scope_id!=='string'||!evaluation.scope_id||!Array.isArray(evaluation.items))throw Error('Invalid practice evaluation');
 const turns=messages.map((m,i)=>({...m,index:i})).filter(m=>m.role==='user');
 if(evaluation.items.length!==turns.length||evaluation.items.some((item,i)=>item.message_index!==turns[i].index||!assessments.has(item.assessment)||typeof item.evidence_quote!=='string'||!item.evidence_quote||!turns[i].text.includes(item.evidence_quote)))throw Error('Invalid practice findings');
 return {version:1,context,messages,evaluation};
}
export function repeatPracticeAttempt(state){
 const previous=practiceAttempt(state);
 return {context:structuredClone(previous.context),comparisonBaseline:previous,ended:false,view:'conversation',evaluationIndex:0,messages:[structuredClone(previous.messages[0])]};
}
export function comparePracticeAttempts(previous,current){
 const before=practiceAttempt(previous),after=practiceAttempt(current);
 const describe=value=>({total:value.evaluation.items.length,...Object.fromEntries([...assessments].map(a=>[a,value.evaluation.items.filter(i=>i.assessment===a).length]))});
 const sameContext=canonicalContext(before.context)===canonicalContext(after.context);
 const sameEvaluator=before.evaluation.model===after.evaluation.model&&before.evaluation.scope_id===after.evaluation.scope_id;
 const openingMatch=sameContext&&before.messages[0].text===after.messages[0].text;
 return {comparable:sameContext&&sameEvaluator,reason:!sameContext?'context':!sameEvaluator?'evaluator':null,before:describe(before),after:describe(after),
  firstReply:openingMatch?{client:after.messages[0].text,before:before.messages[1].text,after:after.messages[1].text,
    beforeAssessment:before.evaluation.items[0].assessment,afterAssessment:after.evaluation.items[0].assessment}:null};
}

import {renderAIActivity,submitChatOnEnter,chatScrollPosition,restoreChatScroll} from './ai-activity.mjs';
import {icon} from './icons.mjs';
import {uiText,uiLanguage,uiLocale} from './i18n.mjs';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const scenarios={scope:{request:'REQ-SP-001',label:'practice.scope'},payment:{request:'REQ-SP-002',label:'practice.payment'},refund:{request:'REQ-SP-003',label:'practice.refund'}};
// Client accounts rehearse the other side: they are the client and TeTrato plays their freelancer. Cases come only from the bank.
const clientScenarios={change:{label:'practiceClient.change'},deadline:{label:'practiceClient.deadline'},delivery:{label:'practiceClient.delivery'}};
const allScenarios={...scenarios,...clientScenarios};
let practiceRole='freelancer';
export function setPracticeRole(role){practiceRole=role==='client'?'client':'freelancer';}
const roleScenarios=()=>practiceRole==='client'?clientScenarios:scenarios;
const ROLE_KEYS=new Set(['practice.introTitle', 'practice.intro', 'practice.variety', 'practice.hiddenIntent', 'practice.hiddenIntentHelp', 'practice.intentTitle', 'practice.persona', 'practice.replyPlaceholder', 'practice.scriptHint', 'practice.simulation', 'practice.info.intent.lead', 'practice.info.intent.off', 'practice.info.intent.title', 'practice.info.about.situation', 'practice.info.about.characterTitle', 'practice.info.about.character', 'practice.info.intent.trains', 'practice.info.intent.examples', 'practice.info.intent.evaluation', 'practice.price', 'practice.price.1', 'practice.price.2', 'practice.price.3', 'practice.price.4', 'practice.price.5', 'practice.flexibility.1', 'practice.flexibility.2', 'practice.flexibility.3', 'practice.flexibility.4', 'practice.flexibility.5']);
// The same screen in the user's role: texts about «your client» become «your freelancer» for client accounts.
const ROLE_OVERRIDES={'eval.clientMessage':'practiceClient.counterpartMessage'};
const pt=(key,values)=>uiText(practiceRole==='client'?ROLE_OVERRIDES[key]||(ROLE_KEYS.has(key)?key.replace(/^practice\./,'practiceClient.'):key):key,values);
const traits=[['patience','practice.patience','practice.impatient','practice.patient'],['flexibility','practice.flexibility','practice.rigid','practice.flexible'],['price','practice.price','practice.low','practice.high']];
export function validatePracticeSettings(value){
 if(!value||value.version!==1||!Object.hasOwn(allScenarios,value.scenario))throw Error(uiText('practice.invalidCase'));
 if(!value.persona||Object.keys(value.persona).length!==3||traits.some(([name])=>!Number.isInteger(value.persona[name])||value.persona[name]<1||value.persona[name]>5))throw Error(uiText('practice.invalidTrait'));
 const out={version:1,scenario:value.scenario,persona:{...value.persona}};
 // Optional: a case from the shared bank and whether the client has a hidden intent. Settings without them keep the original fixture.
 if(value.caseId!==undefined&&value.caseId!==null){if(typeof value.caseId!=='string'||!/^[a-z]+-[a-z]+$/.test(value.caseId))throw Error(uiText('practice.invalidCase'));out.caseId=value.caseId;}
 if(value.hiddenIntent!==undefined){if(typeof value.hiddenIntent!=='boolean')throw Error(uiText('practice.invalidCase'));out.hiddenIntent=value.hiddenIntent;}
 return out;
}
export function practiceCases(scenario,bank=globalThis.window?.TRATO_REHEARSAL_CASES){return bank?.scenarios?.[scenario]?.cases||[];}
export function buildPracticeContext(settings,data,language=uiLanguage(),bank=globalThis.window?.TRATO_REHEARSAL_CASES){
 const config=validatePracticeSettings(settings);
 if(!['es','en'].includes(language))throw Error('Unsupported rehearsal language');
 if(config.caseId){
  const item=practiceCases(config.scenario,bank).find(c=>c.id===config.caseId);
  if(!item||typeof item.request?.[language]!=='string'||typeof item.agreement?.[language]!=='string')throw Error(uiText('practice.invalidCase'));
  return {type:'practice_configuration',schema_version:1,mode:'rehearsal',output_language:language,
   persona:{patience:config.persona.patience,flexibility:config.persona.flexibility,price_sensitivity:config.persona.price},
   goal_key:`practice.goalDefault.${config.scenario}`,scenario_id:config.scenario,
   source_context:{kind:'rehearsal_case',case_id:item.id},case_theme:item.theme[language],hidden_intent:config.hiddenIntent!==false,
   sources:{request:item.request[language],agreement:item.agreement[language]},
   allowed_tools:[],affects_business_state:false};
 }
 if(!Object.hasOwn(scenarios,config.scenario))throw Error(uiText('practice.invalidCase'));
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
// Case and hidden-intent fields sent with every turn; the intent itself is chosen and kept by the server.
function caseFields(context){return context?.source_context?.kind==='rehearsal_case'?{case_id:context.source_context.case_id,rehearsal_id:context.rehearsal_id,hidden_intent:context.hidden_intent===true&&typeof context.rehearsal_id==='string'}:{};}
function renderAIWait(label,hint){return renderAIActivity({label:uiText(label),hint:uiText(hint)});}
export function practiceFinishRequiresConfirmation(state){
 return Boolean(state&&!state.evaluation);
}
export function groupPracticeCitations(citations){
 const groups=new Map();
 for(const citation of citations){
  const key=JSON.stringify([citation.file_id,citation.title,citation.author,citation.url]);
  if(!groups.has(key))groups.set(key,{...citation,excerpts:[]});
  const group=groups.get(key);
  if(!group.excerpts.some(c=>c.quote===citation.quote&&JSON.stringify(c.locator)===JSON.stringify(citation.locator)))group.excerpts.push(citation);
 }
 return [...groups.values()];
}
function renderPracticeCitations(citations){
 const links=groupPracticeCitations(citations).map((group,index)=>{
  const href=typeof group.url==='string'&&group.url.startsWith('https://')?group.url:'';
  return href?`<a href="${esc(href)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(uiText('practice.originalDocument')+': '+group.title)}"><span class="practice-source-title"><span class="practice-source-number">${esc(uiText('practice.sourceNumber',{number:index+1}))}</span> ${esc(group.title)}</span>${icon('arrow-up-right')}</a>`:'';
 }).join('');
 return links?`<div class="practice-source-links">${links}</div>`:'';
}

function renderPracticeEvaluation(state){
 const data=state.evaluation,selected=state.evaluationIndex;
 if(!data){
  const pending=['queued','running'].includes(state.evaluationStatus),busy=state.evaluationSubmitting;
  return `<section class="practice-evaluation practice-evaluation-ready" aria-label="${uiText('eval.title')}" aria-busy="${pending||busy}">${pending||busy?renderAIWait(pending&&state.evaluationStatus==='queued'?'practice.evalQueued':'practice.evalRunning','practice.analysisWaitHint'):`<p>${uiText('practice.evalReady')}</p>`}${state.evaluationError?`<p class="cloud-error" role="alert">${esc(state.evaluationError)}</p>`:''}${pending||busy?'':`<button class="button" type="button" data-practice-evaluate>${icon('sparkles')}${uiText(state.submissionUncertain?'practice.evalRetry':state.jobId&&state.evaluationStatus!=='failed'?'practice.evalCheck':'practice.evalStart')}</button>`}</section>`;
 }
 const intent=data.client_intent&&typeof data.client_intent.label==='string'?data.client_intent:null;
 return `<section class="practice-evaluation" aria-label="${uiText('eval.title')}"><header><h3>${uiText('eval.title')}</h3><p>${esc(data.summary)}</p></header>${intent?`<section class="practice-intent-reveal ${intent.discovered?'is-found':''}"><div><small>${pt('practice.intentTitle')}</small><strong>${esc(intent.label)}</strong></div><span class="badge review">${icon(intent.discovered?'check':'search')}${uiText(intent.discovered?'practice.intentFound':'practice.intentMissed')}</span><p>${esc(intent.comment)}</p></section>`:''}<nav class="practice-message-switcher" aria-label="${uiText('eval.messages')}">${data.items.map((_,i)=>`<button type="button" data-practice-evaluation="${i}" aria-pressed="${i===selected}">${uiText('eval.message',{number:i+1})}</button>`).join('')}</nav>${data.items.map((item,i)=>{const client=state.messages[item.message_index-1];return `<article class="practice-evaluation-card" ${i===selected?'':'hidden'}><div class="practice-evaluation-exchange"><div class="practice-client-context"><small>${pt('eval.clientMessage')}</small><p>${esc(client?.text)}</p></div><div class="practice-user-response"><small>${uiText('eval.yourMessage')}</small><blockquote class="practice-evidence">${esc(item.evidence_quote)}</blockquote></div></div><section class="practice-evaluation-finding"><span class="badge review">${uiText(`practice.evalAssessment.${item.assessment}`)}</span><strong>${uiText(item.assessment==='improvement'?'eval.improveHeading':'eval.finding')}</strong><p>${esc(item.finding)}</p></section>${item.suggestion?`<section class="practice-evaluation-example"><strong>${uiText('eval.suggestedReply')}</strong><p>${esc(item.suggestion)}</p></section>`:''}<details class="practice-evaluation-reason"><summary>${uiText('practice.expertBasis')}${icon('chevron-down')}</summary><p>${esc(item.why.replace(/\s*\(r\d+(?:,\s*r\d+)*\)/g,''))}</p>${renderPracticeCitations(item.citations)}</details></article>`;}).join('')}<div class="practice-message-pager"><button class="button secondary" data-practice-evaluation="previous" ${selected===0?'disabled':''}>${icon('arrow-left')}${uiText('eval.previous')}</button><span role="status">${uiText('eval.position',{number:selected+1,total:data.items.length})}</span><button class="button secondary" data-practice-evaluation="next" ${selected===data.items.length-1?'disabled':''}>${uiText('eval.nextMessage')}${icon('arrow-right')}</button></div></section>`;
}
// Static explanations behind the «i» buttons: what Ensayos offers and what the hidden intent trains.
const practiceInfoButton=kind=>`<button type="button" class="text-button practice-comparison-info" data-practice-info="${kind}" aria-haspopup="dialog" aria-label="${uiText(`practice.info.${kind}.title`)}" title="${uiText(`practice.info.${kind}.title`)}">${icon('info')}</button>`;
export function practiceInfoContent(kind){
 const list=(base,names)=>`<dl>${names.map(n=>`<div><dt>${pt(`${base}.${n}Title`)}</dt><dd>${pt(`${base}.${n}`)}</dd></div>`).join('')}</dl>`;
 if(kind==='about')return {title:uiText('practice.info.about.title'),html:`<div class="practice-comparison-help"><p>${pt('practice.intro')}</p>${list('practice.info.about',['situation','character','evaluation'])}<p class="practice-variety">${icon('sparkles')}<span>${pt('practice.variety')}</span></p></div>`};
 if(kind==='intent')return {title:pt('practice.info.intent.title'),html:`<div class="practice-comparison-help"><p>${pt('practice.info.intent.lead')}</p>${list('practice.info.intent',['trains','examples','evaluation'])}<p class="practice-comparison-help-example">${pt('practice.info.intent.off')}</p></div>`};
 throw Error('Invalid practice info');
}
export function renderPracticeComparisonDetail(state,kind){
 const result=comparePracticeAttempts(state.comparisonBaseline,state);
 if(kind==='help')return {title:uiText('practiceCompare.helpTitle'),html:`<div class="practice-comparison-help"><p>${uiText('practiceCompare.helpCounts')}</p><dl>${['strength','improvement','insufficient_evidence'].map(name=>`<div><dt>${uiText(`practice.evalAssessment.${name}`)}</dt><dd>${uiText(`practiceCompare.help.${name}`)}</dd></div>`).join('')}</dl><p class="practice-comparison-help-example">${uiText('practiceCompare.helpExample')}</p></div>`};
 if(kind==='summaries')return {title:uiText('practiceCompare.summaries'),html:`<div class="practice-comparison-dialog-columns"><section><h3>${uiText('practiceCompare.before')}</h3><p>${esc(state.comparisonBaseline.evaluation.summary)}</p></section><section><h3>${uiText('practiceCompare.after')}</h3><p>${esc(state.evaluation.summary)}</p></section></div>`};
 if(kind==='reply'&&result.firstReply)return {title:uiText('practiceCompare.sameQuestion'),html:`<p class="practice-comparison-question">${esc(result.firstReply.client)}</p><div class="practice-comparison-dialog-columns"><section><h3>${uiText('practiceCompare.before')}</h3><p>${esc(result.firstReply.before)}</p><span class="badge review">${esc(uiText(`practice.evalAssessment.${result.firstReply.beforeAssessment}`))}</span></section><section><h3>${uiText('practiceCompare.after')}</h3><p>${esc(result.firstReply.after)}</p><span class="badge review">${esc(uiText(`practice.evalAssessment.${result.firstReply.afterAssessment}`))}</span></section></div>`};
 throw Error('Invalid practice comparison detail');
}
function renderPracticeComparison(state){
 if(!state.comparisonBaseline)return '';
 let result;
 try{result=comparePracticeAttempts(state.comparisonBaseline,state);}catch{return `<p class="cloud-error" role="alert">${esc(uiText('practiceCompare.invalid'))}</p>`;}
 const metricRows=['strength','improvement','insufficient_evidence'].map(a=>`<tr><th scope="row">${esc(uiText(`practice.evalAssessment.${a}`))}</th><td>${esc(uiText('practiceCompare.count',{count:new Intl.NumberFormat(uiLocale()).format(result.before[a]),total:new Intl.NumberFormat(uiLocale()).format(result.before.total)}))}</td><td>${esc(uiText('practiceCompare.count',{count:new Intl.NumberFormat(uiLocale()).format(result.after[a]),total:new Intl.NumberFormat(uiLocale()).format(result.after.total)}))}</td></tr>`).join('');
 return `<section class="practice-comparison" aria-label="${esc(uiText('practiceCompare.title'))}"><header><div class="practice-comparison-title"><h3>${esc(uiText('practiceCompare.title'))}</h3><button type="button" class="text-button practice-comparison-info" data-practice-comparison-detail="help" aria-haspopup="dialog" aria-label="${uiText('practiceCompare.helpTitle')}" title="${uiText('practiceCompare.helpTitle')}">${icon('info')}</button></div><p>${esc(uiText('practiceCompare.description'))}</p></header>${!result.comparable?`<p class="practice-comparison-context" role="status">${esc(uiText(`practiceCompare.different.${result.reason}`))}</p>`:''}<table class="practice-comparison-metrics"><thead><tr><th scope="col"><span class="sr-only">${uiText('practiceCompare.findings')}</span></th><th scope="col">${uiText('practiceCompare.beforeShort')}</th><th scope="col">${uiText('practiceCompare.afterShort')}</th></tr></thead><tbody>${metricRows}</tbody></table><div class="practice-comparison-links">${result.firstReply?`<button type="button" class="text-button" data-practice-comparison-detail="reply" aria-haspopup="dialog">${esc(uiText('practiceCompare.sameQuestion'))}${icon('arrow-up-right')}</button>`:''}<button type="button" class="text-button" data-practice-comparison-detail="summaries" aria-haspopup="dialog">${esc(uiText('practiceCompare.summaries'))}${icon('arrow-up-right')}</button></div></section>`;

}
export function installPracticeWorkspace(cloud){
 window.addEventListener('hashchange',()=>{if(window.location.hash!=='#ensayos'&&cloud.active)cloud.scheduleIngestionPolling();});
 let owner='',settings,error='',rehearsal=null,pollTimer=null,replyTimer=null,finishDialog=null,comparisonDialog=null,comparisonReturn=null;
 const key=()=>{if(!cloud.navigationOwner||!cloud.session?.key)throw Error(uiText('practice.invalid'));return `${cloud.session.key}:practice:${cloud.navigationOwner}`;};
 function closeComparisonDialog(){if(!comparisonDialog)return;const dialog=comparisonDialog;comparisonDialog=null;dialog.close();dialog.remove();if(comparisonReturn?.isConnected)comparisonReturn.focus({preventScroll:true});comparisonReturn=null;}
 function openComparisonDialog(kind,trigger,info=false){
  if(!info&&(!rehearsal?.evaluation||!rehearsal.comparisonBaseline))return;
  let content;try{content=info?practiceInfoContent(kind):renderPracticeComparisonDetail(rehearsal,kind);}catch{cloud.message=uiText('practiceCompare.invalid');cloud.notify();return;}
  closeComparisonDialog();comparisonReturn=trigger;const dialog=cloud.document.createElement('dialog');comparisonDialog=dialog;dialog.className='practice-comparison-dialog';dialog.setAttribute('aria-labelledby','practice-comparison-dialog-title');
  dialog.innerHTML=`<header><h2 id="practice-comparison-dialog-title">${esc(content.title)}</h2><button type="button" class="text-button" data-practice-comparison-close aria-label="${uiText('practiceCompare.close')}" title="${uiText('practiceCompare.close')}">${icon('x')}</button></header><div class="practice-comparison-dialog-body">${content.html}</div>`;
  dialog.querySelector('[data-practice-comparison-close]').addEventListener('click',closeComparisonDialog);dialog.addEventListener('cancel',event=>{event.preventDefault();closeComparisonDialog();});cloud.document.body.append(dialog);dialog.showModal();dialog.querySelector('[data-practice-comparison-close]').focus();
 }
 function closeFinishDialog(){if(!finishDialog)return;const dialog=finishDialog;finishDialog=null;dialog.close();dialog.remove();cloud.document.querySelector('[data-practice-finish]')?.focus({preventScroll:true});}
 function finishPractice(){
  try{cloud.storage.setItem(key()+':closed','1');}catch{cloud.message=uiText('practice.storageError');cloud.notify();return;}
  clearTimeout(pollTimer);clearTimeout(replyTimer);pollTimer=null;replyTimer=null;closeComparisonDialog();closeFinishDialog();rehearsal=null;cloud.practiceContext=null;cloud.notify();
  cloud.document.querySelector('.practice-introduction')?.scrollIntoView({block:'start'});cloud.document.querySelector('#practice-case')?.focus({preventScroll:true});
 }
 function requestFinishPractice(){
  if(!rehearsal)return;
  if(!practiceFinishRequiresConfirmation(rehearsal)){finishPractice();return;}
  if(finishDialog)return;
  const dialog=cloud.document.createElement('dialog');finishDialog=dialog;dialog.className='practice-exit-dialog';dialog.setAttribute('aria-labelledby','practice-exit-title');dialog.setAttribute('aria-describedby','practice-exit-copy');
  dialog.innerHTML=`<h2 id="practice-exit-title">${uiText('practice.finishTitle')}</h2><p id="practice-exit-copy">${uiText('practice.finishCopy')}</p><footer><button type="button" class="button secondary" data-practice-finish-cancel>${uiText('practice.keepPracticing')}</button><button type="button" class="button" data-practice-finish-confirm>${uiText('practice.finishSession')}</button></footer>`;
  dialog.querySelector('[data-practice-finish-cancel]').addEventListener('click',closeFinishDialog);dialog.querySelector('[data-practice-finish-confirm]').addEventListener('click',finishPractice);dialog.addEventListener('cancel',event=>{event.preventDefault();closeFinishDialog();});
  cloud.document.body.append(dialog);dialog.showModal();dialog.querySelector('[data-practice-finish-cancel]').focus();
 }
 const originalReset=cloud.reset.bind(cloud);cloud.reset=function(){closeComparisonDialog();closeFinishDialog();clearTimeout(pollTimer);clearTimeout(replyTimer);rehearsal=null;owner='';settings=null;return originalReset();};
 window.addEventListener('hashchange',()=>{if(window.location.hash!=='#ensayos'){closeComparisonDialog();closeFinishDialog();}});

 function load(){
  if(owner===cloud.navigationOwner&&settings)return;
  owner=cloud.navigationOwner;error='';rehearsal=null;
  const raw=cloud.storage.getItem(key());
  if(raw!==null){try{settings=validatePracticeSettings(JSON.parse(raw));}catch{settings=null;error=uiText('practice.invalid');}}
  else {settings={version:1,scenario:practiceRole==='client'?'change':'scope',persona:{patience:3,flexibility:3,price:3}};}
  if(settings&&!Object.hasOwn(roleScenarios(),settings.scenario)){settings={version:1,scenario:Object.keys(roleScenarios())[0],persona:settings.persona};}
  if(settings&&!settings.caseId){const first=practiceCases(settings.scenario)[0];if(first)settings.caseId=first.id;}
  if(settings&&settings.hiddenIntent===undefined)settings.hiddenIntent=true;
  if(cloud.storage.getItem(key()+':closed')==='1')return;
  const saved=cloud.storage.getItem(key()+':evaluation');
  if(saved!==null&&settings){
   try{
    const record=JSON.parse(saved),config=validatePracticeSettings(record.settings);
    if(record.version!==1||!/^[-0-9a-f]{36}$/.test(record.jobId)||!Array.isArray(record.messages)||record.messages.length<2||record.messages.some((m,i)=>m.role!==(i%2?'user':'client')||typeof m.text!=='string'||!m.text||m.text.length>4000))throw Error('Invalid saved evaluation');
    rehearsal={context:{...buildPracticeContext(config,window.TRATO_DATA,record.payload?.output_language),rehearsal_id:record.payload?.rehearsal_id||null},ended:true,view:'analysis',evaluationIndex:0,messages:record.messages,jobId:record.jobId,evaluationPayload:record.payload,submissionUncertain:!record.submitted,evaluationStatus:'unavailable',comparisonBaseline:record.comparisonBaseline?practiceAttempt(record.comparisonBaseline):null};
    if(record.submitted)pollTimer=setTimeout(()=>pollEvaluation(rehearsal),0);
   }catch{settings=null;error=uiText('practice.invalid');}
  }
  if(!rehearsal&&settings){
   const savedDialogue=cloud.storage.getItem(key()+':dialogue');
   if(savedDialogue!==null){try{
    const record=JSON.parse(savedDialogue),config=validatePracticeSettings(record.settings);
    if(record.version!==1||!['es','en'].includes(record.output_language)||!Array.isArray(record.messages)||record.messages.some((m,i)=>m.role!==(i%2?'user':'client')||typeof m.text!=='string'||!m.text))throw Error('Invalid dialogue');
    rehearsal={context:{...buildPracticeContext(config,window.TRATO_DATA,record.output_language),rehearsal_id:typeof record.rehearsalId==='string'?record.rehearsalId:null},ended:record.ended===true,view:record.ended?'analysis':'conversation',evaluationIndex:0,messages:record.messages,replyJobId:record.jobId,replyPayload:record.payload,replyStatus:record.jobId?'unavailable':'idle',replyUncertain:record.uncertain,comparisonBaseline:record.comparisonBaseline?practiceAttempt(record.comparisonBaseline):null};
    if(record.jobId&&!record.uncertain&&!record.ended)replyTimer=setTimeout(()=>pollReply(rehearsal),0);
   }catch{settings=null;error=uiText('practice.invalid');}}
  }
 }
 // What TeTrato (section assistant) may know about this screen: only labels already shown, never the hidden intent.
 cloud.practiceScreen=()=>{
  if(rehearsal){const c=rehearsal.context;return {view:rehearsal.view==='analysis'?'evaluation':'conversation',scenario:c.scenario_id,...(c.case_theme?{case_theme:c.case_theme}:{})};}
  const item=settings?.caseId?practiceCases(settings.scenario).find(c=>c.id===settings.caseId):null;
  return {view:'setup',...(settings?{scenario:settings.scenario}:{}),...(item?{case_theme:item.theme[uiLanguage()]}:{})};
 };
 cloud.renderPracticeWorkspace=function(root){
  setPracticeRole(cloud.role);
  try{load();}catch{root.innerHTML=`<p class="cloud-error" role="alert">${esc(uiText('practice.storageError'))}</p>`;return;}
  if(!settings){root.innerHTML=`<section class="workspace-panel"><p class="cloud-error" role="alert">${esc(error)}</p><button class="button" data-practice-reset>${uiText('practice.reset')}</button></section>`;return;}
  if(rehearsal){renderConversation(root);return;}
  const slider=([name,label,low,high])=>`<section class="practice-trait"><div class="practice-trait-heading"><label for="practice-${name}">${pt(label)}</label><output for="practice-${name}" data-practice-level="${name}">${settings.persona[name]}<small>/ 5</small></output></div><input id="practice-${name}" name="${name}" type="range" min="1" max="5" step="1" value="${settings.persona[name]}" aria-describedby="practice-${name}-help" aria-valuetext="${esc(uiText('practice.level',{value:settings.persona[name]}))}"><div class="practice-scale"><span>${uiText(low)}</span><span>${uiText(high)}</span></div><p id="practice-${name}-help" data-practice-description="${name}">${pt(`practice.${name}.${settings.persona[name]}`)}</p></section>`;
  root.innerHTML=`<section class="practice-introduction"><div class="practice-intro-title"><h2>${pt('practice.introTitle')}</h2>${practiceInfoButton('about')}</div></section><div class="practice-workspace"><form class="workspace-panel practice-form" data-practice-form><header class="practice-config-header"><span class="practice-config-icon" aria-hidden="true">${icon('messages-square')}</span><div><span class="eyebrow">${uiText('practice.eyebrow')}</span><h2>${uiText('practice.configure')}</h2></div></header><label class="field" for="practice-case">${uiText('practice.case')}</label><select class="context-box" id="practice-case" name="scenario">${Object.entries(roleScenarios()).map(([id,value])=>`<option value="${id}" ${settings.scenario===id?'selected':''}>${uiText(value.label)}</option>`).join('')}</select>${casePick()}<div class="practice-intent-toggle"><label class="practice-intent-check"><input type="checkbox" name="hiddenIntent" ${settings.hiddenIntent!==false?'checked':''}><span><strong>${pt('practice.hiddenIntent')}</strong><small>${pt('practice.hiddenIntentHelp')}</small></span></label>${practiceInfoButton('intent')}</div><div class="practice-persona-heading"><h3>${pt('practice.persona')}</h3><p>${uiText('practice.personaHint')}</p></div><div class="practice-traits-grid">${traits.map(slider).join('')}</div><p class="practice-note">${uiText('practice.respect')}</p><div class="practice-config-actions"><button class="button" type="submit" data-practice-start>${icon('messages-square')}${uiText('practice.start')}</button></div><p class="cloud-error" role="alert" data-practice-error>${esc(error)}</p></form></div>`;
 };
 // The case this rehearsal will use, with a clear way to try another topic before starting.
 function casePick(){
  const item=practiceCases(settings.scenario).find(c=>c.id===settings.caseId);if(!item)return '';
  const lang=uiLanguage(),many=practiceCases(settings.scenario).length>1;
  return `<section class="practice-case-pick" aria-live="polite"><div><small>${uiText('practice.yourCase')}</small><strong>${esc(item.theme[lang])}</strong><p>${esc(item.request[lang])}</p></div>${many?`<button type="button" class="button secondary" data-practice-other-case>${icon('refresh-cw')}${uiText('practice.otherCase')}</button>`:''}</section>`;
 }
 function otherCase(){
  const options=practiceCases(settings.scenario).filter(c=>c.id!==settings.caseId);
  if(options.length)settings.caseId=options[Math.floor(Math.random()*options.length)].id;
 }
 function persist(){
  const context=buildPracticeContext(settings,window.TRATO_DATA);
  cloud.storage.setItem(key(),JSON.stringify(validatePracticeSettings(settings)));
  cloud.practiceContext=context;return context;
 }
 function renderConversation(root){
  const {context,messages}=rehearsal,finished=rehearsal.ended,analysis=rehearsal.view==='analysis',replyBusy=rehearsal.replySubmitting||['queued','running'].includes(rehearsal.replyStatus);
  root.innerHTML=`<section class="workspace-panel practice-conversation ${analysis&&rehearsal.evaluation&&rehearsal.comparisonBaseline?'has-comparison':''}"><header class="practice-conversation-heading"><div><span class="eyebrow">${pt('practice.simulation')}</span><h2 id="practice-conversation-title" tabindex="-1">${uiText(allScenarios[context.scenario_id].label)}${context.case_theme?` · ${esc(context.case_theme)}`:''}</h2><p>${pt('practice.scriptHint')}</p></div><button type="button" class="button secondary practice-finish-action" data-practice-finish>${uiText('practice.finishSession')}</button></header><ol class="practice-stepper" aria-label="${uiText('practice.steps')}">${[['conversation','practice.stepConversation'],['analysis','eval.title']].map(([id,label],index)=>`<li><button type="button" data-practice-step="${id}" ${rehearsal.view===id?'aria-current="step"':''} ${id==='analysis'&&!finished?'disabled':''}><span>${index+1}</span><strong>${uiText(label)}</strong>${id==='conversation'&&finished?icon('check'):''}</button></li>`).join('')}</ol><div class="practice-stage-content">${analysis?`<section class="practice-finished"><p class="practice-finished-label" id="practice-finish" tabindex="-1">${icon('check')}${uiText('practice.finished')}</p><div class="practice-analysis-layout"><div class="practice-analysis-main">${renderPracticeEvaluation(rehearsal)}</div>${rehearsal.evaluation&&rehearsal.comparisonBaseline?`<aside class="practice-analysis-side">${renderPracticeComparison(rehearsal)}</aside>`:''}</div></section>`:`<div class="practice-chat" role="log" aria-label="${uiText('practice.conversation')}" aria-live="polite">${messages.map(message=>`<article class="practice-message ${message.role==='user'?'is-user':''}"><span class="practice-message-avatar ${message.role==='user'?'':'is-tetrato'}" aria-hidden="true">${message.role==='user'?esc(cloud.profile.textContent.trim()):'<img class="practice-tetrato-avatar" src="/assets/mascot/trato-guide.png" alt="" width="44" height="44">'}</span><div class="practice-message-bubble"><strong>${uiText(message.role==='user'?'practice.you':'practice.client')}</strong><p>${esc(message.text)}</p></div></article>`).join('')}</div>${replyBusy?renderAIWait(messages.length?'practice.replyThinking':'practice.openingThinking',messages.length?'practice.replyThinkingHint':'practice.openingThinkingHint'):''}${rehearsal.replyError?`<div class="cloud-error" role="alert">${esc(rehearsal.replyError)}</div><button class="button secondary" data-practice-reply-retry>${uiText(rehearsal.replyUncertain||rehearsal.replyStatus==='failed'?'practice.replyRetry':'practice.replyCheck')}</button>`:''}${finished?`<p class="practice-note">${uiText('practice.finished')}</p>`:`<form data-practice-chat><div class="practice-chat-label"><label for="practice-response">${uiText('practice.reply')}</label><span>${uiText('practice.exchange',{number:messages.filter(m=>m.role==='user').length+1})}</span></div><textarea id="practice-response" name="response" rows="3" maxlength="4000" required ${replyBusy?'disabled':''} placeholder="${pt('practice.replyPlaceholder')}"></textarea><button class="button" type="submit" ${replyBusy||rehearsal.replyError?'disabled':''}>${uiText('practice.respond')}${icon('arrow-right')}</button></form>`}`}</div>${finished&&rehearsal.evaluation?`<div class="practice-next-actions"><button class="button" data-practice-retry>${uiText('practiceCompare.retry')}</button>${context.source_context?.kind==='rehearsal_case'&&practiceCases(context.scenario_id).length>1?`<button class="button secondary" data-practice-new-case>${icon('refresh-cw')}${uiText('practice.newCase')}</button>`:''}</div><p class="practice-note">${uiText('practiceCompare.retryHint')}</p>`:''}</section>`;
  restoreChatScroll(root.querySelector('.practice-chat'),rehearsal.chatScroll);
 }
 function start(repeat=false){
  let previous=null;
  if(repeat){try{previous=practiceAttempt(rehearsal);}catch{throw Error(uiText('practiceCompare.invalid'));}}
  clearTimeout(pollTimer);pollTimer=null;
  cloud.storage.removeItem(key()+':closed');
  cloud.storage.removeItem(key()+':evaluation');
  clearTimeout(replyTimer);cloud.storage.removeItem(key()+':dialogue');
  const context=previous?previous.context:{...persist(),rehearsal_id:crypto.randomUUID()};rehearsal=previous?repeatPracticeAttempt(previous):{context,comparisonBaseline:null,ended:false,view:'conversation',evaluationIndex:0,messages:[]};saveDialogue(rehearsal);cloud.notify();if(!previous)requestReply();cloud.document.querySelector('.practice-conversation')?.scrollIntoView({block:'start'});cloud.document.querySelector('#practice-conversation-title')?.focus({preventScroll:true});
 }
 function saveDialogue(state){
  cloud.storage.setItem(key()+':dialogue',JSON.stringify({version:1,comparisonBaseline:state.comparisonBaseline||null,settings:validatePracticeSettings(settings),output_language:state.context.output_language,rehearsalId:state.context.rehearsal_id||null,messages:state.messages,ended:state.ended===true,jobId:state.replyJobId||null,payload:state.replyPayload,uncertain:state.replyUncertain===true}));
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
  const payload=state.replyUncertain?state.replyPayload:{action:'reply',scenario:state.context.scenario_id,output_language:state.context.output_language,persona:state.context.persona,messages:structuredClone(state.messages),...caseFields(state.context)};
  state.replyPayload=payload;state.replyUncertain=true;saveDialogue(state);cloud.notify();
  try{
   const job=await cloud.request('/api/v1/rehearsals/replies',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':jobId},body:JSON.stringify(payload)});
   if(rehearsal!==state||owner!==cloud.navigationOwner)return;
   state.replySubmitting=false;state.replyUncertain=false;state.replyStatus=job.status;state.replyJobId=job.id;saveDialogue(state);cloud.notify();pollReply(state);
  }catch(issue){if(rehearsal!==state||owner!==cloud.navigationOwner)return;state.replySubmitting=false;state.replyStatus='unavailable';state.replyError=replyError(issue);saveDialogue(state);cloud.notify();}
 }
 function evaluationError(issue){
  const code=issue?.code||'';
  const key=code==='REHEARSAL_QUOTE_BUDGET_EXCEEDED'?'practice.evalQuoteBudgetError':(code.includes('SOURCE')||code.includes('REFERENCE')||code.includes('VECTOR')||code.includes('EMBEDDING'))?'practice.evalSourceError':code.includes('CONTEXT')?'practice.evalContextError':code.includes('CITATION')?'practice.evalCitationError':code.includes('NOT_CONFIGURED')?'practice.evalNotConfigured':(code.includes('LOCAL_MODEL')||code==='MODEL_REQUEST_FAILED')?'practice.evalModelError':'practice.evalFailed';
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
   const payload=state.submissionUncertain?state.evaluationPayload:{action:'evaluate',scenario:state.context.scenario_id,output_language:state.context.output_language,persona:state.context.persona,messages:state.messages,...caseFields(state.context)};
   state.evaluationPayload=payload;
   cloud.storage.setItem(key()+':evaluation',JSON.stringify({version:1,comparisonBaseline:state.comparisonBaseline||null,settings:validatePracticeSettings(settings),messages:state.messages,jobId,payload,submitted:false}));
   const job=await cloud.request('/api/v1/rehearsals/evaluations',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':jobId},body:JSON.stringify(payload)});
   if(rehearsal!==state||owner!==cloud.navigationOwner)return;
   state.jobId=job.id;state.evaluationStatus=job.status;state.evaluationSubmitting=false;state.submissionUncertain=false;
   cloud.storage.setItem(key()+':evaluation',JSON.stringify({version:1,comparisonBaseline:state.comparisonBaseline||null,settings:validatePracticeSettings(settings),messages:state.messages,jobId:job.id,payload,submitted:true}));
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
  root.querySelector(`[data-practice-description="${name}"]`).textContent=pt(`practice.${name}.${value}`);

  event.target.setAttribute('aria-valuetext',uiText('practice.level',{value}));
 });
 cloud.document.addEventListener('change',event=>{
  if(event.target.matches('[data-practice-form] [name="hiddenIntent"]')){settings.hiddenIntent=event.target.checked;return;}
  if(!event.target.matches('#practice-case'))return;settings.scenario=event.target.value;
  const options=practiceCases(settings.scenario);settings.caseId=options.length?options[Math.floor(Math.random()*options.length)].id:undefined;cloud.notify();
 });
 cloud.document.addEventListener('scroll',event=>{if(event.target.matches?.('.practice-chat')&&rehearsal)rehearsal.chatScroll=chatScrollPosition(event.target);},true);
 cloud.document.addEventListener('keydown',event=>{if(cloud.active&&cloud.navigationOwner===owner&&window.location.hash==='#ensayos')submitChatOnEnter(event,'#practice-response');});
 cloud.document.addEventListener('submit',event=>{
  if(event.target.matches('[data-practice-chat]')){
   event.preventDefault();if(!rehearsal||rehearsal.ended||rehearsal.replySubmitting||['queued','running'].includes(rehearsal.replyStatus)||rehearsal.replyError)return;
   const text=event.target.elements.response.value.trim();if(!text)return;
   rehearsal.chatScroll=null;rehearsal.messages.push({role:'user',text});requestReply();return;
  }
  if(!event.target.matches('[data-practice-form]'))return;event.preventDefault();
  try{start();}
  catch(issue){event.target.querySelector('[data-practice-error]').textContent=issue.message;}
 });
 cloud.document.addEventListener('click',event=>{
  const info=event.target.closest('[data-practice-info]');if(info){openComparisonDialog(info.dataset.practiceInfo,info,true);return;}
  const comparison=event.target.closest('[data-practice-comparison-detail]');if(comparison){openComparisonDialog(comparison.dataset.practiceComparisonDetail,comparison);return;}
  if(event.target.closest('[data-practice-other-case]')){otherCase();cloud.notify();cloud.document.querySelector('[data-practice-other-case]')?.focus({preventScroll:true});return;}
  if(event.target.closest('[data-practice-new-case]')){if(!rehearsal)return;settings.scenario=rehearsal.context.scenario_id;if(!settings.caseId)settings.caseId=rehearsal.context.source_context?.case_id;otherCase();try{start();}catch(issue){cloud.message=issue.message;cloud.notify();}return;}
  if(event.target.closest('[data-practice-reply-retry]')){requestReply();return;}
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
  if(event.target.closest('[data-practice-retry]')){
   try{start(Boolean(event.target.closest('[data-practice-retry]')));}catch(issue){const target=cloud.document.querySelector('[data-practice-error]');if(target)target.textContent=issue.message;else{cloud.message=issue.message;cloud.notify();}}return;
  }
  if(event.target.closest('[data-practice-finish]')){requestFinishPractice();return;}
  if(!event.target.closest('[data-practice-reset]'))return;try{cloud.storage.removeItem(key());cloud.storage.removeItem(key()+':evaluation');cloud.storage.removeItem(key()+':dialogue');cloud.storage.removeItem(key()+':evaluation-before-reanalysis');cloud.storage.removeItem(key()+':closed');owner='';settings=null;cloud.notify();}catch{cloud.message=uiText('practice.storageError');cloud.notify();}});
}
