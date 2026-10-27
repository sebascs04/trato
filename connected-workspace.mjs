import {icon as uiIcon} from './icons.mjs';
import {SessionClient, apiRequest} from './auth-session.mjs';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
const labels = {queued:'Pendiente de lectura',ready:'Texto guardado',error:'Lectura pendiente de reintento'};
const kinds = {reference:'Referencia',initial_agreement:'Fuente del acuerdo inicial',email_request:'Pedido del cliente',addendum:'Adenda · por verificar',delivery:'Entrega'};
const date = value => !value || !Number.isFinite(new Date(value).getTime()) ? 'Fecha no registrada' : new Intl.DateTimeFormat('es-PE',{dateStyle:'medium',timeStyle:'short',timeZone:'America/Lima'}).format(new Date(value));

export class ConnectedWorkspace {
  constructor({document:doc=globalThis.document, location=globalThis.location, fetchFn=globalThis.fetch.bind(globalThis), storage=globalThis.sessionStorage}={}) {
    this.document=doc; this.location=location; this.fetch=fetchFn; this.storage=storage;
    this.active=false; this.state='loading'; this.clients=[]; this.projects=[]; this.documents=[]; this.events=[]; this.projectActivity=[];
    this.clientId=''; this.projectId=''; this.tab='acuerdo'; this.comparison=null; this.requestId=''; this.epoch=0; this.busy=false; this.loading=false; this.directoryLoading=false; this.message='';
    this.resourceOpen={files:false,history:false};this.historyGeneration=0;this.historyLoaded=false;this.historyPending=null;
    this.projectsLoaded=false;this.projectsLoading=false;
    this.base=location.origin; this.demoMode=new URLSearchParams(location.search || '').get('demo')==='1';
  }
  get handlesView() {return !this.demoMode || this.active;}
  $(selector) {return this.document.querySelector(selector);}
  async connect() {
    const response=await this.fetch('/api/v1/config',{signal:AbortSignal.timeout(15000),cache:'no-store'});
    if(!response.ok) throw new Error('No pudimos conectar con tu espacio. Vuelve a intentar en unos momentos.');
    this.session=new SessionClient((await response.json()).data,{storage:this.storage,fetchFn:this.fetch});
  }
  async request(path,options,blob=false) {
    try {return await apiRequest(this.session,this.base,path,options,blob);}
    catch(error) {
      if(!this.session?.session && this.active) {this.reset(); this.notify();}
      throw error;
    }
  }
  reset() {
    this.stopIngestionPolling();
    this.historyGeneration++;this.historyLoaded=false;this.historyPending=null;this.resourceOpen={files:false,history:false};this.projectsLoaded=false;this.projectsLoading=false;
    this.epoch++; this.active=false; this.state='anonymous'; this.clients=[]; this.projects=[]; this.documents=[]; this.events=[]; this.projectActivity=[];
    this.clientId=''; this.projectId=''; this.tab='acuerdo'; this.comparison=null; this.requestId=''; this.uploadCommand=null; this.message=''; this.loading=false; this.directoryLoading=false;
  }
  attach(notify) {
    this.notify=notify;
    const avatar=this.$('.top-actions .avatar.small');
    this.profile=this.document.createElement('button'); this.profile.type='button'; this.profile.className='avatar small cloud-profile';
    this.profileInitials=avatar.textContent; this.profile.textContent=this.profileInitials; this.profile.setAttribute('aria-label','Mi perfil · iniciar sesión');
    avatar.replaceWith(this.profile); this.profile.addEventListener('click',()=>this.openAccount());
    this.modal=this.document.createElement('dialog'); this.modal.className='cloud-dialog';
    this.modal.setAttribute('aria-labelledby','cloud-dialog-title'); this.document.body.append(this.modal);
    this.modal.addEventListener('click',event=>{if(event.target.closest('[data-cloud-close]')) this.modal.close();});
    this.modal.addEventListener('submit',event=>{event.preventDefault(); this.submit(event);});
    this.modal.addEventListener('close',()=>{if(!this.modal.open){this.releasePreview();this.modal.replaceChildren();}});
    this.document.addEventListener('click',event=>this.click(event));
    this.document.addEventListener('toggle',event=>{
      const resource=event.target.dataset?.cloudResource;
      if(!resource||!event.target.isConnected)return;
      this.resourceOpen[resource]=event.target.open;
      if(!event.target.open)return;
      if(resource==='history')this.loadHistory();
      else this.renderDocuments(event.target.querySelector('[data-cloud-files]'));
    },true);
    this.document.addEventListener('change',event=>{
      if(event.target.matches('[data-cloud-project]')) {
        if(this.busy) {event.target.value=this.projectId; return;}
        this.projectId=event.target.value; this.tab='acuerdo'; this.comparison=null; this.requestId=''; this.documents=[]; this.events=[]; this.projectActivity=[]; this.notify(); this.run(()=>this.loadProject());
      }
    });
    this.badgeHTML=this.$('.top-actions .demo-pill').innerHTML;
    this.footerText=this.$('.footer span:last-child').textContent;
    this.emptyText=this.$('#empty').textContent;
    this.notify(); this.restore();
  }
  async restore() {
    const epoch=this.epoch;
    this.state='loading'; this.message=''; this.notify();
    try {
      await this.connect();
      if(epoch!==this.epoch) return;
      if(this.session.session) await this.load();
      else {this.state='anonymous'; this.notify();}
    } catch {
      this.state=this.session && !this.session.session?'anonymous':'error';
      this.message=this.state==='anonymous'?'Inicia sesión para volver a tu espacio.':'No pudimos recuperar tu espacio. Vuelve a intentar.';
      this.notify();
    }
  }
  async load() {
    const epoch=++this.epoch;
    this.directoryLoading=true;this.notify();
    try {
      const [,clients]=await Promise.all([this.request('/api/v1/session'),this.request('/api/v1/clients')]);
      if(epoch!==this.epoch) return;
      this.directoryLoading=false;
      this.clients=clients;this.projects=[];this.projectsLoaded=false;this.active=true; this.state='ready';
      if(!clients.some(item=>item.id===this.clientId)) this.clientId='';
      if(this.clientId)await this.loadProjects();
      if(!this.projects.some(item=>item.id===this.projectId && item.client_id===this.clientId)) this.projectId='';
      this.documents=[]; this.events=[]; this.projectActivity=[]; this.loading=!!this.projectId;
      this.notify(); await this.loadProject();
    } finally {if(epoch===this.epoch&&this.directoryLoading){this.directoryLoading=false;this.notify();}}
  }
  async loadProjects() {
    if(this.projectsLoaded)return;
    const epoch=this.epoch;
    this.projectsLoading=true;this.notify();
    try{
      const projects=await this.request('/api/v1/projects');
      if(epoch!==this.epoch)return;
      this.projects=projects;this.projectsLoaded=true;
    }finally{if(epoch===this.epoch){this.projectsLoading=false;this.notify();}}
  }
  async loadProject() {
    this.stopIngestionPolling();
    this.historyGeneration++;this.historyLoaded=false;this.historyPending=null;this.projectActivity=[];
    this.resourceOpen={files:false,history:false};
    const id=this.projectId, epoch=this.epoch;
    if(!id) {this.documents=[]; this.events=[]; this.projectActivity=[]; this.notify(); return;}
    this.loading=true; this.notify();
    try {
      const documents=await this.request(`/api/v1/projects/${id}/documents`);
      if(id!==this.projectId || epoch!==this.epoch) return;
      this.documents=documents; this.events=[];
      this.scheduleIngestionPolling();
    } finally {if(id===this.projectId && epoch===this.epoch) {this.loading=false; this.notify();}}
  }
  async loadHistory() {
    const panel=this.$('[data-cloud-history]');
    if(!panel||!this.projectId||!this.active)return;
    if(this.historyLoaded){this.renderHistory(panel);return;}
    if(this.historyPending)return this.historyPending;
    const id=this.projectId,epoch=this.epoch,generation=this.historyGeneration;
    panel.innerHTML='<p class="cloud-notice" role="status">Cargando historial…</p>';
    const current=()=>this.active&&id===this.projectId&&epoch===this.epoch&&generation===this.historyGeneration;
    this.historyPending=(async()=>{
      try{
        const activity=await this.request(`/api/v1/projects/${id}/activity`);
        if(!current())return;
        this.projectActivity=activity;this.historyLoaded=true;
        const target=this.$('[data-cloud-history]');if(target)this.renderHistory(target);
      }catch(error){
        if(current()){const target=this.$('[data-cloud-history]');if(target)target.innerHTML=`<p class="cloud-error" role="alert">${escape(error.message)}</p><p class="cloud-notice">Cierra y abre el historial para reintentar.</p>`;}
      }finally{if(current())this.historyPending=null;}
    })();
    return this.historyPending;
  }
  extractionState(doc) {return Array.isArray(doc.document_extractions)?doc.document_extractions[0]:doc.document_extractions;}
  sourceStatusLabel(doc) {
    const extraction=this.extractionState(doc),thread=extraction?.worker_threads;
    const phase=Array.isArray(thread)?thread[0]?.phase:thread?.phase;
    if(extraction?.status==='queued'&&phase) return {queued:'En cola',reading_original:'Preparando documento',extracting_text:'Leyendo documento'}[phase]||labels.queued;
    return labels[extraction?.status]||'Preparando lectura';
  }
  sourceProcessing(doc) {const extraction=this.extractionState(doc);return extraction?.status==='queued'&&!!extraction.worker_thread_id;}
  stopIngestionPolling() {clearTimeout(this.ingestionTimer);this.ingestionTimer=null;this.ingestionGeneration=(this.ingestionGeneration||0)+1;}
  scheduleIngestionPolling() {
    this.stopIngestionPolling();
    const projectId=this.projectId,epoch=this.epoch,generation=this.ingestionGeneration;
    if(!this.active||!projectId||!this.documents.some(doc=>this.sourceProcessing(doc))) return;
    this.ingestionTimer=setTimeout(async()=>{
      if(!this.active||projectId!==this.projectId||epoch!==this.epoch||generation!==this.ingestionGeneration) return;
      if(this.busy||this.modal.open||this.document.visibilityState==='hidden') {this.scheduleIngestionPolling();return;}
      try {
        // Poll only documents of the active project; do not reload activity or proposals.
        const documents=await this.request(`/api/v1/projects/${projectId}/documents`);
        if(!this.active||projectId!==this.projectId||epoch!==this.epoch||generation!==this.ingestionGeneration) return;
        const status=items=>JSON.stringify(items.map(doc=>[doc.id,this.extractionState(doc)?.status,this.extractionState(doc)?.error_code,this.extractionState(doc)?.worker_threads]));
        const changed=status(documents)!==status(this.documents);
        this.documents=documents;
        if(changed) this.notify();
        this.scheduleIngestionPolling();
      } catch(error) {
        if(projectId===this.projectId&&epoch===this.epoch&&generation===this.ingestionGeneration) {this.message=error.message;this.notify();}
        // A visible error stops polling; explicit refresh can restart it.
      }
    },2000);
  }
  async run(task) {
    if(this.busy) return;
    this.busy=true;
    this.modal.querySelectorAll('button[type="submit"]').forEach(button=>{button.disabled=true;});
    try {await task();}
    catch(error) {
      const message=error.name==='TimeoutError' ? 'La operación tardó demasiado. Actualiza antes de reintentar.' : error.message;
      if(this.modal.open) {this.modal.querySelector('[data-cloud-error]').textContent=message;}
      else {this.message=message; this.notify();}
    } finally {this.busy=false; this.modal.querySelectorAll('button[type="submit"]').forEach(button=>{button.disabled=false;});}
  }
  show(title,html) {
    this.releasePreview();
    this.modal.classList.remove('cloud-profile-dialog','cloud-auth-dialog','cloud-document-preview','cloud-mail-dialog');
    if(this.modal.open) this.modal.close();
    this.modal.innerHTML=`<div class="upload-modal-header"><div><span class="eyebrow">TU ESPACIO EN TRATO</span><h2 id="cloud-dialog-title">${escape(title)}</h2></div><button type="button" class="close" data-cloud-close aria-label="Cerrar" title="Cerrar">${uiIcon('x')}</button></div>${html}<p class="cloud-error" data-cloud-error role="alert"></p>`;
    this.modal.showModal();
  }
  openAccount() {
    if(this.active) {
      const email=this.session.session.user.email || 'Sesión iniciada';
      this.show('Tu perfil',`<section class="cloud-identity" aria-label="Cuenta de Trato"><span class="cloud-account-avatar" aria-hidden="true">${escape(email.slice(0,2).toUpperCase())}</span><div><span class="cloud-account-label">Cuenta de Trato</span><strong>${escape(email)}</strong></div></section><section class="cloud-account-connections" aria-label="Conexiones"><header><h3>Conexiones</h3><p>Tu correo y tus cobros, en un solo lugar.</p></header><div class="cloud-integrations"></div></section><form data-cloud-form="logout" class="cloud-account-footer"><button class="text-button" type="submit">Cerrar sesión</button></form>`);
      this.modal.classList.add('cloud-profile-dialog');
    } else {
      this.show('Accede a tu estudio',`<form data-cloud-form="auth"><label class="field" for="cloud-email">Correo</label><input class="context-box" id="cloud-email" name="email" type="email" autocomplete="username" required><label class="field" for="cloud-password">Contraseña</label><input class="context-box" id="cloud-password" name="password" type="password" minlength="8" autocomplete="current-password" required><div class="dialog-actions"><button type="submit" class="button" value="login">Iniciar sesión</button><button type="submit" class="button secondary" value="signup">Crear cuenta</button></div></form>`);
      this.modal.classList.add('cloud-auth-dialog');
    }
  }
  async submit(event) {
    const form=event.target, kind=form.dataset.cloudForm, mode=event.submitter?.value;
    const values=new FormData(form);
    await this.run(async()=>{
      if(kind==='auth') {
        await this.connect();
        let ready=true;
        if(mode==='signup') ready=await this.session.signup(values.get('email').trim(),values.get('password'));
        else await this.session.login(values.get('email').trim(),values.get('password'));
        form.querySelector('[name="password"]').value='';
        if(!ready) {this.modal.querySelector('[data-cloud-error]').textContent='Revisa tu correo y confirma la cuenta. Después vuelve a iniciar sesión desde tu perfil.'; return;}
        await this.load(); this.modal.close(); this.location.hash='clientes';
      } else if(kind==='logout') {
        this.epoch++; await this.session.logout(); this.reset(); this.modal.close(); this.notify();
      } else if(kind==='client') {
        await this.request('/api/v1/clients',this.json({name:values.get('name'),contact_email:values.get('email')?.trim() || null}));
        this.clientId=''; this.projectId=''; this.modal.close(); await this.load(); this.message='Cliente guardado.'; this.notify();
      } else if(kind==='client-delete') {
        const id=form.dataset.clientId;
        await this.request(`/api/v1/clients/${id}/delete`,{method:'POST'});
        if(this.clientId===id){this.clientId='';this.projectId='';this.documents=[];this.events=[];this.comparison=null;this.requestId='';}
        this.modal.close();await this.load();this.message='Cliente eliminado de tu espacio.';this.notify();
      } else if(kind==='project') {
        const project=await this.request('/api/v1/projects',this.json({client_id:values.get('client'),name:values.get('name')}));
        this.clientId=project.client_id; this.projectId=project.id; this.tab='acuerdo'; this.modal.close(); await this.load();
      } else if(kind==='upload') {
        const id=this.projectId, epoch=this.epoch, file=values.get('file');
        if(!file?.size || file.size>10485760) throw new Error('Selecciona un PDF o DOCX de hasta 10 MB.');
        const metadata={filename:file.name,title:values.get('title'),kind:values.get('kind')};
        const command=JSON.stringify([id,metadata,file.size,file.lastModified]);
        if(this.uploadCommand?.command!==command) this.uploadCommand={command,key:crypto.randomUUID()};
        const mime=file.name.toLowerCase().endsWith('.docx')?'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'application/pdf';
        try {
          await this.request(`/api/v1/projects/${id}/documents?${new URLSearchParams(metadata)}`,{method:'POST',body:file,headers:{'Content-Type':mime,'Idempotency-Key':this.uploadCommand.key}});
        } catch(error) {await this.loadProject(); throw error;}
        if(epoch!==this.epoch || id!==this.projectId) return;
        this.uploadCommand=null; this.comparison=null; this.tab=metadata.kind==='initial_agreement'?'acuerdo':'solicitudes'; this.modal.close(); await this.loadProject();
        this.message=metadata.kind==='initial_agreement'?'Información guardada en este proyecto.':'Pedido guardado con su conversación de respaldo.'; this.notify();
      }
    });
  }
  json(data) {return {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)};}
  click(event) {
    const target=event.target.closest('[data-cloud-action]');
    if(!target) return;
    const action=target.dataset.cloudAction, id=target.dataset.cloudId;
    if(action==='access') {this.openAccount(); return;}
    if(action==='reconnect') {this.run(()=>this.restore()); return;}
    if(!this.active) return;
    if(action==='client') this.show('Nuevo cliente',`<form data-cloud-form="client"><label class="field">Nombre<input name="name" class="context-box" required maxlength="200"></label><label class="field">Correo de contacto<input name="email" class="context-box" type="email" maxlength="254"></label><div class="dialog-actions"><button type="submit" class="button">Guardar cliente</button></div></form>`);
    if(action==='client-delete'){const client=this.clients.find(c=>c.id===id);if(client)this.show('Eliminar cliente',`<p>Eliminarás a <strong>${escape(client.name)}</strong> de tu espacio junto con sus proyectos y documentos.</p><p>Conservaremos los registros mediante borrado lógico para permitir su recuperación.</p><form data-cloud-form="client-delete" data-client-id="${escape(client.id)}"><div class="dialog-actions"><button class="button cloud-delete-confirm" type="submit">${uiIcon('trash-2')}Eliminar cliente</button><button class="button secondary" type="button" data-cloud-close>Cancelar</button></div></form>`);}
    if(action==='project') this.openProject(id);
    if(action==='upload') this.openSource(target.dataset.cloudPurpose);
    if(action==='graph-preview') this.run(async()=>{const {openGraphPreview}=await import('./graph-preview.mjs');await openGraphPreview({returnFocus:target});});
    if(action==='refund-preview') this.run(async()=>{const {openRefundPreview}=await import('./refund-preview.mjs');await openRefundPreview({returnFocus:target});});
    if(action==='review-change') this.run(()=>this.reviewChange(id));
    if(action==='tab') {
      const next=target.dataset.cloudTab;
      if(this.loading || (this.busy && !['acuerdo','solicitudes'].includes(next))) return;
      if(next==='revision' && !this.initialSources().some(doc=>this.sourceReady(doc))) return;
      this.tab=next; this.message=''; if(this.location.hash==='#conversaciones'&&this.tab!=='asistente') this.location.hash='clientes'; this.notify();}
    if(action==='refresh') this.run(()=>this.load());
    if(['clients','client-open','project-open','projects'].includes(action)) {
      if(this.busy) return;
      if(action==='clients') {this.clientId=''; this.projectId='';}
      if(action==='client-open') {this.clientId=id; this.projectId='';}
      if(action==='projects') this.projectId='';
      if(action==='project-open') {
        const project=this.projects.find(item=>item.id===id); if(!project) return;
        this.clientId=project.client_id; this.projectId=project.id; this.tab='acuerdo';
      }
      this.documents=[]; this.events=[]; this.projectActivity=[]; this.comparison=null; this.loading=false; this.message='';
      this.location.hash='clientes'; this.notify(); this.run(async()=>{if(this.clientId)await this.loadProjects();await this.loadProject();});
    }
    if(action==='text') this.run(()=>this.previewDocument(id));
    if(action==='download') this.run(async()=>{
      const doc=this.documents.find(d=>d.id===id); if(!doc) return;
      const blob=await this.request(`/api/v1/documents/${id}/file`,{},true);
      const url=URL.createObjectURL(blob), link=this.document.createElement('a'); link.href=url; link.download=doc.original_filename; link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
    });
    if(action==='retry') this.run(async()=>{await this.request(`/api/v1/documents/${id}/retry`,{method:'POST'}); await this.loadProject();});
  }
  releasePreview() {
    if(this.previewUrl){URL.revokeObjectURL(this.previewUrl);this.previewUrl=null;}
  }
  async previewDocument(id, supplied=null) {
    const project=this.projectId, epoch=this.epoch;
    const doc=supplied || this.documents.find(item=>item.id===id);
    if(!doc) throw new Error('Actualiza el proyecto para abrir este documento.');
    if(doc.mime_type!=='application/pdf'){
      this.show(doc.title,`<p>La vista previa está disponible para PDF. Este documento de Word puede descargarse para abrirlo.</p><button class="button secondary" data-cloud-action="download" data-cloud-id="${escape(id)}">Descargar original ↗</button>`);
      return;
    }
    const blob=await this.request(`/api/v1/documents/${id}/file`,{},true);
    if(project!==this.projectId || epoch!==this.epoch) return;
    if(blob.type.split(';')[0]!=='application/pdf') throw new Error('El servidor no devolvió un documento PDF.');
    this.show(doc.title,`<div class="cloud-preview-toolbar"><span>${escape(doc.original_filename)}</span><a class="text-button" data-preview-download>Descargar PDF ↗</a></div><iframe class="cloud-pdf-frame" title="Vista previa del documento PDF"></iframe>`);
    this.modal.classList.add('cloud-document-preview');
    this.previewUrl=URL.createObjectURL(blob);
    this.modal.querySelector('iframe').src=this.previewUrl+'#view=FitH';
    const link=this.modal.querySelector('[data-preview-download]');link.href=this.previewUrl;link.download=doc.original_filename;
  }
  project() {return this.projects.find(p=>p.id===this.projectId);}
  openProject(clientId) {
    const client=this.clients.find(item=>item.id===clientId);
    const clientField=client
      ? `<div class="context-entry"><small>CLIENTE DEL PROYECTO</small><strong>${escape(client.name)}</strong></div><input type="hidden" name="client" value="${client.id}">`
      : `<label class="field">Cliente del proyecto<select name="client" class="context-box" required><option value="" selected disabled>Elige un cliente guardado</option>${this.clients.map(item=>`<option value="${item.id}">${escape(item.name)}</option>`).join('')}</select></label>`;
    this.show('Nuevo proyecto',`<p class="cloud-notice">${client?'Crearás un proyecto nuevo para este cliente.':'Elige uno de tus clientes guardados y escribe el nombre del proyecto nuevo.'}</p><form data-cloud-form="project">${clientField}<label class="field">Nombre del nuevo proyecto<input name="name" class="context-box" required maxlength="200" placeholder="Por ejemplo: sitio web corporativo"></label><div class="dialog-actions"><button type="submit" class="button">Crear proyecto</button></div></form>`);
  }
  initialSources() {return this.documents.filter(doc=>doc.kind==='initial_agreement');}
  sourceReady(doc) {
    const extraction=Array.isArray(doc.document_extractions)?doc.document_extractions[0]:doc.document_extractions;
    return extraction?.status==='ready';
  }
  openSource(purpose) {
    if(this.loading || !this.project()) return;
    const initial=purpose!=='request';
    if(!initial&&this.requestStatus?.can_register!==true){this.message=this.requestStatus?.can_register===false?'Termina o cierra el pedido abierto de este proyecto antes de registrar otro.':'Estamos comprobando los pedidos del proyecto. Vuelve a intentar en unos momentos.';this.notify();return;}
    if(!initial && !this.initialSources().some(doc=>this.sourceReady(doc))) {this.tab='acuerdo'; this.notify(); return;}
    this.show(initial?'Añade lo conversado':'Registrar pedido del cliente',`<p class="cloud-notice">${initial?'Guarda correos, conversaciones o el contrato de este proyecto. Puedes añadir varios archivos y volver otro día, aunque no tengas un contrato formal.':'Sube la conversación donde tu cliente pide algo nuevo. Se guardará aparte de lo acordado inicialmente.'}</p><form data-cloud-form="upload"><input type="hidden" name="kind" value="${initial?'initial_agreement':'email_request'}"><label class="field">${initial?'¿Qué contiene este archivo?':'¿Qué te pidió el cliente?'}<input name="title" class="context-box" required maxlength="200" placeholder="${initial?'Ej.: conversación sobre alcance y precio':'Ej.: añadir una sección a la web'}"></label><label class="field">${initial?'Contrato o conversación en PDF o Word':'Conversación del pedido en PDF o Word'}<input name="file" class="context-box" type="file" accept=".pdf,.docx" required></label><p class="cloud-notice">PDF o Word (.docx), hasta 10 MB. Si es una conversación, expórtala a uno de estos formatos.</p><div class="dialog-actions"><button type="submit" class="button">${initial?'Guardar fuente del acuerdo':'Guardar pedido'} →</button></div></form>`);
  }
  sourceRows(sources) {
    return sources.map(doc=>`<article class="cloud-client-row"><div><strong>${escape(doc.title)}</strong><p class="cloud-client-meta">${this.sourceStatusLabel(doc)}</p></div><button class="text-button" data-cloud-action="${this.sourceReady(doc)?'text':'retry'}" data-cloud-id="${doc.id}" ${this.sourceProcessing(doc)?'disabled':''}>${this.sourceReady(doc)?'Ver documento ↗':this.sourceProcessing(doc)?'Procesando…':'Reintentar lectura'}</button></article>`).join('');
  }
  requestRows(requests) {
    return [...requests].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).map(doc=>`<article class="cloud-change-row" aria-label="Pedido ${escape(doc.title)}"><div class="cloud-change-info"><strong>${escape(doc.title)}</strong><time class="cloud-client-meta" datetime="${escape(doc.created_at)}">${escape(date(doc.created_at))}</time><div class="cloud-change-status"><span class="badge review" data-request-status>Pedido guardado</span><span class="cloud-change-version" data-request-version hidden></span></div></div><div class="cloud-change-action"><button class="button secondary" data-request-primary data-cloud-action="${this.sourceReady(doc)?'review-change':'retry'}" data-cloud-id="${escape(doc.id)}" ${this.sourceProcessing(doc)?'disabled':''}>${this.sourceReady(doc)?'Revisar cambio →':this.sourceProcessing(doc)?'Procesando…':'Reintentar lectura'}</button></div></article>`).join('');
  }
  renderAgreement(panel) {
    const sources=this.initialSources(), ready=sources.some(doc=>this.sourceReady(doc));
    const requests=this.documents.filter(doc=>doc.kind==='email_request');
    panel.innerHTML=`<section class="workspace-panel cloud-agreement"><div class="cloud-panel-heading"><div><span class="eyebrow">INFORMACIÓN INICIAL</span><h3>${sources.length?'Lo conversado al inicio':'Guarda lo que han conversado'}</h3></div><button class="button ${sources.length?'secondary':''}" data-cloud-action="upload" data-cloud-purpose="initial">Añadir información</button></div><p>${sources.length?'Las conversaciones y documentos que explican el acuerdo de este proyecto.':'Empieza con el contrato, los correos o los mensajes donde acordaron el trabajo. Puedes añadir información poco a poco y volver cuando quieras.'}</p>${sources.length?`<div class="cloud-source-list">${this.sourceRows(sources)}</div>`:'<div class="cloud-empty-sources"><strong>Todo empieza con lo que hablaron</strong><p>No necesitas un contrato formal. Una conversación también sirve como punto de partida.</p></div>'}<div class="cloud-tools cloud-flow-actions"><p class="cloud-notice">${ready?'Tus fuentes están guardadas. Tú eliges cuándo continuar.':'Guarda primero las fuentes para revisar lo acordado.'}</p><button class="button ${ready?'':'secondary'}" data-cloud-action="tab" data-cloud-tab="revision" ${ready?'':'disabled'}>Revisar lo acordado →</button></div></section>${ready || requests.length?`<section class="workspace-panel cloud-change-entry"><div class="cloud-panel-heading"><div><span class="eyebrow">CAMBIOS DEL PROYECTO</span><h3>${requests.length?'Pedidos nuevos del cliente':'¿Tu cliente pidió algo nuevo?'}</h3></div><button class="button secondary" data-cloud-action="upload" data-cloud-purpose="request" ${this.requestStatus?.can_register===true?'':'disabled'}>Registrar pedido del cliente</button></div>${this.requestStatus?.can_register===false?'<p class="cloud-notice">Termina o cierra el pedido abierto antes de registrar otro en este proyecto.</p>':''}${requests.length?this.requestRows(requests):'<p>Si después pide algo adicional, guárdalo aparte para revisarlo con su propia conversación de respaldo.</p>'}</section>`:''}`;
  }
  renderReview(panel) {
    panel.innerHTML=`<section class="workspace-panel cloud-agreement cloud-review"><span class="eyebrow">2 · REVISA LO CONVERSADO</span><h3>Revisa lo acordado</h3><p>Consulta las fuentes para revisar qué incluye el trabajo, el precio y las fechas que conversaste con tu cliente.</p><div class="cloud-agreement-checks"><span>Qué incluye el trabajo</span><span>Precio acordado</span><span>Fechas de entrega</span></div>${this.sourceRows(this.initialSources())}<div class="cloud-tools cloud-flow-actions"><button class="button secondary" data-cloud-action="tab" data-cloud-tab="acuerdo">← Volver al proyecto</button></div></section>`;
  }
  renderRequests(panel) {
    const requests=this.documents.filter(doc=>doc.kind==='email_request');
    panel.innerHTML=`<section class="workspace-panel cloud-requests"><button class="text-button" data-cloud-action="tab" data-cloud-tab="acuerdo">← Volver al proyecto</button><div class="cloud-panel-heading cloud-section-note"><div><span class="eyebrow">CAMBIOS DEL PROYECTO</span><h3>Cambios del acuerdo</h3><p>Revisa pedidos que modifican el trabajo, el precio o la fecha de entrega. Si el cliente pide recuperar un pago, ve a Devoluciones.</p></div><button class="button" data-cloud-action="upload" data-cloud-purpose="request" ${this.requestStatus?.can_register===true?'':'disabled'}>Registrar pedido del cliente</button></div>${this.requestStatus?.can_register===false?'<p class="cloud-notice">Termina o cierra el pedido abierto antes de registrar otro en este proyecto.</p>':''}${this.requestRows(requests) || '<div class="cloud-empty-sources"><strong>Aquí irán los nuevos pedidos</strong><p>Cuando tu cliente pida algo adicional, guarda la conversación para revisarla por separado.</p></div>'}</section>`;
  }
  renderRefunds(panel) {
    panel.innerHTML=`<section class="workspace-panel cloud-refunds" aria-label="Devoluciones del proyecto"><header class="cloud-refund-heading"><span class="cloud-refund-symbol" aria-hidden="true">${uiIcon('undo-2')}</span><div><span class="eyebrow">DEVOLUCIONES</span><h3>Revisar dinero que ya se pagó</h3><p>Cuando el cliente pide recuperar todo o parte de un pago, revisa el acuerdo, el trabajo realizado y el importe que corresponde proponer.</p></div></header><div class="cloud-refund-context"><strong>Una devolución parte de un pago recibido.</strong><p>Si el cliente pide más trabajo o una nueva fecha, corresponde a Cambios. Si pide dinero de vuelta, corresponde a Devoluciones. Una cancelación puede requerir revisar el cierre antes de decidir si hay dinero que devolver.</p></div><p class="cloud-notice" role="status">El registro de devoluciones reales todavía no está disponible. El pago original y sus documentos se conservan sin cambios.</p><div class="cloud-refund-trial"><button type="button" class="button" data-cloud-action="refund-preview">Probar flujo de devolución ${uiIcon('arrow-right')}</button><p class="cloud-notice">Recorre un caso de ejemplo separado, con fuentes del proyecto e información oficial de PayPal.</p></div></section>`;
  }
  projectNavigation(tab) {
    const selected=['solicitudes','comparar','gestion'].includes(tab)?'solicitudes':tab==='devoluciones'?'devoluciones':'acuerdo';
    const sections=[['acuerdo','file-text','Proyecto','Acuerdo y fuentes iniciales'],['solicitudes','git-compare-arrows','Cambios','Alcance, precio o plazo'],['devoluciones','undo-2','Devoluciones','Dinero de un pago recibido']];
    return `<nav class="cloud-project-navigation" aria-label="Secciones del proyecto">${sections.map(([id,icon,title,description])=>`<button type="button" data-cloud-action="tab" data-cloud-tab="${id}" aria-label="${title}: ${description}" ${selected===id?'aria-current="page"':''}>${uiIcon(icon)}<span><strong>${title}</strong><small>${description}</small></span></button>`).join('')}</nav>`;
  }
  async reviewChange(id) {
    const projectId=this.projectId, epoch=this.epoch;
    const request=this.documents.find(doc=>doc.id===id && doc.kind==='email_request');
    const sources=this.initialSources();
    if(!request || !this.sourceReady(request)) throw new Error('Primero reintenta la lectura del pedido para poder revisarlo.');
    if(!sources.length) throw new Error('Añade la información inicial del proyecto para comparar este pedido.');
    this.requestId=id;
    const comparison={id,projectId,request,sources:[],loading:true,returnTab:'solicitudes'};
    this.comparison=comparison; this.tab='comparar'; this.message=''; this.notify();
    const current=()=>epoch===this.epoch && projectId===this.projectId && this.comparison===comparison && this.tab==='comparar';
    try {
      const documents=[request,...sources], results=[];
      // Read bounded batches; original files remain private behind the user's JWT.
      for(let index=0;index<documents.length;index+=3) {
        const batch=await Promise.all(documents.slice(index,index+3).map(async doc=>{
          const data=await this.request(`/api/v1/documents/${doc.id}/extraction`);
          if(data.document.id!==doc.id || data.document.project_id!==projectId) throw new Error('La fuente recibida no corresponde a este proyecto.');
          return {...data,document:doc};
        }));
        if(!current()) return;
        results.push(...batch);
      }
      if(!current()) return;
      comparison.requestSource=results[0]; comparison.sources=results.slice(1);
    } catch(error) {if(!current()) return; comparison.error=error.message; throw error;}
    finally {if(current()) {comparison.loading=false; this.notify();}}
  }
  renderChangeReview(panel) {
    const comparison=this.comparison;
    if(!comparison || comparison.projectId!==this.projectId) {this.renderRequests(panel); return;}
    const source=data=>`<article class="cloud-comparison-source"><h4>${escape(data.document.title)}</h4>${data.segments.map(segment=>`<section><p class="cloud-client-meta">${segment.locator_kind==='page'?'Página':'Párrafo'} ${segment.locator_number}</p><p class="cloud-fragment">${escape(segment.text)}</p></section>`).join('') || '<p class="cloud-notice">Este archivo todavía no tiene texto para consultar. Puedes reintentar su lectura desde los archivos del proyecto.</p>'}<button class="text-button" data-cloud-action="download" data-cloud-id="${data.document.id}">Descargar original ↗</button></article>`;
    panel.innerHTML=`<section class="workspace-panel cloud-change-review"><button class="text-button" data-cloud-action="tab" data-cloud-tab="${comparison.returnTab||'solicitudes'}">← Volver a los pedidos</button><div class="cloud-section-note"><span class="eyebrow">REVISAR EL CAMBIO</span><h3>${escape(comparison.request.title)}</h3><p>Compara lo que habían conversado con lo que está pidiendo ahora. Revisa si cambia el trabajo incluido, el costo o las fechas.</p></div>${comparison.loading?this.renderSkeleton('project','Cargando fuentes del proyecto y del pedido…'):comparison.error?`<button class="button secondary" data-cloud-action="review-change" data-cloud-id="${comparison.id}">Volver a intentar</button>`:`<div class="cloud-comparison-grid"><section aria-label="Información inicial"><span class="eyebrow">LO CONVERSADO AL INICIO</span>${comparison.sources.map(source).join('')}</section><section aria-label="Pedido nuevo"><span class="eyebrow">LO QUE PIDE AHORA</span>${source(comparison.requestSource)}</section></div>`}</section>`;
  }
  renderSkeleton(kind='list',label='Cargando información…') {
    return `<div class="cloud-loading" role="status" aria-busy="true" aria-label="${escape(label)}"><span class="sr-only">${escape(label)}</span><div aria-hidden="true" class="cloud-skeleton ${kind==='project'?'cloud-skeleton-project':''}"><div class="cloud-skeleton-heading"><span class="cloud-skeleton-line cloud-skeleton-title"></span><span class="cloud-skeleton-line cloud-skeleton-subtitle"></span></div>${[0,1,2].map(()=>`<div class="cloud-skeleton-row"><span class="cloud-skeleton-avatar"></span><div><span class="cloud-skeleton-line"></span><span class="cloud-skeleton-line cloud-skeleton-detail"></span></div><span class="cloud-skeleton-action"></span></div>`).join('')}</div></div>`;
  }
  renderClients() {
    return `<section class="workspace-panel cloud-client-directory" aria-label="Tus clientes"><div class="library-header"><div><span class="eyebrow">TU ESTUDIO</span><h3>Tus clientes</h3><p class="cloud-directory-intro">Abre un cliente para ver sus proyectos y trabajar en ellos.</p></div><button class="text-button" data-cloud-action="refresh">Actualizar ↻</button></div><div class="cloud-directory-list">${this.clients.map(client=>{
      const count=this.projects.filter(project=>project.client_id===client.id).length;
      return `<article class="cloud-client-row"><div><strong>${escape(client.name)}</strong><p class="cloud-client-meta">${client.contact_email?escape(client.contact_email)+' · ':''}${this.projectsLoaded?(count?`${count} ${count===1?'proyecto':'proyectos'}`:'Sin proyectos todavía'):'Ver proyectos'}</p></div><div class="cloud-client-actions"><button class="cloud-icon-button cloud-delete-client" data-cloud-action="client-delete" data-cloud-id="${client.id}" aria-label="Eliminar cliente ${escape(client.name)}" title="Eliminar cliente ${escape(client.name)}">${uiIcon('trash-2')}</button><button class="button secondary" data-cloud-action="client-open" data-cloud-id="${client.id}" aria-label="Abrir cliente ${escape(client.name)}">Abrir cliente ↗</button></div></article>`;
    }).join('') || '<p class="cloud-section-note">Todavía no tienes clientes. Usa Nuevo cliente junto al título para guardar el primero.</p>'}</div></section>`;
  }
  renderWorkspace(workspace) {
    if(this.state==='loading' || this.directoryLoading){workspace.innerHTML=`<section class="workspace-panel cloud-initial-loading"><h2 class="sr-only">Recuperando tu espacio…</h2>${this.renderSkeleton('list',this.active?'Actualizando clientes y proyectos…':'Cargando clientes y proyectos…')}</section>`;return;}
    if(!this.active) {
      workspace.innerHTML=`<section class="workspace-panel" aria-label="Acceso a tu espacio"><h2>${this.state==='loading'?'Recuperando tu espacio…':this.state==='error'?'Volvamos a conectar':'Tu espacio empieza aquí'}</h2><p role="status">${escape(this.message || (this.state==='loading'?'Estamos recuperando tus clientes y proyectos.':'Inicia sesión para ver tus clientes y continuar con tus proyectos.'))}</p>${this.state==='loading'?'':`<button class="button" data-cloud-action="${this.state==='error'?'reconnect':'access'}">${this.state==='error'?'Volver a intentar':'Iniciar sesión o crear cuenta'}</button>`}</section>`; return;
    }
    const client=this.clients.find(c=>c.id===this.clientId), project=this.project();
    if(!client) {workspace.innerHTML=this.renderClients()+`<p class="cloud-notice" role="status">${escape(this.message)}</p>`; return;}
    const projects=this.projects.filter(p=>p.client_id===client.id);
    const toolbar=`<div class="cloud-breadcrumb"><button class="text-button" data-cloud-action="clients">← Todos los clientes</button>${project?'<span>/</span><button class="text-button" data-cloud-action="projects">Proyectos del cliente</button>':''}</div>${project?'':`<section class="workspace-panel cloud-client-header" aria-label="Cliente seleccionado"><div><span class="eyebrow">CLIENTE</span><h2>${escape(client.name)}</h2><p class="cloud-client-meta">${escape(client.contact_email || '')}${client.contact_email?' · ':''}${projects.length} ${projects.length===1?'proyecto':'proyectos'}</p></div><button class="button" data-cloud-action="project" data-cloud-id="${client.id}">＋ Nuevo proyecto</button></section>`}`;
    if(!project) {
      workspace.innerHTML=toolbar+`<section class="workspace-panel cloud-project-directory" aria-label="Proyectos del cliente"><span class="eyebrow">ESPACIO DE TRABAJO</span><h3>Proyectos de ${escape(client.name)}</h3>${this.projectsLoading?this.renderSkeleton('list','Cargando proyectos…'):projects.map(p=>`<article class="cloud-client-row"><div><strong>${escape(p.name)}</strong><p class="cloud-client-meta">Documentos, solicitudes e historial de este proyecto</p></div><button class="button secondary" data-cloud-action="project-open" data-cloud-id="${p.id}" aria-label="Abrir proyecto ${escape(p.name)}">Abrir proyecto ↗</button></article>`).join('') || '<p>Este cliente todavía no tiene proyectos. Crea su primer proyecto para incorporar el acuerdo y los documentos.</p>'}</section><p class="cloud-notice" role="status">${escape(this.message)}</p>`; return;
    }
    const tab=this.tab;
    workspace.innerHTML=toolbar+`<div class="cloud-project-picker" ${projects.length<2?'hidden':''}><label class="field" for="cloud-picker">Proyecto</label><select id="cloud-picker" class="context-box" data-cloud-project>${projects.map(p=>`<option value="${p.id}" ${p.id===this.projectId?'selected':''}>${escape(p.name)}</option>`).join('')}</select></div><div class="client-banner"><span class="client-avatar">${escape((client?.name || '').slice(0,2).toUpperCase())}</span><div><span class="eyebrow">PROYECTO</span><h2>${escape(project.name)}</h2><p>${escape(client.name)}</p></div></div>${this.projectNavigation(tab)}${['solicitudes','comparar','gestion','devoluciones'].includes(tab)?'':`<ol class="cloud-setup-path" aria-label="Preparar el proyecto"><li ${tab==='acuerdo'?'aria-current="step"':''}><span>1</span> Reúne lo conversado</li><li ${tab==='revision'?'aria-current="step"':''}><span>2</span> Revisa cuando quieras</li></ol>`}<p class="cloud-notice" role="status">${escape(this.message)}</p><div id="client-panel"></div><details class="cloud-project-resources" data-cloud-resource="files" ${this.resourceOpen.files?'open':''} ${this.loading?'hidden':''}><summary>Archivos del proyecto · ${this.documents.length}</summary><div data-cloud-files></div></details><details class="cloud-project-resources" data-cloud-resource="history" ${this.resourceOpen.history?'open':''} ${this.loading?'hidden':''}><summary>Seguimiento del proyecto</summary><div class="cloud-tracking-heading"><div><h3>Historial</h3><p>Pedidos, acuerdos y pagos de este proyecto.</p></div><button type="button" class="button secondary" data-cloud-action="graph-preview" title="Ver el diseño del mapa con un proyecto de ejemplo">${uiIcon('git-compare-arrows')} Ver mapa · vista previa</button></div><div data-cloud-history></div></details>`;
    const panel=workspace.querySelector('#client-panel');
    if(this.loading) {panel.innerHTML=`<section class="workspace-panel">${this.renderSkeleton('project','Cargando información del proyecto…')}</section>`; return;}
    if(tab==='gestion') this.renderChangeManagement(panel);
    else if(tab==='comparar') this.renderChangeReview(panel);
    else if(tab==='revision') this.renderReview(panel);
    else if(tab==='solicitudes') this.renderRequests(panel);
    else if(tab==='devoluciones') this.renderRefunds(panel);
    else this.renderAgreement(panel);
    if(this.resourceOpen.files)this.renderDocuments(workspace.querySelector('[data-cloud-files]'));
    if(this.resourceOpen.history)this.loadHistory();
  }
  renderHistory(panel) {
    const icons={request_registered:'file-text',adenda_sent:'send',acceptance_recorded:'file-text',payment_requested:'mail',payment_completed:'credit-card',request_closed:'x'};
    const activity=[...this.projectActivity].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
    const groups=new Map();
    for(const event of activity){
      if(!groups.has(event.request_document_id))groups.set(event.request_document_id,{title:event.request_title,events:[]});
      groups.get(event.request_document_id).events.push(event);
    }
    const content=[...groups.values()].map((group,index)=>`<details class="cloud-history-request" ${index===0?'open':''}><summary><span class="cloud-history-chevron" aria-hidden="true">${uiIcon('chevron-right')}</span><span class="cloud-history-request-title">${escape(group.title)}<small>${group.events.length} ${group.events.length===1?'movimiento':'movimientos'}</small></span><time datetime="${escape(group.events[0].created_at)}">${escape(date(group.events[0].created_at))}</time></summary><ol class="cloud-project-timeline">${group.events.map(event=>`<li class="cloud-project-event" data-activity-kind="${escape(event.kind)}"><span class="cloud-project-event-icon" aria-hidden="true">${uiIcon(icons[event.kind])}</span><div><strong>${escape(event.title)}</strong></div><time datetime="${escape(event.created_at)}">${escape(date(event.created_at))}</time></li>`).join('')}</ol></details>`).join('');
    panel.innerHTML=`<div class="workspace-panel cloud-project-activity"><div class="cloud-activity-heading"><span>Movimientos por pedido</span><span>Más recientes primero</span></div>${content?`<div class="cloud-history-groups">${content}</div>`:'<p class="cloud-notice">Los pedidos, envíos, aceptaciones y pagos aparecerán aquí.</p>'}</div>`;
  }


  renderDocuments(panel) {
    const groups=[['initial_agreement','Fuentes del acuerdo inicial'],['email_request','Solicitudes de cambio'],['addendum','Adendas y aceptaciones'],['delivery','Entregas'],['reference','Documentos de referencia']];
    const row=doc=>{
      const extraction=Array.isArray(doc.document_extractions)?doc.document_extractions[0]:doc.document_extractions;
      return `<div class="cloud-document-row"><button type="button" class="document-button" data-cloud-action="text" data-cloud-id="${escape(doc.id)}" title="Ver ${escape(doc.title)}"><span class="cloud-document-file-icon" aria-hidden="true">${uiIcon('file-text')}</span><span class="cloud-document-file"><strong>${escape(doc.title)}</strong><small>${doc.mime_type==='application/pdf'?'PDF':'Word'} · ${escape(date(doc.created_at))}</small>${extraction?.status!=='ready'?`<span class="cloud-document-read-status" data-document-status>${extraction?.status==='error'?'Lectura pendiente':'Pendiente de lectura'}</span>`:''}</span></button><div class="cloud-document-actions"><button class="cloud-icon-button" data-cloud-action="download" data-cloud-id="${escape(doc.id)}" aria-label="Descargar original ${escape(doc.title)}" title="Descargar original">${uiIcon('download')}</button>${extraction?.status!=='ready'?`<button class="cloud-icon-button" data-cloud-action="retry" data-cloud-id="${escape(doc.id)}" aria-label="Reintentar lectura de ${escape(doc.title)}" title="Reintentar lectura">${uiIcon('refresh-cw')}</button>`:''}</div></div>`;
    };
    const sections=groups.map(([kind,title])=>({kind,title,docs:this.documents.filter(doc=>doc.kind===kind).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))})).filter(group=>group.docs.length);
    sections.sort((a,b)=>new Date(b.docs[0].created_at)-new Date(a.docs[0].created_at));
    const content=sections.map(({kind,title,docs})=>`<details class="cloud-document-group" data-document-kind="${kind}" open><summary><span class="cloud-document-chevron" aria-hidden="true">${uiIcon('chevron-right')}</span><span>${title}</span><span class="cloud-document-count">${docs.length}</span></summary><div class="document-list">${docs.map(row).join('')}</div></details>`).join('');
    panel.innerHTML=`<div class="knowledge-layout document-library"><div class="workspace-panel"><div class="library-header"><div><span class="eyebrow">BASE DE CONOCIMIENTO</span><h3>Documentos del proyecto</h3></div></div><div class="cloud-library-meta"><span>${this.documents.length} ${this.documents.length===1?'archivo':'archivos'}</span><span>Más recientes primero</span></div><div class="cloud-doc-groups">${content || '<p class="cloud-section-note">Los archivos que añadas al proyecto aparecerán aquí.</p>'}</div></div></div>`;
  }

  renderRows(view) {
    const rows=this.active && view==='inicio'?this.projects:[];
    this.$('#project-rows').innerHTML=rows.map(p=>`<tr><td><div class="project-cell"><div><strong>${escape(p.name)}</strong><small>${escape(this.clients.find(c=>c.id===p.client_id)?.name)}</small></div></div></td><td>Proyecto</td><td>Por definir</td><td><span class="badge review">Guardado</span></td><td><button class="row-button" data-cloud-action="project-open" data-cloud-id="${p.id}" aria-label="Abrir proyecto">↗</button></td></tr>`).join('');
    this.$('#table-title').textContent=view==='inicio'?'Proyectos de tu espacio':'Solicitudes de tu espacio';
    this.$('#empty').hidden=rows.length>0; this.$('#empty').textContent=view==='inicio'?'Crea tu primer proyecto desde Clientes.':'Consulta los pedidos y sus documentos desde el proyecto, en Clientes.';
  }
  syncChrome() {
    if(!this.profile) return;
    const active=this.active, connected=this.handlesView;
    this.document.documentElement.classList.remove('trato-starting');
    if(!this.clientButton) {
      const title=this.$('#page-title'), row=this.document.createElement('div'); row.className='cloud-title-row';
      title.before(row); row.append(title);
      this.clientButton=this.document.createElement('button'); this.clientButton.className='button';
      this.clientButton.type='button'; this.clientButton.dataset.cloudAction='client'; this.clientButton.textContent='＋ Nuevo cliente';
      row.append(this.clientButton);
    }
    const workspaceView=['#clientes','#conversaciones','#kb'].includes(this.location.hash);
    this.document.body.classList.toggle('cloud-design',connected);
    this.document.body.classList.toggle('cloud-project-view',connected&&active&&workspaceView&&!!this.project());
    this.document.body.classList.toggle('cloud-client-view',connected&&active&&workspaceView&&!!this.clientId);
    this.clientButton.hidden=!active || !workspaceView || !!this.clientId;
    if(active && workspaceView) {this.$('#page-title').textContent=this.project()?.name || (this.clientId?this.clients.find(c=>c.id===this.clientId)?.name:'Clientes');this.$('#page-description').textContent=this.project()?'Tu información inicial y los nuevos pedidos, en el mismo espacio.':this.clientId?'Los proyectos y acuerdos de este cliente.':'Cada cliente tiene sus proyectos. Elige uno para entrar a su espacio de trabajo.';}
    this.profile.textContent=active?(this.session.session.user.email || this.profileInitials).slice(0,2).toUpperCase():this.profileInitials;
    this.profile.setAttribute('aria-label',active?'Mi perfil · sesión iniciada':'Mi perfil · iniciar sesión'); this.profile.title=active?'Tu perfil':'Iniciar sesión';
    this.$('.top-actions .demo-pill').innerHTML=active?'<i></i>Espacio conectado':connected?`<i></i>${this.state==='loading'?'Conectando…':'Tu espacio'}`:this.badgeHTML;
    for(const selector of ['#general-assistant-toggle','#tour','#reset','.change-page-intro']) this.$(selector).hidden=connected;
    if(connected) {
      for(const selector of ['.stats','#hero','#flow-section','#assistant-entry','#general-assistant']) this.$(selector).hidden=true;
      this.document.querySelectorAll('[data-view] .count').forEach(node=>{node.textContent='0';});
      if(!active) {
        this.$('.activity').hidden=true;
        this.$('#client-workspace').hidden=false; this.renderWorkspace(this.$('#client-workspace'));
        this.$('#page-title').textContent='Tu espacio en Trato';
        this.$('#page-description').textContent='Tus clientes, proyectos y acuerdos en un solo lugar.';
      }
    } else this.$('#empty').textContent=this.emptyText;
    this.$('.footer span:last-child').textContent=connected?'Tu estudio · Clientes, proyectos y acuerdos':this.footerText;
  }
}

export const createConnectedWorkspace = options => new ConnectedWorkspace(options);
