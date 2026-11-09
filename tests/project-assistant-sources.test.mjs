import {webcrypto} from 'node:crypto';
globalThis.crypto=webcrypto;
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateProjectAnswer} from '../project-assistant.mjs';

const answer=kind=>({kind:'project_assistant',project_id:'p',answer:'a',question:'q',status:'answered',answer_basis:'documents',missing_information:[],
 citations:[{source_id:'s',quote:'x'}],sources:[{source_id:'s',source_kind:kind,file_id:'p'}]});

test('every source kind the assistant can produce is accepted, so one answer cannot make the conversation unreadable',()=>{
 // Kinds the worker allows for a project-level source: if one is added there, a saved answer must still be restorable here.
 const worker=readFileSync(new URL('../repos/trato-worker/trato_worker/project_assistant.py',import.meta.url),'utf8');
 const kinds=worker.match(/source_kind'\) in \(([^)]*)\)/)[1].match(/[a-z_]+/g);
 assert.ok(kinds.includes('paypal'));
 for(const kind of [...kinds,'summary','original'])assert.equal(validateProjectAnswer(answer(kind),'p').sources[0].source_kind,kind);
 assert.throws(()=>validateProjectAnswer(answer('unknown'),'p'),/AI_JOB_INVALID/);
});
