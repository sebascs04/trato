import test from 'node:test';
import assert from 'node:assert/strict';
import {validateProblemAttention,validateProjectProblems,renderProblemReport,renderProblemConversation,closedSection} from '../problem-reports.mjs';
import {renderDisputeAttention} from '../dispute-workspace.mjs';
import {canReportProblem,canDecide} from '../portal-view.mjs';
import {answerMessage,draftMarkup} from '../portal-assistant.mjs';

test('TeTrato drafts the problem report for the Report a problem form, never as a change request',()=>{
 const problem=answerMessage({answer:'Choose a reason and send it.',sources:[],change_request:'',problem_report:'Blurry <photos>'});
 assert.equal(problem.draftKind,'problem');assert.equal(problem.draft,'Blurry <photos>');
 assert.match(draftMarkup(problem,1),/Blurry &lt;photos&gt;/);assert.match(draftMarkup(problem,1),/data-assistant-draft="1"/);
 const change=answerMessage({answer:'Review it.',sources:[],change_request:'Move to the 22nd'});
 assert.equal(change.draftKind,'change');assert.equal(change.draft,'Move to the 22nd');
 assert.equal(answerMessage({answer:'Five products.',sources:['scope'],change_request:''}).draft,'');
});

const ID='33333333-3333-4333-8333-333333333333',PROJECT='11111111-1111-4111-8111-111111111111';
const row=(over={})=>({report_id:ID,project_id:PROJECT,client_id:'c1',project_name:'Café <Aurora>',reason:'quality',created_at:'2026-11-09T10:00:00Z',your_turn:true,...over});
const report=(over={})=>({id:ID,reason:'not_as_agreed',notes:'The <logo> is missing',status:'open',revision_no:2,created_at:'2026-11-09T10:00:00Z',closed_at:null,messages:[],your_turn:true,...over});

test('Report a problem replaces Request changes only after PayPal confirmed the payment',()=>{
 const paid={status:'accepted',payment_status:'completed'};
 assert.equal(canReportProblem(paid,null,null),true);
 assert.equal(canReportProblem({status:'accepted',payment_status:'pending'},null,null),false);
 assert.equal(canReportProblem({status:'ready_for_review'},null,null),false);
 assert.equal(canDecide(false,{status:'ready_for_review'}),true);  // Before accepting, Request changes stays.
 assert.equal(canReportProblem(paid,null,null,true),false);         // Still asking PayPal for a dispute.
 assert.equal(canReportProblem(paid,{status:'WAITING_FOR_SELLER_RESPONSE'},null),false);  // Already in PayPal.
 assert.equal(canReportProblem(paid,null,{status:'open'}),false);   // One report per addendum.
});

test('the home warning lists the client reports in the same list as disputes',()=>{
 const problems=validateProblemAttention({reports:[row()]});
 const alone=renderDisputeAttention({data:{payments_checked:1,disputes:[]},problems,error:''});
 assert.match(alone,/data-problem-attention-open="33333333-3333-4333-8333-333333333333"/);
 assert.match(alone,/Café &lt;Aurora&gt;/);assert.doesNotMatch(alone,/<Aurora>/);
 const dispute={project_id:'p1',client_id:'c1',project_name:'Other',dispute_id:'PP-R-VHD-10197086',reason:'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED',status:'WAITING_FOR_BUYER_RESPONSE',stage:'INQUIRY',amount:{value:'1.00',currency:'USD'},response_due:null,your_turn:false};
 const both=renderDisputeAttention({data:{payments_checked:1,disputes:[dispute]},problems,error:''});
 assert.equal((both.match(/<ul>/g)||[]).length,1);
 assert.match(both,/data-dispute-attention-open=/);assert.match(both,/data-problem-attention-open=/);
});

test('a failed report check is shown, never hidden, and does not hide disputes',()=>{
 assert.match(renderDisputeAttention({data:{payments_checked:0,disputes:[]},problemsError:true,error:''}),/role="alert"/);
 assert.equal(renderDisputeAttention({data:{payments_checked:0,disputes:[]},problems:{reports:[]},error:''}),'');
});

test('closed items stay behind one button and are not counted',()=>{
 const closed=[{id:'a'},{id:'b'}],render=item=>`<i>${item.id}</i>`;
 const hidden=closedSection(closed,false,render,'data-x');
 assert.match(hidden,/aria-expanded="false"/);assert.doesNotMatch(hidden,/<i>/);
 const shown=closedSection(closed,true,render,'data-x');
 assert.match(shown,/aria-expanded="true"/);assert.equal((shown.match(/<i>/g)||[]).length,2);
 assert.equal(closedSection([],true,render,'data-x'),'');
});

test('invalid answers from the server are rejected',()=>{
 assert.throws(()=>validateProblemAttention({reports:[row({report_id:'x'})]}));
 assert.throws(()=>validateProjectProblems({reports:[report({messages:null})]}));
});

test('the project card escapes the client words and shows whose turn it is',()=>{
 const html=renderProblemReport(report());
 assert.match(html,/The &lt;logo&gt; is missing/);assert.doesNotMatch(html,/<logo>/);
 assert.match(html,/v2/);assert.match(html,/data-problem-open=/);assert.match(html,/class="button "/);
 assert.match(renderProblemReport(report({your_turn:false})),/class="button secondary"/);
});

test('the conversation starts with the client report and lets the freelancer reply only while open',()=>{
 const open=renderProblemConversation(report({messages:[{author:'freelancer',body:'New <files>',created_at:'2026-11-09T11:00:00Z'}]}));
 assert.ok(open.indexOf('The &lt;logo&gt;')<open.indexOf('New &lt;files&gt;'));
 assert.match(open,/data-problem-reply-form/);
 assert.doesNotMatch(open,/data-problem-close/);  // Only the client closes a report.
 assert.doesNotMatch(renderProblemConversation(report({status:'resolved'})),/<textarea/);
});

test('an open report can be registered as a new request once, and then says so',()=>{
 assert.match(renderProblemConversation(report()),/data-problem-register=/);
 const linked=renderProblemConversation(report({request_document_id:'55555555-5555-4555-8555-555555555555'}));
 assert.doesNotMatch(linked,/data-problem-register=/);assert.match(linked,/problem-registered/);
 assert.doesNotMatch(renderProblemConversation(report({status:'unresolved'})),/data-problem-register=/);
 // The freelancer's card: a linked report is the client's turn.
 assert.match(renderProblemReport(report({request_document_id:'55555555-5555-4555-8555-555555555555',your_turn:false})),/class="button secondary"/);
});
