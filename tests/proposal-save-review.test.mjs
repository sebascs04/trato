import test from 'node:test';
import assert from 'node:assert/strict';
import {installProposalWorkspace} from '../proposal-workspace.mjs';

// «Save and review email →»: an immediate activity state, then straight to the addendum email, with no full reload of the view.

class FakeFormData{
 constructor(form){this.map=new Map(Object.entries(form.values));}
 get(name){return this.map.get(name);}
 entries(){return this.map.entries();}
}

function modalFixture(){
 const nodes=new Map();
 const modal={open:false,html:'',closed:0,classList:{add(){},remove(){}},
  close(){this.open=false;this.closed++;},
  querySelector(selector){
   if(selector==='[data-mail-preview-loading]')return this.html.includes('data-mail-preview-loading')?(nodes.get(selector)||nodes.set(selector,{}).get(selector)):null;
   if(selector==='[data-cloud-error]')return nodes.get(selector)||nodes.set(selector,{textContent:''}).get(selector);
   return null;
  },
  querySelectorAll(){return [];}};
 return modal;
}

function setup({failPdf=false}={}){
 const calls=[],modal=modalFixture(),shown=[],form={dataset:{cloudForm:'proposal-terms'},hidden:false,isConnected:true,next:null,
  values:{scope:'Newsletter form',conditions:'',description:'Newsletter',amount:'1.00',deadline:'2026-11-20'},
  after(node){this.next=node;}};
 let loadProjectCalls=0,lastError=null;
 const cloud={
  active:true,projectId:'project-a',epoch:1,requestId:'request-a',tab:'gestion',busy:false,message:'',historyGeneration:0,
  clients:[{id:'client-a',contact_email:'client@example.com'}],documents:[{id:'source-a'}],modal,
  document:{visibilityState:'visible',addEventListener(){},removeEventListener(){},querySelector(){return null;},body:{append(){},classList:{add(){},remove(){}}},
   createElement(){return {open:false,dataset:{},isConnected:true,setAttribute(){},addEventListener(){},close(){this.open=false;},remove(){this.isConnected=false;}};}},
  renderDocuments(){},loadProject(){loadProjectCalls++;return Promise.resolve();},renderChangeReview(){},requestRows(){return '';},click(){},submit(){},reset(){},
  notify(){},project(){return {client_id:'client-a'};},initialSources(){return [{id:'source-a'}];},sourceReady(){return true;},
  json(body){return {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)};},
  refreshDocumentList(){calls.push('documents-list');return Promise.resolve();},
  show(title,html){modal.open=true;modal.html=html;shown.push(title);},
  async run(task){if(this.busy)return;this.busy=true;try{await task();}catch(error){lastError=error;}finally{this.busy=false;}},
  request(path,options={}){
   calls.push((options.method||'GET')+' '+path);
   if(path==='/api/v1/projects/project-a/proposals'&&options.method==='POST')return Promise.resolve({proposal_id:'proposal-a',revision_id:'revision-a'});
   if(path.endsWith('/revisions/revision-a/pdf'))return failPdf?Promise.reject(new Error('PDF failed')):Promise.resolve({document_id:'pdf-a'});
   if(path.endsWith('/email-preview?kind=adenda'))return Promise.resolve({recipient:'client@example.com',document_id:'pdf-a',digest:'d',body_html:'<html><head></head><body></body></html>'});
   if(path==='/api/v1/projects/project-a/proposals')return Promise.resolve([{id:'proposal-a',request_document_id:'request-a',current_revision_id:'revision-a'}]);
   if(path==='/api/v1/projects/project-a/request-status')return Promise.resolve({can_register:false,closures:[]});
   if(path==='/api/v1/proposals/proposal-a/revisions/revision-a')return Promise.resolve({proposal:{id:'proposal-a',current_revision_id:'revision-a'},revision:{id:'revision-a',revision_no:1},
    line_items:[],sources:[],artifacts:[],deliveries:[],payments:[],reviews:[]});
   if(path.endsWith('/portal-requests')||path.endsWith('/gmail-replies'))return Promise.resolve([]);
   return Promise.reject(new Error('Unexpected request: '+path));
  }
 };
 installProposalWorkspace(cloud);
 cloud.proposalForm={mode:'create',key:'key-a',saved:null,recipient:'client@example.com',old:null,analysisSaved:true};
 return {cloud,form,calls,modal,shown,loadProjectCalls:()=>loadProjectCalls,lastError:()=>lastError};
}

test('Save and review email shows activity at once and opens the addendum email without reloading the view',async()=>{
 const previous=globalThis.FormData;globalThis.FormData=FakeFormData;
 try{
  const {cloud,form,calls,modal,shown,loadProjectCalls,lastError}=setup();
  let loadingSeen=false;cloud.notify=()=>{if(cloud.proposalLoading)loadingSeen=true;};
  const pending=cloud.submit({target:form,submitter:{value:'send'}});
  // Before any server answer: the form gives way to TeTrato's activity.
  assert.equal(form.hidden,true);
  assert.ok(form.next?.innerHTML?.includes('Preparing the email')||form.next?.innerHTML?.length>0);
  await pending;
  assert.equal(lastError(),null);
  assert.equal(loadingSeen,false,'the change view never switches to «Loading details…»');
  assert.equal(loadProjectCalls(),0);
  assert.equal(modal.closed,0,'the window stays open and moves straight to the email');
  assert.equal(shown.at(-1),cloud.proposalPreview&&shown.at(-1));
  assert.equal(cloud.proposalPreview.kind,'adenda');
  assert.equal(cloud.proposalDetails.revision.id,'revision-a');
  assert.ok(calls.includes('documents-list'));
 }finally{globalThis.FormData=previous;}
});

test('a failure while saving brings the form back with its error',async()=>{
 const previous=globalThis.FormData;globalThis.FormData=FakeFormData;
 try{
  const {cloud,form,lastError}=setup({failPdf:true});
  await cloud.submit({target:form,submitter:{value:'send'}});
  assert.equal(lastError()?.message,'PDF failed');
  assert.equal(form.hidden,false);
  assert.equal(form.next.isConnected,false);
 }finally{globalThis.FormData=previous;}
});

test('saving a draft keeps the previous behaviour',async()=>{
 const previous=globalThis.FormData;globalThis.FormData=FakeFormData;
 try{
  const {cloud,form,modal,loadProjectCalls}=setup();
  await cloud.submit({target:form,submitter:{value:'draft'}});
  assert.equal(form.hidden,false);
  assert.equal(modal.closed,1);
  assert.equal(loadProjectCalls(),1);
 }finally{globalThis.FormData=previous;}
});
