const {test,expect}=require('@playwright/test');

test('profile test opens PayPal and confirms only through authenticated backend',async({page})=>{
  let payment=null,created=0,captured=0;
  await page.addInitScript(()=>sessionStorage.setItem('trato:tests.supabase.invalid:session',JSON.stringify({access_token:'synthetic-token',refresh_token:'synthetic-refresh',expires_at:9999999999,user:{id:'owner',email:'owner@example.invalid'}})));
  await page.route('**/api/v1/**',async route=>{
    const path=new URL(route.request().url()).pathname;let data;
    if(path==='/api/v1/config')data={supabase_url:'https://tests.supabase.invalid',publishable_key:'sb_publishable_test'};
    else if(path==='/api/v1/session')data={user_id:'owner'};
    else if(['/api/v1/projects','/api/v1/clients'].includes(path))data=[];
    else if(path==='/api/v1/integrations/gmail')data={configured:false,connected:false};
    else if(path==='/api/v1/sandbox/paypal-test'){
      if(route.request().method()==='POST'){
        expect(route.request().headers().authorization).toBe('Bearer synthetic-token');
        expect(route.request().postDataJSON()).toEqual({});
        expect(route.request().headers()['idempotency-key']).toBeTruthy();created++;
        payment={id:'11111111-1111-4111-8111-111111111111',amount:'0.10',status:'pending_approval',order_id:'ORDER12345',approval_url:'https://www.sandbox.paypal.com/checkoutnow?token=ORDER12345',capture_id:null};data=payment;
      }else data={configured:true,amount:'0.10',payment};
    }else if(path.endsWith('/capture')){
      expect(route.request().headers().authorization).toBe('Bearer synthetic-token');captured++;
      payment={...payment,status:'completed',capture_id:'CAPTURE12345'};data=payment;
    }else {await route.fulfill({status:404,json:{error:{code:'NOT_FOUND'}}});return;}
    await route.fulfill({json:{data}});
  });
  await page.context().route('https://www.sandbox.paypal.com/**',route=>route.fulfill({status:302,headers:{location:'http://localhost:5173/paypal-sandbox-return.html?result=return&token=ORDER12345'}}));
  await page.goto('/#clientes');
  await page.getByRole('button',{name:'Mi perfil · sesión iniciada'}).click();
  await page.getByRole('button',{name:'Probar pago de US$0,10',exact:true}).click();
  await page.getByRole('button',{name:'Preparar pago de US$0,10',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Prueba PayPal de US$0,10'}).getByRole('status')).toContainText('Esperando aprobación en PayPal');
  await page.getByRole('button',{name:'Abrir PayPal sandbox',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Prueba PayPal de US$0,10'}).getByRole('status')).toContainText('Pago confirmado por PayPal');
  expect(created).toBe(1);expect(captured).toBe(1);
  await expect(page.getByRole('button',{name:'Preparar pago de US$0,10',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Abrir PayPal sandbox',exact:true})).toHaveCount(0);
});
