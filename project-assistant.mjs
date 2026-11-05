import {createAgentPanel,agentShell,agentMascot} from './agent-panel.mjs';
import {AIJobClient} from './ai-jobs.mjs';
import {renderAIActivity,submitChatOnEnter,chatScrollPosition,restoreChatScroll} from './ai-activity.mjs';
import {uiText,uiLanguage} from './i18n.mjs';
import {icon} from './icons.mjs';
const text=(key,values)=>uiText(['projectAssistant',key].join('.'),values);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function validateProjectAnswer(value,projectId){
 if(!value||value.kind!=='project_assistant'||value.project_id!==projectId||typeof value.answer!=='string'||typeof value.question!=='string'||!['answered','insufficient_evidence'].includes(value.status)||!Array.isArray(value.citations)||!Array.isArray(value.sources)||!Array.isArray(value.missing_information))throw Error('AI_JOB_INVALID');
 for(const citation of value.citations){
  const source=value.sources.find(s=>s.source_id===citation.source_id);
  if(!source||!['summary','original'].includes(source.source_kind)||typeof source.file_id!=='string'||typeof citation.quote!=='string'||!citation.quote.trim())throw Error('AI_JOB_INVALID');
 }
 return value;
}
export function documentFailurePresentation(inventoryCode,processing){
 const failed=processing&&['failed','unavailable'].includes(processing.status);
 const sharedCodes=['UNAUTHORIZED','PERSISTENCE_UNAVAILABLE','AI_QUEUE_UNAVAILABLE','FILE_PIPELINE_FAILED','VECTOR_PROVIDER_UNAVAILABLE'];
 const shared=!!inventoryCode&&failed&&inventoryCode===processing.error&&sharedCodes.includes(inventoryCode);
 const keys={FILE_PROCESSING_NOT_CONFIGURED:'prepareNotConfigured',FILE_MODEL_NOT_CONFIGURED:'prepareNotConfigured',FILE_PURPOSE_NOT_ENABLED:'prepareNotConfigured',FILE_SOURCE_CHANGED:'prepareSourceChanged',FILE_SCOPE_CHANGED:'prepareSourceChanged',FILE_THREAD_CONTEXT_CONFLICT:'prepareSourceChanged',FILE_EXTRACTION_INVALID:'prepareUnreadable',VECTOR_QUOTA_EXCEEDED:'prepareCapacity',VECTOR_CAPACITY_LIMIT:'prepareCapacity',VECTOR_DOCUMENT_LIMIT:'prepareCapacity',FILE_INDEX_INCOMPLETE:'prepareIndexFailed'};
 return {inventory:inventoryCode?(shared?'documentsSharedFailure':'documentsInventoryFailure'):null,preparation:failed&&!shared?(processing.status==='unavailable'?'prepareUnconfirmed':keys[processing.error]||'prepareFailed'):null};
}
export function documentReviewPresentation(processing){
 if(processing?.status!=='completed'||!['needs_clarification','rejected'].includes(processing.result?.status))return null;
 const reason=processing.result.treatment?.reason;
 return {label:processing.result.status==='needs_clarification'?'prepareNeedsClarification':'prepareRejected',reason:typeof reason==='string'&&reason.trim()&&!/^[A-Z][A-Z0-9_]*$/.test(reason.trim())?reason:''};
}
export function currentDocumentJob(file,snapshot){
 return snapshot&&(file.generation??null)===snapshot.generation?snapshot.job:null;
}
export function documentReadingPresentation(file,local){
 if(file.status!=='source_pending')return null;
 if((file.extraction_error_code||file.error_code)==='EXTRACTION_TEXT_MISSING')return {label:'documentReviewRequired',action:null,error:'readingTextMissing',busy:false};
 if(file.extraction_status==='error')return {label:'readingFailedLabel',action:'retryReading',error:'readingFailed',busy:false};
 const knownJob=file.extraction_job_id||local?.jobId;
 const status=file.extraction_job_id?file.extraction_status:local?.status==='requested'?local.jobStatus:null;
 if(knownJob&&['queued','processing'].includes(status))return {label:status==='processing'?'readingActive':'readingQueued',action:null,busy:true};
 if(local?.status==='submitting')return {label:'readingRequesting',action:null,busy:true};
 if(local?.status==='failed')return {label:'documentReading',action:'retryReading',error:'readingUnconfirmed',busy:false};
 return {label:'documentReading',action:'startReading',busy:false};
}
export function answerScopeMarkup(result){
 const ids=result.source_scope?.document_ids;
 return Array.isArray(ids)&&ids.length?`<small data-answer-document-scope>${text('scopeSelected',{count:ids.length})}</small>`:'';
}
export function documentSelection(files){
 if(!Array.isArray(files)||files.some(file=>typeof file.id!=='string')||new Set(files.map(file=>file.id)).size!==files.length)throw Error('AI_JOB_INVALID');
 return {ready:files.filter(file=>file.summary_status==='ready'),excluded:files.filter(file=>file.summary_status!=='ready')};
}
export function documentScopeMarkup(files,selected,action,disabled=false){
 const {ready,excluded}=documentSelection(files);
 const names=rows=>rows.map(file=>`<li>${esc(file.title||text('documentLabel'))}</li>`).join('');
 if(selected)return `<aside data-agent-document-scope><details data-agent-source="document-scope-selected"><summary>${text('scopeSelected',{count:selected.length})}</summary><ul>${names(selected)}</ul>${files.some(file=>!selected.some(chosen=>chosen.id===file.id))?`<strong>${text('scopeExcluded')}</strong><ul>${names(files.filter(file=>!selected.some(chosen=>chosen.id===file.id)))}</ul>`:''}</details><button type="button" class="text-button" ${action}="all-documents" ${disabled?'disabled':''}>${text('scopeAll')}</button></aside>`;
 if(!excluded.length)return '';
 return `<aside data-agent-document-choice><p>${text('scopeAvailable',{ready:ready.length,pending:excluded.length})}</p><details data-agent-source="document-scope-choice"><summary>${text('scopeReview')}</summary><strong>${text('scopeIncluded')}</strong><ul>${names(ready)}</ul><strong>${text('scopeExcluded')}</strong><ul>${names(excluded)}</ul></details>${ready.length>100?`<p role="status">${text('scopeTooMany')}</p>`:`<button type="button" class="button secondary" ${action}="use-ready" ${disabled||!ready.length?'disabled':''}>${text('scopeUse',{count:ready.length})}</button>`}</aside>`;
}
export function installProjectAssistant(cloud){
 let context=null,sourceTimer=null;
 const agent=createAgentPanel({cloud,id:'project-agent-title',className:'project-agent-drawer',onClose(){if(context)context.agentOpen=false;cloud.document.querySelector('[data-assistant-action="open-agent"]')?.setAttribute('aria-expanded','false');},trigger:()=>cloud.document.querySelector('[data-assistant-action="open-agent"]')});

 const current=state=>context===state&&cloud.active&&cloud.navigationOwner===state.owner&&cloud.projectId===state.project;
 const visible=state=>current(state)&&cloud.tab==='asistente';
 function paint(state){if(visible(state)&&state.agentOpen)renderProjectDrawer(state);}
 function persist(state){cloud.storage.setItem(state.key,JSON.stringify({version:1,ids:state.ids,readings:[...state.readings].filter(([,reading])=>reading.status==='requested'&&reading.jobId).map(([fileId,reading])=>({fileId,...reading}))}));}
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
   for(const file of files)if(file.status==='source_pending'&&file.extraction_job_id&&['queued','processing'].includes(file.extraction_status)&&!state.readings.has(file.id))state.readings.set(file.id,{status:'requested',jobId:file.extraction_job_id,jobStatus:file.extraction_status});
   for(const [id,reading] of state.readings){const file=files.find(f=>f.id===id);if(!file||file.summary_status==='ready'||file.status==='index_error'||file.extraction_status==='error')state.readings.delete(id);}
   persist(state);
   for(const [id,snapshot] of state.processingSnapshots){const file=files.find(f=>f.id===id);if(!file||!currentDocumentJob(file,snapshot))state.processingSnapshots.delete(id);}
  }catch(error){if(current(state))state.sourceError=error.code||'AI_REQUEST_FAILED';}
  finally{if(current(state)){state.sourceLoading=false;state.sourceLoadingInFlight=false;paint(state);clearTimeout(sourceTimer);if(visible(state)&&!state.sourceError&&state.sourceFiles.some(f=>f.summary_status!=='ready'))sourceTimer=setTimeout(()=>{if(visible(state))loadSources(state);},state.readings.size?2000:8000);}}
 }
 function documentJobNotice(state,file){
  const recovery=state.readings.get(file.id);
  if(file.status!=='source_pending'&&recovery?.status==='requested')return `<div class="project-document-progress" data-document-recovery-progress>${file.status==='indexing'?renderAIActivity({label:text('preparing'),compact:true}):`<p role="status">${text('readingAvailabilityPending')}</p>`}</div>`;
  const job=currentDocumentJob(file,state.processingSnapshots.get(file.id));if(!job)return '';
  if(file.summary_status==='ready')return `<p role="status" data-document-prepared>${text('prepared')}</p>`;
  if(['queued','running'].includes(job.status))return `<div class="project-document-progress" data-document-progress>${renderAIActivity({label:text(job.status==='queued'?'prepareQueued':'preparing'),compact:true})}</div>`;
  const errors=documentFailurePresentation(state.sourceError,job);
  if(errors.preparation)return `<p class="cloud-error" role="alert" data-document-error="preparation">${text(errors.preparation)}</p>`;
  const review=documentReviewPresentation(job);
  if(review)return `<div role="status" data-document-review><p><strong>${text(review.label)}</strong></p>${review.reason?`<p data-document-review-reason>${esc(review.reason)}</p>`:''}</div>`;
  if(job.status==='completed'&&job.result?.status==='processed')return `<p role="status" data-document-prepared>${text(file.summary_status==='ready'?'prepared':'prepareAvailabilityPending')}</p>`;
  return '';
 }
 function sourcePanel(state){
  if(!state.sourceOpen)return '';
  const matchingError=[...state.processingSnapshots].map(([id,snapshot])=>{const f=state.sourceFiles.find(file=>file.id===id);return f&&currentDocumentJob(f,snapshot);}).find(job=>job&&job.error===state.sourceError);
  const errors=documentFailurePresentation(state.sourceError,matchingError);
  const files=state.sourceFiles.map(file=>{
   const recovery=state.readings.get(file.id),reading=documentReadingPresentation(file,recovery),recovering=recovery?.status==='requested'||recovery?.status==='submitting';
   const action=reading?!reading.action&&!reading.busy?'':`<button type="button" class="button secondary" data-assistant-action="read" data-document-id="${esc(file.id)}" ${reading.busy?'disabled':''}>${text(reading.action||reading.label)}</button>`:`<button type="button" class="button secondary" data-assistant-action="process" data-document-id="${esc(file.id)}" ${state.preparing||recovering?'disabled':''}>${text(recovering?'readingRequested':'prepare')}</button>`;
   const hint=reading?reading.error?`<p role="alert" class="cloud-error" data-document-reading-error>${text(reading.error)}</p>`:reading.busy?`<p role="status" data-document-reading-progress>${text(reading.label)}</p>`:`<small class="project-document-hint">${text('readingPendingHelp')}</small>`:'';
   return `<article class="project-assistant-file" data-document-row="${esc(file.id)}"><div class="project-document-heading"><span><strong>${esc(file.title)}</strong><small>${text(file.summary_status==='ready'?'documentReady':reading?reading.label:file.error_code==='FILE_REVIEW_REQUIRED'?'documentReviewRequired':'documentPending')}</small></span>${file.summary_status==='ready'?icon('circle-check'):action}</div>${hint}${documentJobNotice(state,file)}</article>`;
  }).join('');
  return `<section class="project-assistant-preparation" aria-label="${text('projectDocuments')}"><header><h4>${text('projectDocuments')}</h4><button type="button" class="text-button" data-assistant-action="close-sources" aria-label="${text('closeDocuments')}" title="${text('closeDocuments')}">${icon('x')}</button></header><p>${text('documentsHint')}</p>${!state.sourceLoading&&!state.sourceError?documentScopeMarkup(state.sourceFiles,state.selectedDocuments,'data-assistant-action',state.job.state.uncertain||['queued','running'].includes(state.job.state.status)):''}${state.sourceError?`<p class="cloud-error" role="alert" data-document-error="inventory">${text(errors.inventory)}</p><button type="button" class="text-button" data-assistant-action="refresh-sources">${text('retrySources')}</button>`:''}${state.sourceLoading&&!files?`<p role="status">${text('loadingSources')}</p>`:files||`<p>${text('noSources')}</p>`}</section>`;
 }
 async function readDocument(state,fileId){
  const file=state.sourceFiles.find(f=>f.id===fileId),reading=file&&documentReadingPresentation(file,state.readings.get(fileId));
  if(!reading||reading.busy||!reading.action)return;
  state.readings.set(fileId,{status:'submitting'});state.processingReveal=fileId;paint(state);
  try{
   const result=await cloud.request(`/api/v1/documents/${fileId}/retry`,{method:'POST'});
   if(!current(state))return;
   if(result.extraction?.status==='ready'||result.status==='ready')state.readings.delete(fileId);
   else if(typeof result.thread_id==='string'&&['queued','processing'].includes(result.status))state.readings.set(fileId,{status:'requested',jobId:result.thread_id,jobStatus:result.status});
   else throw Error('AI_JOB_INVALID');
   persist(state);
  }catch(error){if(current(state))state.readings.set(fileId,{status:'failed',error:error.code||'AI_REQUEST_FAILED'});}
  finally{if(current(state)){paint(state);await loadSources(state);}}
 }
 async function prepare(state,fileId){
  if(state.preparing)return;
  const file=state.sourceFiles.find(f=>f.id===fileId);if(!file||file.status==='source_pending'||['requested','submitting'].includes(state.readings.get(fileId)?.status))return;
  state.processingGeneration=file.generation??null;state.processingReveal=fileId;
  if(state.processingId!==fileId){
   state.processingJob?.dispose();state.processingId=fileId;
   state.processingJob=new AIJobClient({cloud,scope:'prepare-document:'+state.project+':'+fileId,onChange:job=>{
    if(!current(state))return;
    if(!state.processingStarts.has(job.id)&&((job.status==='queued'&&job.uncertain)||(['queued','running'].includes(job.status)&&state.preparing===fileId)))state.processingStarts.set(job.id,state.processingGeneration);
    state.processingSnapshots.set(fileId,{generation:state.processingStarts.get(job.id),job:structuredClone(job)});
    if(['completed','failed','unavailable'].includes(job.status)&&state.agentOpen&&state.sourceOpen){const row=agent.element.querySelector(`[data-document-row="${fileId}"]`),chat=agent.element.querySelector('[data-agent-chat]');if(row&&chat){const r=row.getBoundingClientRect(),c=chat.getBoundingClientRect();if(r.bottom>c.top&&r.top<c.bottom)state.processingReveal=fileId;}}
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
  agent.close();context?.job.dispose();context?.processingJob?.dispose();
  const owner=cloud.navigationOwner,project=cloud.projectId;
  const state={owner,project,key:`${cloud.session.key}:project-assistant:${owner}:${project}`,draft:'',agentOpen:false,ids:[],entries:[],loading:false,historyError:'',sourceFiles:[],readings:new Map(),selectedDocuments:null,sourceOpen:false,sourceLoading:true,sourceError:'',sourceNotice:'',preparing:'',processingId:'',processingJob:null,processingGeneration:null,processingSnapshots:new Map(),processingStarts:new Map()};
  const stored=cloud.storage.getItem(state.key);
  if(stored!==null){const record=JSON.parse(stored);if(record.version!==1||!Array.isArray(record.ids)||record.ids.length>12||record.ids.some(id=>typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id)))throw Error('AI_JOB_INVALID');state.ids=record.ids;if(record.readings!==undefined){if(!Array.isArray(record.readings)||record.readings.some(reading=>typeof reading.fileId!=='string'||typeof reading.jobId!=='string'||reading.status!=='requested'||!['queued','processing'].includes(reading.jobStatus)))throw Error('AI_JOB_INVALID');for(const {fileId,...reading} of record.readings)state.readings.set(fileId,reading);}}
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
 function citations(value){return value.citations.map(citation=>{
  const source=value.sources.find(s=>s.source_id===citation.source_id);
  return `<article class="project-assistant-source"><span>${text(source.source_kind==='summary'?'referenceLabel':'documentLabel')}</span><button type="button" data-assistant-action="source" data-document-id="${esc(source.file_id)}">${icon('file-text')}${esc(source.title||text('documentLabel'))}${icon('arrow-up-right')}</button><blockquote>${esc(citation.quote)}</blockquote>${source.locator?`<small>${text(source.locator.kind==='page'?'page':'sectionLabel')} ${esc(source.locator.page??source.locator.paragraph??source.locator.section??'')}</small>`:''}</article>`;
 }).join('');}
 function renderProjectDrawer(state){
  if(!state.agentOpen)return;
  const job=state.job.state,pending=['queued','running'].includes(job.status),failed=['failed','unavailable'].includes(job.status),disabled=pending||state.loading||state.historyError||state.sourceOpen;
  const messages=state.entries.map(entry=>`<article class="case-agent-exchange"><div class="case-agent-message is-user"><div class="case-agent-bubble"><span>${text('you')}</span><p>${esc(entry.result.question)}</p></div></div><div class="case-agent-message">${agentMascot()}<div class="case-agent-bubble"><span>Trato</span>${answerScopeMarkup(entry.result)}<p>${esc(entry.result.answer)}</p>${entry.result.missing_information.length?`<ul>${entry.result.missing_information.map(info=>`<li>${esc(info)}</li>`).join('')}</ul>`:''}${entry.result.citations.length?`<details data-agent-source="${esc(entry.id)}"><summary>${text('sources')}</summary>${citations(entry.result)}</details>`:''}</div></div></article>`).join('');
  const content=state.sourceOpen?sourcePanel(state):`${state.selectedDocuments?documentScopeMarkup(state.sourceFiles,state.selectedDocuments,'data-assistant-action',pending||job.uncertain):''}${state.loading?`<p role="status">${text('loadingHistory')}</p>`:messages||`<div class="case-agent-empty">${agentMascot()}<h3>${text('agentWelcome')}</h3><p>${text('agentHint')}</p></div>`}${pending?renderAIActivity({label:text(job.status==='queued'?'queued':'thinking'),compact:true}):''}${failed?`<div class="case-agent-error"><p class="cloud-error" role="alert">${messageError(job.error)}</p>${['VECTOR_NO_SOURCES','VECTOR_SOURCE_NOT_READY','VECTOR_INDEX_INCOMPLETE','VECTOR_SUMMARY_INDEX_INCOMPLETE','FILE_SUMMARY_NOT_READY'].includes(job.error)?`<button type="button" class="text-button" data-assistant-action="open-sources">${text('scopeChoose')}</button>`:''}<button type="button" class="text-button" data-assistant-action="retry">${text(job.uncertain?'retrySubmission':'retry')}</button></div>`:''}${state.historyError?`<p class="cloud-error" role="alert">${messageError(state.historyError)}</p>`:''}`;
  const headerActions=`<button type="button" class="agent-header-tool" data-assistant-action="open-sources" aria-pressed="${state.sourceOpen}" aria-label="${text('projectDocuments')}" title="${text('projectDocuments')}">${icon('file-text')}<span>${text('projectDocuments')}</span></button><button type="button" class="case-agent-close" data-assistant-action="clear" title="${text('newConversation')}" aria-label="${text('newConversation')}" ${pending?'disabled':''}>${icon('refresh-cw')}</button>`;
  const composer=`<form class="case-agent-composer" data-project-question><label class="sr-only" for="project-assistant-question">${text('questionLabel')}</label><textarea id="project-assistant-question" name="question" rows="2" maxlength="4000" required ${disabled?'disabled':''} placeholder="${text('placeholder')}">${esc(state.draft)}</textarea><div><small>${text('agentKeyboard')}</small><button type="submit" class="button" ${disabled?'disabled':''}>${text('ask')}${icon('send')}</button></div></form>`;
  agent.render(agentShell({id:'project-agent-title',title:text('agentTitle'),label:text('agentConversation'),closeLabel:text('closeAgent'),headerActions,content,composer,chatAttributes:'data-project-chat'}));
  if(state.processingReveal){const row=agent.element.querySelector(`[data-document-row="${state.processingReveal}"]`),chat=agent.element.querySelector('[data-agent-chat]');if(row&&chat){const r=row.getBoundingClientRect(),c=chat.getBoundingClientRect();if(r.top<c.top)chat.scrollTop+=r.top-c.top;else if(r.bottom>c.bottom)chat.scrollTop+=r.bottom-c.bottom;}state.processingReveal=null;}
 }
 cloud.renderProjectAssistant=function(panel){
  let state;
  try{state=stateForProject();}
  catch{panel.innerHTML=`<section class="workspace-panel"><h3>${text('agentTitle')}</h3><p class="cloud-error" role="alert">${text('historyUnavailable')}</p></section>`;return;}
  panel.innerHTML=`<section class="project-agent-invitation"><div>${agentMascot()}<div><h3>${text('agentTitle')}</h3><p>${text('agentHint')}</p></div></div><button type="button" class="button secondary case-agent-trigger" data-assistant-action="open-agent" aria-haspopup="dialog" aria-expanded="${state.agentOpen}">${text('openAgent')}${icon('arrow-up-right')}</button><button type="button" class="text-button" data-assistant-action="open-documents">${icon('file-text')}${text('projectDocuments')}</button></section>`;
  if(state.agentOpen)renderProjectDrawer(state);
 };
 async function ask(state,question){
  state.chatScroll=null;state.draft=question;
  await state.job.start('/api/v1/ai/project-questions',{project_id:state.project,question,output_language:uiLanguage(),history_ids:state.ids.slice(-6),...(state.selectedDocuments?{document_ids:state.selectedDocuments.map(file=>file.id)}:{})});
 }
 const submit=event=>{
  if(!event.target.matches('[data-project-question]')||!cloud.active||cloud.tab!=='asistente')return;
  event.preventDefault();const state=stateForProject();state.sourceOpen=false;
  const question=new FormData(event.target).get('question').trim();if(question)ask(state,question);
 };
 const input=event=>{if(event.target.matches('#project-assistant-question')&&context&&current(context))context.draft=event.target.value;};
 const click=event=>{
  const button=event.target.closest('[data-assistant-action]');if(!button||!context||!visible(context))return;
  const state=context,action=button.dataset.assistantAction;
  if(action==='open-agent'||action==='open-documents'){
   state.agentOpen=true;if(action==='open-documents'){state.sourceOpen=true;loadSources(state);}
   renderProjectDrawer(state);agent.open(button);button.setAttribute('aria-expanded','true');
  }
  if(action==='open-sources'){state.sourceOpen=!state.sourceOpen;if(state.sourceOpen)loadSources(state);paint(state);if(state.sourceOpen)cloud.document.querySelector('[data-assistant-action=close-sources]')?.focus();}
  if(action==='close-sources'){state.sourceOpen=false;paint(state);cloud.document.querySelector('[data-assistant-action=open-sources]')?.focus();}
  if(action==='refresh-sources')loadSources(state);
  if(action==='read')readDocument(state,button.dataset.documentId);
  if(action==='process')prepare(state,button.dataset.documentId);
  if(action==='source')cloud.run(()=>cloud.previewDocument(button.dataset.documentId));
  if(action==='use-ready'&&!state.sourceLoading&&!state.sourceError&&!state.job.state.uncertain&&!['queued','running'].includes(state.job.state.status)){
   const {ready}=documentSelection(state.sourceFiles);if(!ready.length||ready.length>100)return;
   state.selectedDocuments=structuredClone(ready);state.sourceOpen=false;paint(state);
  }
  if(action==='all-documents'&&!state.job.state.uncertain&&!['queued','running'].includes(state.job.state.status)){state.selectedDocuments=null;paint(state);}
  if(action==='retry'&&state.job.state.payload){
   const previous=state.job.state.payload,chosen=state.selectedDocuments?.map(file=>file.id);
   if(!state.job.state.uncertain&&state.job.state.status==='failed'&&JSON.stringify(previous.document_ids)!==JSON.stringify(chosen))ask(state,previous.question);
   else state.job.start(state.job.state.path,previous);
  }
  if(action==='clear'){
   if(['queued','running'].includes(state.job.state.status))return;
   agent.close();state.job.dispose();state.processingJob?.dispose();state.ids=[];persist(state);cloud.storage.removeItem(state.job.key);context=null;cloud.notify();
  }
 };
 const original=cloud.syncChrome.bind(cloud);
 cloud.syncChrome=function(){original();if(context&&!visible(context))agent.close();if(context&&(!cloud.active||cloud.navigationOwner!==context.owner||cloud.projectId!==context.project)){context.job.dispose();context.processingJob?.dispose();context=null;}};
 const scroll=event=>{if(event.target.matches?.('.project-assistant-log')&&context&&visible(context))context.chatScroll=chatScrollPosition(event.target);};
 cloud.document.addEventListener('scroll',scroll,true);
 const keydown=event=>{if(context&&visible(context))submitChatOnEnter(event,'#project-assistant-question');if(event.key==='Escape'&&context?.sourceOpen){context.sourceOpen=false;paint(context);cloud.document.querySelector('[data-assistant-action=open-sources]')?.focus();}};
 cloud.document.addEventListener('keydown',keydown);
 cloud.document.addEventListener('submit',submit);cloud.document.addEventListener('input',input);cloud.document.addEventListener('click',click);
 return ()=>{agent.dispose();cloud.document.removeEventListener('scroll',scroll,true);clearTimeout(sourceTimer);cloud.document.removeEventListener('keydown',keydown);context?.job.dispose();context?.processingJob?.dispose();cloud.document.removeEventListener('submit',submit);cloud.document.removeEventListener('input',input);cloud.document.removeEventListener('click',click);};
}
