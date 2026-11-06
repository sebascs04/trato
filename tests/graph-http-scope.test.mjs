import test from 'node:test';
import assert from 'node:assert/strict';
import {createProjectGraphReader} from '../graph-live.mjs';
const project='a3000000-0000-4000-8000-000000000001',id='a3000000-0000-4000-8000-000000000002';
const options=[{scope:'plan',id:project,key:'project_start_plans:'+project,title:''},{scope:'change',id,key:'documents:'+id,title:'Pedido'}];
const payload=(kind='all',request_id=null)=>({nodes:[{entity_key:'projects:'+project,kind:'Project',source_id:project,owner_id:'owner',project_id:project,generation:3}],edges:[],scopes:options,scope:{kind,request_id},generation:3});
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
test('each selection performs its exact HTTP read, including returning to all; no sync write',async()=>{
 const calls=[];const reader=createProjectGraphReader({projectId:project,request:async url=>{calls.push(url);return url.includes('scope=plan')?payload('plan'):url.includes('scope=change')?payload('change',id):payload();}});
 for(const option of [{scope:'all'},options[0],options[1],{scope:'all'},options[0]]){
  const result=await reader.read(option,3);assert.deepEqual(result.scopes,options);
 }
 const base='/api/v1/projects/'+project+'/graph';
 assert.deepEqual(calls,[base,base+'?scope=plan',base+'?scope=change&request_id='+id,base,base+'?scope=plan']);
});
test('late responses and late failures cannot overwrite a newer scope',async()=>{
 for(const fail of [false,true]){
  const old=defer();let count=0;
  const reader=createProjectGraphReader({projectId:project,request:()=>++count===1?old.promise:Promise.resolve(payload('change',id))});
  const first=reader.read(options[0],3),second=reader.read(options[1],3);
  assert.equal((await second).scope.kind,'change');
  if(fail)old.reject(Error('old failure'));else old.resolve(payload('plan'));
  assert.equal(await first,null);
 }
});
test('refresh, disposal and navigation invalidate pending reads',async()=>{
 const pending=defer();let current=true;
 const reader=createProjectGraphReader({projectId:project,request:()=>pending.promise,isCurrent:()=>current});
 const first=reader.read();reader.invalidate();pending.resolve(payload());assert.equal(await first,null);
 current=false;assert.equal(await reader.read(),null);
});
test('wrong scope, stale generation, cross-project nodes and foreign edges are errors',async()=>{
 const bad=[payload('all'),{...payload('plan'),generation:4},{...payload('plan'),scopes:[]},
 {...payload('plan'),nodes:[...payload().nodes,{entity_key:'foreign',owner_id:'other',project_id:'other',generation:3}]},
 {...payload('plan'),edges:[{source:'projects:'+project,target:'foreign',owner_id:'owner',project_id:project}]}];
 for(const result of bad){
  const reader=createProjectGraphReader({projectId:project,request:async()=>result});
  await assert.rejects(reader.read(options[0],3));
 }
});
test('a scope read error is visible and never replaced by the complete graph',async()=>{
 let calls=0;const reader=createProjectGraphReader({projectId:project,request:async()=>{calls++;throw Error('GRAPH_SCOPE_NOT_FOUND');}});
 await assert.rejects(reader.read(options[0],3),/GRAPH_SCOPE_NOT_FOUND/);assert.equal(calls,1);
});
