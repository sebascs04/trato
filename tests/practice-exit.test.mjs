import test from 'node:test';
import assert from 'node:assert/strict';
import {practiceFinishRequiresConfirmation} from '../practice-workspace.mjs';
test('an active conversation requires explicit confirmation',()=>{
 assert.equal(practiceFinishRequiresConfirmation({ended:false,messages:[{role:'user',text:'My reply'}]}),true);
});
test('an unfinished current analysis still requires confirmation even with previous feedback',()=>{
 for(const evaluationStatus of ['queued','running','failed'])assert.equal(practiceFinishRequiresConfirmation({ended:true,evaluationStatus,comparisonBaseline:{evaluation:{summary:'Previous completed feedback'}}}),true);
});
test('a completed first or repeated analysis can return directly to setup',()=>{
 for(const comparisonBaseline of [undefined,{evaluation:{summary:'Previous attempt'}}])assert.equal(practiceFinishRequiresConfirmation({ended:true,evaluation:{summary:'Current completed feedback'},comparisonBaseline}),false);
 assert.equal(practiceFinishRequiresConfirmation(null),false);
});
