import {test} from 'node:test';
import assert from 'node:assert/strict';
import {practiceAttempt,comparePracticeAttempts,repeatPracticeAttempt} from '../practice-comparison.mjs';
const fixture=(assessment='improvement',reply='My reply')=>({context:{scenario_id:'scope',output_language:'es',persona:{patience:3,flexibility:3,price_sensitivity:3},source_context:{agreement_version_id:'v1'},sources:{agreement:'Original terms'}},messages:[{role:'client',text:'Could you add this?'},{role:'user',text:reply}],evaluation:{model:'test-model',scope_id:'five-guides-v1',summary:'Specific feedback',items:[{message_index:1,assessment,evidence_quote:reply}]}});
test('comparison preserves earlier feedback and matches the same opening without inventing a score',()=>{
 const before=fixture(),after=fixture('strength','A clearer reply');const copy=structuredClone(before);
 const c=comparePracticeAttempts(before,after);assert.equal(c.comparable,true);assert.equal(c.before.improvement,1);assert.equal(c.after.strength,1);assert.equal(c.firstReply.client,'Could you add this?');assert.equal(c.firstReply.after,'A clearer reply');assert.deepEqual(before,copy);assert.equal('score' in c,false);
});
test('different evaluators or sources are flagged instead of claiming improvement',()=>{
 const a=fixture(),b=fixture('strength');b.evaluation.model='different-model';assert.equal(comparePracticeAttempts(a,b).reason,'evaluator');b.evaluation.model=a.evaluation.model;b.evaluation.scope_id='other-sources';assert.equal(comparePracticeAttempts(a,b).comparable,false);
});
test('changed context or language is not treated as the same practice situation',()=>{
 const a=fixture(),b=fixture();b.context.output_language='en';assert.equal(comparePracticeAttempts(a,b).reason,'context');assert.equal(comparePracticeAttempts(a,b).firstReply,null);
});
test('feedback must quote the actual reply and cover the actual user turns',()=>{
 const a=fixture();a.evaluation.items[0].evidence_quote='invented reply';assert.throws(()=>practiceAttempt(a));a.evaluation.items=[];assert.throws(()=>practiceAttempt(a));
});
test('different conversation lengths remain explicit and a snapshot does not recursively retain past attempts',()=>{
 const a=fixture(),b=fixture();b.messages.push({role:'client',text:'A different next question'},{role:'user',text:'My second reply'});b.evaluation.items.push({message_index:3,assessment:'insufficient_evidence',evidence_quote:'second reply'});b.comparisonBaseline=a;const c=comparePracticeAttempts(a,b);assert.equal(c.before.total,1);assert.equal(c.after.total,2);assert.equal(c.after.insufficient_evidence,1);assert.equal('comparisonBaseline' in practiceAttempt(b),false);
});

test('repeat starts with only the same client opening and an immutable feedback snapshot',()=>{
 const old=fixture(),next=repeatPracticeAttempt(old);assert.equal(next.ended,false);assert.deepEqual(next.messages,[old.messages[0]]);assert.equal(next.context.output_language,'es');assert.deepEqual(next.context.persona,old.context.persona);assert.deepEqual(next.comparisonBaseline.evaluation,old.evaluation);old.messages[0].text='changed';old.evaluation.summary='changed';assert.equal(next.messages[0].text,'Could you add this?');assert.equal(next.comparisonBaseline.evaluation.summary,'Specific feedback');
});

test('comparison detail shows both attempts and escapes their original text',async()=>{
 const {renderPracticeComparisonDetail}=await import('../practice-workspace.mjs');
 const previous=fixture(),current=fixture('strength','<script>reply</script>');current.comparisonBaseline=previous;
 previous.evaluation.summary='Before <summary>';current.evaluation.summary='After & review';
 const summaries=renderPracticeComparisonDetail(current,'summaries');assert.match(summaries.html,/Before &lt;summary&gt;/);assert.match(summaries.html,/After &amp; review/);
 const reply=renderPracticeComparisonDetail(current,'reply');assert.match(reply.html,/&lt;script&gt;reply&lt;\/script&gt;/);assert.equal(reply.html.includes('<script>'),false);
});
test('comparison detail does not present different openings as the same question',async()=>{
 const {renderPracticeComparisonDetail}=await import('../practice-workspace.mjs');
 const current=fixture();current.comparisonBaseline=fixture();current.context.output_language='en';
 assert.throws(()=>renderPracticeComparisonDetail(current,'reply'));assert.throws(()=>renderPracticeComparisonDetail(current,'unknown'));
});
