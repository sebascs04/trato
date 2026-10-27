const {test,expect}=require('@playwright/test');
const {mkdirSync}=require('node:fs');

async function setup(page,{configured=true}={}){
  let connected=false;const completes=[];const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>sessionStorage.setItem('trato:tests.supabase.invalid:session',JSON.stringify({access_token:'synthetic-token',refresh_token:'synthetic-refresh',expires_at:9999999999,user:{id:'owner',email:'user@example.invalid'}})));
  await page.route('**/api/v1/**',async route=>{
    const path=new URL(route.request().url()).pathname;let data;
    if(path==='/api/v1/config')data={supabase_url:'https://tests.supabase.invalid',publishable_key:'sb_publishable_test'};
    else if(path==='/api/v1/session')data={user_id:'owner'};
    else if(['/api/v1/clients','/api/v1/projects'].includes(path))data=[];
    else if(path==='/api/v1/sandbox/paypal-test')data={configured:true,payment:{status:'completed'}};
    else if(path==='/api/v1/integrations/gmail')data={configured,connected,email:connected?'sender@example.com':null};
    else if(path==='/api/v1/integrations/gmail/connect'){
      expect(route.request().headers().authorization).toBe('Bearer synthetic-token');
      expect(route.request().postDataJSON()).toEqual({});
      data={authorization_url:'https://accounts.google.com/o/oauth2/v2/auth?state=synthetic-state-for-browser-test'};
    }else if(path==='/api/v1/integrations/gmail/complete'){
      expect(route.request().headers().authorization).toBe('Bearer synthetic-token');
      completes.push(route.request().postDataJSON());connected=true;data={configured,connected,email:'sender@example.com'};
    }else if(path==='/api/v1/integrations/gmail/disconnect'){
      connected=false;data={configured,connected,email:null,revoked:true};
    }else {await route.fulfill({status:404,json:{error:{code:'NOT_FOUND'}}});return;}
    await route.fulfill({json:{data}});
  });
  await page.context().route('https://accounts.google.com/**',route=>route.fulfill({status:302,headers:{location:'http://localhost:5173/gmail-callback.html?state=synthetic-state-for-browser-test&code=synthetic-code'}}));
  await page.goto('/#clientes');
  await page.getByRole('button',{name:'Mi perfil · sesión iniciada'}).click();
  return {completes,errors};
}

test('profile connects Gmail with a user-bound callback and disconnects',async({page})=>{
  const {completes,errors}=await setup(page);
  await expect(page.getByRole('button',{name:'Conectar Gmail',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Conectar Gmail',exact:true}).click();
  await expect(page.locator('[data-gmail-panel]')).toContainText('sender@example.com');
  await expect(page.locator('[data-gmail-panel] .cloud-connection-badge')).toHaveText('Conectado');
  mkdirSync('.local/browser-tests',{recursive:true});
  await page.screenshot({path:'.local/browser-tests/account-profile.png',fullPage:true});
  expect(completes).toEqual([{state:'synthetic-state-for-browser-test',code:'synthetic-code'}]);
  await page.getByRole('button',{name:'Desconectar Gmail',exact:true}).click();
  await expect(page.locator('[data-gmail-panel]')).toContainText('Sin conectar');
  expect(errors).toEqual([]);
});

test('unconfigured Gmail is unavailable and unrelated messages cannot complete OAuth',async({page})=>{
  const {completes,errors}=await setup(page,{configured:false});
  await expect(page.getByRole('button',{name:'Conectar Gmail',exact:true})).toBeDisabled();
  await expect(page.locator('[data-gmail-panel]')).toContainText('No disponible');
  await page.evaluate(()=>window.postMessage({type:'trato-gmail-callback',state:'forged',code:'forged'},location.origin));
  expect(completes).toEqual([]);expect(errors).toEqual([]);
});
