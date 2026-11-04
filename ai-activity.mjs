const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Presentation only. The caller derives visibility from the actual backend/job state.
export function renderAIActivity({label,hint='',compact=false}={}) {
 if(typeof label!=='string'||!label.trim())throw new TypeError('AI activity requires an accessible label');
 return `<div class="ai-activity ${compact?'ai-activity-compact':''} practice-ai-wait" role="status" aria-live="polite" aria-busy="true"><div class="ai-activity-orbit" aria-hidden="true"><img class="ai-activity-mascot" src="/assets/mascot/trato-guide.png" alt="" width="88" height="88"></div><strong>${escape(label)}</strong>${hint?`<p>${escape(hint)}</p>`:''}<div class="ai-activity-dots" aria-hidden="true"><i></i><i></i><i></i></div></div>`;
}

// Reuse the form submission path, including validation and pending-state guards.
export function submitChatOnEnter(event,selector){
 const input=event.target;
 if(event.defaultPrevented||event.key!=='Enter'||event.shiftKey||event.ctrlKey||event.altKey||event.metaKey||event.isComposing||event.keyCode===229||!input?.matches(selector))return;
 event.preventDefault();
 const button=input.form?.querySelector('button[type="submit"]');
 if(event.repeat||input.disabled||!input.value.trim()||!button||button.disabled)return;
 input.form.requestSubmit(button);
}

export function chatScrollPosition(element){
 return {top:element.scrollTop,follow:element.scrollHeight-element.clientHeight-element.scrollTop<=64};
}
export function restoreChatScroll(element,position){
 if(!element)return;
 element.scrollTop=!position||position.follow?element.scrollHeight:position.top;
}
