import {test} from 'node:test';
import assert from 'node:assert/strict';
import {installGmailConnection} from '../gmail-connection.mjs';
test('closing a blocked Google authorization releases the pending connection and allows retry',async()=>{
 let interval=null,opened=0;const popups=[];const listeners=new Map();
 const win={open(){const popup={closed:false,location:{},close(){this.closed=true;}};popups.push(popup);opened++;return popup;},setInterval(fn){interval=fn;return 1;},clearInterval(){interval=null;},setTimeout(){return 2;},clearTimeout(){},addEventListener:(key,fn)=>listeners.set(key,fn),removeEventListener:key=>listeners.delete(key),MutationObserver:class{observe(){}disconnect(){}}};
 const doc={body:{},querySelector:()=>null};
 const cloud={active:true,document:doc,session:{session:{user:{id:'synthetic-owner'}},token:async()=> 'synthetic-token'}};
 const dispose=installGmailConnection(cloud,{document:doc,window:win,fetchFn:async()=>({ok:true,json:async()=>({data:{authorization_url:'https://accounts.google.com/o/oauth2/v2/auth?state=synthetic-state'}})})});
 const first=cloud.authorizeGmailRead();const firstRejected=assert.rejects(first,/no se completó/);await new Promise(setImmediate);
 popups[0].closed=true;interval();await firstRejected;assert.equal(interval,null);
 const second=cloud.authorizeGmailRead();const secondRejected=assert.rejects(second,/no se completó/);await new Promise(setImmediate);assert.equal(opened,2);
 popups[1].closed=true;interval();await secondRejected;dispose();
});
