// Explicit HTTP fixtures only. No PayPal, database, mail or real money.
const {test,expect}=require('@playwright/test');
const id=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
const OWNER=id(1),PROJECT=id(2),PARENT=id(3),SNAP=id(4),PAY=id(5),AUTH=id(6),OP=id(7),ATT=id(8);
async function setup(page,{lang='es',authorized=false,external=false,loss=null,readFailure=false}={}){
 const parent={id:PARENT,project_id:PROJECT,owner_id:OWNER,payment_id:PAY,scope:'payment_only',reason:'Settlement for customer',status:authorized?'refund_pending':'accepted',current_snapshot_id:SNAP,request_evidence:[]};
 const snapshot={id:SNAP,settlement_id:PARENT,version_no:1,draft_sequence:1,created_at:new Date().toISOString(),terms:{conditions:'Agreed settlement',adjustments:[]},breakdown:{refund_minor:15000},payments:[{payment_id:PAY,refund_minor:15000,origin:'change'}]};
 const data={settlement:parent,authorizations:[],operations:[],attempts:[],receipts:[],applications:[],incidents:[],runs:[],confirmed_minor:0,reserved_minor:0};
 function reserve(){data.authorizations=[{id:AUTH,snapshot_id:SNAP}];data.operations=[{id:OP,settlement_id:PARENT,authorization_id:AUTH,payment_id:PAY,sequence_no:1,amount_minor:15000,status:'reserved'}];data.attempts=[{id:ATT,operation_id:OP,attempt_no:1,revision:0,amount_minor:15000,status:'reserved',provider_refund_id:null,dispatched_at:null}];data.reserved_minor=15000;}
 if(authorized)reserve();
 if(external)data.receipts=[{id:id(20),payment_id:PAY,refund_id:'EXTERNAL-RECEIPT',amount_minor:5000,currency:'USD',status:'completed'}];
 const model={data,writes:[],commands:new Map(),loss,readFailure,errors:[]};
 function finish(){
  const a=data.attempts.at(-1),receipt={id:id(21),payment_id:PAY,refund_id:'VERIFIED-REFUND',amount_minor:a.amount_minor,currency:'USD',status:'completed'};
  a.status='completed';a.provider_refund_id=receipt.refund_id;a.dispatched_at=new Date().toISOString();data.receipts.push(receipt);data.applications.push({receipt_id:receipt.id,operation_id:OP});data.operations[0].status='completed';data.confirmed_minor=15000;data.reserved_minor=0;parent.status='completed';
 }
 const evidence={payment_id:PAY,capture_id:'CAPTURE-TEST',gross_minor:30000,original_fee_minor:1000,original_net_minor:29000,previous_refunds_minor:0,provider_remaining_minor:30000};
 function check(retry=false){return {id:id(40),snapshot_id:SNAP,operation_id:OP,attempt_id:data.attempts.at(-1)?.id,amount_minor:10000,digest:'a'.repeat(64),expires_at:new Date(Date.now()+240000).toISOString(),evidence:retry?evidence:[evidence],policy:{reference_country:'PE',currency:'USD',sources:[{url:'https://developer.paypal.com/checkout/refund-payment',consulted_on:'2026-11-02'}]}};}
 page.on('pageerror',e=>model.errors.push(e.message));
 await page.addInitScript(({lang,owner})=>{localStorage.setItem('trato:ui-language',lang);sessionStorage.setItem('trato:finance.supabase.invalid:session',JSON.stringify({access_token:'test',refresh_token:'test',expires_at:9999999999,user:{id:owner,email:'test@example.invalid'}}));},{lang,owner:OWNER});
 await page.route('**/api/v1/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname,method=req.method();let result;
  const fail=code=>route.fulfill({status:503,json:{error:{code}}});
  if(path.endsWith('/config'))result={supabase_url:'https://finance.supabase.invalid',publishable_key:'sb_publishable_test'};
  else if(path.endsWith('/session'))result={user_id:OWNER,role:'freelancer'};
  else if(path.endsWith('/clients'))result=[{id:id(10),name:'Finance Client'}];
  else if(path==='/api/v1/projects')result=[{id:PROJECT,client_id:id(10),name:'Finance Project'}];
  else if(path.endsWith('/documents')||path.endsWith('/proposals'))result=[];
  else if(path.endsWith('/plan-progress'))return route.fulfill({status:404,json:{error:{code:'PLAN_NOT_FOUND'}}});
  else if(path.endsWith('/request-status'))result={can_register:false,closures:[]};
  else if(path.endsWith('/refund-payments'))result=[{id:PAY,origin:'change',amount_minor:30000,local_previous_refunds_minor:0,updated_at:new Date().toISOString()}];
  else if(path.endsWith('/refunds'))result=[parent];
  else if(path===`/api/v1/refunds/${PARENT}`)result={settlement:parent,snapshots:[snapshot],payments:[{payment_id:PAY}],events:[]};
  else if(path.endsWith('/snapshots/'+SNAP))result={settlement:parent,snapshot,artifacts:[],reviews:[],deliveries:[],responses:[],acceptances:[]};
  else if(path.includes('/refund-operations/'))result=model.commands.has(path.split('/').pop())?{state:'confirmed',result:structuredClone(data)}:{state:'unconfirmed'};
  else if(path.endsWith('/financial')){if(model.readFailure)return fail('PERSISTENCE_UNAVAILABLE');result=data;}
  else if(method==='POST'){
   const body=req.postDataJSON(),key=req.headers()['idempotency-key'];model.writes.push({path,body,key});
   if(path.endsWith('/financial-checks'))result={check:check()};
   else if(path.endsWith('/retry-checks'))result={check:check(true)};
   else if(path.endsWith('/reconcile')){data.attempts.at(-1).revision++;result={...data,reconciliation:{attribution:'unresolved'}};}
   else{
    expect(key).toBeTruthy();expect(body.confirmed).toBe(true);expect(body.amount_minor).toBeUndefined();
    if(path.endsWith('/financial-authorizations')){expect(body.expected_snapshot_id).toBe(SNAP);expect(body.digest).toBe('a'.repeat(64));reserve();parent.status='refund_pending';}
    else if(path.endsWith('/execute')){
     expect(body).toEqual({confirmed:true});
     if(model.loss==='before'){model.loss=null;return fail('PERSISTENCE_UNAVAILABLE');}
     finish();model.commands.set(key,true);
     if(model.loss==='after'){model.loss=null;return fail('PERSISTENCE_UNAVAILABLE');}
    }else if(path.endsWith('/external-receipts')){
     expect(body.receipt_id).toBe(id(20));data.applications.push({receipt_id:id(20),operation_id:OP});data.confirmed_minor=5000;data.reserved_minor=0;data.operations[0].status='cancelled';data.attempts[0].status='cancelled';
    }else if(path.endsWith('/retry-authorizations')){
     expect(body.attempt_id).toBe(ATT);expect(body.expected_revision).toBe(0);data.attempts.push({id:id(30),operation_id:OP,attempt_no:2,revision:0,amount_minor:10000,status:'reserved'});data.operations[0].status='reserved';data.reserved_minor=10000;
    }else if(path.endsWith('/replay')){expect(body.attempt_id).toBe(ATT);expect(body.expected_revision).toBe(1);finish();}
    else throw Error('Unexpected financial endpoint '+path);
    model.commands.set(key,true);result=data;
   }
  }else throw Error('Unexpected read '+path);
  await route.fulfill({json:{data:result}});
 });
 await page.goto('/#clientes');
 await page.locator('[data-cloud-action="client-open"]').first().click();await page.locator('[data-cloud-action="project-open"]').first().click();await page.locator('.cloud-project-navigation [data-cloud-tab="devoluciones"]').click();await page.locator('[data-refund-action="open"]').click();
 await expect(page.locator('.refund-finance')).toBeVisible();
 return model;
}
async function confirm(page){const form=page.locator('[data-refund-form="finance"]');await expect(form).toBeVisible();if(await form.locator('textarea').count())await form.locator('textarea').fill('Reviewed financial action');await form.locator('[name="confirmed"]').check();await form.locator('[type="submit"]').click();}
for(const lang of ['es','en'])test(`authorization and execution stay separate; confirmed result after reload (${lang})`,async({page})=>{
 if(lang==='en')await page.setViewportSize({width:390,height:844});
 const m=await setup(page,{lang});expect(m.writes).toHaveLength(0);
 await page.locator('[data-refund-action="fin-check"]').click();expect(m.writes).toHaveLength(1);
 const form=page.locator('[data-refund-form="finance"]');await form.locator('textarea').fill('Reviewed');await form.locator('[type="submit"]').click();expect(m.writes).toHaveLength(1);
 await expect(form).toContainText(lang==='es'?'Comisión original de PayPal':'Original PayPal fee');await expect(form).toContainText(lang==='es'?'Neto original recibido':'Original net received');
 await confirm(page);await expect(page.locator('[data-refund-action="fin-execute"]')).toBeVisible();expect(m.writes.some(w=>w.path.endsWith('/execute'))).toBe(false);
 await page.locator('[data-refund-action="fin-execute"]').click();expect(m.writes).toHaveLength(2);await confirm(page);
 await expect(page.locator('.refund-finance')).toContainText('VERIFIED-REFUND');expect(m.writes).toHaveLength(3);
 await page.reload();await page.locator('[data-refund-action="open"]').click();await expect(page.locator('.refund-finance')).toContainText('VERIFIED-REFUND');expect(m.writes).toHaveLength(3);
 expect(await page.locator('.refund-finance').evaluate(e=>e.scrollWidth>e.clientWidth+1)).toBe(false);expect(m.errors).toEqual([]);
});
test('lost response after execution is queried after reload without sending again',async({page})=>{
 const m=await setup(page,{authorized:true,loss:'after'});await page.locator('[data-refund-action="fin-execute"]').click();await confirm(page);await expect(page.locator('[data-refund-action="query"]')).toBeVisible();const key=m.writes[0].key;
 await page.reload();expect(m.writes).toHaveLength(1);await page.locator('[data-refund-action="query"]').click();await expect(page.locator('.refund-finance')).toContainText('VERIFIED-REFUND');expect(m.writes).toHaveLength(1);expect(m.writes[0].key).toBe(key);expect(m.errors).toEqual([]);
});
test('uncertain request before commit needs a fresh explicit confirmation and the same key',async({page})=>{
 const m=await setup(page,{authorized:true,loss:'before'});await page.locator('[data-refund-action="fin-execute"]').click();await confirm(page);const first=m.writes[0];await expect(page.locator('[data-refund-action="query"]')).toBeVisible();
 await page.reload();await page.locator('[data-refund-action="query"]').click();expect(m.writes).toHaveLength(1);
 const f=page.locator('[data-refund-form="finance-resume"]');await page.locator('.refund-notice details summary').click();await f.locator('[type="submit"]').click();expect(m.writes).toHaveLength(1);await f.locator('[name="confirmed"]').check();await f.locator('[type="submit"]').click();
 await expect(page.locator('.refund-finance')).toContainText('VERIFIED-REFUND');expect(m.writes).toHaveLength(2);expect(m.writes[1]).toEqual(first);expect(m.errors).toEqual([]);
});
test('external partial receipt needs explicit application; next attempt covers only the remainder',async({page})=>{
 const m=await setup(page,{authorized:true,external:true});await page.locator('[data-refund-action="fin-external"]').click();expect(m.writes).toHaveLength(0);await confirm(page);
 await expect(page.locator('[data-refund-action="fin-retry-check"]')).toBeVisible();await page.locator('[data-refund-action="fin-retry-check"]').click();await confirm(page);
 await expect(page.locator('[data-refund-action="fin-execute"]')).toBeVisible();await page.locator('[data-refund-action="fin-execute"]').click();await expect(page.locator('[data-refund-form="finance"]')).toContainText('100.00');await confirm(page);
 await expect(page.locator('.refund-finance')).toContainText('VERIFIED-REFUND');expect(m.data.confirmed_minor).toBe(15000);expect(m.data.attempts[1].amount_minor).toBe(10000);expect(m.errors).toEqual([]);
});
test('financial read failure stays visible and does not expose an execution action',async({page})=>{
 const m=await setup(page,{readFailure:true});await expect(page.locator('.refund-finance [role="alert"]')).toBeVisible();await expect(page.locator('[data-refund-action="fin-execute"]')).toHaveCount(0);expect(m.writes).toHaveLength(0);
 m.readFailure=false;await page.locator('[data-refund-action="fin-inspect"]').click();await expect(page.locator('[data-refund-action="fin-check"]')).toBeVisible();expect(m.errors).toEqual([]);
});

test('canonical consultation does not replay money; replay requires its own confirmation',async({page})=>{
 const m=await setup(page,{authorized:true});Object.assign(m.data.attempts[0],{status:'uncertain',dispatched_at:new Date().toISOString()});m.data.operations[0].status='uncertain';
 await page.locator('.refund-finance details:has([data-refund-action="fin-inspect"]) summary').click();
 await page.locator('[data-refund-action="fin-inspect"]').click();await page.locator('[data-refund-action="fin-reconcile"]').click();await expect(page.locator('.refund-finance')).toContainText('La evidencia requiere revisión');expect(m.writes).toHaveLength(1);expect(m.writes[0].key).toBeUndefined();
 await page.locator('[data-refund-action="fin-replay"]').click();expect(m.writes).toHaveLength(1);await confirm(page);await expect(page.locator('.refund-finance')).toContainText('VERIFIED-REFUND');expect(m.writes).toHaveLength(2);expect(m.errors).toEqual([]);
});
