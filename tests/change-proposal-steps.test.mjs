import test from 'node:test';
import assert from 'node:assert/strict';
import {createChangeStepNavigation} from '../change-proposal-steps.mjs';
test('review waits for an actual ready draft, validates scope and price before final sending view',()=>{
 let ready=false;const checked=[],changes=[];let invalid='';
 const flow=createChangeStepNavigation({isReady:()=>ready,validate:name=>{checked.push(name);return name!==invalid;},changed:()=>changes.push(flow.step)});
 assert.equal(flow.next(),false);assert.equal(flow.step,0);ready=true;
 assert.equal(flow.next(),true);assert.equal(flow.step,1);
 invalid='scope';assert.equal(flow.next(),false);assert.equal(flow.step,1);
 invalid='';assert.equal(flow.next(),true);assert.equal(flow.step,2);
 invalid='deadline';assert.equal(flow.next(),false);assert.equal(flow.step,2);
 invalid='';assert.equal(flow.next(),true);assert.equal(flow.step,3);assert.equal(flow.next(),false);
 assert.deepEqual(changes,[1,2,3]);assert.ok(checked.includes('amount'));assert.ok(checked.includes('deadline'));
 assert.equal(flow.previous(),true);assert.equal(flow.step,2);
});
test('going back never escapes the first view or executes a send',()=>{
 let changed=0;const flow=createChangeStepNavigation({isReady:()=>true,validate:()=>true,changed:()=>changed++});
 assert.equal(flow.previous(),false);assert.equal(changed,0);flow.next();flow.previous();assert.equal(flow.step,0);assert.equal(changed,2);
});
