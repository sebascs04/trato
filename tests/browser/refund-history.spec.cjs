// Explicit activity API fixture; never connects to financial or mail providers.
const {test,expect}=require('@playwright/test');
const parent='refund-settlement',document='change-document';
const stamp='2026-11-02T12:00:00Z';
const base={created_at:stamp,group_kind:'refund',group_id:parent,group_title:'Razón exacta del cliente <script>unsafe</script>',request_document_id:null};
const milestones=[
 {id:'refund-request',kind:'refund_requested',...base},
 {id:'refund-sent',kind:'refund_proposal_sent',revision_no:2,...base},
 {id:'refund-feedback',kind:'refund_feedback_reviewed',revision_no:1,...base},
 {id:'refund-acceptance',kind:'refund_acceptance_recorded',revision_no:2,...base},
 {id:'refund-auth',kind:'refund_financial_authorized',...base},
 {id:'refund-money-unique',kind:'refund_completed',amount_minor:20000,currency:'USD',receipt_id:'canonical-receipt',...base},
 {id:'refund-close',kind:'refund_closed',...base},
 {id:'change-request',kind:'request_registered',created_at:stamp,group_kind:'change',group_id:document,group_title:'Existing request',request_document_id:document},
 {id:'external-money',kind:'refund_completed',created_at:stamp,group_kind:'refund',group_id:'payment-external',group_title:null,request_document_id:null,amount_minor:1000,currency:'USD',receipt_id:'external-receipt'}
];
for(const lang of ['es','en'])for(const mobile of [false,true])test(`one refund history, translated milestones and stable receipt (${lang}, ${mobile?'mobile':'desktop'})`,async({page})=>{
 const errors=[],paths=[];page.on('pageerror',e=>errors.push(e.message));
 if(mobile)await page.setViewportSize({width:390,height:844});
 await page.addInitScript(lang=>{
  localStorage.setItem('trato:ui-language',lang);
  sessionStorage.setItem('trato:history.supabase.invalid:session',JSON.stringify({access_token:'test',refresh_token:'test',expires_at:9999999999,user:{id:'owner',email:'owner@example.invalid'}}));
 },lang);
 await page.route('**/api/v1/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;paths.push(path);let data;
  expect(req.method()).toBe('GET');
  if(path.endsWith('/config'))data={supabase_url:'https://history.supabase.invalid',publishable_key:'sb_publishable_test'};
  else if(path.endsWith('/session'))data={user_id:'owner'};
  else if(path.endsWith('/clients'))data=[{id:'client',name:'History Client'}];
  else if(path.endsWith('/projects'))data=[{id:'project',client_id:'client',name:'History Project'}];
  else if(path.endsWith('/activity'))data=milestones;
  else if(path.endsWith('/request-status'))data={can_register:true,closures:[]};
  else if(path.endsWith('/documents')||path.endsWith('/proposals'))data=[];
  else {await route.fulfill({status:404,json:{error:{code:'NOT_FOUND'}}});return;}
  await route.fulfill({json:{data}});
 });
 await page.goto('/#clientes');
 await page.getByRole('button',{name:lang==='es'?'Abrir cliente History Client':'Open client History Client',exact:true}).click();
 await page.getByRole('button',{name:lang==='es'?'Abrir proyecto History Project':'Open project History Project',exact:true}).click();
 await page.locator('.cloud-project-navigation [data-cloud-tab="historial"]').click();
 const history=page.locator('[data-cloud-history]');
 await expect(history.locator('.cloud-project-activity')).toHaveCount(1);
 await expect(history.locator('[data-activity-group-kind="change"]')).toHaveCount(1);
 await expect(history.locator('[data-activity-group-kind="refund"]')).toHaveCount(2);
 const group=history.locator('[data-activity-group-id="refund-settlement"]');
 await expect(group.locator('.cloud-project-event')).toHaveCount(7);
 await expect(group.locator('[data-activity-kind="refund_completed"]')).toHaveCount(1);
 await expect(group.locator('[data-activity-kind="refund_completed"]')).toContainText(lang==='es'?'Reembolso confirmado':'Refund confirmed');
 const expected=await page.evaluate(lang=>new Intl.NumberFormat(lang==='es'?'es-PE':'en-US',{style:'currency',currency:'USD'}).format(200),lang);
 await expect(group.locator('[data-activity-kind="refund_completed"]')).toContainText(expected);
 await expect(group.locator('[data-activity-kind="refund_closed"]')).not.toContainText(expected);
 await expect(group.locator('summary')).toContainText('Razón exacta del cliente <script>unsafe</script>');
 await expect(group.locator('script')).toHaveCount(0);
 await expect(history.locator('svg')).toHaveCount(12);
 const external=history.locator('[data-activity-group-id="payment-external"]');
 await expect(external.locator('summary')).toContainText(lang==='es'?'Reembolso externo del pago':'External payment refund');
 const overflow=await history.evaluate(el=>el.scrollWidth>el.clientWidth+1);expect(overflow).toBe(false);
 expect(paths.filter(p=>p.endsWith('/activity'))).toHaveLength(1);expect(paths.some(p=>p.includes('/financial'))).toBe(false);
 expect(errors).toEqual([]);
});
