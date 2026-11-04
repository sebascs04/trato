import {uiText,uiLocale} from './i18n.mjs';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const t=(k,v)=>uiText(`refundDoc.${k}`,v);
const money=n=>new Intl.NumberFormat(uiLocale(),{style:'currency',currency:'USD'}).format(n/100);
const date=v=>new Intl.DateTimeFormat(uiLocale(),{dateStyle:'medium',timeStyle:'short',timeZone:'America/Lima'}).format(new Date(v));
const btn=(action,label,attrs='')=>`<button type="button" class="button secondary" data-refund-action="doc-${action}" ${attrs}>${t(label)}</button>`;
const opt=(id,title,selected)=>`<option value="${esc(id)}" ${id===selected?'selected':''}>${esc(title)}</option>`;
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
 const archive=(d.deliveries||[]).filter(x=>x.message_preview).map(x=>`<details><summary>${t('savedEmail')} · ${t('delivery.'+x.status)}</summary><p>${esc(x.recipient)}</p><strong>${esc(x.message_preview.subject)}</strong><pre class="refund-preserved">${esc(x.message_preview.body)}</pre></details>`).join('');
 let review='';
 if(s.workflowForm){
  const f=s.workflowForm;
  review=`<form data-refund-form="${f.kind}"><h4>${t(f.kind==='review'?'review':f.kind==='feedback'?'feedback':'acceptance')}</h4><p>${t('humanEvidence')}</p>${f.kind==='review'?'':`<label>${t('clientReply')}<select name="response_id"><option value="">${t('manualEvidence')}</option>${(d.responses||[]).map(r=>opt(r.id,r.from_email+' · '+date(r.received_at),f.response_id)).join('')}</select></label>${f.response_id?'':f.kind==='feedback'?evidenceHtml(f.evidence,'workflow'):`<label>${t('returnedPdf')}<select name="document_id" required><option value="">${t('choosePdf')}</option>${cloud.documents.filter(doc=>doc.mime_type==='application/pdf'&&doc.sha256&&doc.id!==artifact?.document_id&&['reference','delivery'].includes(doc.kind)).map(doc=>opt(doc.id,doc.title,f.document_id)).join('')}</select></label>${btn('upload-response','uploadResponse')}`}`}
  <label>${t('notes')}<textarea name="notes" required maxlength="4000">${esc(f.notes)}</textarea></label><label class="refund-checkbox"><input type="checkbox" name="confirmed" ${f.confirmed?'checked':''} required>${t('reviewConfirmed')}</label><button class="button" type="submit">${t(f.kind==='review'?'confirmReview':f.kind==='feedback'?'recordFeedback':'recordAcceptance')}</button>${btn('cancel-review','cancel')}</form>`;
 }
 const preview=s.emailPreview;
 return `<section class="refund-documents"><h3>${t('documents')}</h3>${documentStage&&snap.payments?.length?`<h4>${t('allocation')}</h4><ul>${snap.payments.map(p=>`<li>${t(p.origin==='initial'?'initialPayment':'changePayment')} · ${esc(p.payment_id.slice(0,8))}: ${money(p.refund_minor)}</li>`).join('')}</ul>`:''}
 ${(documentStage||step===6)?(ready?btn('pdf-view','viewPdf'):draft?`<label>${t('language')}<select data-refund-doc-field="language">${['es','en'].map(lang=>opt(lang,lang==='es'?'Español':'English',s.pdfLanguage)).join('')}</select></label>${btn('pdf','generatePdf')}`:`<p>${t('noPdf')}</p>`):''}
 ${artifact&&documentStage?`<p>${t('frozenLanguage')}: ${esc(artifact.language)}</p>`:''}
 ${draft&&ready&&!reviewed?btn('review','review'):''}${draft&&ready&&reviewed&&!uncertain&&!preview?btn('preview','continueSend'):''}
 ${uncertain?`<p role="status">${t('uncertain')}</p>${btn('reconcile','reconcile',`data-key="${esc(uncertain.operation_key)}"`)}`:''}${failed&&!sent?`<p role="alert">${t('failed')}</p>`:''}
 ${preview&&documentStage?`<section aria-label="${t('preview')}"><h4>${t('preview')}</h4><p>${t('sender')}: ${esc(preview.sender)}</p><p>${t('recipient')}: ${esc(preview.recipient)}</p><strong>${esc(preview.subject)}</strong><pre class="refund-preserved">${esc(preview.body)}</pre><p>${esc(preview.filename)} · ${esc(preview.sha256)}</p><form data-refund-form="send"><label class="refund-checkbox"><input type="checkbox" name="confirmed" required>${t('sendConfirmed')}</label><button class="button" type="submit">${t('send')}</button></form></section>`:''}
 ${waiting?`${btn('sync','sync')}${btn('feedback','feedback')}${btn('acceptance','acceptance')}`:''}
 ${responseStage?`<p class="refund-response-status" role="status">${s.busy?t('checking'):t((d.responses||[]).length?'repliesReady':'waitingReply')}</p>${(d.responses||[]).map(r=>`<article class="refund-response"><header><strong>${esc(r.from_email)}</strong><time>${date(r.received_at)}</time></header>${r.reply_needs_review?`<p class="refund-notice">${t('replyUncertain')}</p>`:''}<div class="refund-reply-text">${esc(r.reply_text??r.body_text)}</div><details><summary>${t('fullEmail')}</summary><pre class="refund-preserved">${esc(r.body_text)}</pre></details>${r.attachments?.length?`<section class="refund-attachments" aria-label="${t('attachments')}">${r.attachments.map((a,i)=>`<div class="refund-attachment"><div><strong>${esc(a.filename)}</strong><small>${esc(a.mime_type)} · ${esc(a.size_bytes)} ${t('bytes')}</small></div><div class="refund-attachment-actions">${a.supported?`${btn('attachment','downloadAttachment',`data-response="${esc(r.id)}" data-index="${i}"`)}${btn('import','importAttachment',`data-response="${esc(r.id)}" data-index="${i}"`)}`:''}</div></div>`).join('')}</section>`:''}${waiting?`<div class="refund-response-actions">${btn('acceptance','acceptance',`data-response="${esc(r.id)}"`)}${btn('feedback','feedback',`data-response="${esc(r.id)}"`)}</div>`:''}</article>`).join('')}`:''}
 ${review}${archive}${parent.status==='accepted'?`<p class="refund-notice">${t('acceptedPending')}</p>`:''}${parent.status==='closed_without_refund'?`<p class="refund-notice">${t('zeroClosed')}</p>`:''}</section>`;
}
export function documentInput(s,el){
 const kind=el.closest('[data-refund-form]')?.dataset.refundForm;
 if(el.dataset.refundDocField==='language'){s.pdfLanguage=el.value;return true;}
 if(kind==='initial'&&s.initial&&el.name){s.initial[el.name]=el.type==='checkbox'?el.checked:el.value;return true;}
 if(['review','feedback','acceptance'].includes(kind)&&s.workflowForm&&el.name){
  s.workflowForm[el.name]=el.type==='checkbox'?el.checked:el.value;return el.name==='response_id'?'render':true;
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
  const data=await cloud.request(`/api/v1/refunds/${parent}/snapshots/${snapshot}/email-preview`);
  if(h.current(s)){if(data.snapshot_id!==snapshot)throw Error('refund.revisionConflict');s.emailPreview=data;}
 }
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
  await h.write(s,'send',{digest:s.emailPreview.digest,confirmed:true});return true;
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
