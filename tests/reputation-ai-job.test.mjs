import {test} from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {AIJobClient} from '../ai-jobs.mjs';
// Node18 contract harness supplies the browser crypto API explicitly.
globalThis.crypto??=webcrypto;
function fixture(){
 const storage=new Map(),calls=[];
 const cloud={active:true,navigationOwner:'owner-a',session:{key:'trato-contract'},storage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)},request:async(path,options)=>{calls.push({path,options});throw Object.assign(new Error('offline'),{code:'OFFLINE'});}};
 return {cloud,calls};
}
const payload={profile_id:'client-a',output_language:'es'};
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
test('A confirmed failed analysis starts a new job only on explicit retry',async()=>{
 const {cloud,calls}=fixture();
 cloud.request=async(path,options)=>{calls.push({path,options});return {id:options.headers['Idempotency-Key'],status:'failed',error_code:'AI_OUTPUT_INVALID'};};
 const job=new AIJobClient({cloud,scope:'reputation:client-a'});
 await job.start('/api/v1/ai/reputation',payload);
 const id=job.state.id;assert.equal(job.state.status,'failed');assert.equal(calls.length,1);
 await job.start('/api/v1/ai/reputation',payload);
 assert.notEqual(job.state.id,id);assert.equal(calls.length,2);job.dispose();
});
