// Durable owner/scope identifiers and explicit retries.
import {uiText} from './i18n.mjs';
const rejectedResults=new Set(['AI_NOT_FOUND','AI_CONFLICT','AI_CONTEXT_INVALID','AI_INVALID_CITATION',
 'AI_INVALID_RESPONSE','REFUND_REVISION_CONFLICT','VECTOR_SOURCE_CHANGED','FILE_SUMMARY_CHANGED']);
// Failures that a second attempt cannot fix (stale data, a request the server refused): shown at once.
const finalResults=new Set(['AI_NOT_FOUND','AI_CONFLICT','AI_CONTEXT_INVALID','REFUND_REVISION_CONFLICT','VECTOR_SOURCE_CHANGED','FILE_SUMMARY_CHANGED','AI_JOB_INVALID']);
// Everything else (the AI provider, a timeout, the network, an answer that did not pass validation) is retried
// quietly a couple of times before the person sees anything.
// One small notice for every TeTrato feature: retrying now, or the provider still failing.
export function showProviderNotice(doc,kind){
 if(!doc?.body)return;
 let box=doc.getElementById('ai-provider-notice');
 if(!kind){box?.remove();return;}
 if(!box){box=doc.createElement('div');box.id='ai-provider-notice';box.className='ai-provider-notice';box.setAttribute('role','status');box.setAttribute('aria-live','polite');doc.body.append(box);}
 box.classList.toggle('is-failed',kind==='failed');
 box.textContent=uiText(kind==='failed'?'aiProvider.failed':'aiProvider.retrying');
 if(kind==='failed'){
  const reload=doc.createElement('button');reload.type='button';reload.className='button primary ai-provider-reload';
  reload.textContent=uiText('aiProvider.reload');
  reload.addEventListener('click',()=>doc.defaultView?.location.reload());
  box.append(reload);
 }
}
export class AIJobClient {
 static retryDelays=[3000,8000];
 constructor({cloud,scope,onChange=()=>{}}){
  this.cloud=cloud;this.scope=scope;this.onChange=onChange;this.owner=cloud.navigationOwner;this.disposed=false;this.timer=null;
  this.key=`${cloud.session.key}:ai-job:${this.owner}:${scope}`;
  this.state={id:null,status:'idle',result:null,error:null,uncertain:false};
  const raw=cloud.storage.getItem(this.key);
  if(raw!==null){const record=JSON.parse(raw);if(record.version!==1||record.owner!==this.owner||!['idle','queued','running','completed','failed','unavailable'].includes(record.state?.status))throw Error('AI_JOB_INVALID');this.state=record.state;}
 }
 active(){return !this.disposed&&this.cloud.active&&this.cloud.navigationOwner===this.owner;}
 publish(){if(!this.active())return;this.cloud.storage.setItem(this.key,JSON.stringify({version:1,owner:this.owner,state:this.state}));this.onChange(this.state);}
 async start(path,payload){
  if(!this.active()||this.submitting)return;
  if(!(this.state.retrying&&this.state.uncertain)&&(['queued','running'].includes(this.state.status)||(this.state.id&&!this.state.uncertain&&this.state.status==='unavailable')))return this.check();
  this.submitting=true;
  if(!this.state.uncertain)this.state={id:crypto.randomUUID(),status:'queued',result:null,error:null,uncertain:true,path,payload:structuredClone(payload)};
  this.publish();
  try{
   const job=await this.cloud.request(this.state.path,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':this.state.id},body:JSON.stringify(this.state.payload)});
   if(!this.active())return;
   if(job.id!==this.state.id||!['queued','running','completed','failed'].includes(job.status))throw Error('AI_JOB_INVALID');
   this.state.uncertain=false;
   if(this.accept(job))return;
   if(['queued','running'].includes(this.state.status))this.timer=setTimeout(()=>this.check(),500);
  }catch(error){if(this.active()){
   const rejected=rejectedResults.has(error.code)||Number.isInteger(error.status)&&error.status>=400&&error.status<500&&error.status!==408;
   this.state.uncertain=!rejected;this.state.status=rejected?'failed':'unavailable';
   this.state.error=error.code||(error.name==='TimeoutError'?'AI_REQUEST_TIMEOUT':'AI_REQUEST_FAILED');
   if(!rejected){this.submitting=false;if(this.scheduleAutoRetry('resend'))return;}
   this.publish();
  }}
  finally{this.submitting=false;}
 }
 accept(job){
  if(!['queued','running','completed','failed'].includes(job.status))throw Error('AI_JOB_INVALID');
  this.state.status=job.status;this.state.error=null;
  if(job.status==='completed'){
   if(!job.result||typeof job.result!=='object')throw Error('AI_JOB_INVALID');
   if(job.completed_at!==undefined&&(typeof job.completed_at!=='string'||!Number.isFinite(Date.parse(job.completed_at))))throw Error('AI_JOB_INVALID');
   if(job.source_reviews!==undefined&&(!Array.isArray(job.source_reviews)||job.source_reviews.some(s=>!s||typeof s.id!=='string'||!s.id||!Number.isInteger(s.version)||s.version<1)))throw Error('AI_JOB_INVALID');
   this.state.result=job.result;this.state.completedAt=job.completed_at??null;this.state.sourceReviews=job.source_reviews??null;
  }
  if(job.status==='failed')this.state.error=job.error_code||'AI_REQUEST_FAILED';
  if(job.status==='completed'){this.state.autoRetries=0;this.state.retrying=false;showProviderNotice(this.cloud.document,null);}
  // True when a quiet retry was scheduled: the caller must not poll the failed job.
  if(job.status==='failed'&&this.scheduleAutoRetry())return true;
  this.publish();
  return false;
 }
 // A failed job is tried again with a fresh id after a short wait; meanwhile the screen keeps showing TeTrato at work.
 // mode 'new': the job failed, so a fresh job is sent. 'resend': the request may not have arrived, so the same id
 // is sent again (the server keeps one job per id). 'recheck': the job exists; its status is read again.
 scheduleAutoRetry(mode='new'){
  const attempt=this.state.autoRetries||0;
  if(finalResults.has(this.state.error)||attempt>=AIJobClient.retryDelays.length||!this.state.path||!this.state.payload){
   if(attempt>=AIJobClient.retryDelays.length&&!finalResults.has(this.state.error))showProviderNotice(this.cloud.document,'failed');
   this.state.retrying=false;
   return false;
  }
  const keep=this.state;
  this.state={...keep,status:'queued',error:null,autoRetries:attempt+1,retrying:true,uncertain:mode==='resend'};
  showProviderNotice(this.cloud.document,'retrying');
  this.publish();
  clearTimeout(this.timer);
  this.timer=setTimeout(()=>{
   if(!this.active())return;
   const {path,payload}=this.state;
   if(mode==='recheck'){this.check();return;}
   if(mode==='new')this.state={...this.state,id:crypto.randomUUID(),result:null,uncertain:true,payload:structuredClone(payload)};
   this.start(path,payload);
  },AIJobClient.retryDelays[attempt]);
  return true;
 }
 async retry(updatePayload=payload=>payload){
  const {path,payload}=this.state;
  if(!path||!payload||!this.active()||this.submitting||this.polling)return;
  if(this.state.status==='unavailable'&&!this.state.uncertain)await this.check();
  if(this.state.status==='failed')return this.start(path,updatePayload(payload));
  if(this.state.status==='unavailable'&&this.state.uncertain)return this.start(path,payload);
 }
 async check(){
  if(!this.active()||!this.state.id||this.polling)return;
  this.polling=true;clearTimeout(this.timer);
  try{
   const job=await this.cloud.request(`/api/v1/ai/jobs/${encodeURIComponent(this.state.id)}`);
   if(!this.active())return;
   if(job.id!==this.state.id)throw Error('AI_JOB_INVALID');
   this.state.uncertain=false;
   if(this.accept(job))return;
   if(['queued','running'].includes(this.state.status))this.timer=setTimeout(()=>this.check(),2000);
  }catch(error){if(this.active()){
   const rejected=rejectedResults.has(error.code);
   if(rejected)this.state.uncertain=false;
   this.state.status=rejected?'failed':'unavailable';
   this.state.error=error.code||(error.name==='TimeoutError'?'AI_REQUEST_TIMEOUT':'AI_REQUEST_FAILED');
   if(!rejected&&!this.state.uncertain&&this.state.id){this.polling=false;if(this.scheduleAutoRetry('recheck'))return;}
   this.publish();
  }}
  finally{this.polling=false;}
 }
 dispose(){this.disposed=true;clearTimeout(this.timer);}
}
