import {AIJobClient} from './ai-jobs.mjs';
import {renderAIActivity,submitChatOnEnter,chatScrollPosition,restoreChatScroll} from './ai-activity.mjs';
import {uiText,uiLanguage} from './i18n.mjs';
import {icon} from './icons.mjs';
const text=key=>uiText(['projectAssistant',key].join('.'));
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function validateProjectAnswer(value,projectId){
 if(!value||value.kind!=='project_assistant'||value.project_id!==projectId||typeof value.answer!=='string'||typeof value.question!=='string'||!['answered','insufficient_evidence'].includes(value.status)||!Array.isArray(value.citations)||!Array.isArray(value.sources)||!Array.isArray(value.missing_information))throw Error('AI_JOB_INVALID');
 for(const citation of value.citations){
  const source=value.sources.find(s=>s.source_id===citation.source_id);
  if(!source||!['summary','original'].includes(source.source_kind)||typeof source.file_id!=='string'||typeof citation.quote!=='string'||!citation.quote.trim())throw Error('AI_JOB_INVALID');
 }
 return value;
}
export function installProjectAssistant(cloud){
 let context=null,sourceTimer=null;
 const current=state=>context===state&&cloud.active&&cloud.navigationOwner===state.owner&&cloud.projectId===state.project;
 const visible=state=>current(state)&&cloud.tab==='asistente';
 function paint(state){if(visible(state))cloud.notify();}
 function persist(state){cloud.storage.setItem(state.key,JSON.stringify({version:1,ids:state.ids}));}
 async function loadSources(state){
  if(state.sourceLoadingInFlight)return;state.sourceLoadingInFlight=true;state.sourceLoading=true;
  try{
   const files=[];let offset=0;
   do{
    const value=await cloud.request(`/api/v1/projects/${state.project}/sources?offset=${offset}&limit=100`);
    if(!current(state))return;
    if(!Array.isArray(value.files)||!Number.isInteger(value.total))throw Error('AI_JOB_INVALID');
    files.push(...value.files);offset=value.next_offset;
    if(files.length>1000||offset!==null&&(!Number.isInteger(offset)||offset<files.length))throw Error('AI_JOB_INVALID');
   }while(offset!==null);
   state.sourceFiles=files;state.sourceError='';
  }catch(error){if(current(state))state.sourceError=error.code||'AI_REQUEST_FAILED';}
  finally{if(current(state)){state.sourceLoading=false;state.sourceLoadingInFlight=false;paint(state);clearTimeout(sourceTimer);if(visible(state)&&!state.sourceError&&state.sourceFiles.some(f=>f.summary_status!=='ready'))sourceTimer=setTimeout(()=>{if(visible(state))loadSources(state);},8000);}}
 }
 function sourcePanel(state){
  if(!state.sourceOpen)return '';
  const processing=state.processingJob?.state;
  const busy=processing&&['queued','running'].includes(processing.status);
  return `<section class="project-assistant-preparation" role="dialog" aria-label="${text('projectDocuments')}"><header><h4>${text('projectDocuments')}</h4><button type="button" class="text-button" data-assistant-action="close-sources" aria-label="${text('closeDocuments')}" title="${text('closeDocuments')}">${icon('x')}</button></header><p>${text('prepareHelp')}</p>${state.sourceLoading?`<p role="status">${text('loadingSources')}</p>`:state.sourceError?`<p class="cloud-error" role="alert">${messageError(state.sourceError)}</p>`:state.sourceFiles.length?state.sourceFiles.map(file=>`<div class="project-assistant-file"><span><strong>${esc(file.title)}</strong><small>${text(file.summary_status==='ready'?'documentReady':file.status==='source_pending'?'documentReading':'documentPending')}</small></span>${file.summary_status==='ready'?icon('circle-check'):`<button type="button" class="button secondary" data-assistant-action="process" data-document-id="${esc(file.id)}" ${state.preparing||file.status==='source_pending'?'disabled':''}>${text('prepare')}</button>`}</div>`).join(''):`<p>${text('noSources')}</p>`}${busy?renderAIActivity({label:text('preparing'),hint:text('prepareWait')}):''}${processing&&['failed','unavailable'].includes(processing.status)?`<p class="cloud-error" role="alert">${messageError(processing.error)}</p>`:''}${state.sourceNotice?`<p role="status">${text(state.sourceNotice)}</p>`:''}${state.sourceError?`<button type="button" class="text-button" data-assistant-action="refresh-sources">${text('retrySources')}</button>`:''}</section>`;
 }
 async function prepare(state,fileId){
  if(state.preparing)return;
  const file=state.sourceFiles.find(f=>f.id===fileId);if(!file||file.status==='source_pending')return;
  if(state.processingId!==fileId){
   state.processingJob?.dispose();state.processingId=fileId;
   state.processingJob=new AIJobClient({cloud,scope:'prepare-document:'+state.project+':'+fileId,onChange:job=>{
    if(!current(state))return;
    if(job.status==='completed'){
     state.preparing='';state.sourceNotice=job.result?.status==='processed'?'prepared':'requiresReview';loadSources(state);
    }
    if(['failed','unavailable'].includes(job.status))state.preparing='';
    paint(state);
   }});
  }
  state.preparing=fileId;state.sourceNotice='';
  await state.processingJob.start(`/api/v1/projects/${state.project}/documents/${fileId}/process`,{output_language:uiLanguage()});
 }
 async function restore(state){
  try{
   const entries=[];
   for(const id of state.ids){
    const job=await cloud.request('/api/v1/ai/jobs/'+encodeURIComponent(id));
    if(!current(state))return;
    if(job.id!==id||job.status!=='completed')throw Error('AI_JOB_INVALID');
    entries.push({id,result:validateProjectAnswer(job.result,state.project)});
   }
   if(!current(state))return;
   state.entries=entries;state.loading=false;paint(state);
   if(state.job.state.id)await state.job.check();
  }catch(error){if(current(state)){state.loading=false;state.historyError=error.code||'AI_JOB_INVALID';paint(state);}}
 }
 function stateForProject(){
  if(context&&context.project===cloud.projectId&&context.owner===cloud.navigationOwner)return context;
  context?.job.dispose();context?.processingJob?.dispose();
  const owner=cloud.navigationOwner,project=cloud.projectId;
  const state={owner,project,key:`${cloud.session.key}:project-assistant:${owner}:${project}`,draft:'',ids:[],entries:[],loading:false,historyError:'',sourceFiles:[],sourceOpen:false,sourceLoading:true,sourceError:'',sourceNotice:'',preparing:'',processingId:'',processingJob:null};
  const stored=cloud.storage.getItem(state.key);
  if(stored!==null){const record=JSON.parse(stored);if(record.version!==1||!Array.isArray(record.ids)||record.ids.length>12||record.ids.some(id=>typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id)))throw Error('AI_JOB_INVALID');state.ids=record.ids;}
  context=state;
  state.job=new AIJobClient({cloud,scope:'project-assistant:'+project,onChange:job=>{
   if(!current(state))return;
   if(job.status==='completed'){
    const result=validateProjectAnswer(job.result,project);
    const entry=state.entries.find(e=>e.id===job.id);
    if(entry)entry.result=result;
    else{state.entries.push({id:job.id,result});state.ids.push(job.id);if(state.ids.length>12){state.ids.shift();state.entries.shift();}persist(state);}
   }
   paint(state);
  }});
  queueMicrotask(()=>loadSources(state));
  state.loading=state.ids.length>0;
  if(state.loading)queueMicrotask(()=>restore(state));
  else if(state.job.state.id)queueMicrotask(()=>state.job.check());
  return state;
 }
 function messageError(code){
  const keys={VECTOR_NO_SOURCES:'noSources',VECTOR_SOURCE_NOT_READY:'sourcesPending',VECTOR_INDEX_INCOMPLETE:'indexPending',VECTOR_SUMMARY_INDEX_INCOMPLETE:'summaryPending',FILE_SUMMARY_NOT_READY:'summaryPending',FILE_SUMMARY_CHANGED:'sourcesChanged',VECTOR_SOURCE_CHANGED:'sourcesChanged',AI_NOT_FOUND:'historyUnavailable',AI_INVALID_CITATION:'invalidEvidence',AI_CONTEXT_INVALID:'historyUnavailable',AI_JOB_INVALID:'historyUnavailable',AI_EVALUATOR_NOT_CONFIGURED:'notConfigured'};
  return text(keys[code]||'error');
 }
 cloud.renderProjectAssistant=function(panel){
  let state;
  try{state=stateForProject();}
  catch{panel.innerHTML=`<section class="workspace-panel project-assistant"><h3>${text('title')}</h3><p class="cloud-error" role="alert">${text('historyUnavailable')}</p></section>`;return;}
  const job=state.job.state,pending=['queued','running'].includes(job.status),failed=['failed','unavailable'].includes(job.status);
  const citations=value=>value.citations.map(citation=>{
   const source=value.sources.find(s=>s.source_id===citation.source_id);
   return `<article class="project-assistant-source"><span>${text(source.source_kind==='summary'?'summarySource':'originalSource')}</span><button type="button" data-assistant-action="source" data-document-id="${esc(source.file_id)}">${icon('file-text')}${esc(source.title)}${icon('arrow-up-right')}</button><blockquote>${esc(citation.quote)}</blockquote>${source.locator?`<small>${text(source.locator.kind==='page'?'page':'paragraph')} ${esc(source.locator[source.locator.kind])}</small>`:''}</article>`;
  }).join('');
  panel.innerHTML=`<section class="workspace-panel project-assistant" aria-label="${text('title')}"><header><div><span class="eyebrow">${text('eyebrow')}</span><h3>${text('title')}</h3><p>${text('intro')}</p></div><button type="button" class="text-button" data-assistant-action="clear" ${pending?'disabled':''}>${icon('refresh-cw')}${text('newConversation')}</button></header><div class="project-assistant-log" role="log" aria-live="polite">${state.loading?`<p role="status">${text('loadingHistory')}</p>`:state.entries.map(entry=>`<article class="project-assistant-exchange"><p class="project-assistant-question"><strong>${text('you')}</strong>${esc(entry.result.question)}</p><div class="project-assistant-answer"><strong><img class="project-assistant-avatar" src="/assets/mascot/trato-guide.png" alt="" width="38" height="38">${text('answer')}</strong><p>${esc(entry.result.answer)}</p>${entry.result.missing_information.length?`<ul>${entry.result.missing_information.map(info=>`<li>${esc(info)}</li>`).join('')}</ul>`:''}${entry.result.citations.length?`<details><summary>${text('sources')}</summary><div class="project-assistant-sources">${citations(entry.result)}</div></details>`:''}</div></article>`).join('')||`<div class="project-assistant-empty">${icon('messages-square')}<h4>${text('emptyTitle')}</h4><p>${text('emptyCopy')}</p></div>`}</div>${pending?renderAIActivity({label:text(job.status==='queued'?'queued':'thinking'),hint:text('waitHint')}):''}${failed?`<p class="cloud-error" role="alert">${messageError(job.error)}</p><button type="button" class="button secondary" data-assistant-action="retry">${text(job.uncertain?'retrySubmission':'retry')}</button>`:''}${state.historyError?`<p class="cloud-error" role="alert">${messageError(state.historyError)}</p>`:''}<form data-project-question><label class="field" for="project-assistant-question">${text('questionLabel')}</label><textarea class="context-box" id="project-assistant-question" name="question" rows="3" maxlength="4000" required ${pending||state.loading||state.historyError?'disabled':''} placeholder="${text('placeholder')}">${esc(state.draft)}</textarea><div class="project-assistant-document-tools"><button type="button" class="text-button" data-assistant-action="open-sources" aria-haspopup="dialog" aria-expanded="${state.sourceOpen}">${icon('file-text')}${text('projectDocuments')}</button>${sourcePanel(state)}</div><div class="project-assistant-compose"><small>${text('scopeNote')}</small><button type="submit" class="button" ${pending||state.loading||state.historyError?'disabled':''}>${text('ask')}${icon('send')}</button></div></form></section>`;
  restoreChatScroll(panel.querySelector('.project-assistant-log'),state.chatScroll);
 };
 async function ask(state,question){
  state.chatScroll=null;state.draft=question;
  await state.job.start('/api/v1/ai/project-questions',{project_id:state.project,question,output_language:uiLanguage(),history_ids:state.ids.slice(-6)});
 }
 const submit=event=>{
  if(!event.target.matches('[data-project-question]')||!cloud.active||cloud.tab!=='asistente')return;
  event.preventDefault();const state=stateForProject();
  const question=new FormData(event.target).get('question').trim();if(question)ask(state,question);
 };
 const input=event=>{if(event.target.matches('#project-assistant-question')&&context&&current(context))context.draft=event.target.value;};
 const click=event=>{
  const button=event.target.closest('[data-assistant-action]');if(!button||!context||!visible(context))return;
  const state=context,action=button.dataset.assistantAction;
  if(action==='open-sources'){state.sourceOpen=!state.sourceOpen;if(state.sourceOpen)loadSources(state);paint(state);if(state.sourceOpen)cloud.document.querySelector('[data-assistant-action=close-sources]')?.focus();}
  if(action==='close-sources'){state.sourceOpen=false;paint(state);cloud.document.querySelector('[data-assistant-action=open-sources]')?.focus();}
  if(action==='refresh-sources')loadSources(state);
  if(action==='process')prepare(state,button.dataset.documentId);
  if(action==='source')cloud.run(()=>cloud.previewDocument(button.dataset.documentId));
  if(action==='retry'&&state.job.state.payload)state.job.start(state.job.state.path,state.job.state.payload);
  if(action==='clear'){
   if(['queued','running'].includes(state.job.state.status))return;
   state.job.dispose();state.processingJob?.dispose();cloud.storage.removeItem(state.key);cloud.storage.removeItem(state.job.key);context=null;cloud.notify();
  }
 };
 const original=cloud.syncChrome.bind(cloud);
 cloud.syncChrome=function(){original();if(context&&(!cloud.active||cloud.navigationOwner!==context.owner||cloud.projectId!==context.project)){context.job.dispose();context.processingJob?.dispose();context=null;}};
 const scroll=event=>{if(event.target.matches?.('.project-assistant-log')&&context&&visible(context))context.chatScroll=chatScrollPosition(event.target);};
 cloud.document.addEventListener('scroll',scroll,true);
 const keydown=event=>{if(context&&visible(context))submitChatOnEnter(event,'#project-assistant-question');if(event.key==='Escape'&&context?.sourceOpen){context.sourceOpen=false;paint(context);cloud.document.querySelector('[data-assistant-action=open-sources]')?.focus();}};
 cloud.document.addEventListener('keydown',keydown);
 cloud.document.addEventListener('submit',submit);cloud.document.addEventListener('input',input);cloud.document.addEventListener('click',click);
 return ()=>{cloud.document.removeEventListener('scroll',scroll,true);clearTimeout(sourceTimer);cloud.document.removeEventListener('keydown',keydown);context?.job.dispose();context?.processingJob?.dispose();cloud.document.removeEventListener('submit',submit);cloud.document.removeEventListener('input',input);cloud.document.removeEventListener('click',click);};
}
