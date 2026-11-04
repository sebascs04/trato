import test from 'node:test';
import assert from 'node:assert/strict';
import {chatScrollPosition,restoreChatScroll} from '../ai-activity.mjs';
test('new replies follow when the reader is near the bottom',()=>{const old={scrollTop:650,scrollHeight:1000,clientHeight:300};const next={scrollHeight:1400};restoreChatScroll(next,chatScrollPosition(old));assert.equal(next.scrollTop,1400);});
test('reading older messages retains the same scroll position',()=>{const old={scrollTop:120,scrollHeight:1000,clientHeight:300};const next={scrollHeight:1400};restoreChatScroll(next,chatScrollPosition(old));assert.equal(next.scrollTop,120);});
test('a newly opened conversation starts at the latest message',()=>{const next={scrollHeight:1400};restoreChatScroll(next,null);assert.equal(next.scrollTop,1400);});
