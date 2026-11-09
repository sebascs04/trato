// Disputes tab of a project: PayPal disputes on the project's verified payments, read through the API.
// The freelancer sees reason, amount, the client's message and the deadline next to the payment they belong to.
// TeTrato drafts a response from the project's evidence in a side panel. It reaches PayPal only when the freelancer confirms the send.
import {uiText,uiLocale,uiLanguage} from './i18n.mjs';
import {icon} from './icons.mjs';
import {createAgentPanel,agentShell} from './agent-panel.mjs';
import {AIJobClient} from './ai-jobs.mjs';
import {renderAIActivity} from './ai-activity.mjs';
const t=(key,values)=>uiText(['disputes',key].join('.'),values);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const REASONS=['MERCHANDISE_OR_SERVICE_NOT_RECEIVED','MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED','UNAUTHORISED','CREDIT_NOT_PROCESSED','DUPLICATE_TRANSACTION','INCORRECT_AMOUNT','PAYMENT_BY_OTHER_MEANS','CANCELED_RECURRING_BILLING','PROBLEM_WITH_REMITTANCE'];
const STATUSES=['OPEN','WAITING_FOR_SELLER_RESPONSE','WAITING_FOR_BUYER_RESPONSE','UNDER_REVIEW','RESOLVED'];
const STAGES=['INQUIRY','CHARGEBACK','PRE_ARBITRATION','ARBITRATION'];
const DEFENSE_ACTIONS=['send_message','make_offer','accept_claim','escalate','provide_evidence'];
const OUTCOMES=['RESOLVED_BUYER_FAVOUR','RESOLVED_SELLER_FAVOUR','CANCELED_BY_BUYER','RESOLVED_WITH_PAYOUT','ACCEPTED','DENIED'];
const label=(group,value,known)=>t(`${group}.${known.includes(value)?value:'OTHER'}`);

export function validateDisputes(value,projectId){
 if(!value||value.project_id!==projectId||!Array.isArray(value.disputes)||!Number.isInteger(value.payments_checked))throw Error('DISPUTES_INVALID');
 for(const d of value.disputes)if(!d||typeof d.dispute_id!=='string'||!d.payment||typeof d.payment.capture_id!=='string'||!Array.isArray(d.messages)||!Array.isArray(d.actions))throw Error('DISPUTES_INVALID');
 return value;
}
const date=(value,withTime=false)=>{const d=new Date(value);return Number.isFinite(d.getTime())?new Intl.DateTimeFormat(uiLocale(),withTime?{dateStyle:'medium',timeStyle:'short'}:{dateStyle:'medium'}).format(d):'';};
const money=(value,currency)=>{const n=Number(value);return Number.isFinite(n)&&/^[A-Z]{3}$/.test(currency||'')?new Intl.NumberFormat(uiLocale(),{style:'currency',currency}).format(n):'';};
const daysLeft=value=>{const d=new Date(value);return Number.isFinite(d.getTime())?Math.ceil((d.getTime()-Date.now())/86400000):null;};

function messageMarkup(d,m,index){
 return `<li class="is-${esc(String(m.by).toLowerCase())}"><small>${t(`by.${['BUYER','SELLER','ARBITER'].includes(m.by)?m.by:'OTHER'}`)}${m.at?` · ${esc(date(m.at,true))}`:''}</small><p>${esc(m.text)}</p>${m.documents?.length?`<button type="button" class="text-button dispute-message-docs" data-dispute-docs="${esc(d.dispute_id)}" data-message-index="${index}" aria-haspopup="dialog">${icon('paperclip')}${t('documentsAttached',{count:m.documents.length})}</button>`:''}</li>`;
}
export function renderConversation(d){return `<ol class="dispute-messages">${d.messages.map((m,index)=>messageMarkup(d,m,index)).join('')}</ol>`;}
export function renderDispute(d){
 const left=daysLeft(d.response_due),waiting=d.status==='WAITING_FOR_SELLER_RESPONSE';
 const due=d.response_due?`<p class="dispute-due ${waiting&&left!==null&&left<=5?'is-urgent':''}">${icon('history')}<span>${waiting?t('dueBy',{date:date(d.response_due)}):t('dueWas',{date:date(d.response_due)})}${waiting&&left!==null&&left>=0?` · ${t('daysLeft',{count:left})}`:''}</span></p>`:'';
 const paid=money(d.payment.amount_minor/100,d.payment.currency);
 // The card stays short however long the dispute gets: the conversation opens in a side panel.
 const messages=d.messages.length?`<button type="button" class="text-button dispute-conversation-open" data-dispute-conversation="${esc(d.dispute_id)}" aria-haspopup="dialog">${icon('messages-square')}${t('viewConversation',{count:d.messages.length})}</button>`:`<p class="dispute-muted">${t('noMessages')}</p>`;
 return `<article class="workspace-panel dispute-card" data-dispute="${esc(d.dispute_id)}"><header><span class="dispute-icon" aria-hidden="true">${icon('shield-check')}</span><div><small>${t('case')} ${esc(d.dispute_id)}</small><h3>${esc(label('reason',d.reason,REASONS))}</h3></div><span class="badge review">${esc(label('status',d.status,STATUSES))}</span></header>
 <dl class="dispute-facts"><div><dt>${t('amount')}</dt><dd>${esc(money(d.amount.value,d.amount.currency))}</dd></div><div><dt>${t(d.outcome?'result':'stage')}</dt><dd>${esc(d.outcome?label('outcome',d.outcome,OUTCOMES):label('stage',d.stage,STAGES))}</dd></div><div><dt>${t('payment')}</dt><dd>${esc(t(d.payment.origin==='initial'?'paymentInitial':'paymentChange',{amount:paid}))}${d.payment.verified_at?` · ${esc(date(d.payment.verified_at))}`:''}</dd></div></dl>
 ${closedResult(d)}${due}${messages}
 ${canDefend(d)?needsAnalysis(d)&&d.actions.some(a=>DEFENSE_ACTIONS.includes(a))?`<div class="dispute-next"><p>${t(d.actions.includes('provide_evidence')?'steps.evidenceHint':'defense.hint')}</p><button type="button" class="button" data-dispute-defense="${esc(d.dispute_id)}" aria-haspopup="dialog">${icon('sparkles')}${t('defense.open')}</button></div>`:`<div class="dispute-next"><p>${t(d.status==='UNDER_REVIEW'?(d.stage==='INQUIRY'?'defense.updating':'defense.underReview'):'defense.waitingClient')}</p><button type="button" class="button secondary" data-dispute-defense="${esc(d.dispute_id)}" aria-haspopup="dialog">${t('defense.viewResponse')}</button></div>`:''}</article>`;
}
const SANDBOX_ACTIONS=['require_evidence','adjudicate'];
// During PayPal's review there may be nothing to do, but what was sent stays reachable.
// When a dispute closes, what matters first is who won and what happens to the money.
const WON=['RESOLVED_SELLER_FAVOUR','CANCELED_BY_BUYER','DENIED'],LOST=['RESOLVED_BUYER_FAVOUR','ACCEPTED'];
function closedResult(d){
 if(d.status!=='RESOLVED')return '';
 const outcome=OUTCOMES.includes(d.outcome)?d.outcome:'OTHER',tone=WON.includes(outcome)?'good':LOST.includes(outcome)?'lost':'neutral';
 return `<p class="dispute-result is-${tone}" role="status">${icon(tone==='good'?'check':tone==='lost'?'undo-2':'info')}<span>${t(`resultNote.${outcome}`,{amount:money(d.amount.value,d.amount.currency)})}</span></p>`;
}
const canDefend=d=>d.status!=='RESOLVED'&&d.payment.origin==='change'&&(d.status==='UNDER_REVIEW'||d.actions.some(a=>DEFENSE_ACTIONS.includes(a)||SANDBOX_ACTIONS.includes(a)));
export function validateDefense(value,disputeId){
 if(!value||value.kind!=='dispute_defense'||value.dispute_id!==disputeId||!['strong','partial','weak'].includes(value.assessment)||typeof value.summary!=='string'||typeof value.response_message!=='string'||!DEFENSE_ACTIONS.includes(value.recommended_action)||!Array.isArray(value.gaps)||!Array.isArray(value.points)||value.points.some(p=>!p||typeof p.claim!=='string'||typeof p.quote!=='string'||typeof p.kind!=='string')||!Array.isArray(value.documents)||value.documents.some(d=>!d||typeof d.id!=='string'||typeof d.title!=='string'||typeof d.sendable!=='boolean'||typeof d.consulted!=='boolean'||typeof d.recommended!=='boolean'||typeof d.reason!=='string'))throw Error('AI_JOB_INVALID');
 return value;
}
const KINDS=['agreement','document','delivery','acceptance','payment','client_reply'];
const selectedCount=send=>Array.isArray(send.selected)?send.selected.length:0;
// Whether a client message is still unanswered: the only moment TeTrato analyzes again after a reply was sent.
export function needsAnalysis(dispute){const messages=dispute?.messages||[];return !!dispute&&(!messages.some(m=>m.by==='SELLER')||messages.at(-1)?.by==='BUYER'||!!dispute.actions?.includes('provide_evidence'));}
function composeMarkup(send){
 const busy=send.status==='sending';
 return `${send.status==='error'?`<p class="cloud-error" role="alert">${t('send.failed')}</p>`:''}<div class="dispute-send-row"><button type="button" class="button secondary dispute-docs-open" data-defense-action="documents" aria-haspopup="dialog" ${busy?'disabled':''}>${icon('paperclip')}${t('send.documents',{count:selectedCount(send)})}</button><button type="button" class="button" data-defense-action="send" aria-haspopup="dialog" ${busy?'disabled':''}>${icon('send')}${t(busy?'send.sending':send.composing||send.previous?'send.another':'send.open')}</button></div>`;
}
const textareaMarkup=(draft,send,action='')=>`<div class="dispute-draft-head"><label class="field" for="dispute-response">${t(send.composing?'defense.newMessage':'defense.draft')}</label>${send.status==='sending'?'':action}</div><textarea class="context-box" id="dispute-response" rows="${send.composing?4:7}" maxlength="2000" data-dispute-draft ${send.status==='sending'?'readonly':''}>${esc(draft)}</textarea>`;
// Floating confirmation before the one action that leaves Trato.
export function renderSendConfirm(send){
 return `<header><h2 id="dispute-confirm-title">${t(send.previous||send.composing?'send.anotherTitle':'send.confirmTitle')}</h2></header><p>${selectedCount(send)?t('send.confirmWithDocs',{count:selectedCount(send)}):t('send.confirmCopy')}</p><p class="dispute-confirm-note">${t('send.reviewCarefully')}</p><footer><button type="button" class="button secondary" data-confirm-cancel>${uiText('Cancelar')}</button><button type="button" class="button" data-confirm-send>${t('send.confirm')}</button></footer>`;
}
// What PayPal holds is the source of truth for what was already sent, on any device.
export function lastSellerMessage(dispute){return [...(dispute?.messages||[])].reverse().find(m=>m.by==='SELLER')||null;}
// A send interrupted by a reload has an unknown result; it must never look unsent.
export function restoredSend(send){
 const status=send?.status==='sending'?'uncertain':send?.status==='partial'?'sent':['sent','uncertain'].includes(send?.status)?send.status:'idle';
 return {status,selected:Array.isArray(send?.selected)?send.selected.filter(i=>typeof i==='string'):[],...Object.fromEntries(['attachment','documentsSent','documentsTotal','composing','mode','notice','unrecorded','evidenceNotes'].filter(k=>send?.[k]!==undefined).map(k=>[k,send[k]]))};
}
// Floating list of the project's documents: TeTrato suggests, the freelancer decides what the client receives.
export function renderDocumentChoices(documents,selected,upload={}){
 const row=d=>`<li class="${d.sendable?'':'is-disabled'}"><label><input type="checkbox" data-dispute-doc="${esc(d.id)}" ${selected.includes(d.id)?'checked':''} ${d.sendable?'':'disabled'}><span><strong>${esc(d.title)}</strong>${d.created_at?`<small>${esc(date(d.created_at,true))}</small>`:''}${d.reason?`<small>${esc(d.reason)}</small>`:''}${d.sendable?'':`<small>${t('docs.notSendable')}</small>`}${d.added?`<small>${t('docs.added')}</small>`:d.consulted?'':`<small class="dispute-doc-unread">${t('docs.notRead')}</small>`}</span></label></li>`;
 return `<header><h2 id="dispute-docs-title">${t('docs.title')}</h2><button type="button" class="text-button" data-docs-close aria-label="${uiText('Cerrar')}" title="${uiText('Cerrar')}">${icon('x')}</button></header><p>${t('docs.hint')}</p>${documents.length?`<ul class="dispute-doc-list">${documents.map(row).join('')}</ul>`:`<p class="dispute-muted">${t('docs.empty')}</p>`}<section class="dispute-doc-upload"><p>${t('docs.uploadHint')}</p><label class="button secondary ${upload.busy?'is-disabled':''}">${icon('file-up')}${t(upload.busy?'docs.uploading':'docs.upload')}<input type="file" accept="application/pdf,.pdf" data-docs-upload hidden ${upload.busy?'disabled':''}></label>${upload.error?`<p class="cloud-error" role="alert">${t(`docs.error.${upload.error}`)}</p>`:''}</section><footer><button type="button" class="button" data-docs-close>${t('docs.done')}</button></footer>`;
}
// Closing the dispute by refunding the client is the freelancer's own decision, available as long as PayPal offers it.
function acceptMarkup(actions=[],busy=false){
 return actions.includes('accept_claim')?`<div class="dispute-last-resort"><small>${t('steps.acceptHint')}</small><button type="button" class="button secondary" data-defense-action="accept" aria-haspopup="dialog" ${busy?'disabled':''}>${t(busy?'send.sending':'steps.accept')}</button></div>`:'';
}
// Further steps exist only when PayPal offers their link on the dispute as it stands.
export function actionsMarkup(send){
 const actions=send.actions||[],notice=send.notice?`<p class="${send.notice.startsWith('error')?'cloud-error':'dispute-sent'}" role="status">${t(`steps.${send.notice}`)}</p>`:'';
 const evidence=actions.includes('provide_evidence')?`<div class="dispute-next"><p>${t('steps.evidenceHint')}</p><button type="button" class="button" data-defense-action="evidence">${icon('file-up')}${t('steps.evidence')}</button></div>`:'';
 const escalate=actions.includes('escalate')?`<div class="dispute-last-resort"><small>${t('steps.lastResort')}</small><button type="button" class="text-button" data-defense-action="escalate" aria-haspopup="dialog" ${send.status==='sending'?'disabled':''}>${t('steps.escalate')}</button></div>`:'';
 const sandbox=[actions.includes('require_evidence')?['require_evidence','steps.sandboxEvidence']:null,...(actions.includes('adjudicate')?[['seller_favor','steps.sandboxSeller'],['buyer_favor','steps.sandboxBuyer']]:[])].filter(Boolean);
 const tests=sandbox.length?`<div class="dispute-sandbox"><small>${t('steps.sandboxLabel')}</small><div class="dispute-send-row">${sandbox.map(([id,label])=>`<button type="button" class="button secondary" data-defense-action="sandbox" data-sandbox-step="${id}" ${send.status==='sending'?'disabled':''}>${t(label)}</button>`).join('')}</div></div>`:'';
 const accept=acceptMarkup(actions,send.status==='sending');
 return notice||evidence||escalate||tests||accept?`<section class="dispute-steps">${notice}${evidence}${tests}${accept}${escalate}</section>`:'';
}
function analysisMarkup(result){
 const points=result.points.map(p=>`<li><strong>${esc(p.claim)}</strong><small>${p.title?esc(p.title):t(`defense.kind.${KINDS.includes(p.kind)?p.kind:'other'}`)}${p.at?` · ${esc(date(p.at))}`:''}</small><blockquote>${esc(p.quote)}</blockquote></li>`).join('');
 return `<section class="dispute-assessment is-${esc(result.assessment)}"><small>${t('defense.assessment')}</small><strong>${t(`defense.level.${result.assessment}`)}</strong><p>${esc(result.summary)}</p><p class="dispute-recommended">${t('defense.recommended')}: <strong>${t(`defense.action.${result.recommended_action}`)}</strong></p></section>${points?`<section><h3>${t('defense.points')}</h3><ol class="dispute-points">${points}</ol></section>`:''}${result.gaps.length?`<section class="dispute-gaps"><h3>${t('defense.gaps')}</h3><ul>${result.gaps.map(g=>`<li>${esc(g)}</li>`).join('')}</ul></section>`:''}`;
}
function evidenceForm(draft,send){
 return `<section><label class="field" for="dispute-response">${t('steps.evidenceNotes')}</label><textarea class="context-box" id="dispute-response" rows="5" maxlength="2000" data-dispute-draft ${send.status==='sending'?'readonly':''}>${esc(draft)}</textarea><div class="dispute-send">${send.status==='error'?`<p class="cloud-error" role="alert">${t('send.failed')}</p>`:''}<div class="dispute-send-row"><button type="button" class="button secondary dispute-docs-open" data-defense-action="documents" aria-haspopup="dialog" ${send.status==='sending'?'disabled':''}>${icon('paperclip')}${t('send.documents',{count:selectedCount(send)})}</button><button type="button" class="button" data-defense-action="evidence-send" aria-busy="${send.status==='sending'}" ${send.status==='sending'?'disabled':''}>${icon('send')}${t(send.status==='sending'?'send.sending':'steps.evidence')}</button></div></div></section>`;
}
export function renderDefense(result,draft,send={status:'idle',allowed:false,selected:[]}){
 const finished=['sent','uncertain'].includes(send.status);
 const prepareAgain=`<button type="button" class="text-button" data-defense-action="again-confirm" aria-haspopup="dialog">${icon('refresh-cw')}${t('defense.again')}</button>`;
 // The analysis and its draft lead until a reply goes out, and again when a new client message was analyzed.
 // When PayPal asks for evidence the analysis prepares that answer, which goes to PayPal instead of the client.
 // Once evidence went out, or PayPal's decision was simulated, no draft is pending: any later notice must not bring it back.
 const closedStep=['evidenceDone','acceptDone','sandboxDone'].includes(send.notice)||!!send.evidenceNotes;
 if(closedStep&&!finished){
  const sentNotes=send.evidenceNotes?`<section><h3>${t('steps.evidenceSent')}</h3><p class="dispute-sent-text">${esc(send.evidenceNotes)}</p></section>`:'';
  return `<div class="dispute-defense">${send.notice?.startsWith('error')?`<p class="cloud-error" role="alert">${t(`steps.${send.notice}`)}</p>`:send.notice?`<p class="dispute-sent" role="status">${icon('check')}<span>${t(`steps.${send.notice}`)}</span></p>`:''}${sentNotes}${result?`<details class="dispute-analysis-more"><summary>${t('defense.viewAnalysis')}</summary><div>${analysisMarkup(result)}</div></details>`:''}${actionsMarkup({...send,notice:null,actions:send.notice==='acceptDone'?[]:(send.actions||[]).filter(a=>send.notice!=='evidenceDone'||a!=='provide_evidence')})}</div>`;
 }
 if(result&&!finished&&!closedStep&&(!send.previous||send.fresh)&&!send.allowed&&(send.actions||[]).includes('provide_evidence')){
  const failed=send.notice?`<p class="cloud-error" role="status">${t(`steps.${send.notice}`)}</p>`:'';
  return `<div class="dispute-defense">${analysisMarkup(result)}${failed}${evidenceForm(draft,send)}${acceptMarkup(send.actions,send.status==='sending')}</div>`;
 }
 if(result&&!finished&&!closedStep&&!send.composing&&(!send.previous||send.fresh))return `<div class="dispute-defense">${analysisMarkup(result)}<section>${textareaMarkup(draft,send,prepareAgain)}<p class="dispute-muted">${t('defense.notSent')}</p><div class="dispute-send">${send.allowed?composeMarkup(send):`<p class="dispute-muted">${t('send.notAllowed')}</p>`}</div></section>${acceptMarkup(send.actions)}</div>`;
 if(send.mode==='evidence')return `<div class="dispute-defense">${evidenceForm(draft,send)}</div>`;
 const text=finished?draft:send.previous?.text;
 const sent=text?`<section><h3>${t(send.status==='uncertain'?'defense.attemptedMessage':'defense.sentMessage')}${send.previous?.at&&!finished?` · ${esc(date(send.previous.at,true))}`:''}</h3><p class="dispute-sent-text">${esc(text)}</p></section>`:'';
 const status=send.status==='sent'?`<p class="dispute-sent" role="status">${icon('check')}<span>${send.attachment==='sent'?t('send.doneWithDocs',{count:send.documentsSent??selectedCount(send)}):t('send.done')}</span></p>${send.unrecorded?`<p class="cloud-error" role="alert">${t('send.notRecorded')}</p>`:''}`:send.status==='uncertain'?`<p class="cloud-error" role="alert">${t('send.uncertain')}</p>`:'';
 const next=send.composing?(send.allowed?`<section>${textareaMarkup(draft,send)}<div class="dispute-send">${composeMarkup(send)}</div></section>`:`<p class="dispute-muted">${t('send.notAllowed')}</p>`)
  :send.needsAnalysis&&!finished?`<div class="dispute-next"><p>${t('defense.clientReplied')}</p><button type="button" class="button" data-defense-action="again">${icon('sparkles')}${t('defense.open')}</button></div>`
  :send.allowed?`<div class="dispute-send"><button type="button" class="button secondary" data-defense-action="send-another">${icon('send')}${t('send.another')}</button></div>`:`<p class="dispute-muted">${t('send.notAllowed')}</p>`;
 return `<div class="dispute-defense">${sent}${status}${next}${result?`<details class="dispute-analysis-more"><summary>${t('defense.viewAnalysis')}</summary><div>${analysisMarkup(result)}</div></details>`:''}${actionsMarkup(send)}</div>`;
}

export function installDisputeWorkspace(cloud){
 const states=new Map(),defenses=new Map();let panel=null,openDefense=null;
 function defenseState(disputeId){
  const id=`${cloud.navigationOwner}:${disputeId}`;if(defenses.has(id))return defenses.get(id);
  const state={disputeId,project:cloud.projectId,draft:'',draftFor:null,send:{status:'idle',selected:[]},key:`${cloud.session?.key}:dispute-defense-ui:${cloud.navigationOwner}:${disputeId}`};
  // Draft and send state survive a reload of this tab, like the analysis itself.
  try{const raw=cloud.storage.getItem(state.key);if(raw!==null){const saved=JSON.parse(raw);if(typeof saved.draft==='string'&&typeof saved.draftFor==='string'){state.draft=saved.draft;state.draftFor=saved.draftFor;}state.send=restoredSend(saved.send);if(Array.isArray(saved.added))state.added=saved.added.filter(d=>d&&typeof d.id==='string'&&typeof d.title==='string');}}catch{}
  state.job=new AIJobClient({cloud,scope:'dispute-defense:'+disputeId,onChange:()=>{if(openDefense===state)paintDefense(state);}});
  defenses.set(id,state);return state;
 }
 function saveDefense(state){try{cloud.storage.setItem(state.key,JSON.stringify({draft:state.draft,draftFor:state.draftFor,send:state.send,added:state.added||[]}));}catch{}}
 function defenseBody(state){
  const job=state.job.state,dispute=states.get(key())?.data?.disputes.find(d=>d.dispute_id===state.disputeId),previous=lastSellerMessage(dispute),needs=needsAnalysis(dispute);
  const context=()=>({...state.send,allowed:!!dispute?.actions.includes('send_message'),actions:dispute?.actions||[],previous,needsAnalysis:needs&&!!dispute?.actions.some(a=>DEFENSE_ACTIONS.includes(a)),
   fresh:!!(previous?.at&&job.completedAt&&Date.parse(job.completedAt)>Date.parse(previous.at))});
  if(['queued','running'].includes(job.status))return renderAIActivity({label:t('defense.working'),hint:t('defense.workingHint')});
  if(job.status==='completed'){
   try{const result=validateDefense(job.result,state.disputeId);if(state.draftFor!==job.id){state.draft=result.response_message;state.draftFor=job.id;state.send={status:'idle',selected:result.documents.filter(d=>d.recommended&&d.sendable).map(d=>d.id).slice(0,10)};saveDefense(state);}return renderDefense(result,state.draft,context());}
   catch{return failure('invalid');}
  }
  if(['failed','unavailable'].includes(job.status)&&(needs||!previous)&&dispute?.actions.some(a=>DEFENSE_ACTIONS.includes(a))){const codes={AI_EVALUATOR_NOT_CONFIGURED:'notConfigured',AI_INVALID_CITATION:'invalid',AI_INVALID_RESPONSE:'invalid',DISPUTE_NOT_ACTIONABLE:'closed',DISPUTE_EVIDENCE_UNAVAILABLE:'noEvidence'};return failure(codes[job.error]||'failed');}
  // Already answered and no analysis in this tab: what was sent is still known from PayPal.
  return previous||dispute?.actions.length||['sent','uncertain'].includes(state.send.status)?renderDefense(null,state.draft,context()):'';
 }
 const failure=code=>`<div class="project-assistant-failure" role="alert"><p class="cloud-error">${t(`defense.error.${code}`)}</p><button type="button" class="button secondary" data-defense-action="again">${icon('refresh-cw')}${t('defense.retry')}</button></div>`;
 function paintDefense(state){panel?.render(agentShell({id:'dispute-defense-title',title:t('defense.title'),label:t('defense.title'),closeLabel:uiText('Cerrar'),content:defenseBody(state),composer:''}));}
 // Only documents still offered by the current analysis can be sent.
 const currentDocuments=state=>{let analyzed=[];try{analyzed=validateDefense(state.job.state.result,state.disputeId).documents;}catch{}return [...analyzed,...(state.added||[]).filter(d=>!analyzed.some(a=>a.id===d.id))];};
 const selectedIds=state=>{const allowed=new Set(currentDocuments(state).filter(d=>d.sendable).map(d=>d.id));return state.send.selected.filter(id=>allowed.has(id));};
 let docsDialog=null,docsReturn=null;
 function closeDocuments(){
  if(!docsDialog)return;const dialog=docsDialog;docsDialog=null;dialog.close();dialog.remove();
  if(openDefense)paintDefense(openDefense);
  (panel?.element.querySelector('[data-defense-action="documents"]')||docsReturn)?.focus?.();docsReturn=null;
 }
 function openDocuments(state,trigger){
  closeDocuments();docsReturn=trigger;const dialog=cloud.document.createElement('dialog');docsDialog=dialog;dialog.className='dispute-docs-dialog';dialog.setAttribute('aria-labelledby','dispute-docs-title');
  let upload={};
  const paintList=()=>{if(docsDialog===dialog)dialog.innerHTML=renderDocumentChoices(currentDocuments(state),state.send.selected,upload);};
  paintList();
  // New proof becomes a regular project document: stored with its hash, processed, and visible under Documents.
  async function addFile(file){
   upload={busy:true};paintList();
   try{
    if(!file.name.toLowerCase().endsWith('.pdf')||!file.size||file.size>=10485760||(await file.slice(0,5).text())!=='%PDF-'){upload={error:'format'};return;}
    const identity=[file.name,file.size,file.lastModified].join(':');state.uploadKeys??=new Map();if(!state.uploadKeys.has(identity))state.uploadKeys.set(identity,crypto.randomUUID());
    const query=new URLSearchParams({filename:file.name,title:file.name.replace(/\.pdf$/i,'').slice(0,200)||file.name,kind:'delivery',purpose:'delivery_evidence'});
    const saved=await cloud.request(`/api/v1/projects/${encodeURIComponent(state.project)}/documents?${query}`,{method:'POST',body:file,headers:{'Content-Type':'application/pdf','Accept-Language':uiLanguage(),'Idempotency-Key':state.uploadKeys.get(identity)}});
    const id=saved?.document?.id;if(typeof id!=='string')throw Error('DOCUMENT_INVALID');
    state.added=[...(state.added||[]).filter(d=>d.id!==id),{id,title:file.name,kind:'delivery',created_at:new Date().toISOString(),sendable:true,consulted:false,recommended:false,reason:'',added:true}];
    upload={};
    // Linking and refreshing never undo a file that is already saved; a failed link is shown, the file stays selectable.
    try{await cloud.request(`/api/v1/projects/${encodeURIComponent(state.project)}/disputes/${encodeURIComponent(state.disputeId)}/documents`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({document_id:id})});}
    catch{upload={error:'link'};}
    void cloud.refreshDocumentList?.().catch(()=>{});
    if(!state.send.selected.includes(id)&&state.send.selected.length<10)state.send={...state.send,selected:[...state.send.selected,id]};
    saveDefense(state);
   }catch{upload={error:'failed'};}
   finally{upload={...upload,busy:false};paintList();}
  }
  dialog.addEventListener('click',event=>{if(event.target.closest('[data-docs-close]')||event.target===dialog)closeDocuments();});
  dialog.addEventListener('cancel',event=>{event.preventDefault();closeDocuments();});
  dialog.addEventListener('change',event=>{
   if(event.target.matches?.('[data-docs-upload]')){const file=event.target.files?.[0];event.target.value='';if(file)void addFile(file);return;}
   const id=event.target.dataset?.disputeDoc;if(!id)return;
   const others=state.send.selected.filter(item=>item!==id);
   if(event.target.checked&&others.length>=10){event.target.checked=false;return;}
   state.send={...state.send,selected:event.target.checked?[...others,id]:others};saveDefense(state);
  });
  cloud.document.body.append(dialog);dialog.showModal();
 }
 function confirmDialog(html,trigger,onConfirm){
  const dialog=cloud.document.createElement('dialog');dialog.className='dispute-docs-dialog dispute-confirm-dialog';dialog.setAttribute('aria-labelledby','dispute-confirm-title');
  dialog.innerHTML=html;
  const close=()=>{dialog.close();dialog.remove();if(trigger?.isConnected)trigger.focus();};
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  dialog.addEventListener('click',event=>{
   if(event.target.closest('[data-confirm-send]')){dialog.close();dialog.remove();void onConfirm();return;}
   if(event.target.closest('[data-confirm-cancel]')||event.target===dialog)close();
  });
  cloud.document.body.append(dialog);dialog.showModal();dialog.querySelector('[data-confirm-cancel]').focus();
 }
 function openConfirm(state,trigger){
  const dispute=states.get(key())?.data?.disputes.find(d=>d.dispute_id===state.disputeId);
  confirmDialog(renderSendConfirm({...state.send,selected:selectedIds(state),previous:lastSellerMessage(dispute)}),trigger,()=>sendResponse(state));
 }
 const stepConfirm=(titleKey,copyKey)=>`<header><h2 id="dispute-confirm-title">${t(titleKey)}</h2></header><p>${t(copyKey)}</p><footer><button type="button" class="button secondary" data-confirm-cancel>${uiText('Cancelar')}</button><button type="button" class="button" data-confirm-send>${t('send.confirm')}</button></footer>`;
 async function runStep(state,path,body,done){
  // PayPal documents no idempotency: one attempt at a time, and the screen shows it is working.
  if(state.send.status==='sending')return;
  state.send={...state.send,notice:null,status:'sending'};saveDefense(state);if(openDefense===state)paintDefense(state);
  try{await cloud.request(`/api/v1/projects/${encodeURIComponent(state.project)}/disputes/${encodeURIComponent(state.disputeId)}/${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});state.send={...state.send,notice:done,mode:undefined,status:'idle',evidenceNotes:body.notes??state.send.evidenceNotes};if(body.notes)state.draft='';}
  catch(error){state.send={...state.send,notice:['DISPUTE_SEND_REJECTED','DISPUTE_NOT_ACTIONABLE','DISPUTE_DOCUMENT_INVALID'].includes(error.code)?'errorRejected':'errorUncertain',status:'idle'};}
  saveDefense(state);if(openDefense===state)paintDefense(state);
  const list=states.get(key());if(list&&!list.loading)void load(list,state.project);
 }
 async function sendResponse(state){
  if(state.send.status==='sending'||!state.draft.trim())return;
  state.send={...state.send,status:'sending'};saveDefense(state);paintDefense(state);
  try{
   const result=await cloud.request(`/api/v1/projects/${encodeURIComponent(state.project)}/disputes/${encodeURIComponent(state.disputeId)}/messages`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:state.draft,document_ids:selectedIds(state)})});
   if(result?.message_sent!==true)throw Error('DISPUTE_SEND_UNCERTAIN');
   state.send={...state.send,composing:false,status:'sent',attachment:result.attachment,documentsSent:result.documents_sent,documentsTotal:result.documents_total,unrecorded:result.documents_recorded===false};
   void cloud.refreshDocumentList?.().catch(()=>{});
  }catch(error){
   // Only a clear rejection may be retried: PayPal documents no idempotency, so an unknown result could duplicate the message.
   state.send={...state.send,status:['DISPUTE_SEND_REJECTED','DISPUTE_DOCUMENT_INVALID','ORIGINAL_HASH_MISMATCH','DOCUMENT_NOT_FOUND','DISPUTE_NOT_FOUND','DISPUTE_NOT_ACTIONABLE'].includes(error.code)?'error':'uncertain'};
  }
  saveDefense(state);
  if(openDefense===state)paintDefense(state);
  const list=states.get(key());if(list&&!list.loading)void load(list,state.project);
 }
 function prepare(state,fresh=false){
  const job=state.job;
  if(fresh&&!job.state.uncertain)job.state={id:null,status:'idle',result:null,error:null,uncertain:false};
  void job.start(`/api/v1/projects/${encodeURIComponent(state.project)}/disputes/${encodeURIComponent(state.disputeId)}/defense`,{output_language:uiLanguage()});
 }
 const key=()=>`${cloud.navigationOwner}:${cloud.projectId}`;
 // Last list seen in this browser session: shown at once while PayPal is checked again. Sending always re-verifies on the server.
 const storageKey=project=>`${cloud.session?.key}:disputes:${cloud.navigationOwner}:${project}`;
 function remembered(project){try{const raw=cloud.storage.getItem(storageKey(project));return raw===null?null:validateDisputes(JSON.parse(raw),project);}catch{return null;}}
 function remember(project,data){try{cloud.storage.setItem(storageKey(project),JSON.stringify(data));}catch{}}
 async function load(state,project){
  state.loading=true;state.error='';
  try{state.data=validateDisputes(await cloud.request(`/api/v1/projects/${encodeURIComponent(project)}/disputes`),project);remember(project,state.data);if(state.data.client_documents_imported>0)void cloud.refreshDocumentList?.().catch(()=>{});}
  catch(error){state.error=error.code==='PAYPAL_SANDBOX_NOT_CONFIGURED'?t('notConfigured'):t('error');}
  finally{state.loading=false;if(cloud.projectId===project)cloud.notify();if(openDefense?.project===project)paintDefense(openDefense);}
 }
 cloud.renderDisputes=function(panel){
  const project=cloud.projectId;if(!project)return;
  let state=states.get(key());
  if(!state){state={loading:false,data:remembered(project),error:''};states.set(key(),state);void load(state,project);}
  const head=`<header class="dispute-head"><div><h2>${t('title')}</h2><p>${t('intro')}</p></div><button type="button" class="button secondary" data-dispute-refresh ${state.loading?'disabled':''}>${icon('refresh-cw')}<span ${state.loading?'role="status"':''}>${t(state.loading?'loading':'refresh')}</span></button></header>`;
  let body;
  if(state.loading&&!state.data)body='';
  else if(state.error)body=`<p class="cloud-error" role="alert">${esc(state.error)}</p>`;
  else if(!state.data.disputes.length)body=`<section class="workspace-panel dispute-empty">${icon('shield-check')}<div><h3>${t('emptyTitle')}</h3><p>${t('emptyCopy',{count:state.data.payments_checked})}</p></div></section>`;
  else body=state.data.disputes.map(renderDispute).join('');
  const unsaved=state.data?.history_saved===false&&!state.error?`<p class="cloud-error" role="alert">${t('historyNotSaved')}</p>`:'';
  const uncopied=state.data?.client_documents_saved===false&&!state.error?`<p class="cloud-error" role="alert">${t('clientDocsNotSaved')}</p>`:'';
  panel.innerHTML=`<section class="dispute-workspace" aria-busy="${state.loading}">${head}${unsaved}${uncopied}${body}</section>`;
 };
 function openConversation(button){
  const dispute=states.get(key())?.data?.disputes.find(d=>d.dispute_id===button.dataset.disputeConversation);if(!dispute)return;
  const dialog=cloud.document.createElement('dialog');dialog.className='dispute-docs-dialog dispute-side-dialog';dialog.setAttribute('aria-labelledby','dispute-conversation-title');
  const close=()=>{dialog.close();dialog.remove();if(button.isConnected)button.focus();};
  dialog.innerHTML=`<header><h2 id="dispute-conversation-title">${t('conversationTitle')}</h2><button type="button" class="text-button" data-docs-close aria-label="${uiText('Cerrar')}" title="${uiText('Cerrar')}">${icon('x')}</button></header>${renderConversation(dispute)}`;
  dialog.addEventListener('click',event=>{if(event.target.closest('[data-docs-close]')||event.target===dialog)close();});
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  cloud.document.body.append(dialog);dialog.showModal();
  const list=dialog.querySelector('.dispute-messages');list.scrollTop=list.scrollHeight;
 }
 // Floating list of a message's attachments with their preview, so ten files take no more room on the card than two.
 function openAttachments(button){
  const disputeId=button.dataset.disputeDocs,messageIndex=Number(button.dataset.messageIndex),project=cloud.projectId;
  const names=states.get(key())?.data?.disputes.find(d=>d.dispute_id===disputeId)?.messages[messageIndex]?.documents||[];
  if(!names.length)return;
  const dialog=cloud.document.createElement('dialog');dialog.className='dispute-docs-dialog dispute-preview-dialog';dialog.setAttribute('aria-labelledby','dispute-preview-title');
  const urls=new Map();let shown=null;
  const close=()=>{dialog.close();dialog.remove();for(const url of urls.values())URL.revokeObjectURL(url);if(button.isConnected)button.focus();};
  dialog.innerHTML=`<header><h2 id="dispute-preview-title">${t('documentsAttached',{count:names.length})}</h2><button type="button" class="text-button" data-docs-close aria-label="${uiText('Cerrar')}" title="${uiText('Cerrar')}">${icon('x')}</button></header><div class="dispute-preview-list">${names.map((name,index)=>`<button type="button" class="button secondary" data-preview-document="${index}">${icon('eye')}<span>${esc(name)}</span></button>`).join('')}</div><div class="dispute-preview-frame" data-preview-frame></div>`;
  const frame=dialog.querySelector('[data-preview-frame]');
  async function show(index){
   shown=index;
   for(const item of dialog.querySelectorAll('[data-preview-document]'))item.toggleAttribute('aria-current',Number(item.dataset.previewDocument)===index);
   frame.innerHTML=`<p role="status">${t('previewLoading')}</p>`;
   try{
    if(!urls.has(index))urls.set(index,URL.createObjectURL(await cloud.request(`/api/v1/projects/${encodeURIComponent(project)}/disputes/${encodeURIComponent(disputeId)}/messages/${messageIndex}/documents/${index}`,{},true)));
    if(shown!==index||!dialog.isConnected)return;
    const view=cloud.document.createElement('iframe');view.title=names[index];view.src=urls.get(index);frame.replaceChildren(view);
   }catch{if(shown===index)frame.innerHTML=`<p class="cloud-error" role="alert">${t('previewError')}</p>`;}
  }
  dialog.addEventListener('click',event=>{
   const item=event.target.closest('[data-preview-document]');if(item){void show(Number(item.dataset.previewDocument));return;}
   if(event.target.closest('[data-docs-close]')||event.target===dialog)close();
  });
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  cloud.document.body.append(dialog);dialog.showModal();void show(0);
 }
 cloud.document.addEventListener('input',event=>{if(event.target.matches?.('[data-dispute-draft]')&&openDefense){openDefense.draft=event.target.value;saveDefense(openDefense);}});
 cloud.document.addEventListener('click',event=>{
  const conversation=event.target.closest?.('[data-dispute-conversation]');if(conversation){openConversation(conversation);return;}
  const attachments=event.target.closest?.('[data-dispute-docs]');if(attachments){openAttachments(attachments);return;}
  const open=event.target.closest?.('[data-dispute-defense]');
  if(open){
   const state=defenseState(open.dataset.disputeDefense);openDefense=state;
   if(!panel)panel=createAgentPanel({cloud,id:'dispute-defense-title',className:'project-agent-drawer dispute-defense-drawer',onClose(){if(openDefense?.send.composing&&!openDefense.draft.trim()){openDefense.send={status:'idle',selected:[]};saveDefense(openDefense);}openDefense=null;}});
   panel.open(open);paintDefense(state);
   // A new client message is the signal to analyze again; otherwise opening only shows what exists.
   const dispute=states.get(key())?.data?.disputes.find(d=>d.dispute_id===state.disputeId),job=state.job.state,answerable=dispute?.actions.some(a=>DEFENSE_ACTIONS.includes(a));
   const lastClient=[...(dispute?.messages||[])].reverse().find(m=>m.by==='BUYER');
   const asked=dispute?.actions.includes('provide_evidence')&&dispute.updated_at;
   const stale=job.status==='completed'&&job.completedAt&&[lastClient?.at,asked].some(at=>at&&Date.parse(job.completedAt)<Date.parse(at));
   if(answerable&&needsAnalysis(dispute)&&(job.status==='idle'||stale))prepare(state,stale);else if(['queued','running'].includes(job.status))void state.job.check();
   return;
  }
  if(event.target.closest?.('[data-defense-action="again"]')&&openDefense){prepare(openDefense,true);paintDefense(openDefense);return;}
  const action=event.target.closest?.('[data-defense-action]')?.dataset.defenseAction;
  if(openDefense&&action==='send'&&openDefense.draft.trim()){openConfirm(openDefense,event.target.closest('[data-defense-action]'));return;}
  if(openDefense&&action==='documents'){openDocuments(openDefense,event.target.closest('[data-defense-action]'));return;}
  if(openDefense&&action==='evidence'){openDefense.draft='';openDefense.send={...openDefense.send,mode:'evidence',status:'idle',notice:null};saveDefense(openDefense);paintDefense(openDefense);return;}
  if(openDefense&&action==='evidence-send'){
   const state=openDefense,documents=selectedIds(state);
   if(state.send.status==='sending')return;
   if(!state.draft.trim()||!documents.length){state.send={...state.send,status:'error'};paintDefense(state);return;}
   confirmDialog(stepConfirm('steps.evidenceTitle','steps.evidenceCopy'),event.target.closest('[data-defense-action]'),()=>runStep(state,'evidence',{notes:state.draft,document_ids:documents},'evidenceDone'));return;
  }
  if(openDefense&&action==='again-confirm'){
   // It reads everything again and replaces the analysis and the draft, including any edits.
   const state=openDefense,copy=`<header><h2 id="dispute-confirm-title">${t('defense.againTitle')}</h2></header><p>${t('defense.againCopy')}</p><footer><button type="button" class="button secondary" data-confirm-cancel>${uiText('Cancelar')}</button><button type="button" class="button" data-confirm-send>${t('defense.againConfirm')}</button></footer>`;
   confirmDialog(copy,event.target.closest('[data-defense-action]'),()=>{prepare(state,true);if(openDefense===state)paintDefense(state);});return;
  }
  if(openDefense&&action==='accept'){
   const state=openDefense;
   confirmDialog(stepConfirm('steps.acceptTitle','steps.acceptCopy'),event.target.closest('[data-defense-action]'),()=>runStep(state,'accept',{note:'The freelancer accepts the claim and refunds the client.'},'acceptDone'));return;
  }
  if(openDefense&&action==='escalate'){
   const state=openDefense;
   confirmDialog(stepConfirm('steps.escalateTitle','steps.escalateCopy'),event.target.closest('[data-defense-action]'),()=>runStep(state,'escalate',{note:'The freelancer asks PayPal to review this dispute with the project records.'},'escalateDone'));return;
  }
  if(openDefense&&action==='sandbox'){
   const state=openDefense,step=event.target.closest('[data-sandbox-step]').dataset.sandboxStep;
   confirmDialog(stepConfirm('steps.sandboxTitle','steps.sandboxCopy'),event.target.closest('[data-defense-action]'),()=>runStep(state,'sandbox',{action:step},'sandboxDone'));return;
  }
  if(openDefense&&action==='send-another'){openDefense.draft='';openDefense.send={status:'idle',selected:[],composing:true};saveDefense(openDefense);paintDefense(openDefense);return;}
  if(!event.target.closest?.('[data-dispute-refresh]')||!cloud.projectId)return;
  const state=states.get(key());if(!state||state.loading)return;void load(state,cloud.projectId);cloud.notify();
 });
}
