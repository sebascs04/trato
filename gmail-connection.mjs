import {uiText,uiLocale} from './i18n.mjs';
// Gmail authorization lives separately from the Trato login and never sends an email.
export function installGmailConnection(cloud,{document=globalThis.document,window=globalThis.window,fetchFn=globalThis.fetch.bind(globalThis)}={}) {
  let popup=null, pendingUser=null, pendingState=null, pendingPurpose=null, pendingResolve=null, pendingReject=null, timeout=null;
  const currentUser=()=>cloud.session?.session?.user?.id;
  const request=async(path,options={})=>{
    if(!cloud.active) throw new Error(uiText("Inicia sesión para conectar Gmail."));
    const response=await fetchFn('/api/v1/integrations/gmail'+path,{...options,headers:{Authorization:`Bearer ${await cloud.session.token()}`,...(options.body?{'Content-Type':'application/json'}:{})},signal:AbortSignal.timeout(30000)});
    let payload;try{payload=await response.json();}catch{throw new Error(uiText("No se pudo consultar la conexión de Gmail."));}
    if(!response.ok) {
      const messages={GMAIL_READ_PERMISSION_REQUIRED:uiText("El permiso de lectura de Gmail no está activo."),GMAIL_READ_NOT_AUTHORIZED:uiText("Google no autorizó la lectura de respuestas. Revisa los permisos de Gmail."),GMAIL_NOT_CONNECTED:uiText("Conecta Gmail desde tu perfil antes de buscar respuestas."),GMAIL_SEND_CONNECTION_REQUIRED:uiText("Conecta Gmail para enviar antes de autorizar la lectura de respuestas."),GMAIL_ACCOUNT_CHANGED:uiText("La cuenta de Gmail cambió. Mantén conectada la misma cuenta para enviar y leer respuestas."),GMAIL_SEND_PERMISSION_REQUIRED:uiText("El permiso de envío de Gmail no está activo.")};
      const denied=payload.error?.code==='GMAIL_AUTHORIZATION_DECLINED'?(pendingPurpose==='read'?uiText("Google no autorizó la lectura de respuestas. Revisa los permisos de Gmail."):uiText("Google no autorizó el acceso solicitado. Puedes seguir usando los permisos que ya concediste.")):null;
      throw new Error(denied||messages[payload.error?.code]||payload.error?.message||uiText("No se pudo conectar Gmail."));
    }
    return payload.data;
  };
  cloud.refreshGmailStatus=async()=>{cloud.gmailStatus=await request('');return cloud.gmailStatus;};
  const clearPending=()=>{if(timeout)window.clearTimeout(timeout);timeout=null;popup=null;pendingUser=null;pendingState=null;pendingPurpose=null;pendingResolve=null;pendingReject=null;};
  const authorize=async(purpose,statusNode)=>new Promise((resolve,reject)=>{
    if(popup&&!popup.closed){reject(new Error(uiText("Ya hay una autorización de Gmail en curso.")));return;}
    popup=window.open('about:blank','trato-gmail-authorization','popup,width=560,height=720');
    if(!popup){clearPending();reject(new Error(uiText("Permite abrir la ventana para autorizar Gmail.")));return;}
    pendingUser=currentUser();pendingPurpose=purpose;pendingResolve=resolve;pendingReject=reject;
    (async()=>{
      try{
        const data=await request('/connect',{method:'POST',body:JSON.stringify({purpose})});
        const url=new URL(data.authorization_url);
        if(url.origin!=='https://accounts.google.com' || url.pathname!=='/o/oauth2/v2/auth')throw new Error(uiText("La dirección de autorización no es válida."));
        if(currentUser()!==pendingUser || !cloud.active)throw new Error(uiText("La sesión cambió. Vuelve a iniciar la conexión."));
        pendingState=url.searchParams.get('state');popup.location.href=url.href;
        if(statusNode)statusNode.textContent=purpose==='read'?uiText("Autoriza la lectura de respuestas de Gmail en la ventana de Google."):uiText("Autoriza el envío desde Gmail en la ventana de Google.");
        timeout=window.setTimeout(()=>{const rejectPending=pendingReject;if(popup&&!popup.closed)popup.close();clearPending();rejectPending?.(new Error(uiText("La autorización caducó. Vuelve a conectar Gmail.")));},600000);
      }catch(error){const rejectPending=pendingReject;if(popup&&!popup.closed)popup.close();clearPending();rejectPending?.(error);}
    })();
  });
  cloud.authorizeGmailRead=()=>authorize('read',document.querySelector('[data-gmail-panel] [role="status"]'));
  const mount=()=>{
    const modal=document.querySelector('dialog.cloud-dialog[open]');
    if(!cloud.active || !modal?.querySelector('.cloud-identity') || modal.querySelector('[data-gmail-panel]'))return;
    const panel=document.createElement('section');panel.dataset.gmailPanel='';panel.className='cloud-integration gmail-account-panel';panel.setAttribute('aria-label','Gmail');
    const icon=document.createElement('span');icon.className='cloud-integration-icon cloud-gmail-icon';icon.textContent='G';icon.setAttribute('aria-hidden','true');
    const content=document.createElement('div');content.className='cloud-integration-content';
    const heading=document.createElement('div');heading.className='cloud-integration-heading';
    const title=document.createElement('h3');title.textContent='Gmail';
    const badge=document.createElement('span');badge.className='cloud-connection-badge';badge.textContent=uiText("Consultando");
    const status=document.createElement('p');status.className='cloud-integration-status';status.setAttribute('role','status');status.textContent=uiText("Consultando conexión…");
    const button=document.createElement('button');button.type='button';button.className='button secondary';button.textContent=uiText("Conectar Gmail");button.disabled=true;
    heading.append(title,badge);content.append(heading,status);panel.append(icon,content,button);modal.querySelector('.cloud-integrations').prepend(panel);
    let connected=false;
    const update=data=>{
      cloud.gmailStatus=data;
      connected=Boolean(data.connected);button.disabled=!data.configured;
      panel.dataset.connection=connected?'connected':data.configured?'available':'unavailable';
      badge.textContent=connected?uiText("Conectado"):data.configured?uiText("Sin conectar"):uiText("No disponible");
      status.textContent=connected?(data.can_read?uiText("Gmail puede enviar mensajes y leer respuestas de adendas."):uiText("Gmail está conectado para enviar. La lectura de respuestas se autoriza cuando la solicites.")):data.configured?uiText("Envía tus adendas y solicitudes de pago."):uiText("La conexión no está disponible en este momento.");
      button.textContent=connected?uiText("Desconectar Gmail"):uiText("Conectar Gmail");
    };
    const fail=error=>{panel.dataset.connection='error';badge.textContent=uiText("Revisar conexión");status.textContent=error.message;button.disabled=false;};
    request('').then(update).catch(fail);
    button.addEventListener('click',async()=>{
      if(connected){
        button.disabled=true;
        try {const data=await request('/disconnect',{method:'POST',body:'{}'});update(data);if(!data.revoked)status.textContent=uiText("Gmail desconectado de Trato. Puedes revisar también el acceso desde tu cuenta de Google.");}
        catch(error){fail(error);}return;
      }
      button.disabled=true;
      try{await authorize('send',status);}catch(error){if(panel.isConnected)fail(error);}
    });
  };
  const onMessage=async event=>{
    if(event.origin!==window.location.origin || !popup || event.source!==popup || event.data?.type!=='trato-gmail-callback')return;
    const data=event.data;
    if(data.state!==pendingState || !pendingUser || currentUser()!==pendingUser || !cloud.active)return;
    const panel=document.querySelector('[data-gmail-panel]');
    try{
      const result=await request('/complete',{method:'POST',body:JSON.stringify({state:data.state,...(data.error?{error:data.error}:{code:data.code})})});
      cloud.gmailStatus=result;
      const resolvePending=pendingResolve;
      if(panel)panel.remove();mount();resolvePending?.(result);
    }catch(error){const rejectPending=pendingReject;if(panel){panel.querySelector('[role="status"]').textContent=error.message;panel.querySelector('button').disabled=false;}rejectPending?.(error);}
    finally{if(popup && !popup.closed)popup.close();clearPending();}
  };
  window.addEventListener('message',onMessage);
  const observer=new window.MutationObserver(mount);observer.observe(document.body,{childList:true,subtree:true});mount();
  return ()=>{observer.disconnect();window.removeEventListener('message',onMessage);if(popup && !popup.closed)popup.close();clearPending();};
}
