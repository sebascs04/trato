import {test} from 'node:test';
import assert from 'node:assert/strict';
import {financeEligible,latestAttempt,renderRefundFinance,financialSubmit,loadRefundFinance} from '../refund-finance.mjs';
const parent={id:'parent',owner_id:'owner',project_id:'project',current_snapshot_id:'snapshot',status:'refund_pending'};
const data=()=>({settlement:{...parent},operations:[{id:'operation',settlement_id:'parent',payment_id:'payment',amount_minor:15000,status:'uncertain'}],attempts:[{id:'old',operation_id:'operation',attempt_no:1,status:'failed',created_at:'2099-01-01',amount_minor:15000},{id:'new',operation_id:'operation',attempt_no:2,status:'uncertain',amount_minor:15000,dispatched_at:new Date(Date.now()-45*86400000).toISOString()}],authorizations:[],applications:[],receipts:[],incidents:[],runs:[],confirmed_minor:0,reserved_minor:15000});
const state=()=>({owner:'owner',project:'project',detail:{settlement:{...parent}},snapshot:{id:'snapshot',breakdown:{refund_minor:15000}},items:[],payments:[{id:'payment',origin:'change',amount_minor:30000}],financeData:data()});
test('zero and archived snapshots have no financial action panel; logical sequence selects the latest attempt',()=>{
 const s=state();assert.equal(latestAttempt(s.financeData,'operation').id,'new');assert.ok(financeEligible(s));s.snapshot.id='archive';assert.equal(renderRefundFinance(s),'');s.snapshot.id='snapshot';s.snapshot.breakdown.refund_minor=0;assert.equal(renderRefundFinance(s),'');
});
test('expired uncertain attempts and incidents never expose financial replay or execution',()=>{
 const s=state();assert.ok(!renderRefundFinance(s).includes('data-refund-action="fin-replay"'));s.financeData.incidents=[{code:'INCIDENT',reference:'<script>bad</script>'}];const html=renderRefundFinance(s);assert.ok(!html.includes('data-refund-action="fin-execute"'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));
});
test('financial submit rejects absent confirmation and expired evidence before calling write',async()=>{
 const s=state();let writes=0;const cloud={};const hooks={write:async()=>writes++};const f={dataset:{refundForm:'finance'}};
 s.financeForm={kind:'authorize',confirmed:false,notes:'Reviewed',check:{id:'check',digest:'hash',expires_at:new Date(Date.now()+10000).toISOString()}};
 await assert.rejects(financialSubmit(s,cloud,f,hooks),/confirmRequired/);s.financeForm.confirmed=true;s.financeForm.check.expires_at=new Date(0).toISOString();await assert.rejects(financialSubmit(s,cloud,f,hooks),/expired/);assert.equal(writes,0);
});
test('foreign results are rejected and late results after leaving the project are ignored',async()=>{
 const s=state();await loadRefundFinance(s,{request:async()=>({...data(),settlement:{...parent,owner_id:'foreign'}})},{current:()=>true});assert.equal(s.financeData,null);assert.ok(s.financeError);
 s.financeData=null;s.financeError='';await loadRefundFinance(s,{request:async()=>data()},{current:()=>false});assert.equal(s.financeData,null);assert.equal(s.financeError,'');
});
