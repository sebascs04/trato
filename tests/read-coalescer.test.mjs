import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createReadCoalescer} from '../auth-session.mjs';

test('identical reads in flight share one request and each caller gets its own copy',async()=>{
 let calls=0;const reads=createReadCoalescer();
 const load=async()=>{calls++;return {items:[1]};};
 const [a,b]=await Promise.all([reads.read('k',load),reads.read('k',load)]);
 assert.equal(calls,1);assert.deepEqual(a,b);assert.notEqual(a,b);
});
test('a recent answer is reused only within the window',async()=>{
 let calls=0,time=0;const reads=createReadCoalescer({ttlMs:2000,now:()=>time});
 const load=async()=>++calls;
 await reads.read('k',load);time=1999;assert.equal(await reads.read('k',load),1);
 time=2000;assert.equal(await reads.read('k',load),2);
});
test('a change clears remembered reads and different keys never mix',async()=>{
 let calls=0;const reads=createReadCoalescer();const load=async()=>++calls;
 await reads.read('a',load);await reads.read('b',load);assert.equal(calls,2);
 reads.clear();await reads.read('a',load);assert.equal(calls,3);
});
test('a failed read is not remembered',async()=>{
 let calls=0;const reads=createReadCoalescer();
 await assert.rejects(reads.read('k',async()=>{calls++;throw new Error('down');}));
 assert.equal(await reads.read('k',async()=>{calls++;return 'ok';}),'ok');assert.equal(calls,2);
});
