const {test,expect}=require('@playwright/test');
async function setup(page,{paid=false,draft=false}={}){
 let saved=paid||draft,reviewed=paid,sent=paid,sendCount=0,snapshotId='revision',scope='Un video adicional',closed=false;const writes=[];
 const docs=[{id:'initial',kind:'initial_agreement',title:'Acuerdo inicial'},{id:'request',kind:'email_request',title:'Un video adicional'}].map(d=>({...d,project_id:'project',original_filename:d.id+'.pdf',mime_type:'application/pdf',created_at:'2026-10-25T18:00:00Z',document_extractions:[{status:'ready'}]}));
 const summary=()=>({id:'proposal',request_document_id:'request',current_revision_id:snapshotId,revision_no:1,status:reviewed?'ready_for_review':'draft',locked_at:paid||closed?'2026-10-25T19:00:00Z':null,business_status:closed?'Cerrado':paid?'Finalizado':sent?'Esperando respuesta':'Adenda en borrador'});
 const detail=()=>({proposal:{...summary(),project_id:'project'},revision:{id:snapshotId,revision_no:1,scope_summary:scope,conditions:'Una revisión',additional_minor:10,deadline:'2026-11-12'},line_items:[{description:'Video',quantity:1,unit_amount_minor:10}],sources:[{document_id:'initial'},{document_id:'request'}],artifacts:[{document_id:'pdf',sha256:'a'.repeat(64)}],reviews:reviewed?[{}]:[],acceptances:paid?[{}]:[],deliveries:sent?[{kind:'adenda',status:'accepted_by_gmail',updated_at:'2026-10-25T19:00:00Z'}]:[],payments:paid?[{status:'completed',amount_minor:10,updated_at:'2026-10-25T19:01:00Z'}]:[],events:[{event_type:'revision_created',created_at:'2026-10-25T18:00:00Z'}],payment_required:true});
 await page.route('**/api/v1/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;let data;
  if(req.method()==='POST')writes.push({path,body:req.postDataJSON(),headers:req.headers()});
  if(path.endsWith('/config'))data={supabase_url:'https://tests.supabase.invalid',publishable_key:'sb_publishable_test'};
  else if(path.endsWith('/session'))data={user_id:'owner'};
  else if(path.endsWith('/clients'))data=[{id:'client',name:'Cliente prueba',contact_email:'recipient@example.com'}];
  else if(path.endsWith('/projects'))data=[{id:'project',client_id:'client',name:'Proyecto prueba'}];
  else if(path.endsWith('/documents'))data=docs;
  else if(path.endsWith('/extraction')){const id=path.split('/').at(-2);data={document:docs.find(d=>d.id===id),extraction:{status:'ready'},segments:[{locator_kind:'page',locator_number:1,text:'Fuente de prueba'}]};}
  else if(path==='/api/v1/proposals/proposal')data={proposal:summary(),revisions:[detail().revision],snapshots:[detail().revision]};
  else if(path.endsWith('/events'))data=[];
  else if(path.endsWith('/activity'))data=[{id:'registered',kind:'request_registered',title:'Pedido registrado',request_document_id:'request',request_title:'Un video adicional',created_at:'2026-10-25T18:00:00Z'},...(paid?[{id:'paid',kind:'payment_completed',title:'Pago confirmado · USD 0.10',request_document_id:'request',request_title:'Un video adicional',created_at:'2026-10-25T19:01:00Z'}]:[]),...(closed?[{id:'closed',kind:'request_closed',title:'Pedido cerrado · Retirado',request_document_id:'request',request_title:'Un video adicional',created_at:'2026-10-26T18:00:00Z'}]:[])];
  else if(path.endsWith('/request-status'))data={can_register:paid||closed,active_request:paid||closed?null:{id:'request',title:'Un video adicional'},closures:closed?[{request_document_id:'request',reason:'withdrawn',notes:'El cliente retiró el pedido',closed_at:'2026-10-26T18:00:00Z'}]:[]};
  else if(path==='/api/v1/projects/project/proposals'){
   if(req.method()==='POST'){saved=true;data={proposal_id:'proposal',revision_id:'revision'};}else data=saved?[summary()]:[];
  }
  else if(path==='/api/v1/requests/request/close'){closed=true;data={request_document_id:'request',reason:req.postDataJSON().reason};}
  else if(path.endsWith('/pdf'))data={document_id:'pdf',sha256:'a'.repeat(64)};
  else if(path.endsWith('/draft')){snapshotId='revision-edited';scope=req.postDataJSON().terms.scope_summary;reviewed=false;data={proposal_id:'proposal',revision_id:snapshotId};}
  else if(path.endsWith('/review')){reviewed=true;data={proposal_id:'proposal',revision_id:'revision'};}
  else if(path.endsWith('/email-preview'))data={sender:'sender@example.com',recipient:'recipient@example.com',subject:'Adenda para revisión',body:'Un video adicional por USD 0.10',filename:'adenda-v1.pdf',digest:'b'.repeat(64)};
  else if(path.endsWith('/email')){sendCount++;sent=true;data={status:'accepted_by_gmail'};}
  else if(/^\/api\/v1\/proposals\/proposal\/revisions\/(revision|revision-edited)$/.test(path))data=detail();
  else{await route.fulfill({status:404,json:{error:{code:'NOT_FOUND'}}});return;}
  await route.fulfill({json:{data}});
 });
 await page.addInitScript(()=>sessionStorage.setItem('trato:tests.supabase.invalid:session',JSON.stringify({access_token:'test',refresh_token:'test',expires_at:9999999999,user:{id:'owner',email:'sender@example.com'}})));
 await page.goto('/#clientes');await page.getByRole('button',{name:'Abrir cliente Cliente prueba'}).click();await page.getByRole('button',{name:'Abrir proyecto Proyecto prueba'}).click();
 await page.locator('.cloud-change-row [data-request-primary]').click();
 return {writes,sendCount:()=>sendCount,completePayment:()=>{paid=true;saved=true;reviewed=true;sent=true;}};
}
test('manual proposal saves its exact PDF, reviews email and sends only on explicit confirmation',async({page})=>{
 const context=await setup(page);
 await page.getByRole('button',{name:'Preparar propuesta manual →',exact:true}).click();
 await page.getByLabel('Alcance del cambio').fill('Un video adicional');await page.getByLabel('Condiciones',{exact:true}).fill('Una revisión');await page.getByLabel('Detalle del adicional').fill('Video');await page.getByLabel('Adicional total en USD').fill('0.10');await page.getByLabel('Fecha de entrega',{exact:true}).fill('2026-11-12');
 await page.getByRole('button',{name:'Guardar adenda →',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Adenda en borrador',exact:true})).toBeVisible();
 const creation=context.writes.find(w=>w.path==='/api/v1/projects/project/proposals');expect(creation.body.terms.line_items[0].unit_amount_minor).toBe(10);expect(creation.body.source_document_ids).toEqual(['initial','request']);expect(creation.headers['idempotency-key']).toBeTruthy();
 expect(context.sendCount()).toBe(0);
 let projectReloads=0;
 const countReload=request=>{if(/\/api\/v1\/projects\/project\/(documents|events|proposals)$/.test(new URL(request.url()).pathname))projectReloads++;};
 page.on('request',countReload);
 await page.getByRole('button',{name:'Revisar adenda y correo →'}).click();await page.getByLabel('Revisé esta versión y quiero preparar el correo.').check();await page.getByRole('button',{name:'Confirmar revisión →'}).click();
 await expect(page.locator('.cloud-dialog')).toContainText('recipient@example.com');expect(context.sendCount()).toBe(0);
 expect(projectReloads).toBe(0);page.off('request',countReload);
 await page.screenshot({path:'.local/browser-tests/mail-preview.png'});
 await page.getByRole('button',{name:'Enviar correo →',exact:true}).click();await expect(page.getByRole('heading',{name:'Esperando respuesta',exact:true})).toBeVisible();expect(context.sendCount()).toBe(1);
 await expect(page.getByRole('button',{name:'Revisar correo de la adenda →'})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Enviar correo →',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Registrar aceptación recibida →'})).toBeVisible();await expect(page.getByRole('button',{name:'Preparar cobro →'})).toHaveCount(0);
});
test('paid change remains read-only while preserving PDF and version history',async({page})=>{
 await setup(page,{paid:true});await expect(page.getByRole('heading',{name:'Finalizado',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Preparar una nueva versión'})).toHaveCount(0);await expect(page.getByRole('button',{name:'Preparar cobro →'})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Ver PDF v1 ↗'})).toBeVisible();await expect(page.getByRole('button',{name:'Consultar todas las versiones ↗'})).toBeVisible();
});

test('project history is the only activity feed and shows the paid change first',async({page})=>{
 await setup(page,{paid:true});
 await page.getByRole('button',{name:'← Volver a los pedidos',exact:true}).click();
 await expect(page.getByRole('button',{name:'Ver historial',exact:true})).toHaveCount(0);
 await page.locator('summary').filter({hasText:'Historial del proyecto'}).click();
 const history=page.locator('[data-cloud-history]');
 await expect(history.locator('.cloud-project-event').first()).toContainText('Pago confirmado · USD 0.10');
 await expect(history.locator('[data-proposal-action],button')).toHaveCount(0);
});

test('editing an unsent draft keeps v1 and uses draft endpoint rather than a new client version',async({page})=>{
 const context=await setup(page,{draft:true});
 await expect(page.getByRole('button',{name:'Editar borrador',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Preparar una nueva versión'})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Registrar ajustes del cliente'})).toHaveCount(0);
 await page.getByRole('button',{name:'Editar borrador',exact:true}).click();
 await page.getByLabel('Alcance del cambio').fill('Video vertical corregido');
 await page.getByRole('button',{name:'Guardar cambios del borrador →',exact:true}).click();
 await expect(page.locator('.cloud-tracking')).toContainText('Video vertical corregido');
 await expect(page.locator('.cloud-tracking')).toContainText('Adenda v1');
 await expect(page.locator('.cloud-tracking')).not.toContainText('Adenda v2');
 expect(context.writes.filter(w=>w.path==='/api/v1/proposals/proposal/draft')).toHaveLength(1);
 expect(context.writes.filter(w=>w.path==='/api/v1/proposals/proposal/revisions')).toHaveLength(0);
});

test('one open request disables registration until explicitly closed without accepting or charging',async({page})=>{
 const context=await setup(page);
 await page.getByRole('button',{name:'← Volver a los pedidos',exact:true}).click();
 await expect(page.getByRole('button',{name:'Registrar pedido del cliente',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'Revisar cambio →',exact:true}).click();
 await page.getByRole('button',{name:'Cerrar pedido',exact:true}).click();
 await page.getByLabel('Motivo',{exact:true}).selectOption('withdrawn');
 await page.getByLabel('Detalle',{exact:true}).fill('El cliente retiró el pedido');
 await page.locator('.cloud-dialog').getByRole('button',{name:'Cerrar pedido',exact:true}).click();
 await page.locator('summary').filter({hasText:'Historial del proyecto'}).click();
 await expect(page.locator('[data-cloud-history]')).toContainText('Pedido cerrado · Retirado');
 await expect(page.locator('[data-cloud-history] [data-proposal-action]')).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Registrar pedido del cliente',exact:true})).toBeEnabled();
 expect(context.writes.filter(w=>w.path==='/api/v1/requests/request/close')).toHaveLength(1);
 expect(context.writes.some(w=>w.path.endsWith('/acceptance')||w.path.endsWith('/payment'))).toBe(false);
});

test('returning to Trato refreshes backend payment state and invalidates an open history without writes',async({page})=>{
 const context=await setup(page,{draft:true});
 await expect(page.getByRole('heading',{name:'Adenda en borrador',exact:true})).toBeVisible();
 await page.locator('[data-cloud-resource="history"]>summary').click();
 await expect(page.locator('[data-cloud-history]')).toContainText('Pedido registrado');
 const reads=[];page.on('request',request=>{if(request.method()==='GET')reads.push(new URL(request.url()).pathname);});
 context.completePayment();
 await page.evaluate(()=>{
  Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));
  Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));
 });
 await expect(page.getByRole('heading',{name:'Finalizado',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Editar borrador',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Preparar cobro →',exact:true})).toHaveCount(0);
 await expect(page.locator('[data-cloud-history]')).toContainText('Pago confirmado · USD 0.10');
 expect(reads.some(path=>path.endsWith('/documents')||path.endsWith('/events'))).toBe(false);
 expect(context.writes).toHaveLength(0);
});
