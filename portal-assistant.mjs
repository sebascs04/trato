// TeTrato for the client, in the addendum view. It answers and drafts; accepting, paying and sending stay on the portal's own buttons.
// The conversation lives only in this page. The caller provides `api(action, body)`, so it works with the link and with a client account.
import {uiText,uiLanguage} from './i18n.mjs';
import {icon} from './icons.mjs';
import {renderAIActivity,submitChatOnEnter} from './ai-activity.mjs';

const t=(key,values)=>uiText(`portal.assistant.${key}`,values);
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const POLL_MS=1500,MAX_POLLS=60;

// The API accepts complete question and answer pairs, oldest first.
export function assistantHistory(messages){
 const turns=[];
 for(let index=0;index+1<messages.length;index++){
  if(messages[index].role==='user'&&messages[index+1].role==='assistant')turns.push({role:'user',text:messages[index].text},{role:'assistant',text:messages[index+1].text});
 }
 return turns.slice(-12);
}

// Once a change request goes out, a draft is no longer something to send: it says whether it was the one sent.
export function draftMarkup(message,index){
 if(!message.draft)return '';
 const next=message.sent?`<p class="portal-assistant-draft-sent" role="status">${icon('check')}<span>${t('draftSent')}</span></p>`:message.closed?'':`<button type="button" class="portal-button" data-assistant-draft="${index}">${icon('pencil')}${t('draftAction')}</button>`;
 return `<div class="portal-assistant-draft"><strong>${t(message.sent?'draftSentTitle':'draftTitle')}</strong><p>${escape(message.draft)}</p>${next}</div>`;
}
export function closeDrafts(messages,usedIndex){
 messages.forEach((message,index)=>{if(message.draft&&!message.closed){message.closed=true;message.sent=index===usedIndex;}});
}
export function createPortalAssistant({doc,api,onDraft,wait=ms=>new Promise(done=>doc.defaultView.setTimeout(done,ms)),newId=()=>doc.defaultView.crypto.randomUUID()}){
 const messages=[];let working=false,usedDraft=null;
 const dialog=doc.createElement('dialog');
 dialog.className='portal-dialog portal-side-dialog portal-assistant';
 dialog.setAttribute('aria-labelledby','portal-assistant-title');
 dialog.innerHTML=`<div class="portal-dialog-head"><strong id="portal-assistant-title">${t('title')}</strong><button type="button" class="portal-icon-button" data-assistant-close aria-label="${uiText('portal.close')}" title="${uiText('portal.close')}">${icon('x')}</button></div>
 <div class="portal-assistant-log" data-assistant-log></div>
 <form class="portal-assistant-form" data-assistant-form><textarea class="portal-textarea" data-assistant-question maxlength="1000" rows="2" placeholder="${t('placeholder')}" aria-label="${t('placeholder')}"></textarea><p class="portal-error" data-assistant-error role="alert"></p><button type="submit" class="portal-button" data-assistant-send>${icon('send')}${t('send')}</button></form>`;
 const q=selector=>dialog.querySelector(selector);

 function paint(){
  const log=q('[data-assistant-log]');
  const intro=`<div class="portal-assistant-intro"><img src="/assets/mascot/trato-guide.png" alt="" width="56" height="56"><p>${t('intro')}</p></div>`;
  log.innerHTML=intro+messages.map((message,index)=>message.role==='user'
   ?`<p class="portal-assistant-bubble mine">${escape(message.text)}</p>`
   :`<div class="portal-assistant-bubble"><p>${escape(message.text)}</p>${message.sources?.length?`<small>${t('basedOn')} ${message.sources.map(source=>t(`source.${source}`)).join(', ')}</small>`:''}${draftMarkup(message,index)}</div>`).join('')+(working?renderAIActivity({label:t('thinking'),compact:true}):'');
  for(const button of log.querySelectorAll('[data-assistant-draft]'))button.onclick=()=>{usedDraft=Number(button.dataset.assistantDraft);dialog.close();onDraft(messages[usedDraft].draft);};
  q('[data-assistant-send]').disabled=working;
  log.scrollTop=log.scrollHeight;
 }
 async function answer(jobId,first){
  let job=first;
  for(let poll=0;job.status==='queued'||job.status==='running';poll++){
   if(poll>=MAX_POLLS)throw Object.assign(new Error('PORTAL_ASSISTANT_TIMEOUT'),{code:'PORTAL_ASSISTANT_TIMEOUT'});
   await wait(POLL_MS);
   job=await api('assistant-status',{job_id:jobId});
  }
  if(job.status!=='completed')throw Object.assign(new Error(job.error_code||'AI_FAILED'),{code:job.error_code||'AI_FAILED'});
  return job.result;
 }
 async function submit(event){
  event.preventDefault();
  const input=q('[data-assistant-question]'),question=input.value.trim();
  if(!question||working)return;
  const history=assistantHistory(messages);
  q('[data-assistant-error]').textContent='';
  messages.push({role:'user',text:question});input.value='';working=true;paint();
  try{
   const jobId=newId();
   const result=await answer(jobId,await api('assistant',{job_id:jobId,question,output_language:uiLanguage(),history}));
   messages.push({role:'assistant',text:result.answer,sources:result.sources,draft:result.change_request||''});
  }catch(error){
   // The question goes back to the box and leaves the conversation, so no answer is implied.
   messages.pop();input.value=question;
   q('[data-assistant-error]').textContent=t((error.code||error.message)==='PORTAL_ASSISTANT_LIMIT'?'limit':'error');
  }finally{working=false;paint();}
 }
 q('[data-assistant-form]').addEventListener('submit',submit);
 q('[data-assistant-close]').addEventListener('click',()=>dialog.close());
 dialog.addEventListener('keydown',event=>submitChatOnEnter(event,'[data-assistant-question]'));
 return {element:dialog,changesSent(){closeDrafts(messages,usedDraft);usedDraft=null;},changesDismissed(){usedDraft=null;},open(){q('[data-assistant-error]').textContent='';paint();dialog.showModal();q('[data-assistant-question]').focus();}};
}
