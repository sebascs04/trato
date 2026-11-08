const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
test('translation keys and interpolation errors remain explicit',async()=>{
 const {uiText,textForLanguage}=await import('../i18n.mjs');
 assert.equal(uiText('practice.level',{value:2}),'Nivel 2 de 5');
 assert.equal(textForLanguage('en','practice.level',{value:2}),'Level 2 of 5');
 assert.throws(()=>uiText('unknown-test-key'),/Missing translation/);
 assert.throws(()=>textForLanguage('fr','practice.level'),/Unsupported Trato language/);
 assert.throws(()=>textForLanguage('en','unknown-test-key'),/Missing translation/);
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
test('rehearsal cases come from the shared bank in the chosen language; settings without a case keep the fixture',async()=>{
 const {buildPracticeContext,practiceCases,validatePracticeSettings}=await import('../practice-workspace.mjs');
 const data=JSON.parse(readFileSync(new URL('../data/demo.json',`file://${__filename}`),'utf8'));
 const bank=JSON.parse(readFileSync(new URL('../data/rehearsal-cases.json',`file://${__filename}`),'utf8'));
 for(const scenario of ['scope','payment','refund'])assert.equal(practiceCases(scenario,bank).length,5);
 const config={version:1,scenario:'scope',persona:{patience:3,flexibility:3,price:3},caseId:'scope-web',hiddenIntent:true};
 const en=buildPracticeContext(config,data,'en',bank),es=buildPracticeContext(config,data,'es',bank);
 assert.deepEqual(en.source_context,{kind:'rehearsal_case',case_id:'scope-web'});
 assert.equal(en.sources.request,bank.scenarios.scope.cases.find(c=>c.id==='scope-web').request.en);
 assert.equal(es.sources.request,bank.scenarios.scope.cases.find(c=>c.id==='scope-web').request.es);
 assert.equal(en.hidden_intent,true);assert.equal(en.case_theme,'Café website');
 assert.throws(()=>buildPracticeContext({...config,caseId:'payment-web'},data,'en',bank));
 assert.throws(()=>validatePracticeSettings({...config,hiddenIntent:'yes'}));
 const {caseId,hiddenIntent,...legacy}=config;
 assert.equal(buildPracticeContext(legacy,data,'es',bank).source_context.kind,'fixture');
});
test('runtime dialogue instructions stay in the worker with explicit output language',()=>{
 const prompt=readFileSync(new URL('../repos/trato-worker/trato_worker/rehearsal_dialogue.py',`file://${__filename}`),'utf8');
 const frontend=readFileSync(new URL('../practice-workspace.mjs',`file://${__filename}`),'utf8');
 for(const section of ['## ROLE','## CONTEXT','## PRE-TASK CHECKLIST','## TASK','## FORMAT'])assert.ok(prompt.includes(section));
 assert.ok(prompt.includes('output_language'));assert.ok(prompt.includes('no fixed number of turns'));
 assert.equal(frontend.includes('## ROLE'),false);assert.equal(frontend.includes('scriptedPracticeLine'),false);
});

test('rehearsal prompt follows its explicit language independently of the UI locale',async()=>{
 const {buildPracticeContext}=await import('../practice-workspace.mjs');
 const {setUiLanguage,uiLanguage}=await import('../i18n.mjs');
 const data=JSON.parse(readFileSync(new URL('../data/demo.json',`file://${__filename}`),'utf8'));
 const config={version:1,scenario:'scope',persona:{patience:1,flexibility:5,price:3}};
 const previous={window:global.window,document:global.document,language:uiLanguage()};
 global.window={localStorage:{setItem(){}}};
 global.document={documentElement:{lang:'es'}};
 try{
  setUiLanguage('es');
  const englishContext=buildPracticeContext(config,data,'en'),english=JSON.stringify(englishContext,null,2);
  assert.equal(englishContext.output_language,'en');
  assert.ok(english.includes(englishContext.sources.request));
  assert.ok(english.includes(englishContext.sources.agreement));
  assert.match(english,/"output_language": "en"/);
  setUiLanguage('en');
  const spanishContext=buildPracticeContext(config,data,'es'),spanish=JSON.stringify(spanishContext,null,2);
  assert.equal(spanishContext.output_language,'es');
  assert.ok(spanish.includes(spanishContext.sources.request));
  assert.ok(spanish.includes(spanishContext.sources.agreement));
  assert.match(spanish,/"output_language": "es"/);
  assert.throws(()=>buildPracticeContext(config,data,'fr'),/Unsupported rehearsal language/);
 }finally{
  setUiLanguage(previous.language);
  if(previous.window===undefined)delete global.window;else global.window=previous.window;
  if(previous.document===undefined)delete global.document;else global.document=previous.document;
 }
});

test('client accounts rehearse client-side situations from the bank, with role-specific texts',async()=>{
 const {buildPracticeContext,practiceCases,setPracticeRole,practiceInfoContent}=await import('../practice-workspace.mjs');
 const data=JSON.parse(readFileSync(new URL('../data/demo.json',`file://${__filename}`),'utf8'));
 const bank=JSON.parse(readFileSync(new URL('../data/rehearsal-cases.json',`file://${__filename}`),'utf8'));
 for(const scenario of ['change','deadline','delivery'])assert.equal(practiceCases(scenario,bank).length,3);
 const config={version:1,scenario:'change',persona:{patience:3,flexibility:3,price:3},caseId:'change-website',hiddenIntent:true};
 const en=buildPracticeContext(config,data,'en',bank);
 assert.deepEqual(en.source_context,{kind:'rehearsal_case',case_id:'change-website'});
 assert.equal(en.case_theme,'Shop website');
 const {caseId,...noCase}=config;
 assert.throws(()=>buildPracticeContext(noCase,data,'en',bank));
 try{
  setPracticeRole('client');
  assert.match(practiceInfoContent('intent').html,/freelancer/);
 }finally{setPracticeRole('freelancer');}
 assert.doesNotMatch(practiceInfoContent('intent').html,/freelancer del ensayo/);
});
