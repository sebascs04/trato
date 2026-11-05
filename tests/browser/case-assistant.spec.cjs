// Real frontend component and browser, explicit API doubles; no provider calls.
const {test,expect}=require('@playwright/test');
const ctx={project:'project-a',kind:'change',id:'case-a',revision:'revision-a'};
async function setup(page,{delay=false,language='es',sourceFailure=false}={}){
 const calls=[],messages=[],payloads=new Map();let first=true,failedId=null;
 await page.addInitScript(lang=>localStorage.setItem('trato:ui-language',lang),language);
 await page.route('**/api/v1/projects/*/sources*',route=>route.fulfill({json:{data:{files:[{id:'document-a',title:'Acuerdo listo',summary_status:'ready'},{id:'document-pending',title:'Aceptación pendiente',summary_status:'pending'}],total:2,next_offset:null}}}));
 await page.route('**/api/v1/ai/case-sessions**' ,async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;calls.push({path,method:req.method(),key:req.headers()['idempotency-key'],body:req.postData()?req.postDataJSON():null});
  let data;
  if(path.endsWith('/case-sessions')){
   if(delay)await new Promise(resolve=>setTimeout(resolve,300));
   data={id:'session-a',project_id:'project-a',case_kind:'change',case_id:'case-a',revision_id:'revision-a',stale:false,messages};
  }else if(path.endsWith('/messages')){
   if(first&&!sourceFailure){first=false;await route.fulfill({status:503,json:{error:{code:'UPSTREAM_UNAVAILABLE'}}});return;}
   const id=req.headers()['idempotency-key'];payloads.set(id,req.postDataJSON());
   if(sourceFailure&&first){first=false;failedId=id;}
   data={id,status:'queued'};
  }else {
   const id=path.split('/').pop();
   if(id===failedId){await route.fulfill({json:{data:{id,status:'failed',error_code:'VECTOR_INDEX_INCOMPLETE'}}});return;}
   const result={case_context:{session_id:'session-a',project_id:'project-a',case_kind:'change',case_id:'case-a',revision_id:'revision-a'},kind:'project_assistant',project_id:'project-a',question:'What is included?',status:'answered',answer:'Two revisions are included.',missing_information:[],citations:[{source_id:'evidence',quote:'two revisions'}],sources:[{source_id:'evidence',file_id:'document-a',source_kind:'original',title:'Agreement',locator:{kind:'page',page:1}}]};
   if(payloads.get(id)?.document_ids)result.source_scope={document_ids:payloads.get(id).document_ids};
   if(!messages.some(m=>m.job_id===id))messages.push({job_id:id,status:'completed',question:result.question,result});
   data={id,status:'completed',result};
  }
  await route.fulfill({json:{data}});
 });
 await page.route('**/__case-assistant-test',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/project-assistant.css"><link rel="stylesheet" href="/practice-workspace.css"><link rel="stylesheet" href="/ai-activity.css"></head><body></body></html>'}));
 await page.goto('/__case-assistant-test');
 await page.evaluate(async ctx=>{
  const {installCaseAssistant}=await import('/case-assistant.mjs');
  document.body.innerHTML='<main id="test-assistant"></main><button id="background-action">Background action</button>';
  const cloud={active:true,navigationOwner:'owner-a',projectId:'project-a',document,reset(){},notify(){document.querySelector('main').innerHTML=this.renderCaseAssistant(window.caseContext);},async request(path,options){const response=await fetch(path,options),value=await response.json();if(!response.ok){const err=Error(value.error.code);err.code=value.error.code;throw err;}return value.data;},previewDocument(id){window.previewed=id;},run(fn){return fn();}};
  window.caseContext=ctx;window.testCloud=cloud;installCaseAssistant(cloud);cloud.notify();
 },ctx);
 return calls;
}
test('case assistant retries uncertain request with the same key and restores durable answers',async({page})=>{
 const calls=await setup(page);
 await page.locator('[data-case-action="toggle"]').click();await expect(page.locator('[data-case-question] textarea')).toBeEnabled();
 await page.locator('[data-case-question] textarea').fill('What is included?');await page.locator('[data-case-question] button').click();
 await expect(page.locator('[data-case-action="retry"]')).toBeVisible();await page.evaluate(async()=>{(await import('/i18n.mjs')).setUiLanguage('en');window.testCloud.notify();});await page.locator('[data-case-action="retry"]').click();
 await expect(page.locator('.case-agent-message:not(.is-user) .case-agent-bubble')).toContainText('Two revisions are included.');
 const writes=calls.filter(c=>c.path.endsWith('/messages'));expect(writes).toHaveLength(2);expect(writes[0].key).toBe(writes[1].key);expect(writes[0].body).toEqual(writes[1].body);
 await page.locator('.case-agent-message:not(.is-user) .case-agent-bubble summary').click();await page.locator('[data-case-action="source"]').click();expect(await page.evaluate(()=>window.previewed)).toBe('document-a');
 await page.keyboard.press('Escape');await expect(page.locator('.case-assistant-drawer')).not.toBeVisible();await page.evaluate(()=>{window.testCloud.reset();window.testCloud.notify();});await page.locator('[data-case-action="toggle"]').click();await expect(page.locator('.case-agent-message:not(.is-user) .case-agent-bubble')).toContainText('Two revisions are included.');
});
test('a delayed session response cannot enter another case panel',async({page})=>{
 await setup(page,{delay:true});await page.locator('[data-case-action="toggle"]').click();
 await page.evaluate(()=>{window.caseContext={...window.caseContext,id:'case-b'};window.testCloud.notify();});
 await page.waitForTimeout(400);await expect(page.locator('[data-case-assistant]')).toHaveAttribute('data-case-assistant','owner-a:project-a:change:case-b:revision-a');await expect(page.locator('.case-agent-message:not(.is-user) .case-agent-bubble')).toHaveCount(0);
});

for(const mobile of [false,true])test(`agent drawer geometry focus and draft survive closing (${mobile?'mobile':'desktop'})`,async({page})=>{
 if(mobile)await page.setViewportSize({width:390,height:844});
 const calls=await setup(page);const trigger=page.locator('[data-case-action="toggle"]');
 await expect(trigger).toContainText('Agente de cambios');await trigger.click();
 const drawer=page.locator('.case-assistant-drawer');await expect(drawer).toBeVisible();
 const view=page.viewportSize();await expect.poll(async()=>{const rect=await drawer.boundingBox();return Math.abs(rect.x+rect.width-view.width);}).toBeLessThan(1);const box=await drawer.boundingBox();expect(Math.abs(box.x+box.width-view.width)).toBeLessThan(1);expect(Math.abs(box.height-view.height)).toBeLessThan(2);expect(box.width).toBeLessThanOrEqual(520.01);if(mobile)expect(Math.abs(box.width-view.width)).toBeLessThan(1);
 const close=page.locator('[data-case-action="close"]'),closeBox=await close.boundingBox();expect(closeBox.width).toBeGreaterThanOrEqual(36);expect(closeBox.height).toBeGreaterThanOrEqual(36);
 await expect(page.locator('[data-case-question] textarea')).toBeEnabled();
 await page.locator('[data-case-question] textarea').fill('Keep this draft');
 await page.keyboard.press('Shift+Enter');await expect(page.locator('[data-case-question] textarea')).toHaveValue('Keep this draft\n');
 const before=calls.length;await page.keyboard.press('Escape');await expect(drawer).not.toBeVisible();await expect(trigger).toBeFocused();
 await trigger.click();await expect(page.locator('[data-case-question] textarea')).toHaveValue('Keep this draft\n');expect(calls).toHaveLength(before);
 await page.keyboard.press('Tab');expect(await page.evaluate(()=>document.querySelector('.case-assistant-drawer').contains(document.activeElement))).toBe(true);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await expect.poll(async()=>{const rect=await drawer.boundingBox();return Math.abs(rect.x+rect.width-view.width);}).toBeLessThan(.1);
 await page.screenshot({path:`.local/browser-tests/case-agent-${mobile?'mobile':'desktop'}.png`,fullPage:true});
 await close.click();await expect(drawer).not.toBeVisible();await expect(trigger).toBeFocused();
 if(!mobile){await trigger.click();await page.mouse.click(10,100);await expect(drawer).not.toBeVisible();await expect(trigger).toBeFocused();}
});

for(const language of ['es','en'])test(`contextual agent labels stay clear (${language})`,async({page})=>{
 const calls=await setup(page,{language});
 await expect(page.locator('[data-case-action="toggle"]')).toContainText(language==='es'?'Agente de cambios':'Change agent');
 await page.evaluate(()=>{window.caseContext={...window.caseContext,kind:'refund',revision:null};window.testCloud.notify();});
 await expect(page.locator('[data-case-action="toggle"]')).toContainText(language==='es'?'Agente de devoluciones':'Refund agent');
 expect(calls).toHaveLength(0);
});

test('agent and document preview stack above the refund dialog',async({page})=>{
 await setup(page);
 await page.evaluate(()=>{
  const base=document.createElement('dialog');base.id='refund-test-dialog';base.innerHTML='<main id="test-assistant"></main>';document.querySelector('main').remove();document.body.append(base);base.showModal();window.testCloud.notify();
  window.testCloud.previewDocument=id=>{window.previewed=id;const preview=document.createElement('dialog');preview.id='document-preview';preview.innerHTML='<p>Original agreement</p><button autofocus>Close document</button>';preview.querySelector('button').onclick=()=>preview.close();document.body.append(preview);preview.showModal();};
 });
 await page.locator('[data-case-action="toggle"]').click();await expect(page.locator('[data-case-question] textarea')).toBeEnabled();
 await page.locator('[data-case-question] textarea').fill('What is included?');await page.locator('[data-case-question] button[type="submit"]').click();
 await page.locator('[data-case-action="retry"]').click();await expect(page.locator('.case-agent-message:not(.is-user) .case-agent-bubble')).toContainText('Two revisions are included.');
 await page.locator('.case-agent-bubble summary').click();await page.locator('[data-case-action="source"]').click();
 await expect(page.locator('#document-preview')).toBeVisible();expect(await page.evaluate(()=>document.querySelector('#document-preview').matches(':modal'))).toBe(true);
 await page.keyboard.press('Escape');await expect(page.locator('#document-preview')).not.toBeVisible();await expect(page.locator('.case-assistant-drawer')).toBeVisible();await expect(page.locator('[data-case-action="source"]')).toBeFocused();
 await page.keyboard.press('Escape');await expect(page.locator('.case-assistant-drawer')).not.toBeVisible();await expect(page.locator('#refund-test-dialog')).toBeVisible();await expect(page.locator('[data-case-action="toggle"]')).toBeFocused();
});

test('case selection is explicit and retries a blocked question with a new scoped job',async({page})=>{
 const calls=await setup(page,{sourceFailure:true});
 await page.locator('[data-case-action="toggle"]').click();await expect(page.locator('[data-case-question] textarea')).toBeEnabled();
 await page.locator('[data-case-question] textarea').fill('What is included?');await page.locator('[data-case-question] button').click();
 await expect(page.locator('.case-agent-error')).toContainText('Prepara los documentos');
 expect(calls.filter(c=>c.path.endsWith('/messages'))).toHaveLength(1);
 await page.locator('[data-case-action="choose-documents"]').first().click();await expect(page.locator('[data-case-action="use-ready"]')).toBeVisible();
 await page.locator('[data-agent-document-choice] summary').click();await expect(page.locator('[data-agent-document-choice]')).toContainText('Acuerdo listo');await expect(page.locator('[data-agent-document-choice]')).toContainText('Aceptación pendiente');
 await page.locator('[data-case-action="use-ready"]').click();await expect(page.locator('[data-agent-document-scope]')).toContainText('Documentos elegidos: 1');
 expect(calls.filter(c=>c.path.endsWith('/messages'))).toHaveLength(1);
 await page.locator('[data-case-action="retry"]').click();await expect(page.locator('.case-agent-message:not(.is-user) .case-agent-bubble')).toContainText('Two revisions');
 const writes=calls.filter(c=>c.path.endsWith('/messages'));expect(writes).toHaveLength(2);expect(writes[0].body.document_ids).toBeUndefined();expect(writes[1].body.document_ids).toEqual(['document-a']);expect(writes[1].key).not.toBe(writes[0].key);
 await expect(page.locator('[data-answer-document-scope]')).toContainText('Documentos elegidos: 1');await page.evaluate(()=>{window.testCloud.reset();window.testCloud.notify();});await page.locator('[data-case-action="toggle"]').click();await expect(page.locator('[data-answer-document-scope]')).toContainText('Documentos elegidos: 1');
});
test('scoped uncertain submission retains its original IDs and idempotency key',async({page})=>{
 const calls=await setup(page);await page.locator('[data-case-action="toggle"]').click();await expect(page.locator('[data-case-question] textarea')).toBeEnabled();
 await page.locator('[data-case-action="choose-documents"]').click();await page.locator('[data-case-action="use-ready"]').click();
 await page.locator('[data-case-question] textarea').fill('What is included?');await page.locator('[data-case-question] button').click();
 await expect(page.locator('[data-case-action="retry"]')).toBeVisible();await expect(page.locator('[data-case-action="all-documents"]')).toBeDisabled();
 await page.locator('[data-case-action="retry"]').click();await expect(page.locator('.case-agent-message:not(.is-user) .case-agent-bubble')).toContainText('Two revisions');
 const writes=calls.filter(c=>c.path.endsWith('/messages'));expect(writes).toHaveLength(2);expect(writes[0].body.document_ids).toEqual(['document-a']);expect(writes[1].body).toEqual(writes[0].body);expect(writes[1].key).toBe(writes[0].key);
});
