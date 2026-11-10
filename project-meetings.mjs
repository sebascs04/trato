// Meetings tab of a project, freelancer side. Trato's pattern: the tab is only the list and one main action; scheduling
// and the invitation open in Trato's floating dialog, and TeTrato's meeting assistant in the right-hand drawer, so the
// page never grows. «Join» opens Meet in its own window; the assistant listens to it or the microphone, never by itself.
import {uiText,uiLocale,uiLanguage} from './i18n.mjs';
import {icon} from './icons.mjs';
const t=(key,values)=>uiText(['meetings',key].join('.'),values);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const MEET_URL=/^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/;
export function meetingWhen(meeting){
 const d=new Date(meeting.starts_at);if(!Number.isFinite(d.getTime()))return '';
 return new Intl.DateTimeFormat(uiLocale(),{dateStyle:'medium',timeStyle:'short',timeZone:meeting.time_zone||undefined}).format(d)+` (${meeting.time_zone})`;
}
// datetime-local gives a wall-clock time in the freelancer's zone; the API needs it with its offset.
export function localToIso(value){const d=new Date(value);return Number.isFinite(d.getTime())?d.toISOString():'';}
export function renderMeetingRow(m){
 const mail=m.mail_status==='sent'?`<span class="badge ok">${t('invited')}</span>`:m.mail_status==='uncertain'?`<span class="badge review">${t('mailUncertain')}</span>`:m.mail_status==='sending'?`<span class="badge">${t('sending')}</span>`:'';
 const invite=['none','failed'].includes(m.mail_status)?`<button type="button" class="button secondary" data-meeting-invite="${esc(m.id)}" aria-haspopup="dialog">${icon('mail')}${t('invite')}</button>`:'';
 return `<li class="project-meeting" data-meeting="${esc(m.id)}"><div><strong>${esc(m.title)}</strong><small>${esc(meetingWhen(m))}</small>${mail}</div><div class="project-meeting-actions">${invite}<button type="button" class="button" data-meeting-join="${esc(m.id)}">${icon('arrow-up-right')}${t('join')}</button><button type="button" class="text-button" data-meeting-cancel="${esc(m.id)}" aria-label="${esc(t('cancelFor',{title:m.title}))}" title="${esc(t('cancel'))}">${icon('trash-2')}</button></div></li>`;
}
// A past meeting in the tray: its title, when it ended and how much TeTrato kept. Opens in Trato's floating dialog.
export function renderRecordRow(r){
 const d=new Date(r.created_at),when=Number.isFinite(d.getTime())?new Intl.DateTimeFormat(uiLocale(),{dateStyle:'medium',timeStyle:'short'}).format(d):'';
 const points=['decisions','actionItems','risks','nextSteps'].reduce((n,k)=>n+(r.summary?.[k]?.length||0),0);
 return `<li class="project-meeting is-record"><div><strong>${esc(r.title)}</strong><small>${esc(when)} · ${esc(t('recordCounts',{lines:(r.transcript||[]).length,points}))}</small></div><div class="project-meeting-actions"><button type="button" class="button secondary" data-meeting-record="${esc(r.id)}" aria-haspopup="dialog">${icon('eye')}${t('recordOpen')}</button></div></li>`;
}
export function recordConversationHtml(record){
 const who=s=>s==='you'?uiText('meetingAssistant.you'):s==='client'?uiText('meetingAssistant.client'):uiText('meetingAssistant.call');
 return `<details class="project-meeting-record-talk"><summary>${icon('messages-square')}${t('recordConversation',{count:(record.transcript||[]).length})}</summary><ol class="ma-transcript">${(record.transcript||[]).map(l=>`<li class="is-${l.speaker==='you'?'mine':'theirs'}"><small>${esc(who(l.speaker))}</small><p>${esc(l.text)}</p></li>`).join('')}</ol></details>`;
}
export function meetingFormHtml(draft,error=''){
 return `<form class="project-meeting-form" data-meeting-form><label class="field" for="meeting-title">${t('title')}</label><input class="context-box" id="meeting-title" name="title" required maxlength="200" value="${esc(draft.title)}" placeholder="${esc(t('titlePlaceholder'))}">
 <label class="field" for="meeting-link">${t('link')}</label><input class="context-box" id="meeting-link" name="meet_url" required inputmode="url" value="${esc(draft.meet_url)}" placeholder="https://meet.google.com/abc-defg-hij"><p class="cloud-notice">${t('formHint')}</p>
 <div class="project-meeting-row"><div><label class="field" for="meeting-date">${t('date')}</label><input class="context-box" id="meeting-date" name="date" type="date" required value="${esc(draft.date)}"></div><div><label class="field" for="meeting-time">${t('time')}</label><input class="context-box" id="meeting-time" name="time" type="time" required value="${esc(draft.time)}"></div></div>
 <p class="cloud-error" role="alert" data-meeting-form-error>${esc(error)}</p><div class="dialog-actions"><button type="button" class="button secondary" data-cloud-close>${uiText('portal.cancel')}</button><button type="submit" class="button">${icon('plus')}${t('schedule')}</button></div></form>`;
}
export function meetingPreviewHtml(preview,error=''){
 return `<div class="project-meeting-preview"><p><strong>${t('to')}</strong> ${esc(preview.recipient)}</p><p><strong>${esc(preview.subject)}</strong></p><pre>${esc(preview.body)}</pre><p class="cloud-error" role="alert" data-meeting-preview-error>${esc(error)}</p><div class="dialog-actions"><button type="button" class="button secondary" data-cloud-close>${t('notNow')}</button><button type="button" class="button" data-meeting-send="${esc(preview.id)}">${icon('send')}${t('send')}</button></div></div>`;
}
export function installProjectMeetings(cloud){
 const states=new Map(),doc=cloud.document;
 const key=()=>`${cloud.navigationOwner}:${cloud.projectId}`;
 // draft: what the freelancer typed, kept if the dialog is closed and opened again.
 const state=()=>{if(!states.has(key()))states.set(key(),{meetings:null,records:null,error:'',preview:null,draft:{title:'',meet_url:'',date:'',time:''}});return states.get(key());};
 const path=project=>`/api/v1/projects/${encodeURIComponent(project)}/meetings`;
 const recordsPath=project=>`/api/v1/projects/${encodeURIComponent(project)}/meeting-records`;
 async function load(s,project){
  try{const value=await cloud.request(path(project));s.meetings=Array.isArray(value)?value:[];s.error='';}
  catch(failure){s.meetings=s.meetings||[];s.error=failure.message||t('error');}
  if(cloud.projectId===project)cloud.notify();
 }
 // Past meetings: what TeTrato kept from each live meeting of this project, newest first.
 async function loadRecords(s,project){
  try{const value=await cloud.request(recordsPath(project));s.records=Array.isArray(value)?value:[];}
  catch{s.records=s.records||[];}
  if(cloud.projectId===project)cloud.notify();
 }
 // TeTrato's meeting assistant lives in the right-hand drawer, outside the tab: repaints never touch it.
 let drawer=null,drawerProject=null,assistant=null;
 function openAssistant(project,meeting='',meetingId=null){
  if(drawer&&drawerProject!==project){drawer.remove();drawer=null;assistant=null;}
  if(drawer&&meeting)assistant?.setMeeting(meeting,meetingId);
  if(!drawer){
   drawer=doc.createElement('dialog');drawer.className='case-assistant-drawer meeting-assistant-drawer';drawer.setAttribute('aria-labelledby','meeting-assistant-title');
   drawer.innerHTML=`<div class="case-agent-shell"><header class="case-agent-header"><div class="case-agent-heading"><img class="case-agent-mascot" src="/assets/mascot/trato-guide.png" alt="" width="44" height="44"><div><span>TeTrato</span><h2 id="meeting-assistant-title">${t('assistantTitle')}</h2></div></div><button type="button" class="case-agent-close" data-meeting-assistant-close aria-label="${esc(t('assistantClose'))}" title="${esc(t('assistantClose'))}">${icon('x')}</button></header><div class="meeting-assistant-body" data-meeting-assistant-host></div></div>`;
   doc.body.append(drawer);drawerProject=project;
   drawer.querySelector('[data-meeting-assistant-close]').addEventListener('click',()=>drawer.close());
   const host=drawer.querySelector('[data-meeting-assistant-host]');
   // What TeTrato already knows: this project, its client and its documents. Nothing to fill in.
   const item=cloud.projects?.find(p=>p.id===project)||cloud.project?.()||{};
   const context={projectId:project,clientId:item.client_id||cloud.clientId,project:item.name||'',client:cloud.clients?.find(c=>c.id===(item.client_id||cloud.clientId))?.name||'',
    documents:()=>(cloud.projectId===project?cloud.documents||[]:[]).map(d=>({id:d.id,title:d.title,kind:d.kind})),
    // A finished live meeting goes straight into this project's Past meetings.
    saveRecord:async data=>{
     const row=await cloud.request(recordsPath(project),cloud.json(data)),owned=states.get(`${cloud.navigationOwner}:${project}`);
     if(owned&&Array.isArray(owned.records))owned.records=[row,...owned.records];
     // The tab shows where it went: Past meetings, with the new one on top.
     if(owned)owned.view='past';
     if(cloud.projectId===project)cloud.notify();
     return row;
    },
    prepareAddendum:(recordId,title)=>prepareAddendum(project,recordId,title)};
   void import('./meeting-assistant.mjs').then(({mountMeetingAssistant})=>{assistant=mountMeetingAssistant(host,{context,meeting,meetingId});});
  }
  if(!drawer.open)drawer.showModal();
 }
 cloud.renderMeetings=function(panel){
  const project=cloud.projectId,s=state();
  if(s.meetings===null){s.meetings=undefined;void load(s,project);}
  if(s.records===null){s.records=undefined;void loadRecords(s,project);}
  // Two views of one tab, like Disputes: upcoming meetings, and the past ones TeTrato kept. One is shown at a time.
  const view=s.view==='past'?'past':'upcoming';
  const choice=(value,label,count)=>`<button type="button" data-meeting-view="${value}" aria-pressed="${view===value}">${label}${count?`<span class="dispute-switch-count">${count}</span>`:''}</button>`;
  const switcher=`<div class="dispute-switch" role="group" aria-label="${esc(t('dialogTitle'))}">${choice('upcoming',t('upcoming'),s.meetings?.length||0)}${choice('past',t('pastTitle'),s.records?.length||0)}</div>`;
  const past=s.records===undefined?`<p class="dispute-muted" role="status">${t('loading')}</p>`
   :s.records.length?`<ul class="project-meetings">${s.records.map(renderRecordRow).join('')}</ul>`
   :`<div class="empty-state project-meetings-empty">${icon('history')}<strong>${t('pastEmpty')}</strong><span>${t('pastEmptyHint')}</span></div>`;
  const body=s.meetings===undefined?`<p class="dispute-muted" role="status">${t('loading')}</p>`
   :s.error?`<p class="cloud-error" role="alert">${esc(s.error)}</p>`
   :s.meetings.length?`<ul class="project-meetings">${s.meetings.map(renderMeetingRow).join('')}</ul>`
   :`<div class="empty-state project-meetings-empty">${icon('calendar')}<strong>${t('empty')}</strong><span>${t('emptyHint')}</span></div>`;
  panel.innerHTML=`<section class="dispute-workspace project-meetings-tab"><header class="dispute-head"><div><h2>${t('dialogTitle')}</h2><p>${t('intro')}</p></div><div class="project-meetings-head-actions"><button type="button" class="button secondary" data-meeting-copilot aria-haspopup="dialog">${icon('users')}${t('openCopilot')}</button><button type="button" class="button" data-meeting-new aria-haspopup="dialog">${icon('plus')}${t('schedule')}</button></div></header>${switcher}<section class="workspace-panel">${view==='past'?past:body}</section></section>`;
 };
 // Prepare addendum: the meeting becomes the project's client request through the usual «Register client request»
 // form, with the meeting as its PDF. Once Trato has read it, the freelancer lands on Prepare change for it.
 // Nothing is sent: the freelancer still sets scope, price and date, and sends the addendum as always.
 async function prepareAddendum(project,recordId,title){
  // One open request per project: the meeting then waits as a draft in Past meetings, ready for when that one is closed.
  if(cloud.requestStatus?.can_register===false)return {draft:true,text:t('addendumDraft')};
  if(cloud.requestStatus?.can_register!==true)
   return uiText("Estamos comprobando los pedidos del proyecto. Vuelve a intentar en unos momentos.");
  let blob;
  try{blob=await cloud.request(`${recordsPath(project)}/${encodeURIComponent(recordId)}/request-pdf`,{},true);}
  catch{return t('addendumError');}
  drawer?.close();
  const review=async documentId=>{
   for(let i=0;i<40;i+=1){
    const doc=(cloud.documents||[]).find(d=>d.id===documentId);
    if(doc&&cloud.sourceReady(doc)){await cloud.run(()=>cloud.reviewChange(documentId));return;}
    await new Promise(resolve=>setTimeout(resolve,3000));
   }
  };
  const follow=async documentId=>{void review(documentId);};
  cloud.afterRequestSaved=follow;
  cloud.openSource('request');
  const modal=cloud.modal,form=modal?.querySelector('[data-cloud-form="upload"]');
  if(!modal?.open||!form){if(cloud.afterRequestSaved===follow)cloud.afterRequestSaved=null;return t('addendumError');}
  modal.addEventListener('close',()=>{if(cloud.afterRequestSaved===follow)cloud.afterRequestSaved=null;},{once:true});
  form.querySelector('input[name="title"]').value=t('addendumRequestTitle',{title});
  const files=new DataTransfer();files.items.add(new File([blob],`meeting-${recordId.slice(0,8)}.pdf`,{type:'application/pdf'}));
  form.querySelector('input[name="file"]').files=files.files;
  return '';
 }
 async function showRecord(s,id,confirming=false){
  const record=s.records?.find(r=>r.id===id);if(!record)return;
  const {summaryHtml}=await import('./meeting-assistant.mjs');
  const actions=confirming
   ?`<p class="cloud-notice">${t('recordDeleteConfirm')}</p><div class="dialog-actions"><button type="button" class="button secondary" data-meeting-record="${esc(id)}">${t('recordKeep')}</button><button type="button" class="button danger" data-meeting-record-delete="${esc(id)}">${icon('trash-2')}${t('recordDelete')}</button></div>`
   :`<p class="cloud-error" role="alert" data-meeting-addendum-error></p><div class="dialog-actions"><button type="button" class="text-button" data-meeting-record-ask="${esc(id)}">${icon('trash-2')}${t('recordDelete')}</button><button type="button" class="button" data-meeting-record-addendum="${esc(id)}">${icon('file-text')}${t('addendum')}</button></div>`;
  cloud.show(record.title,`<div class="project-meeting-record"><div class="ma-summary">${summaryHtml(record.summary)}</div>${recordConversationHtml(record)}${actions}</div>`);
  cloud.modal.classList.add('ma-summary-dialog');
  cloud.modal.addEventListener('close',()=>cloud.modal.classList.remove('ma-summary-dialog'),{once:true});
 }
 const showForm=(s,error='')=>{cloud.show(t('scheduleTitle'),meetingFormHtml(s.draft,error));cloud.modal.querySelector('[name="title"]')?.focus();};
 const showPreview=(s,error='')=>cloud.show(t('previewTitle'),meetingPreviewHtml(s.preview,error));
 doc.addEventListener('input',event=>{
  const field=event.target;if(!field.closest?.('[data-meeting-form]')||!cloud.projectId)return;
  if(['title','meet_url','date','time'].includes(field.name))state().draft[field.name]=field.value;
 });
 doc.addEventListener('submit',async event=>{
  const form=event.target.closest?.('[data-meeting-form]');if(!form)return;
  event.preventDefault();
  const s=state(),project=cloud.projectId,values=new FormData(form),url=String(values.get('meet_url')||'').trim(),when=values.get('date')&&values.get('time')?localToIso(`${values.get('date')}T${values.get('time')}`):'';
  const fail=message=>{form.querySelector('[data-meeting-form-error]').textContent=message;};
  if(!MEET_URL.test(url))return fail(t('linkInvalid'));
  if(!when||new Date(when)<new Date())return fail(t('whenInvalid'));
  const button=form.querySelector('button[type="submit"]');button.disabled=true;fail('');
  try{
   const created=await cloud.request(path(project),{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({title:String(values.get('title')||'').trim(),meet_url:url,starts_at:when,time_zone:Intl.DateTimeFormat().resolvedOptions().timeZone,output_language:uiLanguage()})});
   s.draft={title:'',meet_url:'',date:'',time:''};void load(s,project);
   // Scheduling and inviting go together: the same dialog continues with the invitation to review and send.
   if(created?.id){s.preview={id:created.id,...await cloud.request(`${path(project)}/${encodeURIComponent(created.id)}/email-preview`)};showPreview(s);}
   else cloud.modal.close();
  }catch(failure){
   if(s.preview===null&&form.isConnected){fail(failure.code==='CLIENT_EMAIL_REQUIRED'?t('clientEmailRequired'):failure.message||t('error'));button.disabled=false;}
   else cloud.modal.close();
  }
 });
 doc.addEventListener('click',async event=>{
  const target=event.target.closest?.('[data-meeting-new],[data-meeting-join],[data-meeting-invite],[data-meeting-cancel],[data-meeting-send],[data-meeting-copilot],[data-meeting-record],[data-meeting-record-ask],[data-meeting-record-delete],[data-meeting-view],[data-meeting-record-addendum]');if(!target||!cloud.projectId)return;
  if(target.matches('[data-meeting-view]')){state().view=target.dataset.meetingView==='past'?'past':'upcoming';cloud.notify();return;}
  if(target.matches('[data-meeting-record]')){void showRecord(state(),target.dataset.meetingRecord);return;}
  if(target.matches('[data-meeting-record-addendum]')){
   const s=state(),record=s.records?.find(r=>r.id===target.dataset.meetingRecordAddendum);if(!record)return;
   target.disabled=true;
   const problem=await prepareAddendum(cloud.projectId,record.id,record.title);
   if(problem){const error=cloud.modal.querySelector('[data-meeting-addendum-error]');if(error){error.textContent=problem.text||problem;error.classList.toggle('is-draft',!!problem.draft);}target.disabled=false;}
   return;
  }
  if(target.matches('[data-meeting-record-ask]')){void showRecord(state(),target.dataset.meetingRecordAsk,true);return;}
  if(target.matches('[data-meeting-record-delete]')){
   const s=state(),project=cloud.projectId,id=target.dataset.meetingRecordDelete;target.disabled=true;
   try{await cloud.request(`${recordsPath(project)}/${encodeURIComponent(id)}/delete`,{method:'POST'});s.records=(s.records||[]).filter(r=>r.id!==id);cloud.modal.close();cloud.notify();}
   catch{target.disabled=false;}
   return;
  }
  const s=state(),project=cloud.projectId;
  if(target.matches('[data-meeting-new]')){s.preview=null;showForm(s);return;}
  if(target.matches('[data-meeting-copilot]')){openAssistant(project);return;}
  if(target.matches('[data-meeting-join]')){
   // Meet opens in its own window; the assistant opens beside it, ready to listen to that window.
   const meeting=s.meetings?.find(m=>m.id===target.dataset.meetingJoin);if(!meeting)return;
   doc.defaultView.open(meeting.meet_url,'_blank','noopener');openAssistant(project,meeting.title,meeting.id);return;
  }
  target.disabled=true;
  try{
   if(target.matches('[data-meeting-invite]')){const id=target.dataset.meetingInvite;s.preview={id,...await cloud.request(`${path(project)}/${encodeURIComponent(id)}/email-preview`)};target.disabled=false;showPreview(s);return;}
   if(target.matches('[data-meeting-send]')){await cloud.request(`${path(project)}/${encodeURIComponent(target.dataset.meetingSend)}/send`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({digest:s.preview.digest})});s.preview=null;cloud.modal.close();await load(s,project);return;}
   if(target.matches('[data-meeting-cancel]')){await cloud.request(`${path(project)}/${encodeURIComponent(target.dataset.meetingCancel)}/cancel`,{method:'POST'});await load(s,project);return;}
  }catch(failure){
   const message=failure.code==='GMAIL_NOT_CONNECTED'?t('mailNotConnected'):failure.message||t('error');target.disabled=false;
   if(target.matches('[data-meeting-send]'))showPreview(s,message);else{s.error=message;cloud.notify();}
  }
 });
}
