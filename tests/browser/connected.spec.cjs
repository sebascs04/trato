const {test,expect} = require('@playwright/test');
const {mkdirSync} = require('node:fs');
const config={supabase_url:'https://tests.supabase.invalid',publishable_key:'sb_publishable_test'};
const projects=[{id:'project-a',client_id:'client-a',name:'Proyecto privado A'},{id:'project-b',client_id:'client-b',name:'Proyecto privado B'}];
const clients=[{id:'client-a',name:'Cliente privado A',contact_email:'a@example.invalid'},{id:'client-b',name:'Cliente privado B'}];
const doc=id=>({id:`doc-${id}`,project_id:`project-${id}`,title:`Documento exclusivo ${id.toUpperCase()}`,kind:'reference',mime_type:'application/pdf',original_filename:`${id}.pdf`,created_at:'2026-10-24T20:00:00Z',document_extractions:[{status:'ready'}]});

async function setup(page,{connected=true,clientData=clients,projectData=projects,documentData,eventData=[],activityData}={}) {
  const errors=[]; page.on('pageerror',error=>errors.push(error.message));
  const extraDocuments=[];
  await page.route('**/api/v1/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    let data;
    if(path==='/api/v1/config') data=config;
    else if(path==='/api/v1/session') data={user_id:'test-user'};
    else if(/^\/api\/v1\/clients\/client-[ab]\/delete$/.test(path)){const id=path.split('/').at(-2);expect(route.request().method()).toBe('POST');expect(route.request().headers()['authorization']).toBe('Bearer test-only-access');clientData=clientData.filter(c=>c.id!==id);projectData=projectData.filter(p=>p.client_id!==id);data={id,deleted_at:'2026-10-26T00:00:00Z'};}
    else if(path==='/api/v1/clients') data=clientData;
    else if(path==='/api/v1/projects') data=projectData;
    else if(path.match(/\/projects\/project-[ab]\/documents$/)) {
      if(route.request().method()==='POST') {
        expect(route.request().headers()['authorization']).toBe('Bearer test-only-access');
        expect(route.request().headers()['idempotency-key']).toBeTruthy();
        const query=new URL(route.request().url()).searchParams;
        const created={...doc('a'),id:`doc-new-${extraDocuments.length+1}`,title:query.get('title'),kind:query.get('kind')};
        extraDocuments.push(created); data={document:created,extraction:{status:'ready'},segments:[]};
      } else data=[...(documentData ?? [doc(path.includes('project-a')?'a':'b')]),...extraDocuments];
    }
    else if(path.endsWith('/events')) data=eventData;
    else if(path.endsWith('/activity'))data=activityData??[...(documentData??[]),...extraDocuments].filter(d=>d.kind==='email_request').map(d=>({id:'request-'+d.id,kind:'request_registered',title:'Pedido registrado',request_title:d.title,created_at:d.created_at}));
    else if(path.endsWith('/proposals')) data=[];
    else if(path.endsWith('/request-status')){const request=[...(documentData??[]),...extraDocuments].find(d=>d.kind==='email_request');data={can_register:!request,active_request:request?{id:request.id,title:request.title}:null,closures:[]};}
    else if(path.endsWith('/file')) {expect(route.request().headers()['authorization']).toBe('Bearer test-only-access');await route.fulfill({contentType:'application/pdf',body:require('node:fs').readFileSync('data/pdfs/DOC-SP-002.pdf')});return;}
    else if(path.endsWith('/extraction')) {const id=path.includes('doc-a')?'a':'b'; const documentId=path.split('/').at(-2); const record=[...(documentData ?? [doc('a'),doc('b')]),...extraDocuments].find(item=>item.id===documentId) || doc(id);data={document:record,extraction:{status:'ready'},segments:[{locator_kind:'page',locator_number:1,text:`Fuente del proyecto ${id.toUpperCase()} <img src=x onerror=alert(1)>`}]};}
    else {await route.fulfill({status:404,json:{error:{code:'NOT_FOUND'}}});return;}
    await route.fulfill({json:{data}});
  });
  await page.route('https://tests.supabase.invalid/auth/v1/logout',route=>route.fulfill({json:{}}));
  if(connected) await page.addInitScript(({config})=>{
    sessionStorage.setItem('trato:tests.supabase.invalid:session',JSON.stringify({access_token:'test-only-access',refresh_token:'test-only-refresh',expires_at:9999999999,user:{id:'test-user',email:'user@example.invalid'}}));
  },{config});
  await page.goto('/#clientes');
  await expect(page.getByRole('button',{name:/Mi perfil/})).toBeVisible();
  return errors;
}

async function openClient(page,name='Cliente privado A') {
  await page.getByRole('button',{name:`Abrir cliente ${name}`,exact:true}).click();
  await expect(page.getByRole('region',{name:'Cliente seleccionado',exact:true})).toContainText(name);
}
async function openWorkspace(page) {
  await openClient(page);
  await page.getByRole('button',{name:'Abrir proyecto Proyecto privado A',exact:true}).click();
  await expect(page.locator('.cloud-agreement')).toBeVisible();
  await page.getByRole('button',{name:'Documentos: Archivos por pedido',exact:true}).click();
  await expect(page.locator('.document-library')).toContainText('Documento exclusivo A');
}

test('original profile opens access dialog without replacing the design',async({page})=>{
  const errors=await setup(page,{connected:false});
  await page.getByRole('button',{name:'Mi perfil · iniciar sesión'}).click();
  await expect(page.getByRole('heading',{name:'Accede a tu estudio'})).toBeVisible();
  await expect(page.getByLabel('Correo',{exact:true})).toBeVisible();
  await expect(page.locator('#trato-sidebar .brand')).toBeVisible();
  await expect(page.locator('#cloud-password')).toHaveAttribute('type','password');
  expect(errors).toEqual([]);
});

test('a saved client remains visible without projects and opens its first project form',async({page})=>{
  const errors=await setup(page,{clientData:[{id:'client-new',name:'Mi primer cliente',contact_email:'client@example.invalid'}],projectData:[]});
  await expect(page.locator('.cloud-client-directory')).toContainText('Mi primer cliente');
  await expect(page.locator('.cloud-client-directory')).toContainText('Ver proyectos');
  await expect(page.getByRole('button',{name:'＋ Nuevo cliente',exact:true})).toHaveCount(1);
  await expect(page.getByRole('button',{name:'＋ Nuevo proyecto',exact:true})).toHaveCount(0);
  await openClient(page,'Mi primer cliente');
  await expect(page.getByRole('button',{name:'＋ Nuevo proyecto',exact:true})).toHaveCount(1);
  await page.getByRole('button',{name:'＋ Nuevo proyecto',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Nuevo proyecto',exact:true})).toBeVisible();
  await expect(page.locator('.cloud-dialog input[name="client"]')).toHaveValue('client-new');
  await expect(page.locator('.cloud-dialog')).toContainText('Mi primer cliente');
  await expect(page.locator('.cloud-dialog select')).toHaveCount(0);
  await expect(page.getByLabel('Nombre del nuevo proyecto')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('region',{name:'Cliente seleccionado',exact:true})).toContainText('Mi primer cliente');
  await expect(page.locator('.cloud-dialog')).not.toBeVisible();
  expect(errors).toEqual([]);
});

test('login from profile opens the private workspace and closes the access dialog',async({page})=>{
  const errors=await setup(page,{connected:false});
  await page.route('https://tests.supabase.invalid/auth/v1/token?grant_type=password',async route=>{
    const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS'};
    if(route.request().method()==='OPTIONS') {await route.fulfill({status:204,headers});return;}
    await route.fulfill({headers,json:{access_token:'test-only-access',refresh_token:'test-only-refresh',expires_at:9999999999,user:{id:'test-user',email:'user@example.invalid'}}});
  });
  await page.getByRole('button',{name:'Mi perfil · iniciar sesión'}).click();
  await page.locator('#cloud-email').fill('user@example.invalid');
  await page.locator('#cloud-password').fill('test-only-password');
  await page.getByRole('button',{name:'Iniciar sesión',exact:true}).click();
  await expect(page.locator('.cloud-dialog')).not.toBeVisible();
  await expect(page.locator('.cloud-client-directory')).toContainText('Cliente privado A');
  await expect(page.locator('.top-actions .demo-pill')).toHaveText('Espacio conectado');
  expect(errors).toEqual([]);
});

test('connected projects show their own context and never show fixture projects',async({page})=>{
  const errors=await setup(page);
  await expect(page.locator('.top-actions .demo-pill')).toHaveText('Espacio conectado');
  await expect(page.locator('.cloud-client-directory')).toContainText('Cliente privado A');
  await expect(page.locator('.client-banner')).toHaveCount(0);
  await openWorkspace(page);
  await expect(page.locator('.client-banner h2')).toHaveText('Proyecto privado A');
  await expect(page.locator('[data-cloud-action=client]')).toBeHidden();
  await expect(page.getByRole('button',{name:'＋ Nuevo proyecto',exact:true})).toHaveCount(0);
  await expect(page.locator('.cloud-client-header')).toHaveCount(0);
  await expect(page.locator('.document-library')).toContainText('Documento exclusivo A');
  await expect(page.locator('#client-workspace')).not.toContainText('SP-001');
  await expect(page.locator('#general-assistant-toggle')).toBeHidden();
  mkdirSync('.local/browser-tests',{recursive:true});
  await page.screenshot({path:'.local/browser-tests/connected-clients.png',fullPage:true});
  expect(errors).toEqual([]);
});

test('switching project stays within its client, isolates documents and renders source text safely',async({page})=>{
  const errors=await setup(page,{projectData:[projects[0],{...projects[1],client_id:'client-a'},{id:'project-other',client_id:'client-b',name:'Proyecto de otro cliente'}]});
  await openWorkspace(page);
  await expect(page.locator('#cloud-picker option')).toHaveCount(2);
  await expect(page.locator('#cloud-picker')).not.toContainText('Proyecto de otro cliente');
  await page.locator('#cloud-picker').selectOption('project-b');
  await expect(page.locator('.cloud-agreement')).toBeVisible();
  await page.getByRole('button',{name:'Documentos: Archivos por pedido',exact:true}).click();
  await expect(page.locator('.document-library')).toContainText('Documento exclusivo B');
  await expect(page.locator('.document-library')).not.toContainText('Documento exclusivo A');
  await page.locator('.document-button').click();
  await expect(page.locator('.cloud-pdf-frame')).toHaveAttribute('src',/^blob:/);
  await expect(page.locator('.cloud-dialog img')).toHaveCount(0);
  await page.getByRole('button',{name:'Cerrar',exact:true}).click();
  await page.getByRole('button',{name:'← Todos los clientes',exact:true}).click();
  await openClient(page,'Cliente privado B');
  await expect(page.locator('.cloud-project-directory')).toContainText('Proyecto de otro cliente');
  await expect(page.locator('.cloud-project-directory')).not.toContainText('Proyecto privado A');
  expect(errors).toEqual([]);
});

test('logout clears private data and returns to access without sample clients',async({page})=>{
  const errors=await setup(page);
  await openWorkspace(page);
  await page.getByRole('button',{name:'Mi perfil · sesión iniciada'}).click();
  await expect(page.getByText('user@example.invalid',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Cerrar sesión',exact:true}).click();
  await expect(page.locator('.top-actions .demo-pill')).toHaveText('Tu espacio');
  await expect(page.getByRole('button',{name:'Iniciar sesión o crear cuenta',exact:true})).toBeVisible();
  await expect(page.locator('.client-selector')).toHaveCount(0);
  await expect(page.locator('#client-workspace')).not.toContainText('Cliente privado A');
  expect(await page.evaluate(()=>sessionStorage.getItem('trato:tests.supabase.invalid:session'))).toBeNull();
  expect(errors).toEqual([]);
});

test('original document dialog uploads a file to the selected project with session and idempotency',async({page})=>{
  const errors=await setup(page);
  await openWorkspace(page);
  await page.getByRole('button',{name:'Proyecto: Acuerdo y fuentes iniciales',exact:true}).click();
  await page.getByRole('button',{name:'Añadir información',exact:true}).click();
  await page.locator('.cloud-dialog [name="title"]').fill('Acuerdo guardado desde Clientes');
  await page.locator('.cloud-dialog [name="file"]').setInputFiles({name:'acuerdo.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-fake-browser-fixture')});
  await expect(page.locator('.cloud-dialog select[name=kind]')).toHaveCount(0);
  await page.getByRole('button',{name:'Guardar fuente del acuerdo →',exact:true}).click();
  await expect(page.locator('.cloud-dialog')).not.toBeVisible();
  await expect(page.locator('.cloud-agreement')).toContainText('Acuerdo guardado desde Clientes');
  await expect(page.locator('.cloud-setup-path')).toHaveCount(0);
  await expect(page.locator('.cloud-review')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Revisar lo acordado →',exact:true})).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.client-banner h2')).toHaveText('Proyecto privado A');
  await page.getByRole('button',{name:'Documentos: Archivos por pedido',exact:true}).click();
  await expect(page.locator('.document-library')).toContainText('Acuerdo guardado desde Clientes');
  await expect(page.locator('[data-document-kind="initial_agreement"]')).toContainText('Acuerdo guardado desde Clientes');
  await expect(page.locator('[data-document-kind="reference"]')).toContainText('Documento exclusivo A');
  expect(errors).toEqual([]);
});

test('creating a client shows it immediately and its new project keeps that client',async({page})=>{
  const clientData=[], projectData=[];
  const errors=await setup(page,{clientData,projectData});
  await page.route('**/api/v1/clients',async route=>{
    if(route.request().method()==='POST') {
      const body=route.request().postDataJSON();
      expect(body).toEqual({name:'Cliente recién creado',contact_email:'cliente@example.invalid'});
      const client={id:'client-created',...body}; clientData.push(client);
      await route.fulfill({json:{data:client}});
    } else await route.fulfill({json:{data:clientData}});
  });
  await page.route('**/api/v1/projects',async route=>{
    if(route.request().method()==='POST') {
      const body=route.request().postDataJSON();
      expect(body).toEqual({client_id:'client-created',name:'Primer proyecto del cliente'});
      const project={id:'project-a',...body}; projectData.push(project);
      await route.fulfill({json:{data:project}});
    } else await route.fulfill({json:{data:projectData}});
  });
  await expect(page.locator('.cloud-client-directory')).toBeVisible();
  const reads=[];page.on('request',request=>{if(request.method()==='GET')reads.push(new URL(request.url()).pathname);});
  await page.getByRole('button',{name:'＋ Nuevo cliente',exact:true}).click();
  await page.getByLabel('Nombre',{exact:true}).fill('Cliente recién creado');
  await page.getByLabel('Correo de contacto').fill('cliente@example.invalid');
  await page.getByRole('button',{name:'Guardar cliente',exact:true}).click();
  await expect(page.locator('.cloud-dialog')).not.toBeVisible();
  await expect(page.getByRole('region',{name:'Cliente seleccionado',exact:true})).toContainText('Cliente recién creado');
  await expect(page.getByRole('button',{name:'Abrir cliente Cliente recién creado',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'＋ Nuevo proyecto',exact:true}).click();
  await page.getByLabel('Nombre del nuevo proyecto').fill('Primer proyecto del cliente');
  await page.getByRole('button',{name:'Crear proyecto',exact:true}).click();
  await expect(page.locator('.cloud-dialog')).not.toBeVisible();
  await expect(page.locator('.client-banner')).toContainText('Cliente recién creado');
  await expect(page.getByRole('button',{name:'＋ Nuevo proyecto',exact:true})).toHaveCount(0);
  await expect(page.locator('.client-banner h2')).toHaveText('Primer proyecto del cliente');
  await page.getByRole('button',{name:'Proyectos del cliente',exact:true}).click();
  await expect(page.locator('.cloud-project-directory')).toContainText('Primer proyecto del cliente');
  await expect(page.getByRole('button',{name:'＋ Nuevo proyecto',exact:true})).toHaveCount(1);
  expect(reads.filter(path=>['/api/v1/session','/api/v1/clients','/api/v1/projects'].includes(path))).toEqual([]);
  expect(errors).toEqual([]);
});

test('an empty project guides initial agreement before new requests without an addendum upload',async({page})=>{
  const errors=await setup(page,{documentData:[]});
  await openClient(page);
  await page.getByRole('button',{name:'Abrir proyecto Proyecto privado A',exact:true}).click();
  await expect(page.locator('.cloud-agreement')).toContainText('Guarda lo que han conversado');
  mkdirSync('.local/browser-tests',{recursive:true});
  await page.screenshot({path:'.local/browser-tests/project-start.png',fullPage:true});
  await expect(page.locator('.client-tabs')).toHaveCount(0);
  await expect(page.locator('.cloud-project-journey')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Revisar lo acordado →',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Registrar pedido del cliente',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Añadir información',exact:true}).click();
  await expect(page.locator('.cloud-dialog')).toContainText('Adjunta el contrato o la conversación inicial.');
  await expect(page.locator('.cloud-dialog input[name=kind]')).toHaveValue('initial_agreement');
  await expect(page.locator('.cloud-dialog select')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a new client request is stored separately from initial agreement sources',async({page})=>{
  const errors=await setup(page,{documentData:[{...doc('a'),kind:'initial_agreement'}]});
  await openClient(page);
  await page.getByRole('button',{name:'Abrir proyecto Proyecto privado A',exact:true}).click();
  await expect(page.locator('.cloud-agreement')).toContainText('Documento exclusivo A');
  await expect(page.locator('.cloud-source-list .cloud-client-meta')).toContainText('a.pdf');
  await expect(page.locator('.cloud-source-list .cloud-client-meta')).toContainText('24 oct. 2026');
  await expect(page.locator('.cloud-source-list')).not.toContainText('Texto guardado');
  await page.getByRole('button',{name:'Ver documento ↗',exact:true}).click();
  await expect(page.locator('.cloud-pdf-frame')).toHaveAttribute('src',/^blob:/);
  await page.getByRole('button',{name:'Cerrar',exact:true}).click();
  await expect(page.locator('.cloud-setup-path')).toHaveCount(0);
  await expect(page.locator('.cloud-agreement')).toBeVisible();
  await expect(page.locator('.cloud-review')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Revisar lo acordado →',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Cambios: Alcance, precio o plazo',exact:true}).click();
  await page.getByRole('button',{name:'Registrar pedido del cliente',exact:true}).click();
  await expect(page.locator('.cloud-dialog input[name=kind]')).toHaveValue('email_request');
  await page.getByLabel('¿Qué te pidió el cliente?').fill('Añadir una sección');
  await page.locator('.cloud-dialog [name=file]').setInputFiles({name:'pedido.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-test-request')});
  await page.getByRole('button',{name:'Guardar pedido →',exact:true}).click();
  await expect(page.locator('.cloud-dialog')).not.toBeVisible();
  await expect(page.locator('#client-panel')).toContainText('Añadir una sección');
  await page.getByRole('button',{name:'← Volver al proyecto',exact:true}).click();
  await expect(page.locator('.cloud-agreement')).not.toContainText('Añadir una sección');
  await page.reload();
  await expect(page.locator('.client-banner h2')).toHaveText('Proyecto privado A');
  await expect(page.locator('#client-panel')).toContainText('Añadir una sección');
  expect(errors).toEqual([]);
});


test('slow session restoration never exposes sample clients during reload',async({page})=>{
  await setup(page);
  await expect(page.locator('.cloud-client-directory')).toBeVisible();
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  await page.route('**/api/v1/config',async route=>{await gate; await route.fulfill({json:{data:config}});});
  await page.reload();
  await expect(page.getByRole('heading',{name:'Recuperando tu espacio…',exact:true})).toBeVisible();
  await expect(page.locator('.cloud-loading[aria-busy=true]')).toBeVisible();
  await expect(page.locator('.cloud-loading button')).toHaveCount(0);
  await page.screenshot({path:'.local/browser-tests/loading-clients.png',fullPage:true});
  await expect(page.locator('.client-selector')).toHaveCount(0);
  await expect(page.locator('#client-workspace')).not.toContainText('SP-001');
  await expect(page.locator('.stats')).toBeHidden();
  await expect(page.locator('.top-actions .demo-pill')).toHaveText('Conectando…');
  release();
  await expect(page.locator('.cloud-client-directory')).toContainText('Cliente privado A');
});

test('a connection failure shows retry instead of switching to sample data',async({page})=>{
  await setup(page);
  await expect(page.locator('.cloud-client-directory')).toBeVisible();
  await page.route('**/api/v1/clients',route=>route.fulfill({status:503,json:{error:{code:'UNAVAILABLE'}}}));
  await page.reload();
  await expect(page.getByRole('button',{name:'Volver a intentar',exact:true})).toBeVisible();
  await expect(page.locator('.client-selector')).toHaveCount(0);
  await expect(page.locator('.stats')).toBeHidden();
  await page.route('**/api/v1/clients',route=>route.fulfill({json:{data:clients}}));
  await page.getByRole('button',{name:'Volver a intentar',exact:true}).click();
  await expect(page.locator('.cloud-client-directory')).toContainText('Cliente privado A');
});


test('multiple source uploads and reload keep one initial-agreement view without duplicate review',async({page})=>{
  const errors=await setup(page,{documentData:[]});
  await openClient(page);
  await page.getByRole('button',{name:'Abrir proyecto Proyecto privado A',exact:true}).click();
  for(const [index,title] of ['Correo inicial','Conversación sobre fechas'].entries()) {
    await page.getByRole('button',{name:'Añadir información',exact:true}).click();
    await page.locator('.cloud-dialog [name=title]').fill(title);
    await page.locator('.cloud-dialog [name=file]').setInputFiles({name:`fuente-${index}.pdf`,mimeType:'application/pdf',buffer:Buffer.from('%PDF-test-source')});
    await page.getByRole('button',{name:'Guardar fuente del acuerdo →',exact:true}).click();
    await expect(page.locator('.cloud-dialog')).not.toBeVisible();
    await expect(page.locator('.cloud-setup-path')).toHaveCount(0);
    await expect(page.locator('.cloud-review')).toHaveCount(0);
    await expect(page.locator('.cloud-requests')).toHaveCount(0);
  }
  await expect(page.locator('.cloud-source-list .cloud-client-row')).toHaveCount(2);
  await page.reload();
  await expect(page.locator('.client-banner h2')).toHaveText('Proyecto privado A');
  await expect(page.locator('.cloud-source-list .cloud-client-row')).toHaveCount(2);
  await expect(page.locator('.cloud-setup-path')).toHaveCount(0);
  await expect(page.locator('.cloud-agreement')).toBeVisible();
  await expect(page.locator('.cloud-review')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Revisar lo acordado →',exact:true})).toHaveCount(0);
  await expect(page.locator('.cloud-source-list .cloud-client-row')).toHaveCount(2);
  expect(errors).toEqual([]);
});


test('one project history shows payment and milestones newest first without internal reading events',async({page})=>{
 const activityData=[
  {id:'request',kind:'request_registered',title:'Pedido registrado',request_document_id:'request',request_title:'Pedido de cambio',created_at:'2026-10-24T18:00:00Z'},
  {id:'payment',kind:'payment_completed',title:'Pago confirmado · USD 0.10',request_document_id:'request',request_title:'Pedido de cambio',created_at:'2026-10-26T18:00:00Z'},
  {id:'mail',kind:'adenda_sent',title:'Adenda v1 enviada',request_document_id:'request',request_title:'Pedido de cambio',created_at:'2026-10-25T18:00:00Z'}];
 const errors=await setup(page,{activityData});await openClient(page);
 await page.getByRole('button',{name:'Abrir proyecto Proyecto privado A',exact:true}).click();
 await page.getByRole('button',{name:'Historial del proyecto: Historial y mapa',exact:true}).click();
 const history=page.locator('[data-cloud-history]');
 await expect(history.locator('.cloud-project-event')).toHaveCount(3);
 await expect(history.locator('.cloud-project-event').first()).toContainText('Pago confirmado · USD 0.10');
 await expect(history.locator('.cloud-project-event').last()).toContainText('Pedido registrado');
 await expect(history).not.toContainText('Texto guardado');await expect(history.locator('button')).toHaveCount(0);
 expect(errors).toEqual([]);
});

test('a saved request separates read-only history from reviewing its source comparison',async({page})=>{
  const errors=await setup(page,{documentData:[{...doc('a'),kind:'initial_agreement'},{...doc('b'),project_id:'project-a',kind:'email_request',title:'Pedido de tienda e inglés'}]});
  await openClient(page);
  await page.getByRole('button',{name:'Abrir proyecto Proyecto privado A',exact:true}).click();
  await expect(page.getByRole('button',{name:'Ver historial',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Cambios: Alcance, precio o plazo',exact:true}).click();
  await page.getByRole('button',{name:'Revisar cambio →',exact:true}).click();
  const review=page.locator('.cloud-change-review');
  await expect(review).toContainText('Pedido de tienda e inglés');
  await expect(review.getByRole('region',{name:'Información inicial',exact:true})).toContainText('Documento exclusivo A');
  await expect(review.getByRole('region',{name:'Información inicial',exact:true})).toContainText('Fuente del proyecto A');
  await expect(review.getByRole('region',{name:'Pedido nuevo',exact:true})).toContainText('Fuente del proyecto B');
  await expect(review.locator('img')).toHaveCount(0);
  mkdirSync('.local/browser-tests',{recursive:true});
  await page.screenshot({path:'.local/browser-tests/change-review.png',fullPage:true});
  await expect(page.getByRole('button',{name:'Preparar propuesta manual →',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'← Volver a los pedidos',exact:true}).click();
  await expect(page.locator('.cloud-requests')).toContainText('Pedido de tienda e inglés');
  await page.getByRole('button',{name:'← Volver al proyecto',exact:true}).click();
  await expect(page.locator('.cloud-setup-path')).toHaveCount(0);
  expect(errors).toEqual([]);
});


test('project loading shows placeholders until actual documents arrive',async({page})=>{
  const errors=await setup(page,{documentData:[{...doc('a'),kind:'initial_agreement'}]});
  await openClient(page);
  let release;const gate=new Promise(resolve=>{release=resolve;});
  await page.route('**/api/v1/projects/project-a/documents',async route=>{await gate;await route.fulfill({json:{data:[{...doc('a'),kind:'initial_agreement'}]}});});
  await page.getByRole('button',{name:'Abrir proyecto Proyecto privado A',exact:true}).click();
  await expect(page.getByRole('status',{name:'Cargando información del proyecto…',exact:true})).toHaveAttribute('aria-busy','true');
  await expect(page.locator('.cloud-agreement')).toHaveCount(0);
  await page.screenshot({path:'.local/browser-tests/loading-project.png',fullPage:true});
  release();
  await expect(page.locator('.cloud-agreement')).toContainText('Documento exclusivo A');
  await expect(page.locator('.cloud-loading')).toHaveCount(0);
  expect(errors).toEqual([]);
});


test('client deletion requires confirmation and refresh hides its projects without affecting another client',async({page})=>{
 const errors=await setup(page);
 await page.getByRole('button',{name:'Eliminar cliente Cliente privado A',exact:true}).click();
 await expect(page.locator('.cloud-dialog')).toContainText('junto con sus proyectos y documentos');
 await page.getByRole('button',{name:'Cancelar',exact:true}).click();
 await expect(page.getByRole('button',{name:'Abrir cliente Cliente privado A',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Eliminar cliente Cliente privado A',exact:true}).click();
 await page.locator('.cloud-dialog').getByRole('button',{name:'Eliminar cliente',exact:true}).click();
 await expect(page.getByRole('button',{name:'Abrir cliente Cliente privado A',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Abrir cliente Cliente privado B',exact:true})).toBeVisible();
 await page.reload();
 await expect(page.getByRole('button',{name:'Abrir cliente Cliente privado A',exact:true})).toHaveCount(0);
 expect(errors).toEqual([]);
});

test('documents group each request with its own versions and acceptance, newest request activity first',async({page})=>{
 const initial={...doc('a'),kind:'initial_agreement',created_at:'2026-10-24T18:00:00Z'};
 const first={...doc('b'),id:'request-1',project_id:'project-a',title:'Agregar subtítulos',kind:'email_request',created_at:'2026-10-25T18:00:00Z'};
 const second={...first,id:'request-2',title:'Nueva portada',created_at:'2026-10-26T18:00:00Z'};
 const addendum={...first,id:'adenda-1',title:'Adenda v1',kind:'addendum',created_at:'2026-10-27T18:00:00Z',request_links:[{request_document_id:'request-1',revision_no:1,role:'addendum'}]};
 const acceptance={...addendum,id:'acceptance-1',title:'Documento devuelto',request_links:[{request_document_id:'request-1',revision_no:1,role:'acceptance'}]};
 const orphan={...addendum,id:'orphan',title:'Documento sin relación',request_links:[]};
 await setup(page,{documentData:[initial,first,second,addendum,acceptance,orphan]});await openClient(page);
 await page.getByRole('button',{name:'Abrir proyecto Proyecto privado A',exact:true}).click();
 await page.getByRole('button',{name:'Documentos: Archivos por pedido',exact:true}).click();
 const groups=page.locator('.cloud-document-group');
 expect(await groups.evaluateAll(nodes=>nodes.map(n=>n.dataset.documentKind))).toEqual(['request','request','initial_agreement','unlinked']);
 const one=page.locator('[data-document-request="request-1"]'),two=page.locator('[data-document-request="request-2"]');
 await expect(one).toHaveAttribute('open','');
 await expect(one).toContainText('Agregar subtítulos');await expect(one).toContainText('Adenda · v1');await expect(one).toContainText('Aceptación · v1');
 await expect(two).not.toContainText('Adenda v1');await expect(two).not.toContainText('Documento devuelto');
 await expect(page.locator('[data-document-kind="unlinked"]')).toContainText('Documento sin relación');
 await expect(page.getByRole('button',{name:'Descargar original Adenda v1',exact:true})).toBeVisible();
 await expect(page.locator('.cloud-document-file').first()).toHaveCSS('margin-left','0px');
 await page.locator('.document-library').screenshot({path:'.local/browser-tests/document-library-by-request.png'});
});

test('project history groups milestones by request and orders both groups and milestones newest first',async({page})=>{
 const activityData=[
  {id:'old',kind:'request_registered',title:'Pedido registrado',request_document_id:'request-1',request_title:'Pedido anterior',created_at:'2026-10-24T18:00:00Z'},
  {id:'paid',kind:'payment_completed',title:'Pago confirmado · USD 0.10',request_document_id:'request-1',request_title:'Pedido anterior',created_at:'2026-10-25T18:00:00Z'},
  {id:'new',kind:'request_registered',title:'Pedido registrado',request_document_id:'request-2',request_title:'Pedido más reciente',created_at:'2026-10-26T18:00:00Z'}];
 await setup(page,{activityData});await openClient(page);
 await page.getByRole('button',{name:'Abrir proyecto Proyecto privado A',exact:true}).click();
 await page.getByRole('button',{name:'Historial del proyecto: Historial y mapa',exact:true}).click();
 const groups=page.locator('.cloud-history-request');await expect(groups).toHaveCount(2);
 await expect(groups.first().locator('summary')).toContainText('Pedido más reciente');
 await groups.last().locator('summary').click();
 await expect(groups.last().locator('.cloud-project-event').first()).toContainText('Pago confirmado');
 await expect(groups.last().locator('.cloud-project-event').last()).toContainText('Pedido registrado');
 await expect(groups.last().locator('.cloud-project-event').first()).toHaveCSS('display','grid');
 await expect(groups.last().locator('.cloud-project-timeline')).toHaveCSS('list-style-type','none');
 await page.locator('[data-cloud-history]').screenshot({path:'.local/browser-tests/project-history-grouped.png'});
});

test('pending ingestion polls only documents, becomes readable and stops',async({page})=>{
  const pending={...doc('a'),kind:'initial_agreement',document_extractions:[{status:'queued',worker_thread_id:'test-thread'}]};
  const errors=await setup(page,{documentData:[pending]});
  let reads=0,activityReads=0;
  page.on('request',req=>{if(new URL(req.url()).pathname.endsWith('/activity'))activityReads++;});
  await page.route('**/api/v1/projects/project-a/documents',route=>{
    reads++;
    return route.fulfill({json:{data:[reads===1?pending:{...pending,document_extractions:[{status:'ready',worker_thread_id:'test-thread'}]}]}});
  });
  await openClient(page);
  await page.getByRole('button',{name:'Abrir proyecto Proyecto privado A',exact:true}).click();
  await expect(page.locator('.cloud-agreement').getByRole('button',{name:'Procesando…'})).toBeDisabled();
  await expect(page.locator('.cloud-agreement').getByRole('button',{name:'Ver documento ↗'})).toBeVisible({timeout:5000});
  const ended=reads;
  await page.waitForTimeout(2300);
  expect(reads).toBe(ended);
  expect(activityReads).toBe(0);
  expect(errors).toEqual([]);
});

test('leaving a project stops pending-document polling',async({page})=>{
  const pending={...doc('a'),kind:'initial_agreement',document_extractions:[{status:'queued',worker_thread_id:'test-thread'}]};
  await setup(page,{documentData:[pending]});
  let reads=0;
  await page.route('**/api/v1/projects/project-a/documents',route=>{reads++;return route.fulfill({json:{data:[pending]}});});
  await openClient(page);
  await page.getByRole('button',{name:'Abrir proyecto Proyecto privado A',exact:true}).click();
  await expect(page.locator('.cloud-agreement').getByRole('button',{name:'Procesando…'})).toBeDisabled();
  await page.getByRole('button',{name:'Proyectos del cliente',exact:true}).click();
  const ended=reads;
  await page.waitForTimeout(2300);
  expect(reads).toBe(ended);
});

test('project data is requested on demand and reopening history reuses its loaded result',async({page})=>{
 const requests=[];
 page.on('request',request=>{const path=new URL(request.url()).pathname;if(path.startsWith('/api/v1/'))requests.push(path);});
 await setup(page);
 await expect(page.locator('.cloud-client-directory')).toBeVisible();
 expect(requests.filter(path=>path==='/api/v1/projects')).toHaveLength(0);
 expect(requests.filter(path=>path.endsWith('/documents')||path.endsWith('/activity'))).toHaveLength(0);
 await openClient(page);
 await expect(page.getByRole('button',{name:'Abrir proyecto Proyecto privado A',exact:true})).toBeVisible();
 expect(requests.filter(path=>path==='/api/v1/projects')).toHaveLength(1);
 expect(requests.filter(path=>path.endsWith('/documents'))).toHaveLength(0);
 await page.getByRole('button',{name:'Abrir proyecto Proyecto privado A',exact:true}).click();
 await expect(page.locator('.cloud-agreement')).toBeVisible();
 expect(requests.filter(path=>path.endsWith('/activity')||path.endsWith('/events'))).toHaveLength(0);
 await expect(page.locator('[data-cloud-files] .document-library')).toHaveCount(0);
 const history=page.getByRole('button',{name:'Historial del proyecto: Historial y mapa',exact:true});
 await history.click();await expect(page.locator('[data-cloud-history]')).toContainText('Los pedidos, envíos');
 expect(requests.filter(path=>path.endsWith('/activity'))).toHaveLength(1);
 await history.click();await history.click();
 await expect(page.locator('[data-cloud-history]')).toContainText('Los pedidos, envíos');
 expect(requests.filter(path=>path.endsWith('/activity'))).toHaveLength(1);
 await page.evaluate(()=>document.fonts.ready);
 expect(await page.evaluate(()=>document.fonts.check('500 16px Manrope'))).toBe(true);
});

test('real project map opens on demand and returns to the same project',async({page})=>{
  const errors=await setup(page);
  let graphRequests=0,graphSyncs=0;
  page.on('request',request=>{const path=new URL(request.url()).pathname;if(path==='/graph-live.mjs')graphRequests++;if(path.endsWith('/graph/sync'))graphSyncs++;});
  await mockProjectGraph(page);
  await openClient(page);
  await page.getByRole('button',{name:'Abrir proyecto Proyecto privado A',exact:true}).click();
  expect(graphRequests).toBe(0);
  const tracking=page.locator('.cloud-project-history');
  await expect(page.locator('.cloud-breadcrumb [data-cloud-action="graph-preview"]')).toHaveCount(0);
  await page.getByRole('button',{name:'Historial del proyecto: Historial y mapa',exact:true}).click();
  await expect(tracking.getByRole('heading',{name:'Historial del proyecto',exact:true})).toBeVisible();
  await tracking.getByRole('button',{name:'Mapa',exact:true}).click();
  await expect(page.locator('.graph-live-embedded')).toBeVisible();
  await expect(page.locator('.graph-live [data-live-node]')).toHaveCount(2);
  await expect(page.locator('.graph-live')).not.toContainText('Luna Studio');
  await tracking.getByRole('button',{name:'Historial',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Mapa del proyecto',exact:true})).toHaveCount(0);
  await expect(page.locator('.client-banner h2')).toHaveText('Proyecto privado A');
  expect(graphRequests).toBe(1);
  await expect(tracking.getByRole('button',{name:'Historial',exact:true})).toHaveAttribute('aria-pressed','true');
  await tracking.getByRole('button',{name:'Mapa',exact:true}).click();
  await expect(page.locator('.graph-live [data-live-node]')).toHaveCount(2);
  expect(graphSyncs).toBe(1);
  await page.screenshot({path:'.local/browser-tests/project-tracking.png',fullPage:true});
  expect(errors).toEqual([]);
});

test('project sections distinguish agreement changes from refunds without inventing financial actions',async({page})=>{
 const errors=await setup(page);await openClient(page);
 await page.getByRole('button',{name:'Abrir proyecto Proyecto privado A',exact:true}).click();
 const nav=page.getByRole('navigation',{name:'Secciones del proyecto'});
 await expect(nav.locator('[aria-current="page"]')).toContainText('Proyecto');
 await nav.getByRole('button',{name:'Cambios: Alcance, precio o plazo',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Cambios del acuerdo',exact:true})).toBeVisible();
 await expect(nav.locator('[aria-current="page"]')).toContainText('Cambios');
 const financial=[];page.on('request',request=>{if(request.method()==='POST')financial.push(request.url());});
 await nav.getByRole('button',{name:'Devoluciones: Dinero de un pago recibido',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Revisar dinero que ya se pagó',exact:true})).toBeVisible();
 await expect(page.locator('.cloud-refunds')).not.toContainText('todavía no está disponible');
 await expect(page.locator('.cloud-setup-path')).toHaveCount(0);
 await expect(page.locator('.cloud-refunds button')).toHaveCount(1);
 await expect(page.locator('.cloud-refunds button')).toHaveAttribute('data-cloud-action','refund-preview');
 await expect(nav.getByRole('button',{name:'Historial del proyecto: Historial y mapa',exact:true})).toBeVisible();
 await expect(page.locator('.cloud-project-resources')).toHaveCount(0);
 await page.screenshot({path:'.local/browser-tests/project-refunds-navigation.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});
 await expect(nav.getByRole('button',{name:/Devoluciones/})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await nav.getByRole('button',{name:'Proyecto: Acuerdo y fuentes iniciales',exact:true}).click();
 await expect(page.locator('.cloud-agreement')).toBeVisible();
 expect(financial).toHaveLength(0);expect(errors).toEqual([]);
});

async function mockProjectGraph(page,{failure=false,foreign=false,pending=false}={}){
 await page.route('**/api/v1/projects/project-a/graph**',async route=>{
  const sync=new URL(route.request().url()).pathname.endsWith('/sync');
  if(failure){await route.fulfill({status:503,json:{error:{code:'GRAPH_UNAVAILABLE'}}});return;}
  await route.fulfill({json:{data:sync?{thread_id:'graph-job',status:pending?'queued':'ready'}:{generation:1,synced_at:'2026-10-27T12:00:00Z',nodes:[
   {entity_key:'projects:project-a',source_id:'project-a',kind:'Project',project_id:foreign?'project-b':'project-a',title:'Proyecto privado A'},
   {entity_key:'documents:doc-a',source_id:'doc-a',kind:'Document',project_id:'project-a',title:'Documento exclusivo A',business_kind:'reference'}],
   edges:[{edge_key:'project-doc',source:'projects:project-a',target:'documents:doc-a',kind:'HAS_DOCUMENT'}]}}});
 });
 await page.route('**/api/v1/threads/graph-job',route=>route.fulfill({json:{data:{id:'graph-job',status:'ready'}}}));
}
async function openTrackingMap(page){
 await openClient(page);await page.getByRole('button',{name:'Abrir proyecto Proyecto privado A',exact:true}).click();
 await page.getByRole('button',{name:'Historial del proyecto: Historial y mapa',exact:true}).click();
 await page.getByRole('button',{name:'Mapa',exact:true}).click();
}
test('graph connection failure remains visible without example data',async({page})=>{
 const errors=await setup(page);await mockProjectGraph(page,{failure:true});
 const fixture=[];page.on('request',r=>{if(r.url().includes('/data/demo.json'))fixture.push(r.url());});
 await openTrackingMap(page);
 await expect(page.locator('.graph-live [role="alert"]')).toContainText('No se pudo abrir el mapa');
 await expect(page.locator('.graph-live [data-live-node]')).toHaveCount(0);
 expect(fixture).toEqual([]);expect(errors).toEqual([]);
});
test('graph rejects another project and waits for thread completion',async({page})=>{
 const errors=await setup(page);await mockProjectGraph(page,{foreign:true,pending:true});
 await openTrackingMap(page);
 await expect(page.locator('.graph-live [role="status"]')).toContainText('Actualizando');
 await expect(page.locator('.graph-live [role="alert"]')).toContainText('no corresponden');
 await expect(page.locator('.graph-live [data-live-node]')).toHaveCount(0);
 expect(errors).toEqual([]);
});
test('real graph opens its private PDF and preserves selected element',async({page})=>{
 const errors=await setup(page);await mockProjectGraph(page,{pending:true});await openTrackingMap(page);
 await page.locator('[data-live-node="documents:doc-a"]').click();
 await expect(page.locator('.gd-inspector')).toContainText('Documento exclusivo A');
 await page.getByRole('button',{name:'Ver documento fuente',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Documento fuente',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Cerrar documento',exact:true}).click();
 await expect(page.locator('[data-live-node="documents:doc-a"]')).toHaveAttribute('aria-pressed','true');
 expect(errors).toEqual([]);
});

test('leaving the map ignores late sync results and cancels further polling',async({page})=>{
 const errors=await setup(page);await mockProjectGraph(page);
 let release;const gate=new Promise(resolve=>release=resolve),reads=[];
 await page.route('**/api/v1/projects/project-a/graph/sync',async route=>{await gate;await route.fulfill({json:{data:{thread_id:'graph-job',status:'queued'}}});});
 page.on('request',request=>{const path=new URL(request.url()).pathname;if(path==='/api/v1/threads/graph-job'||path==='/api/v1/projects/project-a/graph')reads.push(path);});
 await openTrackingMap(page);
 await expect(page.locator('.graph-live [role="status"]')).toBeVisible();
 await page.getByRole('button',{name:'Proyecto: Acuerdo y fuentes iniciales',exact:true}).click();
 const finished=page.waitForResponse(response=>new URL(response.url()).pathname.endsWith('/graph/sync'));
 release();await finished;await page.waitForTimeout(150);
 await expect(page.locator('.graph-live')).toHaveCount(0);
 await expect(page.locator('.cloud-agreement')).toBeVisible();
 expect(reads).toEqual([]);expect(errors).toEqual([]);
});

test('reload restores the client project and documents tab without repeating the directory journey',async({page})=>{
 const errors=await setup(page);await openWorkspace(page);
 await page.reload();
 await expect(page.locator('.client-banner h2')).toHaveText('Proyecto privado A');
 await expect(page.locator('.cloud-project-navigation [aria-current="page"]')).toContainText('Documentos');
 await expect(page.locator('.document-library')).toContainText('Documento exclusivo A');
 const saved=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('trato:tests.supabase.invalid:session:navigation:test-user')));
 expect(saved.projectId).toBe('project-a');expect(saved.tab).toBe('documentos');
 expect(Object.keys(saved).sort()).toEqual(['clientId','historyView','projectId','requestId','revisionId','tab','version']);
 expect(errors).toEqual([]);
});
test('reload keeps the map selected inside project history',async({page})=>{
 const errors=await setup(page);await mockProjectGraph(page);await openTrackingMap(page);
 await expect(page.locator('.graph-live [data-live-node]')).toHaveCount(2);
 await page.reload();
 await expect(page.locator('.client-banner h2')).toHaveText('Proyecto privado A');
 await expect(page.locator('.cloud-project-navigation [aria-current="page"]')).toContainText('Historial');
 await expect(page.getByRole('button',{name:'Mapa',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('.graph-live [data-live-node]')).toHaveCount(2);expect(errors).toEqual([]);
});
test('reload validates project access before loading its documents',async({page})=>{
 const errors=await setup(page);await openWorkspace(page);
 await page.route('**/api/v1/projects?*',route=>route.fulfill({json:{data:[]}}));
 const privateReads=[];page.on('request',r=>{if(new URL(r.url()).pathname.includes('/projects/project-a/'))privateReads.push(r.url());});
 await page.reload();
 await expect(page.locator('.cloud-project-directory')).toContainText('todavía no tiene proyectos');
 await expect(page.locator('.client-banner')).toHaveCount(0);expect(privateReads).toEqual([]);expect(errors).toEqual([]);
});
test('navigation is scoped to the verified user and logout removes its saved location',async({page})=>{
 const errors=await setup(page);await openWorkspace(page);
 await page.getByRole('button',{name:'Mi perfil · sesión iniciada'}).click();
 await page.getByRole('button',{name:'Cerrar sesión',exact:true}).click();
 expect(await page.evaluate(()=>sessionStorage.getItem('trato:tests.supabase.invalid:session:navigation:test-user'))).toBeNull();
 expect(errors).toEqual([]);
});
test('another verified account does not inherit the previous account navigation',async({page})=>{
 const errors=await setup(page);await openWorkspace(page);
 await page.route('**/api/v1/session',route=>route.fulfill({json:{data:{user_id:'another-user'}}}));
 const projectReads=[];page.on('request',r=>{if(new URL(r.url()).pathname==='/api/v1/projects')projectReads.push(r.url());});
 await page.reload();
 await expect(page.locator('.cloud-client-directory')).toBeVisible();
 await expect(page.locator('.client-banner')).toHaveCount(0);expect(projectReads).toEqual([]);expect(errors).toEqual([]);
});
test('reload restores source comparison for the same authorized request',async({page})=>{
 const errors=await setup(page,{documentData:[{...doc('a'),kind:'initial_agreement'},{...doc('a'),id:'request-a',kind:'email_request',title:'Pedido a comparar'}]});
 await openClient(page);await page.getByRole('button',{name:'Abrir proyecto Proyecto privado A',exact:true}).click();
 await page.getByRole('button',{name:'Ver cambios',exact:true}).click();
 await page.getByRole('button',{name:'Revisar cambio →',exact:true}).click();
 await expect(page.locator('.cloud-change-review')).toContainText('Pedido a comparar');
 await page.reload();
 await expect(page.locator('.cloud-change-review')).toContainText('Pedido a comparar');
 await expect(page.locator('.cloud-comparison-grid')).toBeVisible();expect(errors).toEqual([]);
});

test('a failed reload preserves navigation for explicit retry instead of showing an empty project',async({page})=>{
 const errors=await setup(page);await openWorkspace(page);
 let unavailable=true;
 await page.route('**/api/v1/projects/project-a/documents',route=>unavailable?route.fulfill({status:503,json:{error:{code:'PERSISTENCE_UNAVAILABLE'}}}):route.fulfill({json:{data:[doc('a')]}}));
 await page.reload();
 await expect(page.getByRole('button',{name:'Volver a intentar',exact:true})).toBeVisible();
 await expect(page.locator('.document-library')).toHaveCount(0);
 unavailable=false;
 await page.getByRole('button',{name:'Volver a intentar',exact:true}).click();
 await expect(page.locator('.client-banner h2')).toHaveText('Proyecto privado A');
 await expect(page.locator('.document-library')).toContainText('Documento exclusivo A');
 expect(errors).toEqual([]);
});
