import {test} from 'node:test';
import assert from 'node:assert/strict';
import {installGmailConnection} from '../gmail-connection.mjs';
test('closing a blocked Google authorization releases the pending connection and allows retry',async()=>{
 let interval=null,opened=0;const popups=[];const listeners=new Map();
 const win={open(){const popup={closed:false,location:{},close(){this.closed=true;}};popups.push(popup);opened++;return popup;},setInterval(fn){interval=fn;return 1;},clearInterval(){interval=null;},setTimeout(){return 2;},clearTimeout(){},addEventListener:(key,fn)=>listeners.set(key,fn),removeEventListener:key=>listeners.delete(key),MutationObserver:class{observe(){}disconnect(){}}};
 const doc={body:{},querySelector:()=>null};
 const cloud={active:true,document:doc,session:{session:{user:{id:'synthetic-owner'}},token:async()=> 'synthetic-token'}};
 const dispose=installGmailConnection(cloud,{document:doc,window:win,fetchFn:async path=>({ok:true,json:async()=>({data:path.endsWith('/connect')?{authorization_url:'https://accounts.google.com/o/oauth2/v2/auth?state=synthetic-state'}:{delivery_mode:'trato',can_manage_connection:true}})})});
 await cloud.refreshGmailStatus();
 const first=cloud.authorizeGmailRead();const firstRejected=assert.rejects(first,/no se completó/);await new Promise(setImmediate);
 popups[0].closed=true;interval();await firstRejected;assert.equal(interval,null);
 const second=cloud.authorizeGmailRead();const secondRejected=assert.rejects(second,/no se completó/);await new Promise(setImmediate);assert.equal(opened,2);
 popups[1].closed=true;interval();await secondRejected;dispose();
});

for(const scenario of ['unknown','ordinary','truthy','changed-user','stale-response']){
 test(`Gmail management rejects ${scenario} without opening Google`,async()=>{
  let opened=0,finish;
  const doc={body:{},querySelector:()=>null};
  const win={open(){opened++;},addEventListener(){},removeEventListener(){},MutationObserver:class{observe(){}disconnect(){}}};
  const cloud={active:true,document:doc,session:{session:{user:{id:'owner',user_metadata:{admin:true}}},token:async()=> 'token'}};
  const dispose=installGmailConnection(cloud,{document:doc,window:win,fetchFn:async()=>{
   if(scenario==='stale-response')await new Promise(resolve=>{finish=resolve;});
   return {ok:true,json:async()=>({data:{delivery_mode:'trato',can_manage_connection:scenario==='ordinary'?false:scenario==='truthy'?'true':true}})};
  }});
  if(scenario==='stale-response'){
   const pending=cloud.refreshGmailStatus();const rejected=assert.rejects(pending);
   await new Promise(setImmediate);cloud.session.session.user.id='other';finish();await rejected;
  }else if(scenario!=='unknown')await cloud.refreshGmailStatus();
  if(scenario==='changed-user')cloud.session.session.user.id='other';
  await assert.rejects(cloud.authorizeGmailRead());assert.equal(opened,0);dispose();
 });
}
