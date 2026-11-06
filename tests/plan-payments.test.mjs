import test from 'node:test';
import assert from 'node:assert/strict';
import {installPlanPayments,stagePaymentStep,stagePaymentEmailMarkup} from '../plan-payments.mjs';
function fixture(){
 const pending=[];const node=()=>({textContent:'',className:'',setAttribute(){},addEventListener(){},classList:{add(){}},append(){},remove(){this.removed=true;}});
 const host={isConnected:true,children:[],querySelector(){return null;},append(value){this.children.push(value);}};
 const cloud={active:true,navigationOwner:'owner-a',projectId:'project-a',document:{addEventListener(){},createElement:node},reset(){},renderAgreement(){},request(path){return new Promise((resolve,reject)=>pending.push({path,resolve,reject}));}};
 installPlanPayments(cloud);return {cloud,host,pending};
}
test('plan view removes the aggregate counter while keeping stage payment hooks',async()=>{
 const {cloud,host,pending}=fixture();cloud.renderPlanPayments(host,{stages:[]});pending[0].resolve({completed_at:null,stages:[]});await new Promise(setImmediate);assert.equal(host.children[0].removed,true);
});
test('a late payment summary cannot appear after changing owner or project',async()=>{
 const {cloud,host,pending}=fixture();cloud.renderAgreement(host);cloud.navigationOwner='owner-b';cloud.projectId='project-b';pending[0].resolve({completed_at:'2026-11-06T00:00:00Z',stages:[]});await new Promise(setImmediate);assert.doesNotMatch(host.children[0].textContent,/completado/);
});

test('an unsent payment request requires email before a payment check',()=>{
 for(const mail_status of ['not_sent','failed'])assert.equal(stagePaymentStep({status:'pending_approval',order_id:'order',mail_status}),'send_email');
 assert.equal(stagePaymentStep({status:'pending_approval',order_id:'order',mail_status:'sent'}),'await_payment');
});
test('uncertain email delivery cannot offer a duplicate send',()=>{
 assert.equal(stagePaymentStep({status:'pending_approval',order_id:'order',mail_status:'uncertain'}),'check_email');
 assert.equal(stagePaymentStep({status:'pending_approval',order_id:'order',mail_status:'sending'}),'sending_email');
});
test('verified payment takes precedence over old email state; missing orders need preparation',()=>{
 assert.equal(stagePaymentStep({status:'completed',order_id:'order',mail_status:'not_sent'}),'paid');
 assert.equal(stagePaymentStep({status:'preparing',order_id:null,mail_status:'not_sent'}),'prepare_order');
 assert.throws(()=>stagePaymentStep({status:'pending_approval',order_id:'order',mail_status:'unknown'}),/Invalid payment email status/);
});

test('email preview preserves reviewed content and formats only the exact payment link',()=>{
 const link='http://localhost:5173/initial-payment.html?checkout='+('a'.repeat(43))+'&lang=es';
 const markup=stagePaymentEmailMarkup({recipient:'customer@example.com',subject:'Stage payment',body:'Delivery completed.\nUSD 180.00\nAgreed terms.\n'+link+'\nPayPal Sandbox'},link);
 assert.match(markup,/customer@example.com/);assert.match(markup,/Agreed terms\./);
 assert.match(markup,/class="plan-mail-amount">USD 180.00/);
 assert.match(markup,/class="plan-mail-cta"/);assert.match(markup,/rel="noopener noreferrer"/);
 assert.equal((markup.match(/<a /g)||[]).length,1);
});
test('email preview escapes source text and never creates an unsafe payment link',()=>{
 const markup=stagePaymentEmailMarkup({recipient:'<img src=x>',subject:'<script>alert(1)</script>',body:'<img src=x onerror=alert(1)>\njavascript:alert(1)'},'javascript:alert(1)');
 assert.doesNotMatch(markup,/<script|<img|<a /);assert.match(markup,/&lt;script&gt;/);
});
