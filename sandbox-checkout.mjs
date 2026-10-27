// Explicit PayPal sandbox connection test. It never mutates a project or adenda.
export function installSandboxCheckout(cloud,{document=globalThis.document,window=globalThis.window,fetchFn=globalThis.fetch.bind(globalThis)}={}) {
  let popup=null,payment=null,dialog=null;
  const request=async(path='',options={})=>{
    if(!cloud.active)throw new Error('Inicia sesión en Trato para probar PayPal.');
    const response=await fetchFn('/api/v1/sandbox/paypal-test'+path,{...options,headers:{Authorization:`Bearer ${await cloud.session.token()}`,...options.headers,...(options.body?{'Content-Type':'application/json'}:{})},signal:AbortSignal.timeout(45000)});
    let payload;try{payload=await response.json();}catch{throw new Error('PayPal no devolvió un resultado válido.');}
    if(!response.ok)throw new Error(payload.error?.message || 'No se pudo completar la prueba.');
    return payload.data;
  };
  const labels={creating:'Preparando orden',pending_approval:'Esperando aprobación en PayPal',approved:'Aprobación recibida',capturing:'Verificando pago',pending:'Pago pendiente de resolución en PayPal',completed:'Pago confirmado por PayPal',failed:'Pago rechazado',cancelled:'Orden cancelada en PayPal',reconciliation_required:'Resultado pendiente de conciliación'};
  const show=()=>{
    if(!dialog){dialog=document.createElement('dialog');dialog.className='cloud-dialog';dialog.setAttribute('aria-label','Prueba PayPal de US$0,10');document.body.append(dialog);}
    dialog.replaceChildren();
    const title=document.createElement('h2');title.textContent='Prueba PayPal · US$0,10';
    const description=document.createElement('p');description.className='cloud-notice';description.textContent='Prueba con saldo ficticio en PayPal sandbox.';
    const status=document.createElement('p');status.setAttribute('role','status');status.textContent=payment?(labels[payment.status] || payment.status):'Listo para crear una orden de US$0,10.';
    const detail=document.createElement('p');detail.className='cloud-notice';detail.textContent=payment?.order_id?`Orden PayPal: ${payment.order_id}`:'';
    const error=document.createElement('p');error.className='cloud-error';error.setAttribute('role','alert');
    const actions=document.createElement('div');actions.className='dialog-actions';
    const close=document.createElement('button');close.type='button';close.className='button secondary';close.textContent='Cerrar';close.onclick=()=>dialog.close();
    const action=(label,fn)=>{const button=document.createElement('button');button.type='button';button.className='button';button.textContent=label;button.onclick=async()=>{button.disabled=true;try{await fn();}catch(e){error.textContent=e.message;}finally{button.disabled=false;}};actions.append(button);};
    const openPayPal=()=>{
      const url=new URL(payment.approval_url);
      if(url.protocol!=='https:' || !['sandbox.paypal.com','www.sandbox.paypal.com'].includes(url.hostname) || url.username || url.password)throw new Error('El enlace no corresponde a PayPal sandbox.');
      if(!popup || popup.closed)popup=window.open('about:blank','trato-paypal-sandbox','popup,width=650,height=800');
      if(!popup)throw new Error('Permite abrir la ventana de PayPal para aprobar la prueba.');
      popup.location.href=url.href;
    };
    if(!payment)action('Preparar pago de US$0,10',async()=>{
      const storageKey='trato:paypal-sandbox-test-key';
      let key=window.sessionStorage.getItem(storageKey);
      if(!key){key=window.crypto.randomUUID();window.sessionStorage.setItem(storageKey,key);}
      payment=await request('',{method:'POST',body:'{}',headers:{'Idempotency-Key':key}});show();
    });
    if(payment?.approval_url && ['pending_approval','approved'].includes(payment.status))action('Abrir PayPal sandbox',openPayPal);
    if(payment && payment.status!=='completed')action('Verificar pago',async()=>{
      payment=await request('/'+payment.id+'/capture',{method:'POST',body:'{}'});show();
    });
    if(payment && payment.status!=='completed')action('Consultar estado',async()=>{
      payment=await request('/'+payment.id+'/reconcile',{method:'POST',body:'{}'});show();
    });
    actions.append(close);dialog.append(title,description,status,detail,error,actions);
    if(!dialog.open)dialog.showModal();
  };
  const mount=()=>{
    const profile=document.querySelector('dialog.cloud-dialog[open]');
    if(!cloud.active || !profile?.querySelector('.cloud-identity') || profile.querySelector('[data-paypal-test-panel]'))return;
    const panel=document.createElement('section');panel.dataset.paypalTestPanel='';panel.className='cloud-integration';panel.setAttribute('aria-label','PayPal');
    const icon=document.createElement('span');icon.className='cloud-integration-icon cloud-paypal-icon';icon.textContent='P';icon.setAttribute('aria-hidden','true');
    const content=document.createElement('div');content.className='cloud-integration-content';
    const heading=document.createElement('div');heading.className='cloud-integration-heading';
    const title=document.createElement('h3');title.textContent='PayPal';
    const badge=document.createElement('span');badge.className='cloud-connection-badge';badge.textContent='Sandbox';
    const status=document.createElement('p');status.className='cloud-integration-status';status.setAttribute('role','status');status.textContent='Consultando prueba de pago…';
    const button=document.createElement('button');button.type='button';button.className='button secondary';button.textContent='Probar pago de US$0,10';button.disabled=true;
    heading.append(title,badge);content.append(heading,status);panel.append(icon,content,button);profile.querySelector('.cloud-integrations').append(panel);
    request().then(data=>{
      payment=data.payment;
      status.textContent=payment?.status==='completed'?'Pago de prueba confirmado · USD 0.10':data.configured?'Prueba de cobro con saldo ficticio · USD 0.10':'La conexión no está disponible en este momento.';
      panel.dataset.connection=payment?.status==='completed'?'verified':data.configured?'available':'unavailable';
      button.textContent=payment?.status==='completed'?'Ver pago de prueba':'Probar pago de US$0,10';button.disabled=!data.configured;
    }).catch(error=>{status.textContent=error.message;});
    button.onclick=async()=>{
      button.disabled=true;
      try{payment=(await request()).payment;profile.close();show();}catch(error){status.textContent=error.message;}finally{button.disabled=false;}
    };
  };
  const onMessage=async event=>{
    if(event.origin!==window.location.origin || !popup || event.source!==popup || event.data?.type!=='trato-paypal-test-return' || !payment || event.data.order_id!==payment.order_id)return;
    if(event.data.cancelled){if(dialog)dialog.querySelector('[role="status"]').textContent='Volviste sin completar el pago. Puedes abrir la misma orden de nuevo.';return;}
    try{payment=await request('/'+payment.id+'/capture',{method:'POST',body:'{}'});show();if(popup && !popup.closed)popup.close();}
    catch(error){if(dialog)dialog.querySelector('[role="alert"]').textContent=error.message;}
  };
  const observer=new window.MutationObserver(mount);observer.observe(document.body,{subtree:true,childList:true});window.addEventListener('message',onMessage);mount();
  return ()=>{observer.disconnect();window.removeEventListener('message',onMessage);};
}
