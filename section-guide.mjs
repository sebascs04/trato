import {uiText,uiLocale} from './i18n.mjs';
import {icon} from './icons.mjs';
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const step=(key,selector)=>({key,selector});
const navigation=step('navigation','.cloud-project-navigation');
export const sectionGuides=Object.freeze({
 home:[step('home','#client-workspace'),step('homeResume','.cloud-home-resume'),step('homeClients','.cloud-home-clients')],
 clients:[step('clients','.cloud-client-directory'),step('clientCreate','[data-cloud-action="client"]')],
 projects:[step('projects','.cloud-project-directory'),step('projectCreate','[data-cloud-action="project"]')],
 project:[step('project','.cloud-project-overview'),step('initial','.cloud-agreement'),navigation],
 assistant:[step('assistant','#client-panel'),step('assistantQuestion','[data-project-question]'),step('assistantSources','.project-assistant-sources')],
 plan:[step('plan','#client-panel'),step('planStages','.plan-editor'),navigation],
 requests:[step('requests','.cloud-requests'),step('requestCreate','[data-cloud-purpose="request"]'),navigation],
 comparison:[step('comparison','.cloud-change-review'),step('comparisonSources','.cloud-comparison-grid'),navigation],
 change:[step('change','#client-panel'),step('changeSources','.cloud-project-navigation'),navigation],
 refunds:[step('refunds','.cloud-refunds'),step('refundOriginal','.cloud-refund-context'),navigation],
 documents:[step('documents','.document-library'),step('documentGroups','.cloud-document-group'),navigation],
 history:[step('history','.cloud-project-history'),step('historyViews','.cloud-history-views'),navigation],
 map:[step('map','[data-cloud-map]'),step('historyViews','.cloud-history-views'),navigation],
 practice:[step('practice','#client-workspace'),step('practiceSettings','.practice-form')],
 practiceConversation:[step('practiceConversation','.practice-conversation'),step('practiceReply','[data-practice-chat]'),step('practiceSections','.practice-stepper')],
 practiceAnalysis:[step('practiceAnalysis','.practice-finished'),step('practiceEvidence','.practice-evaluation'),step('practiceSections','.practice-stepper')],
 reputation:[step('reputation','#client-workspace'),step('reputationPurpose','#page-description')]
});
export function guideScope(cloud){
 if(!cloud.active||cloud.state!=='ready'||!cloud.session?.session||cloud.loading||cloud.directoryLoading||cloud.projectsLoading||cloud.proposalLoading)return null;
 const hash=cloud.location.hash||'#inicio';
 if(hash==='#inicio')return {kind:'home',key:'home'};
 if(hash==='#ensayos'){
  const kind=cloud.document?.querySelector('.practice-finished')?'practiceAnalysis':cloud.document?.querySelector('.practice-conversation')?'practiceConversation':'practice';
  return {kind,key:kind};
 }
 if(hash==='#reputacion')return {kind:'reputation',key:'reputation'};
 if(!['#clientes','#kb','#conversaciones'].includes(hash))return null;
 if(!cloud.projectId)return {kind:cloud.clientId?'projects':'clients',key:'clients:'+cloud.clientId};
 const kind={acuerdo:'project',asistente:'assistant',plan:'plan',solicitudes:'requests',comparar:'comparison',gestion:'change',devoluciones:'refunds',documentos:'documents',historial:cloud.historyView==='map'?'map':'history'}[cloud.tab];
 return kind?{kind,key:[cloud.projectId,kind,cloud.requestId||''].join(':')}:null;
}
export function installSectionGuide(cloud){
 const doc=cloud.document,win=doc.defaultView;
 const root=doc.createElement('div');root.className='section-guide';root.hidden=true;
 root.innerHTML=`<div class="guide-highlight" hidden aria-hidden="true"></div><section class="guide-panel" id="trato-section-guide" role="region" aria-labelledby="guide-step-title" hidden><header><span class="guide-avatar" aria-hidden="true"><img class="guide-mascot" src="/assets/mascot/trato-guide.png" alt="" width="96" height="96" decoding="async"></span><div><strong>${uiText('guide.name')}</strong><span>${uiText('guide.section')}</span></div><button type="button" class="guide-close" data-guide-close aria-label="${uiText('guide.close')}" title="${uiText('guide.close')}">${icon('x')}</button></header><div class="guide-copy" aria-live="polite" aria-atomic="true"><p class="guide-progress"></p><h3 id="guide-step-title" tabindex="-1"></h3><p class="guide-explanation"><span class="guide-lead"></span><span class="guide-support"></span></p></div><footer><button type="button" class="guide-previous" data-guide-previous>${icon('arrow-left')}${uiText('guide.previous')}</button><button type="button" class="guide-next" data-guide-next></button></footer></section><button type="button" class="guide-launcher" data-guide-open aria-controls="trato-section-guide" aria-expanded="false" aria-label="${uiText('guide.open')}" title="${uiText('guide.open')}"><span aria-hidden="true"><img class="guide-mascot" src="/assets/mascot/trato-guide.png" alt="" width="96" height="96" decoding="async"></span><span>${uiText('guide.short')}</span></button>`;
 doc.body.append(root);
 const launcher=root.querySelector('[data-guide-open]'),panel=root.querySelector('.guide-panel'),highlight=root.querySelector('.guide-highlight');
 let scope=null,steps=[],index=0,frame=0,returnFocus=null;
 const visible=target=>!!target&&!target.closest('[hidden]')&&target.getClientRects().length>0;
 const targetFor=entry=>doc.querySelector(entry.selector);
 function close(restoreFocus=false){
  const wasOpen=!panel.hidden;panel.hidden=true;highlight.hidden=true;steps=[];index=0;
  launcher.hidden=false;launcher.setAttribute('aria-expanded','false');
  if(frame){win.cancelAnimationFrame(frame);frame=0;}
  if(wasOpen&&restoreFocus&&!root.hidden){const focus=returnFocus?.isConnected?returnFocus:launcher;focus.focus();}
 }
 function position(){
  frame=0;if(panel.hidden||!steps[index])return;
  const target=targetFor(steps[index]);if(!visible(target)){close();return;}
  const rect=target.getBoundingClientRect(),margin=7;
  const left=Math.max(8,rect.left-margin),top=Math.max(8,rect.top-margin);
  const right=Math.min(win.innerWidth-8,rect.right+margin),bottom=Math.min(win.innerHeight-8,rect.bottom+margin);
  highlight.hidden=right<=left||bottom<=top;
  Object.assign(highlight.style,{left:left+'px',top:top+'px',width:Math.max(0,right-left)+'px',height:Math.max(0,bottom-top)+'px'});
 }
 function schedule(){if(!panel.hidden&&!frame)frame=win.requestAnimationFrame(position);}
 function showStep(scroll=false){
  const current=steps[index];if(!current)return;
  const text=field=>uiText(['guide',current.key,field].join('.'));
  root.querySelector('#guide-step-title').textContent=text('title');
  const sentences=text('body').split(/(?<=[.!?])\s+/);
  root.querySelector('.guide-lead').textContent=sentences.shift()||'';
  const support=root.querySelector('.guide-support');support.textContent=sentences.join(' ');support.hidden=!support.textContent;

  const number=n=>new Intl.NumberFormat(uiLocale()).format(n);
  root.querySelector('.guide-progress').textContent=uiText('guide.progress',{current:number(index+1),total:number(steps.length)});
  root.querySelector('[data-guide-previous]').disabled=index===0;
  const next=root.querySelector('[data-guide-next]');
  next.innerHTML=uiText(index===steps.length-1?'guide.finish':'guide.next')+icon(index===steps.length-1?'check':'arrow-right');
  if(scroll)targetFor(current)?.scrollIntoView({block:'start',behavior:win.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
  schedule();
 }
 function sync(){
  const nextScope=guideScope(cloud);
  if(nextScope?.key!==scope?.key)close();
  scope=nextScope;root.hidden=!scope;
  if(!scope)close();else schedule();
 }
 const original=cloud.syncChrome.bind(cloud);
 const wrapped=function(){original();sync();};cloud.syncChrome=wrapped;
 function click(event){
  if(event.target.closest('[data-guide-close]')){close(true);return;}
  if(event.target.closest('[data-guide-open]')){
   sync();if(!scope)return;
   if(!panel.hidden){close(true);return;}
   steps=sectionGuides[scope.kind].filter(entry=>visible(targetFor(entry)));
   if(!steps.length)return;
   index=0;returnFocus=doc.activeElement;panel.hidden=false;launcher.hidden=true;launcher.setAttribute('aria-expanded','true');
   showStep(true);root.querySelector('#guide-step-title').focus({preventScroll:true});return;
  }
  if(event.target.closest('[data-guide-previous]')){index=Math.max(0,index-1);showStep(true);}
  if(event.target.closest('[data-guide-next]')){if(index===steps.length-1)close(true);else{index++;showStep(true);}}
 }
 const keydown=event=>{if(event.key==='Escape'&&!panel.hidden){event.preventDefault();close(true);}};
 const routeChanged=()=>{close();sync();};
 root.addEventListener('click',click);doc.addEventListener('keydown',keydown);
 win.addEventListener('hashchange',routeChanged);win.addEventListener('scroll',schedule,{passive:true,capture:true});win.addEventListener('resize',schedule);
 sync();
 return ()=>{close();root.remove();doc.removeEventListener('keydown',keydown);win.removeEventListener('hashchange',routeChanged);win.removeEventListener('scroll',schedule,true);win.removeEventListener('resize',schedule);if(cloud.syncChrome===wrapped)cloud.syncChrome=original;};
}
