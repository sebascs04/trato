const {test,expect}=require('@playwright/test');
async function setup(page,{language='es',lookupError=false,deleteError=false,deferDocuments=false}={}){
 const errors=[],writes=[],lookups=[],uploads=[],deletions=[];let projects=[],documents=[];let releaseDocumentRead;const documentGate=new Promise(resolve=>releaseDocumentRead=resolve);page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(language=>{localStorage.setItem('trato:ui-language',language);sessionStorage.setItem('trato:planning.supabase.invalid:session',JSON.stringify({access_token:'test',refresh_token:'test',expires_at:9999999999,user:{id:'user-a',email:'owner@example.invalid'}}));},language);
 await page.route('**/api/v1/**',async route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname;let data=[];
  if(path.endsWith('/config'))data={supabase_url:'https://planning.supabase.invalid',publishable_key:'sb_publishable_test'};
  else if(path.endsWith('/session'))data={user_id:'user-a'};
  else if(path==='/api/v1/clients')data=[{id:'client-a',name:'Cliente real de prueba',contact_email:'client@example.invalid'}];
  else if(path==='/api/v1/projects'){
   if(req.method()==='POST'){writes.push(req.postDataJSON());data={id:'project-a',client_id:'client-a',name:req.postDataJSON().name,status:'draft'};projects.push(data);}else data=projects;
  }else if(path==='/api/v1/projects/project-a/delete'){deletions.push(path);if(deleteError){await route.fulfill({status:503,json:{error:{code:'PERSISTENCE_UNAVAILABLE'}}});return;}projects=[];data={id:'project-a',deleted_at:'2026-10-29T12:00:00Z'};
  }else if(path==='/api/v1/projects/project-a/documents'){
   if(req.method()==='POST'){uploads.push(Object.fromEntries(url.searchParams));documents.push({id:'source-a',project_id:'project-a',kind:url.searchParams.get('kind'),title:url.searchParams.get('title'),original_filename:url.searchParams.get('filename'),mime_type:'application/pdf',created_at:'2026-10-29T12:00:00Z',document_extractions:[{status:'ready'}]});data={document:documents.at(-1)};}else{if(deferDocuments){deferDocuments=false;await documentGate;}data=documents;}
  }else if(path==='/api/v1/reputation/lookup'){
   lookups.push(req.postDataJSON());if(lookupError){await route.fulfill({status:503,json:{error:{code:'PERSISTENCE_UNAVAILABLE'}}});return;}
   data={client:{id:'profile-a',name:'Ficha compartida de prueba',public_email:'client@example.invalid',review_count:1}};
  }else if(path==='/api/v1/reputation/clients/profile-a')data={client:{id:'profile-a'},reviews:[{id:'review-a',version:1,alias:'Otro freelancer',body:'La entrega intermedia se pagó antes de continuar.',created_at:'2026-10-25T12:00:00Z'}],next_offset:null};
  else if(path.endsWith('/request-status'))data={can_register:true,closures:[]};
  else if(path.endsWith('/gmail/connection'))data={connected:false};
  await route.fulfill({json:{data}});
 });
 await page.goto('/#clientes');await page.locator('[data-cloud-action="client-open"]').click();await page.locator('[data-cloud-action="project"]').click();
 return {errors,writes,lookups,uploads,deletions,releaseDocuments(value){documents=value;releaseDocumentRead();}};
}
async function create(page,route='new'){
 await page.locator('[name="name"]').fill('Proyecto sin datos de ejemplo');await page.locator(`[name="project_start"][value="${route}"]`).check();
 await page.locator('[data-cloud-form="project"] button[type="submit"]').click();
}
for(const language of ['es','en'])test(`new project opens integrated planning, real context and scoped draft (${language})`,async({page})=>{
 const state=await setup(page,{language});await expect(page.locator('a[href="/inicio-proyecto.html"]')).toHaveCount(0);await create(page);
 await expect(page.locator('.cloud-project-setup')).toBeVisible();await expect(page.locator('.cloud-project-overview')).toHaveCount(0);expect(state.writes).toEqual([{client_id:'client-a',name:'Proyecto sin datos de ejemplo'}]);
 await expect(page.locator('[data-plan-field="brief"]')).toBeEmpty();await expect(page.locator('.project-planning')).not.toContainText('Estudio Aurora');
 const background=await page.locator('.plan-background').boundingBox(),field=await page.locator('[data-plan-field="brief"]').boundingBox();expect(background.y+background.height).toBeLessThan(field.y);
 if(language==='es')await page.screenshot({path:'.local/browser-tests/project-planning-integrated.png',fullPage:true});
 await page.locator('[data-plan-lookup] button').click();await expect(page.locator('.plan-profile')).toContainText('Ficha compartida de prueba');
 await expect(page.locator('.plan-experiences')).toHaveCount(0);await page.locator('[data-plan-action="confirm-profile"]').click();await page.locator('.plan-experiences summary').click();await expect(page.locator('.plan-experiences')).toContainText('La entrega intermedia');
 expect(state.lookups).toEqual([{public_email:'client@example.invalid'}]);
 await page.locator('[data-plan-field="brief"]').fill('Crear la web acordada con este cliente.');await page.locator('[data-plan-field="budget"]').fill('1200');await page.locator('[data-plan-field="date"]').fill('2026-11-20');
 await page.locator('[data-plan-form] button[type="submit"]').click();
 for(let i=0;i<3;i++){await page.locator(`[data-plan-stage="${i}"][data-plan-part="title"]`).fill('Entrega '+(i+1));await page.locator(`[data-plan-stage="${i}"][data-plan-part="body"]`).fill('Trabajo acordado '+i);await page.locator(`[data-plan-stage="${i}"][data-plan-part="when"]`).fill('Antes de esta entrega');await page.locator(`[data-plan-stage="${i}"][data-plan-part="percent"]`).fill(String(i===0?40:30));}
 await page.locator('[data-plan-action="save"]').click();await page.reload();await page.locator('[data-cloud-action="project-open"]').click();await expect(page.locator('[data-plan-stage="0"][data-plan-part="title"]')).toHaveValue('Entrega 1');
 await page.locator('[data-plan-stage="0"][data-plan-part="percent"]').fill('50');await page.locator('[data-plan-form] button[type="submit"]').click();await expect(page.locator('[data-plan-error]')).toContainText('100');
 await page.locator('[data-plan-stage="0"][data-plan-part="percent"]').fill('40');await page.locator('[data-plan-form] button[type="submit"]').click();await expect(page.locator('.plan-total')).toContainText('1,200');
 await page.locator('[data-plan-form] button[type="submit"]').click();await expect(page.locator('.cloud-project-overview')).toBeVisible();
 expect(state.writes).toHaveLength(1);expect(state.errors).toEqual([]);
});
test('already underway requires initial sources in the creation modal before opening the project',async({page})=>{
 const state=await setup(page);await create(page,'ongoing');await expect(page.locator('.cloud-project-overview')).toHaveCount(0);await expect(page.locator('[data-plan-form] button[type=submit]')).toBeDisabled();
 await page.locator('[data-plan-setup-file]').setInputFiles({name:'acuerdo.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\n%%EOF\n')});
 await expect(page.locator('.plan-uploaded-source')).toContainText('acuerdo.pdf');await expect(page.locator('.cloud-project-setup')).toBeVisible();
 await page.locator('[data-plan-form] button[type=submit]').click();await expect(page.locator('.cloud-project-overview')).toBeVisible();await expect(page.locator('.cloud-agreement')).toContainText('acuerdo.pdf');expect(state.writes).toHaveLength(1);expect(state.errors).toEqual([]);
});
test('background failure remains visible without invented experiences',async({page})=>{
 const state=await setup(page,{lookupError:true});await create(page);await page.locator('[data-plan-lookup] button').click();await expect(page.locator('.plan-background [role="alert"]')).toContainText('No pudimos');await expect(page.locator('.plan-profile')).toHaveCount(0);await expect(page.locator('.plan-empty')).toHaveCount(0);expect(state.errors).toEqual([]);
});
test('adding an initial source stays in the same planning step',async({page})=>{
 const state=await setup(page);await create(page);await page.locator('[data-plan-field="brief"]').fill('Información que no debe perderse al subir una fuente.');
 await page.locator('[data-plan-setup-file]').setInputFiles({name:'conversacion.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\n%%EOF\n')});
 await expect(page.locator('[data-plan-field="brief"]')).toHaveValue('Información que no debe perderse al subir una fuente.');await expect(page.locator('.plan-source-list')).toContainText('conversacion.pdf');
 await expect(page.locator('[data-plan-stage]')).toHaveCount(0);expect(state.uploads[0].kind).toBe('initial_agreement');expect(state.errors).toEqual([]);
});
test('deletion needs confirmation and removes a project only after successful persistence',async({page})=>{
 const state=await setup(page);await create(page,'ongoing');await page.locator('[data-cloud-close]').click();
 await page.locator('[data-cloud-action="project-delete"]').click();await page.getByRole('button',{name:'Cancelar',exact:true}).click();expect(state.deletions).toEqual([]);await expect(page.locator('[data-cloud-action="project-open"]')).toHaveCount(1);
 await page.locator('[data-cloud-action="project-delete"]').click();await page.locator('[data-cloud-form="project-delete"] button[type=submit]').click();await expect(page.locator('[data-cloud-action="project-open"]')).toHaveCount(0);expect(state.deletions).toHaveLength(1);expect(state.errors).toEqual([]);
});
test('failed deletion keeps the project and displays the error',async({page})=>{
 const state=await setup(page,{deleteError:true});await create(page,'ongoing');await page.locator('[data-cloud-close]').click();await page.locator('[data-cloud-action="project-delete"]').click();await page.locator('[data-cloud-form="project-delete"] button[type=submit]').click();await expect(page.locator('[data-cloud-error]')).not.toBeEmpty();await expect(page.locator('[data-cloud-action="project-open"]')).toHaveCount(1);expect(state.errors).toEqual([]);
});

test('late source loading preserves the active editor and typed input',async({page})=>{
 const state=await setup(page,{deferDocuments:true});await create(page);
 const brief=page.locator('[data-plan-field="brief"]');
 await brief.fill('Estoy escribiendo mientras llegan las fuentes.');
 await brief.evaluate(input=>{input.dataset.editorIdentity='original';input.focus();});
 state.releaseDocuments([{id:'source-late',project_id:'project-a',kind:'initial_agreement',
   title:'Fuente recibida después',original_filename:'acuerdo-tardio.pdf',mime_type:'application/pdf',
   created_at:'2026-10-29T12:00:00Z',document_extractions:[{status:'ready'}]}]);
 await expect(page.locator('.plan-source-list')).toContainText('Fuente recibida después');
 await expect(brief).toHaveAttribute('data-editor-identity','original');
 await expect(brief).toBeFocused();
 await expect(brief).toHaveValue('Estoy escribiendo mientras llegan las fuentes.');
 expect(state.errors).toEqual([]);
});
