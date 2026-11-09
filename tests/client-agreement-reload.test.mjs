import test from 'node:test';
import assert from 'node:assert/strict';
import {ConnectedWorkspace} from '../connected-workspace.mjs';

const {rememberClientAgreement:remember,restoreClientAgreement:restore,clearNavigation:clear}=ConnectedWorkspace.prototype;
function workspace(hash='#acuerdos',agreements=[{proposal_id:'prop-1'}]){
 const saved=new Map();
 return {saved,clientProposal:'',clientAgreements:agreements,location:{hash},navigationKey:()=>'key',
  storage:{getItem:key=>saved.get(key)??null,setItem:(key,value)=>saved.set(key,value),removeItem:key=>saved.delete(key)}};
}

test('a reload on the agreements view reopens the addendum that was open',()=>{
 const view=workspace();remember.call(view,'prop-1');view.clientProposal='';
 restore.call(view);
 assert.equal(view.clientProposal,'prop-1');
});

test('going back to the list leaves nothing to reopen',()=>{
 const view=workspace();remember.call(view,'prop-1');remember.call(view,'');
 restore.call(view);
 assert.equal(view.clientProposal,'');assert.equal(view.saved.size,0);
});

test('an agreement this account no longer sees is forgotten, not opened',()=>{
 const view=workspace('#acuerdos',[{proposal_id:'other'}]);remember.call(view,'prop-1');view.clientProposal='';
 restore.call(view);
 assert.equal(view.clientProposal,'');assert.equal(view.saved.size,0);
});

test('another view does not reopen the addendum',()=>{
 const view=workspace('#inicio');remember.call(view,'prop-1');view.clientProposal='';
 restore.call(view);
 assert.equal(view.clientProposal,'');assert.equal(view.saved.size,0);
});

test('signing out forgets the open addendum',()=>{
 const view=workspace();remember.call(view,'prop-1');
 clear.call(view);
 assert.equal(view.saved.size,0);
});
