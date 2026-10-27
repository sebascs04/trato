const {test,expect}=require('@playwright/test');
test.setTimeout(60000);
async function open(page){
 await page.route('**/api/v1/**',route=>{
  const path=new URL(route.request().url()).pathname;
  const data=path.endsWith('/config')?{supabase_url:'https://tests.supabase.invalid',publishable_key:'sb_publishable_test'}:[];
  return route.fulfill({json:{data}});
 });
 await page.goto('/#clientes');
 await page.evaluate(async()=>{const {openRefundPreview}=await import('/refund-preview.mjs');await openRefundPreview({});});
 await expect(page.getByRole('dialog',{name:'Devolución y cierre acordado · simulación'})).toBeVisible();
}
async function start(page,scenario='partial'){
 await page.locator('[data-refund-scenario]').selectOption(scenario);
 await page.getByRole('button',{name:'Comenzar recorrido',exact:false}).click();
 await expect(page.getByRole('heading',{name:'¿Qué está pidiendo el cliente?',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Revisar análisis y condiciones',exact:false}).click();
}
async function draft(page){
 await start(page);await expect(page.getByRole('heading',{name:'Lo acordado y lo que permite PayPal',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Guardar propuesta de cierre',exact:false}).click();
 await expect(page.getByRole('heading',{name:'Revisa antes de enviarla',exact:true})).toBeVisible();
}
async function accept(page){
 await draft(page);await page.getByRole('button',{name:'Simular envío al cliente',exact:false}).click();
 await expect(page.getByRole('heading',{name:'El cliente revisa la propuesta v1',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Simular aceptación',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Autoriza la devolución de esta versión',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Autorizar devolución simulada',exact:false}).click();
 await expect(page.getByRole('heading',{name:'Falta confirmar el resultado de la operación',exact:true})).toBeVisible();
}
test('refund simulation runs through the actual generic worker and keeps PayPal sources separate from project evidence',async({page})=>{
 const errors=[],businessWrites=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST'&&/\/api\/v1\//.test(r.url()))businessWrites.push(r.url());});
 await open(page);await draft(page);
 await page.locator('.refund-evidence summary').filter({hasText:'PayPal Perú'}).click();
 await expect(page.locator('.refund-evidence')).toContainText('Perú · pagos por artículos o servicios');
 await expect(page.getByRole('link',{name:'Abrir fuente oficial',exact:false}).first()).toHaveAttribute('href','https://www.paypal.com/pe/cshelp/article/how-do-i-issue-a-refund-help101');
 await expect(page.locator('.refund-breakdown .refund-total')).toContainText('100.00');
 await expect(page.locator('.refund-breakdown')).toContainText('190.00');
 await page.screenshot({path:'.local/browser-tests/refund-proposal-sources.png',fullPage:true});
 await page.getByRole('button',{name:'Simular envío al cliente',exact:false}).click();await page.getByRole('button',{name:'Simular aceptación',exact:true}).click();
 await page.getByRole('button',{name:'Autorizar devolución simulada',exact:false}).click();
 await page.getByRole('button',{name:'Simular resultado pendiente',exact:true}).click();
 await expect(page.locator('.refund-main')).toContainText('sigue en PENDING');
 await expect(page.getByRole('heading',{name:'Devolución completada',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Simular resultado completado',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Devolución completada',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Autorizar devolución simulada',exact:false})).toHaveCount(0);
 await expect(page.locator('.refund-outcome')).toContainText('exclusivamente en esta simulación');
 await page.getByRole('button',{name:'Cerrar devolución simulada',exact:true}).click();
 await page.reload();await page.evaluate(async()=>{const m=await import('/refund-preview.mjs');await m.openRefundPreview({});});
 await page.getByRole('button',{name:'Continuar recorrido guardado',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Devolución completada',exact:true})).toBeVisible();
 expect(businessWrites).toHaveLength(0);expect(errors).toEqual([]);
});
test('missing evidence pauses and expired case never exposes a refund action',async({page})=>{
 await open(page);await start(page,'unclear');
 await expect(page.getByRole('heading',{name:'Primero aclaremos el valor del trabajo',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Guardar propuesta de cierre',exact:false})).toHaveCount(0);
 await page.getByLabel('Valor propuesto del trabajo en USD').fill('150');await page.getByLabel('Aclaración y respaldo del ejemplo').fill('Ambas partes proponen reconocer USD 150 del trabajo.');
 await page.getByRole('button',{name:'Registrar aclaración y revisar',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Lo acordado y lo que permite PayPal',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Elegir otro caso de prueba',exact:true}).click();await start(page,'expired');
 await expect(page.getByRole('heading',{name:'El pago supera el plazo de este recorrido',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Autorizar devolución simulada',exact:false})).toHaveCount(0);
 await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.querySelector('.refund-preview').scrollWidth<=document.querySelector('.refund-preview').clientWidth)).toBe(true);
});
test('provider failure remains visible and never completes the simulation',async({page})=>{
 await open(page);await accept(page);
 await page.getByRole('button',{name:'Simular fallo',exact:true}).click();
 await expect(page.getByRole('heading',{name:'No se completó el reembolso',exact:true})).toBeVisible();
 await expect(page.locator('.refund-outcome')).toContainText('FAILED');
 await expect(page.getByRole('heading',{name:'Devolución completada',exact:true})).toHaveCount(0);
});
test('preview refuses a failed simulation service instead of fabricating a result',async({page})=>{
 await open(page);await page.route('**/api/simulation/threads',route=>route.fulfill({status:503,json:{error:'Servicio no disponible'}}));
 await page.getByRole('button',{name:'Comenzar recorrido',exact:false}).click();
 await expect(page.locator('.refund-main [role="alert"]')).toHaveText('Servicio no disponible');
 await expect(page.getByRole('heading',{name:'¿Qué está pidiendo el cliente?',exact:true})).toHaveCount(0);
});

test('draft edits and client feedback preserve versions through persisted worker pauses',async({page})=>{
 await open(page);await draft(page);
 await page.getByRole('button',{name:'Editar borrador',exact:true}).click();
 await page.getByLabel('Trabajo reconocido en USD').fill('250');
 await page.getByRole('button',{name:'Guardar borrador revisado',exact:false}).click();
 await expect(page.locator('.refund-main>.eyebrow')).toHaveText('3 · PROPUESTA V1');
 await expect(page.locator('.refund-total')).toContainText('50.00');
 await page.getByRole('button',{name:'Simular envío al cliente',exact:false}).click();
 await page.getByRole('button',{name:'El cliente pide ajustes',exact:true}).click();
 await page.getByLabel('Qué pide cambiar el cliente').fill('Propongo reconocer USD 150 y recibir USD 150 de vuelta.');
 await page.getByRole('button',{name:'Registrar ajustes y preparar nueva versión',exact:true}).click();
 await expect(page.locator('.refund-main blockquote')).toContainText('Propongo reconocer USD 150');
 await page.getByLabel('Trabajo reconocido en USD').fill('150');
 await page.getByRole('button',{name:'Guardar propuesta de cierre',exact:false}).click();
 await expect(page.locator('.refund-main>.eyebrow')).toHaveText('3 · PROPUESTA V2');
 await page.locator('.refund-versions>summary').click();
 await expect(page.locator('.refund-versions article')).toHaveCount(2);
 await expect(page.locator('.refund-versions article').last()).toContainText('Versión 1');
 await expect(page.getByRole('button',{name:'Autorizar devolución simulada',exact:false})).toHaveCount(0);
});

test('local simulation endpoint isolates sessions and rejects connected mode or changed event payloads',async({browser})=>{
 const {randomUUID}=require('node:crypto');
 const one=await browser.newContext(),two=await browser.newContext();
 try{
  const message={type:'thread',schema_version:1,mode:'simulation',workflow:'manage_refund',thread_id:randomUUID(),event_id:randomUUID(),action:'start',context:{},payload:{request_id:randomUUID(),fixture_id:'partial'}};
  const url='http://localhost:5173/api/simulation/threads',headers={Origin:'http://localhost:5173'};
  expect((await one.request.post(url,{headers,data:{...message,mode:'connected'}})).status()).toBe(422);
  const first=await one.request.post(url,{headers,data:message});expect(first.status()).toBe(202);
  const op=await first.json();
  const duplicate=await one.request.post(url,{headers,data:message});expect((await duplicate.json()).operation_id).toBe(op.operation_id);
  const conflict=await one.request.post(url,{headers,data:{...message,payload:{...message.payload,fixture_id:'expired'}}});expect(conflict.status()).toBe(409);
  expect((await two.request.get('http://localhost:5173'+op.status_url)).status()).toBe(404);
  await expect.poll(async()=>{const response=await one.request.get('http://localhost:5173'+op.status_url);return response.status();},{timeout:25000}).toBe(200);
  const result=await (await one.request.get('http://localhost:5173'+op.status_url)).json();
  expect(result.data.mode).toBe('simulation');expect(result.data.result.pending.stage).toBe('review_refund_case');
 }finally{await one.close();await two.close();}
});

test('project refund tab opens the simulation only after explicit selection',async({page})=>{
 const requests=[];page.on('request',r=>requests.push(new URL(r.url()).pathname));
 await page.route('**/api/v1/**',route=>{
  const path=new URL(route.request().url()).pathname;
  const data=path.endsWith('/config')?{supabase_url:'https://tests.supabase.invalid',publishable_key:'sb_publishable_test'}:path==='/api/v1/clients'?[{id:'client',name:'Cliente privado'}]:path==='/api/v1/projects'?[{id:'project',client_id:'client',name:'Proyecto privado'}]:path.endsWith('/request-status')?{can_register:true,closures:[],active_request:null}:[];
  return route.fulfill({json:{data}});
 });
 await page.addInitScript(()=>sessionStorage.setItem('trato:tests.supabase.invalid:session',JSON.stringify({access_token:'test',refresh_token:'test',expires_at:9999999999,user:{id:'owner',email:'sender@example.invalid'}})));
 await page.goto('/#clientes');await page.getByRole('button',{name:'Abrir cliente Cliente privado',exact:true}).click();await page.getByRole('button',{name:'Abrir proyecto Proyecto privado',exact:true}).click();
 await page.getByRole('navigation',{name:'Secciones del proyecto'}).getByRole('button',{name:'Devoluciones: Dinero de un pago recibido',exact:true}).click();
 expect(requests.filter(p=>p==='/refund-preview.mjs')).toHaveLength(0);
 await page.getByRole('button',{name:'Probar flujo de devolución',exact:false}).click();
 await expect(page.getByRole('dialog',{name:'Devolución y cierre acordado · simulación',exact:true})).toBeVisible();
 await expect(page.locator('.refund-preview-mode')).toContainText('Caso de ejemplo independiente');
 expect(requests.filter(p=>p.startsWith('/api/simulation/'))).toHaveLength(0);
 expect(requests.filter(p=>p==='/refund-preview.mjs')).toHaveLength(1);
});
