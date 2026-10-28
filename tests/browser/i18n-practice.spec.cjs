const {test,expect}=require('@playwright/test');
async function setup(page,{lang='es',paid=false,user='owner-a'}={}){
 const errors=[],writes=[],reads=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(({lang,user})=>{
  if(!localStorage.getItem('trato:ui-language'))localStorage.setItem('trato:ui-language',lang);
  sessionStorage.setItem('trato:tests.supabase.invalid:session',JSON.stringify({access_token:'test',refresh_token:'test-refresh',expires_at:9999999999,user:{id:user,email:'owner@example.invalid'}}));
 },{lang,user});
 await page.route('**/api/v1/**',async route=>{
  const r=route.request(),path=new URL(r.url()).pathname;if(r.method()==='POST')writes.push(path);else reads.push(path);
  let data;
  if(path.endsWith('/config'))data={supabase_url:'https://tests.supabase.invalid',publishable_key:'sb_publishable_test'};
  else if(path.endsWith('/session'))data={user_id:user};
  else if(path.endsWith('/clients'))data=[{id:'client-a',name:'Clientes',contact_email:'customer@example.invalid'}];
  else if(path==='/api/v1/projects')data=[{id:'project-a',client_id:'client-a',name:'Historial'}];
  else if(path.endsWith('/documents'))data=[{id:'initial',project_id:'project-a',kind:'initial_agreement',title:'Acuerdo inicial',original_filename:'contrato-original.pdf',mime_type:'application/pdf',created_at:'2026-10-26T12:00:00Z',document_extractions:[{status:'ready'}]},...(paid?[{id:'request',project_id:'project-a',kind:'email_request',title:'Pedido del cliente',created_at:'2026-10-26T13:00:00Z',document_extractions:[{status:'ready'}]}]:[])];
  else if(path.endsWith('/proposals'))data=paid?[{id:'proposal',request_document_id:'request',current_revision_id:'revision',revision_no:1,business_status:'Finalizado',locked_at:'2026-10-26T14:00:00Z'}]:[];
  else if(path.endsWith('/request-status'))data={can_register:true,active_request:null,closures:[]};
  else if(path.endsWith('/activity'))data=[];
  else if(path.endsWith('/revisions/revision'))data={proposal:{id:'proposal',current_revision_id:'revision',project_id:'project-a',request_document_id:'request',locked_at:'2026-10-26T14:00:00Z'},revision:{id:'revision',revision_no:1,scope_summary:'Texto privado del cliente',conditions:'Condiciones originales',additional_minor:100,deadline:'2026-11-12'},artifacts:[{document_id:'pdf'}],reviews:[{}],acceptances:[{}],payments:[{status:'completed'}],deliveries:[],events:[],sources:[],payment_required:true};
  else {await route.fulfill({status:404,json:{error:{code:'NOT_FOUND'}}});return;}
  await route.fulfill({json:{data}});
 });
 await page.goto('/#clientes');await expect(page.locator('.cloud-client-directory')).toBeVisible();return {errors,writes,reads};
}
test('profile switches ES and EN while preserving navigation and original user content',async({page})=>{
 const c=await setup(page);
 await page.getByRole('button',{name:'Abrir cliente Clientes',exact:true}).click();
 await page.getByRole('button',{name:'Abrir proyecto Historial',exact:true}).click();
 await page.getByRole('button',{name:'Mi perfil · sesión iniciada',exact:true}).click();
 await Promise.all([page.waitForEvent('load'),page.locator('[data-ui-language]').selectOption('en')]);
 await expect(page.locator('html')).toHaveAttribute('lang','en');
 await expect(page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:'Clients',exact:true})).toBeVisible();
 await expect(page.locator('.client-banner h2')).toHaveText('Historial');
 await expect(page.locator('.cloud-agreement')).toContainText('Acuerdo inicial');
 await expect(page.locator('.cloud-source-list')).toContainText('contrato-original.pdf');
 await expect(page.getByRole('button',{name:'Documents: Files by request',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'My profile · signed in',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Your profile',exact:true})).toBeVisible();
 await Promise.all([page.waitForEvent('load'),page.locator('[data-ui-language]').selectOption('es')]);
 await expect(page.locator('html')).toHaveAttribute('lang','es');
 await expect(page.getByRole('button',{name:'Proyecto: Acuerdo y fuentes iniciales',exact:true})).toBeVisible();
 expect(c.writes).toEqual([]);expect(c.errors).toEqual([]);
});
test('English business labels keep a paid change read-only and leave source terms untouched',async({page})=>{
 const c=await setup(page,{lang:'en',paid:true});
 await page.getByRole('button',{name:'Open client Clientes',exact:true}).click();await page.getByRole('button',{name:'Open project Historial',exact:true}).click();
 await page.getByRole('button',{name:'Changes: Scope, price or deadline',exact:true}).click();
 await page.getByRole('button',{name:'View details →',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Finalized',exact:true})).toBeVisible();
 await expect(page.locator('.cloud-tracking')).toContainText('Texto privado del cliente');
 await expect(page.getByRole('button',{name:'Edit draft',exact:true})).toHaveCount(0);
 expect(c.writes).toEqual([]);expect(c.errors).toEqual([]);
});
test('rehearsal sliders are accessible, isolated and prepare the selected language for the agent',async({page})=>{
 const c=await setup(page,{lang:'en'});
 await page.getByRole('link',{name:'Rehearsals',exact:true}).click();
 const patience=page.getByRole('slider',{name:'Patience',exact:true});await patience.focus();await patience.press('Home');
 await expect(patience).toHaveValue('1');await expect(patience).toHaveAttribute('aria-valuetext','Level 1 of 5');
 const flexibility=page.getByRole('slider',{name:'Flexibility',exact:true});await flexibility.focus();await flexibility.press('End');
 await page.getByLabel('Your goal',{exact:true}).fill('Quiero conservar este texto original');
 await page.getByRole('button',{name:'Save changes',exact:true}).click();
 await expect(page.locator('[data-practice-status]')).toBeEmpty();
 await expect(page.locator('[data-practice-save]')).not.toHaveClass(/has-unsaved-changes/);
 const context=await page.evaluate(()=>window.TratoCloud.practiceContext);
 expect(context.language).toBe('en');expect(context.persona).toEqual({patience:1,flexibility:5,price_sensitivity:3});
 expect(context.allowed_tools).toEqual([]);expect(context.affects_business_state).toBe(false);
 expect(context.source_context.project_id).toBe('SP-001');
 expect(context.goal).toBe('Quiero conservar este texto original');
 await page.reload();await expect(patience).toHaveValue('1');await expect(flexibility).toHaveValue('5');
 await expect(page.getByLabel('Your goal',{exact:true})).toHaveValue('Quiero conservar este texto original');
 expect(c.reads.some(p=>p.endsWith('/documents')||p.endsWith('/activity')||p.endsWith('/proposals'))).toBe(false);
 expect(c.writes).toEqual([]);expect(c.errors).toEqual([]);
 await page.screenshot({path:'.local/browser-tests/rehearsals-en.png',fullPage:true});
});
test('Spanish rehearsal stays usable on mobile and requires explicit reset for invalid saved values',async({page})=>{
 await page.setViewportSize({width:390,height:844});const c=await setup(page);
 await page.evaluate(()=>sessionStorage.setItem('trato:tests.supabase.invalid:session:practice:owner-a',JSON.stringify({version:1,scenario:'scope',persona:{patience:0,flexibility:3,price:3},goal:''})));
 await page.getByRole('link',{name:'Ensayos',exact:true}).click();
 await expect(page.getByRole('button',{name:'Crear una configuración nueva',exact:true})).toBeVisible();
 await expect(page.getByRole('slider')).toHaveCount(0);
 await page.getByRole('button',{name:'Crear una configuración nueva',exact:true}).click();
 await expect(page.getByRole('slider',{name:'Paciencia',exact:true})).toHaveValue('3');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'.local/browser-tests/rehearsals-es-mobile.png',fullPage:true});
 expect(c.errors).toEqual([]);expect(c.writes).toEqual([]);
});
test('English payment and Gmail callback pages keep provider operations unchanged',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('trato:ui-language','en'));
 await page.goto('/gmail-callback.html');
 await expect(page.getByRole('heading',{name:'Connect Gmail to Trato',exact:true})).toBeVisible();
 await expect(page.locator('#result')).toHaveText('Open your Trato profile and click Connect Gmail again.');
 await page.goto('/paypal-payment.html');
 await expect(page.getByRole('heading',{name:'Your payment',exact:true})).toBeVisible();
 await expect(page.locator('#error')).toHaveText('The payment link is invalid.');
});
for(const lang of ['es','en'])test(`scripted rehearsal completes three turns without business commands (${lang})`,async({page})=>{
 const c=await setup(page,{lang});
 await page.getByRole('link',{name:lang==='es'?'Ensayos':'Rehearsals',exact:true}).click();
 await expect(page.getByRole('heading',{name:lang==='es'?'Practica antes de responder a tu cliente':'Practice before replying to your client',exact:true})).toBeVisible();
 await page.locator('#practice-case').selectOption('refund');
 const patience=page.getByRole('slider',{name:lang==='es'?'Paciencia':'Patience',exact:true});await patience.focus();await patience.press('Home');
 await page.getByRole('button',{name:lang==='es'?'Comenzar ensayo simulado':'Start scripted rehearsal',exact:true}).click();
 await expect(page.locator('.practice-conversation')).toContainText(lang==='es'?'Necesito una respuesta concreta.':'I need a direct answer.');
 await expect(page.locator('.practice-conversation')).toContainText(lang==='es'?'Quiero cancelar el trabajo.':'I want to cancel the work.');
 for(let turn=0;turn<3;turn++){
  await page.getByLabel(lang==='es'?'Tu respuesta':'Your reply',{exact:true}).fill(turn===0?'<script>window.bad=true</script>':`Respuesta original ${turn}`);
  await page.getByRole('button',{name:lang==='es'?'Responder':'Reply',exact:true}).click();
 }
 await expect(page.getByRole('heading',{name:lang==='es'?'Ensayo terminado':'Rehearsal finished',exact:true})).toBeVisible();
 await expect(page.locator('.practice-message.is-user')).toHaveCount(3);
 await expect(page.locator('.practice-message.is-user').first()).toContainText('<script>window.bad=true</script>');
 expect(await page.evaluate(()=>window.bad)).toBeUndefined();
 await page.getByText(lang==='es'?'Ver instrucciones del personaje':'View character instructions',{exact:true}).click();
 const prompt=await page.locator('.practice-instructions pre').textContent();
 for(const section of ['ROLE','CONTEXT','PRE-TASK CHECKLIST','TASK','FORMAT'])expect(prompt).toContain(section);
 expect(prompt).toContain('"language": "'+lang+'"');expect(prompt).toContain('"affects_business_state": false');
 await page.getByRole('button',{name:lang==='es'?'Volver a practicar':'Practice again',exact:true}).click();
 await expect(page.locator('.practice-message.is-user')).toHaveCount(0);
 await page.getByRole('button',{name:lang==='es'?'Volver a la configuración':'Back to configuration',exact:true}).click();
 await expect(page.locator('#practice-case')).toHaveValue('refund');
 expect(c.writes).toEqual([]);expect(c.errors).toEqual([]);
 await page.screenshot({path:`.local/browser-tests/rehearsals-intro-${lang}.png`,fullPage:true});
});
for(const lang of ['es','en'])test(`unsaved reminder follows actual changes and clears after save (${lang})`,async({page})=>{
 const c=await setup(page,{lang});await page.getByRole('link',{name:lang==='es'?'Ensayos':'Rehearsals',exact:true}).click();
 const button=page.locator('[data-practice-save]'),status=page.locator('[data-practice-status]'),goal=page.locator('#practice-goal');
 await expect(button).not.toHaveClass(/has-unsaved-changes/);
 await expect(page.locator('[data-practice-scenario]')).toHaveCount(0);
 await expect(page.locator('.practice-preview')).toHaveCount(0);
 await expect(page.getByText(lang==='es'?'El caso que vas a practicar':'Your practice case',{exact:true})).toHaveCount(0);
 await goal.fill('Nueva meta');await expect(button).toHaveClass(/has-unsaved-changes/);
 await expect(button).toHaveText(lang==='es'?'Guardar cambios':'Save changes');
 await expect(status).toHaveText(lang==='es'?'Tienes cambios sin guardar.':'You have unsaved changes.');
 await goal.fill('');await expect(button).not.toHaveClass(/has-unsaved-changes/);await expect(status).toBeEmpty();
 await page.locator('#practice-case').selectOption('refund');await expect(button).toHaveClass(/has-unsaved-changes/);
 await button.click();await expect(button).not.toHaveClass(/has-unsaved-changes/);await expect(status).toBeEmpty();
 const slider=page.locator('#practice-patience');await slider.focus();await slider.press('Home');await expect(button).toHaveClass(/has-unsaved-changes/);
 await slider.press('ArrowRight');await slider.press('ArrowRight');await expect(button).not.toHaveClass(/has-unsaved-changes/);
 await page.reload();await expect(button).not.toHaveClass(/has-unsaved-changes/);await expect(status).toBeEmpty();
 await expect(page.locator('#practice-case')).toHaveValue('refund');
 expect(c.errors).toEqual([]);expect(c.writes).toEqual([]);
});
