// Durable owner/scope identifiers and explicit retries.
const rejectedResults=new Set(['AI_NOT_FOUND','AI_CONFLICT','AI_CONTEXT_INVALID','AI_INVALID_CITATION',
 'AI_INVALID_RESPONSE','REFUND_REVISION_CONFLICT','VECTOR_SOURCE_CHANGED','FILE_SUMMARY_CHANGED']);
export class AIJobClient {
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
  if(['queued','running'].includes(this.state.status)||(this.state.id&&!this.state.uncertain&&this.state.status==='unavailable'))return this.check();
  this.submitting=true;
  if(!this.state.uncertain)this.state={id:crypto.randomUUID(),status:'queued',result:null,error:null,uncertain:true,path,payload:structuredClone(payload)};
  this.publish();
  try{
   const job=await this.cloud.request(this.state.path,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':this.state.id},body:JSON.stringify(this.state.payload)});
   if(!this.active())return;
   if(job.id!==this.state.id||!['queued','running','completed','failed'].includes(job.status))throw Error('AI_JOB_INVALID');
   this.state.uncertain=false;this.accept(job);
   if(['queued','running'].includes(this.state.status))this.timer=setTimeout(()=>this.check(),500);
  }catch(error){if(this.active()){
   const rejected=rejectedResults.has(error.code)||Number.isInteger(error.status)&&error.status>=400&&error.status<500&&error.status!==408;
   this.state.uncertain=!rejected;this.state.status=rejected?'failed':'unavailable';
   this.state.error=error.code||(error.name==='TimeoutError'?'AI_REQUEST_TIMEOUT':'AI_REQUEST_FAILED');this.publish();
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
  this.publish();
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
   this.state.uncertain=false;this.accept(job);
   if(['queued','running'].includes(this.state.status))this.timer=setTimeout(()=>this.check(),2000);
  }catch(error){if(this.active()){
   const rejected=rejectedResults.has(error.code);
   if(rejected)this.state.uncertain=false;
   this.state.status=rejected?'failed':'unavailable';
   this.state.error=error.code||(error.name==='TimeoutError'?'AI_REQUEST_TIMEOUT':'AI_REQUEST_FAILED');this.publish();
  }}
  finally{this.polling=false;}
 }
 dispose(){this.disposed=true;clearTimeout(this.timer);}
}
