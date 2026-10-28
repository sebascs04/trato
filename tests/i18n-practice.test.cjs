const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
test('translation keys and interpolation errors remain explicit',async()=>{
 const {uiText}=await import('../i18n.mjs');
 assert.equal(uiText('practice.level',{value:2}),'Nivel 2 de 5');
 assert.throws(()=>uiText('unknown-test-key'),/Missing translation/);
 assert.throws(()=>uiText('practice.level'),/Missing translation parameter/);
});
test('rehearsal configuration validates temperament and uses normalized project sources',async()=>{
 const {validatePracticeSettings,buildPracticeContext}=await import('../practice-workspace.mjs');
 const data=JSON.parse(readFileSync(new URL('../data/demo.json',`file://${__filename}`),'utf8'));
 const config={version:1,scenario:'scope',persona:{patience:1,flexibility:5,price:3},goal:'Mi objetivo'};
 const en=buildPracticeContext(config,data,'en');
 assert.equal(en.output_language,'en');assert.equal(en.persona.price_sensitivity,3);assert.equal(en.affects_business_state,false);assert.deepEqual(en.allowed_tools,[]);
 assert.equal(en.sources.request,data.messages.find(m=>m.id===en.source_context.message_id).content);
 assert.throws(()=>validatePracticeSettings({...config,persona:{...config.persona,patience:0}}));
 assert.throws(()=>validatePracticeSettings({...config,persona:{...config.persona,patience:2.5}}));
 assert.throws(()=>buildPracticeContext(config,data,'fr'),/Unsupported rehearsal language/);
 const bad=structuredClone(data);bad.conversations.find(c=>c.id===bad.messages.find(m=>m.id===en.source_context.message_id).conversationId).projectId='other';
 assert.throws(()=>buildPracticeContext(config,bad,'es'));
});

test('rehearsal instructions are canonical English with explicit output language and original sources',async()=>{
 const {buildPracticeContext,buildPracticePrompt}=await import('../practice-workspace.mjs');
 const data=JSON.parse(readFileSync(new URL('../data/demo.json',`file://${__filename}`),'utf8'));
 const config={version:1,scenario:'scope',persona:{patience:1,flexibility:5,price:3}};
 const es=buildPracticeContext(config,data,'es'),en=buildPracticeContext(config,data,'en');
 const spanish=buildPracticePrompt(es),english=buildPracticePrompt(en);
 assert.equal(spanish.replace('"output_language": "es"','"output_language": "en"'),english);
 assert.ok(spanish.includes(es.sources.request));
 for(const section of ['## ROLE','## CONTEXT','## PRE-TASK CHECKLIST','## TASK','## FORMAT'])assert.ok(spanish.includes(section));
 assert.ok(spanish.includes('Generate your message directly in output_language'));
 assert.throws(()=>buildPracticePrompt({...es,output_language:'fr'}),/Unsupported rehearsal output language/);
});
