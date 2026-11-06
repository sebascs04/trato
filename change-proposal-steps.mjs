import {uiText,uiLocale} from './i18n.mjs';
import {icon} from './icons.mjs';
const t=key=>uiText(`changeSteps.${key}`);
export const CHANGE_STEPS=['recommendation','terms','price','review'];
export function fieldsForChangeStep(step){return step===1?['scope','conditions']:step===2?['description','amount','deadline']:[];}
export function createChangeStepNavigation({isReady,validate,changed}){
 let step=0;
 return {
  get step(){return step;},
  next(){
   if(step===3||step===0&&!isReady())return false;
   if(fieldsForChangeStep(step).some(name=>!validate(name)))return false;
   step++;changed();return true;
  },
  previous(){if(!step)return false;step--;changed();return true;}
 };
}

// Move existing controls without replacing them: drafts, validation and submit intents stay intact.
export function installChangeProposalSteps(form,hooks={}){
 if(form.changeSteps)return form.changeSteps;
 const doc=form.ownerDocument,panels=CHANGE_STEPS.map((_,step)=>{
  const panel=doc.createElement('section');panel.className='change-step-panel';panel.dataset.changeStepPanel=step;return panel;
 });
 const assistant=form.querySelector('.change-auto');if(!assistant)return null;
 panels[0].append(assistant);
 const price=doc.createElement('div');price.dataset.changeAutoPrice='';panels[2].append(price);
 for(const step of [1,2])for(const name of fieldsForChangeStep(step)){
  const field=form.elements.namedItem(name);if(field)panels[step].append(field.closest('.field'));
 }
 const review=doc.createElement('dl');review.className='change-step-review';panels[3].append(review);
 const sendContext=form.querySelector('.cloud-proposal-send-context'),actions=form.querySelector('.dialog-actions');
 if(sendContext)panels[3].append(sendContext);if(actions)panels[3].append(actions);
 const navigation=doc.createElement('ol');navigation.className='plan-steps change-review-steps';navigation.setAttribute('aria-label',t('progress'));
 navigation.innerHTML=CHANGE_STEPS.map((key,i)=>`<li><span>${i+1}</span><em>${t(key)}</em></li>`).join('');
 const heading=doc.createElement('h3');heading.className='change-step-heading';heading.tabIndex=-1;
 const controls=doc.createElement('footer');controls.className='plan-actions change-step-controls';
 controls.innerHTML=`<button type="button" class="button secondary" data-change-step="back">${icon('arrow-left')}${t('back')}</button><button type="button" class="button" data-change-step="next">${t('continue')}${icon('arrow-right')}</button>`;
 form.prepend(navigation,heading,...panels);form.append(controls);form.classList.add('change-step-form');
 form.closest('dialog')?.classList.add('cloud-change-steps-dialog');
 function renderReview(){
  review.replaceChildren();
  for(const [name,key] of [['scope','scopeLabel'],['conditions','conditionsLabel'],['description','descriptionLabel'],['amount','amountLabel'],['deadline','deadlineLabel']]){
   const value=form.elements.namedItem(name)?.value;if(!value)continue;
   const row=doc.createElement('div'),label=doc.createElement('dt'),content=doc.createElement('dd');label.textContent=t(key);
   content.textContent=name==='amount'?new Intl.NumberFormat(uiLocale(),{style:'currency',currency:'USD'}).format(Number(value.replace(',','.'))):value;
   row.append(label,content);review.append(row);
  }
 }
 function refresh(){
  const step=flow.step;
  panels.forEach((panel,i)=>{panel.hidden=i!==step;});
  [...navigation.children].forEach((item,i)=>{if(i===step)item.setAttribute('aria-current','step');else item.removeAttribute('aria-current');});
  heading.textContent=t(CHANGE_STEPS[step]);
  controls.querySelector('[data-change-step="back"]').hidden=step===0;
  const next=controls.querySelector('[data-change-step="next"]');next.hidden=step===3;
  next.disabled=step===0&&form.dataset.changeDraftReady!=='true';
  if(step===3)renderReview();
 }
 let advancing=false;
 async function advance(){
  if(advancing)return;advancing=true;
  try{if(hooks.beforeLeave&&!(await hooks.beforeLeave(flow.step)))return;}finally{advancing=false;}
  if(flow.next()){heading.focus();heading.scrollIntoView?.({block:'nearest',behavior:'smooth'});}
 }
 const flow=createChangeStepNavigation({isReady:()=>form.dataset.changeDraftReady==='true',
  validate:name=>form.elements.namedItem(name).reportValidity(),changed:refresh});
 controls.addEventListener('click',event=>{
  const action=event.target.closest('[data-change-step]')?.dataset.changeStep;
  if(action==='next')advance();else if(action==='back'&&flow.previous())heading.focus();
 });
 form.addEventListener('submit',event=>{if(flow.step!==3){event.preventDefault();event.stopImmediatePropagation();advance();}},true);
 form.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.isComposing&&event.target.tagName==='INPUT'&&flow.step<3){event.preventDefault();advance();}});
 form.changeSteps={refresh};refresh();return form.changeSteps;
}
