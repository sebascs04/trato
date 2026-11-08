import {test} from 'node:test';
import assert from 'node:assert/strict';
import {captureAuthReturn} from '../auth-return.mjs';
import {SessionClient} from '../auth-session.mjs';
import {ConnectedWorkspace} from '../connected-workspace.mjs';
const user={id:'11111111-1111-4111-8111-111111111111',email:'test@example.com',email_confirmed_at:'2026-11-04T12:00:00Z'};
const config={supabase_url:'https://example.supabase.co',publishable_key:'sb_publishable_test'};
function store(){const values=new Map();return {getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key),values};}
function capture(fragment){let clean=null;const value=captureAuthReturn({href:'http://localhost:5173/?source=test#'+fragment},{replaceState:(_a,_b,url)=>clean=url});return {value,clean};}
const fragment='access_token=synthetic-access&refresh_token=synthetic-refresh&expires_in=3600&token_type=bearer&type=signup';
test('confirmation tokens are captured once and removed from the displayed URL',()=>{
 const {value,clean}=capture(fragment);assert.equal(value.access_token,'synthetic-access');assert.equal(value.refresh_token,'synthetic-refresh');assert.equal(clean,'/?source=test#inicio');assert.doesNotMatch(clean,/synthetic|token/);
 assert.equal(captureAuthReturn({href:'http://localhost:5173/#clientes'},{replaceState(){throw Error('Normal navigation must not be rewritten');}}),null);
});
test('expired or malformed links cannot be accepted as sessions',()=>{
 assert.deepEqual(capture('error=access_denied&error_code=otp_expired&error_description=untrusted').value,{error:'expired'});
 for(const bad of [fragment+'&access_token=duplicate',fragment.replace('refresh_token=synthetic-refresh&',''),fragment.replace('expires_in=3600','expires_in=bad'),fragment.replace('type=signup','type=recovery')])assert.deepEqual(capture(bad).value,{error:'invalid'});
});
test('server verification determines identity before the session is saved',async()=>{
 const storage=store();let request;
 const client=new SessionClient(config,{storage,fetchFn:async(url,options)=>{request={url,options};assert.equal(storage.values.size,0);return {ok:true,json:async()=>user};}});
 await client.acceptAuthReturn(capture(fragment).value);
 assert.equal(request.url,config.supabase_url+'/auth/v1/user');assert.equal(client.session.user.id,user.id);assert.equal(client.session.user.email,user.email);
});
test('rejected confirmation cannot fall back to a cached account or open private API data',async()=>{
 const storage=store();let calls=0;
 const client=new SessionClient(config,{storage,fetchFn:async()=>{calls++;return {ok:false,status:401};}});
 client.save({access_token:'cached',refresh_token:'cached-refresh',expires_in:3600,user});
 await assert.rejects(client.acceptAuthReturn(capture(fragment).value),/enlace/);
 assert.equal(client.session,null);assert.equal(storage.values.size,0);assert.equal(calls,1);
});
test('workspace restoration logs in a confirmed user before requesting private workspace data',async()=>{
 const storage=store(),calls=[];
 const fetchFn=async(url,options)=>{
  const path=new URL(String(url),'http://localhost:5173').pathname;calls.push(path);
  if(path==='/api/v1/config')return {ok:true,json:async()=>({data:config})};
  if(path==='/auth/v1/user')return {ok:true,json:async()=>user};
  assert.ok(calls.includes('/auth/v1/user'));
  if(path==='/api/v1/session')return {ok:true,json:async()=>({data:{user_id:user.id,role:'freelancer'}})};
  if(path==='/api/v1/clients')return {ok:true,json:async()=>({data:[]})};
  throw Error('Unexpected request');
 };
 const cloud=new ConnectedWorkspace({document:{},location:{origin:'http://localhost:5173',hash:'#inicio'},fetchFn,storage,authReturn:capture(fragment).value});cloud.notify=()=>{};
 await cloud.restore();assert.equal(cloud.state,'ready');assert.equal(cloud.active,true);assert.equal(cloud.session.session.user.id,user.id);assert.equal(cloud.authReturn,null);
});
