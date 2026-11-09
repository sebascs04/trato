import {webcrypto} from 'node:crypto';
globalThis.crypto=webcrypto;
import test from 'node:test';
import assert from 'node:assert/strict';
import {closeDrafts,draftMarkup} from '../portal-assistant.mjs';

test('a draft can be sent until a change request goes out, and then says what happened to it',()=>{
 const messages=[{role:'assistant',draft:'First'},{role:'assistant',draft:'Second'},{role:'assistant',text:'No draft',draft:''}];
 assert.match(draftMarkup(messages[0],0),/data-assistant-draft="0"/);
 assert.equal(draftMarkup(messages[2],2),'');
 closeDrafts(messages,1);
 assert.doesNotMatch(draftMarkup(messages[1],1),/data-assistant-draft/,'it cannot be sent twice');
 assert.match(draftMarkup(messages[1],1),/portal-assistant-draft-sent/,'the one used says it was sent');
 assert.doesNotMatch(draftMarkup(messages[0],0),/data-assistant-draft|portal-assistant-draft-sent/,'another draft is closed without claiming it was sent');
 assert.match(draftMarkup(messages[0],0),/First/,'its text stays readable');
});

test('a request written by hand closes the drafts without marking one as sent',()=>{
 const messages=[{role:'assistant',draft:'Draft'}];
 closeDrafts(messages,null);
 assert.equal(messages[0].sent,false);
 assert.doesNotMatch(draftMarkup(messages[0],0),/data-assistant-draft/);
});
