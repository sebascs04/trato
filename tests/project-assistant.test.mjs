import test from 'node:test';
import assert from 'node:assert/strict';
import {validateProjectAnswer} from '../project-assistant.mjs';
const answer=()=>({kind:'project_assistant',project_id:'project-a',question:'Scope?',status:'answered',answer:'Two revisions.',missing_information:[],citations:[{source_id:'source-a',quote:'two revisions'}],sources:[{source_id:'source-a',file_id:'file-a',source_kind:'original'}]});
test('answers cannot cross project boundaries',()=>assert.throws(()=>validateProjectAnswer(answer(),'project-b')));
test('every displayed citation requires a recognized bound source',()=>{
 const value=answer();value.sources=[];assert.throws(()=>validateProjectAnswer(value,'project-a'));
 value.sources=[{source_id:'source-a',file_id:'file-a',source_kind:'invented'}];assert.throws(()=>validateProjectAnswer(value,'project-a'));
});
test('summary and original evidence retain distinct source kinds',()=>{
 for(const kind of ['summary','original']){const value=answer();value.sources[0].source_kind=kind;assert.equal(validateProjectAnswer(value,'project-a').sources[0].source_kind,kind);}
});
