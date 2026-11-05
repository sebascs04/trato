import {uiText,uiLocale} from './i18n.mjs';
import {icon} from './icons.mjs';
const t=(key,values)=>uiText(['demoGuide',key].join('.'),values);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const demoCases=Object.freeze({
 change:Object.freeze({base:600,extra:150,stages:Object.freeze(['agreement','request','analysis','proposal','acceptance','payment'])}),
 refund:Object.freeze({base:600,delivered:400,refund:200,stages:Object.freeze(['payment','request','analysis','proposal','acceptance','refund'])})
});
export function demoSnapshot(kind,index){
 const example=demoCases[kind];
 if(!example||!Number.isInteger(index)||index<0||index>=example.stages.length)throw Error('INVALID_DEMO_STEP');
 return Object.freeze({mode:'demonstration',kind,index,stage:example.stages[index],source:'preloaded',providerExecuted:false,base:example.base,amount:kind==='change'?example.extra:example.refund});
}
export function installDemoWorkspace(cloud){
 const doc=cloud.document,win=doc.defaultView;
 const dialog=doc.createElement('dialog');dialog.className='demo-dialog';dialog.setAttribute('aria-labelledby','demo-title');doc.body.append(dialog);
 let kind=null,index=0,timer=null,playing=false,previousFocus=null,run=0;
 const allowed=()=>cloud.active&&cloud.state==='ready'&&!!cloud.session?.session;
 const money=value=>new Intl.NumberFormat(uiLocale(),{style:'currency',currency:'USD'}).format(value);
 function stop(){win.clearTimeout(timer);timer=null;}
 function schedule(){stop();if(playing&&kind&&!doc.hidden)timer=win.setTimeout(()=>{if(index<5){index++;render();}else{playing=false;render();}},6000);}
 function controls(){return `<footer><button type="button" class="button secondary" data-demo="previous" ${index===0?'disabled':''}>${icon('arrow-left')}${t('previous')}</button><span>${t('position',{current:index+1,total:6})}</span><button type="button" class="button" data-demo="next">${t(index===5?'finish':'next')}${icon(index===5?'check':'arrow-right')}</button></footer>`;}
 function render(){
  if(!kind){dialog.innerHTML=`<header><div><span class="eyebrow">${t('badge')}</span><h2 id="demo-title">${t('choose')}</h2></div><button type="button" class="icon-button" data-demo="close" aria-label="${t('close')}" title="${t('close')}">${icon('x')}</button></header><div class="demo-choices">${['change','refund'].map(key=>`<button type="button" data-demo-case="${key}">${icon(key==='change'?'git-compare-arrows':'refresh-cw')}<strong>${t(key+'.title')}</strong><span>${t(key+'.intro')}</span>${icon('arrow-right')}</button>`).join('')}</div><p class="demo-boundary">${t('boundary')}</p>`;return;}
  const state=demoSnapshot(kind,index),step=['demoGuide',kind,String(index)].join('.');
  const heading=uiText(step+'.title'),copy=uiText(step+'.copy'),action=uiText(step+'.action');
  const values=uiText(step+'.value',{base:money(state.base),amount:money(state.amount)});
  dialog.innerHTML=`<header><div><span class="eyebrow">${t('badge')} · ${t(kind+'.title')}</span><h2 id="demo-title">${heading}</h2></div><button type="button" class="icon-button" data-demo="close" aria-label="${t('close')}" title="${t('close')}">${icon('x')}</button></header><div class="demo-layout"><aside><div class="demo-project">${icon('folder-open')}<strong>${t('project')}</strong><span>${t('client')}</span></div><ol>${demoCases[kind].stages.map((_,n)=>`<li class="${n===index?'is-current':n<index?'is-done':''}"><button type="button" data-demo-step="${n}" ${n===index?'aria-current="step"':''}><span>${n<index?icon('check'):String(n+1).padStart(2,'0')}</span>${uiText(['demoGuide',kind,n,'title'].join('.'))}</button></li>`).join('')}</ol></aside><section class="demo-stage"><div class="demo-source"><span>${icon('file-text')}${t('loadedSource')}</span><strong>${t(kind+'.document')}</strong><p>${t(kind+'.source')}</p></div><div class="demo-stage-shade" aria-hidden="true"></div><article class="demo-spotlight"><span class="eyebrow">${t('position',{current:index+1,total:6})}</span><h3>${heading}</h3><p>${values}</p><label>${t('review')}<textarea readonly rows="3">${values}</textarea></label><button type="button" class="button" data-demo="next">${action}${icon(index===5?'check':'arrow-right')}</button></article><div class="demo-narrator"><img src="/assets/mascot/trato-guide.png" alt="" width="78" height="78"><div><strong>TeTrato</strong><p>${copy}</p></div></div></section></div><div class="demo-playback"><span>${t('preloaded')}</span><button type="button" class="text-button" data-demo="play">${icon(playing?'pause':'play')}${t(playing?'pause':'play')}</button></div>${controls()}`;
  schedule();
 }
 function close(){stop();playing=false;kind=null;run++;if(dialog.open)dialog.close();previousFocus?.isConnected&&previousFocus.focus();}
 function open(){if(!allowed())return;previousFocus=doc.activeElement;kind=null;index=0;playing=false;run++;render();dialog.showModal();dialog.querySelector('[data-demo-case]')?.focus();}
 const openFromContent=event=>{if(event.target.closest('[data-demo-open]'))open();};
 doc.addEventListener('click',openFromContent);
 dialog.addEventListener('click',event=>{
  const selected=event.target.closest('[data-demo-case]');if(selected){kind=selected.dataset.demoCase;index=0;playing=true;render();return;}
  const step=event.target.closest('[data-demo-step]');if(step){index=Number(step.dataset.demoStep);playing=false;render();return;}
  const action=event.target.closest('[data-demo]')?.dataset.demo;
  if(action==='close'){close();return;}
  if(action==='play'){playing=!playing;render();return;}
  if(action==='previous'){index=Math.max(0,index-1);playing=false;render();return;}
  if(action==='next'){if(index===5){close();return;}index++;render();}
 });
 dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
 const changed=()=>{if(dialog.open)close();sync();};
 const visibility=()=>{if(doc.hidden)stop();else schedule();};
 function sync(){if(!allowed()&&dialog.open)close();}
 const original=cloud.syncChrome.bind(cloud);cloud.syncChrome=function(){original();sync();};
 win.addEventListener('hashchange',changed);doc.addEventListener('visibilitychange',visibility);sync();
 return ()=>{stop();dialog.remove();doc.removeEventListener('click',openFromContent);win.removeEventListener('hashchange',changed);doc.removeEventListener('visibilitychange',visibility);};
}
