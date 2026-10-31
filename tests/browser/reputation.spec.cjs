const {test,expect}=require('@playwright/test');
const {createHash}=require('crypto');
const PDF=require('fs').readFileSync(require('path').join(__dirname,'../../repos/trato-file-processor/tests/fixtures/request.pdf'));
const PROJECT='d1111111-1111-4111-8111-111111111111',PROFILE='e1111111-1111-4111-8111-111111111111',REVIEW='f1111111-1111-4111-8111-111111111111';
const EMAIL='studio@example.invalid';
async function setup(page,{language='es',failure=false,seed=false,mine=true,saveFailure=false,lookupFailure=false,twoAuthors=false,uploadFailure=false,seedFiles=false}={}){
 const errors=[],writes=[],reports=[],uploads=[],fileReads=[],fileDeletes=[],staged=new Map(),uploadKeys=new Map();page.on('pageerror',error=>errors.push(error.message));
 let reviews=seed?[{id:REVIEW,alias:'Diseñadora de prueba',rating:4,communication:4,scope:5,collaboration:5,payment:'late',body:'La comunicación fue clara, aunque el pago llegó después de la fecha acordada.',created_at:'2026-10-26T15:00:00Z',updated_at:'2026-10-26T15:00:00Z',version:1,mine,project_id:mine?PROJECT:null}]:[];
 if(twoAuthors)reviews.push({id:'f2222222-2222-4222-8222-222222222222',alias:'Otro estudio',rating:3,communication:3,scope:4,collaboration:4,payment:'on_time',body:'Mi experiencia fue distinta: recibí el pago en la fecha que acordamos.',created_at:'2026-10-25T15:00:00Z',updated_at:'2026-10-25T15:00:00Z',version:2,mine:false,project_id:null});
 if(seedFiles){const id='f3333333-3333-4333-8333-333333333333';const file={id,filename:'respaldo.pdf',size_bytes:PDF.length,sha256:createHash('sha256').update(PDF).digest('hex'),status:'attached'};staged.set(id,file);reviews[0].attachments=[file];}
 let fail=failure;
 const client=()=>({id:PROFILE,name:'Estudio de prueba',public_email:EMAIL,location:'Lima, Perú',website:'https://example.com',rating:reviews.reduce((a,r)=>a+r.rating,0)/(reviews.length||1),communication:4,scope:5,collaboration:5,review_count:reviews.length,latest_review:reviews.length?{id:reviews[0].id,version:reviews[0].version,excerpt:reviews[0].body,created_at:reviews[0].created_at}:null});
 await page.addInitScript(language=>{localStorage.setItem('trato:ui-language',language);sessionStorage.setItem('trato:tests.supabase.invalid:session',JSON.stringify({access_token:'test',refresh_token:'refresh',expires_at:9999999999,user:{id:'owner-a',email:'owner@example.invalid'}}));},language);
 await page.route('**/api/v1/**',async route=>{
  const r=route.request(),path=new URL(r.url()).pathname;let data;
  if(path==='/api/v1/config')data={supabase_url:'https://tests.supabase.invalid',publishable_key:'sb_publishable_test'};
  else if(path==='/api/v1/session')data={user_id:'owner-a'};
  else if(path==='/api/v1/clients')data=[{id:'private-client',name:'Nombre privado',contact_email:'private@example.invalid'}];
  else if(path==='/api/v1/reputation'){
   if(fail){await route.fulfill({status:503,json:{error:{code:'PERSISTENCE_UNAVAILABLE'}}});return;}
   const q=(new URL(r.url()).searchParams.get('search')||'').toLowerCase();data={clients:reviews.length&&(!q||(client().name+' '+EMAIL).toLowerCase().includes(q))?[client()]:[],next_offset:null};
  }else if(path==='/api/v1/reputation/lookup'){
   if(lookupFailure){await route.fulfill({status:503,json:{error:{code:'PERSISTENCE_UNAVAILABLE'}}});return;}
   data={client:reviews.length&&r.postDataJSON().public_email.trim().toLowerCase()===EMAIL?client():null};
  }else if(path==='/api/v1/reputation/review-options')data={alias:seed?'Diseñadora de prueba':null,projects:[{id:PROJECT,name:'Proyecto privado',client_name:'Nombre privado',client_email:EMAIL,profile_id:seed?PROFILE:null,profile_name:seed?'Estudio de prueba':null,profile_public_email:seed?EMAIL:null,review_id:seed?REVIEW:null}]};
  else if(path==='/api/v1/reputation/attachments'&&r.method()==='GET')data={attachments:[...staged.values()].filter(f=>f.status==='ready'||f.status==='reserved')};
  else if(path==='/api/v1/reputation/attachments'&&r.method()==='POST'){
   const body=r.postDataBuffer();uploads.push({filename:new URL(r.url()).searchParams.get('filename'),key:r.headers()['idempotency-key'],body});
   if(uploadFailure){await route.fulfill({status:503,json:{error:{code:'STORAGE_UNAVAILABLE'}}});return;}
   const key=r.headers()['idempotency-key'];let id=uploadKeys.get(key);if(!id){id='f3333333-3333-4333-8333-'+String(uploadKeys.size+1).padStart(12,'0');uploadKeys.set(key,id);}
   data={id,filename:uploads.at(-1).filename,size_bytes:body.length,sha256:createHash('sha256').update(body).digest('hex'),status:'ready'};staged.set(id,data);
  }else if(path.match(/^\/api\/v1\/reputation\/attachments\/[^/]+\/file$/)){
   fileReads.push(path);await route.fulfill({contentType:'application/pdf',body:PDF,headers:{'Cache-Control':'no-store'}});return;
  }else if(path.match(/^\/api\/v1\/reputation\/attachments\/[^/]+$/)&&r.method()==='DELETE'){
   const id=path.split('/').at(-1);fileDeletes.push(id);staged.delete(id);data={discarded:true};
  }
  else if(path===`/api/v1/reputation/clients/${PROFILE}`)data={client:client(),reviews,next_offset:null};
  else if(path==='/api/v1/reputation/reviews'){
   const payload=r.postDataJSON();writes.push(payload);
   if(saveFailure){await route.fulfill({status:503,json:{error:{code:'PERSISTENCE_UNAVAILABLE'}}});return;}
   const next={...payload,id:REVIEW,mine:true,alias:payload.alias,created_at:'2026-10-28T15:00:00Z',updated_at:'2026-10-28T15:00:00Z',version:payload.review_id?2:1,attachments:(payload.attachment_ids||[]).map(id=>({...staged.get(id),status:'attached'}))};for(const file of next.attachments)staged.set(file.id,file);reviews=[next,...reviews.filter(r=>r.id!==REVIEW)];data={profile_id:PROFILE,review_id:REVIEW};
  }else if(path==='/api/v1/reputation/reviews/report'){reports.push(r.postDataJSON());data={reported:true};}
  else if(path==='/api/v1/reputation/reviews/withdraw'){reviews=reviews.filter(x=>x.id!==REVIEW);data={withdrawn:true};}
  else if(path.endsWith('/gmail/connection'))data={connected:false};
  else if(path.includes('/sandbox-test/status'))data={configured:false};
  else data=[];
  await route.fulfill({json:{data}});
 });
 await page.goto('/#reputacion');await expect(page.locator('[data-reputation]')).toBeVisible();
 return {errors,writes,reports,uploads,fileReads,fileDeletes,recover:()=>{fail=false;}};
}
async function fillExperience(page,{body='Comunicación clara y un pago posterior a la fecha que acordamos.',editing=false}={}){
 if(!editing)await page.locator('#rep-alias').fill('Diseñadora de prueba');
 await page.locator('[name="rating"][value="4"]').check();
 await page.locator('[name="communication"][value="4"]').check();await page.locator('[name="collaboration"][value="5"]').check();await page.locator('#rep-body').fill(body);
 await page.locator('[data-rep-review] button[type=submit]').click();await expect(page.locator('[data-rep-publish]')).toBeVisible();
}
for(const language of ['es','en'])test(`email-first publication explicitly previews shared identity and private project (${language})`,async({page})=>{
 const state=await setup(page,{language});await expect(page.locator('.rep-purpose')).toContainText(language==='es'?'ayudarán a la IA':'will help AI');
 await expect(page.locator('.rep-empty')).toBeVisible();await expect(page.locator('[data-reputation]')).not.toContainText('private@example.invalid');expect(state.writes).toHaveLength(0);
 await page.locator('[data-rep-action="write"]').first().click();await expect(page.locator('#rep-project')).toHaveCount(0);
 await page.locator('#rep-public-email').fill(EMAIL);await page.locator('[data-rep-identify] button[type=submit]').click();await expect(page.locator('[data-rep-review]')).toBeVisible();await expect(page.locator('#rep-name,#rep-location,#rep-website,.rep-found,[data-rep-lookup]')).toHaveCount(0);
 await expect(page.locator('.rep-write-identity')).toContainText(EMAIL);
 await fillExperience(page);await expect(page.locator('.rep-public-preview')).not.toContainText('Proyecto privado');
 const submit=page.locator('[data-rep-publish] button[type=submit]');await submit.click();expect(state.writes).toHaveLength(0);
 await page.locator('[name="consent"]').check();await submit.click();await expect(page.locator('.rep-profile h2')).toHaveText(EMAIL);
 expect(state.writes).toHaveLength(1);expect(state.writes[0]).toMatchObject({public_email:EMAIL,project_id:PROJECT,consent:true});expect(state.writes[0]).not.toHaveProperty('contact_email');
 await page.locator('[data-rep-action="back"]').click();await expect(page.locator('.rep-client-card')).toHaveCount(1);await expect(page.locator('.rep-client-card')).toContainText(EMAIL);await page.reload();await expect(page.locator('.rep-client-card')).toHaveCount(1);
 if(language==='es')await page.screenshot({path:'.local/browser-tests/reputation-email-cards.png',fullPage:true});expect(state.errors).toEqual([]);
});
test('one continue action reuses the exact email profile without another confirmation',async({page})=>{
 const state=await setup(page,{seed:true,mine:false});await page.locator('#rep-search').fill(EMAIL);await page.locator('[data-rep-search] button').click();await expect(page.locator('.rep-client-card')).toHaveCount(1);
 await page.locator('[data-rep-action="write"]').click();await page.locator('#rep-public-email').fill('STUDIO@example.invalid');await page.locator('[data-rep-identify] button[type=submit]').click();await expect(page.locator('.rep-write-identity')).toContainText(EMAIL);await expect(page.locator('#rep-name')).toHaveCount(0);
 await fillExperience(page);await page.locator('[name=consent]').check();await page.locator('[data-rep-publish] button[type=submit]').click();expect(state.writes[0].profile_id).toBe(PROFILE);expect(state.writes[0].public_email).toBe(EMAIL);expect(state.writes[0]).not.toHaveProperty('name');expect(state.writes[0]).not.toHaveProperty('location');expect(state.writes[0]).not.toHaveProperty('website');expect(state.errors).toEqual([]);
});
test('changing email invalidates the previously found identity',async({page})=>{
 const state=await setup(page,{seed:true});await page.locator('[data-rep-action="write"]').click();await page.locator('#rep-public-email').fill(EMAIL);await page.locator('[data-rep-identify] button[type=submit]').click();await expect(page.locator('[data-rep-review]')).toBeVisible();await page.locator('[data-rep-prev]').click();await page.locator('#rep-public-email').fill('someone-else@example.invalid');await page.locator('[data-rep-identify] button[type=submit]').click();await expect(page.locator('.rep-write-identity')).toContainText('someone-else@example.invalid');await expect(page.locator('#rep-project')).toHaveValue('');await expect(page.locator('.rep-found')).toHaveCount(0);expect(state.writes).toHaveLength(0);expect(state.errors).toEqual([]);
});
test('reputation error stays visible and retries without example data',async({page})=>{
 const state=await setup(page,{failure:true});await expect(page.locator('[data-reputation] [role="alert"]')).toBeVisible();await expect(page.locator('.rep-client-card')).toHaveCount(0);state.recover();await page.getByRole('button',{name:'Volver a intentar',exact:true}).click();await expect(page.locator('.rep-empty')).toContainText('La primera experiencia');expect(state.errors).toEqual([]);
});
test('lookup failure never invents a new profile or allows publication',async({page})=>{
 const state=await setup(page,{seed:true,lookupFailure:true});await page.locator('[data-rep-action="write"]').click();await page.locator('#rep-public-email').fill(EMAIL);await page.locator('[data-rep-identify] button[type=submit]').click();await expect(page.locator('[data-rep-error]')).not.toBeEmpty();await expect(page.locator('[data-rep-identify] button[type=submit]')).toBeEnabled();await expect(page.locator('[data-rep-review]')).toHaveCount(0);await expect(page.locator('#rep-public-email')).toHaveValue(EMAIL);expect(state.writes).toHaveLength(0);expect(state.errors).toEqual([]);
});
test('community profile aggregates two authors and limits edits to its author',async({page})=>{
 const state=await setup(page,{seed:true,twoAuthors:true});await expect(page.locator('.rep-client-card')).toContainText('2 experiencias');await page.locator('[data-rep-action="open"]').click();await expect(page.locator('.rep-review')).toHaveCount(2);await expect(page.locator('[data-rep-action="edit"]')).toHaveCount(1);await expect(page.locator('[data-rep-action="report"]')).toHaveCount(1);
 await page.getByRole('button',{name:'Editar mi experiencia',exact:true}).click();await fillExperience(page,{editing:true,body:'Actualización: el saldo se recibió y la experiencia queda actualizada.'});await page.locator('[name=consent]').check();await page.locator('[data-rep-publish] button[type=submit]').click();await expect(page.locator('.rep-review-copy').first()).toContainText('Actualización');expect(state.writes[0].review_id).toBe(REVIEW);
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Retirar mi experiencia',exact:true}).click();await expect(page.locator('.rep-client-card')).toHaveCount(1);await expect(page.locator('.rep-client-card')).toContainText('1 experiencia');expect(state.errors).toEqual([]);
});
test('another freelancer reports without editing or hiding an experience',async({page})=>{
 const state=await setup(page,{seed:true,mine:false});await page.locator('[data-rep-action="open"]').click();await expect(page.locator('[data-rep-action="edit"]')).toHaveCount(0);await page.getByRole('button',{name:'Reportar experiencia',exact:true}).click();await page.locator('#rep-reason').selectOption('privacy');await page.locator('#rep-details').fill('Este comentario contiene datos privados.');await page.getByRole('button',{name:'Enviar reporte',exact:true}).click();await expect(page.locator('.rep-notice')).toContainText('registrado');expect(state.reports).toHaveLength(1);expect(state.writes).toHaveLength(0);await expect(page.locator('.rep-review')).toHaveCount(1);expect(state.errors).toEqual([]);
});
test('failed publication preserves the preview and editable draft',async({page})=>{
 const state=await setup(page,{seed:true,saveFailure:true});await page.locator('[data-rep-action="open"]').click();await page.getByRole('button',{name:'Editar mi experiencia',exact:true}).click();await fillExperience(page,{editing:true,body:'Mi comentario se conserva si el servicio no logra guardarlo.'});await page.locator('[name=consent]').check();await page.locator('[data-rep-publish] button[type=submit]').click();await expect(page.locator('[data-rep-error]')).not.toBeEmpty();await expect(page.locator('.rep-notice')).toHaveCount(0);await page.locator('[data-rep-prev]').click();await expect(page.locator('#rep-body')).toHaveValue('Mi comentario se conserva si el servicio no logra guardarlo.');expect(state.errors).toEqual([]);
});

test('homonym cards remain distinct and exact email selects only the intended profile',async({page})=>{
 const state=await setup(page,{seed:true});
 const rows=[{id:PROFILE,name:'Alex Moreno',public_email:'alex.lima@example.invalid',location:'Lima',rating:4,review_count:2},{id:'e2222222-2222-4222-8222-222222222222',name:'Alex Moreno',public_email:'alex.quito@example.invalid',location:'Quito',rating:3,review_count:1}];
 await page.route('**/api/v1/reputation?**',async route=>{const search=new URL(route.request().url()).searchParams.get('search')||'';await route.fulfill({json:{data:{clients:rows.filter(c=>(c.name+' '+c.public_email).toLowerCase().includes(search.toLowerCase())),next_offset:null}}});});
 await page.reload();await expect(page.locator('.rep-client-card')).toHaveCount(2);await expect(page.locator('.rep-client-card').first()).toContainText('alex.lima@example.invalid');await expect(page.locator('.rep-client-card').last()).toContainText('alex.quito@example.invalid');await page.locator('#rep-search').fill('alex.quito@example.invalid');await page.locator('[data-rep-search] button').click();await expect(page.locator('.rep-client-card')).toHaveCount(1);await expect(page.locator('.rep-client-card')).toContainText('alex.quito@example.invalid');await expect(page.locator('.rep-client-card')).not.toContainText('Quito');expect(state.errors).toEqual([]);
});
test('long source text remains literal and fits the review card',async({page})=>{
 const state=await setup(page,{seed:true});await page.locator('[data-rep-action="open"]').click();await page.locator('[data-rep-action="edit"]').click();const body='<img src=x onerror="window.repInjected=true">'+'x'.repeat(500);await fillExperience(page,{editing:true,body});await expect(page.locator('.rep-public-preview>p')).toHaveText(body);await expect(page.locator('.rep-public-preview img')).toHaveCount(0);expect(await page.locator('.rep-public-preview').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);expect(await page.evaluate(()=>window.repInjected)).toBeUndefined();expect(state.errors).toEqual([]);
});

for(const language of ['es','en'])test(`supporting files stay in a draft until reviewed and confirmed (${language})`,async({page})=>{
 const state=await setup(page,{seed:true,language});await page.locator('[data-rep-action="open"]').click();await page.locator('[data-rep-action="edit"]').click();
 await expect(page.locator('[data-rep-add-file]')).toBeEnabled();
 await page.locator('[data-rep-files]').setInputFiles([1,2,3].map(n=>({name:`evidence-${n}.pdf`,mimeType:'application/pdf',buffer:PDF})));
 await expect(page.locator('.rep-draft-files li')).toHaveCount(3);expect(state.writes).toHaveLength(0);expect(state.uploads).toHaveLength(3);expect(new Set(state.uploads.map(u=>u.key)).size).toBe(3);
 await expect(page.locator('[data-rep-add-file]')).toBeDisabled();await page.locator('.rep-draft-files [data-rep-file]').first().click();await expect(page.locator('.rep-file-preview iframe')).toHaveAttribute('src',/^blob:/);await page.locator('[data-rep-file-close]').click();
 await fillExperience(page,{editing:true});await expect(page.locator('.rep-evidence li')).toHaveCount(3);expect(state.writes).toHaveLength(0);
 await page.locator('[data-rep-publish] button[type=submit]').click();expect(state.writes).toHaveLength(0);await page.locator('[name=consent]').check();await page.locator('[data-rep-publish] button[type=submit]').click();
 await expect(page.locator('.rep-review .rep-evidence li')).toHaveCount(3);expect(state.writes[0].attachment_ids).toHaveLength(3);expect(state.writes[0].consent).toBe(true);expect(state.errors).toEqual([]);
 if(language==='es')await page.screenshot({path:'.local/browser-tests/reputation-evidence-published.png',fullPage:true});
});
test('a fourth file and non-PDF input never start an upload',async({page})=>{
 const state=await setup(page,{seed:true});await page.locator('[data-rep-action="open"]').click();await page.locator('[data-rep-action="edit"]').click();await expect(page.locator('[data-rep-add-file]')).toBeEnabled();
 await page.locator('[data-rep-files]').setInputFiles([1,2,3,4].map(n=>({name:`file-${n}.pdf`,mimeType:'application/pdf',buffer:PDF})));
 await expect(page.locator('.rep-attachment-editor [role=alert]')).toContainText('3 archivos');expect(state.uploads).toHaveLength(0);
 await page.locator('[data-rep-files]').setInputFiles({name:'source.txt',mimeType:'text/plain',buffer:Buffer.from('not a pdf')});await expect(page.locator('.rep-attachment-editor [role=alert]')).toContainText('PDF');expect(state.uploads).toHaveLength(0);expect(state.errors).toEqual([]);
});
test('failed file upload keeps the written experience and reports failure',async({page})=>{
 const state=await setup(page,{seed:true,uploadFailure:true});await page.locator('[data-rep-action="open"]').click();await page.locator('[data-rep-action="edit"]').click();await page.locator('#rep-body').fill('Mi experiencia debe conservarse cuando falle la subida de un archivo.');await expect(page.locator('[data-rep-add-file]')).toBeEnabled();
 await page.locator('[data-rep-files]').setInputFiles({name:'evidence.pdf',mimeType:'application/pdf',buffer:PDF});await expect(page.locator('.rep-attachment-editor [role=alert]')).not.toBeEmpty();await expect(page.locator('.rep-draft-files li')).toHaveCount(0);await expect(page.locator('#rep-body')).toHaveValue('Mi experiencia debe conservarse cuando falle la subida de un archivo.');expect(state.writes).toHaveLength(0);expect(state.errors).toEqual([]);
});
test('removing a published file only changes the draft selection until confirmation',async({page})=>{
 const state=await setup(page,{seed:true,seedFiles:true});await page.locator('[data-rep-action="open"]').click();await expect(page.locator('.rep-evidence li')).toHaveCount(1);await page.locator('[data-rep-action="edit"]').click();await page.locator('[data-remove-file]').click();await expect(page.locator('.rep-draft-files li')).toHaveCount(0);expect(state.fileDeletes).toHaveLength(0);expect(state.writes).toHaveLength(0);
 await fillExperience(page,{editing:true});await page.locator('[name=consent]').check();await page.locator('[data-rep-publish] button[type=submit]').click();await expect(page.locator('.rep-review .rep-evidence')).toHaveCount(0);expect(state.writes[0].attachment_ids).toEqual([]);expect(state.errors).toEqual([]);
});

for(const language of ['es','en'])test(`purpose and neutral experience fields stay prominent (${language})`,async({page})=>{
 const state=await setup(page,{seed:true,language});await page.locator('[data-rep-action="open"]').click();
 const purpose=page.locator('.rep-purpose'),profile=page.locator('.rep-profile');
 await expect(profile).toBeVisible();await expect(purpose).toBeVisible();
 expect((await purpose.boundingBox()).y).toBeLessThan((await profile.boundingBox()).y);
 await expect(page.locator('.rep-purpose')).toHaveCount(1);
 await expect(page.locator('.rep-ai-label')).toContainText(language==='es'?'IA':'AI');
 await page.locator('[data-rep-action="edit"]').click();
 await expect(page.locator('#rep-payment')).toHaveCount(0);await expect(page.locator('#rep-scope')).toHaveCount(0);
 await page.locator('[name="rating"][value="4"]').check();await expect(page.locator('[data-rep-rating="rating"] label.is-filled')).toHaveCount(4);
 await page.locator('[name="rating"][value="2"]').check();await expect(page.locator('[data-rep-rating="rating"] label.is-filled')).toHaveCount(2);
 const overall=await page.locator('[data-rep-rating="rating"]').boundingBox(),communication=await page.locator('#rep-communication').boundingBox(),collaboration=await page.locator('#rep-collaboration').boundingBox();
 expect(Math.abs(overall.y-communication.y)).toBeLessThan(4);expect(Math.abs(communication.y-collaboration.y)).toBeLessThan(4);expect(overall.x).toBeLessThan(communication.x);expect(communication.x).toBeLessThan(collaboration.x);
 await expect(page.locator('[data-rep-rating="communication"] label.is-filled')).toHaveCount(4);await page.locator('[name="collaboration"][value="3"]').check();await expect(page.locator('[data-rep-rating="collaboration"] label.is-filled')).toHaveCount(3);await expect(page.locator('[data-rep-rating="communication"] label.is-filled')).toHaveCount(4);await expect(page.locator('[data-rep-rating="rating"] label.is-filled')).toHaveCount(2);
 if(language==='es')await page.screenshot({path:'.local/browser-tests/reputation-neutral-ratings.png',fullPage:true});
 await page.locator('[name="collaboration"][value="5"]').check();await page.locator('[data-rep-review] button[type=submit]').click();await page.locator('[name=consent]').check();await page.locator('[data-rep-publish] button[type=submit]').click();
 await expect(page.locator('.rep-review')).toHaveCount(1);expect(state.writes[0].collaboration).toBe(5);expect(state.writes[0]).not.toHaveProperty('payment');expect(state.writes[0]).not.toHaveProperty('scope');expect(state.errors).toEqual([]);
});
test('project selector contains only projects of the chosen client',async({page})=>{
 const state=await setup(page,{seed:true});
 await page.route('**/api/v1/reputation/review-options*',route=>route.fulfill({json:{data:{alias:'Diseñadora de prueba',projects:[
  {id:PROJECT,name:'Diseño de la marca',client_email:EMAIL,profile_id:PROFILE},
  {id:'d2222222-2222-4222-8222-222222222222',name:'Sitio del mismo cliente',client_email:EMAIL,profile_id:PROFILE},
  {id:'d3333333-3333-4333-8333-333333333333',name:'Proyecto de Sebas',client_email:'sebas@example.invalid',profile_id:null}
 ]}}}));
 await page.locator('[data-rep-action="write"]').click();await page.locator('#rep-public-email').fill(EMAIL);await page.locator('[data-rep-identify] button[type=submit]').click();
 await expect(page.locator('#rep-project option')).toHaveCount(3);
 await expect(page.locator('#rep-project')).not.toContainText('Sebas');
 await page.locator('#rep-project').selectOption(PROJECT);expect(state.errors).toEqual([]);
});
