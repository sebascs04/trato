/* Isolated product preview. No backend, SMTP or PayPal effects are invoked here. */
(function(root){
  function createPreview(value){
    return {...value,amount:Number(value.amount),recipientEmail:value.recipientEmail || 'cliente@example.com',status:'draft',screen:'summary',view:'freelancer',emailsSent:0};
  }
  function transition(model,action){
    if(action==='review-email'&&model.status==='draft'&&model.view==='freelancer')model.screen='email';
    else if(action==='send'&&model.status==='draft'&&model.screen==='email'&&model.view==='freelancer'){
      model.status='pending_approval';model.screen='summary';model.emailsSent=1;
    }else if(action==='client-view'&&model.status!=='draft')model.view='client';
    else if(action==='freelancer-view')model.view='freelancer';
    else if(action==='pay'&&model.status==='pending_approval'&&model.view==='client')model.status='pending';
    else if(action==='preview-confirmed'&&model.status==='pending')model.status='completed';
    return model;
  }
  if(typeof module!=='undefined'&&module.exports){module.exports={createPreview,transition};return;}
  const modal=document.createElement('dialog');modal.className='payment-panel';modal.setAttribute('aria-label','Solicitud de pago');document.body.append(modal);
  const escape=value=>String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const previews=new Map();let current=null;
  function notify(model){root.dispatchEvent(new CustomEvent('trato-payment-preview-updated',{detail:{key:model.paymentKey || model.projectName,status:model.status}}));}
  const price=c=>'USD '+c.amount.toFixed(2);
  function render(){
    const c=current,buyer=c.view==='client';
    let body=`<div class="upload-modal-header"><div><span class="eyebrow">${buyer?'ESPACIO DEL CLIENTE':'COBRO AL CLIENTE'}</span><h2>${buyer?'Tu solicitud de pago.':c.status==='completed'?'Pago recibido.':c.status==='pending'?'Confirmando el pago.':c.status==='pending_approval'?'Solicitud enviada.':c.screen==='email'?'Revisa el correo.':'Prepara la solicitud de pago.'}</h2></div><button type="button" class="close" data-payment-close aria-label="Cerrar solicitud de pago">×</button></div><div class="payment-preview-indicator"><span>Vista previa</span>${buyer?'<button class="text-button" data-payment-action="freelancer-view">Volver a mi espacio ↗</button>':''}</div><div class="payment-summary"><div><small>PROYECTO</small><strong>${escape(c.projectName)}</strong></div><div><small>${buyer?'IMPORTE A PAGAR':'ADICIONAL ACORDADO'}</small><strong class="payment-main-amount">${price(c)}</strong></div><div><small>CLIENTE</small><strong>${escape(c.clientName)}</strong></div></div>`;
    if(buyer){
      body+=`<article class="payment-agreement"><span class="eyebrow">CAMBIO ACORDADO${c.agreementVersion?' · V'+escape(c.agreementVersion):''}</span><p>${escape(c.scope || 'Trabajo adicional aprobado para este proyecto.')}</p></article>`;
      if(c.status==='pending_approval')body+='<p class="payment-description">Revisa el importe del cambio acordado y continúa con el pago.</p><div class="payment-actions"><button class="button" data-payment-action="pay">Pagar con PayPal →</button></div>';
      if(c.status==='pending')body+='<div class="payment-feedback" role="status">Estamos confirmando el resultado del pago. No necesitas pagarlo otra vez.</div>';
      if(c.status==='completed')body+='<div class="payment-success"><span>✓</span><h3>Pago confirmado</h3><p>Tu pago quedó registrado. Puedes cerrar esta ventana.</p></div>';
    }else if(c.status==='draft'&&c.screen==='summary'){
      body+=`<p class="payment-description">El cliente recibirá un correo con el detalle del adicional y el enlace para pagarlo.</p><label class="field" for="payment-recipient">Correo del cliente</label><input id="payment-recipient" class="context-box" type="email" value="${escape(c.recipientEmail)}" autocomplete="email"><div class="payment-actions"><button class="button" data-payment-action="review-email">Revisar correo →</button></div>`;
    }else if(c.status==='draft'){
      body+=`<article class="payment-email-preview"><span class="eyebrow">CORREO AL CLIENTE</span><p class="payment-mail-to">Para: ${escape(c.recipientEmail)}</p><h3>Solicitud de pago · ${escape(c.projectName)}</h3><p>Hola, ${escape(c.contactName || c.clientName)}.</p><p>Ya quedó acordado el cambio de ${escape(c.projectName)}. El adicional es de <strong>${price(c)}</strong>.</p><p>${escape(c.scope || 'Puedes consultar el detalle en la adenda acordada.')}</p><span class="payment-link-sample">Revisar y pagar con PayPal ↗</span><p>Gracias por confiar en mi trabajo.</p></article><div class="payment-actions"><button class="button" data-payment-action="send">Enviar solicitud de pago →</button></div>`;
    }else{
      const label={pending_approval:'Pendiente de pago',pending:'Confirmando pago',completed:'Pagado'}[c.status];
      body+=`<span class="badge ${c.status==='completed'?'done':'pending'}">${label}</span><div class="payment-mail-status"><span>✉</span><div><strong>Solicitud enviada a ${escape(c.recipientEmail)}</strong><p>El correo contiene el detalle del adicional y el enlace de pago.</p></div></div>`;
      if(c.status==='completed')body+=`<div class="payment-success"><span>✓</span><h3>${price(c)} recibidos</h3><p>El cobro está completado y queda asociado a este cambio.</p></div>`;
      else body+=`<p class="payment-description">${c.status==='pending'?'Estamos comprobando el resultado. El estado se actualizará cuando se confirme.':'El siguiente paso le corresponde al cliente. No necesitas volver a crear el cobro.'}</p>`;
      body+=`<div class="payment-actions"><button class="button secondary" data-payment-action="client-view">Ver enlace del cliente ↗</button><button class="button" data-payment-close>${c.status==='completed'?'Cerrar resultado':'Cerrar y esperar el pago'}</button></div>`;
    }
    modal.innerHTML=body;
  }
  root.TratoPayments={
    getStatus(key){return previews.get(key)?.status || 'draft';},
    exportState(){return [...previews].map(([key,value])=>[key,{...value,view:'freelancer'}]);},
    restoreState(records){
      for(const [key,value] of records || []){
        if(typeof key!=='string' || !value || !['draft','pending_approval','pending','completed'].includes(value.status) || !(Number(value.amount)>0))continue;
        previews.set(key,{...value,paymentKey:key,view:'freelancer'});
      }
    },
    reset(){previews.clear();current=null;if(modal.open)modal.close();},
    openDemo(value){
      if(!(Number(value.amount)>0))return;
      const key=value.paymentKey || value.projectName;
      if(!previews.has(key))previews.set(key,createPreview({...value,paymentKey:key}));
      current=previews.get(key);current.view='freelancer';render();if(!modal.open)modal.showModal();
      if(current.status==='pending'){const processing=current;setTimeout(()=>{if(previews.get(key)!==processing)return;transition(processing,'preview-confirmed');notify(processing);if(current===processing&&modal.open)render();},1400);}
    }
  };
  modal.addEventListener('click',event=>{
    if(event.target.closest('[data-payment-close]')){modal.close();return;}
    const action=event.target.closest('[data-payment-action]')?.dataset.paymentAction;
    if(!action||!current)return;
    if(action==='review-email'){
      const input=modal.querySelector('#payment-recipient');current.recipientEmail=input?.value.trim() || current.recipientEmail;
    }
    const before=current.status;
    transition(current,action);notify(current);render();
    if(action==='pay'&&before==='pending_approval'&&current.status==='pending'){
      const processing=current;
      setTimeout(()=>{if(previews.get(processing.paymentKey)!==processing)return;transition(processing,'preview-confirmed');notify(processing);if(current===processing&&modal.open)render();},1400);
    }
  });
})(typeof window!=='undefined'?window:globalThis);
