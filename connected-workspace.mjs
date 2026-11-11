import {AIJobClient} from './ai-jobs.mjs';
import {renderAIActivity} from './ai-activity.mjs';
import {mountModelPreference} from './model-preferences.mjs';
import {uiText,uiLocale,uiLanguage} from './i18n.mjs';
import {icon as uiIcon} from './icons.mjs';
import {SessionClient, apiRequest, createReadCoalescer} from './auth-session.mjs';
import {mountAgreement} from './portal-view.mjs';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
export function renderFileLoading(filename='') {
  return `<div class="cloud-file-loading" role="status" aria-live="polite" data-file-loading><span class="cloud-file-loading-icon" aria-hidden="true">${uiIcon('file-text')}</span><strong>${uiText('filePreview.loading')}</strong>${filename?`<span class="cloud-file-loading-name">${escape(filename)}</span>`:''}<span class="cloud-file-loading-track" aria-hidden="true"></span></div>`;
}
const labels = {queued:uiText("Pendiente de lectura"),ready:uiText("Texto guardado"),error:uiText("Lectura pendiente de reintento")};
const kinds = {reference:uiText("Referencia"),initial_agreement:uiText("Fuente del acuerdo inicial"),email_request:uiText("Pedido del cliente"),addendum:uiText("Adenda · por verificar"),delivery:uiText("Entrega")};
const date = value => !value || !Number.isFinite(new Date(value).getTime()) ? uiText("Fecha no registrada") : new Intl.DateTimeFormat(uiLocale(),{dateStyle:'medium',timeStyle:'short',timeZone:'America/Lima'}).format(new Date(value));

export class ConnectedWorkspace {
  constructor({document:doc=globalThis.document, location=globalThis.location, fetchFn=globalThis.fetch.bind(globalThis), storage=globalThis.sessionStorage,authReturn=null}={}) {
    this.projectReads=createReadCoalescer();this.document=doc; this.location=location; this.fetch=fetchFn; this.storage=storage;this.authReturn=authReturn;this.authReturnError=false;
    this.documentProcessingJobs=new Map();this.active=false; this.state='loading'; this.clients=[]; this.projects=[]; this.documents=[]; this.events=[]; this.projectActivity=[];
    this.clientId=''; this.projectId=''; this.tab='acuerdo'; this.comparison=null; this.requestId=''; this.epoch=0; this.busy=false; this.loading=false; this.directoryLoading=false; this.message='';
    this.historyView='history';this.projectMapGeneration=0;this.resourceOpen={files:false,history:false};this.historyGeneration=0;this.historyLoaded=false;this.historyPending=null;this.projectHistoryGroups=[];this.historyGroupData=new Map();this.historyGroupPending=new Map();
    this.projectsLoaded=false;this.projectsLoading=false;this.projectClientsLoaded=new Set();this.projectsPending=new Map();
    this.base=location.origin;
  }
  get handlesView() {return true;}
  $(selector) {return this.document.querySelector(selector);}
  navigationKey() {
    return this.navigationOwner&&this.session?.key?`${this.session.key}:navigation:${this.navigationOwner}`:null;
  }
  clearNavigation() {
    try {if(this.navigationKey()){this.storage.removeItem(this.navigationKey());this.storage.removeItem(this.navigationKey()+':agreement');}}catch {}
  }
  // The addendum a client account has open, so a reload returns to it. Only an agreement this account can still see is reopened.
  rememberClientAgreement(id) {
    this.clientProposal=id;
    try {const key=this.navigationKey();if(key){if(id)this.storage.setItem(key+':agreement',id);else this.storage.removeItem(key+':agreement');}}catch {}
  }
  restoreClientAgreement() {
    try {
      const key=this.navigationKey(),id=key&&this.storage.getItem(key+':agreement');
      if(!id)return;
      if(this.location.hash==='#acuerdos'&&this.clientAgreements?.some(item=>item.proposal_id===id))this.clientProposal=id;
      else this.storage.removeItem(key+':agreement');
    } catch {}
  }
  readNavigation() {
    try {
      const value=JSON.parse(this.storage.getItem(this.navigationKey())||'null');
      const id=value=>typeof value==='string'&&/^[a-zA-Z0-9-]{1,80}$/.test(value);
      if(value?.version!==1||!['acuerdo','plan','solicitudes','devoluciones','disputas','reuniones','documentos','historial','gestion','comparar','asistente'].includes(value.tab))return null;
      if([value.clientId,value.projectId,value.requestId,value.revisionId].some(value=>value!==''&&!id(value)))return null;
      return {...value,historyView:value.historyView==='map'?'map':'history'};
    } catch {return null;}
  }
  saveNavigation() {
    if(['#ensayos','#reputacion'].includes(this.location.hash))return;
    if(!this.active||!this.session?.session||this.state!=='ready'||this.restoringNavigation||this.loading||!this.navigationKey())return;
    const clientId=this.clients.some(c=>c.id===this.clientId)?this.clientId:'';
    const projectId=clientId&&this.projects.some(p=>p.id===this.projectId&&p.client_id===clientId)?this.projectId:'';
    const requestId=projectId&&this.documents.some(d=>d.id===this.requestId&&d.kind==='email_request')?this.requestId:'';
    const details=this.proposalDetails?.proposal?.request_document_id===requestId?this.proposalDetails:null;
    const revisionId=this.tab==='gestion'&&requestId?(details?.revision?.id||this.proposalRetryRevision||''):'';
    const tab=['acuerdo','plan','solicitudes','devoluciones','disputas','reuniones','documentos','historial','gestion','comparar','asistente'].includes(this.tab)?this.tab:'acuerdo';
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
    const method=(options?.method||'GET').toUpperCase();
    // Project state several modules read on their own; any change forgets remembered reads, before and after it runs.
    const shared=!blob&&method==='GET'&&/^\/api\/v1\/projects\/[^/?]+\/(?:proposals|request-status|plan-progress)$/.test(path);
    if(method!=='GET')this.projectReads.clear();
    try {
      if(shared)return await this.projectReads.read(path,()=>apiRequest(this.session,this.base,path,options,blob));
      const result=await apiRequest(this.session,this.base,path,options,blob);
      if(method!=='GET')this.projectReads.clear();
      return result;
    }
    catch(error) {
      if(method!=='GET')this.projectReads.clear();
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
    this.historyGeneration++;this.historyLoaded=false;this.historyPending=null;this.projectHistoryGroups=[];this.historyGroupData=new Map();this.historyGroupPending=new Map();this.resourceOpen={files:false,history:false};this.projectsLoaded=false;this.projectsLoading=false;this.projectClientsLoaded=new Set();this.projectsPending=new Map();
    for(const job of this.documentProcessingJobs.values())job.dispose();this.documentProcessingJobs.clear();
    this.projectReads.clear();this.epoch++; this.active=false; this.state='anonymous'; this.role=''; this.clientAgreements=[]; this.clientNotice=''; this.clients=[]; this.projects=[]; this.documents=[]; this.events=[]; this.projectActivity=[];
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
    this.modal.addEventListener('click',event=>{if(event.target.closest('[data-cloud-close]')) this.modal.close();const switcher=event.target.closest('[data-cloud-auth-mode]');if(switcher){const email=this.modal.querySelector('[name="email"]')?.value||'';this.openAccount(switcher.dataset.cloudAuthMode);this.modal.querySelector('[name="email"]').value=email;}});
    this.modal.addEventListener('submit',event=>{event.preventDefault(); this.submit(event);});
    this.modal.addEventListener('close',()=>{if(!this.modal.open){this.releasePreview();this.planUploadProject=null;this.modal.replaceChildren();}});
    this.document.addEventListener('click',event=>this.click(event));
    this.document.addEventListener('change',event=>{
      if(event.target.matches('[data-cloud-project]')) {
        if(this.busy) {event.target.value=this.projectId; return;}
        this.projectId=event.target.value; this.tab='acuerdo'; this.comparison=null; this.requestId=''; this.documents=[]; this.events=[]; this.projectActivity=[]; this.notify(); this.run(()=>this.loadProject());
      }
    });
    this.notify(); this.restore();
  }
  async restore() {
    const epoch=this.epoch;
    this.state='loading'; this.message=''; this.notify();
    try {
      await this.connect();
      if(epoch!==this.epoch) return;
      if(this.authReturn){const result=this.authReturn;this.authReturn=null;await this.session.acceptAuthReturn(result);if(epoch!==this.epoch)return;this.authReturnError=false;this.location.hash='inicio';}
      if(this.session.session) await this.load({restoreNavigation:true});
      else {this.state='anonymous'; this.notify();}
    } catch(error) {
      this.authReturnError=Boolean(error.authReturn);
      this.state=error.authReturn?'error':this.session && !this.session.session?'anonymous':'error';
      this.message=error.authReturn?error.message:this.state==='anonymous'?uiText("Inicia sesión para volver a tu espacio."):uiText("No pudimos recuperar tu espacio. Vuelve a intentar.");
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
      if(!['freelancer','client'].includes(session.role))throw new Error(uiText("No pudimos verificar tu sesión."));
      this.navigationOwner=session.user_id;this.role=session.role;
      if(this.role==='client'){await this.loadClientAgreements();if(epoch!==this.epoch)return;if(restoreNavigation)this.restoreClientAgreement();}
      const nav=restoreNavigation&&!['#ensayos','#reputacion'].includes(this.location.hash)?this.readNavigation():null;
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
  // Fresh document list without the project's loading state, for changes made from a panel.
  async refreshDocumentList() {
    const project=this.projectId,epoch=this.epoch;if(!project)return;
    const documents=await this.request(`/api/v1/projects/${project}/documents`);
    // A document added from a panel may still be processing: keep watching it, as a project load does.
    if(project===this.projectId&&epoch===this.epoch){this.documents=documents;this.notify();this.scheduleIngestionPolling();}
  }
  async loadProject() {
    this.stopIngestionPolling();
    this.releaseProjectMap();
    this.historyGeneration++;this.historyLoaded=false;this.historyPending=null;this.projectHistoryGroups=[];this.historyGroupData=new Map();this.historyGroupPending=new Map();this.projectActivity=[];
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
    // A background refresh keeps the current history visible instead of flashing a loading state.
    if(this.historyProject===id&&this.projectHistoryGroups.length)this.renderHistory(panel);
    else panel.innerHTML=("<p class=\"cloud-notice\" role=\"status\">"+uiText("history.loadingGroups")+"</p>");
    const current=()=>this.active&&id===this.projectId&&epoch===this.epoch&&generation===this.historyGeneration;
    this.historyPending=(async()=>{
      try{
        const groups=await this.request(`/api/v1/projects/${id}/activity/groups`);
        if(!current())return;
        if(!Array.isArray(groups)||groups.some(g=>!['project','change','refund','dispute'].includes(g.group_kind)||typeof g.group_id!=='string'||!Number.isInteger(g.event_count)||g.event_count<1||!Number.isFinite(Date.parse(g.last_at))))throw Error(uiText('history.groupError'));
        this.projectHistoryGroups=groups;this.historyProject=id;this.historyLoaded=true;
        for(const [key,cached] of this.historyGroupData){if(!groups.some(g=>g.group_kind+':'+g.group_id===key&&cached.signature===g.last_at+':'+g.event_count))this.historyGroupData.delete(key);}
        this.projectActivity=[...this.historyGroupData.values()].flatMap(g=>g.events);
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
  // Correct a document uploaded by mistake. The server refuses it once an addendum, payment, delivery, dispute,
  // problem report or refund has used the document, and the message says so; nothing else changes.
  openDocumentFix(action,id) {
    const doc=(this.documents||[]).find(d=>d.id===id);if(!doc||!this.projectId)return;
    const roles=[['initial_agreement',uiText('projectStart.roleInitial')],['email_request',uiText('projectStart.roleRequest')],['addendum',uiText('projectStart.roleAddendum')],['delivery',uiText('projectStart.roleDelivery')],['reference',uiText('projectStart.roleReference')]];
    const remove=action==='document-remove';
    const body=remove
      ?`<p>${uiText('documentFix.removeCopy',{name:escape(doc.title)})}</p>`
      :`<label class="field">${uiText('documentFix.roleLabel',{name:escape(doc.title)})}<select class="context-box" data-document-fix-kind>${roles.map(([value,key])=>`<option value="${value}" ${doc.kind===value?'selected':''}>${key}</option>`).join('')}</select></label>`;
    this.show(uiText(remove?'documentFix.removeTitle':'documentFix.roleTitle'),`<div class="document-fix">${body}<p class="cloud-error" role="alert" data-document-fix-error></p><div class="dialog-actions"><button type="button" class="text-button" data-cloud-close>${uiText('documentFix.cancel')}</button><button type="button" class="button ${remove?'danger':''}" data-document-fix-save>${uiText(remove?'documentFix.removeConfirm':'documentFix.save')}</button></div></div>`);
    const save=this.modal.querySelector('[data-document-fix-save]'),error=this.modal.querySelector('[data-document-fix-error]');
    save.addEventListener('click',async()=>{
      save.disabled=true;error.textContent='';
      try{
        const path=`/api/v1/projects/${encodeURIComponent(this.projectId)}/documents/${encodeURIComponent(id)}`;
        if(remove)await this.request(path,{method:'DELETE'});
        else await this.request(path,{...this.json({kind:this.modal.querySelector('[data-document-fix-kind]').value}),method:'PATCH'});
        this.modal.close();this.historyLoaded=false;await this.loadProject();this.notify();
      }catch(issue){
        error.textContent=uiText({DOCUMENT_IN_USE:'documentFix.inUse',DOCUMENT_ROLE_LOCKED:'documentFix.roleLocked'}[issue?.code]||'documentFix.error');save.disabled=false;
      }
    });
  }
  show(title,html) {
    this.releasePreview();
    this.modal.classList.remove('cloud-history-dialog','cloud-profile-dialog','cloud-auth-dialog','cloud-signup-dialog','cloud-document-preview','cloud-mail-dialog','cloud-project-setup','cloud-delete-dialog','cloud-project-create-dialog','cloud-change-steps-dialog');
    if(this.modal.open) this.modal.close();
    this.modal.innerHTML=`<div class="upload-modal-header"><div><span class="eyebrow">${uiText("TU ESPACIO EN TRATO")}</span><h2 id="cloud-dialog-title">${escape(title)}</h2></div><button type="button" class="close" data-cloud-close aria-label="${uiText("Cerrar")}" title="${uiText("Cerrar")}">${uiIcon('x')}</button></div>${html}<p class="cloud-error" data-cloud-error role="alert"></p>`;
    this.modal.showModal();
  }
  openAccount(mode='login') {
    if(this.active) {
      const email=this.session.session.user.email || uiText("Sesión iniciada");
      this.show(uiText("Tu perfil"),`<section class="cloud-identity cloud-profile-hero" aria-label="${uiText("Cuenta de Trato")}"><span class="cloud-account-avatar" aria-hidden="true">${escape(email.slice(0,2).toUpperCase())}</span><div><span class="cloud-account-label">${uiText("Cuenta de Trato")}</span><strong>${escape(email)}</strong></div></section><section class="cloud-account-connections" hidden aria-label="${uiText("Conexiones")}"><header><h3>${uiText("Conexiones")}</h3></header><div class="cloud-integrations"></div></section><form data-cloud-form="logout" class="cloud-account-footer"><button class="text-button" type="submit">${uiText("Cerrar sesión")}</button></form>`);
      this.modal.classList.add('cloud-profile-dialog');
      void mountModelPreference(this);
    } else {
      const signup=mode==='signup';
      this.show(uiText(signup?'landing.signupTitle':'Accede a tu estudio'),`<p class="cloud-auth-intro">${uiText(signup?'auth.signupIntro':'auth.loginIntro')}</p><form data-cloud-form="auth">${signup?`<fieldset class="cloud-role-choice"><legend class="field">${uiText('auth.roleLegend')}</legend><div class="cloud-role-cards">${['freelancer','client'].map((role,index)=>`<label class="cloud-role-option"><input type="radio" name="role" value="${role}" required><span class="cloud-role-icon" aria-hidden="true">${uiIcon(role==='freelancer'?'folder-open':'user-round')}</span><span class="cloud-role-text"><strong>${uiText(`auth.role.${role}`)}</strong><small>${uiText(`auth.role.${role}Hint`)}</small></span></label>`).join('')}</div><p class="cloud-role-hint">${uiText('auth.roleFixed')}</p></fieldset>`:''}<label class="field" for="cloud-email">${uiText("Correo")}</label><input class="context-box" id="cloud-email" name="email" type="email" autocomplete="username" required><label class="field" for="cloud-password">${uiText("Contraseña")}</label><input class="context-box" id="cloud-password" name="password" type="password" minlength="8" autocomplete="${signup?'new-password':'current-password'}" required><div class="dialog-actions"><button type="submit" class="button" value="${signup?'signup':'login'}">${uiText(signup?'Crear cuenta':'Iniciar sesión')}</button></div></form><p class="cloud-auth-switch">${uiText(signup?'auth.hasAccount':'auth.noAccount')} <button type="button" data-cloud-auth-mode="${signup?'login':'signup'}">${uiText(signup?'Iniciar sesión':'Crear cuenta')}</button></p>`);
      this.modal.classList.add('cloud-auth-dialog');if(signup)this.modal.classList.add('cloud-signup-dialog');
    }
  }
  async submit(event) {
    const form=event.target, kind=form.dataset.cloudForm, mode=event.submitter?.value;
    const values=new FormData(form);
    await this.run(async()=>{
      if(kind==='auth') {
        const accessStatus=this.modal.querySelector('[data-cloud-error]');accessStatus.classList.remove('cloud-auth-confirmation');accessStatus.setAttribute('role','alert');
        // Visible progress from the click until the workspace opens; a failure brings the form back with its error.
        const submitButton=form.querySelector('button[type="submit"]'),submitLabel=submitButton?.innerHTML;
        const restoreLabel=()=>{if(submitButton)submitButton.innerHTML=submitLabel;};
        if(submitButton)submitButton.textContent=uiText('auth.connecting');
        let ready=true;
        try{
          await this.connect();
          if(mode==='signup') ready=await this.session.signup(values.get('email').trim(),values.get('password'),this.base,values.get('role'));
          else await this.session.login(values.get('email').trim(),values.get('password'));
        }catch(error){restoreLabel();throw error;}
        form.querySelector('[name="password"]').value='';
        if(!ready) {
          // The confirmation link opens Trato in a new tab, so this one can be closed.
          const email=values.get('email').trim();
          this.modal.querySelector('h2')?.replaceChildren(uiText('auth.checkEmailTitle'));
          for(const node of this.modal.querySelectorAll('.cloud-auth-intro,form[data-cloud-form="auth"],.cloud-auth-switch,[data-cloud-error]'))node.remove();
          const panel=this.document.createElement('section');panel.className='cloud-auth-sent';panel.setAttribute('role','status');
          panel.innerHTML=`<span class="cloud-auth-sent-icon" aria-hidden="true">${uiIcon('mail')}</span><p>${uiText('auth.checkEmailCopy',{email:escape(email)})}</p><p class="cloud-auth-sent-close">${uiText('auth.checkEmailClose')}</p><p class="cloud-auth-sent-tip">${uiText('auth.checkEmailSpam')}</p><div class="dialog-actions"><button type="button" class="button" data-cloud-close-sent>${uiText('auth.checkEmailDone')}</button></div>`;
          panel.querySelector('[data-cloud-close-sent]').addEventListener('click',()=>this.modal.close());
          this.modal.append(panel);return;
        }
        const hidden=[...this.modal.querySelectorAll('.cloud-auth-intro,form[data-cloud-form="auth"],.cloud-auth-switch')];
        const opening=this.document.createElement('div');opening.className='cloud-auth-opening';opening.setAttribute('role','status');
        opening.innerHTML=renderAIActivity({label:uiText('auth.opening'),compact:true});
        for(const node of hidden)node.hidden=true;
        this.modal.append(opening);
        try{await this.load();}
        catch(error){opening.remove();for(const node of hidden)node.hidden=false;restoreLabel();throw error;}
        this.modal.close(); this.location.hash='clientes';
      } else if(kind==='logout') {
        this.epoch++; this.clearNavigation(); await this.session.logout(); this.reset(); this.modal.close(); this.notify();
      } else if(kind==='client') {
        // A client already groups many projects: the same contact email opens the existing client instead of a second one.
        const email=(values.get('email')||'').trim().toLowerCase();
        const existing=email?this.clients.find(item=>(item.contact_email||'').trim().toLowerCase()===email):null;
        if(existing){this.clientId=existing.id;this.projectId='';this.modal.close();await this.loadProject();this.message=uiText('clientDuplicate.opened',{name:existing.name});this.notify();return;}
        const client=await this.request('/api/v1/clients',this.json({name:values.get('name'),contact_email:values.get('email')?.trim() || null}));
        this.clients=[client,...this.clients.filter(item=>item.id!==client.id)];this.projectClientsLoaded.add(client.id);this.clientId=client.id;this.projectId='';this.modal.close();await this.loadProject();this.message=uiText("Cliente guardado.");this.notify();
      } else if(kind==='client-delete') {
        const id=form.dataset.clientId;
        await this.request(`/api/v1/clients/${id}/delete`,{method:'POST'});
        if(this.clientId===id){this.clientId='';this.projectId='';this.documents=[];this.events=[];this.comparison=null;this.requestId='';}
        this.clients=this.clients.filter(client=>client.id!==id);this.projectClientsLoaded.delete(id);this.projects=this.projects.filter(project=>project.client_id!==id);this.modal.close();await this.loadProject();this.message=uiText("Cliente eliminado de tu espacio.");this.notify();
      } else if(kind==='project-delete') {
        const id=form.dataset.projectId;
        await this.request(`/api/v1/projects/${id}/delete`,{method:'POST'});
        this.discardProjectPlan?.(id);this.projects=this.projects.filter(project=>project.id!==id);
        if(this.projectId===id){this.stopIngestionPolling();this.releaseProjectMap();this.projectId='';this.documents=[];this.events=[];this.projectActivity=[];this.requestId='';this.comparison=null;}
        this.modal.close();this.message=uiText('projectStart.projectDeleted');this.notify();
      } else if(kind==='project') {
        const project=await this.request('/api/v1/projects',this.json({client_id:values.get('client'),name:values.get('name')}));
        this.projects=[project,...this.projects.filter(item=>item.id!==project.id)];this.clientId=project.client_id;this.projectId=project.id;this.tab=values.get('project_start')==='new'?'plan':'acuerdo';this.modal.close();await this.loadProject();
      } else if(kind==='upload') {
        const id=this.projectId, epoch=this.epoch, file=values.get('file');
        if(!file?.size || file.size>10485760) throw new Error(uiText("Selecciona un PDF o DOCX de hasta 10 MB."));
        const metadata={filename:file.name,title:values.get('title'),kind:values.get('kind')};
        for(const key of ['purpose','revision_id','refund_case_id','snapshot_id','payment_id','request_id'])if(values.get(key))metadata[key]=values.get(key);
        const command=JSON.stringify([id,metadata,file.size,file.lastModified]);
        if(this.uploadCommand?.command!==command) this.uploadCommand={command,key:crypto.randomUUID()};
        const mime=file.name.toLowerCase().endsWith('.docx')?'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'application/pdf';
        const choice=metadata.kind==='email_request'?values.get('plan_choice'):null;
        if(metadata.kind==='email_request'&&form.querySelector('[data-plan-placement]')?.dataset.state!=='ready')throw new Error(uiText('planPlacement.notReady'));
        let saved;
        try {
          saved=await this.request(`/api/v1/projects/${id}/documents?${new URLSearchParams(metadata)}`,{method:'POST',body:file,headers:{'Content-Type':mime,'Idempotency-Key':this.uploadCommand.key}});
        } catch(error) {await this.loadProject(); throw error;}
        if(epoch!==this.epoch || id!==this.projectId) return;
        // Where the request sits in the plan, recorded once. On failure the form stays open and a retry reuses the same upload.
        // Registering the request is complete once it is saved. Placing it in the plan is a second step:
        // if that fails, say so and offer «Place in the plan» from Changes instead of keeping the form open.
        let placementError=null;
        if(choice){
          const [placement,position]=choice.split(':');
          const placementBody={placement,stage_position:placement==='stage'?Number(position):null};
          try{await this.request(`/api/v1/requests/${saved.document.id}/plan-placement`,{...this.json(placementBody),method:'PUT'});}
          catch(error){console.warn('[TeTrato] plan placement failed',{request:saved.document.id,sent:placementBody,status:error.status,code:error.code});placementError=error;}
          if(epoch!==this.epoch || id!==this.projectId) return;
        }
        // Optional follow-up for whoever opened this form (a client report registered as a request). It never undoes the saved request.
        if(metadata.kind==='email_request'&&this.afterRequestSaved){const follow=this.afterRequestSaved;this.afterRequestSaved=null;try{await follow(saved.document.id);}catch(error){console.warn('[Trato] request follow-up failed',{code:error.code});}}
        this.uploadCommand=null; this.comparison=null; this.tab=this.planUploadProject===id?'plan':metadata.purpose?.startsWith('refund_')?'devoluciones':metadata.kind==='initial_agreement'?'acuerdo':metadata.kind==='reference'?'documentos':'solicitudes';this.planUploadProject=null; this.modal.close(); await this.loadProject();
        this.message=metadata.kind!=='email_request'?uiText("Archivo guardado."):placementError?uiText('planPlacement.savedWithoutPlace',{reason:placementError.message}):uiText("Pedido guardado."); this.notify();
      }
    });
  }
  json(data) {return {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)};}
  enterSelection() {
    this.releaseProjectMap();this.historyView='history';
    this.documents=[]; this.events=[]; this.projectActivity=[]; this.comparison=null; this.loading=false; this.message='';
    this.location.hash='clientes'; this.notify(); this.run(async()=>{if(this.clientId)await this.loadProjects();await this.loadProject();});
  }
  // Opens one section of a project from outside its client's page (the home dispute warning).
  goToProject(clientId,projectId,tab) {
    if(this.busy) return;
    this.clientId=clientId; this.projectId=projectId; this.tab=tab;
    this.enterSelection();
  }
  click(event) {
    const target=event.target.closest('[data-cloud-action]');
    if(!target) return;
    const action=target.dataset.cloudAction, id=target.dataset.cloudId;
    if(action==='access') {this.openAccount(); return;}
    if(action==='reconnect') {this.run(()=>this.restore()); return;}
    if(!this.active) return;
    if(action==='client-agreement'){this.rememberClientAgreement(id);if(this.location.hash!=='#acuerdos')this.location.hash='acuerdos';else this.notify();return;}
    if(action==='client-agreement-back'){this.rememberClientAgreement('');this.agreementView?.release();this.loadClientAgreements().then(()=>this.notify(),()=>this.notify());return;}
    if(action==='client') this.show(uiText("Nuevo cliente"),`<form data-cloud-form="client"><label class="field">${uiText("Nombre")}<input name="name" class="context-box" required maxlength="200"></label><label class="field">${uiText("Correo de contacto")}<input name="email" class="context-box" type="email" maxlength="254" required aria-describedby="cloud-client-email-why"></label><details class="cloud-field-why" id="cloud-client-email-why"><summary>${uiIcon('info')}${uiText('client.emailWhy')}</summary><p>${uiText('client.emailWhyDetail')}</p></details><div class="dialog-actions"><button type="submit" class="button">${uiText("Guardar cliente")}</button></div></form>`);
    if(action==='client-delete'){const client=this.clients.find(c=>c.id===id);if(client)this.show(uiText("Eliminar cliente"),`<p>${uiText("Eliminarás a")} <strong>${escape(client.name)}</strong> de tu espacio junto con sus proyectos y documentos.</p><p>${uiText("Conservaremos los registros mediante borrado lógico para permitir su recuperación.")}</p><form data-cloud-form="client-delete" data-client-id="${escape(client.id)}"><div class="dialog-actions"><button class="button cloud-delete-confirm" type="submit">${uiIcon('trash-2')}${uiText("Eliminar cliente")}</button><button class="button secondary" type="button" data-cloud-close>${uiText("Cancelar")}</button></div></form>`);}
    if(action==='project') this.openProject(id);
    if(action==='project-delete'){const project=this.projects.find(item=>item.id===id);if(project){this.show(uiText('projectStart.deleteProject'),`<section class="cloud-delete-content"><p class="cloud-delete-intro">${uiText('projectStart.deleteProjectIntro')}</p><div class="cloud-delete-project-card">${uiIcon('folder-open')}<strong>${escape(project.name)}</strong></div><p class="cloud-delete-explanation">${uiText('projectStart.deleteProjectHelp')}</p><form data-cloud-form="project-delete" data-project-id="${escape(id)}"><div class="dialog-actions"><button type="button" class="button secondary" data-cloud-close>${uiText("Cancelar")}</button><button type="submit" class="button cloud-delete-confirm">${uiText('projectStart.deleteProject')}</button></div></form></section>`);this.modal.classList.add('cloud-delete-dialog');}}
    if(action==='upload') this.openSource(target.dataset.cloudPurpose);
    if(action==='requests-archive'){this.openRequestsArchive();return;}
    if(action==='placement-retry'){void this.loadPlacementChoices();return;}
    if(action==='reprocess-document'){this.retryDocumentProcessing(id);return;}
    if(action==='graph-preview'){this.historyView='map';this.tab='historial';this.notify();}
    if(action==='history-event'){this.openHistoryEvent(id);return;}
    if(action==='history-group-retry'){
      const panel=this.$('[data-cloud-history]'),details=target.closest('details.cloud-history-request');
      const group=panel?.historyGroups?.get(details?.dataset.activityGroupKind+':'+details?.dataset.activityGroupId);
      if(group)void this.fillHistoryGroup(panel,details,group);return;
    }
    if(action==='history-document'){
      const historyEvent=target.dataset.cloudEventId,project=this.projectId,epoch=this.epoch;
      this.run(async()=>{await this.previewDocument(id);if(project===this.projectId&&epoch===this.epoch&&this.modal.open&&this.modal.classList.contains('cloud-document-preview'))this.modal.querySelector('.cloud-preview-toolbar')?.insertAdjacentHTML('afterbegin',`<button type="button" class="text-button" data-cloud-action="history-event" data-cloud-id="${escape(historyEvent)}">${uiIcon('arrow-left')}${uiText('history.backToEvent')}</button>`);});return;
    }
    if(action==='history-view'){this.historyView='history';this.notify();}
    if(action==='refund-preview') this.run(async()=>{const {openRefundPreview}=await import('./refund-preview.mjs');await openRefundPreview({returnFocus:target});});
    if(action==='review-change') this.run(()=>this.reviewChange(id));
    if(action==='tab') {
      const next=target.dataset.cloudTab;
      if(this.loading || (this.busy && !['acuerdo','solicitudes'].includes(next))) return;
      if(next==='revision' && !this.initialSources().some(doc=>this.sourceReady(doc))) return;
      if(this.tab==='historial'&&next!=='historial')this.releaseProjectMap();
      this.tab=next; this.message=''; if(this.location.hash==='#conversaciones'&&this.tab!=='asistente') this.location.hash='clientes'; this.notify();}
    if(action==='home-tab') {
      const next=target.dataset.cloudTab;
      if(this.busy||this.loading||!this.project()||!['asistente','solicitudes'].includes(next))return;
      this.tab=next;this.message='';this.location.hash='clientes';this.notify();return;
    }
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
      this.enterSelection();
    }
    if(action==='text') this.run(()=>this.previewDocument(id));
    if(action==='download') this.run(async()=>{
      const doc=this.documents.find(d=>d.id===id); if(!doc) return;
      const blob=await this.request(`/api/v1/documents/${id}/file`,{},true);
      const url=URL.createObjectURL(blob), link=this.document.createElement('a'); link.href=url; link.download=doc.original_filename; link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
    });
    if(action==='retry') this.run(async()=>{await this.request(`/api/v1/documents/${id}/retry`,{method:'POST'}); await this.loadProject();});
    if(action==='document-role'||action==='document-remove'){this.openDocumentFix(action,id);return;}
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
    this.show(doc.title,renderFileLoading(doc.original_filename||doc.title));
    const pending=this.modal.querySelector('[data-file-loading]');
    const current=()=>project===this.projectId&&epoch===this.epoch&&this.modal.open&&this.modal.contains(pending);
    let blob;
    try{
      blob=await this.request(`/api/v1/documents/${id}/file`,{},true);
      if(!current())return;
      if(blob.type.split(';')[0]!=='application/pdf')throw new Error(uiText("El servidor no devolvió un documento PDF."));
    }catch(error){if(current()){pending.hidden=true;throw error;}return;}
    this.show(doc.title,`<div class="cloud-preview-toolbar"><span>${escape(doc.original_filename)}</span><a class="text-button" data-preview-download>${uiText("Descargar PDF ↗")}</a></div><div class="cloud-file-preview-stage">${renderFileLoading(doc.original_filename||doc.title)}<iframe class="cloud-pdf-frame" title="${uiText("Vista previa del documento PDF")}" aria-busy="true"></iframe></div>`);
    this.modal.classList.add('cloud-document-preview');
    this.previewUrl=URL.createObjectURL(blob);
    const frame=this.modal.querySelector('iframe'),loading=this.modal.querySelector('[data-file-loading]');
    frame.addEventListener('load',()=>{loading.hidden=true;frame.setAttribute('aria-busy','false');},{once:true});
    frame.src=this.previewUrl+'#view=FitH';
    const link=this.modal.querySelector('[data-preview-download]');link.href=this.previewUrl;link.download=doc.original_filename;
  }
  project() {return this.projects.find(p=>p.id===this.projectId);}
  openProject(clientId) {
    const client=this.clients.find(item=>item.id===clientId);
    const clientField=client
      ? `<div class="cloud-project-client"><small>${uiText("CLIENTE DEL PROYECTO")}</small><strong>${escape(client.name)}</strong></div><input type="hidden" name="client" value="${client.id}">`
      : `<label class="field">${uiText("Cliente del proyecto")}<select name="client" class="context-box" required><option value="" selected disabled>${uiText("Elige un cliente guardado")}</option>${this.clients.map(item=>`<option value="${item.id}">${escape(item.name)}</option>`).join('')}</select></label>`;
    this.show(uiText("Nuevo proyecto"),`<form data-cloud-form="project">${clientField}<label class="field">${uiText("Nombre del nuevo proyecto")}<input name="name" class="context-box" required maxlength="200" placeholder="${uiText("Por ejemplo: sitio web corporativo")}"></label><h3>${uiText('projectStart.moment')}</h3><div class="project-start-choices">${[['new','sparkles','newTitle','newCopy'],['ongoing','folder-open','ongoingTitle','ongoingCopy']].map(([value,glyph,title,copy])=>`<label class="project-start-choice"><input type="radio" name="project_start" value="${value}" ${value==='new'?'checked':''}><div>${uiIcon(glyph)}<strong>${uiText(`projectStart.${title}`)}</strong><p>${uiText(`projectStart.${copy}`)}</p></div></label>`).join('')}</div><div class="dialog-actions"><button type="submit" class="button">${uiText('projectStart.continue')}${uiIcon('arrow-right')}</button></div></form>`);
    this.modal.classList.add('cloud-project-create-dialog');
  }
  initialSources() {return this.documents.filter(doc=>doc.kind==='initial_agreement');}
  sourceReady(doc) {
    const extraction=Array.isArray(doc.document_extractions)?doc.document_extractions[0]:doc.document_extractions;
    return extraction?.status==='ready';
  }
  openSource(purpose, uploadContext={}) {
    if(this.loading || !this.project()) return;
    const contextFields=Object.entries(uploadContext).filter(([key,value])=>['purpose','revision_id','refund_case_id','snapshot_id','payment_id','request_id'].includes(key)&&value).map(([key,value])=>`<input type="hidden" name="${escape(key)}" value="${escape(value)}">`).join('');
    if(purpose==='reference'){
      this.show(uiText('refund.addReference'),`<p>${uiText('refund.referenceHelp')}</p><form data-cloud-form="upload"><input type="hidden" name="kind" value="reference">${contextFields}<label class="field">${uiText('refund.referenceTitle')}<input name="title" class="context-box" required maxlength="200"></label><label class="field">${uiText('refund.referenceFile')}<input name="file" class="context-box" type="file" accept=".pdf" required></label><p>${uiText("Máximo 10 MB.")}</p><button type="submit" class="button">${uiText('refund.addReference')}</button></form>`);
      return;
    }
    const initial=purpose!=='request';
    if(!initial&&this.requestStatus?.can_register!==true){this.message=this.requestStatus?.can_register===false?uiText("Termina o cierra el pedido abierto de este proyecto antes de registrar otro."):uiText("Estamos comprobando los pedidos del proyecto. Vuelve a intentar en unos momentos.");this.notify();return;}
    if(!initial && !this.initialSources().some(doc=>this.sourceReady(doc))) {this.tab='acuerdo'; this.notify(); return;}
    this.show(initial?uiText("Añade lo conversado"):uiText("Registrar pedido del cliente"),`<p class="cloud-notice">${initial?uiText("Adjunta el contrato o la conversación inicial."):uiText("Adjunta la conversación con el nuevo pedido.")}</p><form data-cloud-form="upload"><input type="hidden" name="kind" value="${initial?'initial_agreement':'email_request'}"><label class="field">${initial?uiText("¿Qué contiene este archivo?"):uiText("¿Qué te pidió el cliente?")}<input name="title" class="context-box" required maxlength="200" placeholder="${initial?uiText("Ej.: conversación sobre alcance y precio"):uiText("Ej.: añadir una sección a la web")}"></label>${initial?'':`<div data-plan-placement data-state="loading" aria-live="polite"><label class="field" for="plan-placement-select">${uiText('planPlacement.question')}</label><select id="plan-placement-select" class="context-box" name="plan_choice" disabled><option>${uiText('planPlacement.loading')}</option></select></div>`}<label class="field">${initial?uiText("Contrato o conversación en PDF o Word"):uiText("Conversación del pedido en PDF o Word")}<input name="file" class="context-box" type="file" accept=".pdf,.docx" required></label><p class="cloud-notice">${uiText("Máximo 10 MB.")}</p><div class="dialog-actions"><button type="submit" class="button">${initial?uiText("Guardar fuente del acuerdo"):uiText("Guardar pedido")} →</button></div></form>`);
    if(!initial)void this.loadPlacementChoices();
  }
  // «Is it about a deliverable of the plan or new work?» Only asked when the project has a saved plan.
  async loadPlacementChoices() {
    const host=this.modal.querySelector('[data-plan-placement]');if(!host)return;
    const id=this.projectId,epoch=this.epoch,live=()=>host.isConnected&&epoch===this.epoch&&id===this.projectId;
    host.dataset.state='loading';
    let plan,progress;
    try{[plan,progress]=await Promise.all([this.request(`/api/v1/ai/projects/${id}/plan`),this.request(`/api/v1/projects/${id}/plan-progress`).catch(error=>{if(error.code==='AI_PLAN_NOT_FOUND'||error.status===404)return null;throw error;})]);}
    catch(error){
      if(!live())return;
      if(error.code==='AI_PLAN_NOT_FOUND'){host.dataset.state='ready';host.innerHTML='';return;}
      host.dataset.state='error';host.innerHTML=`<p class="cloud-error" role="alert">${escape(error.message)}</p><button type="button" class="text-button" data-cloud-action="placement-retry">${uiText('Reintentar')}</button>`;return;
    }
    if(!live())return;
    // A paid deliverable is closed: more work on it is registered as new work, with its own addendum and payment.
    const stages=(plan?.stages||[]).filter(stage=>Number.isInteger(stage.position));
    const paid=new Set((progress?.stages||[]).filter(s=>s.status==='completed').map(s=>s.position));
    const allPaid=stages.length>0&&stages.every(stage=>paid.has(stage.position));
    host.dataset.state='ready';
    host.innerHTML=`<label class="field" for="plan-placement-select">${uiText('planPlacement.question')}</label><select id="plan-placement-select" class="context-box" name="plan_choice" required aria-describedby="plan-placement-help"><option value="" ${allPaid?'':'selected'} disabled>${uiText('planPlacement.choose')}</option><optgroup label="${uiText('planPlacement.stagesGroup')}">${stages.map(stage=>`<option value="stage:${stage.position}" ${paid.has(stage.position)?'disabled':''}>${escape(uiText('planPlacement.stageOption',{position:stage.position,title:stage.title}))}${paid.has(stage.position)?` · ${uiText('planPlacement.closed')}`:''}</option>`).join('')}</optgroup><option value="new" ${allPaid?'selected':''}>${uiText('planPlacement.newWorkShort')}</option></select><p class="cloud-notice plan-placement-help" id="plan-placement-help">${uiText(paid.size?'planPlacement.closedHelp':'planPlacement.help')}</p>`;
    const select=host.querySelector('select'),help=host.querySelector('#plan-placement-help');
    select.addEventListener('change',()=>{help.textContent=uiText(select.value==='new'?'planPlacement.newWorkHelpFull':paid.size?'planPlacement.closedHelp':'planPlacement.help');});
  }
  sourceRows(sources) {
    return sources.map(doc=>`<article class="cloud-client-row"><div><strong>${escape(doc.title)}</strong><p class="cloud-client-meta">${doc.original_filename?escape(doc.original_filename)+' · ':''}${escape(date(doc.created_at))}</p>${this.sourceReady(doc)?'':`<span class="cloud-client-meta">${escape(this.sourceStatusLabel(doc))}</span>`}</div><button class="text-button" data-cloud-action="${this.sourceReady(doc)?'text':'retry'}" data-cloud-id="${doc.id}" ${this.sourceProcessing(doc)?'disabled':''}>${this.sourceReady(doc)?uiText("Ver documento ↗"):this.sourceProcessing(doc)?uiText("Procesando…"):uiText("Reintentar lectura")}</button></article>`).join('');
  }
  requestRows(requests) {
    return [...requests].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).map(doc=>`<article class="cloud-change-row" aria-label="${uiText("Pedido")} ${escape(doc.title)}"><div class="cloud-change-info"><strong>${escape(doc.title)}</strong><time class="cloud-client-meta" datetime="${escape(doc.created_at)}">${escape(date(doc.created_at))}</time><div class="cloud-change-status"><span class="badge review" data-request-status>${uiText("Pedido guardado")}</span><span class="cloud-change-version" data-request-version hidden></span></div></div><div class="cloud-change-action"><button class="button secondary" data-request-primary data-cloud-action="${this.sourceReady(doc)?'review-change':'retry'}" data-cloud-id="${escape(doc.id)}" ${this.sourceProcessing(doc)?'disabled':''}>${this.sourceReady(doc)?uiText("Revisar cambio →"):this.sourceProcessing(doc)?uiText("Procesando…"):uiText("Reintentar lectura")}</button></div></article>`).join('');
  }
  renderAgreement(panel) {
    const sources=[...this.initialSources()].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
    const active=this.requestStatus?.active_request;
    const refund=active?.kind==='refund';
    const proposal=active&&!refund?(this.proposals||[]).find(item=>item.request_document_id===active.id):null;
    const project=this.project();
    const metrics=[['documents',this.documents.length],['changes',this.documents.filter(doc=>doc.kind==='email_request').length],['refunds',project?.refund_totals?.[0]?.count]].filter(([,value])=>Number.isSafeInteger(value)&&value>=0);
    const totals=`<div class="cloud-summary-totals">${metrics.map(([label,value])=>`<div><strong>${new Intl.NumberFormat(uiLocale()).format(value)}</strong><span>${uiText(`projectSummary.metric.${label}`)}</span></div>`).join('')}</div>`;
    const tracking=active?`<section class="cloud-summary-attention" aria-label="${uiText('projectSummary.tracking')}"><span class="cloud-summary-symbol" aria-hidden="true">${uiIcon(refund?'undo-2':'git-compare-arrows')}</span><div><span class="eyebrow">${uiText(refund?'projectSummary.refundPending':'projectSummary.changePending')}</span><h4>${escape(active.title||uiText(refund?'Devoluciones':'Pedido del cliente'))}</h4>${proposal?.business_status?`<p>${escape(uiText(proposal.business_status))}</p>`:''}</div><button type="button" class="button secondary" data-cloud-action="tab" data-cloud-tab="${refund?'devoluciones':'solicitudes'}">${uiText('projectSummary.continue')}${uiIcon('arrow-right')}</button></section>`:'';
    const situation=tracking||`<section class="cloud-summary-current"><span class="eyebrow">${uiText('projectSummary.now')}</span><h4>${uiText(this.requestStatus?.can_register===true?'projectSummary.noOpenRequests':'Estado no disponible')}</h4></section>`;
    panel.innerHTML=`<div class="cloud-project-overview cloud-summary" aria-label="${uiText("Vista general del proyecto")}"><header class="cloud-summary-heading"><h3>${uiText("Resumen del proyecto")}</h3></header><div class="cloud-summary-layout"><section class="workspace-panel cloud-agreement"><div class="cloud-panel-heading"><div><span class="eyebrow">${uiText("ACUERDO INICIAL")}</span><h3>${sources.length?uiText("Lo conversado al inicio"):uiText('projectSummary.noAgreement')}</h3></div></div><p class="cloud-summary-agreement-help">${uiText('projectSummary.agreementHelp')}</p>${sources.length?`<div class="cloud-source-list">${this.sourceRows(sources.slice(0,3))}</div>${sources.length>3?`<button class="text-button cloud-overview-link" data-cloud-action="tab" data-cloud-tab="documentos">${uiText('Ver todas las fuentes')}${uiIcon('arrow-right')}</button>`:''}`:`<button type="button" class="text-button cloud-overview-link" data-cloud-action="tab" data-cloud-tab="plan">${uiText('projectSummary.openPlan')}${uiIcon('arrow-right')}</button>`}</section><aside class="cloud-summary-aside">${situation}<section class="cloud-summary-inventory"><span class="eyebrow">${uiText('projectSummary.inProject')}</span>${totals}</section></aside></div>${this.proposalError?`<p class="cloud-error" role="alert">${uiText('Estado no disponible')}</p>`:''}</div>`;
  }
  renderRequests(panel) {
    // Closed or finalized requests leave the working list; they stay available in «Closed requests».
    const all=this.documents.filter(doc=>doc.kind==='email_request'),archived=all.filter(doc=>this.requestArchived(doc.id)),requests=all.filter(doc=>!this.requestArchived(doc.id));
    const archive=archived.length?`<button type="button" class="text-button cloud-requests-archive-open" data-cloud-action="requests-archive">${uiIcon('history')}${uiText('requestsArchive.open',{count:new Intl.NumberFormat(uiLocale()).format(archived.length)})}</button>`:'';
    panel.innerHTML=`<section class="workspace-panel cloud-requests"><div class="cloud-panel-heading cloud-section-note"><div><span class="eyebrow">${uiText("CAMBIOS DEL PROYECTO")}</span><h3>${uiText("Cambios del acuerdo")}</h3><p>${uiText("Revisa pedidos que modifican el trabajo, el precio o la fecha de entrega.")}</p></div><button class="button" data-cloud-action="upload" data-cloud-purpose="request" ${this.requestStatus?.can_register===true?'':'disabled'}>${uiText("Registrar pedido del cliente")}</button></div>${this.requestStatus?.can_register===false?("<p class=\"cloud-notice\">"+uiText("Termina o cierra el pedido abierto antes de registrar otro en este proyecto.")+"</p>"):''}${this.requestRows(requests) || (archived.length?`<div class="cloud-requests-empty"><span class="cloud-requests-empty-icon" aria-hidden="true">${uiIcon('git-compare-arrows')}</span><div><strong>${uiText('requestsArchive.noneOpen')}</strong><p>${uiText('requestsArchive.noneOpenHelp',{count:new Intl.NumberFormat(uiLocale()).format(archived.length)})}</p></div></div>`:("<div class=\"cloud-empty-sources\"><strong>"+uiText("Aquí irán los nuevos pedidos")+"</strong><p>"+uiText("Cuando tu cliente pida algo adicional, guarda la conversación para revisarla por separado.")+"</p></div>"))}${archive}</section>`;
  }
  requestArchived(id) {
    if(this.requestStatus?.closures?.some(c=>c.request_document_id===id))return true;
    return ['Finalizado','Cerrado'].includes((this.proposals||[]).find(p=>p.request_document_id===id)?.business_status);
  }
  openRequestsArchive() {
    const archived=this.documents.filter(doc=>doc.kind==='email_request'&&this.requestArchived(doc.id));
    this.show(uiText('requestsArchive.title'),`<p class="cloud-notice">${uiText('requestsArchive.help')}</p><div class="cloud-requests-archive">${this.requestRows(archived)}</div>`);
    // Opening one of them leaves the dialog and shows its details in the project.
    this.modal.querySelector('.cloud-requests-archive')?.addEventListener('click',event=>{if(event.target.closest('[data-cloud-action]'))this.modal.close();},true);
  }
  openRequestsArchive() {
    const archived=this.documents.filter(doc=>doc.kind==='email_request'&&this.requestArchived(doc.id));
    this.show(uiText('requestsArchive.title'),`<p class="cloud-notice">${uiText('requestsArchive.help')}</p><div class="cloud-requests-archive">${this.requestRows(archived)}</div>`);
    // Opening one of them leaves the dialog and shows its details in the project.
    this.modal.querySelector('.cloud-requests-archive')?.addEventListener('click',event=>{if(event.target.closest('[data-cloud-action]'))this.modal.close();},true);
  }
  renderRefunds(panel) {
    panel.innerHTML=`<section class="workspace-panel cloud-refunds" aria-label="${uiText("Devoluciones del proyecto")}"><header class="cloud-refund-heading"><span class="cloud-refund-symbol" aria-hidden="true">${uiIcon('undo-2')}</span><div><span class="eyebrow">${uiText("DEVOLUCIONES")}</span><h3>${uiText("Revisar dinero que ya se pagó")}</h3><p>${uiText("Cuando el cliente pide recuperar todo o parte de un pago, revisa el acuerdo, el trabajo realizado y el importe que corresponde proponer.")}</p></div></header><div class="cloud-refund-context"><strong>${uiText("Una devolución parte de un pago recibido.")}</strong><p>${uiText("Si el cliente pide más trabajo o una nueva fecha, corresponde a Cambios. Si pide dinero de vuelta, corresponde a Devoluciones. Una cancelación puede requerir revisar el cierre antes de decidir si hay dinero que devolver.")}</p></div><div class="cloud-refund-trial"><button type="button" class="button" data-cloud-action="refund-preview">${uiText("Probar flujo de devolución")} ${uiIcon('arrow-right')}</button></div></section>`;
  }
  projectNavigation(tab) {
    const selected=['solicitudes','comparar','gestion'].includes(tab)?'solicitudes':['plan','devoluciones','disputas','reuniones','documentos','historial','asistente'].includes(tab)?tab:'acuerdo';
    const sections=[['acuerdo','folder-open',uiText('projectSummary.tab'),uiText("Acuerdo y fuentes iniciales")],['asistente','messages-square',uiText('projectAssistant.nav'),uiText('projectAssistant.navigation')],['plan','wallet',uiText('projectStart.plan'),uiText('projectStart.planNavigation')],['solicitudes','git-compare-arrows',uiText("Cambios"),uiText("Alcance, precio o plazo")],['devoluciones','undo-2',uiText("Devoluciones"),uiText("Dinero de un pago recibido")],['disputas','shield-check',uiText('disputes.nav'),uiText('disputes.navigation')],['reuniones','users',uiText('meeting.nav'),uiText('meeting.navigation')],['documentos','file-text',uiText("Documentos"),uiText("Archivos por pedido")],['historial','history',uiText("Historial del proyecto"),uiText("Historial y mapa")]];
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
    const source=data=>{
      const text=data.segments[0]?.text.trim().replace(/\s+/g,' ')||'';
      const excerpt=text.length>240?text.slice(0,240).trimEnd()+'…':text;
      return `<article class="cloud-comparison-source"><h4><span class="cloud-comparison-file" aria-hidden="true">${uiIcon('file-text')}</span>${escape(data.document.title)}</h4>
        <p class="cloud-fragment">${escape(excerpt||uiText("Este archivo todavía no tiene texto para consultar. Puedes reintentar su lectura desde los archivos del proyecto."))}</p>
        <button type="button" class="text-button" data-cloud-action="text" data-cloud-id="${escape(data.document.id)}">${uiIcon('file-text')}${uiText('changeDraft.viewDocument')}</button></article>`;
    };
    panel.innerHTML=`<section class="workspace-panel cloud-change-review"><button class="text-button" data-cloud-action="tab" data-cloud-tab="${comparison.returnTab||'solicitudes'}">${uiText("← Volver a los pedidos")}</button><div class="cloud-section-note"><span class="eyebrow">${uiText("REVISAR EL CAMBIO")}</span><h3>${escape(comparison.request.title)}</h3><p>${uiText("Compara lo que habían conversado con lo que está pidiendo ahora. Revisa si cambia el trabajo incluido, el costo o las fechas.")}</p></div>${comparison.loading?this.renderSkeleton('project',uiText("Cargando fuentes del proyecto y del pedido…")):comparison.error?`<button class="button secondary" data-cloud-action="review-change" data-cloud-id="${comparison.id}">${uiText("Volver a intentar")}</button>`:`<div class="cloud-comparison-grid"><section class="cloud-comparison-side" data-side="initial" aria-label="${uiText("Información inicial")}"><span class="eyebrow">${uiIcon('folder-open')}${uiText("LO CONVERSADO AL INICIO")}</span>${comparison.sources.map(source).join('')}</section><section class="cloud-comparison-side" data-side="request" aria-label="${uiText("Pedido nuevo")}"><span class="eyebrow">${uiIcon('mail')}${uiText("LO QUE PIDE AHORA")}</span>${source(comparison.requestSource)}</section></div>`}</section>`;
  }
  renderSkeleton(kind='list',label=uiText("Cargando información…")) {
    return `<div class="cloud-loading" role="status" aria-busy="true" aria-label="${escape(label)}"><span class="sr-only">${escape(label)}</span><div aria-hidden="true" class="cloud-skeleton ${kind==='project'?'cloud-skeleton-project':''}"><div class="cloud-skeleton-heading"><span class="cloud-skeleton-line cloud-skeleton-title"></span><span class="cloud-skeleton-line cloud-skeleton-subtitle"></span></div>${[0,1,2].map(()=>`<div class="cloud-skeleton-row"><span class="cloud-skeleton-avatar"></span><div><span class="cloud-skeleton-line"></span><span class="cloud-skeleton-line cloud-skeleton-detail"></span></div><span class="cloud-skeleton-action"></span></div>`).join('')}</div></div>`;
  }
  renderClients() {
    return `<section class="workspace-panel cloud-client-directory" aria-label="${uiText("Tus clientes")}"><div class="library-header"><div><span class="eyebrow">${uiText("TU ESTUDIO")}</span><h3>${uiText("Tus clientes")}</h3></div><button class="text-button" data-cloud-action="refresh">${uiText("Actualizar ↻")}</button></div><div class="cloud-directory-list">${this.clients.map(client=>{
      const count=this.projects.filter(project=>project.client_id===client.id).length;
      return `<article class="cloud-client-row"><div class="cloud-directory-identity"><span class="cloud-directory-avatar" aria-hidden="true">${escape((client.name||client.contact_email||'').slice(0,2).toUpperCase())}</span><div><strong>${escape(client.name)}</strong>${client.contact_email?`<p class="cloud-client-meta">${escape(client.contact_email)}</p>`:''}<span class="cloud-directory-count">${this.projectClientsLoaded.has(client.id)?(count?`${count} ${count===1?uiText("proyecto"):uiText("proyectos")}`:uiText("Sin proyectos todavía")):uiText("Ver proyectos")}</span></div></div><div class="cloud-client-actions"><button class="cloud-icon-button cloud-delete-client" data-cloud-action="client-delete" data-cloud-id="${client.id}" aria-label="${uiText("Eliminar cliente")} ${escape(client.name)}" title="${uiText("Eliminar cliente")} ${escape(client.name)}">${uiIcon('trash-2')}</button><button class="button secondary" data-cloud-action="client-open" data-cloud-id="${client.id}" aria-label="${uiText("Abrir cliente")} ${escape(client.name)}">${uiText("Abrir cliente ↗")}</button></div></article>`;
    }).join('') || `<div class="cloud-clients-empty"><h3>${uiText('clients.emptyTitle')}</h3><p>${uiText('clients.emptyCopy')}</p></div>`}</div></section>`;
  }
  renderHome(workspace) {
    const clients=this.clients.slice(0,2).map(item=>`<button type="button" class="cloud-home-client" data-cloud-action="client-open" data-cloud-id="${escape(item.id)}"><span class="cloud-home-avatar" aria-hidden="true">${escape((item.name||item.contact_email||'').slice(0,2).toUpperCase())}</span><span class="cloud-home-client-text"><strong>${escape(item.name)}</strong>${item.contact_email?`<span>${escape(item.contact_email)}</span>`:''}</span>${uiIcon('arrow-right')}</button>`).join('');
    const clientSection=`<section class="workspace-panel cloud-home-clients"><header><h2>${uiText('home.clients')} <span class="cloud-home-count">${new Intl.NumberFormat(uiLocale()).format(this.clients.length)}</span></h2>${this.clients.length?`<button type="button" class="text-button" data-cloud-action="client">${uiIcon('plus')}${uiText('home.newClient')}</button>`:''}</header>${this.clients.length?`<div class="cloud-home-client-list">${clients}</div>${this.clients.length>2?`<button type="button" class="text-button cloud-home-all" data-cloud-action="clients">${uiText('home.allClients')}${uiIcon('arrow-right')}</button>`:''}`:`<div class="cloud-home-empty"><h3>${uiText('home.startTitle')}</h3><p>${uiText('home.noClients')}</p><button type="button" class="button" data-cloud-action="client">${uiText('home.newClient')}${uiIcon('plus')}</button></div>`}</section>`;
    const tools=[{icon:'star',title:'home.reputationTitle',description:'home.reputationDescription',action:'home.reputationAction',href:'#reputacion',tag:'home.reputationTag'},{icon:'messages-square',title:'home.practiceTitle',description:'home.practiceDescription',action:'home.practiceAction',href:'#ensayos',tag:'home.practiceTag'},
      // The example is a set of sample screens, so it sits with the tools instead of leading the page.
      {icon:'play',title:'home.demoTitle',description:'home.demoDescription',action:'home.demoAction',tag:'home.demoTag'}];
    const link=tool=>tool.href?`<a href="${tool.href}" class="text-button">${uiText(tool.action)}${uiIcon('arrow-right')}</a>`:`<button type="button" class="text-button" data-demo-open>${uiText(tool.action)}${uiIcon('arrow-right')}</button>`;
    workspace.innerHTML=`<div class="cloud-home without-resume">${this.disputeAttentionMarkup?.()||''}${clientSection}<div class="cloud-home-tools">${tools.map(tool=>`<section class="workspace-panel cloud-home-tool"><div class="cloud-home-tool-heading"><span class="cloud-home-tool-icon" aria-hidden="true">${uiIcon(tool.icon)}</span><span class="eyebrow">${uiText(tool.tag)}</span></div><h2>${uiText(tool.title)}</h2><p>${uiText(tool.description)}</p>${link(tool)}</section>`).join('')}</div></div>`;
  }
  async loadClientAgreements() {
    // Every sent addendum addressed to this account's verified email, from any freelancer (checked in the database).
    this.clientNotice='';
    this.clientAgreements=await this.request('/api/v1/portal/account/agreements');
    // Newest first in every list built from it (projects, changes, disputes and problems).
    if(Array.isArray(this.clientAgreements))this.clientAgreements.sort((a,b)=>String(b.sent_at||'').localeCompare(String(a.sent_at||'')));
    void this.loadClientPlans?.();
    void this.loadClientDisputes();
    void this.loadClientProblems();
    void this.loadClientMeetings();
  }
  async loadClientMeetings() {
    // Upcoming Google Meet calls the freelancer scheduled in the client's projects.
    // A quiet reload (back on the tab) keeps the list on screen; only another account starts from empty.
    const epoch=this.epoch;if(this.clientMeetingsOwner!==this.navigationOwner)this.clientMeetings=undefined;this.clientMeetingsOwner=this.navigationOwner;
    try{const value=await this.request('/api/v1/portal/account/meetings');if(epoch!==this.epoch)return;this.clientMeetings=Array.isArray(value)?value:[];}
    catch{if(epoch!==this.epoch)return;this.clientMeetings=[];}
    this.notify();
  }
  async refreshClientMeetings() {
    // Opening the Meetings tab reads the list again in the background, so a call scheduled meanwhile shows up.
    const epoch=this.epoch;
    try{const value=await this.request('/api/v1/portal/account/meetings');if(epoch!==this.epoch||!Array.isArray(value))return;this.clientMeetings=value;this.notify();}catch{}
  }
  async loadClientProblems() {
    // Reports made in Trato about paid addenda: the lists say so, like they say a dispute is open.
    const epoch=this.epoch;
    try{
      const value=await this.request('/api/v1/portal/account/problems');
      if(epoch!==this.epoch)return;
      if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid problems');
      this.clientProblems=value;
    }catch{
      if(epoch!==this.epoch)return;
      // Without this answer the row keeps its payment state; the addendum itself shows the report.
      this.clientProblems=null;
    }
    this.notify();
  }
  async loadClientDisputes() {
    // PayPal answers in seconds: the overview is already on screen and updates when this arrives.
    const epoch=this.epoch;
    // Last answer seen in this browser session shows at once; PayPal's answer then replaces it.
    const key=`${this.session?.key}:client-disputes:${this.navigationOwner}`;
    this.clientDisputes=null;this.clientDisputesFailed=false;
    try{const saved=JSON.parse(this.storage.getItem(key));if(saved&&typeof saved==='object'&&!Array.isArray(saved))this.clientDisputes=saved;}catch{}
    try{
      const started=Date.now();
      const value=await this.request('/api/v1/portal/account/disputes');
      console.info('[Trato] client disputes',{ms:Date.now()-started,disputes:Object.values(value||{}).map(item=>item.status)});
      if(epoch!==this.epoch)return;
      if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid disputes');
      this.clientDisputes=value;
      try{this.storage.setItem(key,JSON.stringify(value));}catch{}
    }catch{
      if(epoch!==this.epoch)return;
      this.clientDisputesFailed=true;
    }
    this.notify();
  }
  clientAgreementState(item) {
    if(item.payment_status==='completed'){
      const state=item.refunded_minor>0?(item.refunded_minor>=item.additional_minor?'refunded':'partiallyRefunded'):'paid';
      return ['paid',`clientAccount.state.${state}`];
    }
    return item.change_requested&&item.status!=='accepted'?['waiting','clientAccount.state.changesRequested']:item.status==='accepted'?(item.additional_minor>0?['pay',item.payment_method==='invoice'?'clientAccount.state.invoiceToPay':'clientAccount.state.toPay']:['done','clientAccount.state.accepted']):['open','clientAccount.state.toReview'];
  }
  // The fix was registered as a new request and paid: only the client's «It's resolved» is missing, so Trato reminds them.
  clientProblemToClose(item) {
    const problem=item.payment_status==='completed'?this.clientProblems?.[item.proposal_id]:null;
    return problem?.status==='open'&&problem.request_paid===true;
  }
  clientAgreementRow(item,{withProject=true}={}) {
    const money=item.additional_minor>0?new Intl.NumberFormat(uiLocale(),{style:'currency',currency:item.currency||'USD'}).format(item.additional_minor/100):uiText('portal.noCharge');
    const inDispute=this.clientDisputes?.[item.proposal_id]&&this.clientDisputes[item.proposal_id].status!=='RESOLVED';
    // A paid addendum's final state depends on PayPal: nothing definitive is shown until that is known.
    const checking=item.payment_status==='completed'&&!this.clientDisputes&&!this.clientDisputesFailed;
    // A closed dispute stays visible: the client sees it ended and whether the money comes back.
    const closed=this.clientDisputes?.[item.proposal_id]?.status==='RESOLVED'?this.clientDisputes[item.proposal_id]:null;
    const buyerWon=['RESOLVED_BUYER_FAVOUR','ACCEPTED'].includes(closed?.outcome);
    const problem=item.payment_status==='completed'?this.clientProblems?.[item.proposal_id]:null;
    const reported=this.clientProblemToClose(item)?['pay','clientAccount.state.problemToClose']:{open:['dispute','clientAccount.state.problemOpen'],unresolved:['dispute','clientAccount.state.problemUnresolved'],resolved:['paid','clientAccount.state.problemResolved']}[problem?.status];
    let [kind,label]=this.clientAgreementState(item);
    if(inDispute)[kind,label]=['dispute','clientAccount.state.inDispute'];
    else if(item.refunded_minor>0){
      if(buyerWon&&item.refunded_minor>=item.additional_minor)label='clientAccount.state.disputeRefunded';
    }else if(checking)[kind,label]=['waiting','clientAccount.state.checking'];
    else if(buyerWon)[kind,label]=['waiting','clientAccount.state.refundVerificationPending'];
    else if(closed)[kind,label]=['paid','clientAccount.state.disputeClosed'];
    else if(reported)[kind,label]=reported;
    // Inside a project, several addenda share a version number: the row names what each one changes.
    const scope=String(item.scope_summary||'').replace(/\s+/g,' ').trim(),about=scope.length>90?scope.slice(0,90).trimEnd()+'…':scope;
    const title=withProject?escape(item.project_name):about?escape(about):uiText('portal.eyebrow',{number:escape(item.revision_no)});
    // When it was sent: the lists come newest first, and the date tells same-version addenda apart.
    const sent=item.sent_at&&Number.isFinite(new Date(item.sent_at).getTime())?` · ${uiText('clientAccount.sentOn',{date:new Intl.DateTimeFormat(uiLocale(),{dateStyle:'medium',timeStyle:'short'}).format(new Date(item.sent_at))})}`:'';
    const meta=(withProject||about?`${uiText('portal.eyebrow',{number:escape(item.revision_no)})} · ${money}`:money)+escape(sent);
    return `<li><button type="button" class="cloud-client-agreement-row" data-cloud-action="client-agreement" data-cloud-id="${escape(item.proposal_id)}"><span class="cloud-client-agreement-text"><strong>${title}</strong><small>${meta}</small></span><span class="cloud-client-agreement-state ${kind}">${uiText(label)}</span>${uiIcon('arrow-right')}</button></li>`;
  }
  renderClientAccount(workspace) {
    // Overview: a summary and the pending actions first. Projects grouped by freelancer live in #acuerdos.
    const steps=['open','review','decide'].map((step,index)=>`<li><span class="cloud-client-step-number" aria-hidden="true">${index+1}</span><span><strong>${uiText(`clientAccount.step.${step}`)}</strong><small>${uiText(`clientAccount.step.${step}Hint`)}</small></span></li>`).join('');
    const timeline=`<section class="workspace-panel cloud-client-steps" aria-label="${uiText('clientAccount.stepsLabel')}"><h3>${uiText('clientAccount.stepsTitle')}</h3><ol>${steps}</ol></section>`;
    const items=this.clientAgreements||[];
    // Deliverables of the work plans count like addenda: a delivery to review, a payment to make, a dispute on its payment.
    const stages=this.clientStageState?(this.clientPlans||[]):[];
    // An upcoming deliverable waits for the freelancer, and an approved one for its payment request: neither asks the client
    // for anything yet, and neither is closed. Only a delivery to review or a payment to make counts here.
    const stageKind=stage=>{const [kind,label]=this.clientStageState(stage);return label==='clientPlan.upcoming'||label==='clientPlan.approved'?'waiting':kind;};
    if(!items.length&&!stages.length){workspace.innerHTML=`<div class="cloud-home cloud-client-account-home"><section class="workspace-panel cloud-home-intro"><img src="/assets/mascot/trato-guide.png" alt="" width="120" height="120"><div><span class="eyebrow">${uiText('clientAccount.eyebrow')}</span><h2>${uiText('clientAccount.emptyTitle')}</h2><p>${uiText('clientAccount.emptyCopy')}</p></div></section>${timeline}</div>`;return;}
    const count=kind=>items.filter(item=>this.clientAgreementState(item)[0]===kind).length+stages.filter(stage=>stageKind(stage)===kind).length;
    const disputed=this.clientDisputes?items.filter(item=>this.clientDisputes[item.proposal_id]&&this.clientDisputes[item.proposal_id].status!=='RESOLVED'):[];
    const stageDispute=stage=>this.clientDisputes?.[`stage:${stage.project_id}:${stage.position}`];
    const disputedStages=this.clientDisputes?stages.filter(stage=>stageDispute(stage)&&stageDispute(stage).status!=='RESOLVED'):[];
    const tiles=[['open','clientAccount.summary.toReview',count('open')],['pay','clientAccount.summary.toPay',count('pay')],['done','clientAccount.summary.closed',count('paid')+count('done')],['dispute','clientAccount.summary.openDisputes',this.clientDisputes?disputed.length+disputedStages.length:null]];
    const pending=items.filter(item=>['open','pay'].includes(this.clientAgreementState(item)[0])||this.clientProblemToClose(item));
    const pendingStages=stages.filter(stage=>['open','pay'].includes(stageKind(stage)));
    const projects=new Set([...items,...stages].map(item=>item.project_id)).size,freelancers=new Set([...items,...stages].map(item=>item.freelancer_email)).size;
    workspace.innerHTML=`<div class="cloud-home cloud-client-account-home"><section class="workspace-panel cloud-client-summary" aria-label="${uiText('clientAccount.summaryLabel')}"><div class="cloud-client-tiles">${tiles.map(([kind,label,value])=>`<div class="cloud-client-tile ${kind}"><strong>${value===null?(this.clientDisputesFailed?'—':'…'):new Intl.NumberFormat(uiLocale()).format(value)}</strong><span>${uiText(label)}</span></div>`).join('')}</div><p class="cloud-client-summary-foot">${uiText('clientAccount.summaryFoot',{projects,freelancers})} <a href="#acuerdos" class="text-button">${uiText('clientAccount.seeProjects')}${uiIcon('arrow-right')}</a></p>${this.clientDisputesFailed?`<p class="cloud-error" role="alert">${uiText('clientAccount.disputesError')}</p>`:disputed.length+disputedStages.length?`<div class="cloud-client-agreements cloud-client-summary-disputes"><h3>${uiText('clientAccount.summary.openDisputes')}</h3><ul>${disputed.map(item=>this.clientAgreementRow(item)).join('')}${disputedStages.map(stage=>this.clientStageRow(stage,{withProject:true})).join('')}</ul></div>`:''}</section>
      <section class="workspace-panel cloud-client-agreements"><h3>${uiText('clientAccount.pendingTitle')}</h3>${pending.length+pendingStages.length?`<ul>${pending.map(item=>this.clientAgreementRow(item)).join('')}${pendingStages.map(stage=>this.clientStageRow(stage,{withProject:true})).join('')}</ul>`:`<p class="cloud-client-empty">${uiText('clientAccount.nothingPending')}</p>`}</section></div>`;
  }
  renderClientAgreement(workspace) {
    // Mounted once per agreement: re-rendering the shell must not reload the addendum or close its dialogs.
    const id=this.clientProposal;
    if(this.agreementHost?.isConnected&&this.agreementHostId===id&&workspace.contains(this.agreementHost))return;
    this.agreementView?.release();
    workspace.innerHTML=`<div class="cloud-breadcrumb"><button class="text-button" data-cloud-action="client-agreement-back">${uiText('portal.backToProjects')}</button></div><div class="portal-embedded" data-agreement-host></div>`;
    this.agreementHost=workspace.querySelector('[data-agreement-host]');this.agreementHostId=id;
    const api=(action,body,{binary=false}={})=>this.request(`/api/v1/portal/account/agreements/${encodeURIComponent(id)}/${action}`,this.json(body),binary);
    const known=this.clientDisputes?.[id];
    // Request a refund sits inside the addendum card, next to Report a problem (client account only).
    this.agreementView=mountAgreement(this.agreementHost,{api,inDisputeHint:!!known&&known.status!=='RESOLVED',paidActions:()=>this.agreementRefundParts?.(id)||{}});
  }
  renderClientProjects(workspace) {
    const groups=new Map();
    for(const item of this.clientAgreements||[]){
      if(!groups.has(item.freelancer_email))groups.set(item.freelancer_email,new Map());
      const projects=groups.get(item.freelancer_email);
      if(!projects.has(item.project_id))projects.set(item.project_id,{name:item.project_name,items:[]});
      projects.get(item.project_id).items.push(item);
    }
    if(!groups.size){workspace.innerHTML=`<section class="workspace-panel cloud-home-intro"><img src="/assets/mascot/trato-guide.png" alt="" width="120" height="120"><div><h2>${uiText('clientAccount.emptyTitle')}</h2><p>${uiText('clientAccount.emptyCopy')}</p></div></section>`;return;}
    workspace.innerHTML=`<div class="cloud-client-projects">${[...groups].map(([email,projects])=>`<section class="workspace-panel cloud-client-freelancer"><header><span class="cloud-directory-avatar" aria-hidden="true">${escape((email||'').slice(0,2).toUpperCase())}</span><div><span class="eyebrow">${uiText('clientAccount.freelancer')}</span><strong>${escape(email)}</strong></div></header>${[...projects.values()].map(project=>`<details class="cloud-client-project" open><summary><strong>${escape(project.name)}</strong><span>${uiText('clientAccount.agreementsCount',{count:project.items.length})}</span></summary><ul class="cloud-client-agreements-list">${project.items.map(item=>this.clientAgreementRow(item,{withProject:false})).join('')}</ul></details>`).join('')}</section>`).join('')}</div>`;
  }
  renderWorkspace(workspace) {
    if(this.state==='loading' || this.directoryLoading || this.restoringNavigation){workspace.innerHTML=`<section class="workspace-panel cloud-initial-loading"><h2 class="sr-only">${uiText("Recuperando tu espacio…")}</h2>${this.renderSkeleton('list',this.active?uiText("Actualizando clientes y proyectos…"):uiText("Cargando clientes y proyectos…"))}</section>`;return;}
    if(!this.active) {
      workspace.innerHTML=`<section class="workspace-panel" aria-label="${uiText("Acceso a tu espacio")}"><h2>${this.state==='loading'?uiText("Recuperando tu espacio…"):this.state==='error'?uiText("Volvamos a conectar"):uiText("Tu espacio empieza aquí")}</h2><p role="status">${escape(this.message || (this.state==='loading'?uiText("Estamos recuperando tus clientes y proyectos."):uiText("Inicia sesión para ver tus clientes y continuar con tus proyectos.")))}</p>${this.state==='loading'?'':`<button class="button" data-cloud-action="${this.state==='error'?'reconnect':'access'}">${this.state==='error'?uiText("Volver a intentar"):uiText("Iniciar sesión o crear cuenta")}</button>`}</section>`; return;
    }
    if(this.role==='client'){this.stopIngestionPolling();if(this.projectMapPanel)this.releaseProjectMap();if(this.location.hash!=='#acuerdos'&&this.clientProposal)this.rememberClientAgreement('');
      // Clients rehearse too: TeTrato plays their freelancer (practice-workspace.mjs picks the client situations from cloud.role).
      if(this.location.hash==='#ensayos'){this.renderPracticeWorkspace(workspace);return;}
      if(this.clientProposal)this.renderClientAgreement(workspace);else if(this.location.hash==='#acuerdos')this.renderClientProjects(workspace);else this.renderClientAccount(workspace);return;}
    if(this.location.hash==='#inicio'||!this.location.hash){this.stopIngestionPolling();if(this.projectMapPanel)this.releaseProjectMap();this.renderHome(workspace);return;}
    if(this.location.hash==='#reputacion'){this.stopIngestionPolling();if(this.projectMapPanel)this.releaseProjectMap();this.renderReputationWorkspace(workspace);return;}
    if(this.location.hash==='#ensayos'){this.stopIngestionPolling();if(this.projectMapPanel)this.releaseProjectMap();this.renderPracticeWorkspace(workspace);return;}
    const client=this.clients.find(c=>c.id===this.clientId), project=this.project();
    if(!client) {workspace.innerHTML=this.renderClients()+`<p class="cloud-notice" role="status" ${this.message?'':'hidden'}>${escape(this.message)}</p>`; return;}
    const projects=this.projects.filter(p=>p.client_id===client.id);
    const toolbar=`<div class="cloud-breadcrumb"><button class="text-button" data-cloud-action="clients">${uiText("← Todos los clientes")}</button>${project?("<span>/</span><button class=\"text-button\" data-cloud-action=\"projects\">"+uiText("Proyectos del cliente")+"</button>"):''}</div>${project?'':`<section class="workspace-panel cloud-client-header" aria-label="${uiText("Cliente seleccionado")}"><div><span class="eyebrow">${uiText("CLIENTE")}</span><h2>${escape(client.name)}</h2><p class="cloud-client-meta">${escape(client.contact_email || '')}${client.contact_email?' · ':''}${projects.length} ${projects.length===1?uiText("proyecto"):uiText("proyectos")}</p></div><button class="button" data-cloud-action="project" data-cloud-id="${client.id}">${uiText("＋ Nuevo proyecto")}</button></section>`}`;
    if(!project) {
      workspace.innerHTML=toolbar+`<section class="workspace-panel cloud-project-directory" aria-label="${uiText("Proyectos del cliente")}"><span class="eyebrow">${uiText("ESPACIO DE TRABAJO")}</span><h3>${uiText("Proyectos de")} ${escape(client.name)}</h3><div class="cloud-project-directory-grid">${this.projectsLoading?this.renderSkeleton('list',uiText("Cargando proyectos…")):projects.map(p=>`<article class="cloud-client-row"><div><strong>${escape(p.name)}</strong><div class="cloud-project-counts">${[['request_totals','changes'],['refund_totals','refunds'],['document_totals','documents']].map(([field,label])=>{const value=p[field]?.[0]?.count;return Number.isSafeInteger(value)&&value>=0?`<span>${uiText(`projectDirectory.${label}`,{count:new Intl.NumberFormat(uiLocale()).format(value)})}</span>`:'';}).join('')}</div></div><div class="cloud-client-actions"><button type="button" class="cloud-icon-button cloud-delete-client" data-cloud-action="project-delete" data-cloud-id="${p.id}" aria-label="${uiText('projectStart.deleteProject')} ${escape(p.name)}" title="${uiText('projectStart.deleteProject')}">${uiIcon('trash-2')}</button><button class="button secondary" data-cloud-action="project-open" data-cloud-id="${p.id}" aria-label="${uiText("Abrir proyecto")} ${escape(p.name)}">${uiText("Abrir proyecto ↗")}</button></div></article>`).join('') || ("<p>"+uiText("Este cliente todavía no tiene proyectos. Crea su primer proyecto para incorporar el acuerdo y los documentos.")+"</p>")}</div></section><p class="cloud-notice" role="status" ${this.message?'':'hidden'}>${escape(this.message)}</p>`; return;
    }
    const tab=this.tab;
    workspace.innerHTML=toolbar+`<div class="cloud-project-picker" ${projects.length<2?'hidden':''}><label class="field" for="cloud-picker">${uiText("Proyecto")}</label><select id="cloud-picker" class="context-box" data-cloud-project>${projects.map(p=>`<option value="${p.id}" ${p.id===this.projectId?'selected':''}>${escape(p.name)}</option>`).join('')}</select></div><div class="client-banner"><span class="client-avatar">${escape((client?.name || '').slice(0,2).toUpperCase())}</span><div><span class="eyebrow">${uiText("PROYECTO")}</span><h2>${escape(project.name)}</h2><p>${escape(client.name)}</p></div><button type="button" class="cloud-icon-button cloud-delete-project" data-cloud-action="project-delete" data-cloud-id="${escape(project.id)}" aria-label="${uiText('projectStart.deleteProject')} ${escape(project.name)}" title="${uiText('projectStart.deleteProject')}">${uiIcon('trash-2')}</button></div>${this.projectNavigation(tab)}<p class="cloud-notice" role="status" ${this.message?'':'hidden'}>${escape(this.message)}</p><div id="client-panel"></div>`;
    const panel=workspace.querySelector('#client-panel');
    if(this.loading) {panel.innerHTML=`<section class="workspace-panel">${this.renderSkeleton('project',uiText("Cargando información del proyecto…"))}</section>`; return;}
    if(tab==='asistente') this.renderProjectAssistant(panel);
    else if(tab==='plan') this.renderProjectPlan(panel);
    else if(tab==='gestion') this.renderChangeManagement(panel);
    else if(tab==='comparar') this.renderChangeReview(panel);
    else if(tab==='revision') this.renderReview(panel);
    else if(tab==='solicitudes') this.renderRequests(panel);
    else if(tab==='documentos') this.renderDocuments(panel);
    else if(tab==='historial') this.renderProjectHistory(panel);
    else if(tab==='devoluciones') this.renderRefunds(panel);
    else if(tab==='disputas') this.renderDisputes(panel);
    else if(tab==='reuniones'&&this.renderMeetings) this.renderMeetings(panel);
    else this.renderAgreement(panel);
  }
  releaseProjectMap() {
    this.projectMapGeneration=(this.projectMapGeneration||0)+1;
    this.projectMapCleanup?.();this.projectMapCleanup=null;
    this.projectMapPanel?.remove();this.projectMapPanel=null;
  }
  invalidateProjectHistory(project) {
    if(project!==this.projectId)return;
    this.historyGeneration++;
    this.historyLoaded=false;
    this.historyPending=null;
    this.historyGroupPending=new Map();
    this.releaseProjectMap();
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
    switch(event.kind){
      case 'project_created':return uiText('history.projectCreated');
      case 'initial_source_added':return uiText('history.initialSource',{title:event.title});
      case 'plan_confirmed':return uiText('history.planConfirmed',{count:event.stages,amount:new Intl.NumberFormat(uiLocale(),{style:'currency',currency:event.currency}).format(event.amount_minor/100)});
      case 'delivery_evidence_added':return uiText('history.deliveryEvidence',{number:event.stage_position});
      case 'dispute_opened':return uiText('history.disputeOpened');
      case 'client_message':return uiText(event.documents?.length?'history.disputeClientMessageDocs':'history.disputeClientMessage',{count:event.documents?.length||0});
      case 'freelancer_message':return uiText(event.evidence?'history.disputeEvidence':event.accepted?'history.disputeAccepted':event.documents?.length?'history.disputeYourMessageDocs':'history.disputeYourMessage',{count:event.documents?.length||0});
      case 'paypal_message':return uiText('history.disputePaypalMessage');
      case 'dispute_status':return uiText(event.outcome==='CANCELED_BY_BUYER'?'history.disputeCanceled':event.outcome==='RESOLVED_SELLER_FAVOUR'?'history.disputeWon':event.outcome==='RESOLVED_BUYER_FAVOUR'?'history.disputeLost':event.status==='RESOLVED'?'history.disputeResolved':event.escalated?'history.disputeEscalated':event.stage&&event.stage!=='INQUIRY'?'history.disputeStage':'history.disputeReview');
      case 'stage_paid':return uiText('history.stagePaid',{number:event.stage_position,amount:new Intl.NumberFormat(uiLocale(),{style:'currency',currency:event.currency}).format(event.amount_minor/100)});
      case 'plan_completed':return uiText('history.planCompleted');
      case 'request_registered':return uiText('history.request');
      case 'adenda_sent':return uiText('history.adenda',{version:event.revision_no});
      case 'acceptance_recorded':return uiText(event.source==='client_portal'?'history.portalAcceptance':'history.acceptance',{version:event.revision_no});
      case 'client_changes_requested':return uiText('history.portalChanges',{version:event.revision_no});
      case 'payment_requested':return uiText('history.paymentRequested');
      case 'invoice_sent':return uiText(event.invoice_number?'history.invoiceSent':'history.invoiceSentPlain',{number:event.invoice_number||''});
      case 'problem_reported':return event.stage_position?uiText('history.problemReportedStage',{number:event.stage_position}):uiText('history.problemReported',{version:event.revision_no});
      case 'problem_message':return uiText(event.author==='client'?'history.problemClientMessage':'history.problemYourMessage');
      case 'problem_request_registered':return uiText('history.problemRequestRegistered',{title:event.new_request_title||''});
      case 'problem_closed':return uiText(event.status==='resolved'?'history.problemResolved':'history.problemUnresolved');
      case 'delivery_shared':return uiText('history.deliveryShared',{number:event.stage_position});
      case 'stage_payment_requested':return uiText(event.invoice?(event.invoice_number?'history.stageInvoiceSent':'history.stageInvoiceSentPlain'):'history.stagePaymentRequested',{number:event.stage_position,invoice:event.invoice_number||''});
      case 'stage_reviewed':return uiText(event.decision==='approved'?'history.stageApproved':'history.stageChangesRequested',{number:event.stage_position});
      case 'payment_completed':return uiText('history.paid',{amount:new Intl.NumberFormat(uiLocale(),{style:'currency',currency:event.currency}).format(event.amount_minor/100)});
      case 'request_closed':return uiText(event.reason==='rejected'?'history.closedRejected':event.reason==='withdrawn'?'history.closedWithdrawn':'history.closed');
      case 'refund_requested':return uiText('history.refundRequested');
      case 'refund_proposal_sent':return uiText('history.refundSent',{version:event.revision_no});
      case 'refund_feedback_reviewed':return uiText('history.refundFeedback',{version:event.revision_no});
      case 'refund_acceptance_recorded':return uiText('history.refundAccepted',{version:event.revision_no});
      case 'refund_financial_authorized':return uiText('history.refundAuthorized');
      case 'dispute_refund_confirmed':return uiText('history.disputeRefundConfirmed',{amount:new Intl.NumberFormat(uiLocale(),{style:'currency',currency:event.currency}).format(event.amount_minor/100)});
      case 'refund_completed':return uiText('history.refundCompleted',{amount:new Intl.NumberFormat(uiLocale(),{style:'currency',currency:event.currency}).format(event.amount_minor/100)});
      case 'refund_closed':return uiText('history.refundClosed');
      default:throw Error('Unsupported project activity: '+event.kind);
    }
  }
  async loadHistoryGroup(group) {
    const key=group.group_kind+':'+group.group_id,signature=group.last_at+':'+group.event_count;
    const cached=this.historyGroupData.get(key);if(cached?.signature===signature)return cached.events;
    if(this.historyGroupPending.has(key))return this.historyGroupPending.get(key);
    const project=this.projectId,epoch=this.epoch,generation=this.historyGeneration;
    const current=()=>this.active&&this.projectId===project&&this.epoch===epoch&&this.historyGeneration===generation;
    const pending=(async()=>{
      const events=await this.request(`/api/v1/projects/${project}/activity/groups/${group.group_kind}/${encodeURIComponent(group.group_id)}`);
      if(!Array.isArray(events)||events.some(e=>e.group_kind!==group.group_kind||e.group_id!==group.group_id||typeof e.id!=='string'))throw Error(uiText('history.groupError'));
      if(current()){
        this.historyGroupData.set(key,{signature,events});
        this.projectActivity=[...this.historyGroupData.values()].flatMap(g=>g.events);
      }
      return events;
    })();
    this.historyGroupPending.set(key,pending);
    try{return await pending;}finally{if(current()&&this.historyGroupPending.get(key)===pending)this.historyGroupPending.delete(key);}
  }
  async fillHistoryGroup(panel,details,group) {
    const body=details.querySelector('.cloud-history-days'),project=this.projectId,epoch=this.epoch,generation=this.historyGeneration;
    if(!body)return;
    const current=()=>this.active&&this.projectId===project&&this.epoch===epoch&&this.historyGeneration===generation&&details.isConnected!==false&&details.open;
    body.innerHTML=`<p role="status" class="cloud-notice">${uiText('history.loadingGroup')}</p>`;
    try{
      const events=await this.loadHistoryGroup(group);
      if(current()){body.innerHTML=this.renderHistoryGroup({events});body.dataset.historyRendered='true';}
    }catch(error){if(current())body.innerHTML=`<p class="cloud-error" role="alert">${uiText('history.groupError')}</p><button type="button" class="text-button" data-cloud-action="history-group-retry">${uiText('history.retryGroup')}</button>`;}
  }
  renderHistoryGroup(group) {
    const icons={dispute_opened:'flag',client_message:'mail',freelancer_message:'send',paypal_message:'mail',dispute_status:'shield-check',dispute_refund_confirmed:'undo-2',project_created:'folder-open',initial_source_added:'file-text',plan_confirmed:'layout-dashboard',delivery_evidence_added:'file-check',stage_paid:'credit-card',plan_completed:'circle-check',request_registered:'file-text',adenda_sent:'send',acceptance_recorded:'file-text',client_changes_requested:'messages-square',payment_requested:'mail',invoice_sent:'mail',problem_reported:'flag',problem_message:'messages-square',problem_request_registered:'file-text',problem_closed:'check',delivery_shared:'send',stage_reviewed:'circle-check',stage_payment_requested:'mail',payment_completed:'credit-card',request_closed:'x',refund_requested:'undo-2',refund_proposal_sent:'send',refund_feedback_reviewed:'file-text',refund_acceptance_recorded:'file-text',refund_financial_authorized:'credit-card',refund_completed:'credit-card',refund_closed:'check'};
    const dayFormat=new Intl.DateTimeFormat(uiLocale(),{dateStyle:'long',timeZone:'America/Lima'});
    const clockFormat=new Intl.DateTimeFormat(uiLocale(),{timeStyle:'short',timeZone:'America/Lima'});
    const valid=value=>value&&Number.isFinite(Date.parse(value));
    const days=new Map();
    for(const event of group.events){
      const day=valid(event.created_at)?dayFormat.format(new Date(event.created_at)):uiText("Fecha no registrada");
      if(!days.has(day))days.set(day,[]);days.get(day).push(event);
    }
    return `${[...days].map(([day,events])=>`<section class="cloud-history-day"><h4>${escape(day)}</h4><ol class="cloud-project-timeline">${events.map(event=>`<li class="cloud-project-event" data-activity-kind="${escape(event.kind)}"><button type="button" class="cloud-history-event-button" data-cloud-action="history-event" data-cloud-id="${escape(event.id)}"><span class="cloud-project-event-icon" aria-hidden="true">${uiIcon(icons[event.kind])}</span><strong>${escape(this.activityLabel(event))}</strong><time datetime="${escape(event.created_at)}">${valid(event.created_at)?escape(clockFormat.format(new Date(event.created_at))):''}</time></button></li>`).join('')}</ol></section>`).join('')}`;
  }
  renderHistory(panel) {
    const groups=new Map((this.projectHistoryGroups||[]).map(group=>[group.group_kind+':'+group.group_id,{...group,kind:group.group_kind,id:group.group_id,title:group.group_title??uiText('history.externalRefund')} ]));
    if(this.historyOpenProject!==this.projectId){this.historyOpenProject=this.projectId;this.historyOpen=new Set();}
    const opened=this.historyOpen||new Set();
    const content=[...groups.values()].map(group=>{
      const open=opened.has(group.kind+':'+group.id),cached=this.historyGroupData?.get(group.kind+':'+group.id);
      return `<details class="cloud-history-request" data-activity-group-kind="${escape(group.kind)}" data-activity-group-id="${escape(group.id)}" ${open?'open':''}><summary><span class="cloud-history-chevron" aria-hidden="true">${uiIcon('chevron-right')}</span><span class="cloud-history-request-title">${escape(group.title)}<small>${uiText(group.kind==='refund'?'history.refundGroup':group.kind==='project'?'history.projectGroup':group.kind==='dispute'?'history.disputeGroup':'history.changeGroup')}${group.plan_placement==='stage'&&Number.isInteger(group.plan_stage_position)?` · ${uiText('planPlacement.stage',{position:group.plan_stage_position})} ${escape(group.plan_stage_title||'')}`:group.plan_placement==='new'?` · ${uiText('planPlacement.newWorkShort')}`:''} · ${group.event_count} ${group.event_count===1?uiText("movimiento"):uiText("movimientos")}</small></span><time datetime="${escape(group.last_at)}">${escape(date(group.last_at))}</time></summary><div class="cloud-history-days" ${open&&cached?'data-history-rendered="true"':''}>${open&&cached?this.renderHistoryGroup(cached):''}</div></details>`;
    }).join('');
    panel.historyGroups=groups;
    panel.innerHTML=`<div class="cloud-project-activity">${content?`<div class="cloud-history-groups">${content}</div>`:("<p class=\"cloud-notice\">"+uiText('history.empty')+"</p>")}</div>`;
    if(panel.dataset&&!panel.dataset.historyToggle){
      panel.dataset.historyToggle='1';
      panel.addEventListener('toggle',event=>{
        const details=event.target;if(!details.matches?.('details.cloud-history-request'))return;
        const key=details.dataset.activityGroupKind+':'+details.dataset.activityGroupId;
        const body=details.querySelector('.cloud-history-days'),group=panel.historyGroups.get(key);
        if(details.open&&group&&body&&!body.dataset.historyRendered)void this.fillHistoryGroup(panel,details,group);
        this.historyOpen=new Set([...panel.querySelectorAll('details.cloud-history-request[open]')].map(item=>item.dataset.activityGroupKind+':'+item.dataset.activityGroupId));
      },true);
    }
  }

  historyDocuments(event) {
    if(event.kind==='project_created')return this.documents.filter(doc=>doc.kind==='initial_agreement');
    if(['initial_source_added','delivery_evidence_added','stage_paid'].includes(event.kind))return this.documents.filter(doc=>doc.id===event.document_id);
    if(event.kind==='request_registered')return this.documents.filter(doc=>doc.id===event.request_document_id);
    // Files sent with this dispute message: the link is recorded by Trato within moments of PayPal posting the message.
    if(event.kind==='freelancer_message'&&event.documents?.length)return this.documents.filter(doc=>(doc.dispute_links||[]).some(link=>link.dispute_id===event.group_id&&link.role==='sent'&&Math.abs(Date.parse(link.created_at)-Date.parse(event.created_at))<300000));
    // A business event is not a document. Only use explicit scoped associations.
    const roles={adenda_sent:['addendum'],acceptance_recorded:['acceptance'],refund_requested:['request'],refund_proposal_sent:['proposal'],refund_feedback_reviewed:['feedback'],refund_acceptance_recorded:['acceptance']};
    if(!roles[event.kind])return [];
    return this.documents.filter(doc=>event.group_kind==='refund'
      ?(doc.refund_links||[]).some(link=>link.settlement_id===event.group_id&&roles[event.kind].includes(link.role)&&(event.revision_no==null||link.version_no===event.revision_no))
      :(doc.request_links||[]).some(link=>link.request_document_id===event.request_document_id&&roles[event.kind].includes(link.role)&&(event.revision_no==null||link.revision_no===event.revision_no)));
  }
  openHistoryEvent(id) {
    const event=this.projectActivity.find(item=>item.id===id);if(!event)return;
    const documents=this.historyDocuments(event);
    this.show(this.activityLabel(event),`<section class="cloud-history-detail"><p class="cloud-history-case">${escape(event.group_title??event.request_title??uiText('history.externalRefund'))}</p><time datetime="${escape(event.created_at)}">${escape(date(event.created_at))}</time>${documents.length?`<section class="cloud-history-documents"><h3>${uiText('history.relatedDocuments')}</h3>${documents.map(doc=>`<button type="button" class="cloud-history-document" data-cloud-action="history-document" data-cloud-id="${escape(doc.id)}" data-cloud-event-id="${escape(event.id)}">${uiIcon('file-text')}<span>${escape(doc.title)}</span>${uiIcon('arrow-up-right')}</button>`).join('')}</section>`:''}</section>`);
    this.modal.classList.add('cloud-history-dialog');
  }


  documentProcessingNotice(doc) {
    const state=this.documentProcessingJobs.get(`${this.navigationOwner}:${this.projectId}:${doc.id}`)?.state;
    if(state&&['queued','running'].includes(state.status))return renderAIActivity({label:uiText('documentRecovery.processing'),compact:true});
    const outcome=state?.status==='completed'?state.result:doc.processing_outcome;
    if(outcome&&['rejected','needs_clarification'].includes(outcome.status))return `<p class="cloud-document-processing-review" role="status">${uiText('documentRecovery.review')}</p>`;
    if(state&&['failed','unavailable'].includes(state.status)||outcome?.status==='error')return `<div class="cloud-document-processing-error" role="alert"><span>${uiText('documentRecovery.failed')}</span><button type="button" class="text-button" data-cloud-action="reprocess-document" data-cloud-id="${escape(doc.id)}">${uiIcon('refresh-cw')}${uiText('projectAssistant.retry')}</button></div>`;
    return '';
  }
  async retryDocumentProcessing(id) {
    const doc=this.documents.find(file=>file.id===id);
    if(!this.active||!doc||!this.sourceReady(doc)){console.info('[Trato] reprocess skipped',{active:!!this.active,found:!!doc,sourceReady:!!doc&&this.sourceReady(doc)});return;}
    const owner=this.navigationOwner,project=this.projectId,key=`${owner}:${project}:${id}`;
    const existing=this.documentProcessingJobs.get(key)?.state;
    const outcome=existing?.status==='completed'?existing.result:doc.processing_outcome;
    if(outcome&&['rejected','needs_clarification'].includes(outcome.status)||!existing&&outcome?.status!=='error'){
      console.info('[Trato] reprocess skipped',{outcome:outcome?.status??null,existing:existing?.status??null});return;
    }
    let job=this.documentProcessingJobs.get(key);
    if(!job){job=new AIJobClient({cloud:this,scope:`document-recovery:${project}:${id}`,onChange:state=>{
      if(state.status==='completed'&&(state.result?.kind!=='file_processing'||state.result?.file_id!==id||!['processed','rejected','needs_clarification'].includes(state.result?.status)))throw Object.assign(new Error('AI_JOB_INVALID'),{code:'AI_JOB_INVALID'});
      if(this.active&&this.navigationOwner===owner&&this.projectId===project&&this.tab==='documentos')this.notify();
    }});this.documentProcessingJobs.set(key,job);}
    this.documentLibraryOpenGroups={project,groups:new Set([...this.document.querySelectorAll('.cloud-document-group[open]')].map(group=>group.dataset.documentKind+':'+(group.dataset.documentRequest||'')))};
    await job.start(`/api/v1/projects/${project}/documents/${id}/process`,{output_language:uiLanguage()});
  }
  renderDocuments(panel) {
    const oldest=(a,b)=>new Date(a.created_at)-new Date(b.created_at)||String(a.id||'').localeCompare(String(b.id||''));
    const newest=(a,b)=>oldest(b,a);
    const requests=new Map(this.documents.filter(doc=>doc.kind==='email_request').map(doc=>[doc.id,{kind:'request',id:doc.id,title:doc.title,created_at:doc.created_at,docs:[{...doc,documentRole:uiText("Pedido del cliente"),documentOrder:0}]}]));
    const initial=[],stageEvidence=[],other=[],unlinked=[],pendingRefund=[],refundGroups=new Map(),disputeGroups=new Map();
    for(const doc of this.documents){
      // A document also shown under a dispute keeps its usual group; the link adds a place, it does not move the file.
      for(const link of doc.dispute_links||[]){
        if(!disputeGroups.has(link.dispute_id))disputeGroups.set(link.dispute_id,{kind:'dispute',id:link.dispute_id,title:uiText('documentLibrary.disputeGroup',{case:link.dispute_id}),created_at:link.created_at,docs:[]});
        const group=disputeGroups.get(link.dispute_id),documentRole=uiText(`documentLibrary.disputeRole.${['sent','received'].includes(link.role)?link.role:'uploaded'}`),existing=group.docs.find(item=>item.id===doc.id);
        if(existing){if(!existing.documentRole.includes(documentRole))existing.documentRole+=` / ${documentRole}`;}
        else group.docs.push({...doc,documentRole,documentOrder:{sent:1,received:2}[link.role]??3});
      }
      if(doc.kind==='email_request')continue;
      if(doc.kind==='initial_agreement'){initial.push(doc);continue;}
      if(doc.kind==='delivery'&&doc.upload_context?.stage_position){stageEvidence.push(doc);continue;}
      if(doc.refund_links?.length){
        for(const link of doc.refund_links){
          if(!refundGroups.has(link.settlement_id))refundGroups.set(link.settlement_id,{kind:'refund',id:link.settlement_id,title:uiText('refundDoc.closureDocuments'),created_at:link.case_created_at,docs:[]});
          refundGroups.get(link.settlement_id).docs.push({...doc,documentRole:uiText(`refundDoc.role.${link.role}`)+(link.version_no?' · v'+link.version_no:''),documentVersion:link.version_no,documentOrder:{proposal:1,feedback:2,acceptance:3}[link.role]??4});
        }
        if(!doc.request_links?.length)continue;
      }
      if(!doc.refund_links?.length&&['refund_request','refund_evidence'].includes(doc.upload_context?.purpose)){pendingRefund.push(doc);continue;}
      const links=doc.request_links || [];
      if(!links.length){if(!doc.dispute_links?.length)(doc.kind==='addendum'?unlinked:other).push(doc);continue;}
      for(const link of links){
        if(!requests.has(link.request_document_id))requests.set(link.request_document_id,{kind:'request',id:link.request_document_id,title:uiText("Pedido vinculado · fuente no incluida en esta lista"),docs:[]});
        const group=requests.get(link.request_document_id);
        const role={addendum:uiText("Adenda"),acceptance:uiText("Aceptación"),feedback:uiText("Respuesta del cliente"),response:uiText('documentLibrary.returned'),reference:uiText('Referencia')}[link.role];
        const documentRole=role+(link.revision_no?` · v${link.revision_no}`:'');
        const existing=group.docs.find(item=>item.id===doc.id);
        if(existing){if(!existing.documentRole.includes(documentRole))existing.documentRole+=` / ${documentRole}`;}
        else group.docs.push({...doc,documentRole,documentVersion:link.revision_no,documentOrder:{addendum:1,feedback:2,response:3,acceptance:3,reference:4}[link.role]??4});
      }
    }
    const groups=[...requests.values(),...refundGroups.values(),...disputeGroups.values()];
    groups.sort((a,b)=>oldest({id:a.id,created_at:a.created_at??[...a.docs].sort(oldest)[0]?.created_at},{id:b.id,created_at:b.created_at??[...b.docs].sort(oldest)[0]?.created_at}));
    const sections=initial.length?[{kind:'initial_agreement',title:uiText("Acuerdo inicial"),docs:initial.sort(newest)}]:[];
    if(stageEvidence.length)sections.push({kind:'plan_delivery',title:uiText('planPayment.evidenceGroup'),docs:stageEvidence.sort(newest)});
    for(const group of groups){
      group.docs.sort(newest);
      sections.push(group);
    }
    if(pendingRefund.length)sections.push({kind:'refund_pending',title:uiText('documentLibrary.pendingRefund'),docs:pendingRefund.sort(newest)});
    if(other.length)sections.push({kind:'reference',title:uiText("Otros documentos del proyecto"),docs:other.sort(newest)});
    if(unlinked.length)sections.push({kind:'unlinked',title:uiText("Adendas sin pedido vinculado"),docs:unlinked.sort(newest)});
    const row=doc=>{
      const extraction=Array.isArray(doc.document_extractions)?doc.document_extractions[0]:doc.document_extractions;
      return `<div class="cloud-document-row"><button type="button" class="document-button" data-cloud-action="text" data-cloud-id="${escape(doc.id)}" title="${uiText("Ver")} ${escape(doc.title)}"><span class="cloud-document-file-icon" aria-hidden="true">${uiIcon('file-text')}</span><span class="cloud-document-file"><strong>${escape(doc.title)}</strong><small>${doc.documentRole?escape(doc.documentRole)+' · ':''}${doc.mime_type==='application/pdf'?'PDF':'Word'} · ${escape(date(doc.created_at))}</small>${extraction?.status!=='ready'?`<span class="cloud-document-read-status" data-document-status>${extraction?.status==='error'?uiText("Lectura pendiente"):uiText("Pendiente de lectura")}</span>`:''}</span></button>${this.documentProcessingNotice(doc)}<div class="cloud-document-actions"><button class="cloud-icon-button" data-cloud-action="download" data-cloud-id="${escape(doc.id)}" aria-label="${uiText("Descargar original")} ${escape(doc.title)}" title="${uiText("Descargar original")}">${uiIcon('download')}</button><button class="cloud-icon-button" data-cloud-action="document-role" data-cloud-id="${escape(doc.id)}" aria-label="${uiText('documentFix.roleFor',{name:doc.title})}" title="${uiText('documentFix.role')}">${uiIcon('pencil')}</button><button class="cloud-icon-button cloud-document-remove" data-cloud-action="document-remove" data-cloud-id="${escape(doc.id)}" aria-label="${uiText('documentFix.removeFor',{name:doc.title})}" title="${uiText('documentFix.remove')}">${uiIcon('trash-2')}</button>${extraction?.status!=='ready'?`<button class="cloud-icon-button" data-cloud-action="retry" data-cloud-id="${escape(doc.id)}" aria-label="${uiText("Reintentar lectura de")} ${escape(doc.title)}" title="${uiText("Reintentar lectura")}">${uiIcon('refresh-cw')}</button>`:''}</div></div>`;
    };
    const content=sections.map(({kind,id,title,docs},index)=>`<details class="cloud-document-group" data-document-kind="${kind}" ${id?`data-document-request="${escape(id)}"`:''} ${this.documentLibraryOpenGroups?.project===this.projectId?(this.documentLibraryOpenGroups.groups.has(kind+':'+(id||''))?'open':''):index===0?'open':''}><summary><span class="cloud-document-chevron" aria-hidden="true">${uiIcon('chevron-right')}</span><span>${kind==='request'?uiText('Pedido ·')+' ':''}${escape(title)}</span><span class="cloud-document-count">${docs.length} ${docs.length===1?uiText("archivo"):uiText("archivos")}</span></summary><div class="document-list">${docs.map(row).join('')}</div></details>`).join('');
    // The list redraws whenever a document changes: what the person opened or closed must survive it.
    if(panel.dataset&&panel.addEventListener&&!panel.dataset.documentGroupToggle){
      panel.dataset.documentGroupToggle='1';
      panel.addEventListener('toggle',event=>{
        if(!event.target.matches?.('.cloud-document-group'))return;
        this.documentLibraryOpenGroups={project:this.projectId,groups:new Set([...panel.querySelectorAll('.cloud-document-group[open]')].map(group=>group.dataset.documentKind+':'+(group.dataset.documentRequest||'')))};
      },true);
    }
    panel.innerHTML=`<div class="knowledge-layout document-library"><div class="workspace-panel"><div class="library-header"><div><span class="eyebrow">${uiText("BASE DE CONOCIMIENTO")}</span><h3>${uiText("Documentos del proyecto")}</h3></div></div><div class="cloud-library-meta"><span>${this.documents.length} ${this.documents.length===1?uiText("archivo"):uiText("archivos")}</span><span>${uiText('documentLibrary.order')}</span></div><div class="cloud-doc-groups">${content || ("<p class=\"cloud-section-note\">"+uiText("Los archivos que añadas al proyecto aparecerán aquí.")+"</p>")}</div></div></div>`;
  }

  syncChrome() {
    if(!this.profile) return;
    const active=this.active, connected=this.handlesView;
    if(!this.clientButton) {
      const title=this.$('#page-title'), row=this.document.createElement('div'); row.className='cloud-title-row';
      title.before(row); row.append(title);
      this.clientButton=this.document.createElement('button'); this.clientButton.className='button';
      this.clientButton.type='button'; this.clientButton.dataset.cloudAction='client'; this.clientButton.textContent=uiText("＋ Nuevo cliente");
      row.append(this.clientButton);
    }
    const workspaceView=['#clientes','#conversaciones','#kb','#ensayos','#reputacion'].includes(this.location.hash);
    this.document.body.classList.toggle('cloud-design',connected);
    this.document.body.classList.toggle('cloud-project-view',connected&&active&&workspaceView&&!['#ensayos','#reputacion'].includes(this.location.hash)&&!!this.project());
    this.document.body.classList.toggle('cloud-client-view',connected&&active&&workspaceView&&!['#ensayos','#reputacion'].includes(this.location.hash)&&!!this.clientId);
    const clientAccount=active&&this.role==='client';
    this.document.body.classList.toggle('cloud-client-account',clientAccount);
    this.clientButton.hidden=clientAccount || !active || !workspaceView || !!this.clientId || ['#ensayos','#reputacion'].includes(this.location.hash);
    if(clientAccount&&this.location.hash==='#ensayos'){this.$('#page-title').textContent=uiText('practice.title');this.$('#page-description').textContent=uiText('practice.subtitle');}
    else if(clientAccount){const projectsView=this.location.hash==='#acuerdos';this.$('#page-title').textContent=uiText(projectsView?'Mis proyectos':'clientAccount.title');this.$('#page-description').textContent=uiText(projectsView?'clientAccount.projectsSubtitle':'clientAccount.subtitle');}
    else if(active&&(this.location.hash==='#inicio'||!this.location.hash)){this.$('#page-title').textContent=uiText('home.title');this.$('#page-description').textContent=uiText('home.subtitle');}
    else if(active&&this.location.hash==='#reputacion'){this.$('#page-title').textContent=uiText('reputation.title');this.$('#page-description').textContent=uiText('reputation.subtitle');}
    else if(active&&this.location.hash==='#ensayos'){this.$('#page-title').textContent=uiText('practice.title');this.$('#page-description').textContent=uiText('practice.subtitle');}
    else if(active && workspaceView) {this.$('#page-title').textContent=this.project()?.name || (this.clientId?this.clients.find(c=>c.id===this.clientId)?.name:uiText("Clientes"));this.$('#page-description').textContent=this.project()?uiText("Tu información inicial y los nuevos pedidos, en el mismo espacio."):this.clientId?uiText("Los proyectos y acuerdos de este cliente."):uiText("Cada cliente tiene sus proyectos. Elige uno para entrar a su espacio de trabajo.");}
    this.profile.textContent=active?(this.session.session.user.email || this.profileInitials).slice(0,2).toUpperCase():this.profileInitials;
    this.profile.setAttribute('aria-label',active?uiText("Mi perfil · sesión iniciada"):uiText("Mi perfil · iniciar sesión")); this.profile.title=active?uiText("Tu perfil"):uiText("Iniciar sesión");
    this.$('.top-actions .demo-pill').innerHTML=`<i></i>${uiText(active?"Espacio conectado":this.state==='loading'?"Conectando…":"Tu espacio")}`;
    if(!active){
      this.$('#page-title').textContent=uiText("Tu espacio en Trato");
      this.$('#page-description').textContent=uiText("Tus clientes, proyectos y acuerdos en un solo lugar.");
    }
    this.$('.footer span:last-child').textContent=clientAccount?uiText('clientAccount.footer'):uiText("Tu estudio · Clientes, proyectos y acuerdos");
    const eyebrow=this.$('.page-heading .eyebrow');
    if(eyebrow){this.defaultEyebrow??=eyebrow.textContent;eyebrow.textContent=clientAccount?uiText('clientAccount.pageEyebrow'):this.defaultEyebrow;}
  }
}

export const createConnectedWorkspace = options => new ConnectedWorkspace(options);
