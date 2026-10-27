// Gmail authorization lives separately from the Trato login and never sends an email.
export function installGmailConnection(cloud,{document=globalThis.document,window=globalThis.window,fetchFn=globalThis.fetch.bind(globalThis)}={}) {
  let popup=null, pendingUser=null, pendingState=null, timeout=null;
  const currentUser=()=>cloud.session?.session?.user?.id;
  const request=async(path,options={})=>{
    if(!cloud.active) throw new Error('Inicia sesión para conectar Gmail.');
    const response=await fetchFn('/api/v1/integrations/gmail'+path,{...options,headers:{Authorization:`Bearer ${await cloud.session.token()}`,...(options.body?{'Content-Type':'application/json'}:{})},signal:AbortSignal.timeout(30000)});
    let payload;try{payload=await response.json();}catch{throw new Error('No se pudo consultar la conexión de Gmail.');}
    if(!response.ok) throw new Error(payload.error?.message || 'No se pudo conectar Gmail.');
    return payload.data;
  };
  const clearPending=()=>{if(timeout)window.clearTimeout(timeout);timeout=null;popup=null;pendingUser=null;pendingState=null;};
  const mount=()=>{
    const modal=document.querySelector('dialog.cloud-dialog[open]');
    if(!cloud.active || !modal?.querySelector('.cloud-identity') || modal.querySelector('[data-gmail-panel]'))return;
    const panel=document.createElement('section');panel.dataset.gmailPanel='';panel.className='cloud-integration gmail-account-panel';panel.setAttribute('aria-label','Gmail');
    const icon=document.createElement('span');icon.className='cloud-integration-icon cloud-gmail-icon';icon.textContent='G';icon.setAttribute('aria-hidden','true');
    const content=document.createElement('div');content.className='cloud-integration-content';
    const heading=document.createElement('div');heading.className='cloud-integration-heading';
    const title=document.createElement('h3');title.textContent='Gmail';
    const badge=document.createElement('span');badge.className='cloud-connection-badge';badge.textContent='Consultando';
    const status=document.createElement('p');status.className='cloud-integration-status';status.setAttribute('role','status');status.textContent='Consultando conexión…';
    const button=document.createElement('button');button.type='button';button.className='button secondary';button.textContent='Conectar Gmail';button.disabled=true;
    heading.append(title,badge);content.append(heading,status);panel.append(icon,content,button);modal.querySelector('.cloud-integrations').prepend(panel);
    let connected=false;
    const update=data=>{
      connected=Boolean(data.connected);button.disabled=!data.configured;
      panel.dataset.connection=connected?'connected':data.configured?'available':'unavailable';
      badge.textContent=connected?'Conectado':data.configured?'Sin conectar':'No disponible';
      status.textContent=connected?data.email:data.configured?'Envía tus adendas y solicitudes de pago.':'La conexión no está disponible en este momento.';
      button.textContent=connected?'Desconectar Gmail':'Conectar Gmail';
    };
    const fail=error=>{panel.dataset.connection='error';badge.textContent='Revisar conexión';status.textContent=error.message;button.disabled=false;};
    request('').then(update).catch(fail);
    button.addEventListener('click',async()=>{
      if(connected){
        button.disabled=true;
        try {const data=await request('/disconnect',{method:'POST',body:'{}'});update(data);if(!data.revoked)status.textContent='Gmail desconectado de Trato. Puedes revisar también el acceso desde tu cuenta de Google.';}
        catch(error){fail(error);}return;
      }
      if(popup && !popup.closed){popup.focus();return;}
      popup=window.open('about:blank','trato-gmail-authorization','popup,width=560,height=720');
      if(!popup){fail(new Error('Permite abrir la ventana para autorizar Gmail.'));return;}
      pendingUser=currentUser();button.disabled=true;
      try{
        const data=await request('/connect',{method:'POST',body:'{}'});
        const url=new URL(data.authorization_url);
        if(url.origin!=='https://accounts.google.com' || url.pathname!=='/o/oauth2/v2/auth')throw new Error('La dirección de autorización no es válida.');
        if(currentUser()!==pendingUser || !cloud.active)throw new Error('La sesión cambió. Vuelve a iniciar la conexión.');
        pendingState=url.searchParams.get('state');popup.location.href=url.href;status.textContent='Autoriza el envío en la ventana de Google.';
        timeout=window.setTimeout(()=>{if(popup && !popup.closed)popup.close();clearPending();if(panel.isConnected)fail(new Error('La autorización caducó. Vuelve a conectar Gmail.'));},600000);
      }catch(error){if(popup && !popup.closed)popup.close();clearPending();fail(error);}
    });
  };
  const onMessage=async event=>{
    if(event.origin!==window.location.origin || !popup || event.source!==popup || event.data?.type!=='trato-gmail-callback')return;
    const data=event.data;
    if(data.state!==pendingState || !pendingUser || currentUser()!==pendingUser || !cloud.active)return;
    const panel=document.querySelector('[data-gmail-panel]');
    try{
      await request('/complete',{method:'POST',body:JSON.stringify({state:data.state,...(data.error?{error:data.error}:{code:data.code})})});
      if(panel)panel.remove();mount();
    }catch(error){if(panel){panel.querySelector('[role="status"]').textContent=error.message;panel.querySelector('button').disabled=false;}}
    finally{if(popup && !popup.closed)popup.close();clearPending();}
  };
  window.addEventListener('message',onMessage);
  const observer=new window.MutationObserver(mount);observer.observe(document.body,{childList:true,subtree:true});mount();
  return ()=>{observer.disconnect();window.removeEventListener('message',onMessage);if(popup && !popup.closed)popup.close();clearPending();};
}
