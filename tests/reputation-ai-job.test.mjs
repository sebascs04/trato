import {test} from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {AIJobClient} from '../ai-jobs.mjs';
import {reputationAnalysisChanged} from '../reputation-workspace.mjs';
// Node18 contract harness supplies the browser crypto API explicitly.
globalThis.crypto??=webcrypto;
function fixture(){
 const storage=new Map(),calls=[];
 const cloud={active:true,navigationOwner:'owner-a',session:{key:'trato-contract'},storage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)},request:async(path,options)=>{calls.push({path,options});throw Object.assign(new Error('offline'),{code:'OFFLINE'});}};
 return {cloud,calls};
}
const payload={profile_id:'client-a',output_language:'es'};
test('the original server completion time and review versions survive reopening',async()=>{
 const {cloud}=fixture();const completed='2026-11-04T02:10:20.123456+00:00';
 cloud.request=async(path,options)=>({id:options.headers['Idempotency-Key'],status:'completed',result:{kind:'reputation'},completed_at:completed,source_reviews:[{id:'review-a',version:1}]});
 const job=new AIJobClient({cloud,scope:'reputation:client-a'});await job.start('/api/v1/ai/reputation',payload);job.dispose();
 const restored=new AIJobClient({cloud,scope:'reputation:client-a'});assert.equal(restored.state.completedAt,completed);assert.deepEqual(restored.state.sourceReviews,[{id:'review-a',version:1}]);restored.dispose();
});
test('old results do not acquire a fabricated completion time',async()=>{
 const {cloud}=fixture();cloud.request=async(path,options)=>({id:options.headers['Idempotency-Key'],status:'completed',result:{kind:'reputation'}});
 const job=new AIJobClient({cloud,scope:'reputation:client-a'});await job.start('/api/v1/ai/reputation',payload);assert.equal(job.state.completedAt,null);job.dispose();
});
test('new reviews, edits and removals mark the analysis as changed without confusing pagination',()=>{
 const sources=[{id:'a',version:1},{id:'b',version:2}];
 assert.equal(reputationAnalysisChanged(sources,[{id:'a',version:1}],2),false);
 assert.equal(reputationAnalysisChanged(sources,[{id:'c',version:1}],3),true);
 assert.equal(reputationAnalysisChanged(sources,[{id:'b',version:3}],2),true);
 assert.equal(reputationAnalysisChanged(sources,[{id:'a',version:1}],1),true);
 assert.equal(reputationAnalysisChanged(null,[{id:'a',version:1}],1),false);
});
test('Reputation resumes an uncertain submission with its original UUID and language',async()=>{
 const {cloud,calls}=fixture();
 const first=new AIJobClient({cloud,scope:'reputation:client-a'});
 await first.start('/api/v1/ai/reputation',payload);
 const id=first.state.id;assert.equal(first.state.uncertain,true);first.dispose();
 const restored=new AIJobClient({cloud,scope:'reputation:client-a'});
 assert.equal(restored.state.id,id);assert.equal(calls.length,1);
 await restored.start('/api/v1/ai/reputation',{...payload,output_language:'en'});
 assert.equal(calls[1].options.headers['Idempotency-Key'],id);
 assert.deepEqual(JSON.parse(calls[1].options.body),payload);restored.dispose();
});
test('Reputation separates client and owner state and stops requests after owner changes',async()=>{
 const {cloud,calls}=fixture();
 const first=new AIJobClient({cloud,scope:'reputation:client-a'});
 await first.start('/api/v1/ai/reputation',payload);
 const other=new AIJobClient({cloud,scope:'reputation:client-b'});assert.equal(other.state.status,'idle');
 cloud.navigationOwner='owner-b';await first.start('/api/v1/ai/reputation',payload);
 assert.equal(calls.length,1);
 const nextOwner=new AIJobClient({cloud,scope:'reputation:client-a'});assert.equal(nextOwner.state.status,'idle');
 first.dispose();other.dispose();nextOwner.dispose();
});
test('A failed analysis is retried quietly twice with new jobs, then waits for an explicit retry',async()=>{
 const {cloud,calls}=fixture();
 cloud.request=async(path,options)=>{calls.push({path,options});return {id:options.headers['Idempotency-Key'],status:'failed',error_code:'AI_OUTPUT_INVALID'};};
 const delays=AIJobClient.retryDelays;AIJobClient.retryDelays=[30,250];
 const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 try{
  const job=new AIJobClient({cloud,scope:'reputation:client-a'});
  await job.start('/api/v1/ai/reputation',payload);
  const first=job.state.id;
  assert.equal(job.state.status,'queued');assert.equal(job.state.retrying,true);assert.equal(calls.length,1);
  await wait(120);
  assert.equal(calls.length,2);assert.notEqual(job.state.id,first);
  await wait(300);
  assert.equal(calls.length,3);assert.equal(job.state.status,'failed');assert.equal(job.state.retrying,false);
  await wait(300);
  assert.equal(calls.length,3);
  const last=job.state.id;
  await job.start('/api/v1/ai/reputation',payload);
  assert.notEqual(job.state.id,last);assert.equal(calls.length,4);job.dispose();
 }finally{AIJobClient.retryDelays=delays;}
});

test('A failure that a retry cannot fix is shown at once',async()=>{
 const {cloud,calls}=fixture();
 cloud.request=async(path,options)=>{calls.push({path,options});return {id:options.headers['Idempotency-Key'],status:'failed',error_code:'AI_CONTEXT_INVALID'};};
 const job=new AIJobClient({cloud,scope:'reputation:client-b'});
 await job.start('/api/v1/ai/reputation',payload);
 assert.equal(job.state.status,'failed');assert.equal(calls.length,1);job.dispose();
});
