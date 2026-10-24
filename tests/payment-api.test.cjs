const {test}=require('node:test');
const assert=require('node:assert/strict');
const {PaymentApi}=require('../payment-api.js');
const id='11111111-1111-4111-8111-111111111111';
test('payment creation sends only authorized acceptance reference, stable key and JWT',async()=>{
  const calls=[];
  const api=new PaymentApi({getAccessToken:async()=>'test-token',fetcher:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({data:{id,status:'pending_approval'}})};}});
  await api.create(id,'stable-key');
  assert.deepEqual(JSON.parse(calls[0].options.body),{acceptance_id:id});
  assert.equal(calls[0].options.headers['Idempotency-Key'],'stable-key');
  assert.equal(calls[0].options.headers.Authorization,'Bearer test-token');
  await api.notifyByEmail(id,'stable-mail-key');
  assert.deepEqual(JSON.parse(calls[1].options.body),{});
  assert.match(calls[1].url,/notifications\/email$/);
});
test('missing authentication and invalid IDs do not call backend or silently simulate',async()=>{
  let calls=0;
  const api=new PaymentApi({getAccessToken:async()=>null,fetcher:async()=>{calls++;}});
  await assert.rejects(api.get(id),error=>error.code==='UNAUTHENTICATED');
  assert.throws(()=>api.get('simulated-payment'),error=>error.code==='INVALID_ID');
  assert.equal(calls,0);
});
test('API failure is visible and does not become a successful payment',async()=>{
  const api=new PaymentApi({getAccessToken:async()=>'test-token',fetcher:async()=>({ok:false,status:503,json:async()=>({error:{code:'PAYPAL_UNAVAILABLE',message:'Proveedor no disponible'}})})});
  await assert.rejects(api.reconcile(id),error=>error.code==='PAYPAL_UNAVAILABLE'&&error.status===503);
});
