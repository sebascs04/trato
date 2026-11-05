// Real frontend modules with explicit API doubles. No Gemini, Storage or Weaviate calls.
const {test,expect}=require('@playwright/test');
async function mount(page){
 await page.evaluate(async()=>{
  const {installProjectAssistant}=await import('/project-assistant.mjs');document.body.innerHTML='<main></main><button id="outside">Outside</button>';
  const cloud={active:true,navigationOwner:'owner-a',projectId:'project-a',tab:'asistente',document,storage:sessionStorage,session:{key:'test-project-agent'},reset(){},syncChrome(){},notify(){this.renderProjectAssistant(document.querySelector('main'));},run(fn){return fn();},async request(path,options){const r=await fetch(path,options),v=await r.json();if(!r.ok){const e=Error(v.error.code);e.code=v.error.code;throw e;}return v.data;},previewDocument(){const d=document.createElement('dialog');d.id='project-source-preview';d.innerHTML='<p>Documento original</p><button autofocus>Cerrar</button>';d.querySelector('button').onclick=()=>d.close();document.body.append(d);d.showModal();}};
  window.projectTestCloud=cloud;installProjectAssistant(cloud);cloud.notify();
 });
}
async function setup(page,{failFirst=false,delay=false,processFailure=false,inventoryFailure=false,inventoryAfterProcess=false,processStatus='processed',processReason='',fileCount=1,deferProcessing=false,sourceDelay=0,sourcePending=false,sourceReview=false,restorePending=false,questionSourceFailure=false,extractionStatus='not_requested',extractionJobId=null,readFailure=false,extractionErrorCode='EXTRACTION_FAILED'}={}){
 const calls=[],jobs=new Map();let prepared=false,processed=false,released=!deferProcessing,generation='generation-one';const preparedFiles=new Set(),jobFiles=new Map();let readingStatus=extractionStatus,readingJob=extractionJobId;
 calls.releasePreparations=()=>{released=true;};calls.changeGeneration=()=>{generation='generation-two';};
 calls.completeReading=()=>{sourcePending=false;readingStatus='ready';generation='generation-two';};calls.failReading=()=>{readingStatus='error';};
 calls.confirmDocumentReady=id=>preparedFiles.add(id);calls.jobStatuses=()=>[...jobs.values()].map(job=>job.status);
 const restoredId='00000000-0000-0000-0000-000000009991';if(restorePending){jobs.set(restoredId,{id:restoredId,status:'completed',result:{kind:'file_processing',status:'processed'}});jobFiles.set(restoredId,'document-a');}
 await page.route('**/__project-agent-test',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html><head><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/project-assistant.css"><link rel="stylesheet" href="/ai-activity.css"></head><body></body></html>'}));
 await page.route('**/api/v1/**',async route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname,key=req.headers()['idempotency-key'];calls.push({path,key,body:req.postData()?req.postDataJSON():null});let data;
  if(path.endsWith('/sources')&&(inventoryFailure||inventoryAfterProcess&&processed))return route.fulfill({status:503,json:{error:{code:'PERSISTENCE_UNAVAILABLE'}}});
  if(path.endsWith('/sources')){if(sourceDelay&&processed)await new Promise(r=>setTimeout(r,sourceDelay));data={files:Array.from({length:fileCount},(_,i)=>{const id=i===0?'document-a':'document-'+i;return {id,title:i===0?'Acuerdo del proyecto':'Documento '+i,generation,summary_status:preparedFiles.has(id)?'ready':'pending',status:sourcePending?'source_pending':sourceReview?'index_error':'text_ready',error_code:sourceReview?'FILE_REVIEW_REQUIRED':null,extraction_status:sourcePending?readingStatus:'ready',extraction_job_id:readingJob,extraction_error_code:readingStatus==='error'?extractionErrorCode:null};}),total:fileCount,next_offset:null};}
  else if(path.endsWith('/project-questions')){
   if(questionSourceFailure){questionSourceFailure=false;data={id:key,status:'failed',error_code:'VECTOR_INDEX_INCOMPLETE'};jobs.set(key,data);await route.fulfill({json:{data}});return;}
   if(failFirst){failFirst=false;return route.fulfill({status:503,json:{error:{code:'AI_REQUEST_FAILED'}}});}
   if(delay)await new Promise(resolve=>setTimeout(resolve,300));
   const item=req.postDataJSON(),result={kind:'project_assistant',project_id:item.project_id,question:item.question,status:'answered',answer:'Se incluyen dos revisiones.',missing_information:[],citations:[{source_id:'s',quote:'dos revisiones'}],sources:[{source_id:'s',file_id:'document-a',title:'Acuerdo',source_kind:'original',locator:{kind:'page',page:1}}]};if(item.document_ids)result.source_scope={document_ids:item.document_ids};data={id:key,status:'completed',result};jobs.set(key,data);
  }else if(path.endsWith('/retry')){if(readFailure){readFailure=false;await route.fulfill({status:503,json:{error:{code:'PERSISTENCE_UNAVAILABLE'}}});return;}readingStatus='queued';readingJob='reading-job';data={thread_id:readingJob,status:'queued'};
  }else if(path.endsWith('/process')){data={id:key,status:'queued'};jobs.set(key,processFailure?{id:key,status:'failed',error_code:'FILE_PIPELINE_FAILED'}:{id:key,status:'completed',result:{kind:'file_processing',status:processStatus,treatment:{reason:processReason}}});processed=true;jobFiles.set(key,path.split('/').at(-2));}
  else if(path.includes('/ai/jobs/')){const jobId=path.split('/').pop();data=jobs.get(jobId);if(jobFiles.has(jobId)&&!released)data={id:jobId,status:'running'};if(data?.result?.kind==='file_processing'&&data.result.status==='processed'){prepared=true;preparedFiles.add(jobFiles.get(jobId));}}
  else throw Error('Unexpected route '+path);
  await route.fulfill({json:{data}});
 });
 await page.goto('/__project-agent-test');
 if(restorePending)await page.evaluate(id=>sessionStorage.setItem('test-project-agent:ai-job:owner-a:prepare-document:project-a:document-a',JSON.stringify({version:1,owner:'owner-a',state:{id,status:'queued',result:null,error:null,uncertain:false,path:'/api/v1/projects/project-a/documents/document-a/process',payload:{output_language:'es'}}})),restoredId);
 await mount(page);
 return calls;
}
for(const mobile of [false,true])test(`project agent shares drawer geometry and preserves draft (${mobile?'mobile':'desktop'})`,async({page})=>{
 if(mobile)await page.setViewportSize({width:390,height:844});const calls=await setup(page);
 await expect(page.locator('.project-agent-invitation')).toContainText('Agente del proyecto');await expect(page.locator('[data-project-question]')).toHaveCount(0);
 await page.locator('[data-assistant-action="open-agent"]').click();const d=page.locator('.project-agent-drawer');await expect(d).toBeVisible();
 await expect.poll(async()=>{const b=await d.boundingBox();return Math.abs(b.x+b.width-page.viewportSize().width);}).toBeLessThan(.1);
 const box=await d.boundingBox();expect(Math.abs(box.height-page.viewportSize().height)).toBeLessThan(1);
 for(const button of await d.locator('.case-agent-header button').all()){const b=await button.boundingBox();expect(b.width).toBeGreaterThanOrEqual(36);expect(b.height).toBeGreaterThanOrEqual(36);expect(b.x).toBeGreaterThanOrEqual(0);expect(b.x+b.width).toBeLessThanOrEqual(page.viewportSize().width+1);}
 await page.locator('#project-assistant-question').fill('Conserva este mensaje');await page.keyboard.press('Escape');await expect(d).not.toBeVisible();await expect(page.locator('[data-assistant-action="open-agent"]')).toBeFocused();
 const count=calls.length;await page.locator('[data-assistant-action="open-agent"]').click();await expect(page.locator('#project-assistant-question')).toHaveValue('Conserva este mensaje');expect(calls).toHaveLength(count);
 await expect.poll(async()=>{const b=await d.boundingBox();return Math.abs(b.x+b.width-page.viewportSize().width);}).toBeLessThan(.1);
 await page.screenshot({path:`.local/browser-tests/project-agent-${mobile?'mobile':'desktop'}.png`,fullPage:true});
});
test('project agent preserves retry key, citations, history and source preview layering',async({page})=>{
 const calls=await setup(page,{failFirst:true});await page.locator('[data-assistant-action="open-agent"]').click();await page.locator('#project-assistant-question').fill('¿Qué incluye?');await page.locator('[data-project-question] button[type="submit"]').click();
 await expect(page.locator('[data-assistant-action="retry"]')).toBeVisible();await page.locator('[data-assistant-action="retry"]').click();await expect(page.locator('.case-agent-message:not(.is-user)')).toContainText('Se incluyen dos revisiones.');
 const writes=calls.filter(c=>c.path.endsWith('/project-questions'));expect(writes).toHaveLength(2);expect(writes[0].key).toBe(writes[1].key);expect(writes[0].body).toEqual(writes[1].body);
 await page.locator('.case-agent-bubble summary').click();await page.locator('[data-assistant-action="source"]').click();await expect(page.locator('#project-source-preview')).toBeVisible();await page.keyboard.press('Escape');await expect(page.locator('.project-agent-drawer')).toBeVisible();
 await page.keyboard.press('Escape');await page.reload();await mount(page);await page.locator('[data-assistant-action="open-agent"]').click();await expect(page.locator('.case-agent-message:not(.is-user)')).toContainText('Se incluyen dos revisiones.');
});
test('documents remain explicit and preparation uses the existing job route',async({page})=>{
 const calls=await setup(page);await page.locator('[data-assistant-action="open-documents"]').click();await expect(page.locator('.project-assistant-file')).toContainText('Por preparar');
 expect(calls.filter(c=>c.path.endsWith('/process'))).toHaveLength(0);await page.locator('[data-assistant-action="process"]').click();await expect(page.locator('.project-assistant-file')).toContainText('Listo');
 expect(calls.filter(c=>c.path.endsWith('/process'))).toHaveLength(1);expect(calls.find(c=>c.path.endsWith('/process')).body).toEqual({output_language:'es'});
});
test('late project response cannot populate another project or owner drawer',async({page})=>{
 await setup(page,{delay:true});await page.locator('[data-assistant-action="open-agent"]').click();await page.locator('#project-assistant-question').fill('Pregunta del proyecto anterior');await page.locator('[data-project-question] button[type="submit"]').click();
 await page.evaluate(()=>{const c=window.projectTestCloud;c.projectId='project-b';c.navigationOwner='owner-b';c.syncChrome();c.notify();});await expect(page.locator('.project-agent-drawer')).not.toBeVisible();await page.waitForTimeout(350);await page.locator('[data-assistant-action="open-agent"]').click();await expect(page.locator('.case-agent-message')).toHaveCount(0);await expect(page.locator('#project-assistant-question')).toHaveValue('');
});

test('failed document preparation shows one relevant error and keeps the document pending',async({page})=>{
 await setup(page,{processFailure:true});await page.locator('[data-assistant-action="open-documents"]').click();
 await expect(page.locator('.project-assistant-file')).toContainText('Por preparar');await page.locator('[data-assistant-action="process"]').click();
 await expect(page.locator('[data-document-error="preparation"]')).toContainText('No pudimos preparar el documento');await expect(page.locator('.project-assistant-preparation [role="alert"]')).toHaveCount(1);
 await expect(page.locator('.project-assistant-preparation')).not.toContainText('Tu pregunta');await expect(page.locator('.project-assistant-file')).toContainText('Por preparar');await expect(page.locator('.project-assistant-file')).not.toContainText('Listo');
});
test('inventory failure is labelled as document status rather than a failed question',async({page})=>{
 await setup(page,{inventoryFailure:true});await page.locator('[data-assistant-action="open-documents"]').click();await expect(page.locator('[data-document-error="inventory"]')).toContainText('No pudimos consultar el estado');await expect(page.locator('[data-document-error="preparation"]')).toHaveCount(0);await expect(page.locator('[data-assistant-action="refresh-sources"]')).toBeVisible();await expect(page.locator('.project-assistant-preparation')).not.toContainText('Tu pregunta');
});
test('independent preparation and inventory failures remain distinguishable',async({page})=>{
 await setup(page,{processFailure:true,inventoryAfterProcess:true});await page.locator('[data-assistant-action="open-documents"]').click();await page.locator('[data-assistant-action="process"]').click();await expect(page.locator('[data-document-error="preparation"]')).toBeVisible();
 await page.locator('[data-assistant-action="open-sources"]').click();await page.locator('[data-assistant-action="open-sources"]').click();
 await expect(page.locator('[data-document-error="inventory"]')).toContainText('No pudimos consultar el estado');await expect(page.locator('[data-document-error="preparation"]')).toContainText('No pudimos preparar el documento');
});

test('document needing clarification displays the actual escaped reason and stays pending',async({page})=>{
 const reason='Aclara el alcance <img src=x onerror="window.badReason=true"> antes de continuar.';
 await setup(page,{processStatus:'needs_clarification',processReason:reason});await page.locator('[data-assistant-action="open-documents"]').click();await page.locator('[data-assistant-action="process"]').click();
 await expect(page.locator('[data-document-review]')).toContainText('Hace falta una aclaración');await expect(page.locator('[data-document-review-reason]')).toHaveText(reason);
 await expect(page.locator('.project-assistant-file')).toContainText('Por preparar');await expect(page.locator('.project-assistant-file')).not.toContainText('Listo');await expect(page.locator('[data-document-review] img')).toHaveCount(0);expect(await page.evaluate(()=>window.badReason)).toBeUndefined();
 await expect(page.locator('.project-assistant-preparation')).not.toContainText('Revisa el resultado del procesamiento en Documentos');
});

for(const outcome of ['processed','needs_clarification','error'])test(`preparation progress and ${outcome} stay at the clicked document row`,async({page})=>{
 const calls=await setup(page,{fileCount:24,deferProcessing:true,sourceDelay:350,processStatus:outcome==='needs_clarification'?outcome:'processed',processReason:'Aclara las fechas de entrega.',processFailure:outcome==='error'});
 await page.locator('[data-assistant-action="open-documents"]').click();const row=page.locator('[data-document-row="document-18"]');await row.locator('[data-assistant-action="process"]').click();
 await expect(row.locator('[data-document-progress]')).toBeVisible();await expect(row.locator('[data-document-progress]')).toBeInViewport();
 await page.keyboard.press('Escape');await page.locator('[data-assistant-action="open-documents"]').click();await row.scrollIntoViewIfNeeded();await expect(row.locator('[data-document-progress]')).toBeVisible();
 calls.releasePreparations();
 const result=outcome==='processed'?'[data-document-prepared]':outcome==='needs_clarification'?'[data-document-review]':'[data-document-error="preparation"]';
 await expect(row.locator(result)).toBeVisible({timeout:7000});await expect(row.locator(result)).toBeInViewport();await expect(row.locator('[data-document-progress]')).toHaveCount(0);
 if(outcome==='processed')await expect(row).toContainText('Listo');else await expect(row).toContainText('Por preparar');
 const next=page.locator('[data-document-row="document-19"]');await next.locator('[data-assistant-action="process"]').click();await expect(row.locator(result)).toHaveCount(1);
});
test('pending reading never pretends to be an active preparation',async({page})=>{
 await setup(page,{sourcePending:true});await page.locator('[data-assistant-action="open-documents"]').click();const row=page.locator('[data-document-row]');await expect(row).toContainText('Lectura pendiente');await expect(row).toContainText('Trato leerá y preparará');await expect(row.locator('[data-assistant-action="read"]')).toBeEnabled();await expect(row.locator('[data-assistant-action="read"]')).toContainText('Preparar documento');await expect(row.locator('[data-document-progress]')).toHaveCount(0);
});

test('inventory review requirement is neutral without inventing a running job or reason',async({page})=>{
 await setup(page,{sourceReview:true});await page.locator('[data-assistant-action="open-documents"]').click();const row=page.locator('[data-document-row]');await expect(row).toContainText('Requiere revisión');await expect(row.locator('[data-document-progress]')).toHaveCount(0);await expect(row.locator('[data-document-review-reason]')).toHaveCount(0);
});

test('an existing pending preparation resumes row feedback without a second POST',async({page})=>{
 const calls=await setup(page,{restorePending:true,deferProcessing:true});await page.locator('[data-assistant-action="open-documents"]').click();const row=page.locator('[data-document-row="document-a"]');await row.locator('[data-assistant-action="process"]').click();
 await expect(row.locator('[data-document-progress]')).toBeVisible();expect(calls.filter(c=>c.path.endsWith('/process'))).toHaveLength(0);expect(calls.some(c=>c.path.endsWith('/jobs/00000000-0000-0000-0000-000000009991'))).toBe(true);
 calls.releasePreparations();await expect(row.locator('[data-document-prepared]')).toBeVisible({timeout:7000});await expect(row).toContainText('Listo');expect(calls.filter(c=>c.path.endsWith('/process'))).toHaveLength(0);
});

test('confirmed ready inventory supersedes an earlier failed preparation without rewriting the job',async({page})=>{
 const calls=await setup(page,{processFailure:true});await page.locator('[data-assistant-action="open-documents"]').click();const row=page.locator('[data-document-row="document-a"]');await row.locator('[data-assistant-action="process"]').click();
 await expect(row).toContainText('Por preparar');await expect(row.locator('[data-document-error="preparation"]')).toBeVisible();expect(calls.jobStatuses()).toContain('failed');
 calls.confirmDocumentReady('document-a');await page.locator('[data-assistant-action="open-sources"]').click();await page.locator('[data-assistant-action="open-sources"]').click();
 await expect(row).toContainText('Listo');await expect(row.locator('[data-document-prepared]')).toBeVisible();await expect(row.locator('[data-document-error="preparation"]')).toHaveCount(0);
 expect(calls.jobStatuses()).toContain('failed');expect(calls.filter(c=>c.path.endsWith('/process'))).toHaveLength(1);
});

test('project agent adopts ready documents only after explicit selection and sends a new scoped job',async({page})=>{
 const calls=await setup(page,{fileCount:2,questionSourceFailure:true});calls.confirmDocumentReady('document-a');
 await page.locator('[data-assistant-action="open-agent"]').click();await page.locator('#project-assistant-question').fill('What is included?');await page.locator('[data-project-question] button[type="submit"]').click();
 await expect(page.locator('[data-assistant-action="retry"]')).toBeVisible();expect(calls.filter(c=>c.path.endsWith('/project-questions'))).toHaveLength(1);
 await page.locator('[data-assistant-action="open-sources"]').last().click();await expect(page.locator('[data-assistant-action="use-ready"]')).toBeVisible();await page.locator('[data-agent-document-choice] summary').click();
 await expect(page.locator('[data-agent-document-choice]')).toContainText('Acuerdo del proyecto');await expect(page.locator('[data-agent-document-choice]')).toContainText('Documento 1');
 await page.locator('[data-assistant-action="use-ready"]').click();expect(calls.filter(c=>c.path.endsWith('/project-questions'))).toHaveLength(1);
 await page.locator('[data-assistant-action="retry"]').click();await expect(page.locator('.case-agent-message:not(.is-user)')).toContainText('Se incluyen dos revisiones');
 const writes=calls.filter(c=>c.path.endsWith('/project-questions'));expect(writes).toHaveLength(2);expect(writes[0].body.document_ids).toBeUndefined();expect(writes[1].body.document_ids).toEqual(['document-a']);expect(writes[1].key).not.toBe(writes[0].key);
 await expect(page.locator('[data-answer-document-scope]')).toContainText('Documentos elegidos: 1');await page.reload();await mount(page);await page.locator('[data-assistant-action="open-agent"]').click();await expect(page.locator('[data-answer-document-scope]')).toContainText('Documentos elegidos: 1');
});

test('unqueued source explicitly starts the original pipeline and waits through extraction without a second AI POST',async({page})=>{
 const calls=await setup(page,{sourcePending:true});await page.locator('[data-assistant-action="open-documents"]').click();const row=page.locator('[data-document-row="document-a"]');
 await row.locator('[data-assistant-action="read"]').click();await expect(row.locator('[data-document-reading-progress]')).toContainText('Preparación en cola');await expect(row.locator('[data-assistant-action="read"]')).toBeDisabled();
 calls.completeReading();await expect(row.locator('[data-document-recovery-progress]')).toContainText('Lectura completada',{timeout:6000});await expect(row.locator('[data-document-recovery-progress] .ai-activity')).toHaveCount(0);await expect(row.locator('[data-assistant-action="process"]')).toBeDisabled();
 expect(calls.filter(c=>c.path.endsWith('/retry'))).toHaveLength(1);expect(calls.filter(c=>c.path.endsWith('/process'))).toHaveLength(0);
 await page.reload();await mount(page);await page.locator('[data-assistant-action="open-documents"]').click();await expect(row.locator('[data-document-recovery-progress]')).toBeVisible();await expect(row.locator('[data-assistant-action="process"]')).toBeDisabled();
 await page.locator('[data-assistant-action="clear"]').click();await page.locator('[data-assistant-action="open-documents"]').click();await expect(row.locator('[data-document-recovery-progress]')).toBeVisible();await expect(row.locator('[data-assistant-action="process"]')).toBeDisabled();
 calls.confirmDocumentReady('document-a');await expect(row).toContainText('Listo',{timeout:6000});expect(calls.filter(c=>c.path.endsWith('/retry'))).toHaveLength(1);expect(calls.filter(c=>c.path.endsWith('/process'))).toHaveLength(0);
});
test('failed extraction offers explicit retry and never uploads a replacement or calls process',async({page})=>{
 const calls=await setup(page,{sourcePending:true,extractionStatus:'error',extractionJobId:'old-reading'});await page.locator('[data-assistant-action="open-documents"]').click();const row=page.locator('[data-document-row="document-a"]');await expect(row.locator('[data-document-reading-error]')).toBeVisible();await expect(row.locator('[data-assistant-action="read"]')).toContainText('Reintentar preparación');
 await row.locator('[data-assistant-action="read"]').click();await expect(row.locator('[data-assistant-action="read"]')).toBeDisabled();expect(calls.filter(c=>c.path.endsWith('/retry'))).toHaveLength(1);expect(calls.filter(c=>c.path.endsWith('/process'))).toHaveLength(0);
});
test('existing extraction thread stays visible and cannot enqueue a duplicate',async({page})=>{
 const calls=await setup(page,{sourcePending:true,extractionStatus:'queued',extractionJobId:'existing-reading'});await page.locator('[data-assistant-action="open-documents"]').click();const row=page.locator('[data-document-row="document-a"]');await expect(row.locator('[data-document-reading-progress]')).toContainText('Preparación en cola');await expect(row.locator('[data-assistant-action="read"]')).toBeDisabled();await row.locator('[data-assistant-action="read"]').dispatchEvent('click');expect(calls.filter(c=>c.path.endsWith('/retry'))).toHaveLength(0);expect(calls.filter(c=>c.path.endsWith('/process'))).toHaveLength(0);calls.completeReading();await expect(row.locator('[data-document-recovery-progress]')).toContainText('Lectura completada',{timeout:6000});await expect(row.locator('[data-assistant-action="process"]')).toBeDisabled();
});
test('unconfirmed start retains its row error and requires an explicit retry',async({page})=>{
 const calls=await setup(page,{sourcePending:true,readFailure:true});await page.locator('[data-assistant-action="open-documents"]').click();const row=page.locator('[data-document-row="document-a"]');await row.locator('[data-assistant-action="read"]').click();await expect(row.locator('[data-document-reading-error]')).toContainText('No pudimos confirmar');expect(calls.filter(c=>c.path.endsWith('/retry'))).toHaveLength(1);await row.locator('[data-assistant-action="read"]').click();await expect(row.locator('[data-document-reading-progress]')).toBeVisible();expect(calls.filter(c=>c.path.endsWith('/retry'))).toHaveLength(2);expect(calls.filter(c=>c.path.endsWith('/process'))).toHaveLength(0);
});

test('an extracted original without text asks for review without a misleading reread action',async({page})=>{
 const calls=await setup(page,{sourcePending:true,extractionStatus:'error',extractionJobId:'completed-reading',extractionErrorCode:'EXTRACTION_TEXT_MISSING'});await page.locator('[data-assistant-action="open-documents"]').click();const row=page.locator('[data-document-row="document-a"]');await expect(row).toContainText('Requiere revisión');await expect(row.locator('[data-document-reading-error]')).toContainText('no tiene texto disponible');await expect(row.locator('[data-assistant-action="read"]')).toHaveCount(0);await expect(row.locator('[data-assistant-action="process"]')).toHaveCount(0);expect(calls.filter(c=>c.path.endsWith('/retry'))).toHaveLength(0);
});
