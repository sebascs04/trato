import assert from 'node:assert/strict';
import test from 'node:test';
import {AIJobClient} from '../ai-jobs.mjs';
import {webcrypto} from 'node:crypto';
// Node18 contract harness supplies the browser crypto API explicitly.
globalThis.crypto??=webcrypto;
// These cases cover the explicit retry, after the quiet automatic ones (tests/ai-job-auto-retry.test.mjs) are spent.
AIJobClient.retryDelays=[];

const question={question:'Mi cliente pidió una devolución',refund_focus:{task:'intake',step:1}};
function setup(respond){
 const requests=[];
 const cloud={active:true,navigationOwner:'owner',session:{key:'test'},storage:{getItem:()=>null,setItem(){}},
  async request(path,options){
   requests.push({path,options});
   return respond(path,options,requests.length);
  }};
 return {job:new AIJobClient({cloud,scope:'refund'}),requests};
}

test('retry keeps the text and focus and uses a new key after a rejected answer',async()=>{
 const {job,requests}=setup((path,options,n)=>{
  if(n===1)throw Object.assign(Error('rejected'),{code:'AI_INVALID_RESPONSE',status:502});
  return {id:options.headers['Idempotency-Key'],status:'failed',error_code:'MODEL_QUOTA_EXCEEDED'};
 });
 await job.start('/question',question);
 assert.equal(job.state.status,'failed');
 await job.retry();
 assert.equal(requests[0].options.body,requests[1].options.body);
 assert.notEqual(requests[0].options.headers['Idempotency-Key'],requests[1].options.headers['Idempotency-Key']);
});

test('an uncertain submission keeps its key until the original attempt is resolved',async()=>{
 const {job,requests}=setup((path,options,n)=>{
  if(n===1)throw Object.assign(Error('unavailable'),{code:'PERSISTENCE_UNAVAILABLE',status:503});
  return {id:options.headers['Idempotency-Key'],status:'failed'};
 });
 await job.start('/question',question);
 assert.equal(job.state.status,'unavailable');
 await job.retry();
 assert.equal(requests[0].options.headers['Idempotency-Key'],requests[1].options.headers['Idempotency-Key']);
});


test('one retry checks an unavailable job and resends if its failure is confirmed',async()=>{
 const {job,requests}=setup((path,options,n)=>{
  if(n===1)return {id:options.headers['Idempotency-Key'],status:'queued'};
  if(n===2)throw Object.assign(Error('unavailable'),{code:'PERSISTENCE_UNAVAILABLE',status:503});
  if(n===3)return {id:path.split('/').at(-1),status:'failed'};
  return {id:options.headers['Idempotency-Key'],status:'failed'};
 });
 await job.start('/question',question);
 await job.check();
 assert.equal(job.state.status,'unavailable');
 await job.retry();
 assert.equal(requests[0].options.body,requests[3].options.body);
 assert.notEqual(requests[0].options.headers['Idempotency-Key'],requests[3].options.headers['Idempotency-Key']);
});
