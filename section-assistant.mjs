// TeTrato in Ensayos and Reputación: explains how the section works from Trato's own guide (validated by the API).
// The conversation lives only in this browser session; it never reads projects and never writes rehearsal replies.
import {createAgentPanel} from './agent-panel.mjs';
import {AIJobClient} from './ai-jobs.mjs';
import {renderAIActivity,submitChatOnEnter} from './ai-activity.mjs';
import {uiText,uiLanguage} from './i18n.mjs';
import {icon} from './icons.mjs';
const text=(key,values)=>uiText(['sectionAssistant',key].join('.'),values);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const SECTION_HASHES={'#ensayos':'rehearsals','#reputacion':'reputation'};
const MAX_HISTORY=6;

export function validateSectionAnswer(value,section){
 if(!value||value.kind!=='section_help'||value.section!==section||!['answered','outside_guide'].includes(value.status)||typeof value.answer!=='string'||!value.answer.trim()
  ||!Array.isArray(value.passage_ids)||!Array.isArray(value.passages)||value.passages.length!==value.passage_ids.length
  ||value.passages.some((p,i)=>!p||p.id!==value.passage_ids[i]||typeof p.text!=='string'||!p.text)
  ||(value.status==='answered')!==(value.passages.length>0))throw Error('AI_JOB_INVALID');
 return value;
}
// Earlier turns sent with each question, oldest first, alternating user/assistant.
export function sectionHistory(entries){
 return entries.slice(-MAX_HISTORY).flatMap(entry=>[{role:'user',text:entry.question},{role:'assistant',text:entry.result.answer}]);
}

export function installSectionAssistant(cloud){
 let owner='',panel=null;const states=new Map();
 const fab=cloud.document.createElement&&cloud.document.body?cloud.document.createElement('button'):null;
 if(fab){fab.type='button';fab.className='tetrato-fab';fab.hidden=true;fab.setAttribute('aria-haspopup','dialog');
  fab.innerHTML='<img src="/assets/mascot/trato-guide.png" alt="" width="40" height="40"><span>TeTrato</span>';cloud.document.body.append(fab);}
 const section=()=>cloud.active&&cloud.role!=='client'?SECTION_HASHES[cloud.location.hash]||null:null;
 const open=()=>!!panel?.element.open;
 function updateFab(){
  if(!fab)return;const current=section();
  fab.hidden=!current||open();
  if(current){fab.setAttribute('aria-label',text(`open.${current}`));fab.title=text(`open.${current}`);}
 }
 function reset(){for(const state of states.values())state.job.dispose();states.clear();panel?.close();owner=cloud.navigationOwner;}
 function stateFor(name){
  if(owner!==cloud.navigationOwner)reset();
  if(states.has(name))return states.get(name);
  const state={section:name,entries:[],draft:''};
  state.job=new AIJobClient({cloud,scope:'section-help:'+name,onChange:job=>{
   if(job.status==='completed'&&!state.entries.some(entry=>entry.id===job.id)){
    try{state.entries.push({id:job.id,question:job.payload.question,result:validateSectionAnswer(job.result,name)});}
    catch{state.invalid=job.id;}
   }
   if(open()&&section()===name)paint(state);
  }});
  // A page reload starts a new conversation; an answer still pending from before is not shown out of context.
  if(['queued','running','completed','failed','unavailable'].includes(state.job.state.status))state.job.state={id:null,status:'idle',result:null,error:null,uncertain:false};
  states.set(name,state);return state;
 }
 function screen(name){
  const value=name==='rehearsals'?cloud.practiceScreen?.():cloud.reputationScreen?.();
  return value&&typeof value.view==='string'?value:{view:name==='rehearsals'?'setup':'directory'};
 }
 function errorText(job,state){
  if(state.invalid===job.id)return text('invalid');
  return text(job.error==='AI_EVALUATOR_NOT_CONFIGURED'?'notConfigured':['AI_INVALID_CITATION','AI_INVALID_RESPONSE'].includes(job.error)?'invalid':'error');
 }
 function paint(state){
  if(!panel)return;
  const job=state.job.state,pending=['queued','running'].includes(job.status),failed=['failed','unavailable'].includes(job.status)||(job.status==='completed'&&state.invalid===job.id);
  const you=`<span class="project-assistant-user-avatar" aria-hidden="true">${esc(cloud.profile?.textContent?.trim()||'')||icon('user-round')}</span>`;
  const question=value=>`<div class="project-assistant-user-message">${you}<p class="project-assistant-question"><strong>${text('you')}</strong>${esc(value)}</p></div>`;
  const answer=entry=>`<div class="project-assistant-answer"><strong><img class="project-assistant-avatar" src="/assets/mascot/trato-guide.png" alt="" width="38" height="38">TeTrato</strong>${entry.result.answer.split(/\n{2,}/).map(p=>`<p>${esc(p)}</p>`).join('')}${entry.result.passages.length?`<details data-section-sources><summary>${text('sources',{count:entry.result.passages.length})}</summary><div class="project-assistant-sources">${entry.result.passages.map(p=>`<article class="project-assistant-source"><span>${text('guideLabel')}</span><blockquote>${esc(p.text)}</blockquote></article>`).join('')}</div></details>`:''}</div>`;
  const log=state.entries.map(entry=>`<article class="project-assistant-exchange">${question(entry.question)}${answer(entry)}</article>`).join('');
  const waiting=(pending||failed)&&job.payload?.question?`<article class="project-assistant-exchange">${question(job.payload.question)}${pending?renderAIActivity({label:text('thinking'),compact:true}):`<div class="project-assistant-failure" role="alert"><p class="cloud-error">${esc(errorText(job,state))}</p><button type="button" class="text-button project-assistant-retry" data-section-action="retry">${icon('refresh-cw')}${text('retry')}</button></div>`}</article>`:'';
  const welcome=!log&&!waiting?`<div class="project-assistant-answer"><strong><img class="project-assistant-avatar" src="/assets/mascot/trato-guide.png" alt="" width="38" height="38">TeTrato</strong><p>${text(`welcome.${state.section}`)}</p></div>`:'';
  panel.render(`<div class="case-agent-shell"><header class="case-agent-header"><div class="case-agent-heading"><img class="case-agent-mascot" src="/assets/mascot/trato-guide.png" alt="" width="44" height="44"><div><span>${text(`subtitle.${state.section}`)}</span><h2 id="tetrato-section-title">TeTrato</h2></div></div><button type="button" class="case-agent-close" data-agent-close aria-label="${uiText('Cerrar')}" title="${uiText('Cerrar')}">${icon('x')}</button></header><div class="case-agent-chat tetrato-floating-body" data-agent-chat><section class="workspace-panel project-assistant" aria-label="TeTrato"><div class="project-assistant-log" role="log" aria-live="polite">${welcome}${log}${waiting}</div><form data-section-question><label class="field" for="section-assistant-question">${text('questionLabel')}</label><textarea class="context-box" id="section-assistant-question" name="question" rows="3" maxlength="1000" required ${pending?'disabled':''} placeholder="${text(`placeholder.${state.section}`)}">${esc(state.draft)}</textarea><div class="project-assistant-compose"><small>${text('sessionNote')}</small><button type="submit" class="button" ${pending?'disabled':''}>${text('ask')}${icon('send')}</button></div></form></section></div></div>`);
  const chat=panel.element.querySelector('.project-assistant-log');if(chat)chat.scrollTop=chat.scrollHeight;
 }
 function ask(state,value){
  state.draft='';state.invalid=null;
  void state.job.start('/api/v1/ai/section-questions',{section:state.section,question:value,output_language:uiLanguage(),screen:screen(state.section),history:sectionHistory(state.entries)});
  paint(state);
 }
 fab?.addEventListener('click',()=>{
  const name=section();if(!name)return;
  const state=stateFor(name);
  if(!panel)panel=createAgentPanel({cloud,id:'tetrato-section-title',className:'project-agent-drawer tetrato-floating',onClose:updateFab});
  panel.open(fab);updateFab();paint(state);panel.element.querySelector('#section-assistant-question')?.focus();
 });
 cloud.document.addEventListener('submit',event=>{
  if(!event.target.matches?.('[data-section-question]'))return;event.preventDefault();
  const name=section(),value=event.target.elements.question.value.trim();if(!name||!value)return;
  const state=stateFor(name);if(['queued','running'].includes(state.job.state.status))return;ask(state,value);
 });
 cloud.document.addEventListener('input',event=>{if(event.target.id==='section-assistant-question'&&section())stateFor(section()).draft=event.target.value;});
 cloud.document.addEventListener('keydown',event=>{if(open())submitChatOnEnter(event,'#section-assistant-question');});
 cloud.document.addEventListener('click',event=>{
  if(!event.target.closest?.('[data-section-action="retry"]')||!section())return;
  const state=stateFor(section()),payload=state.job.state.payload;if(!payload)return;
  state.invalid=null;void state.job.start(state.job.state.path,{...payload,screen:screen(state.section)});paint(state);
 });
 const original=cloud.syncChrome.bind(cloud);
 cloud.syncChrome=function(){original();if(owner&&owner!==cloud.navigationOwner)reset();if(open()&&!section())panel.close();updateFab();};
 cloud.document.defaultView?.addEventListener?.('hashchange',()=>{if(open()&&!section())panel.close();updateFab();});
 updateFab();
}
