import test from 'node:test';
import assert from 'node:assert/strict';
import {installProposalWorkspace} from '../proposal-workspace.mjs';

test('switching projects clears pending proposal loading and Gmail evidence before the new project loads',async()=>{
 let finishOriginalLoad;
 const originalLoad=new Promise(resolve=>{finishOriginalLoad=resolve;});
 const cloud={
  projectId:'project-a',epoch:4,gmailProjectId:'project-a',proposalLoading:true,
  gmailReplies:[{id:'reply-from-project-a'}],gmailReplyError:'old error',
  gmailImportedFeedbackDocs:new Map([['reply-a:0','doc-a']]),selectedGmailReply:{id:'reply-from-project-a'},
  requestStatus:{can_register:false,closures:[]},proposals:[{id:'proposal-a'}],proposalDetails:{proposal:{id:'proposal-a'}},
  proposalRetryRevision:'revision-a',proposalError:'old error',
  renderDocuments(){},loadProject(){return originalLoad;},renderChangeReview(){},requestRows(){return '';},
  click(){},submit(){},reset(){},notify(){},request(path){
   if(path.endsWith('/proposals'))return Promise.resolve([]);
   if(path.endsWith('/request-status'))return Promise.resolve({can_register:true,closures:[]});
   throw new Error('Unexpected request: '+path);
  },document:{visibilityState:'visible',addEventListener(){}}
 };
 installProposalWorkspace(cloud);
 cloud.projectId='project-b';cloud.epoch=5;
 const loading=cloud.loadProject();
 assert.equal(cloud.proposalLoading,false);
 assert.deepEqual(cloud.gmailReplies,[]);
 assert.equal(cloud.gmailReplyError,'');
 assert.equal(cloud.gmailImportedFeedbackDocs.size,0);
 assert.equal(cloud.selectedGmailReply,null);
 finishOriginalLoad();
 await loading;
 assert.equal(cloud.proposalLoading,false);
 assert.deepEqual(cloud.proposals,[]);
 assert.equal(cloud.requestStatus.can_register,true);
});

function openProposalWorkspace(loadReplies){
 const cloud={
  active:true,projectId:'project-a',epoch:1,historyGeneration:0,requestId:'request-a',tab:'gestion',
  modal:{open:false},renderDocuments(){},loadProject(){},renderChangeReview(){},requestRows(){},
  click(){},submit(){},reset(){},notify(){},document:{visibilityState:'visible',addEventListener(){}},
  request(path){
   if(path.endsWith('/proposals'))return Promise.resolve([{id:'proposal-a',request_document_id:'request-a',current_revision_id:'revision-a'}]);
   if(path.endsWith('/request-status'))return Promise.resolve({can_register:false,closures:[]});
   if(path.endsWith('/revisions/revision-a'))return Promise.resolve({proposal:{id:'proposal-a',current_revision_id:'revision-a'},revision:{id:'revision-a'}});
   if(path.endsWith('/gmail-replies'))return loadReplies();
   throw new Error('Unexpected request: '+path);
  }
 };
 installProposalWorkspace(cloud);
 return cloud;
}

test('returning to the project refreshes saved replies and clears an earlier load error',async()=>{
 const replies=[{id:'saved-reply',revision_id:'revision-a'}];
 const cloud=openProposalWorkspace(async()=>replies);
 cloud.gmailReplyError='previous failure';
 await cloud.syncBusinessState();
 assert.deepEqual(cloud.gmailReplies,replies);
 assert.equal(cloud.gmailReplyError,'');
});

test('a reply refresh cannot populate a different project after navigation',async()=>{
 let finish,started;
 const pending=new Promise(resolve=>{finish=resolve;});
 const entered=new Promise(resolve=>{started=resolve;});
 const cloud=openProposalWorkspace(()=>{started();return pending;});
 const refresh=cloud.syncBusinessState();
 await entered;
 cloud.projectId='project-b';cloud.epoch++;
 finish([{id:'private-reply-from-project-a'}]);
 await refresh;
 assert.deepEqual(cloud.gmailReplies,[]);
 assert.equal(cloud.proposalDetails,null);
});

test('a reply load failure remains explicit while proposal details can refresh',async()=>{
 const cloud=openProposalWorkspace(async()=>{throw Error('Reply query failed');});
 await cloud.syncBusinessState();
 assert.equal(cloud.proposalDetails.revision.id,'revision-a');
 assert.equal(cloud.gmailReplyError,'Reply query failed');
 assert.deepEqual(cloud.gmailReplies,[]);
});

test('reply panel shows reply text and PDF preview without rendering the quoted original',()=>{
 const cloud=openProposalWorkspace(async()=>[]);
 cloud.documents=[];
 cloud.proposals=[{id:'proposal-a',request_document_id:'request-a',business_status:'Pendiente',revision_no:1}];
 cloud.proposalDetails={proposal:{id:'proposal-a',current_revision_id:'revision-a'},revision:{id:'revision-a',revision_no:1,additional_minor:25000,deadline:'2026-11-27'},payments:[],artifacts:[],reviews:[],acceptances:[],deliveries:[{kind:'adenda',status:'accepted_by_gmail'}]};
 cloud.gmailReplies=[{id:'reply-a',revision_id:'revision-a',received_at:'2026-10-31T00:00:00Z',from_email:'client@example.com',reply_text:'Please change to USD 140. <script>',body_text:'Please change to USD 140.\n> ORIGINAL QUOTED USD 250',attachment_metadata:[{filename:'offer.pdf',mime_type:'application/pdf',size_bytes:100,supported:true}]}];
 let replyPanel='';
 const panel={innerHTML:'',querySelector(){return {insertAdjacentHTML(position,html){replyPanel=html;}};}};
 cloud.renderChangeManagement(panel);
 assert.match(replyPanel,/USD 140/);
 assert.doesNotMatch(replyPanel,/ORIGINAL QUOTED/);
 assert.doesNotMatch(replyPanel,/<script>/);
 assert.match(replyPanel,/&lt;script&gt;/);
 assert.match(replyPanel,/data-proposal-action="view-gmail-pdf"/);
 assert.match(replyPanel,/offer.pdf/);
});

test('Gmail PDF preview reads the attachment without importing it into the project',async()=>{
 const cloud=openProposalWorkspace(async()=>[]);
 cloud.proposalDetails={proposal:{id:'proposal-a'}};
 cloud.gmailReplies=[{id:'reply-a',attachment_metadata:[{filename:'offer.pdf',supported:true}]}];
 const frame={},link={},calls=[];let pending;
 cloud.request=async(path,options,binary)=>{calls.push({path,options,binary});return new Blob(['%PDF-test'],{type:'application/pdf'});};
 cloud.modal={classList:{add(){}},querySelector(selector){return selector==='iframe'?frame:link;}};
 cloud.show=()=>{};cloud.run=fn=>{pending=fn();};
 cloud.click({target:{closest(){return {dataset:{proposalAction:'view-gmail-pdf',messageId:'reply-a',attachmentIndex:'0'}};}}});
 await pending;
 assert.equal(calls.length,1);
 assert.equal(calls[0].path,'/api/v1/proposals/proposal-a/gmail-replies/reply-a/attachments/0');
 assert.equal(calls[0].binary,true);
 assert.equal(link.download,'offer.pdf');
 assert.match(frame.src,/^blob:/);
 URL.revokeObjectURL(cloud.previewUrl);
});
