import test from 'node:test';
import assert from 'node:assert/strict';
import {paypalOrderId,sdkUrl,mountPayPalButtons} from '../paypal-buttons.mjs';

test('the order id comes from our API or from PayPal Sandbox approval links only',()=>{
 assert.equal(paypalOrderId('5O190127TN364715T'),'5O190127TN364715T');
 assert.equal(paypalOrderId('https://www.sandbox.paypal.com/checkoutnow?token=5O190127TN364715T'),'5O190127TN364715T');
 for(const bad of [null,'','abc','https://evil.example/checkoutnow?token=5O190127TN364715T','https://www.sandbox.paypal.com/invoice/p/#INV2-AAAA'])assert.equal(paypalOrderId(bad),null);
});

test('the SDK address is built only for a Sandbox client id in USD',()=>{
 const url=new URL(sdkUrl({client_id:'A'.repeat(80),currency:'USD',environment:'sandbox'}));
 assert.equal(url.origin+url.pathname,'https://www.paypal.com/sdk/js');
 assert.equal(url.searchParams.get('client-id'),'A'.repeat(80));
 assert.equal(url.searchParams.get('intent'),'capture');
 for(const bad of [null,{client_id:'A'.repeat(80),currency:'USD',environment:'live'},{client_id:'x"><script>',currency:'USD',environment:'sandbox'},{client_id:'A'.repeat(80),currency:'EUR',environment:'sandbox'}])assert.equal(sdkUrl(bad),null);
});

test('without the SDK the page keeps its own link',async()=>{
 const doc={defaultView:{fetch:async()=>({ok:false})},createElement(){throw new Error('no script');},head:{append(){}}};
 assert.equal(await mountPayPalButtons({doc,host:{isConnected:true},order:async()=>null,approved:()=>{}}),false);
 assert.equal(await mountPayPalButtons({doc,host:null,order:async()=>null,approved:()=>{}}),false);
});
