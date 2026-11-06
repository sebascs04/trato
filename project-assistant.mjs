import {createAgentPanel,agentShell} from './agent-panel.mjs';
import {AIJobClient} from './ai-jobs.mjs';
import {renderAIActivity,submitChatOnEnter,chatScrollPosition,restoreChatScroll} from './ai-activity.mjs';
import {uiText,uiLanguage} from './i18n.mjs';
import {icon} from './icons.mjs';
const text=(key,values)=>uiText(['projectAssistant',key].join('.'),values);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function projectDocumentError(code){
 const messages={VECTOR_NO_SOURCES:'noSources',VECTOR_SOURCE_NOT_READY:'sourcesPending',
  VECTOR_INDEX_INCOMPLETE:'indexPending',VECTOR_SUMMARY_INDEX_INCOMPLETE:'summaryPending',
  FILE_SUMMARY_NOT_READY:'summaryPending'};
 return messages[code]?text(messages[code]):null;
}
export function validateProjectAnswer(value,projectId){
 if(!value||value.kind!=='project_assistant'||value.project_id!==projectId||typeof value.answer!=='string'||typeof value.question!=='string'||!['answered','insufficient_evidence'].includes(value.status)||!Array.isArray(value.citations)||!Array.isArray(value.sources)||!Array.isArray(value.missing_information))throw Error('AI_JOB_INVALID');
 if(value.answer_basis!==undefined&&!['documents','conversation'].includes(value.answer_basis)||value.status==='answered'&&value.answer_basis!=='conversation'&&!value.citations.length)throw Error('AI_JOB_INVALID');
 for(const citation of value.citations){
  const source=value.sources.find(s=>s.source_id===citation.source_id);
  if(!source||!['summary','original','plan','status'].includes(source.source_kind)||typeof source.file_id!=='string'||typeof citation.quote!=='string'||!citation.quote.trim())throw Error('AI_JOB_INVALID');
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
 let context=null,sourceTimer=null,documentsPanel=null,documentsClosed=null,floatingPanel=null;
 // One TeTrato per project: the floating drawer shows the same conversation as the Assistant tab.
 const fab=cloud.document.createElement&&cloud.document.body?cloud.document.createElement('button'):null;
 if(fab){fab.type='button';fab.className='tetrato-fab';fab.hidden=true;
  fab.setAttribute('aria-haspopup','dialog');fab.setAttribute('aria-label',text('openFloating'));fab.title=text('openFloating');
  fab.innerHTML='<img src="/assets/mascot/trato-guide.png" alt="" width="40" height="40"><span>TeTrato</span>';
  cloud.document.body.append(fab);}
 const floatingOpen=()=>!!floatingPanel?.element.open;
 function updateFab(){
  if(!fab)return;fab.hidden=!(cloud.active&&cloud.projectId&&!['asistente','devoluciones'].includes(cloud.tab)&&!floatingOpen());
  // Same bottom line as the section guide launcher, placed to its left so neither covers the other.
  const launcher=cloud.document.querySelector?.('.guide-launcher'),width=launcher&&!launcher.hidden?launcher.getBoundingClientRect?.().width:0;
  fab.style.right=width?`${Math.round(28+width+12)}px`:'';
 }
 function focusTarget(){
  // Where the user is looking: a change request detail. Verified again by the backend.
  if(cloud.tab!=='solicitudes'||!cloud.requestId)return null;
  const doc=cloud.documents?.find(item=>item.id===cloud.requestId);
  return doc?{id:doc.id,title:doc.title}:null;
 }
 function renderFloating(state){
  const body=cloud.document.createElement('div');cloud.renderProjectAssistant(body);
  const focus=state.focus?`<p class="tetrato-focus">${icon('file-text')}<span>${text('focusLabel')} ${esc(state.focus.title)}</span></p>`:'';
  floatingPanel.render(`<div class="case-agent-shell"><header class="case-agent-header"><div class="case-agent-heading"><img class="case-agent-mascot" src="/assets/mascot/trato-guide.png" alt="" width="44" height="44"><div><span>Trato</span><h2 id="tetrato-floating-title">TeTrato</h2></div></div><button type="button" class="case-agent-close" data-agent-close aria-label="${uiText('Cerrar')}" title="${uiText('Cerrar')}">${icon('x')}</button></header>${focus}<div class="case-agent-chat tetrato-floating-body" data-agent-chat>${body.innerHTML}</div></div>`);
  restoreChatScroll(floatingPanel.element.querySelector('.project-assistant-log'),state.chatScroll);
 }
 fab?.addEventListener('click',()=>{
  const state=stateForProject();state.focus=focusTarget();
  if(!floatingPanel)floatingPanel=createAgentPanel({cloud,id:'tetrato-floating-title',className:'project-agent-drawer tetrato-floating',onClose(){if(context)context.focus=null;updateFab();}});
  floatingPanel.open(fab);updateFab();renderFloating(state);
  floatingPanel.element.querySelector('#project-assistant-question')?.focus();
 });

 const current=state=>context===state&&cloud.active&&cloud.navigationOwner===state.owner&&cloud.projectId===state.project;
 const visible=state=>current(state)&&(cloud.tab==='asistente'||documentsPanel?.element.open||floatingOpen());
 function paint(state){
  if(!visible(state))return;
  if(documentsPanel?.element.open){
   documentsPanel.render(agentShell({id:'project-documents-title',title:text('projectDocuments'),
    label:text('projectDocuments'),closeLabel:text('closeDocuments'),content:sourcePanel(state),composer:''}));
  }else if(floatingOpen())renderFloating(state);
  else cloud.notify();
 }
 cloud.openProjectDocuments=function(button,onClose){
  const state=stateForProject();
  if(!documentsPanel)documentsPanel=createAgentPanel({cloud,id:'project-documents-title',className:'project-agent-drawer',
   onClose(){
    if(context)context.sourceOpen=false;
    const callback=documentsClosed;
    documentsClosed=null;
    callback?.();
   }});
  documentsClosed=onClose;
  state.sourceOpen=true;
  documentsPanel.open(button);
  paint(state);
  loadSources(state);
 };

 function persist(state){cloud.storage.setItem(state.key,JSON.stringify({version:1,ids:[],readings:[...state.readings].map(([fileId,reading])=>({fileId,...reading}))}));}
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
  return `<section class="project-assistant-preparation" aria-label="${text('projectDocuments')}"><header><h4>${text('projectDocuments')}</h4><button type="button" class="text-button" data-assistant-action="close-sources" aria-label="${text('closeDocuments')}" title="${text('closeDocuments')}">${icon('x')}</button></header><p>${text('documentsHint')}</p>${!documentsPanel?.element.open&&!state.sourceLoading&&!state.sourceError?documentScopeMarkup(state.sourceFiles,state.selectedDocuments,'data-assistant-action',state.job.state.uncertain||['queued','running'].includes(state.job.state.status)):''}${state.sourceError?`<p class="cloud-error" role="alert" data-document-error="inventory">${text(errors.inventory)}</p><button type="button" class="text-button" data-assistant-action="refresh-sources">${text('retrySources')}</button>`:''}${state.sourceLoading&&!files?`<p role="status">${text('loadingSources')}</p>`:files||`<p>${text('noSources')}</p>`}</section>`;
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
    if(['completed','failed','unavailable'].includes(job.status)&&state.sourceOpen){const row=cloud.document.querySelector(`[data-document-row="${fileId}"]`),chat=cloud.document.querySelector('.project-assistant-log');if(row&&chat){const r=row.getBoundingClientRect(),c=chat.getBoundingClientRect();if(r.bottom>c.top&&r.top<c.bottom)state.processingReveal=fileId;}}
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
 async function restore(state,before=null){
  state.loading=true;state.historyError='';paint(state);
  try{
   const page=await cloud.request(`/api/v1/projects/${state.project}/assistant/conversation${before?'?before='+before:''}`);
   if(!current(state))return;
   if(!Array.isArray(page.entries)||page.next_before!==null&&!Number.isSafeInteger(page.next_before))throw Error('AI_JOB_INVALID');
   const entries=page.entries.map(entry=>({id:entry.id,position:entry.position,result:validateProjectAnswer(entry.result,state.project)}));
   if(entries.some(entry=>typeof entry.id!=='string'||!Number.isSafeInteger(entry.position)))throw Error('AI_JOB_INVALID');
   state.entries=before?[...entries,...state.entries.filter(entry=>!entries.some(older=>older.id===entry.id))]:entries;
   state.nextBefore=page.next_before;
   if(!before&&state.job.state.id&&['queued','running','unavailable'].includes(state.job.state.status))await state.job.check();
   if(!current(state))return;
   state.loading=false;
   if(!before&&(state.entries.length||state.job.state.payload?.question)&&state.followPage!==false){state.chatScroll=null;state.followPage=true;state.revealPage=true;}
   paint(state);
  }catch(error){if(current(state)){state.loading=false;state.historyError=error.code||'AI_JOB_INVALID';paint(state);}}
 }
 function stateForProject(){
  if(context&&context.project===cloud.projectId&&context.owner===cloud.navigationOwner)return context;
  context?.job.dispose();context?.processingJob?.dispose();
  const owner=cloud.navigationOwner,project=cloud.projectId;
  const state={owner,project,key:`${cloud.session.key}:project-assistant:${owner}:${project}`,draft:'',agentOpen:false,followPage:true,pageScroll:cloud.document.defaultView?.scrollY,ids:[],entries:[],loading:false,historyError:'',sourceFiles:[],readings:new Map(),selectedDocuments:null,sourceOpen:false,sourceLoading:true,sourceError:'',sourceNotice:'',preparing:'',processingId:'',processingJob:null,processingGeneration:null,processingSnapshots:new Map(),processingStarts:new Map()};
  const stored=cloud.storage.getItem(state.key);
  if(stored!==null){const record=JSON.parse(stored);if(record.version!==1||!Array.isArray(record.ids)||record.ids.some(id=>typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id)))throw Error('AI_JOB_INVALID');state.ids=record.ids;if(record.readings!==undefined){if(!Array.isArray(record.readings)||record.readings.some(reading=>typeof reading.fileId!=='string'||typeof reading.jobId!=='string'||reading.status!=='requested'||!['queued','processing'].includes(reading.jobStatus)))throw Error('AI_JOB_INVALID');for(const {fileId,...reading} of record.readings)state.readings.set(fileId,reading);}}
  context=state;
  state.job=new AIJobClient({cloud,scope:'project-assistant:'+project,onChange:job=>{
   if(!current(state))return;
   if(job.status!==state.lastJobStatus){
    state.lastJobStatus=job.status;
    if(state.followPage&&(!state.chatScroll||state.chatScroll.follow))state.revealPage=true;
   }
   if(job.status==='completed'){
    const result=validateProjectAnswer(job.result,project);
    const entry=state.entries.find(e=>e.id===job.id);
    if(entry)entry.result=result;
    else state.entries.push({id:job.id,result});
   }
   paint(state);
  }});

  state.loading=true;state.nextBefore=null;queueMicrotask(()=>restore(state));
  return state;
 }
 function messageError(code){
  const keys={FILE_SUMMARY_CHANGED:'sourcesChanged',VECTOR_SOURCE_CHANGED:'sourcesChanged',AI_NOT_FOUND:'historyUnavailable',AI_INVALID_CITATION:'invalidEvidence',AI_CONTEXT_INVALID:'historyUnavailable',AI_JOB_INVALID:'historyUnavailable',AI_EVALUATOR_NOT_CONFIGURED:'notConfigured',AI_MEMORY_CONFLICT:'memoryConflict',AI_MEMORY_INVALID:'memoryError',AI_MEMORY_CONTEXT_LIMIT:'memoryError'};
  return projectDocumentError(code)||text(keys[code]||'error');
 }
 function citations(value){return value.citations.map(citation=>{
  const source=value.sources.find(s=>s.source_id===citation.source_id);
  return `<article class="project-assistant-source"><span>${text(source.source_kind==='plan'?'planLabel':source.source_kind==='status'?'statusLabel':source.source_kind==='summary'?'referenceLabel':'documentLabel')}</span><button type="button" data-assistant-action="${source.source_kind==='plan'?'plan':source.source_kind==='status'?'status':'source'}" data-document-id="${esc(source.file_id)}">${icon('file-text')}${esc(source.source_kind==='plan'?text('planLabel'):source.source_kind==='status'?text('statusLabel'):source.title||text('documentLabel'))}${icon('arrow-up-right')}</button><blockquote>${esc(citation.quote)}</blockquote>${source.locator?`<small>${text(source.locator.kind==='page'?'page':'sectionLabel')} ${esc(source.locator.page??source.locator.paragraph??source.locator.section??'')}</small>`:''}</article>`;
 }).join('');}
 cloud.renderProjectAssistant=function(panel){
  let state;
  try{state=stateForProject();}
  catch{panel.innerHTML=`<section class="workspace-panel project-assistant"><h3>${text('title')}</h3><p class="cloud-error" role="alert">${text('historyUnavailable')}</p></section>`;return;}
  const job=state.job.state,pending=['queued','running'].includes(job.status),failed=['failed','unavailable'].includes(job.status);
  const citations=value=>value.citations.map(citation=>{
   const source=value.sources.find(s=>s.source_id===citation.source_id);
   return `<article class="project-assistant-source"><span>${text(source.source_kind==='status'?'statusLabel':source.source_kind==='summary'?'summarySource':'originalSource')}</span><button type="button" data-assistant-action="${source.source_kind==='plan'?'plan':source.source_kind==='status'?'status':'source'}" data-document-id="${esc(source.file_id)}">${icon('file-text')}${esc(source.source_kind==='status'?text('statusLabel'):source.title)}${icon('arrow-up-right')}</button><blockquote>${esc(citation.quote)}</blockquote>${source.locator?`<small>${text(source.locator.kind==='page'?'page':'paragraph')} ${esc(source.locator[source.locator.kind])}</small>`:''}</article>`;
  }).join('');
  const submitted=typeof job.payload?.question==='string'&&!!job.payload.question.trim();
  const unanswered=submitted&&!state.entries.some(entry=>entry.id===job.id);
  const questionMarkup=question=>`<div class="project-assistant-user-message"><span class="project-assistant-user-avatar" aria-hidden="true">${esc(cloud.profile?.textContent?.trim()||'')||icon('user-round')}</span><p class="project-assistant-question"><strong>${text('you')}</strong>${esc(question)}</p></div>`;
  const activity=pending?renderAIActivity({label:text(job.status==='queued'?'queued':'thinking'),hint:text('waitHint')}):'';
  const failure=failed?`<div class="project-assistant-failure" role="alert"><button type="button" class="text-button project-assistant-retry" data-assistant-action="retry" title="${text('retry')}" aria-label="${text('messageRetry')}">${icon('refresh-cw')}${text('messageRetry')}</button></div>`:'';
  panel.innerHTML=`<section class="workspace-panel project-assistant" aria-label="${text('title')}"><header><div><span class="eyebrow">${text('eyebrow')}</span><h3>${text('title')}</h3><p>${text('intro')}</p></div></header><div class="project-assistant-log" role="log" aria-live="polite">${state.nextBefore?`<button type="button" class="text-button" data-assistant-action="older" ${state.loading?'disabled':''}>${text('olderMessages')}</button>`:''}${state.loading?`<div class="project-assistant-loading">${renderAIActivity({label:text('loadingHistory'),compact:true})}</div>`:state.entries.map(entry=>`<article class="project-assistant-exchange">${questionMarkup(entry.result.question)}<div class="project-assistant-answer"><strong><img class="project-assistant-avatar" src="/assets/mascot/trato-guide.png" alt="" width="38" height="38">${text('answer')}</strong><p>${esc(entry.result.answer)}</p>${answerScopeMarkup(entry.result)}${entry.result.missing_information.length?`<ul>${entry.result.missing_information.map(info=>`<li>${esc(info)}</li>`).join('')}</ul>`:''}${entry.result.citations.length?`<details data-project-answer-sources><summary>${text('sources')}</summary><div class="project-assistant-sources">${citations(entry.result)}</div></details>`:''}</div></article>`).join('')||(!submitted?`<div class="project-assistant-empty">${icon('messages-square')}<h4>${text('emptyTitle')}</h4><p>${text('emptyCopy')}</p></div>`:'')}${state.loading?'':unanswered?`<article class="project-assistant-exchange" data-pending-question>${questionMarkup(job.payload.question)}${activity}${failure}</article>`:activity+failure}</div>${state.historyError?`<p class="cloud-error" role="alert">${messageError(state.historyError)}</p><button type="button" class="text-button" data-assistant-action="reload-history">${text('retry')}</button>`:''}<form data-project-question><label class="field" for="project-assistant-question">${text('questionLabel')}</label><textarea class="context-box" id="project-assistant-question" name="question" rows="3" maxlength="4000" required ${pending||state.loading||state.historyError?'disabled':''} placeholder="${text('placeholder')}">${esc(state.draft)}</textarea><div class="project-assistant-compose"><small>${text('scopeNote')}</small><button type="submit" class="button" ${pending||state.loading||state.historyError?'disabled':''}>${text('ask')}${icon('send')}</button></div></form></section>`;
  restoreChatScroll(panel.querySelector('.project-assistant-log'),state.chatScroll);
  if(state.revealPage&&!state.loading){
   state.revealPage=false;
   queueMicrotask(()=>{
    if(!visible(state)||!state.followPage)return;
    const reveal=()=>{
     if(!visible(state)||!state.followPage)return;
     const form=cloud.document.querySelector?.('[data-project-question]');
     form?.scrollIntoView?.({block:'end',behavior:'instant'});
     state.pageScroll=cloud.document.defaultView?.scrollY;
    };
    const view=cloud.document.defaultView;
    if(view?.requestAnimationFrame)view.requestAnimationFrame(reveal);else reveal();
   });
  }
 };
 async function ask(state,question){
  state.chatScroll=null;state.draft='';state.followPage=true;state.revealPage=true;state.pageScroll=cloud.document.defaultView?.scrollY;
  await state.job.start('/api/v1/ai/project-questions',{project_id:state.project,question,output_language:uiLanguage(),...(floatingOpen()&&state.focus?{focus_request_id:state.focus.id}:{})});
 }
 const submit=event=>{
  if(!event.target.matches('[data-project-question]')||!cloud.active||(cloud.tab!=='asistente'&&!floatingOpen()))return;
  event.preventDefault();const state=stateForProject();state.sourceOpen=false;
  const question=new FormData(event.target).get('question').trim();if(question)ask(state,question);
 };
 const input=event=>{if(event.target.matches('#project-assistant-question')&&context&&current(context))context.draft=event.target.value;};
 const click=event=>{
  const button=event.target.closest('[data-assistant-action]');if(!button||!context||!visible(context))return;
  const state=context,action=button.dataset.assistantAction;
  if(action==='open-sources'){state.sourceOpen=!state.sourceOpen;if(state.sourceOpen)loadSources(state);paint(state);if(state.sourceOpen){
   const close=cloud.document.querySelector('[data-assistant-action=close-sources]');
   close?.focus();
  }}
  if(action==='close-sources'&&documentsPanel?.element.open){documentsPanel.close();return;}
  if(action==='close-sources'){state.sourceOpen=false;paint(state);cloud.document.querySelector('[data-assistant-action=open-sources]')?.focus();}
  if(action==='refresh-sources')loadSources(state);
  if(action==='read')readDocument(state,button.dataset.documentId);
  if(action==='process')prepare(state,button.dataset.documentId);
  if(action==='reload-history')restore(state);
  if(action==='older')restore(state,state.nextBefore);
  if(action==='plan'){cloud.tab='plan';cloud.notify();}
  if(action==='status'){cloud.tab='historial';cloud.notify();}
  if(action==='source'){state.followPage=false;state.revealPage=false;cloud.run(()=>cloud.previewDocument(button.dataset.documentId));}
  if(action==='use-ready'&&!state.sourceLoading&&!state.sourceError&&!state.job.state.uncertain&&!['queued','running'].includes(state.job.state.status)){
   const {ready}=documentSelection(state.sourceFiles);if(!ready.length||ready.length>100)return;
   state.selectedDocuments=structuredClone(ready);state.sourceOpen=false;paint(state);
  }
  if(action==='all-documents'&&!state.job.state.uncertain&&!['queued','running'].includes(state.job.state.status)){state.selectedDocuments=null;paint(state);}
  if(action==='retry'&&state.job.state.payload){
   state.chatScroll=null;state.followPage=true;state.revealPage=true;state.pageScroll=cloud.document.defaultView?.scrollY;
   const previous=state.job.state.payload,chosen=state.selectedDocuments?.map(file=>file.id);
   if(!state.job.state.uncertain&&state.job.state.status==='failed'&&JSON.stringify(previous.document_ids)!==JSON.stringify(chosen))ask(state,previous.question);
   else state.job.start(state.job.state.path,previous);
  }
 };
 const original=cloud.syncChrome.bind(cloud);
 cloud.syncChrome=function(){original();updateFab();if(context&&(!cloud.active||cloud.navigationOwner!==context.owner||cloud.projectId!==context.project)){floatingPanel?.close();documentsPanel?.close();context.job.dispose();context.processingJob?.dispose();context=null;}};
 const scroll=event=>{
  if(!context||!visible(context))return;
  if(event.target.matches?.('.project-assistant-log'))context.chatScroll=chatScrollPosition(event.target);
  if(event.target===cloud.document){
   const top=cloud.document.defaultView?.scrollY;
   if(Number.isFinite(top)&&Number.isFinite(context.pageScroll)&&top<context.pageScroll-2)context.followPage=false;
   context.pageScroll=top;
  }
 };
 cloud.document.addEventListener('scroll',scroll,true);
 const toggle=event=>{
  const details=event.target;
  if(!context||!visible(context)||!details.matches?.('[data-project-answer-sources]'))return;
  const state=context;
  // Reading an earlier answer must not resume following the newest reply.
  state.followPage=false;state.revealPage=false;
  queueMicrotask(()=>{
   if(!visible(state)||details.isConnected===false)return;
   if(details.open)details.querySelector?.('summary')?.scrollIntoView?.({block:'nearest',behavior:'instant'});
   const chat=details.closest('.project-assistant-log');
   if(chat)state.chatScroll={...chatScrollPosition(chat),follow:false};
   state.pageScroll=cloud.document.defaultView?.scrollY;
  });
 };
 cloud.document.addEventListener('toggle',toggle,true);
 const keydown=event=>{if(context&&visible(context))submitChatOnEnter(event,'#project-assistant-question');if(event.key==='Escape'&&context?.sourceOpen&&!documentsPanel?.element.open){context.sourceOpen=false;paint(context);cloud.document.querySelector('[data-assistant-action=open-sources]')?.focus();}};
 cloud.document.addEventListener('keydown',keydown);
 cloud.document.addEventListener('submit',submit);cloud.document.addEventListener('input',input);cloud.document.addEventListener('click',click);
 return ()=>{floatingPanel?.dispose();fab?.remove();documentsPanel?.dispose();cloud.document.removeEventListener('toggle',toggle,true);cloud.document.removeEventListener('scroll',scroll,true);clearTimeout(sourceTimer);cloud.document.removeEventListener('keydown',keydown);context?.job.dispose();context?.processingJob?.dispose();cloud.document.removeEventListener('submit',submit);cloud.document.removeEventListener('input',input);cloud.document.removeEventListener('click',click);};
}
