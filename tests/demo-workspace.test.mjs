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
