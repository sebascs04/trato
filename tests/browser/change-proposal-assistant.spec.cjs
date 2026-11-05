const {test,expect}=require('@playwright/test');
async function setup(page){
 const calls=[],jobs=new Map();
 await page.route('**/api/v1/documents/*/file',route=>route.fulfill({contentType:'application/pdf',body:'%PDF-1.4\n%%EOF'}));
 await page.route('**/api/v1/projects/project-a/sources*',route=>route.fulfill({json:{data:{files:[{id:'doc-a',title:'Acuerdo',summary_status:'ready'},{id:'pending',title:'Pendiente',summary_status:'pending'}],total:2,next_offset:null}}}));
 const sources=[{source_id:'source',file_id:'doc-a',title:'Acuerdo',source_kind:'original'}],citations=[{source_id:'source',quote:'una página adicional'}];
 await page.route('**/api/v1/ai/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname,body=req.postData()?req.postDataJSON():null;calls.push({path,method:req.method(),body,key:req.headers()['idempotency-key']});
  let data;
  if(path.endsWith('/price'))data={additional_minor:2500,currency:'USD',rate_minor:body.rate_minor,confirmed_hours:body.confirmed_hours};
  else if(req.method()==='POST'){
   const id=req.headers()['idempotency-key'],draft=path.endsWith('/change-proposals');
   jobs.set(id,draft?{kind:'change_proposal',project_id:'project-a',request_document_id:'request-a',status:'ready',scope_summary:'Una página adicional',conditions:'Una revisión incluida',description:'Página',estimated_hours:'2.5',suggested_deadline:null,reasoning:'El pedido añade una página.',missing_information:[],sources,citations}:{kind:'project_assistant',project_id:'project-a',status:'answered',question:body.question,answer:'El pedido añade una página.',sources,citations,missing_information:[]});data={id,status:'queued'};
  }else{const id=path.split('/').pop();data={id,status:'completed',result:jobs.get(id)};}
  await route.fulfill({json:{data}});
 });
 await page.route('**/__change-draft-test',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/project-assistant.css"><link rel="stylesheet" href="/ai-activity.css"></head><body></body></html>'}));
 await page.goto('/__change-draft-test');
 await page.evaluate(async()=>{
  (await import('/i18n.mjs')).setUiLanguage('es');
  document.body.innerHTML='<main><section id="modal"><form data-cloud-form="proposal-terms"><textarea name="scope">Borrador manual</textarea><textarea name="conditions"></textarea><input name="description"><input name="amount"><input name="deadline" type="date"><button type="button" data-change-draft-action="open">Preparar con Trato</button></form></section></main>';
  const cloud={active:true,navigationOwner:'owner-a',projectId:'project-a',requestId:'request-a',documents:[{id:'request-a',title:'Pedido'}],proposalForm:{mode:'create'},document,modal:document.querySelector('#modal'),reset(){},run(fn){return fn();},previewDocument(id){window.previewed=id;},async request(path,options,binary=false){const response=await fetch(path,options);if(binary)return response.blob();const value=await response.json();if(!response.ok)throw Error(value.error.code);return value.data;}};
  window.testCloud=cloud;(await import('/change-proposal-assistant.mjs')).installChangeProposalAssistant(cloud);
 });
 return calls;
}
test('question, cited proposal, confirmed calculation and explicit application reuse existing form',async({page})=>{
 const calls=await setup(page);await page.locator('[data-change-draft-action="open"]').click();
 await page.locator('[data-change-draft-action="choose"]').click();expect(calls.filter(c=>c.method==='POST')).toHaveLength(0);
 await page.locator('#change-draft-question').fill('¿Qué añade el cliente?');await page.locator('[data-change-draft-question] button[type="submit"]').click();
 await expect(page.locator('.case-agent-message:not(.is-user)')).toContainText('El pedido añade una página.');
 await page.locator('[data-change-draft-action="draft"]').click();await expect(page.locator('[data-change-draft-result]')).toContainText('Una página adicional');
 const draft=calls.find(c=>c.path==='/api/v1/ai/change-proposals'&&c.method==='POST');expect(draft.body.document_ids).toEqual(['doc-a']);expect(draft.body.history_ids).toHaveLength(1);
 await expect(page.locator('#modal [name="scope"]')).toHaveValue('Borrador manual');await page.locator('[data-change-draft-result] details').click();await page.locator('[data-change-draft-result] [data-change-draft-action="source"]').click();await expect(page.locator('.pdf-preview')).toBeVisible();await expect(page.locator('#modal [name="scope"]')).toHaveValue('Borrador manual');await page.locator('[data-change-draft-preview-close]').click();
 await page.locator('#change-draft-question').fill('¿Por qué estimaste ese esfuerzo?');await page.locator('[data-change-draft-question] button[type="submit"]').click();await expect(page.locator('.case-agent-message:not(.is-user)')).toHaveCount(2);const followup=calls.filter(c=>c.path==='/api/v1/ai/project-questions').at(-1);expect(followup.body.change_proposal_job_id).toBe(draft.key);
 await page.locator('[data-change-draft-price] [name="rate"]').fill('10');await page.locator('[data-change-draft-price] button').click();
 await expect(page.locator('[data-change-draft-action="apply"]')).toBeVisible();
 await page.locator('[data-change-draft-action="apply"]').click();await expect(page.locator('.change-draft-agent')).not.toBeVisible();
 await expect(page.locator('#modal [name="scope"]')).toHaveValue('Una página adicional');await expect(page.locator('#modal [name="amount"]')).toHaveValue('25.00');await expect(page.locator('#modal [name="deadline"]')).toHaveValue('');
 expect(calls.filter(c=>c.path.endsWith('/price'))).toHaveLength(2);expect(calls.some(c=>c.path.includes('/proposals/')||c.path.includes('/send'))).toBe(false);
});
test('editing reviewed effort invalidates the prior price before applying',async({page})=>{
 await setup(page);await page.locator('[data-change-draft-action="open"]').click();await page.locator('[data-change-draft-action="choose"]').click();await page.locator('[data-change-draft-action="draft"]').click();await expect(page.locator('[data-change-draft-price]')).toBeVisible();await page.locator('[data-change-draft-price] [name="rate"]').fill('10');await page.locator('[data-change-draft-price] button').click();await expect(page.locator('[data-change-draft-action="apply"]')).toBeVisible();await page.locator('[data-change-draft-price] [name="hours"]').fill('4');await expect(page.locator('[data-change-draft-action="apply"]')).toHaveCount(0);await expect(page.locator('#modal [name="amount"]')).toHaveValue('');
});
test('confirmed failure restores the original question without resubmitting it',async({page})=>{
 const calls=await setup(page);await page.route('**/api/v1/ai/jobs/*',route=>route.fulfill({json:{data:{id:new URL(route.request().url()).pathname.split('/').pop(),status:'failed',error_code:'MODEL_REQUEST_FAILED'}}}));await page.locator('[data-change-draft-action="open"]').click();await page.locator('[data-change-draft-action="choose"]').click();await page.locator('#change-draft-question').fill('¿Qué incluye el acuerdo?');await page.locator('[data-change-draft-question] button[type="submit"]').click();await expect(page.locator('.change-draft-agent [role="alert"]')).toBeVisible();await expect(page.locator('#change-draft-question')).toHaveValue('¿Qué incluye el acuerdo?');expect(calls.filter(c=>c.path==='/api/v1/ai/project-questions'&&c.method==='POST')).toHaveLength(1);
});
