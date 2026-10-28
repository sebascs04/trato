import {uiText,uiLanguage,uiLocale,setUiLanguage} from './i18n.mjs';
import {icon} from './icons.mjs';
const t=key=>uiText(`landing.${key}`);
export function installVisitorLanding(cloud){
 const doc=cloud.document,root=doc.querySelector('#visitor-landing');
 let mounted=false,shown=false,frame=0,paused=window.matchMedia('(prefers-reduced-motion: reduce)').matches,phase=-1,pointerX=0,pointerY=0;
 const motion=window.matchMedia('(prefers-reduced-motion: reduce)');
 const percent=value=>new Intl.NumberFormat(uiLocale(),{style:'percent',maximumFractionDigits:1}).format(value);
 const revealObserver=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){entry.target.classList.add('land-revealed');revealObserver.unobserve(entry.target);}},{threshold:.14});
 let practiceMood='calm',practiceTimer=0,practiceVisible=false;
 const moods=['calm','unsure','upset'];
 const practiceText=key=>t('practiceDemo'+key[0].toUpperCase()+key.slice(1));
 // Original character illustration; decorative artwork, not an action icon.
 const portrait=mood=>`<svg class="land-person land-person-${mood}" viewBox="0 0 280 300" fill="none" aria-hidden="true"><ellipse cx="140" cy="278" rx="110" ry="18" fill="currentColor" opacity=".08"/><path d="M38 285C40 218 77 202 140 202S240 220 242 285" fill="${mood==='upset'?'#8a668b':mood==='unsure'?'#7f91ad':'#8a9c8e'}"/><path d="M115 186V219Q140 241 165 219V186" fill="#dcae94"/><g class="land-person-head"><path d="M69 116C52 33 102 19 143 20C198 17 221 61 210 124" fill="#493d51"/><ellipse cx="73" cy="132" rx="12" ry="19" fill="#e6bfa5"/><ellipse cx="207" cy="132" rx="12" ry="19" fill="#e6bfa5"/><path d="M76 98Q78 60 140 55Q202 60 204 98V153C201 190 171 210 140 211C106 210 79 188 76 153Z" fill="#f0ccb1"/><path d="M73 100Q59 43 117 34Q162 10 201 53L211 104Q174 90 157 63Q117 100 73 100Z" fill="#493d51"/><g class="land-person-eyes"><ellipse cx="111" cy="126" rx="4" ry="6" fill="#493d51"/><ellipse cx="168" cy="126" rx="4" ry="6" fill="#493d51"/></g><path d="M138 132L134 151H144" stroke="#c48e79" stroke-width="3" stroke-linecap="round"/><path class="land-person-brows" d="${mood==='upset'?'M99 107L120 116M159 116L180 107':mood==='unsure'?'M99 108L120 103M159 109L180 113':'M99 109Q110 103 122 109M158 109Q169 103 181 109'}" stroke="#493d51" stroke-width="4" stroke-linecap="round"/><path d="${mood==='upset'?'M120 178Q140 167 160 178':mood==='unsure'?'M127 176L156 171':'M119 171Q140 190 161 171'}" stroke="#a96f65" stroke-width="4" stroke-linecap="round"/>${mood==='unsure'?'<g stroke="#71607d" stroke-width="3"><rect x="91" y="115" width="41" height="29" rx="10"/><rect x="148" y="115" width="41" height="29" rx="10"/><path d="M132 124H148"/></g>':''}</g><path d="M86 248L106 285M194 248L174 285" stroke="#fff" stroke-opacity=".2" stroke-width="2"/></svg>`;
 function practiceContent(){return `<section class="land-practice land-reveal" id="land-practice"><div class="land-practice-copy"><span class="land-eyebrow">${practiceText('eyebrow')}</span><h2>${practiceText('title').split('\n').join('<br>')}</h2><p>${practiceText('copy')}</p><div class="land-temperaments" role="group" aria-label="${practiceText('label')}">${moods.map(mood=>`<button type="button" data-land-mood="${mood}" aria-pressed="${mood===practiceMood}"><span>${portrait(mood)}</span>${practiceText(mood)}</button>`).join('')}</div><button class="land-practice-cta" data-land-auth="signup">${practiceText('cta')}${icon('arrow-up-right')}</button></div><div class="land-practice-stage" data-practice-stage><span class="land-practice-example">${practiceText('example')}</span><div class="land-practice-halo" aria-hidden="true"></div><div class="land-practice-person" data-practice-portrait>${portrait(practiceMood)}</div><div class="land-practice-conversation" aria-live="off"><article class="land-client-bubble"><span>${practiceText('client')} · <b data-practice-name>${practiceText(practiceMood)}</b></span><p data-practice-message>${practiceText(practiceMood+'Message')}</p></article><article class="land-you-bubble"><span>${practiceText('you')}</span><p data-practice-reply>${practiceText(practiceMood+'Reply')}</p></article></div><button class="land-motion land-practice-motion" data-land-motion aria-label="${t(paused?'resume':'pause')}" title="${t(paused?'resume':'pause')}" aria-pressed="${paused}"><span aria-hidden="true">${icon(paused?'play':'pause')}</span></button><p class="land-practice-foot">${practiceText('foot')}</p></div></section>`;}
 function selectMood(mood){
  practiceMood=mood;const stage=root.querySelector('[data-practice-stage]');
  if(!stage)return;stage.dataset.mood=mood;
  root.querySelector('[data-practice-portrait]').innerHTML=portrait(mood);
  for(const [name,key] of [['name',mood],['message',mood+'Message'],['reply',mood+'Reply']])root.querySelector(`[data-practice-${name}]`).textContent=practiceText(key);
  for(const button of root.querySelectorAll('[data-land-mood]'))button.setAttribute('aria-pressed',String(button.dataset.landMood===mood));
 }
 function stopPractice(){clearTimeout(practiceTimer);practiceTimer=0;}
 function startPractice(){stopPractice();if(!practiceVisible||!shown||paused)return;practiceTimer=setTimeout(()=>{selectMood(moods[(moods.indexOf(practiceMood)+1)%moods.length]);startPractice();},7500);}
 const practiceObserver=new IntersectionObserver(entries=>{practiceVisible=entries[0].isIntersecting;startPractice();},{threshold:.3});
 function syncMotion(){
  root.classList.toggle('land-paused',paused);root.classList.toggle('land-motion-enabled',!paused);
  for(const button of root.querySelectorAll('[data-land-motion]')){button.setAttribute('aria-label',t(paused?'resume':'pause'));button.title=t(paused?'resume':'pause');button.setAttribute('aria-pressed',String(paused));button.querySelector('span').innerHTML=icon(paused?'play':'pause');}
  startPractice();schedule();
 }
 const brand=`<span class="land-brand-mark" aria-hidden="true">t<span>↗</span></span><span>trato<span class="land-brand-dot">.</span></span>`;
 function mount(){
  root.innerHTML=`<a class="land-skip" href="#land-content">${t('skip')}</a><header class="land-nav"><button class="land-brand" data-land-scroll="top" aria-label="${t('backTop')}">${brand}</button><nav aria-label="${t('product')}"><button data-land-scroll="story">${t('product')}</button><button data-land-scroll="tools">${t('studio')}</button></nav><div class="land-nav-actions"><label class="land-language"><span class="sr-only">${t('language')}</span><select data-land-language aria-label="${t('language')}"><option value="es" ${uiLanguage()==='es'?'selected':''}>ES</option><option value="en" ${uiLanguage()==='en'?'selected':''}>EN</option></select></label><button class="land-login" data-land-auth="login">${t('login')}</button><button class="land-button land-button-small" data-land-auth="signup">${t('signup')}${icon('arrow-up-right')}</button></div></header><p class="land-connection-error" role="alert" hidden data-land-error>${t('connectError')} <button data-land-retry>${t('retry')}</button></p><main id="land-content" tabindex="-1"><section class="land-journey" data-land-journey><div class="land-hero-copy"><span class="land-eyebrow"><span></span>${t('eyebrow')}</span><h1>${t('headline')}<br><em>${t('headlineAccent')}</em></h1><p>${t('intro')}</p><div class="land-integration-line"><span>${t('ai')}</span><i></i><strong class="land-paypal">Pay<span>Pal</span></strong><small>${t('integrationLine')}</small></div><div class="land-hero-actions"><button class="land-button" data-land-auth="signup">${t('signup')}${icon('arrow-up-right')}</button><button class="land-explore" data-land-scroll="story">${t('explore')}<span>${icon('arrow-right')}</span></button></div><section class="land-research" aria-label="${t('researchContext')}"><span>${t('researchContext')}</span><div><article><strong>${percent(.675)}</strong><p>${t('lateStat')}</p></article><article><strong>${percent(.264)}</strong><p>${t('unpaidStat')}</p></article></div><p>${uiText('landing.researchSource',{count:new Intl.NumberFormat(uiLocale()).format(1013)})} <a href="https://www.leapers.co/research/2025/report/" target="_blank" rel="noopener noreferrer">${t('researchLink')}${icon('arrow-up-right')}</a></p><small>${t('researchNote')}</small></section></div><figure class="land-visual" aria-label="${t('sceneDescription')}"><div class="land-scene" aria-hidden="true" data-land-phase="0"><div class="land-orbit land-orbit-one"></div><div class="land-orbit land-orbit-two"></div><span class="land-glow"></span><div class="land-particle-field">${Array.from({length:40},(_,i)=>{const angle=i*2.39996,radius=110+Math.sqrt(i/40)*190;return `<i style="--dot-x:${Math.cos(angle)*radius}px;--dot-y:${Math.sin(angle)*radius*.76}px;--dot-delay:${-i*.31}s"></i>`;}).join('')}</div><div class="land-camera"><div class="land-object"><div class="land-sheet land-sheet-back-two"></div><div class="land-sheet land-sheet-back"></div><article class="land-paper"><header><span>trato.</span><span class="land-paper-number">01 — 03</span></header><div class="land-paper-rule"></div><span class="land-paper-label">${t('sceneSource')}</span><h2 data-land-document-title>${t('sceneAgreement')}</h2><span class="land-paper-chapter">${icon('file-text')}${t('sceneScope')}</span><p>${t('sceneScopeCopy')}</p><div class="land-paper-lines"><i></i><i></i><i></i></div><div class="land-paper-section"><span>01</span><strong>${t('sceneTerms')}</strong></div><div class="land-paper-lines short"><i></i><i></i></div><footer><span class="land-paper-seal">t.</span><span>${t('sceneLink')}</span>${icon('check')}</footer></article><article class="land-request-card"><span class="land-card-icon">${icon('messages-square')}</span><small>${t('sceneRequest')}</small><strong>${t('sceneQuote')}</strong><p>${t('sceneCompare')}</p></article><article class="land-decision-card"><span>${icon('git-compare-arrows')}</span><div><small>${t('sceneDecision')}</small><strong>${t('sceneReview')}</strong></div></article><article class="land-payment-card"><header><span class="land-paypal">Pay<span>Pal</span></span><span>${icon('credit-card')}</span></header><strong>${t('scenePayment')}</strong><div>${t('scenePaymentAction')}${icon('arrow-right')}</div></article></div></div><div class="land-stage-track">${[0,1,2,3].map(n=>`<span data-land-marker="${n}">0${n+1}</span>`).join('')}</div></div><figcaption data-land-caption>${t('caption0')}</figcaption><button class="land-motion" data-land-motion aria-label="${t(paused?'resume':'pause')}" title="${t(paused?'resume':'pause')}" aria-pressed="${paused}"><span aria-hidden="true">${icon(paused?'play':'pause')}</span></button></figure>${[1,2,3].map(step=>`<section class="land-chapter" id="land-step-${step}" data-land-chapter="${step}"><span class="land-eyebrow">${t(`step${step}Eyebrow`)}</span><h2>${t(`step${step}Title`)}</h2><p>${t(`step${step}Copy`)}</p><span class="land-chapter-foot">${icon(step===1?'file-text':step===2?'git-compare-arrows':'credit-card')}${t(`step${step}Foot`)}</span></section>`).join('')}</section><section class="land-stack"><div class="land-section-heading"><span class="land-eyebrow">${t('stackEyebrow')}</span><h2>${t('stackTitle')}</h2><p>${t('stackCopy')}</p></div><div class="land-stack-grid"><article><span class="land-ai-badge">${t('ai')}</span><h3>${t('aiTitle')}</h3><p>${t('aiCopy')}</p><ul>${[1,2,3].map(n=>`<li>${icon('check')}${t(`aiPoint${n}`)}</li>`).join('')}</ul></article><article><span class="land-paypal">Pay<span>Pal</span></span><h3>${t('paypalTitle')}</h3><p>${t('paypalCopy')}</p><ul>${[1,2,3].map(n=>`<li>${icon('check')}${t(`paypalPoint${n}`)}</li>`).join('')}</ul><small>${t('step3Foot')}</small></article></div><ol class="land-integration-path">${['aiStep','humanStep','paypalStep','verifyStep'].map(key=>`<li>${t(key)}</li>`).join('')}</ol><div class="land-impact"><h3>${t('impactTitle')}</h3><div>${[1,2,3].map(n=>`<p>${icon('arrow-up-right')}${t(`impact${n}`)}</p>`).join('')}</div></div></section>${practiceContent()}<section class="land-tools" id="land-tools"><div class="land-section-heading"><span class="land-eyebrow">${t('toolsEyebrow')}</span><h2>${t('toolsTitle')}</h2><p>${t('toolsCopy')}</p></div><div class="land-tool-grid">${[['map','git-compare-arrows'],['practice','messages-square'],['reputation','star']].map(([name,glyph],index)=>`<article><span class="land-tool-number">0${index+1}</span><span class="land-tool-icon">${icon(glyph)}</span><h3>${t(name+'Title')}</h3><p>${t(name+'Copy')}</p></article>`).join('')}</div></section><section class="land-cta"><span class="land-eyebrow">${t('ctaEyebrow')}</span><h2>${t('ctaTitle')}<br><em>${t('ctaAccent')}</em></h2><p>${t('ctaCopy')}</p><button class="land-button" data-land-auth="signup">${t('signup')}${icon('arrow-up-right')}</button><div class="land-cta-orbit" aria-hidden="true"></div></section></main><footer class="land-footer"><button class="land-brand" data-land-scroll="top" aria-label="${t('backTop')}">${brand}</button><p>${t('footer')}</p><button data-land-scroll="top">${t('backTop')}${icon('arrow-up-right')}</button></footer>`;
  mounted=true;root.classList.toggle('land-paused',paused);
  for(const element of root.querySelectorAll('.land-chapter,.land-section-heading,.land-stack-grid>article,.land-tool-grid>article,.land-impact,.land-cta,.land-practice')){element.classList.add('land-reveal');revealObserver.observe(element);}
  practiceObserver.observe(root.querySelector('#land-practice'));

 }
 function update(){
  const shouldShow=!cloud.demoMode&&!cloud.active&&['anonymous','error'].includes(cloud.state)&&!cloud.session?.session;
  if(shouldShow&&!mounted)mount();
  doc.body.classList.toggle('trato-visitor',shouldShow);root.hidden=!shouldShow;
  const opening=shouldShow&&!shown;shown=shouldShow;if(!shown)stopPractice();
  if(shouldShow){root.querySelector('[data-land-error]').hidden=cloud.state!=='error';if(opening){window.scrollTo(0,0);schedule();}}
 }
 const original=cloud.syncChrome.bind(cloud);cloud.syncChrome=function(){original();update();};
 function draw(){
  frame=0;if(!shown)return;
  const scene=root.querySelector('.land-scene'),object=root.querySelector('.land-object');
  let next=0;for(const chapter of root.querySelectorAll('[data-land-chapter]'))if(chapter.getBoundingClientRect().top<window.innerHeight*.6)next=Number(chapter.dataset.landChapter);
  if(next!==phase){phase=next;scene.dataset.landPhase=String(next);for(const marker of root.querySelectorAll('[data-land-marker]'))marker.classList.toggle('is-active',Number(marker.dataset.landMarker)===next);root.querySelector('[data-land-caption]').textContent=t(`caption${next}`);root.querySelector('[data-land-document-title]').textContent=t(next>=2?'sceneAddendum':'sceneAgreement');}
  // Interpolate camera poses between chapter centers instead of jumping at thresholds.
  const chapters=[root.querySelector('.land-hero-copy'),...root.querySelectorAll('[data-land-chapter]')];
  const anchors=chapters.map(el=>{const r=el.getBoundingClientRect();return r.top+r.height*.5;});
  const target=window.innerHeight*.5;let segment=0;
  while(segment<anchors.length-2&&target>anchors[segment+1])segment++;
  const blend=Math.max(0,Math.min(1,(target-anchors[segment])/(anchors[segment+1]-anchors[segment])));
  const ease=blend*blend*(3-2*blend),poses=[[-12,-25,12,1,0,0],[4,15,19,1.13,-8,-12],[-5,-12,3,1.02,5,-6],[3,18,-6,.94,-10,8]];
  const pose=poses[segment].map((v,i)=>v+(poses[segment+1][i]-v)*ease);
  if(!paused){
   object.style.setProperty('--land-scroll-rotation',`${pose[0]}deg`);
   object.style.setProperty('--land-camera-y',`${pose[1]}deg`);object.style.setProperty('--land-camera-x',`${pose[2]}deg`);
   object.style.setProperty('--land-camera-scale',pose[3]);
   scene.style.setProperty('--land-camera-shift-x',`${pose[4]+pointerX*9}px`);scene.style.setProperty('--land-camera-shift-y',`${pose[5]+pointerY*7}px`);
   scene.style.setProperty('--land-pointer-x',`${pointerX*5}deg`);scene.style.setProperty('--land-pointer-y',`${-pointerY*4}deg`);
  }

 }
 function schedule(){if(!frame&&shown)frame=requestAnimationFrame(draw);}
 root.addEventListener('pointermove',event=>{if(paused||event.pointerType!=='mouse'||!event.target.closest('.land-journey'))return;pointerX=event.clientX/window.innerWidth*2-1;pointerY=event.clientY/window.innerHeight*2-1;schedule();},{passive:true});
 root.addEventListener('pointerleave',()=>{pointerX=pointerY=0;schedule();});
 window.addEventListener('scroll',schedule,{passive:true});window.addEventListener('resize',schedule,{passive:true});
 motion.addEventListener('change',event=>{paused=event.matches;syncMotion();});
 root.addEventListener('click',event=>{
  if(event.target.closest('.land-skip')){event.preventDefault();root.querySelector('main').focus();root.querySelector('main').scrollIntoView();return;}
  const mood=event.target.closest('[data-land-mood]');if(mood){selectMood(mood.dataset.landMood);startPractice();return;}
  const auth=event.target.closest('[data-land-auth]');
  if(auth){
   cloud.openAccount(auth.dataset.landAuth);const form=cloud.modal.querySelector('[data-cloud-form="auth"]');
   form?.querySelector('[name="email"]').focus();return;
  }
  const scroll=event.target.closest('[data-land-scroll]');
  if(scroll){const target=scroll.dataset.landScroll==='story'?'#land-step-1':scroll.dataset.landScroll==='tools'?'#land-tools':null;
   if(target)root.querySelector(target).scrollIntoView({behavior:paused?'instant':'smooth',block:'start'});else window.scrollTo({top:0,behavior:paused?'instant':'smooth'});return;
  }
  if(event.target.closest('[data-land-motion]')){
   paused=!paused;syncMotion();
  }
  if(event.target.closest('[data-land-retry]'))cloud.restore();
 });
 root.addEventListener('change',event=>{if(event.target.matches('[data-land-language]')){setUiLanguage(event.target.value);window.location.reload();}});
}
