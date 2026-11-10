import test from 'node:test';
import assert from 'node:assert/strict';
import {stageKey,stageProblemSlot} from '../stage-problems.mjs';
import {problemCardHtml,problemConversationHtml,problemDialogsHtml,PROBLEM_REASONS} from '../problem-thread.mjs';
import {PROBLEM_REASONS as ADDENDUM_REASONS} from '../portal-view.mjs';

const problem=(over={})=>({reason:'quality',notes:'Blurry <hero>',status:'open',created_at:'2026-11-10T10:00:00Z',messages:[],registered_as_request:false,request_paid:false,...over});

test('a paid deliverable without a report offers Report a problem, which opens the addendum dialog',()=>{
 assert.match(stageProblemSlot(null),/data-stage-problem-new/);
 assert.match(stageProblemSlot(null),/aria-haspopup="dialog"/);
 assert.deepEqual(PROBLEM_REASONS,ADDENDUM_REASONS);
 for(const reason of PROBLEM_REASONS)assert.match(problemDialogsHtml(),new RegExp(`value="${reason}"`));
 assert.equal(stageKey('p1',2),'stage:p1:2');
});

test('once sent, the deliverable shows the very card of an addendum, and the conversation floats in its dialog',()=>{
 const slot=stageProblemSlot(problem());
 assert.equal(slot,problemCardHtml(problem(),{amount:null}));
 assert.match(slot,/data-problem-open/);assert.doesNotMatch(slot,/portal-dispute-messages/);
});

test('the client writes and closes only after the freelancer answered, like on an addendum',()=>{
 const waiting=problemConversationHtml(problem());
 assert.match(waiting,/Blurry &lt;hero&gt;/);assert.doesNotMatch(waiting,/<hero>/);
 assert.doesNotMatch(waiting,/data-problem-close/);
 const answered=problemConversationHtml(problem({messages:[{author:'freelancer',body:'On it',created_at:'2026-11-10T11:00:00Z'}]}));
 assert.match(answered,/data-problem-close="resolved"/);assert.match(answered,/data-problem-reply/);
 assert.doesNotMatch(problemConversationHtml(problem({status:'resolved'})),/<textarea/);
});
