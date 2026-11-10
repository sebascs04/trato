// Report a problem on a paid Work plan deliverable, client side. It is the addendum's component (problem-thread.mjs):
// the same status card inside the deliverable view, and the same floating dialogs for sending and for the conversation.
import {uiText} from './i18n.mjs';
import {icon} from './icons.mjs';
import {problemDialogsHtml,problemCardHtml,createProblemThread} from './problem-thread.mjs';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const stageKey=(project,position)=>`stage:${project}:${position}`;
const ACTIONS={'problem':'','report-problem':'','problem-message':'/message','close-problem':'/close'};

// The deliverable view's slot: the report card once the report is loaded, or the Report a problem button.
export function stageProblemSlot(problem,{loading=false}={}){
 if(loading)return `<p class="portal-note" role="status">${uiText('portal.problem.checkingPayment')}</p>`;
 if(problem)return problemCardHtml(problem,{amount:null});
 return `<div class="portal-actions"><button type="button" class="portal-button secondary" data-stage-problem-new aria-haspopup="dialog">${icon('flag')}${uiText('portal.problem.action')}</button></div>`;
}

export function installStageProblems(cloud){
 const loaded=new Map();
 let current=null,thread=null;
 const host=cloud.document.createElement('div');host.className='stage-problem-dialogs';host.innerHTML=problemDialogsHtml();
 cloud.document.body.append(host);
 const path=({project,position})=>`/api/v1/portal/account/projects/${encodeURIComponent(project)}/stages/${position}/problem`;
 const api=(action,body)=>cloud.request(path(current)+ACTIONS[action],action==='problem'?{}:cloud.json(body));
 const paint=()=>{
  for(const slot of cloud.document.querySelectorAll('[data-stage-problem]')){
   const key=stageKey(slot.dataset.project,slot.dataset.position);
   slot.innerHTML=stageProblemSlot(loaded.get(key),{loading:!loaded.has(key)&&!!cloud.clientProblems?.[key]});
  }
 };
 const remember=(target,problem)=>{
  const key=stageKey(target.project,target.position);
  loaded.set(key,problem);
  if(problem)cloud.clientProblems={...(cloud.clientProblems||{}),[key]:{status:problem.status,request_paid:problem.request_paid===true}};
  paint();cloud.notify?.();
 };
 async function load(target){
  current=target;
  try{remember(target,await api('problem'));}catch{loaded.delete(stageKey(target.project,target.position));paint();}
 }
 thread=createProblemThread({scope:host,api,getProblem:()=>current&&loaded.get(stageKey(current.project,current.position)),
  setProblem:problem=>remember(current,problem),reload:()=>load(current)});

 // Called by the deliverable view (plan-payments.mjs) for a paid stage. Only the slot; the dialogs float above.
 cloud.stageProblemMarkup=function(item){
  const target={project:String(item.project_id),position:String(item.position)},key=stageKey(target.project,target.position);
  // A report the lists already know is read once, so the card shows its real state and conversation.
  if(cloud.clientProblems?.[key]&&!loaded.has(key))queueMicrotask(()=>load(target));
  return `<div class="stage-problem" data-stage-problem data-project="${esc(target.project)}" data-position="${esc(target.position)}">${stageProblemSlot(loaded.get(key),{loading:!loaded.has(key)&&!!cloud.clientProblems?.[key]})}</div>`;
 };
 cloud.document.addEventListener('click',event=>{
  const target=event.target.closest?.('[data-stage-problem-new],[data-stage-problem] [data-problem-open]');if(!target)return;
  const slot=target.closest('[data-stage-problem]');if(!slot||cloud.role!=='client')return;
  current={project:slot.dataset.project,position:slot.dataset.position};
  if(target.matches('[data-stage-problem-new]'))thread.openNew();else thread.openConversation();
 });
}
