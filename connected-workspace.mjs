import {uiText,uiLocale} from './i18n.mjs';
import {icon as uiIcon} from './icons.mjs';
import {SessionClient, apiRequest} from './auth-session.mjs';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
const labels = {queued:uiText("Pendiente de lectura"),ready:uiText("Texto guardado"),error:uiText("Lectura pendiente de reintento")};
const kinds = {reference:uiText("Referencia"),initial_agreement:uiText("Fuente del acuerdo inicial"),email_request:uiText("Pedido del cliente"),addendum:uiText("Adenda · por verificar"),delivery:uiText("Entrega")};
const date = value => !value || !Number.isFinite(new Date(value).getTime()) ? uiText("Fecha no registrada") : new Intl.DateTimeFormat(uiLocale(),{dateStyle:'medium',timeStyle:'short',timeZone:'America/Lima'}).format(new Date(value));

export class ConnectedWorkspace {
  constructor({document:doc=globalThis.document, location=globalThis.location, fetchFn=globalThis.fetch.bind(globalThis), storage=globalThis.sessionStorage}={}) {
    this.document=doc; this.location=location; this.fetch=fetchFn; this.storage=storage;
    this.active=false; this.state='loading'; this.clients=[]; this.projects=[]; this.documents=[]; this.events=[]; this.projectActivity=[];
    this.clientId=''; this.projectId=''; this.tab='acuerdo'; this.comparison=null; this.requestId=''; this.epoch=0; this.busy=false; this.loading=false; this.directoryLoading=false; this.message='';
    this.historyView='history';this.projectMapGeneration=0;this.resourceOpen={files:false,history:false};this.historyGeneration=0;this.historyLoaded=false;this.historyPending=null;
    this.projectsLoaded=false;this.projectsLoading=false;this.projectClientsLoaded=new Set();this.projectsPending=new Map();
    this.base=location.origin; this.demoMode=new URLSearchParams(location.search || '').get('demo')==='1';
  }
  get handlesView() {return !this.demoMode || this.active;}
  $(selector) {return this.document.querySelector(selector);}
  navigationKey() {
    return this.navigationOwner&&this.session?.key?`${this.session.key}:navigation:${this.navigationOwner}`:null;
  }
  clearNavigation() {
    try {if(this.navigationKey())this.storage.removeItem(this.navigationKey());}catch {}
  }
  readNavigation() {
    try {
      const value=JSON.parse(this.storage.getItem(this.navigationKey())||'null');
      const id=value=>typeof value==='string'&&/^[a-zA-Z0-9-]{1,80}$/.test(value);
      if(value?.version!==1||!['acuerdo','solicitudes','devoluciones','documentos','historial','gestion','comparar'].includes(value.tab))return null;
      if([value.clientId,value.projectId,value.requestId,value.revisionId].some(value=>value!==''&&!id(value)))return null;
      return {...value,historyView:value.historyView==='map'?'map':'history'};
    } catch {return null;}
  }
  saveNavigation() {
    if(this.location.hash==='#ensayos')return;
    if(!this.active||!this.session?.session||this.state!=='ready'||this.restoringNavigation||this.loading||!this.navigationKey())return;
    const clientId=this.clients.some(c=>c.id===this.clientId)?this.clientId:'';
    const projectId=clientId&&this.projects.some(p=>p.id===this.projectId&&p.client_id===clientId)?this.projectId:'';
    const requestId=projectId&&this.documents.some(d=>d.id===this.requestId&&d.kind==='email_request')?this.requestId:'';
    const details=this.proposalDetails?.proposal?.request_document_id===requestId?this.proposalDetails:null;
    const revisionId=this.tab==='gestion'&&requestId?(details?.revision?.id||this.proposalRetryRevision||''):'';
    const tab=['acuerdo','solicitudes','devoluciones','documentos','historial','gestion','comparar'].includes(this.tab)?this.tab:'acuerdo';
    try {this.storage.setItem(this.navigationKey(),JSON.stringify({version:1,clientId,projectId,tab,requestId,revisionId,historyView:this.historyView==='map'?'map':'history'}));} catch { /* Navigation storage is optional; business operations are unaffected. */ }
  }
  async restoreProjectNavigation(nav) {
    if(!nav||!this.projectId||nav.projectId!==this.projectId)return;
    if(!['gestion','comparar'].includes(nav.tab))return;
    const doc=this.documents.find(d=>d.id===nav.requestId&&d.kind==='email_request');
    if(!doc){this.tab='solicitudes';this.requestId='';this.message=uiText("El pedido que estabas viendo ya no está disponible.");return;}
    this.requestId=doc.id;
    try {
      if(nav.tab==='gestion') {
        if(!this.proposals?.some(p=>p.request_document_id===doc.id)){this.tab='solicitudes';this.message=uiText("La propuesta que estabas viendo ya no está disponible.");return;}
        await this.restoreProposalNavigation(doc.id,nav.revisionId||undefined);
      } else await this.reviewChange(doc.id);
    } catch(error) {if(!error.uiHandled)this.message=error.message;}
  }
  async connect() {
    const response=await this.fetch('/api/v1/config',{signal:AbortSignal.timeout(15000),cache:'no-store'});
    if(!response.ok) throw new Error(uiText("No pudimos conectar con tu espacio. Vuelve a intentar en unos momentos."));
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
    this.practiceContext=null;
    this.clearNavigation();
    this.navigationOwner='';this.restoringNavigation=false;
    this.stopIngestionPolling();
    this.releaseProjectMap();
    this.historyGeneration++;this.historyLoaded=false;this.historyPending=null;this.resourceOpen={files:false,history:false};this.projectsLoaded=false;this.projectsLoading=false;this.projectClientsLoaded=new Set();this.projectsPending=new Map();
    this.epoch++; this.active=false; this.state='anonymous'; this.clients=[]; this.projects=[]; this.documents=[]; this.events=[]; this.projectActivity=[];
    this.clientId=''; this.projectId=''; this.tab='acuerdo'; this.comparison=null; this.requestId=''; this.uploadCommand=null; this.message=''; this.loading=false; this.directoryLoading=false;
  }
  attach(notify) {
    this.notify=(...args)=>{this.saveNavigation();notify(...args);};
    const avatar=this.$('.top-actions .avatar.small');
    this.profile=this.document.createElement('button'); this.profile.type='button'; this.profile.className='avatar small cloud-profile';
    this.profileInitials=avatar.textContent; this.profile.textContent=this.profileInitials; this.profile.setAttribute('aria-label',uiText("Mi perfil · iniciar sesión"));
    avatar.replaceWith(this.profile); this.profile.addEventListener('click',()=>this.openAccount());
    this.modal=this.document.createElement('dialog'); this.modal.className='cloud-dialog';
    this.modal.setAttribute('aria-labelledby','cloud-dialog-title'); this.document.body.append(this.modal);
    this.modal.addEventListener('click',event=>{if(event.target.closest('[data-cloud-close]')) this.modal.close();});
    this.modal.addEventListener('submit',event=>{event.preventDefault(); this.submit(event);});
    this.modal.addEventListener('close',()=>{if(!this.modal.open){this.releasePreview();this.modal.replaceChildren();}});
    this.document.addEventListener('click',event=>this.click(event));
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
      if(this.session.session) await this.load({restoreNavigation:true});
      else {this.state='anonymous'; this.notify();}
    } catch {
      this.state=this.session && !this.session.session?'anonymous':'error';
      this.message=this.state==='anonymous'?uiText("Inicia sesión para volver a tu espacio."):uiText("No pudimos recuperar tu espacio. Vuelve a intentar.");
      this.notify();
    }
  }
  async load({restoreNavigation=false}={}) {
    const epoch=++this.epoch;this.restoringNavigation=true;
    this.directoryLoading=true;this.notify();
    try {
      const [session,clients]=await Promise.all([this.request('/api/v1/session'),this.request('/api/v1/clients')]);
      if(epoch!==this.epoch) return;
      if(typeof session.user_id!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(session.user_id))throw new Error(uiText("No pudimos verificar tu sesión."));
      this.navigationOwner=session.user_id;
      const nav=restoreNavigation&&this.location.hash!=='#ensayos'?this.readNavigation():null;
      if(nav){this.clientId=nav.clientId;this.projectId=nav.projectId;this.tab=['gestion','comparar'].includes(nav.tab)?'solicitudes':nav.tab;this.requestId='';this.historyView=nav.historyView;}
      this.directoryLoading=false;
      this.clients=clients;this.projects=[];this.projectsLoaded=false;this.projectClientsLoaded=new Set();this.projectsPending=new Map();this.active=true; this.state='ready';
      if(!clients.some(item=>item.id===this.clientId)) this.clientId='';
      if(this.clientId)await this.loadProjects();
      if(!this.projects.some(item=>item.id===this.projectId && item.client_id===this.clientId)) this.projectId='';
      this.documents=[]; this.events=[]; this.projectActivity=[]; this.loading=!!this.projectId;
      this.notify(); await this.loadProject();
      if(epoch===this.epoch)await this.restoreProjectNavigation(nav);
    } catch(error) {
      if(epoch===this.epoch){this.active=false;this.state='error';}
      throw error;
    } finally {if(epoch===this.epoch){this.restoringNavigation=false;this.directoryLoading=false;this.notify();}}
  }
  async loadProjects() {
    const clientId=this.clientId,epoch=this.epoch;
    if(!clientId||this.projectClientsLoaded.has(clientId))return;
    if(this.projectsPending.has(clientId))return this.projectsPending.get(clientId);
    this.projectsLoading=true;this.notify();
    const pending=(async()=>{
      try{
        const projects=await this.request(`/api/v1/projects?client_id=${encodeURIComponent(clientId)}`);
        if(epoch!==this.epoch)return;
        this.projects=[...this.projects.filter(project=>project.client_id!==clientId),...projects.filter(project=>project.client_id===clientId)];
        this.projectClientsLoaded.add(clientId);this.projectsLoaded=true;
      }finally{if(epoch===this.epoch&&this.clientId===clientId){this.projectsLoading=false;this.notify();}}
    })();
    this.projectsPending.set(clientId,pending);
    try{await pending;}finally{if(this.projectsPending.get(clientId)===pending)this.projectsPending.delete(clientId);}
  }
  async loadProject() {
    this.stopIngestionPolling();
    this.releaseProjectMap();
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
    panel.innerHTML=("<p class=\"cloud-notice\" role=\"status\">"+uiText("Cargando historial…")+"</p>");
    const current=()=>this.active&&id===this.projectId&&epoch===this.epoch&&generation===this.historyGeneration;
    this.historyPending=(async()=>{
      try{
        const activity=await this.request(`/api/v1/projects/${id}/activity`);
        if(!current())return;
        this.projectActivity=activity;this.historyLoaded=true;
        const target=this.$('[data-cloud-history]');if(target)this.renderHistory(target);
      }catch(error){
        if(current()){const target=this.$('[data-cloud-history]');if(target)target.innerHTML=`<p class="cloud-error" role="alert">${escape(error.message)}</p><p class="cloud-notice">${uiText("Vuelve a abrir Historial para reintentar.")}</p>`;}
      }finally{if(current())this.historyPending=null;}
    })();
    return this.historyPending;
  }
  extractionState(doc) {return Array.isArray(doc.document_extractions)?doc.document_extractions[0]:doc.document_extractions;}
  sourceStatusLabel(doc) {
    const extraction=this.extractionState(doc),thread=extraction?.worker_threads;
    const phase=Array.isArray(thread)?thread[0]?.phase:thread?.phase;
    if(extraction?.status==='queued'&&phase) return {queued:uiText("En cola"),reading_original:uiText("Preparando documento"),extracting_text:uiText("Leyendo documento")}[phase]||labels.queued;
    return labels[extraction?.status]||uiText("Preparando lectura");
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
      if(error.uiHandled)return; // The view already displays this failure with its retry action.
      const message=error.name==='TimeoutError' ? uiText("La operación tardó demasiado. Actualiza antes de reintentar.") : error.message;
      if(this.modal.open) {this.modal.querySelector('[data-cloud-error]').textContent=message;}
      else {this.message=message; this.notify();}
    } finally {this.busy=false; this.modal.querySelectorAll('button[type="submit"]').forEach(button=>{button.disabled=false;});}
  }
  show(title,html) {
    this.releasePreview();
    this.modal.classList.remove('cloud-profile-dialog','cloud-auth-dialog','cloud-document-preview','cloud-mail-dialog');
    if(this.modal.open) this.modal.close();
    this.modal.innerHTML=`<div class="upload-modal-header"><div><span class="eyebrow">${uiText("TU ESPACIO EN TRATO")}</span><h2 id="cloud-dialog-title">${escape(title)}</h2></div><button type="button" class="close" data-cloud-close aria-label="${uiText("Cerrar")}" title="${uiText("Cerrar")}">${uiIcon('x')}</button></div>${html}<p class="cloud-error" data-cloud-error role="alert"></p>`;
    this.modal.showModal();
  }
  openAccount() {
    if(this.active) {
      const email=this.session.session.user.email || uiText("Sesión iniciada");
      this.show(uiText("Tu perfil"),`<section class="cloud-identity" aria-label="${uiText("Cuenta de Trato")}"><span class="cloud-account-avatar" aria-hidden="true">${escape(email.slice(0,2).toUpperCase())}</span><div><span class="cloud-account-label">${uiText("Cuenta de Trato")}</span><strong>${escape(email)}</strong></div></section><section class="cloud-account-connections" aria-label="${uiText("Conexiones")}"><header><h3>${uiText("Conexiones")}</h3><p>${uiText("Tu correo y tus cobros, en un solo lugar.")}</p></header><div class="cloud-integrations"></div></section><form data-cloud-form="logout" class="cloud-account-footer"><button class="text-button" type="submit">${uiText("Cerrar sesión")}</button></form>`);
      this.modal.classList.add('cloud-profile-dialog');
    } else {
      this.show(uiText("Accede a tu estudio"),`<form data-cloud-form="auth"><label class="field" for="cloud-email">${uiText("Correo")}</label><input class="context-box" id="cloud-email" name="email" type="email" autocomplete="username" required><label class="field" for="cloud-password">${uiText("Contraseña")}</label><input class="context-box" id="cloud-password" name="password" type="password" minlength="8" autocomplete="current-password" required><div class="dialog-actions"><button type="submit" class="button" value="login">${uiText("Iniciar sesión")}</button><button type="submit" class="button secondary" value="signup">${uiText("Crear cuenta")}</button></div></form>`);
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
        if(!ready) {this.modal.querySelector('[data-cloud-error]').textContent=uiText("Revisa tu correo y confirma la cuenta. Después vuelve a iniciar sesión desde tu perfil."); return;}
        await this.load(); this.modal.close(); this.location.hash='clientes';
      } else if(kind==='logout') {
        this.epoch++; this.clearNavigation(); await this.session.logout(); this.reset(); this.modal.close(); this.notify();
      } else if(kind==='client') {
        const client=await this.request('/api/v1/clients',this.json({name:values.get('name'),contact_email:values.get('email')?.trim() || null}));
        this.clients=[client,...this.clients.filter(item=>item.id!==client.id)];this.projectClientsLoaded.add(client.id);this.clientId=client.id;this.projectId='';this.modal.close();await this.loadProject();this.message=uiText("Cliente guardado.");this.notify();
      } else if(kind==='client-delete') {
        const id=form.dataset.clientId;
        await this.request(`/api/v1/clients/${id}/delete`,{method:'POST'});
        if(this.clientId===id){this.clientId='';this.projectId='';this.documents=[];this.events=[];this.comparison=null;this.requestId='';}
        this.clients=this.clients.filter(client=>client.id!==id);this.projectClientsLoaded.delete(id);this.projects=this.projects.filter(project=>project.client_id!==id);this.modal.close();await this.loadProject();this.message=uiText("Cliente eliminado de tu espacio.");this.notify();
      } else if(kind==='project') {
        const project=await this.request('/api/v1/projects',this.json({client_id:values.get('client'),name:values.get('name')}));
        this.projects=[project,...this.projects.filter(item=>item.id!==project.id)];this.clientId=project.client_id;this.projectId=project.id;this.tab='acuerdo';this.modal.close();await this.loadProject();
      } else if(kind==='upload') {
        const id=this.projectId, epoch=this.epoch, file=values.get('file');
        if(!file?.size || file.size>10485760) throw new Error(uiText("Selecciona un PDF o DOCX de hasta 10 MB."));
        const metadata={filename:file.name,title:values.get('title'),kind:values.get('kind')};
        const command=JSON.stringify([id,metadata,file.size,file.lastModified]);
        if(this.uploadCommand?.command!==command) this.uploadCommand={command,key:crypto.randomUUID()};
        const mime=file.name.toLowerCase().endsWith('.docx')?'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'application/pdf';
        try {
          await this.request(`/api/v1/projects/${id}/documents?${new URLSearchParams(metadata)}`,{method:'POST',body:file,headers:{'Content-Type':mime,'Idempotency-Key':this.uploadCommand.key}});
        } catch(error) {await this.loadProject(); throw error;}
        if(epoch!==this.epoch || id!==this.projectId) return;
        this.uploadCommand=null; this.comparison=null; this.tab=metadata.kind==='initial_agreement'?'acuerdo':'solicitudes'; this.modal.close(); await this.loadProject();
        this.message=metadata.kind==='initial_agreement'?uiText("Archivo guardado."):uiText("Pedido guardado."); this.notify();
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
    if(action==='client') this.show(uiText("Nuevo cliente"),`<form data-cloud-form="client"><label class="field">${uiText("Nombre")}<input name="name" class="context-box" required maxlength="200"></label><label class="field">${uiText("Correo de contacto")}<input name="email" class="context-box" type="email" maxlength="254"></label><div class="dialog-actions"><button type="submit" class="button">${uiText("Guardar cliente")}</button></div></form>`);
    if(action==='client-delete'){const client=this.clients.find(c=>c.id===id);if(client)this.show(uiText("Eliminar cliente"),`<p>${uiText("Eliminarás a")} <strong>${escape(client.name)}</strong> de tu espacio junto con sus proyectos y documentos.</p><p>${uiText("Conservaremos los registros mediante borrado lógico para permitir su recuperación.")}</p><form data-cloud-form="client-delete" data-client-id="${escape(client.id)}"><div class="dialog-actions"><button class="button cloud-delete-confirm" type="submit">${uiIcon('trash-2')}${uiText("Eliminar cliente")}</button><button class="button secondary" type="button" data-cloud-close>${uiText("Cancelar")}</button></div></form>`);}
    if(action==='project') this.openProject(id);
    if(action==='upload') this.openSource(target.dataset.cloudPurpose);
    if(action==='graph-preview'){this.historyView='map';this.tab='historial';this.notify();}
    if(action==='history-view'){this.historyView='history';this.notify();}
    if(action==='refund-preview') this.run(async()=>{const {openRefundPreview}=await import('./refund-preview.mjs');await openRefundPreview({returnFocus:target});});
    if(action==='review-change') this.run(()=>this.reviewChange(id));
    if(action==='tab') {
      const next=target.dataset.cloudTab;
      if(this.loading || (this.busy && !['acuerdo','solicitudes'].includes(next))) return;
      if(next==='revision' && !this.initialSources().some(doc=>this.sourceReady(doc))) return;
      if(this.tab==='historial'&&next!=='historial')this.releaseProjectMap();
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
      this.releaseProjectMap();this.historyView='history';
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
    if(!doc) throw new Error(uiText("Actualiza el proyecto para abrir este documento."));
    if(doc.mime_type!=='application/pdf'){
      this.show(doc.title,`<p>${uiText("La vista previa está disponible para PDF. Este documento de Word puede descargarse para abrirlo.")}</p><button class="button secondary" data-cloud-action="download" data-cloud-id="${escape(id)}">${uiText("Descargar original ↗")}</button>`);
      return;
    }
    const blob=await this.request(`/api/v1/documents/${id}/file`,{},true);
    if(project!==this.projectId || epoch!==this.epoch) return;
    if(blob.type.split(';')[0]!=='application/pdf') throw new Error(uiText("El servidor no devolvió un documento PDF."));
    this.show(doc.title,`<div class="cloud-preview-toolbar"><span>${escape(doc.original_filename)}</span><a class="text-button" data-preview-download>${uiText("Descargar PDF ↗")}</a></div><iframe class="cloud-pdf-frame" title="${uiText("Vista previa del documento PDF")}"></iframe>`);
    this.modal.classList.add('cloud-document-preview');
    this.previewUrl=URL.createObjectURL(blob);
    this.modal.querySelector('iframe').src=this.previewUrl+'#view=FitH';
    const link=this.modal.querySelector('[data-preview-download]');link.href=this.previewUrl;link.download=doc.original_filename;
  }
  project() {return this.projects.find(p=>p.id===this.projectId);}
  openProject(clientId) {
    const client=this.clients.find(item=>item.id===clientId);
    const clientField=client
      ? `<div class="context-entry"><small>${uiText("CLIENTE DEL PROYECTO")}</small><strong>${escape(client.name)}</strong></div><input type="hidden" name="client" value="${client.id}">`
      : `<label class="field">${uiText("Cliente del proyecto")}<select name="client" class="context-box" required><option value="" selected disabled>${uiText("Elige un cliente guardado")}</option>${this.clients.map(item=>`<option value="${item.id}">${escape(item.name)}</option>`).join('')}</select></label>`;
    this.show(uiText("Nuevo proyecto"),`<form data-cloud-form="project">${clientField}<label class="field">${uiText("Nombre del nuevo proyecto")}<input name="name" class="context-box" required maxlength="200" placeholder="${uiText("Por ejemplo: sitio web corporativo")}"></label><div class="dialog-actions"><button type="submit" class="button">${uiText("Crear proyecto")}</button></div></form>`);
  }
  initialSources() {return this.documents.filter(doc=>doc.kind==='initial_agreement');}
  sourceReady(doc) {
    const extraction=Array.isArray(doc.document_extractions)?doc.document_extractions[0]:doc.document_extractions;
    return extraction?.status==='ready';
  }
  openSource(purpose) {
    if(this.loading || !this.project()) return;
    const initial=purpose!=='request';
    if(!initial&&this.requestStatus?.can_register!==true){this.message=this.requestStatus?.can_register===false?uiText("Termina o cierra el pedido abierto de este proyecto antes de registrar otro."):uiText("Estamos comprobando los pedidos del proyecto. Vuelve a intentar en unos momentos.");this.notify();return;}
    if(!initial && !this.initialSources().some(doc=>this.sourceReady(doc))) {this.tab='acuerdo'; this.notify(); return;}
    this.show(initial?uiText("Añade lo conversado"):uiText("Registrar pedido del cliente"),`<p class="cloud-notice">${initial?uiText("Adjunta el contrato o la conversación inicial."):uiText("Adjunta la conversación con el nuevo pedido.")}</p><form data-cloud-form="upload"><input type="hidden" name="kind" value="${initial?'initial_agreement':'email_request'}"><label class="field">${initial?uiText("¿Qué contiene este archivo?"):uiText("¿Qué te pidió el cliente?")}<input name="title" class="context-box" required maxlength="200" placeholder="${initial?uiText("Ej.: conversación sobre alcance y precio"):uiText("Ej.: añadir una sección a la web")}"></label><label class="field">${initial?uiText("Contrato o conversación en PDF o Word"):uiText("Conversación del pedido en PDF o Word")}<input name="file" class="context-box" type="file" accept=".pdf,.docx" required></label><p class="cloud-notice">${uiText("Máximo 10 MB.")}</p><div class="dialog-actions"><button type="submit" class="button">${initial?uiText("Guardar fuente del acuerdo"):uiText("Guardar pedido")} →</button></div></form>`);
  }
  sourceRows(sources) {
    return sources.map(doc=>`<article class="cloud-client-row"><div><strong>${escape(doc.title)}</strong><p class="cloud-client-meta">${doc.original_filename?escape(doc.original_filename)+' · ':''}${escape(date(doc.created_at))}</p>${this.sourceReady(doc)?'':`<span class="cloud-client-meta">${escape(this.sourceStatusLabel(doc))}</span>`}</div><button class="text-button" data-cloud-action="${this.sourceReady(doc)?'text':'retry'}" data-cloud-id="${doc.id}" ${this.sourceProcessing(doc)?'disabled':''}>${this.sourceReady(doc)?uiText("Ver documento ↗"):this.sourceProcessing(doc)?uiText("Procesando…"):uiText("Reintentar lectura")}</button></article>`).join('');
  }
  requestRows(requests) {
    return [...requests].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).map(doc=>`<article class="cloud-change-row" aria-label="${uiText("Pedido")} ${escape(doc.title)}"><div class="cloud-change-info"><strong>${escape(doc.title)}</strong><time class="cloud-client-meta" datetime="${escape(doc.created_at)}">${escape(date(doc.created_at))}</time><div class="cloud-change-status"><span class="badge review" data-request-status>${uiText("Pedido guardado")}</span><span class="cloud-change-version" data-request-version hidden></span></div></div><div class="cloud-change-action"><button class="button secondary" data-request-primary data-cloud-action="${this.sourceReady(doc)?'review-change':'retry'}" data-cloud-id="${escape(doc.id)}" ${this.sourceProcessing(doc)?'disabled':''}>${this.sourceReady(doc)?uiText("Revisar cambio →"):this.sourceProcessing(doc)?uiText("Procesando…"):uiText("Reintentar lectura")}</button></div></article>`).join('');
  }
  renderAgreement(panel) {
    const sources=this.initialSources();
    const newest=items=>[...items].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
    const requests=newest(this.documents.filter(doc=>doc.kind==='email_request'));
    const documents=newest(this.documents);
    const proposals=this.proposals||[];
    const count=(n,one,many)=>`${n} ${uiText(n===1?one:many)}`;
    const card=(key,icon,title,description,body,tab,cta)=>`<section class="cloud-overview-card" aria-label="${uiText("Resumen de")} ${title.toLowerCase()}" data-overview-card="${key}"><header><span class="cloud-overview-icon" aria-hidden="true">${uiIcon(icon)}</span><h4>${title}</h4></header><p class="cloud-overview-description">${description}</p>${body}<button type="button" class="text-button cloud-overview-link" data-cloud-action="tab" data-cloud-tab="${tab}">${cta} ${uiIcon('arrow-right')}</button></section>`;
    const requestPreview=requests.length?`<ul class="cloud-overview-list">${requests.slice(0,2).map(doc=>{
      const proposal=proposals.find(p=>p.request_document_id===doc.id);
      const closed=this.requestStatus?.closures?.some(c=>c.request_document_id===doc.id);
      return `<li><strong>${escape(doc.title)}</strong><span>${escape((proposal?.business_status?uiText(proposal.business_status):'')||(closed?uiText("Cerrado"):this.proposalError?uiText("Estado no disponible"):this.requestStatus?uiText("Pedido guardado"):uiText("Consultando estado…")))}</span></li>`;
    }).join('')}</ul>`:("<p class=\"cloud-overview-empty\">"+uiText("Todavía no hay pedidos nuevos.")+"</p>");
    const documentPreview=documents.length?`<ul class="cloud-overview-list">${documents.slice(0,3).map(doc=>`<li><strong>${escape(doc.title)}</strong><span>${escape(doc.original_filename||date(doc.created_at))}</span></li>`).join('')}</ul>`:("<p class=\"cloud-overview-empty\">"+uiText("Los archivos que añadas aparecerán aquí.")+"</p>");
    panel.innerHTML=`<div class="cloud-project-overview" aria-label="${uiText("Vista general del proyecto")}"><header class="cloud-overview-heading"><div><span class="eyebrow">${uiText("VISTA GENERAL")}</span><h3>${uiText("Resumen del proyecto")}</h3></div><div class="cloud-overview-counts"><span>${count(sources.length,'fuente inicial','fuentes iniciales')}</span><span>${count(requests.length,'pedido','pedidos')}</span><span>${count(documents.length,'documento','documentos')}</span></div></header><section class="workspace-panel cloud-agreement"><div class="cloud-panel-heading"><div><span class="eyebrow">${uiText("ACUERDO INICIAL")}</span><h3>${sources.length?uiText("Lo conversado al inicio"):uiText("Guarda lo que han conversado")}</h3></div><button class="button ${sources.length?'secondary':''}" data-cloud-action="upload" data-cloud-purpose="initial">${uiText("Añadir información")}</button></div>${sources.length?`<div class="cloud-source-list">${this.sourceRows(newest(sources).slice(0,2))}</div>${sources.length>2?'<button class="text-button cloud-overview-link" data-cloud-action="tab" data-cloud-tab="documentos">'+uiText('Ver todas las fuentes')+' '+uiIcon('arrow-right')+'</button>':''}`:("<div class=\"cloud-empty-sources\"><p>"+uiText("Añade el contrato o la conversación inicial.")+"</p></div>")}</section><div class="cloud-overview-grid">${card('changes','git-compare-arrows',uiText("Cambios"),count(requests.length,'pedido registrado','pedidos registrados'),requestPreview,'solicitudes',uiText("Ver cambios"))}${card('refunds','undo-2',uiText("Devoluciones"),uiText("Solicitudes sobre dinero que ya se pagó."),("<p class=\"cloud-overview-empty\">"+uiText("Consulta el pago original y las condiciones para revisar una devolución.")+"</p>"),'devoluciones',uiText("Ver devoluciones"))}${card('documents','file-text',uiText("Documentos"),count(documents.length,'archivo del proyecto','archivos del proyecto'),documentPreview,'documentos',uiText("Ver documentos"))}${card('history','history',uiText("Historial"),uiText("El recorrido de tus acuerdos."),("<p class=\"cloud-overview-empty\">"+uiText("Consulta pedidos, envíos, aceptaciones y pagos, o explora sus conexiones en el mapa.")+"</p>"),'historial',uiText("Ver seguimiento"))}</div></div>`;
  }
  renderRequests(panel) {
    const requests=this.documents.filter(doc=>doc.kind==='email_request');
    panel.innerHTML=`<section class="workspace-panel cloud-requests"><button class="text-button" data-cloud-action="tab" data-cloud-tab="acuerdo">${uiText("← Volver al proyecto")}</button><div class="cloud-panel-heading cloud-section-note"><div><span class="eyebrow">${uiText("CAMBIOS DEL PROYECTO")}</span><h3>${uiText("Cambios del acuerdo")}</h3><p>${uiText("Revisa pedidos que modifican el trabajo, el precio o la fecha de entrega. Si el cliente pide recuperar un pago, ve a Devoluciones.")}</p></div><button class="button" data-cloud-action="upload" data-cloud-purpose="request" ${this.requestStatus?.can_register===true?'':'disabled'}>${uiText("Registrar pedido del cliente")}</button></div>${this.requestStatus?.can_register===false?("<p class=\"cloud-notice\">"+uiText("Termina o cierra el pedido abierto antes de registrar otro en este proyecto.")+"</p>"):''}${this.requestRows(requests) || ("<div class=\"cloud-empty-sources\"><strong>"+uiText("Aquí irán los nuevos pedidos")+"</strong><p>"+uiText("Cuando tu cliente pida algo adicional, guarda la conversación para revisarla por separado.")+"</p></div>")}</section>`;
  }
  renderRefunds(panel) {
    panel.innerHTML=`<section class="workspace-panel cloud-refunds" aria-label="${uiText("Devoluciones del proyecto")}"><header class="cloud-refund-heading"><span class="cloud-refund-symbol" aria-hidden="true">${uiIcon('undo-2')}</span><div><span class="eyebrow">${uiText("DEVOLUCIONES")}</span><h3>${uiText("Revisar dinero que ya se pagó")}</h3><p>${uiText("Cuando el cliente pide recuperar todo o parte de un pago, revisa el acuerdo, el trabajo realizado y el importe que corresponde proponer.")}</p></div></header><div class="cloud-refund-context"><strong>${uiText("Una devolución parte de un pago recibido.")}</strong><p>${uiText("Si el cliente pide más trabajo o una nueva fecha, corresponde a Cambios. Si pide dinero de vuelta, corresponde a Devoluciones. Una cancelación puede requerir revisar el cierre antes de decidir si hay dinero que devolver.")}</p></div><div class="cloud-refund-trial"><button type="button" class="button" data-cloud-action="refund-preview">${uiText("Probar flujo de devolución")} ${uiIcon('arrow-right')}</button></div></section>`;
  }
  projectNavigation(tab) {
    const selected=['solicitudes','comparar','gestion'].includes(tab)?'solicitudes':['devoluciones','documentos','historial'].includes(tab)?tab:'acuerdo';
    const sections=[['acuerdo','file-text',uiText("Proyecto"),uiText("Acuerdo y fuentes iniciales")],['solicitudes','git-compare-arrows',uiText("Cambios"),uiText("Alcance, precio o plazo")],['devoluciones','undo-2',uiText("Devoluciones"),uiText("Dinero de un pago recibido")],['documentos','file-text',uiText("Documentos"),uiText("Archivos por pedido")],['historial','history',uiText("Historial del proyecto"),uiText("Historial y mapa")]];
    return `<nav class="cloud-project-navigation" aria-label="${uiText("Secciones del proyecto")}">${sections.map(([id,icon,title,description])=>`<button type="button" data-cloud-action="tab" data-cloud-tab="${id}" aria-label="${title}: ${description}" ${selected===id?'aria-current="page"':''}>${uiIcon(icon)}<span><strong>${title}</strong><small>${description}</small></span></button>`).join('')}</nav>`;
  }
  async reviewChange(id) {
    const projectId=this.projectId, epoch=this.epoch;
    const request=this.documents.find(doc=>doc.id===id && doc.kind==='email_request');
    const sources=this.initialSources();
    if(!request || !this.sourceReady(request)) throw new Error(uiText("Primero reintenta la lectura del pedido para poder revisarlo."));
    if(!sources.length) throw new Error(uiText("Añade la información inicial del proyecto para comparar este pedido."));
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
          if(data.document.id!==doc.id || data.document.project_id!==projectId) throw new Error(uiText("La fuente recibida no corresponde a este proyecto."));
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
    const source=data=>`<article class="cloud-comparison-source"><h4>${escape(data.document.title)}</h4>${data.segments.map(segment=>`<section><p class="cloud-client-meta">${segment.locator_kind==='page'?uiText("Página"):uiText("Párrafo")} ${segment.locator_number}</p><p class="cloud-fragment">${escape(segment.text)}</p></section>`).join('') || ("<p class=\"cloud-notice\">"+uiText("Este archivo todavía no tiene texto para consultar. Puedes reintentar su lectura desde los archivos del proyecto.")+"</p>")}<button class="text-button" data-cloud-action="download" data-cloud-id="${data.document.id}">${uiText("Descargar original ↗")}</button></article>`;
    panel.innerHTML=`<section class="workspace-panel cloud-change-review"><button class="text-button" data-cloud-action="tab" data-cloud-tab="${comparison.returnTab||'solicitudes'}">${uiText("← Volver a los pedidos")}</button><div class="cloud-section-note"><span class="eyebrow">${uiText("REVISAR EL CAMBIO")}</span><h3>${escape(comparison.request.title)}</h3><p>${uiText("Compara lo que habían conversado con lo que está pidiendo ahora. Revisa si cambia el trabajo incluido, el costo o las fechas.")}</p></div>${comparison.loading?this.renderSkeleton('project',uiText("Cargando fuentes del proyecto y del pedido…")):comparison.error?`<button class="button secondary" data-cloud-action="review-change" data-cloud-id="${comparison.id}">${uiText("Volver a intentar")}</button>`:`<div class="cloud-comparison-grid"><section aria-label="${uiText("Información inicial")}"><span class="eyebrow">${uiText("LO CONVERSADO AL INICIO")}</span>${comparison.sources.map(source).join('')}</section><section aria-label="${uiText("Pedido nuevo")}"><span class="eyebrow">${uiText("LO QUE PIDE AHORA")}</span>${source(comparison.requestSource)}</section></div>`}</section>`;
  }
  renderSkeleton(kind='list',label=uiText("Cargando información…")) {
    return `<div class="cloud-loading" role="status" aria-busy="true" aria-label="${escape(label)}"><span class="sr-only">${escape(label)}</span><div aria-hidden="true" class="cloud-skeleton ${kind==='project'?'cloud-skeleton-project':''}"><div class="cloud-skeleton-heading"><span class="cloud-skeleton-line cloud-skeleton-title"></span><span class="cloud-skeleton-line cloud-skeleton-subtitle"></span></div>${[0,1,2].map(()=>`<div class="cloud-skeleton-row"><span class="cloud-skeleton-avatar"></span><div><span class="cloud-skeleton-line"></span><span class="cloud-skeleton-line cloud-skeleton-detail"></span></div><span class="cloud-skeleton-action"></span></div>`).join('')}</div></div>`;
  }
  renderClients() {
    return `<section class="workspace-panel cloud-client-directory" aria-label="${uiText("Tus clientes")}"><div class="library-header"><div><span class="eyebrow">${uiText("TU ESTUDIO")}</span><h3>${uiText("Tus clientes")}</h3></div><button class="text-button" data-cloud-action="refresh">${uiText("Actualizar ↻")}</button></div><div class="cloud-directory-list">${this.clients.map(client=>{
      const count=this.projects.filter(project=>project.client_id===client.id).length;
      return `<article class="cloud-client-row"><div><strong>${escape(client.name)}</strong><p class="cloud-client-meta">${client.contact_email?escape(client.contact_email)+' · ':''}${this.projectClientsLoaded.has(client.id)?(count?`${count} ${count===1?uiText("proyecto"):uiText("proyectos")}`:uiText("Sin proyectos todavía")):uiText("Ver proyectos")}</p></div><div class="cloud-client-actions"><button class="cloud-icon-button cloud-delete-client" data-cloud-action="client-delete" data-cloud-id="${client.id}" aria-label="${uiText("Eliminar cliente")} ${escape(client.name)}" title="${uiText("Eliminar cliente")} ${escape(client.name)}">${uiIcon('trash-2')}</button><button class="button secondary" data-cloud-action="client-open" data-cloud-id="${client.id}" aria-label="${uiText("Abrir cliente")} ${escape(client.name)}">${uiText("Abrir cliente ↗")}</button></div></article>`;
    }).join('') || ("<p class=\"cloud-section-note\">"+uiText("Todavía no tienes clientes. Usa Nuevo cliente junto al título para guardar el primero.")+"</p>")}</div></section>`;
  }
  renderWorkspace(workspace) {
    if(this.state==='loading' || this.directoryLoading || this.restoringNavigation){workspace.innerHTML=`<section class="workspace-panel cloud-initial-loading"><h2 class="sr-only">${uiText("Recuperando tu espacio…")}</h2>${this.renderSkeleton('list',this.active?uiText("Actualizando clientes y proyectos…"):uiText("Cargando clientes y proyectos…"))}</section>`;return;}
    if(!this.active) {
      workspace.innerHTML=`<section class="workspace-panel" aria-label="${uiText("Acceso a tu espacio")}"><h2>${this.state==='loading'?uiText("Recuperando tu espacio…"):this.state==='error'?uiText("Volvamos a conectar"):uiText("Tu espacio empieza aquí")}</h2><p role="status">${escape(this.message || (this.state==='loading'?uiText("Estamos recuperando tus clientes y proyectos."):uiText("Inicia sesión para ver tus clientes y continuar con tus proyectos.")))}</p>${this.state==='loading'?'':`<button class="button" data-cloud-action="${this.state==='error'?'reconnect':'access'}">${this.state==='error'?uiText("Volver a intentar"):uiText("Iniciar sesión o crear cuenta")}</button>`}</section>`; return;
    }
    if(this.location.hash==='#ensayos'){this.stopIngestionPolling();if(this.projectMapPanel)this.releaseProjectMap();this.renderPracticeWorkspace(workspace);return;}
    const client=this.clients.find(c=>c.id===this.clientId), project=this.project();
    if(!client) {workspace.innerHTML=this.renderClients()+`<p class="cloud-notice" role="status" ${this.message?'':'hidden'}>${escape(this.message)}</p>`; return;}
    const projects=this.projects.filter(p=>p.client_id===client.id);
    const toolbar=`<div class="cloud-breadcrumb"><button class="text-button" data-cloud-action="clients">${uiText("← Todos los clientes")}</button>${project?("<span>/</span><button class=\"text-button\" data-cloud-action=\"projects\">"+uiText("Proyectos del cliente")+"</button>"):''}</div>${project?'':`<section class="workspace-panel cloud-client-header" aria-label="${uiText("Cliente seleccionado")}"><div><span class="eyebrow">${uiText("CLIENTE")}</span><h2>${escape(client.name)}</h2><p class="cloud-client-meta">${escape(client.contact_email || '')}${client.contact_email?' · ':''}${projects.length} ${projects.length===1?uiText("proyecto"):uiText("proyectos")}</p></div><button class="button" data-cloud-action="project" data-cloud-id="${client.id}">${uiText("＋ Nuevo proyecto")}</button></section>`}`;
    if(!project) {
      workspace.innerHTML=toolbar+`<section class="workspace-panel cloud-project-directory" aria-label="${uiText("Proyectos del cliente")}"><span class="eyebrow">${uiText("ESPACIO DE TRABAJO")}</span><h3>${uiText("Proyectos de")} ${escape(client.name)}</h3>${this.projectsLoading?this.renderSkeleton('list',uiText("Cargando proyectos…")):projects.map(p=>`<article class="cloud-client-row"><div><strong>${escape(p.name)}</strong></div><button class="button secondary" data-cloud-action="project-open" data-cloud-id="${p.id}" aria-label="${uiText("Abrir proyecto")} ${escape(p.name)}">${uiText("Abrir proyecto ↗")}</button></article>`).join('') || ("<p>"+uiText("Este cliente todavía no tiene proyectos. Crea su primer proyecto para incorporar el acuerdo y los documentos.")+"</p>")}</section><p class="cloud-notice" role="status" ${this.message?'':'hidden'}>${escape(this.message)}</p>`; return;
    }
    const tab=this.tab;
    workspace.innerHTML=toolbar+`<div class="cloud-project-picker" ${projects.length<2?'hidden':''}><label class="field" for="cloud-picker">${uiText("Proyecto")}</label><select id="cloud-picker" class="context-box" data-cloud-project>${projects.map(p=>`<option value="${p.id}" ${p.id===this.projectId?'selected':''}>${escape(p.name)}</option>`).join('')}</select></div><div class="client-banner"><span class="client-avatar">${escape((client?.name || '').slice(0,2).toUpperCase())}</span><div><span class="eyebrow">${uiText("PROYECTO")}</span><h2>${escape(project.name)}</h2><p>${escape(client.name)}</p></div></div>${this.projectNavigation(tab)}<p class="cloud-notice" role="status" ${this.message?'':'hidden'}>${escape(this.message)}</p><div id="client-panel"></div>`;
    const panel=workspace.querySelector('#client-panel');
    if(this.loading) {panel.innerHTML=`<section class="workspace-panel">${this.renderSkeleton('project',uiText("Cargando información del proyecto…"))}</section>`; return;}
    if(tab==='gestion') this.renderChangeManagement(panel);
    else if(tab==='comparar') this.renderChangeReview(panel);
    else if(tab==='revision') this.renderReview(panel);
    else if(tab==='solicitudes') this.renderRequests(panel);
    else if(tab==='devoluciones') this.renderRefunds(panel);
    else if(tab==='documentos') this.renderDocuments(panel);
    else if(tab==='historial') this.renderProjectHistory(panel);
    else this.renderAgreement(panel);
  }
  releaseProjectMap() {
    this.projectMapGeneration=(this.projectMapGeneration||0)+1;
    this.projectMapCleanup?.();this.projectMapCleanup=null;
    this.projectMapPanel?.remove();this.projectMapPanel=null;
  }
  renderProjectHistory(panel) {
    const map=this.historyView==='map';
    panel.innerHTML=`<section class="cloud-project-history" aria-label="${uiText("Historial del proyecto")}"><header class="cloud-history-heading"><h3>${uiText("Historial del proyecto")}</h3><div class="cloud-history-views" role="group" aria-label="${uiText("Vista del seguimiento")}"><button class="button secondary" data-cloud-action="history-view" aria-pressed="${!map}">${uiIcon('history')} ${uiText("Historial")}</button><button class="button secondary" data-cloud-action="graph-preview" aria-pressed="${map}">${uiIcon('git-compare-arrows')} ${uiText("Mapa")}</button></div></header><div data-cloud-history ${map?'hidden':''}></div><div data-cloud-map ${map?'':'hidden'}></div></section>`;
    if(map)this.mountProjectMap(panel.querySelector('[data-cloud-map]'));
    else {if(this.projectMapPanel)panel.querySelector('[data-cloud-map]').append(this.projectMapPanel);this.loadHistory();}
  }
  mountProjectMap(panel) {
    if(this.projectMapPanel){panel.append(this.projectMapPanel);return;}
    const projectId=this.projectId,epoch=this.epoch,generation=this.projectMapGeneration;
    const container=this.document.createElement('div');this.projectMapPanel=container;panel.append(container);
    container.innerHTML=this.renderSkeleton('project',uiText("Cargando mapa del proyecto…"));
    const current=()=>this.active&&this.projectId===projectId&&this.epoch===epoch&&generation===this.projectMapGeneration;
    (async()=>{
      try{
        const {openProjectGraph}=await import('./graph-live.mjs');if(!current())return;
        const cleanup=await openProjectGraph({projectId,request:this.request.bind(this),container,isCurrent:current});
        if(!current()){cleanup?.();return;}this.projectMapCleanup=cleanup;
      }catch(error){if(current())container.innerHTML=`<p class="cloud-error" role="alert">${escape(error.message)}</p>`;}
    })();
  }
  activityLabel(event) {
    if(uiLocale()==='es-PE')return event.title;
    switch(event.kind){
      case 'request_registered':return uiText('history.request');
      case 'adenda_sent':return uiText('history.adenda',{version:event.revision_no});
      case 'acceptance_recorded':return uiText('history.acceptance',{version:event.revision_no});
      case 'payment_requested':return uiText('history.paymentRequested');
      case 'payment_completed':return uiText('history.paid',{amount:new Intl.NumberFormat(uiLocale(),{style:'currency',currency:event.currency}).format(event.amount_minor/100)});
      case 'request_closed':return uiText('history.closed');
      default:throw Error('Unsupported project activity: '+event.kind);
    }
  }
  renderHistory(panel) {
    const icons={request_registered:'file-text',adenda_sent:'send',acceptance_recorded:'file-text',payment_requested:'mail',payment_completed:'credit-card',request_closed:'x'};
    const activity=[...this.projectActivity].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
    const groups=new Map();
    for(const event of activity){
      if(!groups.has(event.request_document_id))groups.set(event.request_document_id,{title:event.request_title,events:[]});
      groups.get(event.request_document_id).events.push(event);
    }
    const content=[...groups.values()].map((group,index)=>`<details class="cloud-history-request" ${index===0?'open':''}><summary><span class="cloud-history-chevron" aria-hidden="true">${uiIcon('chevron-right')}</span><span class="cloud-history-request-title">${escape(group.title)}<small>${group.events.length} ${group.events.length===1?uiText("movimiento"):uiText("movimientos")}</small></span><time datetime="${escape(group.events[0].created_at)}">${escape(date(group.events[0].created_at))}</time></summary><ol class="cloud-project-timeline">${group.events.map(event=>`<li class="cloud-project-event" data-activity-kind="${escape(event.kind)}"><span class="cloud-project-event-icon" aria-hidden="true">${uiIcon(icons[event.kind])}</span><div><strong>${escape(this.activityLabel(event))}</strong></div><time datetime="${escape(event.created_at)}">${escape(date(event.created_at))}</time></li>`).join('')}</ol></details>`).join('');
    panel.innerHTML=`<div class="workspace-panel cloud-project-activity"><div class="cloud-activity-heading"><span>${uiText("Movimientos por pedido")}</span><span>${uiText("Más recientes primero")}</span></div>${content?`<div class="cloud-history-groups">${content}</div>`:("<p class=\"cloud-notice\">"+uiText("Los pedidos, envíos, aceptaciones y pagos aparecerán aquí.")+"</p>")}</div>`;
  }


  renderDocuments(panel) {
    const newest=(a,b)=>new Date(b.created_at)-new Date(a.created_at);
    const requests=new Map(this.documents.filter(doc=>doc.kind==='email_request').map(doc=>[doc.id,{kind:'request',id:doc.id,title:doc.title,docs:[{...doc,documentRole:uiText("Pedido del cliente")}]}]));
    const initial=[],other=[],unlinked=[];
    for(const doc of this.documents){
      if(doc.kind==='email_request')continue;
      if(doc.kind==='initial_agreement'){initial.push(doc);continue;}
      const links=doc.request_links || [];
      if(!links.length){(doc.kind==='addendum'?unlinked:other).push(doc);continue;}
      for(const link of links){
        if(!requests.has(link.request_document_id))requests.set(link.request_document_id,{kind:'request',id:link.request_document_id,title:uiText("Pedido vinculado · fuente no incluida en esta lista"),docs:[]});
        const group=requests.get(link.request_document_id);
        const role={addendum:uiText("Adenda"),acceptance:uiText("Aceptación"),feedback:uiText("Respuesta del cliente")}[link.role];
        const documentRole=`${role} · v${link.revision_no}`;
        const existing=group.docs.find(item=>item.id===doc.id);
        if(existing){if(!existing.documentRole.includes(documentRole))existing.documentRole+=` / ${documentRole}`;}
        else group.docs.push({...doc,documentRole});
      }
    }
    const sections=[...requests.values()].map(group=>({...group,docs:group.docs.sort(newest)}));
    sections.sort((a,b)=>newest(a.docs[0],b.docs[0]));
    if(initial.length)sections.push({kind:'initial_agreement',title:uiText("Acuerdo inicial"),docs:initial.sort(newest)});
    if(other.length)sections.push({kind:'reference',title:uiText("Otros documentos del proyecto"),docs:other.sort(newest)});
    if(unlinked.length)sections.push({kind:'unlinked',title:uiText("Adendas sin pedido vinculado"),docs:unlinked.sort(newest)});
    const row=doc=>{
      const extraction=Array.isArray(doc.document_extractions)?doc.document_extractions[0]:doc.document_extractions;
      return `<div class="cloud-document-row"><button type="button" class="document-button" data-cloud-action="text" data-cloud-id="${escape(doc.id)}" title="${uiText("Ver")} ${escape(doc.title)}"><span class="cloud-document-file-icon" aria-hidden="true">${uiIcon('file-text')}</span><span class="cloud-document-file"><strong>${escape(doc.title)}</strong><small>${doc.documentRole?escape(doc.documentRole)+' · ':''}${doc.mime_type==='application/pdf'?'PDF':'Word'} · ${escape(date(doc.created_at))}</small>${extraction?.status!=='ready'?`<span class="cloud-document-read-status" data-document-status>${extraction?.status==='error'?uiText("Lectura pendiente"):uiText("Pendiente de lectura")}</span>`:''}</span></button><div class="cloud-document-actions"><button class="cloud-icon-button" data-cloud-action="download" data-cloud-id="${escape(doc.id)}" aria-label="${uiText("Descargar original")} ${escape(doc.title)}" title="${uiText("Descargar original")}">${uiIcon('download')}</button>${extraction?.status!=='ready'?`<button class="cloud-icon-button" data-cloud-action="retry" data-cloud-id="${escape(doc.id)}" aria-label="${uiText("Reintentar lectura de")} ${escape(doc.title)}" title="${uiText("Reintentar lectura")}">${uiIcon('refresh-cw')}</button>`:''}</div></div>`;
    };
    const content=sections.map(({kind,id,title,docs},index)=>`<details class="cloud-document-group" data-document-kind="${kind}" ${id?`data-document-request="${escape(id)}"`:''} ${index===0?'open':''}><summary><span class="cloud-document-chevron" aria-hidden="true">${uiIcon('chevron-right')}</span><span>${kind==='request'?'Pedido · ':''}${escape(title)}</span><span class="cloud-document-count">${docs.length} ${docs.length===1?uiText("archivo"):uiText("archivos")}</span></summary><div class="document-list">${docs.map(row).join('')}</div></details>`).join('');
    panel.innerHTML=`<div class="knowledge-layout document-library"><div class="workspace-panel"><div class="library-header"><div><span class="eyebrow">${uiText("BASE DE CONOCIMIENTO")}</span><h3>${uiText("Documentos del proyecto")}</h3></div></div><div class="cloud-library-meta"><span>${this.documents.length} ${this.documents.length===1?uiText("archivo"):uiText("archivos")}</span><span>${uiText("Por pedido · actividad más reciente primero")}</span></div><div class="cloud-doc-groups">${content || ("<p class=\"cloud-section-note\">"+uiText("Los archivos que añadas al proyecto aparecerán aquí.")+"</p>")}</div></div></div>`;
  }

  renderRows(view) {
    const rows=this.active && view==='inicio'?this.projects:[];
    this.$('#project-rows').innerHTML=rows.map(p=>`<tr><td><div class="project-cell"><div><strong>${escape(p.name)}</strong><small>${escape(this.clients.find(c=>c.id===p.client_id)?.name)}</small></div></div></td><td>${uiText("Proyecto")}</td><td>${uiText("Por definir")}</td><td><span class="badge review">${uiText("Guardado")}</span></td><td><button class="row-button" data-cloud-action="project-open" data-cloud-id="${p.id}" aria-label="${uiText("Abrir proyecto")}">↗</button></td></tr>`).join('');
    this.$('#table-title').textContent=view==='inicio'?uiText("Proyectos de tu espacio"):uiText("Solicitudes de tu espacio");
    this.$('#empty').hidden=rows.length>0; this.$('#empty').textContent=view==='inicio'?uiText("Crea tu primer proyecto desde Clientes."):uiText("Consulta los pedidos y sus documentos desde el proyecto, en Clientes.");
  }
  syncChrome() {
    if(!this.profile) return;
    const active=this.active, connected=this.handlesView;
    this.document.documentElement.classList.remove('trato-starting');
    if(!this.clientButton) {
      const title=this.$('#page-title'), row=this.document.createElement('div'); row.className='cloud-title-row';
      title.before(row); row.append(title);
      this.clientButton=this.document.createElement('button'); this.clientButton.className='button';
      this.clientButton.type='button'; this.clientButton.dataset.cloudAction='client'; this.clientButton.textContent=uiText("＋ Nuevo cliente");
      row.append(this.clientButton);
    }
    const workspaceView=['#clientes','#conversaciones','#kb','#ensayos'].includes(this.location.hash);
    this.document.body.classList.toggle('cloud-design',connected);
    this.document.body.classList.toggle('cloud-project-view',connected&&active&&workspaceView&&this.location.hash!=='#ensayos'&&!!this.project());
    this.document.body.classList.toggle('cloud-client-view',connected&&active&&workspaceView&&this.location.hash!=='#ensayos'&&!!this.clientId);
    this.clientButton.hidden=!active || !workspaceView || !!this.clientId || this.location.hash==='#ensayos';
    if(active&&this.location.hash==='#ensayos'){this.$('#page-title').textContent=uiText('practice.title');this.$('#page-description').textContent=uiText('practice.subtitle');}
    else if(active && workspaceView) {this.$('#page-title').textContent=this.project()?.name || (this.clientId?this.clients.find(c=>c.id===this.clientId)?.name:uiText("Clientes"));this.$('#page-description').textContent=this.project()?uiText("Tu información inicial y los nuevos pedidos, en el mismo espacio."):this.clientId?uiText("Los proyectos y acuerdos de este cliente."):uiText("Cada cliente tiene sus proyectos. Elige uno para entrar a su espacio de trabajo.");}
    this.profile.textContent=active?(this.session.session.user.email || this.profileInitials).slice(0,2).toUpperCase():this.profileInitials;
    this.profile.setAttribute('aria-label',active?uiText("Mi perfil · sesión iniciada"):uiText("Mi perfil · iniciar sesión")); this.profile.title=active?uiText("Tu perfil"):uiText("Iniciar sesión");
    this.$('.top-actions .demo-pill').innerHTML=active?("<i></i>"+uiText("Espacio conectado")):connected?`<i></i>${this.state==='loading'?uiText("Conectando…"):uiText("Tu espacio")}`:this.badgeHTML;
    for(const selector of ['#general-assistant-toggle','#tour','#reset','.change-page-intro']) this.$(selector).hidden=connected;
    if(connected) {
      for(const selector of ['.stats','#hero','#flow-section','#assistant-entry','#general-assistant']) this.$(selector).hidden=true;
      this.document.querySelectorAll('[data-view] .count').forEach(node=>{node.textContent='0';});
      if(!active) {
        this.$('.activity').hidden=true;
        this.$('#client-workspace').hidden=false; this.renderWorkspace(this.$('#client-workspace'));
        this.$('#page-title').textContent=uiText("Tu espacio en Trato");
        this.$('#page-description').textContent=uiText("Tus clientes, proyectos y acuerdos en un solo lugar.");
      }
    } else this.$('#empty').textContent=this.emptyText;
    this.$('.footer span:last-child').textContent=connected?uiText("Tu estudio · Clientes, proyectos y acuerdos"):this.footerText;
  }
}

export const createConnectedWorkspace = options => new ConnectedWorkspace(options);
