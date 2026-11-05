import {createAgentPanel,agentShell,agentMascot} from './agent-panel.mjs';
import {renderAIActivity,submitChatOnEnter} from './ai-activity.mjs';
import {uiText,uiLanguage} from './i18n.mjs';
import {icon} from './icons.mjs';
import {validateProjectAnswer,documentSelection,documentScopeMarkup,answerScopeMarkup} from './project-assistant.mjs';
const t=(key,values)=>uiText(`caseAssistant.${key}`,values);
const scopeText=(key,values)=>uiText(`projectAssistant.${key}`,values);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function validateCaseAnswer(value,context,sessionId){
 validateProjectAnswer(value,context.project);
 const bound=value.case_context;
 if(!bound||bound.session_id!==sessionId||bound.project_id!==context.project||bound.case_kind!==context.kind||bound.case_id!==context.id||bound.revision_id!==context.revision)throw Error('AI_CONTEXT_INVALID');
 return value;
}
export function validateCaseSession(value,context){
 if(!value||typeof value.id!=='string'||value.project_id!==context.project||value.case_kind!==context.kind||value.case_id!==context.id||value.revision_id!==context.revision||!Array.isArray(value.messages)||typeof value.stale!=='boolean')throw Error('AI_CONTEXT_INVALID');
 for(const message of value.messages){
  if(typeof message.job_id!=='string'||typeof message.question!=='string'||!['queued','running','completed','failed'].includes(message.status))throw Error('AI_JOB_INVALID');
  if(message.status==='completed')validateCaseAnswer(message.result,context,value.id);
 }
 return value;
}
export function installCaseAssistant(cloud){
 if(cloud.renderCaseAssistant)return;
 let state=null;
 const agent=createAgentPanel({cloud,id:'case-agent-title',onClose(){if(state){state.open=false;cloud.document.querySelector(`[data-case-assistant="${state.key}"] [data-case-action="toggle"]`)?.setAttribute('aria-expanded','false');}},trigger:()=>state&&cloud.document.querySelector(`[data-case-assistant="${state.key}"] [data-case-action="toggle"]`)});
 const drawer=agent.element;
 function closeDrawer(){agent.close();}

 const identity=ctx=>[cloud.navigationOwner,ctx.project,ctx.kind,ctx.id,ctx.revision??''].join(':');
 const valid=s=>state===s&&cloud.active&&s.owner===cloud.navigationOwner&&s.context.project===cloud.projectId;
 const mounted=s=>valid(s)&&!!cloud.document.querySelector(`[data-case-assistant="${s.key}"]`);
 function notify(s){if(mounted(s)){renderDrawer(s);const trigger=cloud.document.querySelector(`[data-case-assistant="${s.key}"] [data-case-action="toggle"]`);if(trigger)trigger.setAttribute('aria-expanded',String(s.open));}}
 function clear(){closeDrawer();if(state)clearTimeout(state.timer);state=null;}
 const sourceErrors=['VECTOR_NO_SOURCES','VECTOR_SOURCE_NOT_READY','VECTOR_INDEX_INCOMPLETE','VECTOR_SUMMARY_INDEX_INCOMPLETE','FILE_SUMMARY_NOT_READY'];
 function errorText(error){return t(sourceErrors.includes(error)?'sourcesPending':['AI_CASE_STALE','AI_CONTEXT_CHANGED','AI_CONTEXT_INVALID'].includes(error)?'stale':'error');}
 async function loadDocuments(s){
  if(s.documentsLoading)return;s.documentsLoading=true;s.documentsError='';notify(s);
  try{
   const files=[];let offset=0;
   do{
    const result=await cloud.request(`/api/v1/projects/${s.context.project}/sources?offset=${offset}&limit=100`);
    if(!valid(s))return;
    if(!Array.isArray(result.files)||!Number.isInteger(result.total))throw Error('AI_JOB_INVALID');
    files.push(...result.files);offset=result.next_offset;
    if(files.length>1000||offset!==null&&(!Number.isInteger(offset)||offset<files.length))throw Error('AI_JOB_INVALID');
   }while(offset!==null);
   documentSelection(files);s.sourceFiles=files;
  }catch(error){if(valid(s))s.documentsError=error.code||error.message;}
  finally{if(valid(s)){s.documentsLoading=false;notify(s);}}
 }
 async function restore(s){
  s.loading=true;s.error='';notify(s);
  try{
   const value=await cloud.request('/api/v1/ai/case-sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({case_kind:s.context.kind,case_id:s.context.id,output_language:uiLanguage()})});
   if(!valid(s))return;
   s.session=validateCaseSession(value,s.context);
   const pending=value.messages.find(m=>['queued','running'].includes(m.status));
   s.pending=pending?{id:pending.job_id,question:pending.question,output_language:pending.output_language,uncertain:false}:null;
   if(s.pending)s.timer=setTimeout(()=>poll(s),500);
  }catch(error){if(valid(s))s.error=error.code||error.message;}
  finally{if(valid(s)){s.loading=false;notify(s);}}
 }
 async function poll(s){
  if(!valid(s)||!s.pending||s.polling)return;
  s.polling=true;
  try{
   const job=await cloud.request(`/api/v1/ai/case-sessions/${s.session.id}/messages/${s.pending.id}`);
   if(!valid(s))return;
   if(job.id!==s.pending.id||!['queued','running','completed','failed'].includes(job.status))throw Error('AI_JOB_INVALID');
   s.pending.uncertain=false;
   if(job.status==='completed'){
    const result=validateCaseAnswer(job.result,s.context,s.session.id);
    s.session.messages=s.session.messages.filter(m=>m.job_id!==job.id);
    s.session.messages.push({job_id:job.id,status:'completed',question:s.pending.question,result});s.pending=null;s.draft='';
   }else if(job.status==='failed'){s.error=job.error_code||'AI_REQUEST_FAILED';s.pending=null;}
   else s.timer=setTimeout(()=>poll(s),1500);
  }catch(error){if(valid(s)){s.error=error.code||error.message;clearTimeout(s.timer);}}
  finally{if(valid(s)){s.polling=false;notify(s);}}
 }
 async function send(s){
  if(s.sending||s.loading||s.session?.stale||!s.session)return;
  const question=s.draft.trim();if(!question)return;
  s.error='';s.sending=true;
  if(!s.pending)s.pending={id:crypto.randomUUID(),question,output_language:uiLanguage(),uncertain:true,...(s.selectedDocuments?{document_ids:s.selectedDocuments.map(file=>file.id)}:{})};
  notify(s);
  try{
   const job=await cloud.request(`/api/v1/ai/case-sessions/${s.session.id}/messages`,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':s.pending.id},body:JSON.stringify({question:s.pending.question,output_language:s.pending.output_language,...(s.pending.document_ids?{document_ids:s.pending.document_ids}:{})})});
   if(!valid(s))return;
   if(job.id!==s.pending.id)throw Error('AI_JOB_INVALID');
   s.pending.uncertain=false;await poll(s);
  }catch(error){if(valid(s))s.error=error.code||error.message;}
  finally{if(valid(s)){s.sending=false;notify(s);}}
 }
 function sources(result){return result.citations.map(citation=>{
  const source=result.sources.find(item=>item.source_id===citation.source_id);
  const locator=source.locator;
  return `<article class="project-assistant-source"><span>${t(source.source_kind==='original'?'original':'summary')}</span><button type="button" class="text-button" data-case-action="source" data-document-id="${esc(source.file_id)}">${icon('file-text')}${esc(source.title||t('document'))}</button><blockquote>${esc(citation.quote)}</blockquote>${locator?`<small>${t(locator.kind==='page'?'page':'section')} ${esc(locator.page??locator.paragraph??locator.section??'')}</small>`:''}</article>`;
 }).join('');}
 const avatar=agentMascot;
 function documentPicker(s){
  return `<section class="case-agent-documents"><header><h4>${scopeText('projectDocuments')}</h4><button type="button" class="text-button" data-case-action="close-documents">${scopeText('closeDocuments')}</button></header>${s.documentsLoading?`<p role="status">${scopeText('loadingSources')}</p>`:s.documentsError?`<p role="alert" class="cloud-error">${scopeText('documentsInventoryFailure')}</p><button type="button" class="text-button" data-case-action="choose-documents">${t('retry')}</button>`:documentScopeMarkup(s.sourceFiles,s.selectedDocuments,'data-case-action',!!s.pending)||`<p>${scopeText('scopeAvailable',{ready:s.sourceFiles.length,pending:0})}</p>`}</section>`;
 }

 function renderDrawer(s){
  if(!s.open)return;
  const disabled=!s.session||s.loading||s.pending||s.session.stale||s.documentsOpen;
  const exchanges=s.session?.messages.map(message=>`<article class="case-agent-exchange"><div class="case-agent-message is-user"><div class="case-agent-bubble"><span>${t('you')}</span><p>${esc(message.question)}</p></div></div>${message.status==='completed'?`<div class="case-agent-message">${avatar()}<div class="case-agent-bubble"><span>${t('answer')}</span>${answerScopeMarkup(message.result)}<p>${esc(message.result.answer)}</p>${message.result.missing_information.length?`<ul>${message.result.missing_information.map(v=>`<li>${esc(v)}</li>`).join('')}</ul>`:''}${message.result.citations.length?`<details data-case-sources="${esc(message.job_id)}" ><summary>${t('sources')}</summary>${sources(message.result)}</details>`:''}</div></div>`:message.status==='failed'?`<p role="alert" class="cloud-error">${t('error')}</p>`:''}</article>`).join('')||'';
  agent.render(agentShell({id:'case-agent-title',title:t(s.context.kind==='refund'?'refund':'change'),label:t('conversation'),closeLabel:t('close'),closeAttribute:'data-case-action="close"',headerActions:`<button type="button" class="agent-header-tool" data-case-action="choose-documents">${icon('file-text')}<span>${scopeText('projectDocuments')}</span></button>`,chatAttributes:'data-case-chat',content:`${s.documentsOpen?documentPicker(s):''}${s.selectedDocuments&&!s.documentsOpen?documentScopeMarkup(s.sourceFiles,s.selectedDocuments,'data-case-action',!!s.pending):''}${s.loading?`<p role="status">${t('loading')}</p>`:''}${!s.loading&&!exchanges?`<div class="case-agent-empty">${avatar()}<h3>${t('welcome')}</h3><p>${t(s.context.kind==='refund'?'refundHint':'changeHint')}</p></div>`:exchanges}${s.pending&&!s.error?renderAIActivity({label:t('thinking'),compact:true}):''}${s.session?.stale?`<p role="alert" class="cloud-error">${t('stale')}</p>`:''}${s.error?`<div class="case-agent-error"><p role="alert" class="cloud-error">${errorText(s.error)}</p>${sourceErrors.includes(s.error)?`<button type="button" class="text-button" data-case-action="choose-documents">${scopeText('scopeChoose')}</button><button type="button" class="text-button" data-case-action="prepare">${t('prepare')}</button>`:''}<button class="text-button" type="button" data-case-action="retry">${t('retry')}</button></div>`:''}`,composer:`<form class="case-agent-composer" data-case-question><label class="sr-only" for="case-agent-question">${t('question')}</label><textarea id="case-agent-question" name="question" rows="2" maxlength="4000" required placeholder="${t('placeholder')}" ${disabled?'disabled':''}>${esc(s.draft)}</textarea><div><small>${t('keyboard')}</small><button type="submit" class="button" ${disabled?'disabled':''}>${t('ask')}${icon('send')}</button></div></form>`}));
 }

 cloud.renderCaseAssistant=function(context){
  if(context.kind==='refund'){
   clear();
   return `<div class="case-assistant-entry" data-case-agent-coming-soon><button type="button" class="button secondary case-agent-trigger" disabled title="${t('refundComingSoonHint')}">${avatar()}<span>${t('refund')}</span></button><span class="badge review">${t('comingSoon')}</span></div>`;
  }
  const key=identity(context);
  if(!state||state.key!==key){clear();state={key,context,owner:cloud.navigationOwner,open:false,session:null,loading:false,error:'',draft:'',pending:null,selectedDocuments:null,sourceFiles:[],documentsOpen:false,documentsLoading:false,documentsError:''};}
  if(state.open)renderDrawer(state);
  return `<div class="case-assistant-entry" data-case-assistant="${esc(key)}"><button type="button" class="button secondary case-agent-trigger" data-case-action="toggle" title="${t('changeDiscoveryHint')}" aria-haspopup="dialog" aria-expanded="${state.open}">${avatar()}<span>${t('change')}</span>${icon('arrow-up-right')}</button><small>${t('changeDiscoveryHint')}</small></div>`;
 };
 const click=event=>{
  const button=event.target.closest('[data-case-action]');if(!button||!state||!button.closest('[data-case-assistant],.case-assistant-drawer')||!mounted(state))return;
  const s=state;
  if(button.dataset.caseAction==='toggle'){
   s.open=true;renderDrawer(s);agent.open(button);
   if(!s.session&&!s.loading)restore(s);notify(s);
  }
  if(button.dataset.caseAction==='close')closeDrawer();
  if(button.dataset.caseAction==='choose-documents'){s.documentsOpen=true;loadDocuments(s);notify(s);}
  if(button.dataset.caseAction==='close-documents'){s.documentsOpen=false;notify(s);}
  if(button.dataset.caseAction==='use-ready'&&!s.pending&&!s.documentsLoading&&!s.documentsError){
   const {ready}=documentSelection(s.sourceFiles);if(!ready.length||ready.length>100)return;
   s.selectedDocuments=structuredClone(ready);s.documentsOpen=false;notify(s);
  }
  if(button.dataset.caseAction==='all-documents'&&!s.pending){s.selectedDocuments=null;notify(s);}

  if(button.dataset.caseAction==='prepare'){
   closeDrawer();
   clearTimeout(s.timer);
   if(cloud.refundState?.wizardOpen){cloud.refundState.wizardOpen=false;cloud.document.querySelector('.refund-dialog')?.close();}
   cloud.tab='asistente';cloud.message='';cloud.notify();
  }
  if(button.dataset.caseAction==='source')cloud.run(()=>cloud.previewDocument(button.dataset.documentId));
  if(button.dataset.caseAction==='retry'){s.error='';if(s.pending){if(s.pending.uncertain)send(s);else poll(s);}else if(s.draft.trim())send(s);else restore(s);}
 };
 const input=event=>{if(event.target.matches('[data-case-question] textarea')&&state&&mounted(state))state.draft=event.target.value;};
 const submit=event=>{if(event.target.matches('[data-case-question]')&&state&&mounted(state)){event.preventDefault();send(state);}};
 const keydown=event=>submitChatOnEnter(event,'[data-case-question] textarea');
 cloud.document.addEventListener('keydown',keydown);
 cloud.document.addEventListener('click',click);cloud.document.addEventListener('input',input);cloud.document.addEventListener('submit',submit);
 const reset=cloud.reset.bind(cloud);cloud.reset=function(){clear();return reset();};
 const sync=cloud.syncChrome?.bind(cloud);if(sync)cloud.syncChrome=function(){sync();if(state&&(!valid(state)||!mounted(state)))clear();};
 return ()=>{clear();agent.dispose();cloud.document.removeEventListener('keydown',keydown);cloud.document.removeEventListener('click',click);cloud.document.removeEventListener('input',input);cloud.document.removeEventListener('submit',submit);};
}
