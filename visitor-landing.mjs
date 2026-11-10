import {uiText,uiLanguage,uiLocale,setUiLanguage} from './i18n.mjs';
import {icon} from './icons.mjs';
const t=key=>uiText(`landing.${key}`);
// Stored credentials alone never reveal the workspace: load() must verify them.
export function entryPresentation(cloud){
 if(cloud.active&&cloud.state==='ready'&&cloud.session?.session)return 'workspace';
 if(['anonymous','error'].includes(cloud.state))return 'visitor';
 return 'loading';
}
export const landingFlows=Object.freeze({change:['messages-square','sparkles','pencil','credit-card'],start:['file-text','star','wallet','check-check'],practice:['messages-square','user-round','send','lightbulb'],refund:['wallet','file-text','check-check','credit-card']});
export function installVisitorLanding(cloud){
 const doc=cloud.document,root=doc.querySelector('#visitor-landing');
 let mounted=false,shown=false,frame=0,paused=window.matchMedia('(prefers-reduced-motion: reduce)').matches,phase=-1,pointerX=0,pointerY=0;
 let story='change',storyStep=-1;
 const storyKeys=['change','start','refund'];
 const motion=window.matchMedia('(prefers-reduced-motion: reduce)');
 const percent=value=>new Intl.NumberFormat(uiLocale(),{style:'percent',maximumFractionDigits:1}).format(value);
 const revealObserver=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){entry.target.classList.add('land-revealed');revealObserver.unobserve(entry.target);}},{threshold:.14});
 let practiceMood='calm';
 const moods=['calm','unsure','upset'];
 const practiceText=key=>t('practiceDemo'+key[0].toUpperCase()+key.slice(1));
 // Original character illustration; decorative artwork, not an action icon.
 const portrait=mood=>`<svg class="land-person land-person-${mood}" viewBox="0 0 280 300" fill="none" aria-hidden="true"><ellipse cx="140" cy="278" rx="110" ry="18" fill="currentColor" opacity=".08"/><path d="M38 285C40 218 77 202 140 202S240 220 242 285" fill="${mood==='upset'?'#8a668b':mood==='unsure'?'#7f91ad':'#8a9c8e'}"/><path d="M115 186V219Q140 241 165 219V186" fill="#dcae94"/><g class="land-person-head"><path d="M69 116C52 33 102 19 143 20C198 17 221 61 210 124" fill="#493d51"/><ellipse cx="73" cy="132" rx="12" ry="19" fill="#e6bfa5"/><ellipse cx="207" cy="132" rx="12" ry="19" fill="#e6bfa5"/><path d="M76 98Q78 60 140 55Q202 60 204 98V153C201 190 171 210 140 211C106 210 79 188 76 153Z" fill="#f0ccb1"/><path d="M73 100Q59 43 117 34Q162 10 201 53L211 104Q174 90 157 63Q117 100 73 100Z" fill="#493d51"/><g class="land-person-eyes"><ellipse cx="111" cy="126" rx="4" ry="6" fill="#493d51"/><ellipse cx="168" cy="126" rx="4" ry="6" fill="#493d51"/></g><path d="M138 132L134 151H144" stroke="#c48e79" stroke-width="3" stroke-linecap="round"/><path class="land-person-brows" d="${mood==='upset'?'M99 107L120 116M159 116L180 107':mood==='unsure'?'M99 108L120 103M159 109L180 113':'M99 109Q110 103 122 109M158 109Q169 103 181 109'}" stroke="#493d51" stroke-width="4" stroke-linecap="round"/><path d="${mood==='upset'?'M120 178Q140 167 160 178':mood==='unsure'?'M127 176L156 171':'M119 171Q140 190 161 171'}" stroke="#a96f65" stroke-width="4" stroke-linecap="round"/>${mood==='unsure'?'<g stroke="#71607d" stroke-width="3"><rect x="91" y="115" width="41" height="29" rx="10"/><rect x="148" y="115" width="41" height="29" rx="10"/><path d="M132 124H148"/></g>':''}</g><path d="M86 248L106 285M194 248L174 285" stroke="#fff" stroke-opacity=".2" stroke-width="2"/></svg>`;
 function practiceContent(){return `<section class="land-practice land-reveal" id="land-practice"><div class="land-practice-copy"><span class="land-eyebrow">${practiceText('eyebrow')}</span><h2>${practiceText('title').split('\n').join('<br>')}</h2><p>${practiceText('copy')}</p><div class="land-temperaments" role="group" aria-label="${practiceText('label')}">${moods.map(mood=>`<button type="button" data-land-mood="${mood}" aria-pressed="${mood===practiceMood}"><span>${portrait(mood)}</span>${practiceText(mood)}</button>`).join('')}</div></div><div class="land-practice-stage" data-practice-stage><div class="land-practice-halo" aria-hidden="true"></div><div class="land-practice-person" data-practice-portrait>${portrait(practiceMood)}</div><div class="land-practice-conversation" aria-live="off"><article class="land-client-bubble"><span>${practiceText('client')} · <b data-practice-name>${practiceText(practiceMood)}</b></span><p data-practice-message>${practiceText(practiceMood+'Message')}</p></article><article class="land-you-bubble"><span>${practiceText('you')}</span><p data-practice-reply>${practiceText(practiceMood+'Reply')}</p></article></div><p class="land-practice-foot">${practiceText('foot')}</p></div></section>`;}
 function selectMood(mood){
  practiceMood=mood;const stage=root.querySelector('[data-practice-stage]');
  if(!stage)return;stage.dataset.mood=mood;
  root.querySelector('[data-practice-portrait]').innerHTML=portrait(mood);
  for(const [name,key] of [['name',mood],['message',mood+'Message'],['reply',mood+'Reply']])root.querySelector(`[data-practice-${name}]`).textContent=practiceText(key);
  for(const button of root.querySelectorAll('[data-land-mood]'))button.setAttribute('aria-pressed',String(button.dataset.landMood===mood));
 }
 // Nothing advances on its own: the visitor moves through the story and the practice examples.
 function syncMotion(){
  root.classList.toggle('land-paused',motion.matches);root.classList.toggle('land-story-paused',paused);root.classList.toggle('land-motion-enabled',!motion.matches);
  for(const button of root.querySelectorAll('[data-land-motion]')){button.setAttribute('aria-label',t(paused?'resume':'pause'));button.title=t(paused?'resume':'pause');button.setAttribute('aria-pressed',String(paused));button.querySelector('span').innerHTML=icon(paused?'play':'pause');}
  schedule();
 }
 const brand=`<span class="land-brand-mark" aria-hidden="true">t<span>↗</span></span><span>trato<span class="land-brand-dot">.</span></span>`;
 function storyContent(){
  return `<section class="land-stories" id="land-step-1" aria-labelledby="land-story-title"><div class="land-story-sticky"><header><div><span class="land-eyebrow">${t('flowEyebrow')}</span><h2 id="land-story-title">${t('flowTitle')}</h2><p>${t('flowIntro')}</p></div></header><div class="land-story-tabs" role="tablist" aria-label="${t('flowChoose')}">${storyKeys.map(key=>`<button type="button" id="story-tab-${key}" role="tab" data-land-story="${key}" aria-selected="${story===key}" aria-controls="land-story-panel" tabindex="${story===key?0:-1}">${icon(landingFlows[key][0])}${t('flow.'+key+'.problem')}</button>`).join('')}</div><div id="land-story-panel" class="land-story-panel" role="tabpanel" aria-labelledby="story-tab-${story}">${storyPanel()}</div><div class="land-story-proof"><span>${icon('sparkles')}${t('flowAi')}</span>${icon('arrow-right')}<span>${icon('user-round')}${t('flowHuman')}</span>${icon('arrow-right')}<span class="land-paypal">Pay<span>Pal</span><small>Sandbox</small></span></div></div></section>`;
 }
 function storyPanel(){
  const intro=storyStep===-1;
  const text=(field,n)=>t(['flow',story,n===undefined?field:n+'.'+field].join('.'));
  const narration=field=>t(['narration',story,field].join('.'));
  const glyph=intro?'messages-square':landingFlows[story][storyStep];
  return `<div class="land-narrative" data-narrative-stage="${storyStep}"><div class="land-narrator"><div class="land-narrator-cloud"><span>${t(intro?'narration.questionLabel':'narration.solutionLabel')}</span><p>${narration(intro?'question':storyStep)}</p></div><img class="land-story-mascot" src="/assets/mascot/trato-guide.png" alt="TeTrato" width="240" height="240"></div><div class="land-narrative-scene" data-narrative-case="${story}"><div class="land-scene-symbol">${icon(glyph)}</div>${intro?`<div class="land-example-message">${icon('messages-square')}<p>${narration('example')}</p></div>`:`<article class="land-example-document"><span class="land-example-step">0${storyStep+1} / 04</span><h3>${text('title',storyStep)}</h3><span class="land-example-tag">${icon((story==='change'||story==='refund')&&storyStep===3?'credit-card':storyStep===2&&story!=='refund'?'sparkles':'check')}${(story==='change'||story==='refund')&&storyStep===3?'PayPal Sandbox':t(storyStep===2&&story!=='refund'?'flowAi':'flowHuman')}</span></article>`}<div class="land-narrative-trail" role="group" aria-label="${t('flowSteps')}">${landingFlows[story].map((_,n)=>`<button type="button" data-land-story-step="${n}" aria-label="${text('title',n)}" aria-pressed="${n===storyStep}" class="${n===storyStep?'is-selected':n<storyStep?'is-past':''}"><span>0${n+1}</span></button>`).join('')}</div><div class="land-story-controls"><button type="button" data-land-motion aria-label="${t(paused?'resume':'pause')}" title="${t(paused?'resume':'pause')}" aria-pressed="${paused}"><span>${icon(paused?'play':'pause')}</span></button><button type="button" data-land-story-prev aria-label="${t('flowPrevious')}" title="${t('flowPrevious')}" ${intro?'disabled':''}>${icon('arrow-left')}</button><button type="button" data-land-story-next aria-label="${t('flowNext')}" title="${t('flowNext')}" ${storyStep===3?'disabled':''}>${icon('arrow-right')}</button></div></div></div>`;
 }
 function selectStory(key,stage=-1){
  if(!storyKeys.includes(key)||!Number.isInteger(stage)||stage< -1||stage>3)return;
  story=key;storyStep=stage;
  for(const tab of root.querySelectorAll('[data-land-story]')){const selected=tab.dataset.landStory===key;tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;}
  const panel=root.querySelector('#land-story-panel');panel.setAttribute('aria-labelledby','story-tab-'+key);panel.innerHTML=storyPanel();schedule();
 }
 // The problem comes first. Each figure states its population and links its primary source; none is presented as global.
 function problemContent(){
  const leapers='https://www.leapers.co/research/2025/report/',nyc='https://www.nyc.gov/assets/dca/downloads/pdf/workers/DCWP-Freelance-Isnt-Free-Act-Five-YearReport-2023.pdf';
  const stats=[[.416,'Contract'],[.49,'Claim']];
  const source=(url,key)=>`<a href="${url}" target="_blank" rel="noopener noreferrer">${t(key)}${icon('arrow-up-right')}</a>`;
  return `<section class="land-tools land-problem" id="land-problem"><div class="land-section-heading"><span class="land-eyebrow">${t('problemEyebrow')}</span><h2>${t('problemTitle')}</h2></div><div class="land-stat-band">${stats.map(([value,name])=>`<div><strong>${percent(value)}</strong><p>${t('problem'+name)}</p></div>`).join('')}</div><p class="land-stat-sources">${source(leapers,'sourceLeapers')}${source(nyc,'sourceNyc')}</p></section>`;
 }
 // One agreement, two sides: a single timeline instead of another row of cards. Who acts is shown on each step.
 function lanesContent(){
  const steps=[['Agreement','file-text','you'],['Addendum','pencil','you'],['Acceptance','check-check','client'],['Payment','credit-card','client']];
  return `<section class="land-tools land-lanes-section" id="land-lanes"><div class="land-section-heading"><span class="land-eyebrow">${t('lanesEyebrow')}</span><h2>${t('lanesTitle')}</h2></div><ol class="land-lanes">${steps.map(([name,glyph,who])=>`<li data-who="${who}"><span class="land-lane-who">${t(who==='you'?'lanesYou':'lanesClient')}</span><span class="land-tool-icon">${icon(glyph)}</span><strong>${t('lanes'+name)}</strong></li>`).join('')}</ol><ul class="land-lanes-foot"><li>${t('lanesFootClient')}</li><li>${t('lanesFootDispute')}</li></ul></section>`;
 }
 function mount(){
  root.innerHTML=`<a class="land-skip" href="#land-content">${t('skip')}</a><header class="land-nav"><button class="land-brand" data-land-scroll="top" aria-label="${t('backTop')}">${brand}</button><div class="land-nav-actions"><label class="land-language"><span class="sr-only">${t('language')}</span><select data-land-language aria-label="${t('language')}"><option value="es" ${uiLanguage()==='es'?'selected':''}>ES</option><option value="en" ${uiLanguage()==='en'?'selected':''}>EN</option></select></label><button class="land-login" data-land-auth="login">${t('login')}</button><button class="land-button land-button-small" data-land-auth="signup">${t('signup')}${icon('arrow-up-right')}</button></div></header><p class="land-connection-error" role="alert" hidden data-land-error><span data-land-error-message>${t('connectError')}</span> <button data-land-retry>${t('retry')}</button></p><main id="land-content" tabindex="-1"><section class="land-journey" data-land-journey><div class="land-hero-copy"><span class="land-eyebrow"><span></span>${t('eyebrow')}</span><h1>${t('headline')}<br><em>${t('headlineAccent')}</em></h1><p>${t('intro')}</p><div class="land-integration-line"><span>${t('ai')}</span><i></i><strong class="land-paypal">Pay<span>Pal</span></strong><small>${t('integrationLine')}</small></div><section class="land-research" aria-label="${t('researchContext')}"><span>${t('researchContext')}</span><div><article><strong>${percent(.675)}</strong><p>${t('lateStat')}</p></article><article><strong>${percent(.264)}</strong><p>${t('unpaidStat')}</p></article></div><p>${uiText('landing.researchSource',{count:new Intl.NumberFormat(uiLocale()).format(1013)})} <a href="https://www.leapers.co/research/2025/report/" target="_blank" rel="noopener noreferrer">${t('researchLink')}${icon('arrow-up-right')}</a></p></section></div></section>${problemContent()}${storyContent()}${lanesContent()}${practiceContent()}<section class="land-tools" id="land-tools"><div class="land-section-heading"><span class="land-eyebrow">${t('toolsEyebrow')}</span><h2>${t('toolsTitle')}</h2></div><div class="land-tool-grid land-tool-grid-two">${[['map','git-compare-arrows'],['reputation','star']].map(([name,glyph])=>`<article><span class="land-tool-icon">${icon(glyph)}</span><h3>${t(name+'Title')}</h3><p>${t(name+'Copy')}</p></article>`).join('')}</div></section></main><footer class="land-footer"><button class="land-brand" data-land-scroll="top" aria-label="${t('backTop')}">${brand}</button><p>${t('footer')}</p><a class="land-privacy-link" href="/privacidad">${uiText('privacy.title')}</a><button data-land-scroll="top">${t('backTop')}${icon('arrow-up-right')}</button></footer>`;
  mounted=true;root.classList.toggle('land-paused',motion.matches);root.classList.toggle('land-story-paused',paused);
  for(const element of root.querySelectorAll('.land-chapter,.land-section-heading,.land-stack-grid>article,.land-tool-grid>article,.land-impact,.land-cta,.land-practice')){element.classList.add('land-reveal');revealObserver.observe(element);}

 }
 function update(){
  const presentation=entryPresentation(cloud),shouldShow=presentation==='visitor';
  if(shouldShow&&!mounted)mount();
  doc.body.classList.toggle('trato-visitor',shouldShow);root.hidden=!shouldShow;
  const opening=shouldShow&&!shown;shown=shouldShow;
  if(shouldShow){root.querySelector('[data-land-error]').hidden=cloud.state!=='error';if(opening){window.scrollTo(0,0);schedule();}}
  if(shouldShow&&cloud.state==='anonymous'&&cloud.location.hash&&cloud.location.hash!=='#inicio'){
   const url=new URL(cloud.location.href);url.hash='inicio';doc.defaultView.history.replaceState(null,'',url.href);
  }
  // Release the initial cover only after the correct presentation is mounted.
  const loading=presentation==='loading';
  doc.documentElement.classList.toggle('trato-starting',loading);
  doc.body.setAttribute('aria-busy',String(loading));
  const authError=root.querySelector('[data-land-error-message]');if(authError)authError.textContent=cloud.authReturnError?cloud.message:t('connectError');
  const status=doc.querySelector('#boot-status');if(status)status.hidden=!loading;
 }
 const original=cloud.syncChrome.bind(cloud);cloud.syncChrome=function(){original();update();};
 function draw(){frame=0;}
 function schedule(){if(!frame&&shown)frame=requestAnimationFrame(draw);}
 root.addEventListener('pointermove',event=>{if(paused||event.pointerType!=='mouse'||!event.target.closest('.land-journey'))return;pointerX=event.clientX/window.innerWidth*2-1;pointerY=event.clientY/window.innerHeight*2-1;schedule();},{passive:true});
 root.addEventListener('pointerleave',()=>{pointerX=pointerY=0;schedule();});
 window.addEventListener('scroll',schedule,{passive:true});window.addEventListener('resize',schedule,{passive:true});
 motion.addEventListener('change',event=>{paused=event.matches;syncMotion();});
 root.addEventListener('click',event=>{
  const storyTab=event.target.closest('[data-land-story]');if(storyTab){selectStory(storyTab.dataset.landStory);return;}
  const storyStage=event.target.closest('[data-land-story-step]');if(storyStage){selectStory(story,Number(storyStage.dataset.landStoryStep));root.querySelector(`[data-land-story-step="${storyStep}"]`).focus({preventScroll:true});return;}
  if(event.target.closest('[data-land-story-prev]')){selectStory(story,storyStep-1);(root.querySelector('[data-land-story-prev]:not(:disabled)')||root.querySelector(`[data-land-story-step="${Math.max(0,storyStep)}"]`)).focus({preventScroll:true});return;}
  if(event.target.closest('[data-land-story-next]')){selectStory(story,storyStep+1);(root.querySelector('[data-land-story-next]:not(:disabled)')||root.querySelector(`[data-land-story-step="${Math.max(0,storyStep)}"]`)).focus({preventScroll:true});return;}

  if(event.target.closest('.land-skip')){event.preventDefault();root.querySelector('main').focus();root.querySelector('main').scrollIntoView();return;}
  const mood=event.target.closest('[data-land-mood]');if(mood){selectMood(mood.dataset.landMood);return;}
  const auth=event.target.closest('[data-land-auth]');
  if(auth){
   cloud.openAccount(auth.dataset.landAuth);const form=cloud.modal.querySelector('[data-cloud-form="auth"]');
   form?.querySelector('[name="email"]').focus();return;
  }
  const scroll=event.target.closest('[data-land-scroll]');
  if(scroll){const target=scroll.dataset.landScroll==='story'?'#land-step-1':scroll.dataset.landScroll==='tools'?'#land-tools':null;
   if(target)root.querySelector(target).scrollIntoView({behavior:paused?'instant':'smooth',block:'start'});else window.scrollTo({top:0,behavior:paused?'instant':'smooth'});return;
  }
  if(event.target.closest('[data-land-motion]')){paused=!paused;syncMotion();}
  if(event.target.closest('[data-land-retry]'))cloud.restore();
 });
 root.addEventListener('keydown',event=>{
  const tab=event.target.closest('[data-land-story]');if(!tab)return;
  const keys=storyKeys,index=keys.indexOf(tab.dataset.landStory);
  const next=event.key==='ArrowRight'?keys[(index+1)%keys.length]:event.key==='ArrowLeft'?keys[(index+keys.length-1)%keys.length]:event.key==='Home'?keys[0]:event.key==='End'?keys.at(-1):null;
  if(next){event.preventDefault();selectStory(next);root.querySelector(`[data-land-story="${next}"]`).focus({preventScroll:true});}
 });
 root.addEventListener('change',event=>{if(event.target.matches('[data-land-language]')){setUiLanguage(event.target.value);window.location.reload();}});
}
