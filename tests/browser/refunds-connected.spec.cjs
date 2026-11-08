// Explicit browser API doubles. No Supabase, mail, Gemini or financial provider calls.
const {test,expect}=require('@playwright/test');
const id=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
const P=id(2),PAY=id(3),DOC=id(4),EXT=id(5),PARENT=id(6),OWNER=id(1);
async function setup(page,{lang='es',saved=false,multipay=false}={}){
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const model={items:[],snapshots:[],operations:new Map(),writes:[],failAfterCommit:false,failBeforeCommit:false,conflict:false,detailsDelay:null};
 model.artifacts=[];model.reviews=[];model.deliveries=[];model.responses=[];model.acceptances=[];model.uncertainMail=false;
 model.payments=[{id:PAY,origin:'change',capture_id:'CHANGE-CAPTURE',amount_minor:30000,currency:'USD',updated_at:'2026-11-01T12:00:00Z',local_previous_refunds_minor:0}];
 if(multipay)model.payments.unshift({id:id(30),origin:'initial',capture_id:'INITIAL-CAPTURE',amount_minor:10000,currency:'USD',updated_at:'2026-11-01T11:00:00Z',local_previous_refunds_minor:0});
 model.documents=[{id:DOC,project_id:P,title:'Cancellation agreement',sha256:'a'.repeat(64),kind:'reference',mime_type:'application/pdf',document_extractions:[{status:'ready'}]}];
 const quote={document_id:DOC,extraction_id:EXT,document_sha256:'a'.repeat(64),quote:'Cancel please.'};
 if(saved)model.items=[{id:PARENT,project_id:P,payment_id:PAY,scope:'payment_only',reason:'Refund requested',status:'draft',current_snapshot_id:null,request_evidence:[quote]}];
 await page.addInitScript(({lang,owner})=>{
  localStorage.setItem('trato:ui-language',lang);
  sessionStorage.setItem('trato:refund-ui.supabase.invalid:session',JSON.stringify({access_token:'test',refresh_token:'test',expires_at:9999999999,user:{id:owner,email:'owner@example.invalid'}}));
 },{lang,owner:OWNER});
 await page.route('**/api/v1/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname,method=req.method();let data;
  const fail=async(code,status=503)=>route.fulfill({status,json:{error:{code}}});
  if(path.endsWith('/config'))data={supabase_url:'https://refund-ui.supabase.invalid',publishable_key:'sb_publishable_test'};
  else if(path.endsWith('/session'))data={user_id:OWNER};
  else if(path.endsWith('/clients'))data=[{id:id(10),name:'Refund Client'}];
  else if(path==='/api/v1/projects')data=[{id:P,client_id:id(10),name:'Refund Project',status:'draft'},{id:id(20),client_id:id(10),name:'Other Project',status:'draft'}];
  else if(path.endsWith('/documents'))data=model.documents;
  else if(path.endsWith('/assistant/conversation'))data={entries:[],next_before:null};
  else if(path.endsWith('/ai/project-questions')){
   const body=req.postDataJSON(),id=req.headers()['idempotency-key'];
   model.assistantFocus={...body.refund_focus,evidence_ids:[]};
   model.guidance={next_step:'Completa el importe del trabajo.',reason:null,email_note:null,conditions:'Propuesta para el pago seleccionado.',
    concepts:[{kind:'recognized_work',beneficiary:'seller',description:'Trabajo entregado',evidence:[quote]}]};
   data={id,status:'completed',result:{kind:'project_assistant',project_id:P,question:body.question,status:'answered',
    answer:'Puedes incluir el trabajo entregado.',answer_basis:'documents',missing_information:[],
    citations:[{source_id:'test-source',quote:quote.quote}],sources:[{source_id:'test-source',file_id:DOC,source_kind:'original'}],
    refund:model.guidance,refund_focus:model.assistantFocus}};
  }else if(path.includes('/assistant/refund-suggestions/'))data={focus:model.assistantFocus,guidance:model.guidance};
  else if(path.endsWith('/proposals'))data=[];
  else if(path.endsWith('/request-status'))data={can_register:!model.items.some(x=>x.status==='draft'),closures:[]};
  else if(path.endsWith('/refund-payments'))data=model.payments;
  else if(path.endsWith('/financial'))data={settlement:model.items[0],operations:[],authorizations:[],attempts:[],receipts:[],applications:[],incidents:[],runs:[],recovery_consents:[],confirmed_minor:0,reserved_minor:0};
  else if(path.endsWith('/extraction'))data={document:{id:DOC,project_id:P,sha256:'a'.repeat(64)},extraction:{id:EXT,status:'ready'},segments:[{text:'Cancel please. Work recognized: USD 120. Cancellation fee: USD 30.',locator_number:1}]};
  else if(path.includes('/refund-operations/')){
   const result=model.operations.get(path.split('/').pop());data=result?{state:'confirmed',result}:{state:'unconfirmed'};
  }else if(path.endsWith('/initial-payments')){
   model.writes.push({body:req.postDataJSON(),key:req.headers()['idempotency-key']});
   model.payments.unshift({id:id(30),origin:'initial',amount_minor:10000,currency:'USD',updated_at:'2026-11-01T11:00:00Z',local_previous_refunds_minor:0});
   data={project_id:P,payment:model.payments[0]};
  }else if(path.endsWith('/email-preview')){
   const snapshot_id=path.split('/').at(-2),a=model.artifacts.find(x=>x.snapshot_id===snapshot_id);
   data={snapshot_id,sender:'owner@example.invalid',recipient:'customer@example.invalid',subject:'Settlement proposal',body:'Review this exact settlement document.',document_id:a.document_id,filename:'settlement.pdf',sha256:a.sha256,digest:'d'.repeat(64)};
  }else if(/\/(pdf|review|email|feedback|acceptance|sync|reconcile)$/.test(path)&&method==='POST'){
   const kind=path.split('/').pop(),body=req.postData()?req.postDataJSON():{},key=req.headers()['idempotency-key'];
   const snapshot_id=path.includes('/snapshots/')?path.split('/snapshots/')[1].split('/')[0]:body.expected_snapshot_id;
   model.writes.push({kind,body,key});
   if(kind==='pdf'){
    const artifact={id:id(300+model.artifacts.length),snapshot_id,document_id:id(400+model.artifacts.length),language:body.language,sha256:'e'.repeat(64)};
    model.artifacts.push(artifact);data={settlement:model.items[0],artifact};
   }
   if(kind==='review'){model.reviews.push({snapshot_id});data={settlement:model.items[0]};}
   if(kind==='email'){
    const delivery={id:id(500+model.deliveries.length),snapshot_id,operation_key:key,status:model.uncertainMail?'delivery_uncertain':'accepted_by_gmail',recipient:'customer@example.invalid',message_preview:{subject:'Settlement proposal',body:'Review this exact settlement document.'}};
    model.deliveries.push(delivery);
    if(model.uncertainMail){await fail('EMAIL_DELIVERY_UNCERTAIN');return;}
    model.items[0].status='awaiting_response';data={settlement:model.items[0],delivery};
   }
   if(kind==='reconcile'){
    const delivery=model.deliveries.find(x=>x.operation_key===key);delivery.status='accepted_by_gmail';model.items[0].status='awaiting_response';
    data={state:'confirmed',result:{settlement:model.items[0],delivery}};
   }
   if(kind==='sync'){
    if(!model.responses.some(r=>r.snapshot_id===snapshot_id))model.responses.push({id:id(600+model.responses.length),snapshot_id,from_email:'customer@example.invalid',received_at:'2026-11-01T13:00:00Z',body_text:'Please review this version.',reply_text:'Please review this version.',attachments:[]});
    data={synced:1};
   }
   if(kind==='feedback'){model.items[0].status='adjustments_requested';data={settlement:model.items[0]};}
   if(kind==='acceptance'){
    model.acceptances.push({snapshot_id,evidence:body.evidence});
    model.items[0].status=model.snapshots.at(-1).breakdown.refund_minor===0?'closed_without_refund':'accepted';data={settlement:model.items[0]};
   }
   if(key&&kind!=='reconcile')model.operations.set(key,structuredClone(data));
  }else if(path.endsWith('/refunds')&&method==='GET')data=path.includes(id(20))?[]:model.items;
  else if(path.endsWith('/refunds')&&method==='POST'||/\/refunds\/[^/]+\/(draft|close)$/.test(path)&&method==='POST'){
   const body=req.postDataJSON(),key=req.headers()['idempotency-key'];model.writes.push({body,key});
   if(model.failBeforeCommit){model.failBeforeCommit=false;await fail('PERSISTENCE_UNAVAILABLE');return;}
   if(model.conflict){model.conflict=false;await fail('REFUND_REVISION_CONFLICT',409);return;}
   if(model.operations.has(key)){data=model.operations.get(key);}
   else {
    if(path.endsWith('/refunds'))model.items=[{id:PARENT,project_id:P,payment_id:body.payment_id||body.payment_ids[0],scope:body.scope,payment_ids:body.payment_ids,reason:body.reason,status:'draft',current_snapshot_id:null,request_evidence:body.request_evidence}];
    if(path.endsWith('/draft')){
     const snap={id:id(100+model.snapshots.length),settlement_id:PARENT,version_no:model.items[0].status==='adjustments_requested'?2:(model.snapshots.at(-1)?.version_no||1),draft_sequence:model.items[0].status==='adjustments_requested'?1:model.snapshots.length+1,created_at:'2026-11-01T12:00:00Z',terms:body.terms,breakdown:{refund_minor:body.terms.proposed_refund_minor,gross_minor:model.items[0].scope==='project_closure'?40000:30000,original_fee_minor:null,provider_verified:false}};
     snap.payments=model.payments.filter(p=>model.items[0].scope==='project_closure'||p.id===model.items[0].payment_id).map(p=>({...p,payment_id:p.id,refund_minor:body.terms.allocations?.find(a=>a.payment_id===p.id)?.refund_minor??body.terms.proposed_refund_minor}));
     model.items[0].status='draft';model.snapshots.push(snap);model.items[0].current_snapshot_id=snap.id;
    }
    if(path.endsWith('/close'))model.items[0].status=body.reason;
    data={settlement:structuredClone(model.items[0]),...(path.endsWith('/draft')?{snapshot:structuredClone(model.snapshots.at(-1))}:{})};
    model.operations.set(key,structuredClone(data));
   }
   if(model.failAfterCommit){model.failAfterCommit=false;await fail('PERSISTENCE_UNAVAILABLE');return;}
  }else if(path.includes('/snapshots/')){
   const snapshot_id=path.split('/').pop();data={settlement:model.items[0],snapshot:model.snapshots.find(x=>x.id===snapshot_id),sources:[],...Object.fromEntries(['artifacts','reviews','deliveries','responses','acceptances'].map(k=>[k,model[k].filter(x=>x.snapshot_id===snapshot_id)]))};
  }
  else if(path===`/api/v1/refunds/${PARENT}`){
   if(model.detailsDelay)await model.detailsDelay;
   data={settlement:model.items[0],snapshots:[...model.snapshots].reverse(),payments:model.payments.filter(p=>model.items[0].scope==='project_closure'||p.id===model.items[0].payment_id).map(p=>({payment_id:p.id})),events:[]};
  }else {await fail('NOT_FOUND',404);return;}
  await route.fulfill({json:{data}});
 });
 await page.goto('/#clientes');
 await page.getByRole('button',{name:lang==='es'?'Abrir cliente Refund Client':'Open client Refund Client',exact:true}).click();
 await page.getByRole('button',{name:lang==='es'?'Abrir proyecto Refund Project':'Open project Refund Project',exact:true}).click();
 await page.locator('[data-cloud-tab="devoluciones"]').first().click();
 await expect(page.locator('.refund-workspace')).toBeVisible();
 await expect(page.locator('[data-refund-action="new"]')).toBeVisible();
 return {model,errors};
}
async function evidence(page,container,quote='Cancel please.'){
 await container.locator('[data-refund-action="pick"]').click();
 await page.locator('[data-refund-field="document"]').selectOption(DOC);
 await expect(page.locator('[data-refund-field="quote"]')).toBeVisible();
 await page.locator('[data-refund-field="quote"]').fill(quote);
 await page.locator('[data-refund-action="use-quote"]').click();
 await expect(page.locator('.refund-source-picker')).toHaveCount(0);
}
async function create(page){
 await page.locator('[data-refund-action="new"]').click();
 const form=page.locator('[data-refund-form="create"]');
 await form.locator('[name="payment_id"]').selectOption(PAY);
 await form.locator('[name="reason"]').fill('Refund requested');
 await evidence(page,form);
 await form.locator('button[type="submit"]').click();
 await expect(page.locator('[data-refund-action="edit"]')).toBeVisible();
}
async function draft(page,amount){
 await page.locator('[data-refund-action="edit"]').click();
 const form=page.locator('[data-refund-form="draft"]');
 if(amount){
  await form.locator('[data-refund-action="add-concept"]').click();
  const item=form.locator('.refund-concept').last();
  await item.locator('[name="description"]').fill('Recognized work');
  await item.locator('[name="amount"]').fill(amount);
  await evidence(page,item,'Work recognized: USD 120.');
 }
 await form.locator('[name="conditions"]').fill('Settlement for this payment only.');
 await form.locator('[name="reviewed"]').check();
 return form;
}
for(const amount of ['', '120','300'])test(`connected proposal ${amount||'full'} saves and reloads exact snapshot`,async({page})=>{
 const {model,errors}=await setup(page);await create(page);const form=await draft(page,amount);
 await form.locator('button[type="submit"]').click();
 await expect(page.locator('.refund-dialog [data-refund-assistant="guide"]')).toBeVisible();
 await page.locator('.refund-wizard-steps [data-step="2"]').click();
 await expect(page.locator('.refund-history button')).toHaveCount(1);
 expect(model.snapshots[0].terms.proposed_refund_minor).toBe(30000-Number(amount||0)*100);
 expect(model.writes[1].body.expected_snapshot_id).toBe(null);
 await page.reload();await expect(page.locator('.refund-workspace')).toBeVisible();
 await page.locator('[data-refund-action="open"]').click();
 await expect(page.locator('.refund-dialog [data-refund-assistant="guide"]')).toBeVisible();
 await page.locator('.refund-wizard-steps [data-step="2"]').click();
 await expect(page.locator('.refund-history button')).toHaveCount(1);
 expect(errors).toEqual([]);
});
test('editing preserves concept id, prior snapshot and v1; historical snapshot is read-only',async({page})=>{
 const {model,errors}=await setup(page);await create(page);let form=await draft(page,'120');await form.locator('button[type="submit"]').click();
 await page.locator('.refund-wizard-steps [data-step="2"]').click();
 await expect(page.locator('.refund-history button')).toHaveCount(1);
 const concept=model.snapshots[0].terms.adjustments[0].concept_id;
 await page.locator('[data-refund-action="edit"]').click();form=page.locator('[data-refund-form="draft"]');
 await form.locator('[name="amount"]').fill('150');await form.locator('[name="reviewed"]').check();await form.locator('button[type="submit"]').click();
 await page.locator('.refund-wizard-steps [data-step="2"]').click();
 await expect(page.locator('.refund-history button')).toHaveCount(2);
 expect(model.snapshots[0].terms.proposed_refund_minor).toBe(18000);
 expect(model.snapshots[1].terms.adjustments[0].concept_id).toBe(concept);
 await page.locator('details:has(.refund-history) summary').click();await page.locator('.refund-history button').last().click();await expect(page.locator('[data-refund-action="edit"]')).toHaveCount(0);
 expect(errors).toEqual([]);
});
test('uncertain saved result is queried after reload without a second write',async({page})=>{
 const {model,errors}=await setup(page,{saved:true});await page.locator('[data-refund-action="open"]').click();
 const form=await draft(page,'');model.failAfterCommit=true;await form.locator('button[type="submit"]').click();
 await expect(page.locator('[data-refund-action="query"]')).toBeVisible();
 await page.reload();await expect(page.locator('[data-refund-action="query"]')).toBeVisible();
 await page.locator('[data-refund-action="query"]').click();await page.locator('.refund-wizard-steps [data-step="2"]').click();await expect(page.locator('.refund-history button')).toHaveCount(1);
 expect(model.writes).toHaveLength(1);expect(errors).toEqual([]);
});
test('explicit retry reuses identical key and payload; stale edits keep the form',async({page})=>{
 const {model,errors}=await setup(page,{saved:true});await page.locator('[data-refund-action="open"]').click();
 let form=await draft(page,'');model.failBeforeCommit=true;await form.locator('button[type="submit"]').click();
 await expect(page.locator('[data-refund-action="retry-operation"]')).toBeVisible();await page.locator('[data-refund-action="retry-operation"]').click();
 await page.locator('.refund-wizard-steps [data-step="2"]').click();
 await expect(page.locator('.refund-history button')).toHaveCount(1);expect(model.writes[0]).toEqual(model.writes[1]);
 await page.locator('[data-refund-action="edit"]').click();form=page.locator('[data-refund-form="draft"]');
 await form.locator('[name="conditions"]').fill('Preserve my unsaved terms.');await form.locator('[name="reviewed"]').check();model.conflict=true;
 await form.locator('button[type="submit"]').click();await expect(form.locator('[name="conditions"]')).toHaveValue('Preserve my unsaved terms.');
 await expect(page.locator('.refund-workspace [role="alert"]')).toContainText('El borrador cambió');expect(errors).toEqual([]);
});
test('English labels and explicit closure refresh the project request gate',async({page})=>{
 const {model,errors}=await setup(page,{lang:'en',saved:true});await page.locator('[data-refund-action="open"]').click();
 await page.locator('.refund-other-actions summary').click();const form=page.locator('[data-refund-form="close"]');
 await form.locator('[name="notes"]').fill('Customer withdrew request');await form.locator('[name="confirmed"]').check();await form.locator('button[type="submit"]').click();
 await expect(page.locator('[data-refund-form="close"]')).toHaveCount(0);
 expect(model.items[0].status).toBe('withdrawn');await page.locator('.refund-wizard-footer [data-refund-action="wizard-close"]').click();
 await expect(page.locator('[data-refund-action="new"]')).toBeEnabled();
 await expect(page.locator('.refund-simulation')).toHaveCount(0);expect(errors).toEqual([]);
});
test('penalty percentage requires a literal source and rounds correctly on mobile',async({page})=>{
 const {model,errors}=await setup(page,{saved:true});await page.locator('[data-refund-action="open"]').click();
 await page.locator('.refund-wizard-steps [data-step="1"]').click();
 await expect(page.locator('.refund-request-summary')).toContainText('Refund requested');
 const cite=page.locator('.refund-stage .refund-evidence details');
 await expect(cite.locator('blockquote')).toBeHidden();
 await cite.locator('summary').click();await expect(cite.locator('blockquote')).toBeVisible();
 await page.locator('.refund-wizard-steps [data-step="2"]').click();
 await page.locator('[data-refund-action="edit"]').click();const form=page.locator('[data-refund-form="draft"]');
 await form.locator('[data-refund-action="add-concept"]').click();const item=form.locator('.refund-concept');
 await item.locator('[name="kind"]').selectOption('penalty');await item.locator('[name="description"]').fill('Cancellation clause');
 await item.locator('[name="mode"]').selectOption('percent');await item.locator('[name="base"]').fill('300');await item.locator('[name="rate"]').fill('10');
 await form.locator('[name="conditions"]').fill('Review applicable cancellation clause.');await form.locator('[name="reviewed"]').check();
 await form.locator('button[type="submit"]').click();await expect(page.locator('.refund-workspace [role="alert"]')).toContainText('evidencia');expect(model.writes).toHaveLength(0);
 await item.locator('[data-refund-action="pick"]').click();await page.locator('[data-refund-field="document"]').selectOption(DOC);
 await page.locator('[data-refund-field="quote"]').fill('An invented clause');await page.locator('[data-refund-action="use-quote"]').click();
 await expect(page.locator('.refund-workspace [role="alert"]')).toContainText('La cita no coincide');
 await page.locator('[data-refund-field="quote"]').fill('Cancellation fee: USD 30.');await page.locator('[data-refund-action="use-quote"]').click();
 await expect(page.locator('[data-refund-item-total]')).toContainText('30');
 await form.locator('[name="reviewed"]').check();await form.locator('[name="reviewed"]').focus();await page.keyboard.press('Tab');
 await expect(form.locator('button[type="submit"]')).toBeFocused();
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(await page.locator('.refund-dialog').evaluate(d=>d.scrollWidth<=d.clientWidth)).toBe(true);
 await page.screenshot({path:'/tmp/trato-refund-browser/review-proposal.png',fullPage:true});
 await form.locator('button[type="submit"]').click();await page.locator('.refund-wizard-steps [data-step="2"]').click();await expect(page.locator('.refund-history button')).toHaveCount(1);
 expect(model.snapshots[0].terms.adjustments[0].percentage).toEqual({base_minor:30000,basis_points:1000});
 expect(model.snapshots[0].terms.proposed_refund_minor).toBe(27000);expect(errors).toEqual([]);
});
test('unconfirmed operation blocks new writes and stores only operation identifiers',async({page})=>{
 const {model,errors}=await setup(page,{saved:true});await page.locator('[data-refund-action="open"]').click();
 const form=await draft(page,'');model.failBeforeCommit=true;await form.locator('button[type="submit"]').click();
 await page.locator('[data-refund-action="query"]').click();await expect(page.locator('.refund-workspace [role="alert"]')).toContainText('Todavía no hay un resultado confirmado');
 const saved=await page.evaluate(()=>Object.entries(sessionStorage).filter(([k])=>k.startsWith('trato:refund-operation:')).map(([,v])=>JSON.parse(v)));
 expect(saved).toHaveLength(1);expect(Object.keys(saved[0]).sort()).toEqual(['action','key','settlementId']);
 await expect(form.locator('button[type="submit"]')).toBeDisabled();expect(model.writes).toHaveLength(1);
 await page.reload();await page.locator('[data-refund-action="query"]').click();
 await expect(page.locator('[data-refund-action="retry-operation"]')).toHaveCount(0);await expect(page.locator('[data-refund-action="new"]')).toBeDisabled();
 expect(model.writes).toHaveLength(1);expect(errors).toEqual([]);
});
test('late detail cannot populate another project or a logged-out session',async({page})=>{
 const {model,errors}=await setup(page,{saved:true});let release;model.detailsDelay=new Promise(resolve=>release=resolve);
 await page.locator('[data-refund-action="open"]').click();
 await page.evaluate(project=>{const c=window.TratoCloud;c.projectId=project;c.tab='devoluciones';c.notify();},id(20));
 await expect.poll(()=>page.evaluate(()=>window.TratoCloud.refundState.project)).toBe(id(20));release();
 await expect(page.locator('.refund-empty')).toBeVisible();
 await expect(page.locator('.refund-list > li')).toHaveCount(0);
 expect(await page.evaluate(()=>window.TratoCloud.refundState.detail)).toBe(null);
 await page.evaluate(()=>{const c=window.TratoCloud;c.reset();c.notify();});expect(await page.evaluate(()=>window.TratoCloud.refundState)).toBe(null);
 expect(errors).toEqual([]);
});

test('additional supporting PDF is a reference and never starts another request',async({page})=>{
 const {model,errors}=await setup(page,{saved:true});const uploads=[];
 await page.route(/\/api\/v1\/projects\/[^/]+\/documents\?/,async route=>{
  if(route.request().method()!=='POST'){await route.fallback();return;}
  const url=new URL(route.request().url());uploads.push(Object.fromEntries(url.searchParams));
  expect(route.request().headers()['idempotency-key']).toBeTruthy();
  expect(route.request().postDataBuffer().subarray(0,5).toString()).toBe('%PDF-');
  model.documents.push({id:id(21),project_id:P,title:url.searchParams.get('title'),kind:url.searchParams.get('kind'),mime_type:'application/pdf',created_at:'2026-11-01T12:00:00Z',document_extractions:[{status:'ready'}]});
  await route.fulfill({status:202,json:{data:{}}});
 });
 await page.locator('[data-refund-action="open"]').click();
 await page.locator('[data-refund-action="edit"]').click();
 await page.locator('[data-refund-action="add-concept"]').click();
 await page.locator('.refund-concept [data-refund-action="pick"]').click();
 await page.locator('.refund-source-picker [data-cloud-action="upload"]').click();
 const form=page.locator('dialog [data-cloud-form="upload"]');
 await expect(form.locator('[name="kind"]')).toHaveValue('reference');
 await form.locator('[name="title"]').fill('Client cancellation evidence');
 await form.locator('[name="file"]').setInputFiles({name:'cancellation.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 synthetic browser fixture')});
 await form.locator('button[type="submit"]').click();
 await expect(page.locator('.refund-source-picker')).toBeVisible();
 await expect(page.locator('[data-refund-field="document"] option').last()).toHaveText('Client cancellation evidence');
 expect(uploads).toHaveLength(1);expect(uploads[0]).toMatchObject({kind:'reference',purpose:'refund_evidence',refund_case_id:PARENT});expect(model.writes).toHaveLength(0);expect(errors).toEqual([]);
});

async function reviewedPdf(page,language='es'){
 await page.locator('[data-refund-doc-field="language"]').selectOption(language);
 await page.locator('[data-refund-action="doc-pdf"]').click();
 await expect(page.locator('[data-refund-action="doc-pdf-view"]')).toBeVisible();
 await page.locator('[data-refund-action="doc-review"]').click();
 const form=page.locator('[data-refund-form="review"]');
 await form.locator('[name="notes"]').fill('Reviewed the exact PDF and calculation.');
 await form.locator('[name="confirmed"]').check();await form.locator('button[type="submit"]').click();
 await expect(page.locator('[data-refund-action="doc-preview"]')).toBeVisible();
}
async function sendReviewed(page){
 await page.locator('[data-refund-action="doc-preview"]').click();
 const form=page.locator('[data-refund-form="send"]');await expect(form).toBeVisible();
 await expect(page.locator('.refund-documents')).toContainText('customer@example.invalid');
 await form.locator('[name="confirmed"]').check();await form.locator('button[type="submit"]').click();
}
async function responseReview(page,kind){
 await page.locator('[data-refund-action="doc-sync"]').click();
 await page.locator(`[data-refund-action="doc-${kind}"]`).first().click();
 const form=page.locator(`[data-refund-form="${kind}"]`);
 await form.locator('[name="response_id"]').selectOption({index:1});
 await form.locator('[name="notes"]').fill('Reviewed the response to this exact sent version.');
 await form.locator('[name="confirmed"]').check();await form.locator('button[type="submit"]').click();
}
test('project closure includes initial and addendum; calculates allocation across both captures',async({page})=>{
 const {model,errors}=await setup(page,{multipay:true});
 await page.locator('[data-refund-action="new"]').click();const form=page.locator('[data-refund-form="create"]');
 await form.locator('[name="scope"]').selectOption('project_closure');
 await form.locator('[name="payments_reviewed"]').check();await form.locator('[name="reason"]').fill('Close the entire project');
 await evidence(page,form);await form.locator('button[type="submit"]').click();
 await expect(page.locator('[data-refund-action="edit"]')).toBeVisible();
 const edit=await draft(page,'');
 await expect(edit.locator('[data-refund-preview]')).toContainText('400');
 await edit.locator('button[type="submit"]').click();
 await expect(page.locator('[data-refund-action="doc-pdf"]')).toBeVisible();
 expect(model.writes[0].body.payment_ids).toEqual([id(30),PAY]);
 expect(model.snapshots[0].terms.allocations.map(a=>a.refund_minor)).toEqual([10000,30000]);
 await reviewedPdf(page);await sendReviewed(page);await expect(page.locator('[data-refund-action="doc-sync"]')).toBeVisible();
 await responseReview(page,'acceptance');await expect(page.locator('.refund-wizard-steps [aria-current="step"]')).toHaveAttribute('data-step','5');
 expect(model.items[0].status).toBe('accepted');expect(model.payments.map(p=>p.amount_minor)).toEqual([10000,30000]);
 expect(errors).toEqual([]);
});
test('sent v1 is immutable; feedback creates v2 with its own PDF review send and zero acceptance',async({page})=>{
 const {model,errors}=await setup(page,{saved:true});await page.locator('[data-refund-action="open"]').click();
 let form=await draft(page,'');await form.locator('button[type="submit"]').click();
 await reviewedPdf(page);await sendReviewed(page);await expect(page.locator('[data-refund-action="doc-sync"]')).toBeVisible();
 await page.locator('.refund-wizard-steps [data-step="3"]').click();
 await expect(page.locator('.refund-pdf-action')).toBeVisible();
 const sent=page.locator('.refund-mail-entry');
 await sent.locator('summary').click();
 await expect(sent.locator('.refund-mail-content')).toContainText('Settlement proposal');
 await page.locator('.refund-wizard-steps [data-step="4"]').click();
 await expect(page.locator('[data-refund-action="edit"]')).toHaveCount(0);
 await responseReview(page,'feedback');await expect(page.locator('[data-refund-action="edit"]')).toBeVisible();
 form=await draft(page,'300');await form.locator('button[type="submit"]').click();
 await page.locator('.refund-wizard-steps [data-step="2"]').click();
 await expect(page.locator('.refund-history button')).toHaveCount(2);
 await page.locator('.refund-wizard-steps [data-step="3"]').click();
 expect(model.snapshots.at(-1).version_no).toBe(2);expect(model.reviews).toHaveLength(1);
 await expect(page.locator('[data-refund-action="doc-acceptance"]')).toHaveCount(0);
 await reviewedPdf(page,'en');await sendReviewed(page);await expect(page.locator('[data-refund-action="doc-sync"]')).toBeVisible();
 await page.locator('[data-refund-action="doc-sync"]').click();await page.locator('[data-refund-action="doc-acceptance"]').first().click();
 form=page.locator('[data-refund-form="acceptance"]');
 expect(await form.locator('[name="response_id"] option').count()).toBe(2);
 await form.locator('[name="response_id"]').selectOption({index:1});await form.locator('[name="notes"]').fill('Accepted revised zero proposal');
 await form.locator('[name="confirmed"]').check();await form.locator('button[type="submit"]').click();
 await expect(page.locator('.refund-documents')).toContainText('sin devolución');
 expect(model.acceptances[0].snapshot_id).toBe(model.snapshots[1].id);
 expect(model.artifacts.map(a=>a.language)).toEqual(['es','en']);
 await page.locator('.refund-wizard-steps [data-step="2"]').click();
 await page.locator('details:has(.refund-history) summary').click();
 await page.locator('.refund-history button').last().click();
 await expect(page.locator('.refund-documents')).toContainText('es');
 await expect(page.locator('[data-refund-action="doc-pdf"]')).toHaveCount(0);expect(errors).toEqual([]);
});
test('uncertain Gmail send is reconciled after reload without sending a second message',async({page})=>{
 const {model,errors}=await setup(page,{saved:true});await page.locator('[data-refund-action="open"]').click();
 const form=await draft(page,'');await form.locator('button[type="submit"]').click();await reviewedPdf(page);
 model.uncertainMail=true;await sendReviewed(page);await expect(page.locator('[data-refund-action="reconcile-send"]')).toBeVisible();
 await page.reload();await expect(page.locator('[data-refund-action="reconcile-send"]')).toBeVisible();
 await page.locator('[data-refund-action="reconcile-send"]').click();await expect(page.locator('[data-refund-action="doc-sync"]')).toBeVisible();
 expect(model.deliveries).toHaveLength(1);expect(model.writes.filter(w=>w.kind==='email')).toHaveLength(1);
 expect(errors).toEqual([]);
});
test('English initial capture registration requires evidence and explicit review',async({page})=>{
 const {model,errors}=await setup(page,{lang:'en'});await page.locator('[data-refund-action="doc-initial"]').click();
 const form=page.locator('[data-refund-form="initial"]');await expect(form).toContainText('initial-'+P);
 await form.locator('[name="order_id"]').fill('ORDER-TEST');await form.locator('[name="capture_id"]').fill('CAPTURE-TEST');
 await form.locator('[name="notes"]').fill('Reviewed real project payment');await evidence(page,form);
 await form.locator('[name="confirmed"]').check();await form.locator('button[type="submit"]').click();
 await expect(page.locator('[data-refund-form="initial"]')).toHaveCount(0);await expect(page.locator('[data-refund-action="new"]')).toBeVisible();expect(model.payments[0].origin).toBe('initial');
 expect(model.writes[0].body.confirmed).toBe(true);expect(errors).toEqual([]);
});

test('English document review works on mobile and accepts an explicitly reviewed scanned PDF',async({page})=>{
 const {model,errors}=await setup(page,{saved:true,lang:'en'});await page.locator('[data-refund-action="open"]').click();
 const form=await draft(page,'120');await form.locator('button[type="submit"]').click();await reviewedPdf(page,'en');
 await page.setViewportSize({width:390,height:844});await page.locator('[data-refund-action="doc-preview"]').click();
 await expect(page.locator('.refund-documents')).toContainText('Sender');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'/tmp/trato-refund-browser/document-preview-mobile.png',fullPage:true});
 const send=page.locator('[data-refund-form="send"]');await send.locator('[name="confirmed"]').check();await send.locator('button[type="submit"]').click();
 await expect(page.locator('[data-refund-action="doc-acceptance"]')).toBeVisible();
 model.documents.push({id:id(700),project_id:P,title:'Scanned acceptance',kind:'reference',mime_type:'application/pdf',sha256:'b'.repeat(64),document_extractions:[]});
 await page.evaluate(d=>{window.TratoCloud.documents.push(d);window.TratoCloud.notify();},model.documents.at(-1));
 await page.locator('[data-refund-action="doc-acceptance"]').click();const accept=page.locator('[data-refund-form="acceptance"]');
 await accept.locator('[name="document_id"]').selectOption(id(700));await accept.locator('[name="notes"]').fill('Personally reviewed the signature and exact version.');
 await accept.locator('[name="confirmed"]').check();await accept.locator('button[type="submit"]').click();
 await expect(page.locator('.refund-wizard-steps [aria-current="step"]')).toHaveAttribute('data-step','5');
 expect(model.acceptances[0].evidence).toEqual({document_id:id(700),document_sha256:'b'.repeat(64)});expect(errors).toEqual([]);
});


test('TeTrato applies a cited suggestion to the refund editor and preserves explicit saving',async({page})=>{
 const {model,errors}=await setup(page,{saved:true});
 await page.locator('[data-refund-action="open"]').click();
 await page.locator('[data-refund-assistant="proposal"]').click();
 const assistant=page.locator('.tetrato-floating');
 await expect(assistant).toBeVisible();
 await expect(assistant.locator('#project-assistant-question')).toHaveValue(/propuesta de devolución/);
 await assistant.locator('[data-project-question] button[type="submit"]').click();
 await expect(assistant.locator('.refund-ai-next')).toContainText('Completa el importe del trabajo.');
 await assistant.locator('[data-assistant-action="apply-refund"]').click();
 await expect(assistant).toBeHidden();
 const form=page.locator('[data-refund-form="draft"]');
 await expect(form.locator('[name="description"]')).toHaveValue('Trabajo entregado');
 await expect(form.locator('[name="amount"]')).toHaveValue('');
 await expect(form.locator('[name="reviewed"]')).not.toBeChecked();
 expect(model.assistantFocus).toMatchObject({settlement_id:PARENT,step:2,task:'proposal'});
 expect(model.writes).toHaveLength(0);
 expect(errors).toEqual([]);
});
