import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SessionClient,apiRequest} from '../public/session.js';
const config = {supabase_url:'https://test.supabase.co',publishable_key:'sb_publishable_test'};
const storage = () => {const data = new Map(); return {getItem:key=>data.get(key),setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key),data};};
const payload = {access_token:'access',refresh_token:'refresh',expires_at:9999999999,user:{id:'user-a',email:'a@example.com'}};

test('password is never persisted and session survives a reload',async()=>{
  const store = storage();
  const session = new SessionClient(config,{storage:store,fetchFn:async()=>new Response(JSON.stringify(payload),{status:200})});
  await session.login('a@example.com','do-not-store-this');
  assert.doesNotMatch([...store.data.values()].join(''),/do-not-store-this/);
  assert.equal(await new SessionClient(config,{storage:store}).token(),'access');
});
test('parallel expired requests refresh only once',async()=>{
  let refreshes = 0;
  const session = new SessionClient(config,{storage:storage(),fetchFn:async()=>{refreshes++; await new Promise(resolve=>setTimeout(resolve,5));return new Response(JSON.stringify(payload),{status:200});}});
  session.save({...payload,expires_at:1});
  assert.deepEqual(await Promise.all([session.token(),session.token()]),['access','access']);
  assert.equal(refreshes,1);
});
test('API sends user session and preserves file idempotency key',async()=>{
  const session = new SessionClient(config,{storage:storage(),fetchFn:async(url,options)=>{
    assert.equal(options.headers.Authorization,'Bearer access'); assert.equal(options.headers['Idempotency-Key'],'upload-1');
    return new Response(JSON.stringify({data:{persisted:true}}),{status:201});
  }});
  session.save(payload);
  assert.deepEqual(await apiRequest(session,'http://localhost:8000','/api/v1/projects/test/documents',
    {method:'POST',headers:{'Idempotency-Key':'upload-1'},body:new Blob(['document'])}),{persisted:true});
});
test('failed refresh clears old session',async()=>{
  const store = storage();
  const session = new SessionClient(config,{storage:store,fetchFn:async()=>new Response('{}',{status:401})});
  session.save({...payload,expires_at:1});
  await assert.rejects(session.token()); assert.equal(session.session,null); assert.equal(store.data.size,0);
});
