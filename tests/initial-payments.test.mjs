import test from 'node:test';
import assert from 'node:assert/strict';
import {initialAmount,initialLabel,installInitialPayments} from '../initial-payments.mjs';
import {uiText} from '../i18n.mjs';
test('reviewed decimal amounts preserve cents and reject coercion, zero or excess precision',()=>{
 for(const [text,minor] of [['0.01',1],['450',45000],['1200.30',120030],['999999999.99',99999999999]])assert.equal(initialAmount(text),minor);
 for(const value of ['0','-1','1.234','1e3','Infinity','1,50','1000000000',1,null])assert.throws(()=>initialAmount(value));
});
test('only verified completion is presented as money received',()=>{
 assert.equal(initialLabel('completed'),uiText('initialPayment.paid'));
 for(const status of ['approved','pending','reconciliation_required','cancelled','failed'])assert.equal(initialLabel(status),uiText('initialPayment.pending'));
});
function fixture(){
 const handlers={};const document={addEventListener:(name,fn)=>handlers[name]=fn,createElement:()=>({dataset:{},querySelectorAll:()=>[],innerHTML:'',remove(){this.parent.children=this.parent.children.filter(x=>x!==this);}})};
 const host={isConnected:true,children:[],append(node){node.parent=this;this.children.push(node);},querySelector(){return this.children[0];}};
 const pending=[];let calls=0;
 const cloud={document,session:{},active:true,navigationOwner:'owner-1',projectId:'project-1',renderAgreement(){},request(path){calls++;return new Promise((resolve,reject)=>pending.push({path,resolve,reject}));}};
 installInitialPayments(cloud);return {cloud,host,handlers,pending,calls:()=>calls};
}
test('owner/project switching discards stale payment data and permits a fresh load when returning',async()=>{
 const f=fixture();f.cloud.renderInitialPayment(f.host);assert.equal(f.calls(),1);
 f.cloud.navigationOwner='owner-2';f.cloud.projectId='project-2';f.cloud.renderInitialPayment(f.host);assert.equal(f.calls(),2);
 f.pending[0].resolve({amount_minor:99999,conditions:'Owner one private terms',status:'completed'});await new Promise(resolve=>setImmediate(resolve));
 assert(!f.host.children[0].innerHTML.includes('Owner one private terms'));
 f.pending[1].resolve(null);await new Promise(resolve=>setImmediate(resolve));
 f.cloud.navigationOwner='owner-1';f.cloud.projectId='project-1';f.cloud.renderInitialPayment(f.host);assert.equal(f.calls(),3);
});
test('failed reads stay visible and never produce an empty successful payment state',async()=>{
 const f=fixture();f.cloud.renderInitialPayment(f.host);f.pending[0].reject({code:'PERSISTENCE_UNAVAILABLE'});await new Promise(resolve=>setImmediate(resolve));
 const html=f.host.children[0].innerHTML;assert(html.includes('PERSISTENCE_UNAVAILABLE'));assert(html.includes('data-initial-action="reload"'));assert(!html.includes('data-initial-action="review"'));
});
