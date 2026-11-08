import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assistantHistory} from '../portal-assistant.mjs';

const user=text=>({role:'user',text}),bot=text=>({role:'assistant',text});

test('history sends complete question and answer pairs, oldest first',()=>{
 assert.deepEqual(assistantHistory([user('a'),bot('b'),user('c'),bot('d')]),[user('a'),bot('b'),user('c'),bot('d')]);
});
test('a question still waiting for its answer is left out',()=>{
 assert.deepEqual(assistantHistory([user('a'),bot('b'),user('c')]),[user('a'),bot('b')]);
});
test('history stays within the twelve turns the API accepts and starts with the client',()=>{
 const long=[];for(let i=0;i<20;i++)long.push(user('q'+i),bot('a'+i));
 const turns=assistantHistory(long);
 assert.equal(turns.length,12);assert.equal(turns[0].role,'user');assert.equal(turns[0].text,'q14');assert.equal(turns.at(-1).text,'a19');
});
test('fields that belong to the screen never travel in the history',()=>{
 assert.deepEqual(assistantHistory([user('a'),{...bot('b'),draft:'x',sources:['scope']}]),[user('a'),bot('b')]);
});
