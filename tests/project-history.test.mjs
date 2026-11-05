import test from 'node:test';
import assert from 'node:assert/strict';
import {ConnectedWorkspace} from '../connected-workspace.mjs';
function workspace(){return new ConnectedWorkspace({document:{},location:{},storage:{},fetchFn:()=>{throw Error('History must not mutate or fetch');}});}
test('history groups real cases, opens latest case and displays a Lima day only once',()=>{
 const cloud=workspace(),panel={};
 cloud.projectActivity=[
 {id:'older',kind:'request_registered',request_document_id:'request-a',request_title:'Earlier',created_at:'2026-11-04T10:00:00Z'},
 {id:'received',kind:'refund_requested',group_kind:'refund',group_id:'refund-a',group_title:'Refund <script>',created_at:'2026-11-06T01:00:00Z'},
 {id:'sent',kind:'refund_proposal_sent',group_kind:'refund',group_id:'refund-a',group_title:'Refund <script>',revision_no:1,created_at:'2026-11-05T22:00:00Z'}];
 cloud.renderHistory(panel);
 assert.ok(panel.innerHTML.indexOf('data-activity-group-id="refund-a"')<panel.innerHTML.indexOf('data-activity-group-id="request-a"'));
 assert.equal((panel.innerHTML.match(/ open>/g)||[]).length,1);
 assert.equal((panel.innerHTML.match(/cloud-history-day"/g)||[]).length,2);
 assert.equal((panel.innerHTML.match(/data-cloud-action="history-event"/g)||[]).length,3);
 assert.match(panel.innerHTML,/Refund &lt;script&gt;/);assert.doesNotMatch(panel.innerHTML,/<script>|cloud-activity-heading/);
});
test('event documents require explicit case, role and exact version, never matching titles',()=>{
 const cloud=workspace();cloud.documents=[
 {id:'correct',request_links:[{request_document_id:'a',revision_no:2,role:'addendum'}]},
 {id:'old',request_links:[{request_document_id:'a',revision_no:1,role:'addendum'}]},
 {id:'wrong',request_links:[{request_document_id:'b',revision_no:2,role:'addendum'}]},
 {id:'unlinked',title:'Adenda v2'},
 {id:'refund-request',refund_links:[{settlement_id:'r',version_no:null,role:'request'}]},
 {id:'refund',refund_links:[{settlement_id:'r',version_no:1,role:'proposal'}]}];
 assert.deepEqual(cloud.historyDocuments({kind:'adenda_sent',request_document_id:'a',revision_no:2}).map(d=>d.id),['correct']);
 assert.deepEqual(cloud.historyDocuments({kind:'refund_proposal_sent',group_kind:'refund',group_id:'r',revision_no:1}).map(d=>d.id),['refund']);
 assert.deepEqual(cloud.historyDocuments({kind:'refund_requested',group_kind:'refund',group_id:'r'}).map(d=>d.id),['refund-request']);
 assert.deepEqual(cloud.historyDocuments({kind:'payment_completed',request_document_id:'a'}),[]);
 assert.deepEqual(cloud.historyDocuments({kind:'refund_completed',group_kind:'refund',group_id:'external'}),[]);
});
test('event detail opens locally without executing business commands',()=>{
 const cloud=workspace();cloud.modal={classList:{add(){}}};let shown='';cloud.show=(title,html)=>{shown=title+html;};
 cloud.projectActivity=[{id:'event',kind:'request_registered',request_document_id:'a',request_title:'Source',created_at:'2026-11-05T12:00:00Z'}];cloud.documents=[{id:'a',title:'Initial request'}];
 cloud.openHistoryEvent('missing');assert.equal(shown,'');cloud.openHistoryEvent('event');assert.match(shown,/Initial request/);assert.match(shown,/data-cloud-action="history-document"/);
});
