import {webcrypto} from 'node:crypto';
globalThis.crypto=webcrypto;
import test from 'node:test';
import assert from 'node:assert/strict';
import {requestedDeadline} from '../change-proposal-assistant.mjs';

test('a new version starts with the date the client asked for, never an old or invented one',()=>{
 assert.equal(requestedDeadline({suggested_deadline:'2026-11-13'},'revise','2026-11-09'),'2026-11-13');
 assert.equal(requestedDeadline({suggested_deadline:null},'revise','2026-11-09'),null);
 assert.equal(requestedDeadline({suggested_deadline:'2026-11-01'},'revise','2026-11-09'),null,'a past date stays out');
 assert.equal(requestedDeadline({suggested_deadline:'Friday'},'revise','2026-11-09'),null);
 assert.equal(requestedDeadline({suggested_deadline:'2026-11-13'},'create','2026-11-09'),null,'only after a client reply');
});
