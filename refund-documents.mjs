import {uiText,uiLocale} from './i18n.mjs';
import {icon} from './icons.mjs';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const t=(k,v)=>uiText(`refundDoc.${k}`,v);
const money=n=>new Intl.NumberFormat(uiLocale(),{style:'currency',currency:'USD'}).format(n/100);
const date=v=>new Intl.DateTimeFormat(uiLocale(),{dateStyle:'medium',timeStyle:'short',timeZone:'America/Lima'}).format(new Date(v));
const btn=(action,label,attrs='')=>`<button type="button" class="button secondary" data-refund-action="doc-${action}" ${attrs}>${t(label)}</button>`;
const opt=(id,title,selected)=>`<option value="${esc(id)}" ${id===selected?'selected':''}>${esc(title)}</option>`;

function emailCard(mail){
 return `<div class="refund-mail-preview">
  <div class="refund-mail-brand"><img src="/assets/mascot/trato-guide.png" width="48" height="48" alt=""><strong>Trato</strong></div>
  <article class="refund-mail-content"><h4>${esc(mail.subject)}</h4>
   <dl class="refund-mail-addresses"><div><dt>${t('sender')}</dt><dd>${esc(mail.sender)}</dd></div><div><dt>${t('recipient')}</dt><dd>${esc(mail.recipient)}</dd></div></dl>
   <div class="refund-preserved refund-mail-copy">${esc(mail.body)}</div>
   ${mail.filename?`<p class="refund-email-attachment">${icon('paperclip')}${esc(mail.filename)}</p>`:''}
  </article>
 </div>`;
}

function emailArchive(deliveries){
 const saved=deliveries.filter(d=>d.message_preview);
 if(!saved.length)return '';
 return `<section class="refund-mail-history"><h4>${t('mailHistory')}</h4>${saved.map(d=>{
  const accepted=d.status==='accepted_by_gmail';
  const sentAt=d.updated_at||d.created_at;
  return `<details class="refund-fold refund-mail-entry">
   <summary>${icon('mail')}<span><strong>${esc(d.message_preview.subject)}</strong><small>${esc(d.recipient)}${sentAt?` · ${date(sentAt)}`:''}</small></span>
    <span class="refund-status" data-status="${accepted?'completed':esc(d.status)}">${t('delivery.'+d.status)}</span>${icon('chevron-down')}</summary>
   <div class="refund-fold-body"><p class="refund-mail-caption">${t(accepted?'savedContent':'savedPreview')}</p>${emailCard({...d.message_preview,sender:d.sender,recipient:d.recipient})}</div>
  </details>`;
 }).join('')}</section>`;
}
export const initialForm=()=>({order_id:'',capture_id:'',notes:'',confirmed:false,evidence:[]});
export function renderInitialPayment(s,evidenceHtml){
 const f=s.initial;
 return `<form data-refund-form="initial"><h3>${t('initial')}</h3><p>${t('initialHelp')}</p><p>${t('reference')}: <code class="refund-preserved">initial-${esc(s.project)}</code></p><label>${t('order')}<input name="order_id" value="${esc(f.order_id)}" maxlength="64" required></label><label>${t('capture')}<input name="capture_id" value="${esc(f.capture_id)}" maxlength="64" required></label><label>${t('notes')}<textarea name="notes" required maxlength="4000">${esc(f.notes)}</textarea></label>${evidenceHtml(f.evidence,'initial')}<label class="refund-checkbox"><input type="checkbox" name="confirmed" ${f.confirmed?'checked':''} required>${t('initialConfirmed')}</label><button class="button" type="submit">${t('linkInitial')}</button>${btn('cancel','cancel')}</form>`;
}
export function renderRefundDocuments(s,cloud,evidenceHtml,step=0){
 const parent=s.detail?.settlement,snap=s.snapshot,d=s.documentData;if(!parent||!snap||!d)return '';
 const current=parent.current_snapshot_id===snap.id,artifact=d.artifacts?.[0],ready=!!artifact?.document_id,reviewed=d.reviews?.length>0;
 const responseStage=step===0||step===4,documentStage=step===0||step===3;
 const waiting=responseStage&&current&&parent.status==='awaiting_response';
 const draft=documentStage&&current&&parent.status==='draft'&&!s.editor;
 const sent=(d.deliveries||[]).find(x=>x.status==='accepted_by_gmail');
 const uncertain=(d.deliveries||[]).find(x=>['sending','delivery_uncertain'].includes(x.status));
 const failed=(d.deliveries||[]).find(x=>x.status==='failed');
 let review='';
 if(s.workflowForm){
  const f=s.workflowForm;
  review=`<form class="refund-card refund-document-review" data-refund-form="${f.kind}"><h4>${t(f.kind==='review'?'review':f.kind==='feedback'?'feedback':'acceptance')}</h4><p>${t('humanEvidence')}</p>${f.kind==='review'?'':`<label>${t('clientReply')}<select name="response_id"><option value="">${t('manualEvidence')}</option>${(d.responses||[]).map(r=>opt(r.id,r.from_email+' · '+date(r.received_at),f.response_id)).join('')}</select></label>${f.response_id?'':f.kind==='feedback'?evidenceHtml(f.evidence,'workflow'):`<label>${t('returnedPdf')}<select name="document_id" required><option value="">${t('choosePdf')}</option>${cloud.documents.filter(doc=>doc.mime_type==='application/pdf'&&doc.sha256&&doc.id!==artifact?.document_id&&['reference','delivery'].includes(doc.kind)).map(doc=>opt(doc.id,doc.title,f.document_id)).join('')}</select></label>${btn('upload-response','uploadResponse')}${f.document_id?`<button type="button" class="button secondary refund-ai-trigger" data-refund-assistant="reply" data-support="${esc(f.document_id)}" aria-haspopup="dialog">${icon('sparkles')}${uiText('refundAI.analyzeReply')}</button>`:''}`}`}
  <label>${t('notes')}<textarea name="notes" required maxlength="4000">${esc(f.notes)}</textarea></label><label class="refund-checkbox"><input type="checkbox" name="confirmed" ${f.confirmed?'checked':''} required>${t('reviewConfirmed')}</label><button class="button" type="submit">${t(f.kind==='review'?'confirmReview':f.kind==='feedback'?'recordFeedback':'recordAcceptance')}</button>${btn('cancel-review','cancel')}</form>`;
 }
 const preview=s.emailPreview;
 const responses=d.responses||[];
 const pdfCard=ready?`<div class="refund-pdf-card">
  <span class="refund-mark">${icon('file-text')}</span>
  <div><strong>${t('exactDocument')}</strong>${artifact.language?`<small>${t('frozenLanguage')}: ${esc(artifact.language.toUpperCase())}</small>`:''}</div>
  <button type="button" class="button secondary refund-pdf-action" data-refund-action="doc-pdf-view">${icon('file-text')}${t('viewPdf')}</button>
 </div>`:draft?`<div class="refund-card"><label>${t('language')}<select data-refund-doc-field="language">${['es','en'].map(lang=>opt(lang,lang==='es'?'Español':'English',s.pdfLanguage)).join('')}</select></label>${btn('pdf','generatePdf')}</div>`:`<p class="refund-list-hint">${t('noPdf')}</p>`;
 return `<section class="refund-documents">
  ${documentStage||step===6?pdfCard:''}
  ${documentStage&&snap.payments?.length?`<details class="refund-fold"><summary>${icon('credit-card')}<span>${t('allocation')}</span>${icon('chevron-down')}</summary><ul class="refund-fold-body refund-allocation">${snap.payments.map(p=>`<li><span>${t(p.origin==='initial'?'initialPayment':'changePayment')} · ${esc(p.payment_id.slice(0,8))}</span><strong>${money(p.refund_minor)}</strong></li>`).join('')}</ul></details>`:''}
  ${draft&&ready&&!reviewed?btn('review','review'):''}
  ${draft&&ready&&reviewed&&!uncertain&&!preview?`<div class="refund-card refund-email-note"><label>${uiText('refundAI.emailNote')}<textarea data-refund-doc-field="mail-note" rows="3" maxlength="600">${esc(s.mailNote||'')}</textarea></label>
   <div class="refund-actions"><button type="button" class="button" data-refund-action="doc-preview">${t('continueSend')}</button><button type="button" class="button secondary refund-ai-trigger" data-refund-assistant="email" aria-haspopup="dialog">${icon('sparkles')}${uiText('refundAI.prepareEmail')}</button></div></div>`:''}
  ${documentStage&&uncertain?`<div class="refund-notice"><p role="status">${t('uncertain')}</p>${btn('reconcile','reconcile',`data-key="${esc(uncertain.operation_key)}"`)}</div>`:''}
  ${documentStage&&failed&&!sent&&!uncertain?`<p class="refund-notice" role="alert">${t(['GMAIL_RECONNECT_REQUIRED','GMAIL_NOT_CONNECTED'].includes(failed.error_code)?'failedMailbox':'failed')}</p>`:''}
  ${preview&&documentStage?`<section class="refund-email-preview" aria-label="${t('preview')}"><h4>${t('preview')}</h4>${emailCard(preview)}
   <form data-refund-form="send"><label class="refund-checkbox"><input type="checkbox" name="confirmed" required>${t('sendConfirmed')}</label><button class="button" type="submit">${t('send')}</button>${btn('edit-mail','editMail')}</form></section>`:''}
  ${documentStage||step===6?emailArchive(d.deliveries||[]):''}
  ${responseStage?`<section class="refund-response-section"><div class="refund-card refund-response-overview"><span class="refund-mark">${icon('mail')}</span><div><h4>${t('responseTitle')}</h4><p class="refund-response-status" role="status">${s.busy?t('checking'):t(responses.length?'repliesReady':'waitingReply')}</p></div>
   ${waiting?`<button type="button" class="button" data-refund-action="doc-sync">${t('sync')}</button>`:''}
  </div>${responses.map(r=>responseCard(r,waiting)).join('')}
  ${waiting?`<div class="refund-actions">${btn('feedback','feedback')}${btn('acceptance','acceptance')}</div>`:''}</section>`:''}
  ${review}
  ${parent.status==='accepted'&&responseStage?`<p class="refund-notice">${t('acceptedPending')}</p>`:''}
  ${parent.status==='closed_without_refund'&&step===6?`<p class="refund-notice">${t('zeroClosed')}</p>`:''}
 </section>`;
}

function responseCard(r,waiting){
 return `<article class="refund-response">
  <header><span class="refund-mark">${icon('mail')}</span><div><strong>${esc(r.from_email)}</strong><time datetime="${esc(r.received_at)}">${date(r.received_at)}</time></div></header>
  ${r.reply_needs_review?`<p class="refund-notice">${t('replyUncertain')}</p>`:''}
  <div class="refund-reply-text">${esc(r.reply_text??r.body_text)}</div>
  <details class="refund-fold"><summary><span>${t('fullEmail')}</span>${icon('chevron-down')}</summary><pre class="refund-preserved refund-fold-body">${esc(r.body_text)}</pre></details>
  ${r.attachments?.length?`<section class="refund-attachments" aria-label="${t('attachments')}"><h4>${t('attachments')}</h4>${r.attachments.map((a,i)=>`<div class="refund-attachment">
   <div class="refund-attachment-file">${icon('paperclip')}<div><strong>${esc(a.filename)}</strong><small>${esc(a.mime_type)} · ${esc(a.size_bytes)} ${t('bytes')}</small></div></div>
   <div class="refund-attachment-actions">${a.supported?`${btn('attachment','downloadAttachment',`data-response="${esc(r.id)}" data-index="${i}"`)}${btn('import','importAttachment',`data-response="${esc(r.id)}" data-index="${i}"`)}`:''}</div>
  </div>`).join('')}</section>`:''}
  ${waiting?`<div class="refund-response-actions"><button type="button" class="button secondary refund-ai-trigger" data-refund-assistant="reply" data-response="${esc(r.id)}" aria-haspopup="dialog">${icon('sparkles')}${uiText('refundAI.analyzeReply')}</button>${btn('acceptance','acceptance',`data-response="${esc(r.id)}"`)}${btn('feedback','feedback',`data-response="${esc(r.id)}"`)}</div>`:''}
 </article>`;

}
export function documentInput(s,el){
 const kind=el.closest('[data-refund-form]')?.dataset.refundForm;
 if(el.dataset.refundDocField==='mail-note'){s.mailNote=el.value;return true;}
 if(el.dataset.refundDocField==='language'){s.pdfLanguage=el.value;return true;}
 if(kind==='initial'&&s.initial&&el.name){s.initial[el.name]=el.type==='checkbox'?el.checked:el.value;return true;}
 if(['review','feedback','acceptance'].includes(kind)&&s.workflowForm&&el.name){
  s.workflowForm[el.name]=el.type==='checkbox'?el.checked:el.value;return ['response_id','document_id'].includes(el.name)?'render':true;
 }
 return false;
}
export async function documentAction(s,cloud,action,target,h){
 if(!action.startsWith('doc-'))return false;
 const a=action.slice(4),parent=s.detail?.settlement.id,snapshot=s.snapshot?.id;
 if(a==='initial'){s.initial=initialForm();s.view='initial';s.wizardOpen=true;s.step=null;}
 if(a==='cancel'){s.initial=null;s.pick=null;s.view='list';s.wizardOpen=false;}
 if(a==='pdf')await h.write(s,'pdf',{language:s.pdfLanguage});
 if(a==='pdf-view'){
  const artifact=s.documentData.artifacts[0];await h.preview(artifact.document_id);
 }
 if(['review','feedback','acceptance'].includes(a)){s.workflowForm={kind:a,notes:'',confirmed:false,response_id:target.dataset.response||'',document_id:'',evidence:[]};s.emailPreview=null;}
 if(a==='cancel-review'){s.workflowForm=null;s.pick=null;}
 if(a==='upload-response')h.upload();
 if(a==='preview'){
  const path=`/api/v1/refunds/${parent}/snapshots/${snapshot}/email-preview`,note=s.mailNote?.trim();
  const data=await (note?cloud.request(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({note})}):cloud.request(path));
  if(h.current(s)){if(data.snapshot_id!==snapshot)throw Error('refund.revisionConflict');s.emailPreview=data;}
 }
 if(a==='edit-mail')s.emailPreview=null;
 if(a==='sync'){
  const result=await cloud.request(`/api/v1/refunds/${parent}/snapshots/${snapshot}/responses/sync`,{method:'POST'});
  if(h.current(s)){await h.openDetail(s,parent,snapshot);if(h.current(s))s.notice=t('syncResult',{count:result.synced,total:s.documentData?.responses?.length||0});}
 }
 if(a==='reconcile'){
  const result=await cloud.request(`/api/v1/refunds/${parent}/snapshots/${snapshot}/email/reconcile`,{method:'POST',headers:{'Idempotency-Key':target.dataset.key}});
  if(h.current(s)){if(result.state==='confirmed')await h.acceptResult(s,result.result);else s.error=t('uncertain');}
 }
 if(a==='attachment'){
  const blob=await cloud.request(`/api/v1/refunds/${parent}/responses/${target.dataset.response}/attachments/${target.dataset.index}`,{},true);
  if(h.current(s)){const url=URL.createObjectURL(blob),link=cloud.document.createElement('a');link.href=url;link.download='attachment.pdf';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 }
 if(a==='import'){
  await cloud.request(`/api/v1/refunds/${parent}/responses/${target.dataset.response}/attachments/${target.dataset.index}/import`,{method:'POST',headers:{'Idempotency-Key':`refund-attachment-${target.dataset.response}-${target.dataset.index}`}});
  if(h.current(s)){await cloud.loadProject();if(h.current(s)){await h.openDetail(s,parent,snapshot);s.notice=t('imported');}}
 }
 return true;
}
export async function documentSubmit(s,cloud,form,h){
 const kind=form.dataset.refundForm;
 if(kind==='initial'){
  const f=s.initial;if(!f.confirmed||!f.evidence.length)throw Error('refund.evidenceRequired');
  await h.write(s,'initial',{order_id:f.order_id.trim(),capture_id:f.capture_id.trim(),notes:f.notes.trim(),confirmed:true,evidence:f.evidence});return true;
 }
 if(kind==='send'){
  if(!new FormData(form).get('confirmed')||!s.emailPreview)throw Error('refund.reviewRequired');
  await h.write(s,'send',{digest:s.emailPreview.digest,confirmed:true,...(s.emailPreview.note?{note:s.emailPreview.note}:{})});return true;
 }
 if(['review','feedback','acceptance'].includes(kind)){
  const f=s.workflowForm;if(!f?.confirmed||!f.notes.trim())throw Error('refund.reviewRequired');
  const body={expected_snapshot_id:s.snapshot.id,confirmed:true,notes:f.notes.trim()};
  if(kind!=='review'){
   if(f.response_id)body.evidence={email_id:f.response_id};
   else if(kind==='feedback')body.evidence=f.evidence[0];
   else {const doc=cloud.documents.find(d=>d.id===f.document_id);if(!doc)throw Error('refund.evidenceRequired');body.evidence={document_id:doc.id,document_sha256:doc.sha256};}
   if(!body.evidence)throw Error('refund.evidenceRequired');
  }
  await h.write(s,kind,body);return true;
 }
 return false;
}
