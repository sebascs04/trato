import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ConnectedWorkspace,renderFileLoading} from '../connected-workspace.mjs';
function fixture(){
 let resolve,reject;const pending={hidden:false};let shows=0;
 const app={projectId:'project',epoch:1,documents:[{id:'doc',title:'Agreement',original_filename:'agreement.pdf',mime_type:'application/pdf'}],modal:{open:false,contains:node=>node===pending,querySelector:()=>pending},show(title,html){shows++;this.modal.open=true;assert.match(html,/data-file-loading/);},request(){return new Promise((a,b)=>{resolve=a;reject=b;});}};
 return {app,pending,resolve:value=>resolve(value),reject:error=>reject(error),shows:()=>shows};
}
test('opening a document shows loading before its network request completes and does not reopen a closed modal',async()=>{
 const f=fixture();const work=ConnectedWorkspace.prototype.previewDocument.call(f.app,'doc');
 assert.equal(f.shows(),1);f.app.modal.open=false;f.resolve(new Blob(['pdf'],{type:'application/pdf'}));await work;assert.equal(f.shows(),1);
});
test('document errors stop loading and remain errors',async()=>{
 const f=fixture();const work=ConnectedWorkspace.prototype.previewDocument.call(f.app,'doc');f.reject(new Error('network failed'));await assert.rejects(work,/network failed/);assert.equal(f.pending.hidden,true);
});
test('the shared loading component escapes filenames',()=>assert.doesNotMatch(renderFileLoading('<img onerror=bad>'),/<img/));
