import {icon} from './icons.mjs';
import {chatScrollPosition,restoreChatScroll} from './ai-activity.mjs';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const agentMascot=()=>'<img class="case-agent-mascot" src="/assets/mascot/trato-guide.png" width="44" height="44" alt="">';
export function agentShell({id,title,label,closeLabel,closeAttribute='',headerActions='',content,composer,chatAttributes=''}){
 return `<div class="case-agent-shell"><header class="case-agent-header"><div class="case-agent-heading">${agentMascot()}<div><span>Trato</span><h2 id="${esc(id)}">${esc(title)}</h2></div></div><div class="agent-header-actions">${headerActions}<button type="button" class="case-agent-close" data-agent-close ${closeAttribute} aria-label="${esc(closeLabel)}" title="${esc(closeLabel)}">${icon('x')}</button></div></header><div class="case-agent-chat" data-agent-chat ${chatAttributes} role="log" aria-live="polite" aria-label="${esc(label)}">${content}</div>${composer}</div>`;
}
// Presentation lifecycle shared by all agents. No requests, jobs or business decisions.
export function createAgentPanel({cloud,id,className='',onClose=()=>{},trigger=()=>null}){
 const element=cloud.document.createElement('dialog');element.className=`case-assistant-drawer ${className}`.trim();element.setAttribute('aria-labelledby',id);cloud.document.body.append(element);
 let opener=null;
 function close(){
  if(element.open)element.close();
  if(!cloud.document.querySelector('.case-assistant-drawer[open]'))cloud.document.body.classList.remove('case-agent-open');
  onClose();const target=opener?.isConnected?opener:trigger();target?.focus();
 }
 element.addEventListener('cancel',event=>{event.preventDefault();close();});
 element.addEventListener('click',event=>{
  if(event.target.closest('[data-agent-close]')){close();return;}
  if(event.target===element){const rect=element.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)close();}
 });
 element.addEventListener('close',()=>{if(!element.open){if(!cloud.document.querySelector('.case-assistant-drawer[open]'))cloud.document.body.classList.remove('case-agent-open');onClose();}});
 function render(html){
  const log=element.querySelector('[data-agent-chat]'),scroll=log?chatScrollPosition(log):null;
  const focused=cloud.document.activeElement,hadFocus=element.contains(focused),editing=hadFocus&&focused?.matches('textarea');
  const selection=editing?[focused.selectionStart,focused.selectionEnd]:null;
  const action=hadFocus?focused?.getAttribute('data-case-action')?['data-case-action',focused.getAttribute('data-case-action')]:focused?.getAttribute('data-assistant-action')?['data-assistant-action',focused.getAttribute('data-assistant-action')]:focused?.hasAttribute('data-agent-close')?['data-agent-close','']:null:null;
  const focusDocument=hadFocus?focused?.getAttribute('data-document-id'):null;
  const expanded=new Set([...element.querySelectorAll('details[open]')].map(e=>e.dataset.agentSource||e.dataset.caseSources));
  element.innerHTML=html;
  for(const details of element.querySelectorAll('details'))if(expanded.has(details.dataset.agentSource||details.dataset.caseSources))details.open=true;
  restoreChatScroll(element.querySelector('[data-agent-chat]'),scroll);
  const input=element.querySelector('textarea:not(:disabled)');
  if(editing&&input){input.focus({preventScroll:true});input.setSelectionRange(...selection);}
  else if(action){const target=element.querySelector(`[${action[0]}="${action[1]}"]${focusDocument?`[data-document-id="${focusDocument}"]`:""}`);target?.focus({preventScroll:true});}
  else if(hadFocus)(input||element.querySelector('[data-agent-close]'))?.focus({preventScroll:true});
 }
 return {element,render,close,open(button){opener=button;if(!element.open)element.showModal();cloud.document.body.classList.add('case-agent-open');element.querySelector('[data-agent-close]')?.focus();},dispose(){close();element.remove();}};
}
