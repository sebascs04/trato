import test from 'node:test';
import assert from 'node:assert/strict';
import {validateAttention,renderDisputeAttention} from '../dispute-workspace.mjs';

const item=(over={})=>({project_id:'p1',client_id:'c1',project_name:'Café <Aurora>',dispute_id:'PP-R-VHD-10197086',reason:'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED',
 status:'WAITING_FOR_SELLER_RESPONSE',stage:'INQUIRY',amount:{value:'120.00',currency:'USD'},response_due:new Date(Date.now()+3*86400000).toISOString(),your_turn:true,...over});

test('nothing is shown while checking for the first time or when there is no open dispute',()=>{
 assert.equal(renderDisputeAttention({loading:true,data:null,error:''}),'');
 assert.equal(renderDisputeAttention({loading:false,data:{payments_checked:3,disputes:[]},error:''}),'');
});

test('an open dispute names the project, escapes it and opens that dispute',()=>{
 const html=renderDisputeAttention({data:validateAttention({payments_checked:2,disputes:[item()]}),error:''});
 assert.match(html,/data-dispute-attention-open="PP-R-VHD-10197086"/);
 assert.match(html,/Café &lt;Aurora&gt;/);
 assert.doesNotMatch(html,/<Aurora>/);
 assert.match(html,/is-urgent/);  // Three days left while PayPal waits for the freelancer.
});

test('a dispute waiting for the client is not urgent and uses a secondary button',()=>{
 const html=renderDisputeAttention({data:{payments_checked:1,disputes:[item({status:'WAITING_FOR_BUYER_RESPONSE',your_turn:false})]},error:''});
 assert.doesNotMatch(html,/is-urgent/);
 assert.match(html,/class="button secondary"/);
});

test('a failed check is shown with a retry, never hidden',()=>{
 const html=renderDisputeAttention({data:null,error:'attention.error'});
 assert.match(html,/role="alert"/);
 assert.match(html,/data-dispute-attention-retry/);
});

test('long lists stay short',()=>{
 const disputes=Array.from({length:6},(_,n)=>item({dispute_id:`PP-R-AAA-1000000${n}`}));
 const html=renderDisputeAttention({data:{payments_checked:6,disputes},error:''});
 assert.equal((html.match(/data-dispute-attention-open=/g)||[]).length,4);
});

test('an unexpected answer from the server is rejected',()=>{
 assert.throws(()=>validateAttention({payments_checked:1,disputes:[{...item(),dispute_id:'<x>'}]}));
 assert.throws(()=>validateAttention({disputes:[]}));
});
