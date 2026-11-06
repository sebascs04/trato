import test from 'node:test';
import assert from 'node:assert/strict';
import {ConnectedWorkspace} from '../connected-workspace.mjs';
function workspace(){return new ConnectedWorkspace({document:{},location:{},storage:{},fetchFn:()=>{throw Error('History must not mutate or fetch');}});}
test('history initially renders compact closed group headers without any movements',()=>{
 const cloud=workspace(),panel={};
 cloud.projectHistoryGroups=[
 {group_kind:'refund',group_id:'refund-a',group_title:'Refund <script>',event_count:2,last_at:'2026-11-06T01:00:00Z'},
 {group_kind:'change',group_id:'request-a',group_title:'Earlier',event_count:1,last_at:'2026-11-04T10:00:00Z'}];
 cloud.renderHistory(panel);
 assert.ok(panel.innerHTML.indexOf('data-activity-group-id="refund-a"')<panel.innerHTML.indexOf('data-activity-group-id="request-a"'));
 assert.equal((panel.innerHTML.match(/ open>/g)||[]).length,0);
 assert.equal((panel.innerHTML.match(/cloud-history-day"/g)||[]).length,0);
 assert.equal((panel.innerHTML.match(/data-cloud-action="history-event"/g)||[]).length,0);
 const body=cloud.renderHistoryGroup({events:[
  {id:'received',kind:'refund_requested',group_kind:'refund',group_id:'refund-a',created_at:'2026-11-06T01:00:00Z'},
  {id:'sent',kind:'refund_proposal_sent',group_kind:'refund',group_id:'refund-a',revision_no:1,created_at:'2026-11-05T22:00:00Z'}]});
 assert.equal((body.match(/cloud-history-day"/g)||[]).length,1);
 assert.equal((body.match(/data-cloud-action="history-event"/g)||[]).length,2);
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

test('opening a history card fetches only that group once, caches it and remembers the chosen state',async()=>{
 const cloud=workspace();cloud.active=true;cloud.projectId='project-a';let toggle;const body={dataset:{},innerHTML:''};
 const calls=[];cloud.request=async path=>{calls.push(path);return [{id:'created',kind:'project_created',group_kind:'project',group_id:'project-a',created_at:'2026-11-05T12:00:00Z'}];};
 const details={open:true,isConnected:true,dataset:{activityGroupKind:'project',activityGroupId:'project-a'},matches:()=>true,querySelector:()=>body};
 const panel={dataset:{},addEventListener:(_kind,handler)=>toggle=handler,querySelectorAll:()=>details.open?[details]:[]};
 cloud.projectHistoryGroups=[{group_kind:'project',group_id:'project-a',group_title:'Project',event_count:1,last_at:'2026-11-05T12:00:00Z'}];
 cloud.renderHistory(panel);assert.doesNotMatch(panel.innerHTML,/data-cloud-action="history-event"/);assert.deepEqual(calls,[]);
 toggle({target:details});await new Promise(resolve=>setTimeout(resolve,0));
 assert.deepEqual(calls,['/api/v1/projects/project-a/activity/groups/project/project-a']);
 assert.match(body.innerHTML,/data-cloud-id="created"/);assert.equal(cloud.historyOpen.has('project:project-a'),true);
 body.innerHTML='kept';toggle({target:details});assert.equal(body.innerHTML,'kept');assert.equal(calls.length,1);
 cloud.renderHistory(panel);assert.match(panel.innerHTML,/ open>/);assert.match(panel.innerHTML,/data-cloud-id="created"/);assert.equal(calls.length,1);
 details.open=false;toggle({target:details});cloud.renderHistory(panel);assert.doesNotMatch(panel.innerHTML,/data-cloud-action="history-event"/);
});
