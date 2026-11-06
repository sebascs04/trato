import {installCaseAssistant} from './case-assistant.mjs';
import {uiText,uiLocale,uiLanguage} from './i18n.mjs';
import {icon} from './icons.mjs';
import {renderRefundDocuments,renderInitialPayment,documentAction,documentInput,documentSubmit} from './refund-documents.mjs';
import {isFinancialAction,financialPath,financeError,renderRefundFinance,renderFinancialPending,loadRefundFinance,financialAction,financialInput,financialSubmit} from './refund-finance.mjs';
import {parseRefundMoney,refundInputMoney,percentageMinor,previewRefund,allocateRefund} from './refund-form.mjs';

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const t=(key,values)=>uiText(`refund.${key}`,values);
const money=v=>new Intl.NumberFormat(uiLocale(),{style:'currency',currency:'USD'}).format(v/100);
const date=v=>new Intl.DateTimeFormat(uiLocale(),{dateStyle:'medium',timeStyle:'short',timeZone:'America/Lima'}).format(new Date(v));
const button=(action,key,attrs='')=>`<button type="button" class="button secondary" data-refund-action="${action}" ${attrs}>${t(key)}</button>`;
const option=(value,label,selected)=>`<option value="${esc(value)}" ${value===selected?'selected':''}>${esc(label)}</option>`;
const statuses=['draft','awaiting_response','adjustments_requested','accepted','refund_pending','completed','closed_without_refund','rejected','withdrawn'];
const codes={REFUND_ALLOCATION_REQUIRED:'allocationMismatch',REFUND_ALLOCATION_MISMATCH:'allocationMismatch',REFUND_PAYMENTS_CHANGED:'paymentsChanged',REFUND_PAYMENTS_REVIEW_REQUIRED:'reviewRequired',REFUND_PAYMENT_CONTEXT_MISMATCH:'paymentUnavailable',REFUND_INITIAL_REFERENCE_REQUIRED:'initialReference',REFUND_PAYER_MISMATCH:'payerMismatch',REFUND_PDF_REQUIRED:'pdfRequired',REFUND_REVIEW_REQUIRED:'pdfRequired',REFUND_PDF_LANGUAGE_LOCKED:'pdfLanguageLocked',REFUND_PDF_HASH_MISMATCH:'pdfHashMismatch',REFUND_SEND_REQUIRED:'sendRequired',EMAIL_PREVIEW_CHANGED:'emailChanged',EMAIL_DELIVERY_UNCERTAIN:'emailUncertain',GMAIL_SENDER_CHANGED:'emailChanged',GMAIL_NOT_CONNECTED:'gmailRequired',GMAIL_READ_PERMISSION_REQUIRED:'gmailRequired',GMAIL_READ_NOT_AUTHORIZED:'gmailRequired',GMAIL_SEND_FAILED:'gmailFailed',GMAIL_READ_FAILED:'gmailFailed',INVALID_REFUND_AMOUNT:'invalidMoney',REFUND_DUPLICATE_CONCEPT:'duplicateConcept',REFUND_AMOUNT_OVERFLOW:'invalidMoney',REFUND_PERCENTAGE_MISMATCH:'invalidRate',REFUND_EVIDENCE_REQUIRED:'evidenceRequired',INVALID_IDEMPOTENCY_KEY:'invalidForm',REFUND_EVIDENCE_MISMATCH:'evidenceMismatch',REFUND_REVISION_CONFLICT:'revisionConflict',REFUND_SETTLEMENT_READ_ONLY:'readOnly',REFUND_PAYMENT_NOT_ELIGIBLE:'paymentUnavailable',PAYMENT_NOT_FOUND:'paymentUnavailable',REFUND_NOT_FOUND:'notFound',REFUND_SNAPSHOT_NOT_FOUND:'notFound',PROJECT_HAS_OPEN_REQUEST:'openRequest',REFUND_PROPOSAL_AMOUNT_MISMATCH:'amountMismatch',REFUND_EXCEEDS_AVAILABLE:'exceeds',REFUND_PRIOR_SETTLEMENT_CONFLICT:'priorConflict',IDEMPOTENCY_KEY_CONFLICT:'keyConflict',INVALID_REQUEST:'invalidForm',INVALID_REFUND_INPUT:'invalidForm'};
function message(error){
 if(error?.message?.startsWith('refundFinance.')||error?.code&&/^(REFUND_(FINANCIAL|RECOVERY|REPLAY|RECONCILIATION|REFERENCE|EXECUTION|PREVIOUS_OPERATION|RECEIPT|CAPTURE)|PAYPAL_)/.test(error.code))return financeError(error);
 if(error?.code&&codes[error.code])return t(codes[error.code]);
 if(typeof error?.message==='string'&&/^refund\./.test(error.message))return uiText(error.message);
 return t('apiError');
}
const emptyItem=()=>({concept_id:crypto.randomUUID(),kind:'recognized_work',beneficiary:'seller',description:'',amount:'',mode:'fixed',base:'',rate:'',evidence:[]});
function editItem(item){return {...item,amount:refundInputMoney(item.amount_minor),mode:item.percentage?'percent':'fixed',base:item.percentage?refundInputMoney(item.percentage.base_minor):'',rate:item.percentage?refundInputMoney(item.percentage.basis_points):'',evidence:item.evidence.map(c=>({...c}))};}
export function buildRefundTerms(editor,payment){
 if(!payment)throw Error('refund.paymentUnavailable');
 const adjustments=editor.items.map(item=>{
  const percentage=item.mode==='percent'?percentageMinor(item.base,item.rate):null;
  if(!item.description.trim()||!item.evidence.length)throw Error('refund.evidenceRequired');
  return {concept_id:item.concept_id,kind:item.kind,beneficiary:item.beneficiary,description:item.description.trim(),
   amount_minor:percentage?percentage.amount_minor:parseRefundMoney(item.amount),
   percentage:percentage?{base_minor:percentage.base_minor,basis_points:percentage.basis_points}:null,
   evidence:item.evidence.map(c=>({...c}))};
 });
 if(!editor.conditions.trim())throw Error('refund.conditionsRequired');
 const result=previewRefund(payment.amount_minor,payment.local_previous_refunds_minor,adjustments);
 const allocations=payment.scope==='project_closure'?allocateRefund(result.refund_minor,payment.members):null;
 if(allocations&&(allocations.length!==payment.members.length||new Set(allocations.map(a=>a.payment_id)).size!==payment.members.length||allocations.some(a=>!payment.members.some(p=>p.id===a.payment_id&&a.refund_minor<=p.amount_minor-p.local_previous_refunds_minor))||allocations.reduce((sum,a)=>sum+a.refund_minor,0)!==result.refund_minor))throw Error('refund.allocationMismatch');
 return {terms:{currency:'USD',adjustments,conditions:editor.conditions.trim(),proposed_refund_minor:result.refund_minor,...(allocations?{allocations}:{})},result};
}

export function installRefundWorkspace(cloud){
 installCaseAssistant(cloud);
 const originalReset=cloud.reset.bind(cloud);
 const wizard=cloud.document.createElement('dialog');wizard.className='refund-dialog';wizard.setAttribute('aria-label',t('wizard.title'));cloud.document.body.append(wizard);
 const releaseReader=s=>{if(s?.reader?.url)URL.revokeObjectURL(s.reader.url);if(s)s.reader=null;};
 cloud.reset=function(){releaseReader(this.refundState);wizard.close();this.refundState=null;originalReset();};
 wizard.addEventListener('cancel',event=>{event.preventDefault();const s=cloud.refundState;if(s&&!s.busy){s.wizardOpen=false;s.financeForm=null;if(s.editor)s.editor.reviewed=false;wizard.close();notify(s);}});
 function uploadContext(s){
  const parent=s.detail?.settlement;
  const payment=parent?.payment_id||s.request?.payment_id||(s.request?.scope==='project_closure'?[...s.payments].sort((a,b)=>a.id.localeCompare(b.id))[0]?.id:null);
  return {purpose:parent?'refund_evidence':'refund_request',...(parent?.id?{refund_case_id:parent.id}:{}),
   ...(s.snapshot?.id&&parent?{snapshot_id:s.snapshot.id}:{}),...(payment?{payment_id:payment}:{})};
 }
 let uploadModal=null;
 function bindUploadModal(){
  if(uploadModal===cloud.modal)return;
  uploadModal=cloud.modal;
  uploadModal.addEventListener('close',()=>{setTimeout(()=>{const s=cloud.refundState;if(s?.resumeAfterUpload&&current(s)&&!cloud.modal.open){s.resumeAfterUpload=false;s.wizardOpen=true;notify(s);}},0);});
 }
 const identity=()=>cloud.session?.session?.user?.id;
 function state(){
  const context=identity()+':'+cloud.projectId;
  if(cloud.refundState?.context!==context){releaseReader(cloud.refundState);wizard.close();}
  if(cloud.refundState?.context!==context){
   const s={wizardOpen:false,step:null,reader:null,context,project:cloud.projectId,owner:identity(),loaded:false,loading:false,busy:false,error:'',items:[],payments:[],status:null,view:'list',pdfLanguage:uiLanguage(),documentData:null,workflowForm:null,emailPreview:null,financeData:null,financeCheck:null,financeForm:null,financeError:'',financeNotice:'',notice:'',detail:null,snapshot:null,editor:null,request:null,pick:null,pending:null,pendingBody:null};
   cloud.refundState=s;
   try{s.pending=JSON.parse(cloud.storage.getItem(storageKey(s))||'null');if(s.pending&&(!/^[a-z0-9-]{1,128}$/i.test(s.pending.key)||!['create','edit_draft','close','initial','pdf','review','send','feedback','acceptance'].includes(s.pending.action)&&!isFinancialAction(s.pending.action)))throw Error();if(isFinancialAction(s.pending?.action))s.pendingBody=s.pending.body||null;}
   catch{s.storageError=true;s.error=t('storageError');}
  }
  return cloud.refundState;
 }
 const storageKey=s=>`trato:refund-operation:${s.owner}:${s.project}`;
 const current=s=>cloud.refundState===s&&cloud.active&&identity()===s.owner&&cloud.projectId===s.project;
 const notify=s=>{if(current(s))cloud.notify();};
 function clearPending(s){cloud.storage.removeItem(storageKey(s));s.pending=null;s.pendingBody=null;}
 async function run(s,fn){
  if(s.busy||!current(s))return;
  s.busy=true;s.error='';s.notice='';notify(s);
  try{await fn();}catch(error){if(current(s))s.error=message(error);}
  finally{if(current(s)){s.busy=false;notify(s);}}
 }
 async function load(s){
  if(s.loading)return;s.loading=true;s.error='';
  try{
   const [items,payments,status]=await Promise.all([cloud.request(`/api/v1/projects/${s.project}/refunds`),cloud.request(`/api/v1/projects/${s.project}/refund-payments`),cloud.request(`/api/v1/projects/${s.project}/request-status`)]);
   if(!current(s))return;
   if(!Array.isArray(items)||items.some(x=>x.project_id!==s.project||!statuses.includes(x.status))||!Array.isArray(payments)||typeof status?.can_register!=='boolean')throw Error();
   s.items=items;s.payments=payments;s.status=status;s.loaded=true;cloud.requestStatus=status;
  }catch(error){if(current(s))s.error=message(error);}
  finally{if(current(s)){s.loading=false;notify(s);}}
 }
 async function openDetail(s,id,snapshotId){
  const detail=await cloud.request(`/api/v1/refunds/${id}`);
  if(!current(s))return;
  if(detail.settlement?.id!==id||detail.settlement.project_id!==s.project)throw Error();
  const selected=snapshotId||detail.settlement.current_snapshot_id;
  const data=selected?await cloud.request(`/api/v1/refunds/${id}/snapshots/${selected}`):null;
  if(!current(s))return;
  if(data&&(data.settlement?.id!==id||data.settlement.project_id!==s.project||data.snapshot?.settlement_id!==id||data.snapshot.id!==selected))throw Error();
  if(s.detail?.settlement.id!==id||s.snapshot?.id!==selected){s.financeData=null;s.financeCheck=null;}
  s.financeForm=null;s.financeNotice='';
  s.detail=detail;s.snapshot=data?.snapshot||null;s.documentData=data;s.workflowForm=null;s.emailPreview=null;s.editor=null;s.closure=null;s.pick=null;s.view='detail';s.wizardOpen=true;s.step=null;
  await loadRefundFinance(s,cloud,{current});
 }
 function payment(s){
  const parent=s.detail?.settlement;
  if(parent?.scope!=='project_closure')return s.payments.find(p=>p.id===parent?.payment_id);
  const ids=s.detail.payments.map(p=>p.payment_id),members=s.payments.filter(p=>ids.includes(p.id));
  if(members.length!==ids.length)return null;
  return {scope:'project_closure',members,amount_minor:members.reduce((n,p)=>n+p.amount_minor,0),local_previous_refunds_minor:members.reduce((n,p)=>n+p.local_previous_refunds_minor,0)};
 }
 function editable(s){return ['draft','adjustments_requested'].includes(s.detail?.settlement.status)&&(!s.snapshot||s.snapshot.id===s.detail.settlement.current_snapshot_id);}
 async function acceptResult(s,result){
  if(!current(s))return;
  if(s.pending?.action==='initial'){if(result?.project_id!==s.project||!result.payment?.id)throw Error();clearPending(s);s.initial=null;s.pick=null;s.view='list';await load(s);return;}
  if(!result?.settlement?.id||result.settlement.project_id!==s.project||s.pending?.settlementId&&result.settlement.id!==s.pending.settlementId)throw Error();
  if(s.pending?.action==='edit_draft'&&!result.snapshot)throw Error();
  const financial=isFinancialAction(s.pending?.action),reviewRequired=result.application_recorded===false;
  clearPending(s);
  s.items=[result.settlement,...s.items.filter(x=>x.id!==result.settlement.id)];
  s.editor=null;s.request=null;s.pick=null;
  await openDetail(s,result.settlement.id);await load(s);
  if(financial&&current(s)){s.financeNotice=uiText(reviewRequired?'refundFinance.reviewNeeded':'refundFinance.recorded');cloud.historyLoaded=false;}
 }
 async function write(s,action,body,metadata={}){
  if(s.storageError)throw Error('refund.storageError');
  if(s.pending)throw Error('refund.uncertain');
  const pending={...metadata,...(isFinancialAction(action)?{body:structuredClone(body)}:{}),key:crypto.randomUUID(),action,settlementId:body.settlement_id||(['create','initial'].includes(action)?null:s.detail?.settlement.id),...(['pdf','send','review','feedback','acceptance'].includes(action)?{snapshotId:s.snapshot?.id}:{})};
  try{cloud.storage.setItem(storageKey(s),JSON.stringify(pending));}catch{throw Error('refund.storageError');}
  s.pending=pending;s.pendingBody=structuredClone(body);
  await sendPending(s);
 }
 async function sendPending(s){
  const pending=s.pending,body=s.pendingBody;
  if(!pending||!body)throw Error('refund.uncertain');
  const suffix={close:'close',edit_draft:'draft',review:'review',feedback:'feedback',acceptance:'acceptance'};
  const path=isFinancialAction(pending.action)?financialPath(pending):pending.action==='create'?`/api/v1/projects/${s.project}/refunds`:pending.action==='initial'?`/api/v1/projects/${s.project}/initial-payments`:['pdf','send'].includes(pending.action)?`/api/v1/refunds/${pending.settlementId}/snapshots/${pending.snapshotId}/${pending.action==='pdf'?'pdf':'email'}`:`/api/v1/refunds/${pending.settlementId}/${suffix[pending.action]}`;
  let result;
  try{result=await cloud.request(path,{...cloud.json(body),headers:{'Content-Type':'application/json','Idempotency-Key':pending.key}});}
  catch(error){
   if(current(s)&&error.status>=400&&error.status<500&&![408,429].includes(error.status)&&!['IDEMPOTENCY_KEY_CONFLICT','EMAIL_DELIVERY_UNCERTAIN'].includes(error.code))clearPending(s);
   throw error;
  }
  if(current(s))await acceptResult(s,result);
 }
 async function queryPending(s){
  if(!s.pending)return;
  const data=await cloud.request(`/api/v1/projects/${s.project}/refund-operations/${encodeURIComponent(s.pending.key)}`);
  if(!current(s))return;
  if(data?.state==='confirmed')await acceptResult(s,data.result);
  else if(data?.state==='unconfirmed')s.error=t('unconfirmed');else throw Error();
 }
 async function chooseDocument(s,id){
  const pick=s.pick;if(!pick)return;
  pick.data=null;pick.quote='';pick.docid=id;
  if(!id)return;
  const data=await cloud.request(`/api/v1/documents/${id}/extraction`);
  if(!current(s)||s.pick!==pick||pick.docid!==id)return;
  if(data.document?.id!==id||data.document.project_id!==s.project||data.extraction?.status!=='ready'||!data.extraction.id||!data.document.sha256||!Array.isArray(data.segments))throw Error('refund.evidenceMismatch');
  pick.data=data;pick.segment=0;pick.quote=data.segments[0]?.text.slice(0,4000)||'';
 }
 function percentAmount(item){try{return money(percentageMinor(item.base,item.rate).amount_minor);}catch{return t('invalidRate');}}
 function evidenceHtml(refs,target,readOnly=false){
  return `<ul class="refund-evidence">${refs.map((c,i)=>`<li><blockquote>${esc(c.quote)}</blockquote>${button('download','original',`data-document="${esc(c.document_id)}"`)}${readOnly?'':button('remove-evidence','remove',`data-target="${esc(target)}" data-index="${i}"`)}</li>`).join('')}</ul>${readOnly?'':button('pick','addEvidence',`data-target="${esc(target)}"`)}`;
 }
 function picker(s){
  if(!s.pick)return '';
  const p=s.pick,docs=cloud.documents.filter(d=>cloud.sourceReady(d)),segments=p.data?.segments||[];
  return `<section class="refund-source-picker" aria-label="${t('sourcePicker')}"><h4>${t('sourcePicker')}</h4><label>${t('document')}<select data-refund-field="document"><option value="">${t('chooseDocument')}</option>${docs.map(d=>option(d.id,d.title,p.docid)).join('')}</select></label>${p.data?`<label>${t('segment')}<select data-refund-field="segment">${segments.map((seg,i)=>option(String(i),t('segmentNumber',{number:seg.locator_number}),String(p.segment))).join('')}</select></label><pre class="refund-source-text">${esc(segments[p.segment]?.text)}</pre><label>${t('quote')}<textarea data-refund-field="quote" maxlength="4000" rows="3">${esc(p.quote)}</textarea></label>${button('use-quote','useQuote')}`:''}${docs.length?'':`<p>${t('noSources')}</p><button type="button" class="button secondary" data-cloud-action="tab" data-cloud-tab="documentos">${t('goDocuments')}</button>`}<button type="button" class="button secondary" data-cloud-action="upload" data-cloud-purpose="reference">${t('addReference')}</button>${button('cancel-pick','cancel')}</section>`;
 }
 function preview(s){
  if(!s.editor)return '';
  try{
   const {result,terms}=buildRefundTerms(s.editor,payment(s));
   return `<strong>${t('proposed')}: ${money(result.refund_minor)}</strong>${terms.allocations?`<details><summary>${t('allocation')}</summary><p>${t('allocationHelp')}</p><ul>${terms.allocations.map(a=>`<li>${allocationLabel(s,a)} · <strong>${money(a.refund_minor)}</strong></li>`).join('')}</ul></details>`:''}${result.additional_payment_due_minor?`<p>${t('separateDue')}: ${money(result.additional_payment_due_minor)}</p>`:''}`;
  }catch(error){return `<p>${message(error)}</p>`;}
 }
 function allocationLabel(s,a){
  const member=payment(s)?.members.find(p=>p.id===a.payment_id);
  return member?t('allocationPayment',{id:a.payment_id.slice(0,8),origin:t('origin.'+member.origin),amount:money(member.amount_minor)}):t('paymentUnavailable');
 }
 function editorHtml(s){
  const e=s.editor;
  if(!e)return '';
  return `<form data-refund-form="draft"><h3>${t('editProposal')}</h3><p>${t('deductionsHelp')}</p>${e.items.map((x,i)=>`<fieldset class="refund-concept" data-concept="${x.concept_id}"><legend>${t('conceptNumber',{number:i+1})}</legend><div class="refund-grid"><label>${t('kind')}<select data-refund-item="${x.concept_id}" name="kind">${['recognized_work','expense','penalty','other'].map(k=>option(k,t('kind.'+k),x.kind)).join('')}</select></label><label>${t('beneficiary')}<select data-refund-item="${x.concept_id}" name="beneficiary">${['seller','customer'].map(k=>option(k,t('beneficiary.'+k),x.beneficiary)).join('')}</select></label></div><label>${t('description')}<input data-refund-item="${x.concept_id}" name="description" value="${esc(x.description)}" maxlength="4000" required></label><label>${t('method')}<select data-refund-item="${x.concept_id}" name="mode">${['fixed','percent'].map(k=>option(k,t(k),x.mode)).join('')}</select></label>${x.mode==='fixed'?`<label>${t('amount')}<input data-refund-item="${x.concept_id}" name="amount" inputmode="decimal" value="${esc(x.amount)}" required></label>`:`<div class="refund-grid"><label>${t('base')}<input data-refund-item="${x.concept_id}" name="base" inputmode="decimal" value="${esc(x.base)}" required></label><label>${t('rate')}<input data-refund-item="${x.concept_id}" name="rate" inputmode="decimal" value="${esc(x.rate)}" required></label></div><p>${t('rounding')}</p><output data-refund-item-total="${x.concept_id}">${percentAmount(x)}</output>`}${evidenceHtml(x.evidence,x.concept_id)}${button('remove-concept','removeConcept',`data-id="${x.concept_id}"`)}</fieldset>`).join('')}${button('add-concept','addConcept')}<label>${t('conditions')}<textarea name="conditions" maxlength="4000" required>${esc(e.conditions)}</textarea></label><output data-refund-preview aria-live="polite">${preview(s)}</output><label class="refund-checkbox"><input name="reviewed" type="checkbox" required ${e.reviewed?'checked':''}>${t('reviewed')}</label><button class="button" type="submit" ${s.pending||!payment(s)?'disabled':''}>${t('wizard.saveContinue')}</button>${button('cancel-edit','cancel')}</form>`;
 }
 function requestHtml(s){
  const r=s.request;if(!r)return '';
  return `<form data-refund-form="create"><h3>${t('register')}</h3><label>${t('scope')}<select name="scope">${['payment_only','project_closure'].map(k=>option(k,t('scope.'+k),r.scope)).join('')}</select></label>${r.scope==='project_closure'?`<ul>${s.payments.map(p=>`<li>${t(p.origin==='initial'?'origin.initial':'origin.change')} · ${money(p.amount_minor)}</li>`).join('')}</ul><label class="refund-checkbox"><input name="payments_reviewed" type="checkbox" ${r.payments_reviewed?'checked':''} required>${t('allPaymentsReviewed')}</label>`:`<label>${t('payment')}<select name="payment_id" required><option value="">${t('choosePayment')}</option>${s.payments.map(p=>option(p.id,`${money(p.amount_minor)} · ${date(p.updated_at)} · ${p.id.slice(0,8)}`,r.payment_id)).join('')}</select></label>`}<label>${t('reason')}<textarea name="reason" maxlength="4000" required>${esc(r.reason)}</textarea></label><label>${t('requestedBy')}<select name="requested_by">${['customer','seller','mutual'].map(k=>option(k,t('requestedBy.'+k),r.requested_by)).join('')}</select></label>${evidenceHtml(r.evidence,'request')}<button class="button" type="submit" ${s.pending||s.status?.can_register!==true?'disabled':''}>${t('register')}</button>${button('cancel-create','cancel')}</form>`;
 }
 function activeStep(s){
  if(s.view==='create'||s.view==='initial')return 1;
  const status=s.detail?.settlement.status;
  if(['completed','closed_without_refund','rejected','withdrawn','refund_pending'].includes(status))return 6;
  if(status==='accepted')return s.financeData?.authorizations?.some(a=>a.snapshot_id===s.snapshot?.id)?6:5;
  if(status==='awaiting_response')return 4;
  return s.snapshot&&!s.editor&&status!=='adjustments_requested'?3:2;
 }
 function wizardHeader(s){
  const step=s.step||activeStep(s),project=cloud.projects.find(p=>p.id===s.project);
  return `<header class="refund-wizard-header"><div><span class="eyebrow">${t('wizard.progress',{step})}</span><h2 tabindex="-1">${t('wizard.title')}</h2><p>${esc(project?.name||'')} ${s.detail?`· ${t('status.'+s.detail.settlement.status)}`:''}</p></div><button type="button" data-refund-action="wizard-close" aria-label="${t('wizard.close')}" title="${t('wizard.close')}">${icon('x')}</button></header><nav class="refund-wizard-steps" aria-label="${t('wizard.stages')}">${[1,2,3,4,5,6].map(i=>`<button type="button" data-refund-action="wizard-step" data-step="${i}" ${i>activeStep(s)||s.editor||s.pending||s.view!=='detail'?'disabled':''} ${step===i?'aria-current="step"':''}><span>${i}</span>${t('wizard.step'+i)}</button>`).join('')}</nav><p class="refund-wizard-help">${t('wizard.help'+step)}</p>${s.snapshot?`<div class="refund-wizard-total">${t('wizard.customerReceives')} <strong>${money(s.snapshot.breakdown.refund_minor)}</strong></div>`:''}`;
 }
 async function previewDocument(s,id){
  const blob=await cloud.request(`/api/v1/documents/${id}/file`,{},true);if(!current(s))return;
  releaseReader(s);s.reader={url:URL.createObjectURL(blob),pdf:blob.type.split(';')[0]==='application/pdf'};
 }
 function detailHtml(s){
  const parent=s.detail?.settlement;if(!parent)return '';
  const snap=s.snapshot,p=payment(s);
  const step=s.step||activeStep(s),terminal=['completed','closed_without_refund','rejected','withdrawn'].includes(parent.status);
  const saved=snap?`<h3>${t('snapshotTitle',{version:snap.version_no,sequence:snap.draft_sequence})}</h3><ul>${snap.terms.adjustments.map(x=>`<li><strong>${esc(x.description)}</strong> · ${money(x.amount_minor)}<details><summary>${t('addEvidence')}</summary>${evidenceHtml(x.evidence,x.concept_id,true)}</details></li>`).join('')}</ul><p class="refund-preserved">${esc(snap.terms.conditions)}</p>`:`<p>${t('noProposal')}</p>`;
  const history=`<details><summary>${t('history')}</summary><ul class="refund-history">${s.detail.snapshots.map(x=>`<li><button type="button" class="button secondary" data-refund-action="snapshot" data-id="${x.id}" ${s.editor?'disabled':''}>${t('snapshotTitle',{version:x.version_no,sequence:x.draft_sequence})}</button> ${date(x.created_at)}</li>`).join('')}</ul></details>`;
  let content='';
  if(step===1)content=`<h3>${esc(parent.reason)}</h3><p>${t('scope.'+parent.scope)}</p>${p?`<p>${t('gross')}: ${money(p.amount_minor)}</p>`:''}${evidenceHtml(parent.request_evidence||[],'request',true)}${button('wizard-step','wizard.next',`data-step="2"`)}`;
  if(step===2)content=`${s.editor?editorHtml(s):`${saved}${editable(s)?button('edit','editProposal'):''}${snap?button('wizard-step','wizard.next',`data-step="3"`):''}`}${history}`;
  if(step===3||step===4)content=renderRefundDocuments(s,cloud,evidenceHtml,step);
  if(step===3&&activeStep(s)>=4&&s.documentData?.deliveries?.some(d=>d.status==='accepted_by_gmail'))content+=`<div class="refund-response-actions"><button type="button" class="button" data-refund-action="wizard-step" data-step="4">${t('wizard.toReply')}</button></div>`;
  if(step===4)content+=`${activeStep(s)<5?`<p>${t('wizard.acceptFirst')}</p>`:''}<div class="refund-response-actions"><button type="button" class="button" data-refund-action="wizard-step" data-step="${snap?.breakdown.refund_minor===0?6:5}" ${activeStep(s)<5?'disabled':''}>${t('wizard.toAuthorize')}</button></div>`;
  if(step===5||step===6)content=`${terminal?`<p class="refund-result" role="status">${t('status.'+parent.status)}</p>`:''}${renderRefundFinance(s,step)}${!s.financeData?`<p>${t('status.'+parent.status)}</p>`:''}<details><summary>${t('wizard.proposalDetails')}</summary>${saved}${history}${renderRefundDocuments(s,cloud,evidenceHtml,6)}</details>`;
  if(step===5&&s.financeData?.authorizations.some(a=>a.snapshot_id===s.snapshot?.id))content+=`<div class="refund-response-actions"><button type="button" class="button" data-refund-action="wizard-step" data-step="6">${t('wizard.toExecute')}</button></div>`;
  const close=parent.status==='draft'&&!s.editor?`<details class="refund-other-actions"><summary>${t('wizard.otherActions')}</summary><h4>${t('close')}</h4><form data-refund-form="close"><label>${t('closureReason')}<select name="reason">${['withdrawn','rejected'].map(k=>option(k,t('status.'+k),s.closure?.reason||'withdrawn')).join('')}</select></label><label>${t('notes')}<textarea name="notes" maxlength="4000" required>${esc(s.closure?.notes||'')}</textarea></label><label class="refund-checkbox"><input type="checkbox" name="confirmed" required>${t('closeConfirm')}</label><button class="button" type="submit">${t('confirmClose')}</button></form></details>`:'';
  return `<section class="refund-stage">${content}</section>${close}`;
 }
 async function action(s,a,target){
  if(a==='wizard-close'){s.wizardOpen=false;s.financeForm=null;s.emailPreview=null;if(s.workflowForm)s.workflowForm.confirmed=false;if(s.editor)s.editor.reviewed=false;releaseReader(s);wizard.close();return;}
  if(a==='wizard-resume'){s.wizardOpen=true;return;}
  if(a==='wizard-step'){const step=Number(target.dataset.step);if(!s.editor&&step>=1&&step<=activeStep(s)){s.step=step;s.financeForm=null;s.workflowForm=null;s.emailPreview=null;s.pick=null;releaseReader(s);}return;}
  if(a==='reader-close'){releaseReader(s);return;}

  if(a==='reload'){await load(s);if(current(s)&&s.view==='detail'&&s.detail&&!s.pending)await openDetail(s,s.detail.settlement.id);return;}
  if(a==='query'){await queryPending(s);return;}
  if(a==='reconcile-send'){
   const op=s.pending;const data=await cloud.request(`/api/v1/refunds/${op.settlementId}/snapshots/${op.snapshotId}/email/reconcile`,{method:'POST',headers:{'Idempotency-Key':op.key}});
   if(current(s)){if(data.state==='confirmed')await acceptResult(s,data.result);else s.error=uiText('refundDoc.uncertain');}return;
  }
  if(a==='retry-operation'){if(isFinancialAction(s.pending?.action))return;await sendPending(s);return;}
  if(await financialAction(s,cloud,a,target,{current,write,resend:sendPending,openDetail}))return;
  if(await documentAction(s,cloud,a,target,{write,openDetail,load,current,acceptResult,preview:id=>previewDocument(s,id),upload:()=>{s.resumeAfterUpload=true;wizard.close();cloud.openSource('reference',uploadContext(s));}}))return;
  if(a==='download'){await previewDocument(s,target.dataset.document);return;}
  if(a==='new'){if(s.status?.can_register!==true||s.pending||s.storageError)return;s.request={scope:'payment_only',payments_reviewed:false,payment_id:'',reason:'',requested_by:'customer',evidence:[]};s.view='create';s.wizardOpen=true;s.step=null;}
  if(a==='open'){if(s.detail?.settlement.id===target.dataset.id&&s.editor)s.wizardOpen=true;else await openDetail(s,target.dataset.id);}
  if(a==='list'){s.view='list';s.pick=null;s.wizardOpen=false;}
  if(a==='cancel-create'){s.request=null;s.pick=null;s.view='list';s.wizardOpen=false;}
  if(a==='edit'&&editable(s)&&!s.pending){s.step=2;s.editor={items:(s.snapshot?.terms.adjustments||[]).map(editItem),conditions:s.snapshot?.terms.conditions||'',reviewed:false};}
  if(a==='cancel-edit'){s.editor=null;s.pick=null;s.step=null;}
  if(a==='add-concept'&&s.editor&&s.editor.items.length<100){s.editor.items.push(emptyItem());s.editor.reviewed=false;}
  if(a==='remove-concept'&&s.editor){s.editor.items=s.editor.items.filter(x=>x.concept_id!==target.dataset.id);s.editor.reviewed=false;}
  if(a==='snapshot'){await openDetail(s,s.detail.settlement.id,target.dataset.id);if(current(s))s.step=3;}
  if(a==='pick')s.pick={target:target.dataset.target,docid:'',data:null,segment:0,quote:''};
  if(a==='cancel-pick')s.pick=null;
  if(a==='remove-evidence'){
   const refs=target.dataset.target==='request'?s.request?.evidence:target.dataset.target==='initial'?s.initial?.evidence:target.dataset.target==='workflow'?s.workflowForm?.evidence:s.editor?.items.find(x=>x.concept_id===target.dataset.target)?.evidence;
   refs?.splice(Number(target.dataset.index),1);if(s.editor)s.editor.reviewed=false;
  }
  if(a==='use-quote'){
   const pick=s.pick,quote=pick?.quote.trim(),data=pick?.data,segment=data?.segments[pick.segment];
   if(!quote||quote.length>4000||!segment?.text.includes(quote))throw Error('refund.evidenceMismatch');
   const citation={document_id:data.document.id,extraction_id:data.extraction.id,document_sha256:data.document.sha256,quote};
   const refs=pick.target==='request'?s.request?.evidence:pick.target==='initial'?s.initial?.evidence:pick.target==='workflow'?s.workflowForm?.evidence:s.editor?.items.find(x=>x.concept_id===pick.target)?.evidence;
   if(!refs||refs.length>=20)throw Error('refund.invalidForm');refs.push(citation);s.pick=null;if(s.editor)s.editor.reviewed=false;
  }
 }
 cloud.renderRefunds=function(panel){
  bindUploadModal();
  const s=state(),host=panel;wizard.setAttribute('aria-label',t('wizard.title'));
  if(s.resumeAfterUpload){host.innerHTML=`<p>${t('wizard.uploading')}</p>`;return;}
  if(s.wizardOpen){
   host.innerHTML=`<section class="workspace-panel"><h3>${t('title')}</h3><p>${t('wizard.inProgress')}</p>${button('wizard-resume','wizard.resume')}</section>`;
   host.onclick=()=>{if(!wizard.open)wizard.showModal();};
   panel=wizard;
  }else if(wizard.open)wizard.close();
  if(!s.loaded&&!s.loading&&!s.error)void load(s);
  const oldFocus=cloud.document.activeElement;const focusState=panel.contains(oldFocus)?{tag:oldFocus.tagName,name:oldFocus.name,data:{...oldFocus.dataset},start:oldFocus.selectionStart,end:oldFocus.selectionEnd}:null;
  panel.innerHTML=`<section class="workspace-panel cloud-refunds refund-workspace" aria-label="${t('title')}"><header><span class="eyebrow">${t('realRecords')}</span><h3>${icon('undo-2')} ${t('title')}</h3><p>${t('intro')}</p></header>${s.notice?`<p role="status">${esc(s.notice)}</p>`:''}${s.error?`<p role="alert" class="cloud-error">${esc(s.error)}</p>${button('reload',s.editor?'reloadDiscard':'retry')}`:''}${s.storageError?`<p role="alert">${t('storageError')}</p>`:''}${s.pending?`<aside class="refund-notice" role="status"><p>${t('uncertain')}</p>${button('query','query')}${s.pending.action==='send'?button('reconcile-send','reconcileSend'):''}${isFinancialAction(s.pending.action)?renderFinancialPending(s):s.pendingBody?button('retry-operation','retrySame'):''}</aside>`:''}${s.loading||s.busy?`<p role="status" aria-busy="true">${t('loading')}</p>`:''}<fieldset class="refund-body" ${s.busy||s.loading||s.pending||s.storageError?'disabled':''}>${s.loaded?((s.view==='list'||!s.wizardOpen)?`<p class="refund-notice">${t('unverified')}</p>${s.status?.can_register===false?`<p>${t('openRequest')}</p>`:''}${s.payments.length?'':`<p>${t('noPayments')}</p>`}${s.status?.can_register===true&&!s.pending?`<button type="button" class="button secondary" data-refund-action="doc-initial">${uiText('refundDoc.initial')}</button>`:''}${s.view!=='list'?button('wizard-resume','wizard.resume'):''}${button('new','register',s.status?.can_register!==true||!s.payments.length||s.pending||s.storageError?'disabled':'')}<ul class="refund-list">${s.items.map(x=>`<li><strong>${esc(x.reason)}</strong><small>${t('scope.'+x.scope)}</small><span>${t('status.'+x.status)}</span>${button('open','wizard.resume',`data-id="${x.id}"`)}</li>`).join('')}</ul>${s.items.length?'':`<p>${t('empty')}</p>`}${button('reload','refresh')}`:s.view==='create'?requestHtml(s):s.view==='initial'?renderInitialPayment(s,evidenceHtml):detailHtml(s)):''}${picker(s)}</fieldset>${s.wizardOpen?'':`<section class="refund-simulation"><h4>${t('simulation')}</h4><p>${t('simulationHelp')}</p><button type="button" class="button secondary" data-cloud-action="refund-preview">${uiText('Probar flujo de devolución')}</button></section>`}</section>`;
  if(s.wizardOpen){
   panel.querySelector('header').outerHTML=wizardHeader(s);
   if(s.pick)panel.querySelector('.refund-body').innerHTML=picker(s);
   if(s.reader)panel.querySelector('.refund-body').innerHTML=`<section class="refund-reader">${button('reader-close','wizard.backToForm')}<a class="button secondary" href="${esc(s.reader.url)}" download="document.pdf">${t('wizard.download')}</a>${s.reader.pdf?`<iframe title="${t('original')}" src="${esc(s.reader.url)}"></iframe>`:''}</section>`;
   panel.insertAdjacentHTML('beforeend',`<footer class="refund-wizard-footer"><p>${t('wizard.keepHelp')}</p>${button('wizard-close','wizard.close')}</footer>`);
   if(!wizard.open)wizard.showModal();
   if(focusState){const match=[...panel.querySelectorAll('button,input,select,textarea')].find(el=>el.tagName===focusState.tag&&el.name===focusState.name&&Object.entries(focusState.data).every(([k,v])=>el.dataset[k]===v));if(match&&!match.disabled){match.focus();if(typeof focusState.start==='number'&&match.setSelectionRange&&['text','search','url','tel','password','textarea'].includes(match.type))match.setSelectionRange(focusState.start,focusState.end);}else panel.querySelector('h2')?.focus();}
  }
  panel.onclick=event=>{
   const upload=event.target.closest('[data-cloud-action="upload"], [data-cloud-action="tab"]');
   if(upload&&s.wizardOpen){event.preventDefault();event.stopPropagation();s.resumeAfterUpload=true;wizard.close();cloud.openSource('reference',uploadContext(s));return;}
   const target=event.target.closest('[data-refund-action]');if(!target||target.disabled||s.busy)return;event.preventDefault();void run(s,()=>action(s,target.dataset.refundAction,target));};
  panel.oninput=event=>{
   const el=event.target;
   if(financialInput(s,el))return;
   const docChange=documentInput(s,el);if(docChange){if(docChange==='render')notify(s);return;}
   if(el.dataset.refundField==='quote'&&s.pick){s.pick.quote=el.value;return;}
   const kind=el.closest('[data-refund-form]')?.dataset.refundForm;
   if(kind==='create'&&s.request&&el.name){s.request[el.name]=el.type==='checkbox'?el.checked:el.value;if(el.name==='scope')notify(s);}
   if(kind==='close'&&el.name){s.closure={...(s.closure||{}),[el.name]:el.value};}
   if(kind==='draft'&&s.editor){

    const item=el.dataset.refundItem?s.editor.items.find(x=>x.concept_id===el.dataset.refundItem):null;
    if(item)item[el.name]=el.value;else if(el.name==='conditions')s.editor.conditions=el.value;
    s.editor.reviewed=el.name==='reviewed'?el.checked:false;
    const check=panel.querySelector('[name="reviewed"]');if(check)check.checked=s.editor.reviewed;
    if(el.name==='mode'){notify(s);return;}
    if(item?.mode==='percent'){const total=panel.querySelector(`[data-refund-item-total="${item.concept_id}"]`);if(total)total.textContent=percentAmount(item);}
    const output=panel.querySelector('[data-refund-preview]');if(output)output.innerHTML=preview(s);
   }
  };
  panel.onchange=event=>{
   const el=event.target;
   if(el.dataset.refundField==='document')void run(s,()=>chooseDocument(s,el.value));
   if(el.dataset.refundField==='segment'&&s.pick){s.pick.segment=Number(el.value);s.pick.quote=s.pick.data?.segments[s.pick.segment]?.text.slice(0,4000)||'';notify(s);}
  };
  panel.onsubmit=event=>{
   const form=event.target;if(!form.dataset.refundForm)return;event.preventDefault();event.stopPropagation();
   if(s.busy||s.pending&&form.dataset.refundForm!=='finance-resume')return;
   void run(s,async()=>{
    if(await financialSubmit(s,cloud,form,{write,resend:sendPending}))return;
    if(await documentSubmit(s,cloud,form,{write}))return;
    if(form.dataset.refundForm==='create'){
     const r=s.request;if(s.status?.can_register!==true||(r.scope==='payment_only'&&!s.payments.some(p=>p.id===r.payment_id))||!r.evidence.length||!r.reason.trim())throw Error('refund.evidenceRequired');
     await write(s,'create',{...(r.scope==='payment_only'?{payment_id:r.payment_id}:{payment_ids:s.payments.map(p=>p.id),payments_reviewed:r.payments_reviewed}),scope:r.scope,reason:r.reason.trim(),requested_by:r.requested_by,request_evidence:r.evidence});
    }else if(form.dataset.refundForm==='draft'){
     if(!editable(s)||!s.editor?.reviewed)throw Error('refund.reviewRequired');
     const {terms}=buildRefundTerms(s.editor,payment(s));
     await write(s,'edit_draft',{expected_snapshot_id:s.detail.settlement.current_snapshot_id,terms});
    }else if(form.dataset.refundForm==='close'){
     const values=new FormData(form);if(!values.get('confirmed'))throw Error('refund.reviewRequired');
     await write(s,'close',{reason:values.get('reason'),notes:values.get('notes').trim()});
    }
   });
  };
 };
}
