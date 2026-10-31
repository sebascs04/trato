import {icon} from './icons.mjs';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Presentation only. The caller derives visibility from the actual backend/job state.
export function renderAIActivity({label,hint='',compact=false}={}) {
 if(typeof label!=='string'||!label.trim())throw new TypeError('AI activity requires an accessible label');
 return `<div class="ai-activity ${compact?'ai-activity-compact':''} practice-ai-wait" role="status" aria-live="polite" aria-busy="true"><div class="ai-activity-orbit" aria-hidden="true"><span></span><span></span><div>${icon('sparkles')}</div></div><strong>${escape(label)}</strong>${hint?`<p>${escape(hint)}</p>`:''}<div class="ai-activity-dots" aria-hidden="true"><i></i><i></i><i></i></div></div>`;
}
