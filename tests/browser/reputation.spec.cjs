const {test,expect}=require('@playwright/test');
const PROJECT='d1111111-1111-4111-8111-111111111111',PROFILE='e1111111-1111-4111-8111-111111111111',REVIEW='f1111111-1111-4111-8111-111111111111';
async function setup(page,{language='es',failure=false,seed=false,mine=true,saveFailure=false}={}){
 const errors=[],writes=[],reports=[];page.on('pageerror',error=>errors.push(error.message));
 let reviews=seed?[{id:REVIEW,alias:'Diseñadora de prueba',rating:4,communication:4,scope:5,payment:'late',body:'La comunicación fue clara, aunque el pago llegó después de la fecha acordada.',created_at:'2026-10-26T15:00:00Z',updated_at:'2026-10-26T15:00:00Z',mine,project_id:mine?PROJECT:null}]:[];
 let fail=failure;
 const client=()=>({id:PROFILE,name:'Estudio de prueba',location:'Lima, Perú',website:'https://example.com',rating:reviews.reduce((a,r)=>a+r.rating,0)/(reviews.length||1),communication:4,scope:5,review_count:reviews.length});
 await page.addInitScript(language=>{
  localStorage.setItem('trato:ui-language',language);
  sessionStorage.setItem('trato:tests.supabase.invalid:session',JSON.stringify({access_token:'test',refresh_token:'refresh',expires_at:9999999999,user:{id:'owner-a',email:'owner@example.invalid'}}));
 },language);
 await page.route('**/api/v1/**',async route=>{
  const r=route.request(),path=new URL(r.url()).pathname;let data;
  if(path==='/api/v1/config')data={supabase_url:'https://tests.supabase.invalid',publishable_key:'sb_publishable_test'};
  else if(path==='/api/v1/session')data={user_id:'owner-a'};
  else if(path==='/api/v1/clients')data=[{id:'private-client',name:'Nombre privado',contact_email:'private@example.invalid'}];
  else if(path==='/api/v1/reputation'){
   if(fail){await route.fulfill({status:503,json:{error:{code:'PERSISTENCE_UNAVAILABLE'}}});return;}
   const q=new URL(r.url()).searchParams.get('search');data={clients:reviews.length&&(!q||client().name.includes(q))?[client()]:[],next_offset:null};
  }else if(path==='/api/v1/reputation/review-options')data={alias:seed?'Diseñadora de prueba':null,projects:[{id:PROJECT,name:'Proyecto privado',client_name:'Nombre privado',profile_id:seed?PROFILE:null,profile_name:seed?'Estudio de prueba':null,review_id:seed?REVIEW:null}]};
  else if(path===`/api/v1/reputation/clients/${PROFILE}`)data={client:client(),reviews,next_offset:null};
  else if(path==='/api/v1/reputation/reviews'){
   const payload=r.postDataJSON();writes.push(payload);
   if(saveFailure){await route.fulfill({status:503,json:{error:{code:'PERSISTENCE_UNAVAILABLE'}}});return;}
   reviews=[{...payload,id:REVIEW,mine:true,alias:payload.alias,created_at:'2026-10-28T15:00:00Z',updated_at:'2026-10-28T15:00:00Z'}];data={profile_id:PROFILE,review_id:REVIEW};
  }else if(path==='/api/v1/reputation/reviews/report'){reports.push(r.postDataJSON());data={reported:true};}
  else if(path==='/api/v1/reputation/reviews/withdraw'){reviews=[];data={withdrawn:true};}
  else if(path.endsWith('/gmail/connection'))data={connected:false};
  else if(path.includes('/sandbox-test/status'))data={configured:false};
  else if(path==='/api/v1/projects')data=[];
  else data=[];
  await route.fulfill({json:{data}});
 });
 await page.goto('/#reputacion');
 await expect(page.locator('[data-reputation]')).toBeVisible();
 return {errors,writes,reports,recover:()=>{fail=false;}};
}
for(const language of ['es','en'])test(`reputation publishes only explicitly chosen data and resumes after reload (${language})`,async({page})=>{
 const state=await setup(page,{language});
 const name=key=>({es:{title:'Reputación',write:'Compartir experiencia',publish:'Publicar experiencia',back:'Volver a Reputación'},en:{title:'Reputation',write:'Share an experience',publish:'Publish experience',back:'Back to Reputation'}}[language][key]);
 await expect(page.locator('[data-rep-action="write"]').first()).toBeVisible();
 const links=await page.locator('nav[aria-label] [data-view]').evaluateAll(nodes=>nodes.map(n=>n.dataset.view));
 expect(links.indexOf('reputacion')).toBe(links.indexOf('ensayos')+1);
 await expect(page.locator('.rep-empty')).toBeVisible();await expect(page.locator('[data-reputation]')).not.toContainText('private@example.invalid');
 expect(state.writes).toHaveLength(0);
 if(language==='es')await page.screenshot({path:'.local/browser-tests/reputation-empty.png',fullPage:true});
 await page.locator('[data-rep-action="write"]').first().click();
 await page.locator('#rep-project').selectOption(PROJECT);await page.locator('#rep-name').fill('Estudio de prueba');
 await page.locator('#rep-location').fill('Lima, Perú');await page.locator('#rep-alias').fill('Diseñadora de prueba');
 await page.locator('.rep-rating-input input[value="4"]').check();await page.locator('#rep-payment').selectOption('late');
 await page.locator('#rep-communication').selectOption('4');await page.locator('#rep-scope').selectOption('5');
 await page.locator('#rep-body').fill('Comunicación clara y un pago posterior a la fecha que acordamos.');
 await page.getByRole('button',{name:name('publish'),exact:true}).click();expect(state.writes).toHaveLength(0);
 await page.locator('[name="consent"]').check();await page.getByRole('button',{name:name('publish'),exact:true}).click();
 await expect(page.locator('.rep-profile h2')).toHaveText('Estudio de prueba');await expect(page.locator('.rep-review-copy')).toContainText('Comunicación clara');
 if(language==='es')await page.screenshot({path:'.local/browser-tests/reputation-detail.png',fullPage:true});
 expect(state.writes).toHaveLength(1);expect(state.writes[0].consent).toBe(true);expect(state.writes[0]).not.toHaveProperty('contact_email');
 await page.getByRole('button',{name:name('back'),exact:true}).click();await expect(page.locator('.rep-client-card')).toHaveCount(1);
 await page.reload();await expect(page.locator('.rep-client-card')).toHaveCount(1);
 expect(state.errors).toEqual([]);
});
test('reputation error stays visible and retries without example data',async({page})=>{
 const state=await setup(page,{failure:true});await expect(page.locator('[data-reputation] [role="alert"]')).toBeVisible();
 await expect(page.locator('.rep-client-card')).toHaveCount(0);state.recover();await page.getByRole('button',{name:'Volver a intentar',exact:true}).click();
 await expect(page.locator('.rep-empty')).toContainText('La primera experiencia');expect(state.writes).toHaveLength(0);expect(state.errors).toEqual([]);
});
test('community profile lets its author update and withdraw only their experience',async({page})=>{
 const state=await setup(page,{seed:true});await page.locator('[data-rep-action="open"]').click();
 await page.getByRole('button',{name:'Editar mi experiencia',exact:true}).click();await page.locator('#rep-body').fill('Actualización: el saldo se recibió y la experiencia queda actualizada.');
 await page.locator('#rep-payment').selectOption('on_time');await page.locator('[name="consent"]').check();await page.getByRole('button',{name:'Guardar cambios',exact:true}).click();
 await expect(page.locator('.rep-review-copy')).toContainText('Actualización');expect(state.writes[0].review_id).toBe(REVIEW);
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Retirar mi experiencia',exact:true}).click();
 await expect(page.locator('.rep-empty')).toBeVisible();expect(state.errors).toEqual([]);
});

test('another freelancer can report an experience without editing it',async({page})=>{
 const state=await setup(page,{seed:true,mine:false});await page.locator('[data-rep-action="open"]').click();
 await expect(page.locator('[data-rep-action="edit"]')).toHaveCount(0);await expect(page.locator('[data-rep-action="withdraw"]')).toHaveCount(0);
 await page.getByRole('button',{name:'Reportar experiencia',exact:true}).click();await page.locator('#rep-reason').selectOption('privacy');await page.locator('#rep-details').fill('Este comentario contiene datos privados.');await page.getByRole('button',{name:'Enviar reporte',exact:true}).click();
 await expect(page.locator('.rep-notice')).toContainText('registrado');expect(state.reports).toHaveLength(1);expect(state.writes).toHaveLength(0);
 await expect(page.locator('.rep-review')).toHaveCount(1);expect(state.errors).toEqual([]);
});
test('failed publication preserves the draft and never announces success',async({page})=>{
 const state=await setup(page,{seed:true,saveFailure:true});await page.locator('[data-rep-action="open"]').click();await page.getByRole('button',{name:'Editar mi experiencia',exact:true}).click();
 await page.locator('#rep-body').fill('Mi comentario se conserva si el servicio no logra guardarlo.');await page.locator('[name="consent"]').check();await page.getByRole('button',{name:'Guardar cambios',exact:true}).click();
 await expect(page.locator('[data-rep-error]')).not.toBeEmpty();await expect(page.locator('#rep-body')).toHaveValue('Mi comentario se conserva si el servicio no logra guardarlo.');await expect(page.locator('.rep-notice')).toHaveCount(0);expect(state.errors).toEqual([]);
});
