import {uiText,uiLocale} from './i18n.mjs';
import {icon} from './icons.mjs';
import {renderAIActivity} from './ai-activity.mjs';
const t=key=>uiText(`changeSteps.${key}`);
export const CHANGE_STEPS=['recommendation','terms','price','review'];
export const REVISION_STEPS=['feedback','recommendation','terms','price','review'];
export function fieldsForChangeStep(step){return step===1?['scope','conditions']:step===2?['description','amount','deadline']:[];}
export function fieldsForRevisionStep(step){return step===0?['feedbackFile']:fieldsForChangeStep(step-1);}
export function createChangeStepNavigation({isReady,validate,changed,fieldsForStep=fieldsForChangeStep,stepCount=4,readyStep=0}){
 let step=0;
 return {
  get step(){return step;},
  next(){
   if(step===stepCount-1||step===readyStep&&!isReady())return false;
   if(fieldsForStep(step).some(name=>!validate(name)))return false;
   step++;changed();return true;
  },
  previous(){if(!step)return false;step--;changed();return true;}
 };
}

// Move existing controls without replacing them: drafts, validation and submit intents stay intact.
export function installChangeProposalSteps(form,hooks={}){
 if(form.changeSteps)return form.changeSteps;
 const revision=hooks.mode==='revise',steps=revision?REVISION_STEPS:CHANGE_STEPS;
 const doc=form.ownerDocument,panels=steps.map((_,step)=>{
  const panel=doc.createElement('section');panel.className='change-step-panel';panel.dataset.changeStepPanel=step;return panel;
 });
 const assistant=form.querySelector('.change-auto');if(!assistant)return null;
 const offset=revision?1:0,last=steps.length-1;
 if(revision){const feedback=form.querySelector('.change-feedback-box');if(!feedback)return null;panels[0].append(feedback);}
 panels[offset].append(assistant);
 const price=doc.createElement('div');price.dataset.changeAutoPrice='';panels[2+offset].append(price);
 for(const step of [1,2])for(const name of fieldsForChangeStep(step)){
  const field=form.elements.namedItem(name);if(field)panels[step+offset].append(field.closest('.field'));
 }
 const review=doc.createElement('dl');review.className='change-step-review';review.hidden=revision;if(!revision)panels[last].append(review);
 const sendContext=form.querySelector('.cloud-proposal-send-context'),actions=form.querySelector('.dialog-actions');
 const comparison=form.querySelector('[data-revision-comparison]');if(comparison)panels[last].append(comparison);
 if(sendContext)panels[last].append(sendContext);if(actions)panels[last].append(actions);
 const navigation=doc.createElement('ol');navigation.className='plan-steps change-review-steps';navigation.setAttribute('aria-label',t('progress'));
 navigation.style.setProperty('--change-step-count',steps.length);
 navigation.innerHTML=steps.map((key,i)=>`<li><span>${i+1}</span><em>${t(key)}</em></li>`).join('');
 const heading=doc.createElement('h3');heading.className='change-step-heading';heading.tabIndex=-1;
 const help=doc.createElement('p');help.className='cloud-notice';help.textContent=revision?t('revisionTermsHelp'):'';help.hidden=true;
 const controls=doc.createElement('footer');controls.className='plan-actions change-step-controls';
 controls.innerHTML=`<button type="button" class="button secondary" data-change-step="back">${icon('arrow-left')}${t('back')}</button><button type="button" class="button" data-change-step="next">${t('continue')}${icon('arrow-right')}</button>`;
 form.prepend(navigation,heading,help,...panels);form.append(controls);form.classList.add('change-step-form');
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
  heading.textContent=t(steps[step]);help.hidden=!revision||step!==2;
  controls.querySelector('[data-change-step="back"]').hidden=step===0;
  const next=controls.querySelector('[data-change-step="next"]');next.hidden=step===last;
  next.disabled=advancing||step===offset&&form.dataset.changeDraftReady!=='true';
  // The client's PDF and notes stay locked while they are uploaded or analyzed.
  for(const name of ['feedbackFile','feedbackNotes']){const field=form.elements?.namedItem?.(name);if(field)field.disabled=advancing||form.dataset.changeAnalyzing==='true';}
  activity.hidden=!revision||step!==0||!advancing;
  activity.innerHTML=activity.hidden?'':renderAIActivity({label:t('preparingFeedback'),compact:true});
  if(step===last&&!revision)renderReview();
 }
 let advancing=false;
 const activity=doc.createElement('div');activity.hidden=true;form.append(activity);
 const error=doc.createElement('p');error.className='cloud-error';error.setAttribute('role','alert');error.hidden=true;form.append(error);
 async function advance(){
  if(advancing)return;
  const names=revision?fieldsForRevisionStep(flow.step):fieldsForChangeStep(flow.step);
  if(names.some(name=>{const field=form.elements.namedItem(name);return field&&!field.reportValidity();}))return;
  advancing=true;error.hidden=true;refresh();
  try{
   if(hooks.beforeLeave&&!(await hooks.beforeLeave(flow.step)))return;
   if(flow.next()){heading.focus();heading.scrollIntoView?.({block:'nearest',behavior:'smooth'});}
  }catch(issue){error.textContent=hooks.errorMessage?.(issue)||t('prepareFailed');error.hidden=false;}
  finally{advancing=false;refresh();}
 }
 const flow=createChangeStepNavigation({isReady:()=>form.dataset.changeDraftReady==='true',stepCount:steps.length,readyStep:offset,
  fieldsForStep:revision?fieldsForRevisionStep:fieldsForChangeStep,
  validate:name=>{const field=form.elements.namedItem(name);return !field||field.reportValidity();},changed:refresh});
 controls.addEventListener('click',event=>{
  const action=event.target.closest('[data-change-step]')?.dataset.changeStep;
  if(action==='next')advance();else if(action==='back'&&flow.previous())heading.focus();
 });
 form.addEventListener('submit',event=>{if(flow.step!==last){event.preventDefault();event.stopImmediatePropagation();advance();}},true);
 form.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.isComposing&&event.target.tagName==='INPUT'&&flow.step<last){event.preventDefault();advance();}});
 form.changeSteps={refresh};refresh();return form.changeSteps;
}
