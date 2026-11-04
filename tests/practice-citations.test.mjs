import test from 'node:test';
import assert from 'node:assert/strict';
import {groupPracticeCitations} from '../practice-workspace.mjs';
const cite=(quote,extra={})=>({file_id:'guide-a',author:'Author',title:'Guide',url:'https://example.invalid/guide',quote,locator:{kind:'page',page:1},...extra});
test('one source header contains its distinct exact excerpts',()=>{const groups=groupPracticeCitations([cite('First exact passage.'),cite('Second exact passage.'),cite('First exact passage.')]);assert.equal(groups.length,1);assert.deepEqual(groups[0].excerpts.map(c=>c.quote),['First exact passage.','Second exact passage.']);});
test('different source identities and locators are preserved',()=>{const groups=groupPracticeCitations([cite('A passage.'),cite('A passage.',{locator:{kind:'page',page:2}}),cite('Another guide.',{file_id:'guide-b'})]);assert.equal(groups.length,2);assert.equal(groups[0].excerpts.length,2);assert.equal(groups[1].file_id,'guide-b');});
