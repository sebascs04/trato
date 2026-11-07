import test from 'node:test';
import assert from 'node:assert/strict';
import {priceFor,rateMinor} from '../change-proposal-assistant.mjs';

// Mirrors the API's calculate_price so the live total matches what the backend accepts.
test('live additional is rate × hours with half-up rounding to the cent',()=>{
 assert.equal(priceFor(rateMinor('50'),'3').additional_minor,15000);
 assert.equal(priceFor(rateMinor('33.33'),'1.5').additional_minor,5000);
 assert.equal(priceFor(rateMinor('1'),'0,25').additional_minor,25);
 assert.equal(priceFor(0,'2').additional_minor,0);
 assert.deepEqual(priceFor(1000,'2.5'),{additional_minor:2500,currency:'USD',rate_minor:1000,confirmed_hours:'2.5'});
});
test('invalid hours or amounts are rejected instead of guessed',()=>{
 for(const hours of ['0','0.00','-1','1.234','10000.01','abc',''])assert.throws(()=>priceFor(1000,hours));
 assert.throws(()=>priceFor(99999999999,'10000'),/INVALID_AMOUNT/);
 assert.throws(()=>priceFor(-1,'1'));
});

// The live «Adicional» field of a ready TeTrato proposal, without calling the AI or the server.
import {livePrice} from '../change-proposal-assistant.mjs';
const ready={kind:'change_proposal',status:'ready',scope_summary:'Tienda',conditions:'',description:'Tienda con 10 productos'};
test('typing rate and hours updates the additional amount at once',()=>{
 assert.equal(livePrice(ready,'50','3').amount,'150.00');
 assert.equal(livePrice(ready,'45,50','2,5').amount,'113.75');
 assert.equal(livePrice(ready,'33.33','1.5').price.additional_minor,5000);
});
test('partial or invalid input never writes an amount',()=>{
 for(const [rate,hours] of [['','3'],['50',''],['50','1.'],['abc','2'],['50','0']])assert.throws(()=>livePrice(ready,rate,hours));
 assert.throws(()=>livePrice({...ready,status:'insufficient_evidence'},'50','3'));
});
