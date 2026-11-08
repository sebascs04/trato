import {webcrypto} from 'node:crypto';
globalThis.crypto=webcrypto;
import test from 'node:test';
import assert from 'node:assert/strict';
import {ConnectedWorkspace} from '../connected-workspace.mjs';
const file=(id,kind,day,extra={})=>({id,title:id,kind,created_at:`2026-11-${day}T12:00:00Z`,mime_type:'application/pdf',document_extractions:[{status:'ready'}],...extra});
function render(documents){
 const cloud=new ConnectedWorkspace({document:{},location:{},storage:{},fetchFn:()=>{throw Error('Document grouping must not fetch data');}});
 cloud.documents=documents;const panel={};cloud.renderDocuments(panel);return panel.innerHTML;
}
test('initial agreement comes first, and each request keeps its own versions, feedback and acceptance',()=>{
 const link=(version,role)=>({request_document_id:'request-a',revision_no:version,role});
 const html=render([
  file('feedback-a','reference','05',{request_links:[link(1,'feedback')]}),
  file('pdf-v2','addendum','05',{request_links:[link(2,'addendum')]}),
  file('acceptance-a','addendum','04',{request_links:[link(1,'acceptance')]}),
  file('pdf-v1','addendum','03',{request_links:[link(1,'addendum')]}),
  file('request-a','email_request','02'),file('initial-a','initial_agreement','01'),
 ]);
 const initial=html.indexOf('data-document-kind="initial_agreement"'),request=html.indexOf('data-document-kind="request"');
 assert.ok(initial<request);assert.doesNotMatch(html,/data-cloud-purpose="reference"|data-document-kind="reference"|data-document-kind="unlinked"/);
 const positions=['pdf-v2','feedback-a','acceptance-a','pdf-v1','request-a'].map(id=>html.indexOf(`data-cloud-id="${id}"`));
 assert.deepEqual([...positions].sort((a,b)=>a-b),positions);
});
test('refund records stay in their actual settlement and unrelated files are never linked by their title',()=>{
 const linked=(role)=>({settlement_id:'refund-a',version_no:1,role});
 const html=render([
  file('refund-acceptance','reference','05',{refund_links:[linked('acceptance')]}),
  file('refund-adjustments','reference','04',{refund_links:[linked('feedback')]}),
  file('refund-proposal','reference','03',{refund_links:[linked('proposal')]}),
  file('unlinked','addendum','02',{title:'Ajustes a la adenda de request-a'}),
  file('initial-a','initial_agreement','01'),
 ]);
 assert.match(html,/data-document-kind="refund" data-document-request="refund-a"/);
 const group=html.slice(html.indexOf('data-document-kind="refund"'),html.indexOf('data-document-kind="unlinked"'));
 assert.ok(group.indexOf('data-cloud-id="refund-acceptance"')<group.indexOf('data-cloud-id="refund-adjustments"'));
 assert.ok(group.indexOf('data-cloud-id="refund-adjustments"')<group.indexOf('data-cloud-id="refund-proposal"'));
 assert.doesNotMatch(group,/data-cloud-id="unlinked"/);assert.match(html,/data-document-kind="unlinked"/);
});

test('only technical processing failures expose a retry; content decisions stay reviewable',()=>{
 const technical=render([file('failed','reference','01',{processing_outcome:{status:'error',error_code:'FILE_PIPELINE_FAILED'}})]);
 assert.match(technical,/data-cloud-action="reprocess-document" data-cloud-id="failed"/);
 for(const status of ['rejected','needs_clarification']){
  const semantic=render([file('review','reference','01',{processing_outcome:{status}})]);
  assert.doesNotMatch(semantic,/data-cloud-action="reprocess-document"/);assert.match(semantic,/cloud-document-processing-review/);
 }
});
test('a manual processing retry uses the existing workflow once and cannot run for rejected content',async()=>{
 const calls=[],cloud=new ConnectedWorkspace({document:{querySelectorAll:()=>[]},location:{},storage:{getItem:()=>null,setItem(){}},fetchFn:()=>{throw Error('Unexpected request');}});
 cloud.active=true;cloud.navigationOwner='owner';cloud.projectId='project';cloud.tab='documentos';cloud.session={key:'session'};cloud.notify=()=>{};
 cloud.documents=[file('failed','reference','01',{processing_outcome:{status:'error'}}),file('review','reference','01',{processing_outcome:{status:'needs_clarification'}})];
 cloud.request=async(path,options)=>{calls.push(path);return {id:options.headers['Idempotency-Key'],status:'completed',result:{kind:'file_processing',file_id:'failed',status:'processed'}};};
 await cloud.retryDocumentProcessing('failed');await cloud.retryDocumentProcessing('review');
 assert.deepEqual(calls,['/api/v1/projects/project/documents/failed/process']);
 assert.equal(cloud.documentProcessingNotice(cloud.documents[0]),'');
});

test('request and refund headings follow registration dates even when refund evidence was uploaded earlier',()=>{
 for(const [registered,refundFirst] of [['2026-11-02T12:00:00Z',true],['2026-11-05T12:00:00Z',false]]){
  const html=render([
   file('refund-file','reference','01',{refund_links:[{settlement_id:'refund-a',role:'request',version_no:null,case_created_at:registered}]}),
   file('request-a','email_request','03'),file('agreement','initial_agreement','04'),
  ]);
  const initial=html.indexOf('data-document-kind="initial_agreement"');
  const request=html.indexOf('data-document-kind="request"'),refund=html.indexOf('data-document-kind="refund"');
  assert.ok(initial<Math.min(request,refund));assert.equal(refund<request,refundFirst);
 }
});

test('dispute documents get their own group and an addendum also stays in its change',()=>{
 const sent={dispute_id:'PP-R-1',role:'sent',created_at:'2026-11-08T12:00:00Z'},uploaded={dispute_id:'PP-R-1',role:'uploaded',created_at:'2026-11-08T11:00:00Z'};
 const html=render([
  file('request-a','email_request','01'),
  file('addendum-a','addendum','02',{request_links:[{request_document_id:'request-a',role:'addendum',revision_no:1}],dispute_links:[sent]}),
  file('proof','delivery','03',{dispute_links:[uploaded,sent]}),
 ]);
 const group=html.slice(html.indexOf('data-document-kind="dispute"'));
 assert.ok(group.includes('addendum-a')&&group.includes('proof'));
 const request=html.slice(html.indexOf('data-document-kind="request"'),html.indexOf('data-document-kind="dispute"'));
 assert.ok(request.includes('addendum-a'),'the addendum stays in its change');
 assert.ok(!html.includes('data-document-kind="reference"'),'a linked proof does not also land in the general group');
});
