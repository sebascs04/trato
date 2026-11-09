import test from 'node:test';
import assert from 'node:assert/strict';
import {distinctPayPalCitations,sendKeepingDraft} from '../project-assistant.mjs';

const value={sources:[{source_id:'pp',source_kind:'paypal'},{source_id:'doc',source_kind:'original'}],
 citations:[{source_id:'pp',quote:'one'},{source_id:'doc',quote:'two'},{source_id:'pp',quote:'three'},{source_id:'doc',quote:'four'}]};

test('the PayPal source is listed once and every document citation stays',()=>{
 assert.deepEqual(distinctPayPalCitations(value).map(citation=>citation.quote),['one','two','four']);
});

test('asking from the payment button sends once and keeps what the user was writing',()=>{
 const state={draft:'my own note'};let sent=0;
 sendKeepingDraft(state,()=>{sent++;state.draft='';return 'started';});
 assert.equal(sent,1);assert.equal(state.draft,'my own note');
});
