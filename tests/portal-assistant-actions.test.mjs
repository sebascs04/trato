import test from 'node:test';
import assert from 'node:assert/strict';
import {answerMessage,actionMarkup} from '../portal-assistant.mjs';

test('accept and pay answers offer the portal button, never act on their own',()=>{
 const accept=answerMessage({status:'confirm_accept',answer:'You would accept v1.',sources:['scope'],change_request:'',problem_report:''});
 assert.equal(accept.action,'accept');assert.equal(accept.draft,'');
 assert.match(actionMarkup(accept,1),/data-assistant-action="1"/);
 const pay=answerMessage({status:'confirm_pay',answer:'USD 1.00',sources:['amount'],change_request:'',problem_report:''});
 assert.equal(pay.action,'pay');
 assert.equal(actionMarkup({...pay,closed:true},2),'');
 assert.equal(actionMarkup(answerMessage({status:'answered',answer:'x',sources:['scope'],change_request:'',problem_report:''}),3),'');
});
