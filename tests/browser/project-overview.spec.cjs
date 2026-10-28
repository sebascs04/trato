const {test,expect}=require('@playwright/test');
const initial={id:'initial',project_id:'project-a',title:'Acuerdo de la web',kind:'initial_agreement',original_filename:'acuerdo.pdf',mime_type:'application/pdf',created_at:'2026-10-25T12:00:00Z',document_extractions:[{status:'ready'}]};
const request={...initial,id:'request',title:'Añadir catálogo',kind:'email_request',original_filename:'pedido.pdf',created_at:'2026-10-27T12:00:00Z'};
async function setup(page,{documents=[initial,request],proposals=[{id:'proposal',request_document_id:'request',business_status:'Pendiente de pago',revision_no:1}]}={}){
 const calls=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
 const config={supabase_url:'https://overview.supabase.invalid',publishable_key:'sb_publishable_test'};
 await page.addInitScript(()=>sessionStorage.setItem('trato:overview.supabase.invalid:session',JSON.stringify({access_token:'test-only',refresh_token:'test-only',expires_at:9999999999,user:{id:'user',email:'user@example.invalid'}})));
 await page.route('**/api/v1/**',async route=>{
  const path=new URL(route.request().url()).pathname;calls.push(path);let data;
  if(path.endsWith('/config'))data=config;
  else if(path.endsWith('/session'))data={user_id:'user'};
  else if(path.endsWith('/clients'))data=[{id:'client-a',name:'Estudio Norte'}];
  else if(path==='/api/v1/projects')data=[{id:'project-a',client_id:'client-a',name:'Sitio de la cafetería',status:'draft'}];
  else if(path.endsWith('/documents'))data=documents;
  else if(path.endsWith('/proposals'))data=proposals;
  else if(path.endsWith('/request-status'))data={can_register:!documents.some(d=>d.kind==='email_request'),active_request:documents.some(d=>d.kind==='email_request')?{id:'request',title:'Añadir catálogo'}:null,closures:[]};
  else if(path.endsWith('/activity'))data=[];
  else{await route.fulfill({status:404,json:{error:{code:'NOT_FOUND'}}});return;}
  await route.fulfill({json:{data}});
 });
 await page.goto('/#clientes');
 await page.getByRole('button',{name:'Abrir cliente Estudio Norte',exact:true}).click();
 await page.getByRole('button',{name:'Abrir proyecto Sitio de la cafetería',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Resumen del proyecto',exact:true})).toBeVisible();
 await expect(page.locator('[data-overview-card="changes"]')).not.toContainText('Consultando estado');
 return {calls,errors};
}
test('overview previews every section without duplicating management or fetching hidden views',async({page})=>{
 const {calls,errors}=await setup(page);
 await expect(page.locator('.cloud-agreement')).toContainText('Acuerdo de la web');
 await expect(page.locator('.cloud-overview-card')).toHaveCount(4);
 await expect(page.locator('[data-overview-card="changes"]')).toContainText('Añadir catálogo');
 await expect(page.locator('[data-overview-card="changes"]')).toContainText('Pendiente de pago');
 await expect(page.locator('.cloud-overview-card [data-cloud-action="upload"],.cloud-overview-card [data-cloud-action="manage-change"]')).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Registrar pedido del cliente',exact:true})).toHaveCount(0);
 expect(calls.filter(p=>p.endsWith('/activity')||p.includes('/graph')||p.includes('/simulation/'))).toEqual([]);
 await page.screenshot({path:'.local/browser-tests/project-overview.png',fullPage:true});
 expect(errors).toEqual([]);
});
test('overview links lead to the full section and history loads only when opened',async({page})=>{
 const {calls,errors}=await setup(page);
 const back=async()=>page.locator('.cloud-project-navigation [data-cloud-tab="acuerdo"]').click();
 await page.getByRole('button',{name:'Ver cambios',exact:true}).click();
 await expect(page.locator('.cloud-requests')).toBeVisible();
 await expect(page.getByRole('button',{name:'Registrar pedido del cliente',exact:true})).toHaveCount(1);
 await back();await page.getByRole('button',{name:'Ver devoluciones',exact:true}).click();
 await expect(page.locator('.cloud-refunds')).toBeVisible();
 await back();await page.getByRole('button',{name:'Ver documentos',exact:true}).click();
 await expect(page.locator('.document-library')).toContainText('Añadir catálogo');
 await back();expect(calls.filter(p=>p.endsWith('/activity'))).toHaveLength(0);
 await page.getByRole('button',{name:'Ver seguimiento',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Historial del proyecto',exact:true})).toBeVisible();
 await expect(page.locator('[data-cloud-history]')).toContainText('Los pedidos');
 expect(calls.filter(p=>p.endsWith('/activity'))).toHaveLength(1);expect(errors).toEqual([]);
});
test('empty overview keeps initial upload available and does not invent refunds or events',async({page})=>{
 const {calls,errors}=await setup(page,{documents:[],proposals:[]});
 await expect(page.getByRole('button',{name:'Añadir información',exact:true})).toBeVisible();
 await expect(page.locator('.cloud-overview-counts')).toContainText('0 documentos');
 await expect(page.locator('[data-overview-card="changes"]')).toContainText('Todavía no hay pedidos');
 await expect(page.locator('[data-overview-card="documents"]')).toContainText('Los archivos que añadas');
 await expect(page.locator('[data-overview-card="refunds"]')).not.toContainText('0 devoluciones');
 await page.getByRole('button',{name:'Añadir información',exact:true}).click();
 await expect(page.locator('.cloud-dialog input[name="kind"]')).toHaveValue('initial_agreement');
 expect(calls.some(p=>p.endsWith('/activity'))).toBe(false);expect(errors).toEqual([]);
});
test('home resumes the open project without extra project fetches',async({page})=>{
 const {calls,errors}=await setup(page);const baseline=calls.length;
 await page.getByRole('link',{name:'Vista general',exact:true}).click();
 await expect(page.locator('.cloud-home-resume')).toContainText('Sitio de la cafetería');
 await expect(page.locator('.cloud-home-resume')).toContainText('Estudio Norte');
 await page.screenshot({path:'.local/browser-tests/home-es.png',fullPage:true});
 await page.getByRole('link',{name:'Continuar proyecto',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Resumen del proyecto',exact:true})).toBeVisible();
 expect(calls.slice(baseline)).toEqual([]);expect(errors).toEqual([]);
});
