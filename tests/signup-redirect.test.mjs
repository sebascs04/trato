import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SessionClient} from '../auth-session.mjs';
test('signup requests confirmation without a session and retains the installation return URL',async()=>{
 for(const origin of ['http://localhost:5173','https://trato-web-68896425401.us-central1.run.app']){
  let call;
  const session=new SessionClient({supabase_url:'https://example.supabase.co',publishable_key:'sb_publishable_test'},{storage:{getItem:()=>null},fetchFn:async(url,options)=>{call={url,body:JSON.parse(options.body)};return {ok:true,json:async()=>({id:'pending-confirmation'})};}});
  assert.equal(await session.signup('test@example.com','synthetic-password',origin),false);
  assert.equal(new URL(call.url).searchParams.get('redirect_to'),origin);
  assert.equal(call.body.data.output_language,'es');assert.equal(session.session,null);
 }
});


test('already registered responses show the existing-account message without creating a session',async()=>{
 for(const response of [
  {ok:true,json:async()=>({id:'obfuscated',identities:[],role:''})},
  {ok:false,json:async()=>({code:'user_already_exists'})},
  {ok:false,json:async()=>({code:'email_exists'})}
 ]){
  let calls=0;
  const session=new SessionClient({supabase_url:'https://example.supabase.co',publishable_key:'sb_publishable_test'},{storage:{getItem:()=>null},fetchFn:async()=>{calls++;return response;}});
  await assert.rejects(session.signup('existing@example.com','synthetic-password'),/Esta cuenta ya existe/);
  assert.equal(calls,1);assert.equal(session.session,null);
 }
});

test('new pending accounts continue to require email confirmation',async()=>{
 const session=new SessionClient({supabase_url:'https://example.supabase.co',publishable_key:'sb_publishable_test'},{storage:{getItem:()=>null},fetchFn:async()=>({ok:true,json:async()=>({id:'new-pending-account',identities:[{provider:'email'}]})})});
 assert.equal(await session.signup('new@example.com','synthetic-password'),false);assert.equal(session.session,null);
});
