import {webcrypto} from 'node:crypto';
globalThis.crypto=webcrypto;
import test from 'node:test';
import assert from 'node:assert/strict';
import {canDecide,closedResult,refundedByDispute} from '../portal-view.mjs';

test('the client always gets a result message once a dispute closes, whatever PayPal reports',()=>{
 for(const outcome of ['RESOLVED_BUYER_FAVOUR','RESOLVED_SELLER_FAVOUR','CANCELED_BY_BUYER','RESOLVED_WITH_PAYOUT','ACCEPTED','DENIED','SOMETHING_NEW',null]){
  const html=closedResult({status:'RESOLVED',outcome,amount:{value:'120.00',currency:'USD'}});
  assert.match(html,/portal-dispute-result/,String(outcome));
  assert.doesNotMatch(html,/undefined|resultNote/,String(outcome));
 }
 assert.match(closedResult({status:'RESOLVED',outcome:'RESOLVED_SELLER_FAVOUR',amount:{value:'120.00',currency:'USD'}}),/120/);
 assert.equal(closedResult({status:'UNDER_REVIEW'}),'','an open dispute has no result yet');
 assert.doesNotMatch(closedResult({status:'RESOLVED',outcome:'DENIED'}),/undefined/,'a missing amount never breaks the message');
});

test('only a dispute closed for the client counts as refunded',()=>{
 for(const outcome of ['RESOLVED_BUYER_FAVOUR','ACCEPTED'])assert.equal(refundedByDispute({status:'RESOLVED',outcome}),true,outcome);
 for(const outcome of ['RESOLVED_SELLER_FAVOUR','CANCELED_BY_BUYER','DENIED','RESOLVED_WITH_PAYOUT',null])assert.equal(refundedByDispute({status:'RESOLVED',outcome}),false,String(outcome));
 assert.equal(refundedByDispute({status:'UNDER_REVIEW',outcome:'RESOLVED_BUYER_FAVOUR'}),false);
 assert.equal(refundedByDispute(null),false);
});

test('after asking for changes the client waits for the new version',()=>{
 assert.equal(canDecide(false,{change_request:null}),true);
 assert.equal(canDecide(false,{change_request:{notes:'Move the date'}}),false);
 assert.equal(canDecide(true,{change_request:null}),false);
});
