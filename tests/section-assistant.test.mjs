import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSectionAnswer,sectionHistory,SECTION_HASHES} from '../section-assistant.mjs';

const answer={kind:'section_help',section:'rehearsals',status:'answered',answer:'A private motive.',passage_ids:['practice-hidden-intent'],passages:[{id:'practice-hidden-intent',text:'The client gets a random private motive.'}]};

test('section assistant only appears in Ensayos and Reputación',()=>{
 assert.deepEqual(SECTION_HASHES,{'#ensayos':'rehearsals','#reputacion':'reputation'});
});

test('section answers must match the section and carry the cited guide passages',()=>{
 assert.equal(validateSectionAnswer(answer,'rehearsals'),answer);
 assert.throws(()=>validateSectionAnswer(answer,'reputation'));
 assert.throws(()=>validateSectionAnswer({...answer,passages:[]},'rehearsals'));
 assert.throws(()=>validateSectionAnswer({...answer,passages:[{id:'other',text:'x'}]},'rehearsals'));
 assert.throws(()=>validateSectionAnswer({...answer,status:'outside_guide'},'rehearsals'));
 assert.equal(validateSectionAnswer({...answer,status:'outside_guide',passage_ids:[],passages:[]},'rehearsals').status,'outside_guide');
});

test('history sent with a question alternates user and assistant and keeps only recent turns',()=>{
 const entries=Array.from({length:8},(_,i)=>({question:`q${i}`,result:{answer:`a${i}`}}));
 const history=sectionHistory(entries);
 assert.equal(history.length,12);
 assert.deepEqual(history.slice(0,2),[{role:'user',text:'q2'},{role:'assistant',text:'a2'}]);
 assert.deepEqual(history.at(-1),{role:'assistant',text:'a7'});
 assert.deepEqual(sectionHistory([]),[]);
});
