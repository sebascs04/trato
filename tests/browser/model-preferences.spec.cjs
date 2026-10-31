const {test,expect}=require('@playwright/test');
for(const lang of ['es','en']){
 test(`profile model selector saves only on explicit submit (${lang})`,async({page})=>{
   await page.goto('/?demo=1#ensayos');
   const result=await page.evaluate(async lang=>{
     const {mountModelPreference}=await import('/model-preferences.mjs');
     const {setUiLanguage}=await import('/i18n.mjs');setUiLanguage(lang);
     const dialog=document.createElement('dialog');dialog.innerHTML='<section class="cloud-identity"></section>';document.body.append(dialog);dialog.showModal();
     const calls=[];let selected='gemini-3.8-flash';
     const cloud={document,modal:dialog,json:body=>({method:'POST',body:JSON.stringify(body)}),request:async(path,options)=>{
       calls.push({path,options});if(options)selected=JSON.parse(options.body).model_id;
       return {can_select:true,selected_model:selected,default_model:'gemini-3.8-flash',models:[{id:'gemini-3.8-flash',name:'Gemini 3.8 Flash'},{id:'gemini-3.5-flash-lite',name:'Gemini 3.5 Flash-Lite'}]};
     }};
     window.profileTest={calls,cloud};await mountModelPreference(cloud);return calls.length;
   },lang);
   expect(result).toBe(1);
   await page.locator('#profile-model').selectOption('gemini-3.5-flash-lite');
   expect(await page.evaluate(()=>profileTest.calls.length)).toBe(1);
   await page.locator('.cloud-model-form button').click();
   await expect(page.locator('.model-settings-status')).toHaveText(lang==='es'?'Modelo guardado.':'Model saved.');
   expect(await page.evaluate(()=>JSON.parse(profileTest.calls[1].options.body))).toEqual({model_id:'gemini-3.5-flash-lite'});
   await expect(page.locator('.cloud-model-form button')).toBeDisabled();
   await page.screenshot({path:'.local/browser-tests/model-profile-'+lang+'.png'});
 });
}
test('non-tester has no selector',async({page})=>{
 await page.goto('/?demo=1#ensayos');
 await page.evaluate(async()=>{
   const {mountModelPreference}=await import('/model-preferences.mjs');
   const dialog=document.createElement('dialog');dialog.innerHTML='<section class="cloud-identity"></section>';document.body.append(dialog);dialog.showModal();
   const cloud={document,modal:dialog,request:async()=>({can_select:false})};await mountModelPreference(cloud);
 });
 await expect(page.locator('#profile-model')).toHaveCount(0);
});

test('a failed save keeps the unsaved choice available for explicit retry',async({page})=>{
 await page.goto('/?demo=1#ensayos');
 await page.evaluate(async()=>{
   const {mountModelPreference}=await import('/model-preferences.mjs');
   const dialog=document.createElement('dialog');dialog.innerHTML='<section class="cloud-identity"></section>';document.body.append(dialog);dialog.showModal();
   let calls=0;const cloud={document,modal:dialog,json:body=>({method:'POST',body:JSON.stringify(body)}),request:async(path,options)=>{
     if(options){calls++;throw Error('Provider unavailable');}
     return {can_select:true,selected_model:'gemini-3.8-flash',default_model:'gemini-3.8-flash',models:[{id:'gemini-3.8-flash',name:'Flash'},{id:'gemini-3.5-flash-lite',name:'Lite'}]};
   }};window.failedModelCalls=()=>calls;await mountModelPreference(cloud);
 });
 await page.locator('#profile-model').selectOption('gemini-3.5-flash-lite');
 await page.locator('.cloud-model-form button').click();
 await expect(page.locator('#profile-model')).toHaveValue('gemini-3.5-flash-lite');
 await expect(page.locator('.cloud-model-form button')).toBeEnabled();
 expect(await page.evaluate(()=>failedModelCalls())).toBe(1);
});

test('complete profile groups the expanded catalogue with account settings',async({page})=>{
 await page.goto('/?demo=1#ensayos');
 await page.waitForFunction(()=>window.TratoCloud?.modal);
 await page.evaluate(async()=>{
   const cloud=window.TratoCloud;
   document.body.classList.add('cloud-design');
   cloud.active=true;cloud.session={session:{user:{id:'test-owner',email:'tester@example.invalid'}},token:async()=> 'test-only-token'};
   cloud.request=async()=>({can_select:true,default_model:'gemini-3.8-flash',selected_model:'gemini-3.8-flash',models:[
      {id:'gemini-3.8-flash',name:'Gemini 3.8 Flash',family:'flash'},
      {id:'gemini-3.5-flash-lite',name:'Gemini 3.5 Flash-Lite',family:'lite'},
      {id:'gemini-3.1-flash-lite',name:'Gemini 3.1 Flash-Lite',family:'lite'},
      {id:'gemini-3.5-flash',name:'Gemini 3.5 Flash',family:'flash'},
      {id:'gemini-3.6-flash',name:'Gemini 3.6 Flash',family:'flash'},
      {id:'gemini-3.7-flash',name:'Gemini 3.7 Flash',family:'flash'},
      {id:'gemini-3.1-pro-preview',name:'Gemini 3.1 Pro Preview',family:'pro'},
      {id:'gemini-4-argon',name:'Gemini 4 Argon',family:'argon'}]});
   cloud.fetch=async()=>new Response(JSON.stringify({data:{configured:false,connected:false}}),{status:200,headers:{'Content-Type':'application/json'}});
   cloud.openAccount();
 });
 await expect(page.locator('#profile-model option')).toHaveCount(8);
 await expect(page.locator('#profile-model optgroup')).toHaveCount(4);
 await expect(page.locator('.cloud-profile-hero')).toBeVisible();
 await page.screenshot({path:'.local/browser-tests/profile-redesign-desktop.png'});
 await page.setViewportSize({width:390,height:844});
 await expect(page.locator('#profile-model')).toBeVisible();
 expect(await page.locator('.cloud-profile-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 await page.screenshot({path:'.local/browser-tests/profile-redesign-mobile.png'});
});
