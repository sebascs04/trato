import test from 'node:test';
import assert from 'node:assert/strict';
import {demoCases,demoSnapshot} from '../demo-workspace.mjs';
import {textForLanguage} from '../i18n.mjs';
test('demo cases never represent an executed provider payment',()=>{
 for(const kind of Object.keys(demoCases)){
  for(let n=0;n<6;n++){
   const state=demoSnapshot(kind,n);
   assert.equal(state.mode,'demonstration');assert.equal(state.providerExecuted,false);assert.equal(state.source,'preloaded');
   assert.equal(Object.isFrozen(state),true);assert.equal(state.amount,kind==='change'?150:200);
  }
 }
});
test('invalid demonstration cases or steps fail without substituting another case',()=>{
 for(const [kind,index] of [['unknown',0],['change',-1],['refund',6],['change',0.5]])assert.throws(()=>demoSnapshot(kind,index));
});
test('every demonstration step has instructions, action and values in both languages',()=>{
 for(const language of ['es','en'])for(const kind of Object.keys(demoCases))for(let index=0;index<6;index++)for(const field of ['title','copy','value','action']){
  const key=['demoGuide',kind,index,field].join('.');const text=textForLanguage(language,key,{base:'600',amount:'150'});
  assert.ok(text);assert.notEqual(text,key);
 }
});


test('the Inicio demonstration button opens the scenario chooser without rendering errors',async()=>{
 const {installDemoWorkspace}=await import('../demo-workspace.mjs');
 const listeners=new Map(),elements=[];
 const doc={hidden:false,activeElement:null,body:{append(){}},defaultView:{location:{hash:'#inicio'},clearTimeout(){},setTimeout(){},addEventListener(){},removeEventListener(){}},
  addEventListener(name,handler){listeners.set(name,handler);},removeEventListener(){},
  createElement(tag){const element={tag,hidden:false,open:false,innerHTML:'',handlers:new Map(),setAttribute(){},addEventListener(name,handler){this.handlers.set(name,handler);},querySelector(){return {focus(){}};},showModal(){this.open=true;},close(){this.open=false;},remove(){}};elements.push(element);return element;}};
 const cloud={document:doc,active:true,state:'ready',session:{session:{user:{id:'authorized'}}},syncChrome(){}};
 const dispose=installDemoWorkspace(cloud);
 listeners.get('click')({target:{closest:selector=>selector==='[data-demo-open]'?{}:null}});
 const dialog=elements.find(element=>element.tag==='dialog');
 assert.equal(dialog.open,true);
 assert.match(dialog.innerHTML,/data-demo-case="change"/);
 assert.match(dialog.innerHTML,/data-demo-case="refund"/);
 for(const kind of ['change','refund']){
  const click=dialog.handlers.get('click');
  click({target:{closest:selector=>selector==='[data-demo-case]'?{dataset:{demoCase:kind}}:null}});
  assert.match(dialog.innerHTML,/demo-spotlight/);
  for(let index=0;index<6;index++){
   click({target:{closest:selector=>selector==='[data-demo-step]'?{dataset:{demoStep:String(index)}}:null}});
   assert.match(dialog.innerHTML,/demo-spotlight/);
   assert.match(dialog.innerHTML,/TeTrato/);
   assert.equal(dialog.open,true);
  }
 }
 dispose();
});
