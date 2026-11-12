import {test} from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {AIJobClient,showProviderNotice} from '../ai-jobs.mjs';
// Node18 contract harness supplies the browser crypto API explicitly.
globalThis.crypto??=webcrypto;
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
// Just enough of a document for the shared provider notice.
function fakeDocument(){
 const nodes=new Map();
 const body={append(el){nodes.set(el.id,el);el.remove=()=>nodes.delete(el.id);}};
 const reloads=[];
 return {nodes,body,reloads,defaultView:{location:{reload:()=>reloads.push(1)}},getElementById:id=>nodes.get(id)??null,createElement(){
  const classes=new Set();
  return {id:'',className:'',textContent:'',children:[],listeners:{},append(child){this.children.push(child);},addEventListener(type,fn){this.listeners[type]=fn;},attrs:{},setAttribute(k,v){this.attrs[k]=v;},classList:{toggle:(c,on)=>on?classes.add(c):classes.delete(c),contains:c=>classes.has(c)}};
 }};
}
function fixture(respond){
 const storage=new Map(),calls=[],document=fakeDocument();
 const cloud={active:true,navigationOwner:'owner-a',session:{key:'trato-retry'},document,
  storage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)},
  request:async(path,options={})=>{calls.push({path,key:options.headers?.['Idempotency-Key']??null});return respond(path,options,calls.length);}};
 return {cloud,calls,document};
}
const payload={question:'What is left to pay?',output_language:'en'};
async function withDelays(delays,run){const old=AIJobClient.retryDelays;AIJobClient.retryDelays=delays;try{await run();}finally{AIJobClient.retryDelays=old;}}
const notice=document=>document.nodes.get('ai-provider-notice');
const failed=code=>(path,options)=>({id:options.headers['Idempotency-Key'],status:'failed',error_code:code});

test('a failed job is retried quietly and its answer arrives with the notice gone',()=>withDelays([20,20],async()=>{
 const {cloud,calls,document}=fixture((path,options,n)=>n===1?failed('AI_PROVIDER_UNAVAILABLE')(path,options):{id:options.headers['Idempotency-Key'],status:'completed',result:{answer:'USD 120 left'}});
 const states=[];
 const job=new AIJobClient({cloud,scope:'assistant:p1',onChange:s=>states.push(s.status)});
 await job.start('/api/v1/ai/project-questions',payload);
 assert.equal(job.state.status,'queued');assert.ok(notice(document));assert.equal(notice(document).classList.contains('is-failed'),false);
 await wait(80);
 assert.equal(job.state.status,'completed');assert.deepEqual(job.state.result,{answer:'USD 120 left'});
 assert.equal(calls.length,2);assert.notEqual(calls[0].key,calls[1].key);
 assert.equal(notice(document),undefined);assert.equal(job.state.retrying,false);
 assert.equal(states.includes('failed'),false,'the person never sees a failed state');job.dispose();
}));

test('a memory conflict between two questions is retried, not shown',()=>withDelays([20,20],async()=>{
 const {cloud,calls}=fixture((path,options,n)=>n===1?failed('AI_MEMORY_CONFLICT')(path,options):{id:options.headers['Idempotency-Key'],status:'completed',result:{answer:'ok'}});
 const job=new AIJobClient({cloud,scope:'assistant:p2'});
 await job.start('/api/v1/ai/project-questions',payload);await wait(80);
 assert.equal(job.state.status,'completed');assert.equal(calls.length,2);job.dispose();
}));

test('a request lost on the network is sent again with the same id, so no duplicate job is created',()=>withDelays([20,20],async()=>{
 const {cloud,calls}=fixture((path,options,n)=>{if(n===1)throw new TypeError('Failed to fetch');return {id:options.headers['Idempotency-Key'],status:'completed',result:{answer:'ok'}};});
 const job=new AIJobClient({cloud,scope:'assistant:p3'});
 await job.start('/api/v1/ai/project-questions',payload);
 assert.equal(job.state.status,'queued');
 await wait(80);
 assert.equal(job.state.status,'completed');assert.equal(calls.length,2);assert.equal(calls[0].key,calls[1].key);job.dispose();
}));

test('a status read that fails is read again for the same job',()=>withDelays([20,20],async()=>{
 const {cloud,calls}=fixture((path,options,n)=>{
  if(path.startsWith('/api/v1/ai/jobs/')){if(n===2)throw new TypeError('Failed to fetch');return {id:decodeURIComponent(path.split('/').pop()),status:'completed',result:{answer:'ok'}};}
  return {id:options.headers['Idempotency-Key'],status:'queued'};});
 const job=new AIJobClient({cloud,scope:'assistant:p4'});
 await job.start('/api/v1/ai/project-questions',payload);
 const id=job.state.id;
 await job.check();
 assert.equal(job.state.status,'queued');assert.equal(job.state.id,id);
 await wait(80);
 assert.equal(job.state.status,'completed');assert.equal(job.state.id,id);
 assert.equal(calls.filter(c=>c.path==='/api/v1/ai/project-questions').length,1);job.dispose();
}));

test('when the provider keeps failing the notice asks to reload, and retries stop',()=>withDelays([20,20],async()=>{
 const {cloud,calls,document}=fixture(failed('AI_PROVIDER_UNAVAILABLE'));
 const job=new AIJobClient({cloud,scope:'assistant:p5'});
 await job.start('/api/v1/ai/project-questions',payload);await wait(120);
 assert.equal(job.state.status,'failed');assert.equal(calls.length,3);
 assert.ok(notice(document).classList.contains('is-failed'));assert.ok(notice(document).textContent.length>20);
 await wait(80);assert.equal(calls.length,3);job.dispose();
}));

test('a closed screen does not keep retrying',()=>withDelays([20,20],async()=>{
 const {cloud,calls}=fixture(failed('AI_PROVIDER_UNAVAILABLE'));
 const job=new AIJobClient({cloud,scope:'assistant:p6'});
 await job.start('/api/v1/ai/project-questions',payload);job.dispose();await wait(80);
 assert.equal(calls.length,1);
}));

test('an owner change during the wait stops the retry',()=>withDelays([20,20],async()=>{
 const {cloud,calls}=fixture(failed('AI_PROVIDER_UNAVAILABLE'));
 const job=new AIJobClient({cloud,scope:'assistant:p7'});
 await job.start('/api/v1/ai/project-questions',payload);cloud.navigationOwner='owner-b';await wait(80);
 assert.equal(calls.length,1);job.dispose();
}));

test('a refused request (4xx) is shown at once without retries',()=>withDelays([20,20],async()=>{
 const {cloud,calls,document}=fixture(()=>{const e=new Error('bad');e.status=422;e.code='AI_CONTEXT_INVALID';throw e;});
 const job=new AIJobClient({cloud,scope:'assistant:p8'});
 await job.start('/api/v1/ai/project-questions',payload);await wait(60);
 assert.equal(job.state.status,'failed');assert.equal(calls.length,1);assert.equal(notice(document),undefined);job.dispose();
}));

test('after the quiet retries, an explicit retry starts over',()=>withDelays([20,20],async()=>{
 let ok=false;
 const {cloud,calls}=fixture((path,options)=>ok?{id:options.headers['Idempotency-Key'],status:'completed',result:{answer:'ok'}}:failed('AI_PROVIDER_UNAVAILABLE')(path,options));
 const job=new AIJobClient({cloud,scope:'assistant:p9'});
 await job.start('/api/v1/ai/project-questions',payload);await wait(120);
 assert.equal(job.state.status,'failed');ok=true;
 await job.retry();
 assert.equal(job.state.status,'completed');assert.equal(calls.length,4);job.dispose();
}));

test('the notice helper adds, switches and removes one shared element',()=>{
 const document=fakeDocument();
 showProviderNotice(document,'retrying');const box=notice(document);
 assert.equal(box.attrs.role,'status');assert.equal(box.classList.contains('is-failed'),false);
 assert.equal(box.children.length,0,'no reload button while retrying');
 showProviderNotice(document,'failed');assert.equal(notice(document),box);assert.ok(box.classList.contains('is-failed'));
 assert.equal(box.children.length,1);assert.equal(box.children[0].type,'button');
 box.children[0].listeners.click();assert.equal(document.reloads.length,1,'the button reloads the page');
 showProviderNotice(document,null);assert.equal(notice(document),undefined);
 showProviderNotice(null,'retrying');
});
