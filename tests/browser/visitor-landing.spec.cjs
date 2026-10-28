const {test,expect}=require('@playwright/test');
async function setup(page,{language='es',signedIn=false,configError=false}={}){
 const errors=[],requests=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(({language,signedIn})=>{localStorage.setItem('trato:ui-language',language);if(signedIn)sessionStorage.setItem('trato:tests.supabase.invalid:session',JSON.stringify({access_token:'test',refresh_token:'refresh',expires_at:9999999999,user:{id:'landing-owner',email:'owner@example.invalid'}}));},{language,signedIn});
 await page.route('**/api/v1/**',async route=>{
  const path=new URL(route.request().url()).pathname;requests.push(path);
  if(path==='/api/v1/config'){
   await route.fulfill(configError?{status:503,json:{error:{code:'AUTH_NOT_CONFIGURED'}}}:{json:{data:{supabase_url:'https://tests.supabase.invalid',publishable_key:'sb_publishable_test'}}});return;
  }
  if(path==='/api/v1/session')await route.fulfill({json:{data:{user_id:'landing-owner'}}});
  else if(path.endsWith('/gmail/connection'))await route.fulfill({json:{data:{connected:false}}});
  else await route.fulfill({json:{data:[]}});
 });
 await page.goto('/#clientes');return {errors,requests};
}
for(const language of ['es','en'])test(`visitors see a sourced product story with AI and PayPal instead of the workspace (${language})`,async({page})=>{
 const state=await setup(page,{language});const landing=page.locator('#visitor-landing');
 await expect(landing).toBeVisible();await expect(page.locator('#trato-sidebar')).not.toBeVisible();
 await expect(landing.locator('h1')).toContainText(language==='es'?'un buen trato.':'a fair deal.');
 await expect(landing.locator('.land-integration-line')).toContainText('PayPal');
 await expect(landing.locator('.land-research')).toContainText(language==='es'?'REINO UNIDO, 2025':'UNITED KINGDOM, 2025');
 await expect(landing.locator('.land-research a')).toHaveAttribute('href','https://www.leapers.co/research/2025/report/');
 expect(state.requests).toEqual(['/api/v1/config']);expect(state.errors).toEqual([]);
 if(language==='es')await page.screenshot({path:'.local/browser-tests/visitor-hero.png',animations:'disabled'});
 await landing.locator('#land-step-2').scrollIntoViewIfNeeded();await expect(landing.locator('.land-scene')).toHaveAttribute('data-land-phase','2');
 if(language==='es')await page.screenshot({path:'.local/browser-tests/visitor-story.png',animations:'disabled'});
 await landing.locator('#land-step-3').scrollIntoViewIfNeeded();await expect(landing.locator('.land-scene')).toHaveAttribute('data-land-phase','3');
 await expect(landing.locator('.land-stack-grid')).toContainText('PayPal');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
test('signup opens the real account form without sending credentials on its own',async({page})=>{
 const state=await setup(page);await page.locator('[data-land-auth="signup"]').first().click();
 await expect(page.locator('.cloud-dialog')).toBeVisible();await expect(page.locator('#cloud-dialog-title')).toHaveText('Empieza tu estudio en Trato');
 await expect(page.locator('#cloud-password')).toHaveAttribute('autocomplete','new-password');
 await expect(page.locator('.cloud-dialog button[value="signup"]')).toHaveClass('button');
 await expect(page.locator('.cloud-dialog button[type="submit"]')).toHaveCount(1);
 await page.locator('#cloud-email').fill('sebas@example.invalid');
 await page.locator('[data-cloud-auth-mode="login"]').click();
 await expect(page.locator('#cloud-dialog-title')).toHaveText('Accede a tu estudio');
 await expect(page.locator('#cloud-email')).toHaveValue('sebas@example.invalid');
 await expect(page.locator('#cloud-password')).toHaveAttribute('autocomplete','current-password');
 await expect(page.locator('.cloud-dialog button[type="submit"]')).toHaveCount(1);
 await expect(page.locator('.cloud-dialog button[value="signup"]')).toHaveCount(0);
 await page.locator('[data-cloud-auth-mode="signup"]').click();
 await expect(page.locator('#cloud-password')).toHaveAttribute('autocomplete','new-password');
 expect(state.requests).toEqual(['/api/v1/config']);expect(state.errors).toEqual([]);
});
test('saved sessions go directly to the workspace without a visible visitor landing',async({page})=>{
 const state=await setup(page,{signedIn:true});await expect(page.locator('.cloud-client-directory')).toBeVisible();
 await expect(page.locator('#visitor-landing')).toBeHidden();await expect(page.locator('#trato-sidebar')).toBeVisible();expect(state.errors).toEqual([]);
});
test('motion can be paused and reduced motion starts paused',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});const state=await setup(page);
 await expect(page.locator('#visitor-landing')).toHaveClass(/land-paused/);
 await expect(page.locator('[data-land-motion]').first()).toHaveAttribute('aria-pressed','true');
 await page.locator('[data-land-motion]').first().click();await expect(page.locator('[data-land-motion]').first()).toHaveAttribute('aria-pressed','false');
 expect(await page.locator('.land-request-card').evaluate(el=>getComputedStyle(el).animationName)).toBe('land-float');expect(state.errors).toEqual([]);
});
test('public presentation does not disguise a failed account connection',async({page})=>{
 const state=await setup(page,{configError:true});await expect(page.locator('#visitor-landing')).toBeVisible();
 await expect(page.locator('[data-land-error]')).toBeVisible();expect(state.errors).toEqual([]);
});

test('camera changes with the story, layers open and pause freezes the scene',async({page})=>{
 const state=await setup(page);const object=page.locator('.land-object');
 await expect(object).toHaveCSS('--land-camera-scale','1');
 const start=await object.evaluate(el=>el.style.getPropertyValue('--land-camera-y'));
 await page.locator('#land-step-1').scrollIntoViewIfNeeded();
 await expect(page.locator('.land-scene')).toHaveAttribute('data-land-phase','1');
 await expect.poll(()=>object.evaluate(el=>el.style.getPropertyValue('--land-camera-y'))).not.toBe(start);
 await expect(page.locator('[data-land-marker="1"]')).toHaveClass('is-active');
 await page.waitForTimeout(1000);
 await page.screenshot({path:'.local/browser-tests/visitor-layers.png',animations:'disabled'});
 await page.locator('[data-land-motion]').first().click();
 const frozen=await object.getAttribute('style');
 await page.locator('#land-step-3').scrollIntoViewIfNeeded();
 await expect(page.locator('.land-scene')).toHaveAttribute('data-land-phase','3');
 expect(await object.getAttribute('style')).toBe(frozen);
 expect(await page.locator('.land-particle-field').evaluate(el=>getComputedStyle(el).animationPlayState)).toBe('paused');
 expect(state.errors).toEqual([]);
});

for(const language of ['es','en'])test(`practice illustration previews three client temperaments without a live session (${language})`,async({page})=>{
 const state=await setup(page,{language});
 const section=page.locator('#land-practice');await section.scrollIntoViewIfNeeded();
 await expect(section).toBeVisible();
 await expect(section.locator('[data-land-mood]')).toHaveCount(3);
 await section.locator('[data-land-mood="upset"]').click();
 await expect(section.locator('[data-practice-message]')).toHaveText(language==='es'?'¡No voy a pagar más por algo tan pequeño!':'I’m not paying more for something so small!');
 await expect(section.locator('[data-land-mood="upset"]')).toHaveAttribute('aria-pressed','true');
 await expect(section.locator('.land-person-upset')).toHaveCount(2);
 await section.locator('[data-land-motion]').click();
 await expect(section.locator('[data-land-motion]')).toHaveAttribute('aria-pressed','true');
 expect(await section.locator('.land-practice-person .land-person-head').evaluate(el=>getComputedStyle(el).animationPlayState)).toBe('paused');
 await section.locator('[data-land-mood="unsure"]').click();
 await expect(section.locator('[data-practice-message]')).toHaveText(language==='es'?'Pensé que esos cambios ya estaban incluidos…':'I thought those changes were already included…');
 await expect(section.locator('[data-practice-reply]')).toContainText(language==='es'?'Revisemos lo acordado':'Let’s review what we agreed');
 if(language==='es')await page.screenshot({path:'.local/browser-tests/visitor-practice.png',animations:'disabled'});
 expect(state.requests).toEqual(['/api/v1/config']);expect(state.errors).toEqual([]);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
test('practice cycles only while visible and stops when paused',async({page})=>{
 await setup(page);const section=page.locator('#land-practice');
 await section.scrollIntoViewIfNeeded();await expect(section).toBeInViewport({ratio:.7});
 await expect(section).toHaveClass(/land-revealed/);
 await page.clock.install();await section.locator('[data-land-mood="calm"]').click();
 await expect(section.locator('[data-land-mood="calm"]')).toHaveAttribute('aria-pressed','true');
 await page.clock.runFor(7600);await expect(section.locator('[data-land-mood="unsure"]')).toHaveAttribute('aria-pressed','true');
 await section.locator('[data-land-motion]').click();await page.clock.runFor(16000);
 await expect(section.locator('[data-land-mood="unsure"]')).toHaveAttribute('aria-pressed','true');
});
