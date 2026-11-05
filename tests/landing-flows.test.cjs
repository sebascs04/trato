const {test}=require('node:test');
const assert=require('node:assert/strict');
test('all three problem journeys have four complete ES/EN steps and approved icons',async()=>{
 const {landingFlows}=await import('../visitor-landing.mjs');const {textForLanguage}=await import('../i18n.mjs');const {icon}=await import('../icons.mjs');
 assert.deepEqual(Object.keys(landingFlows),['change','start','practice','refund']);
 for(const [key,icons]of Object.entries(landingFlows)){
  assert.equal(icons.length,4);
  for(const language of ['es','en']){
   assert.ok(textForLanguage(language,'landing.flow.'+key+'.problem'));
   for(let n=0;n<4;n++)for(const field of ['title','copy','detail']){
    const text=textForLanguage(language,['landing.flow',key,n,field].join('.'));assert.ok(text);assert.equal(text.includes('\u2014'),false);
   }
  }
  icons.forEach(name=>assert.ok(icon(name)));
 }
});
test('timeline advances on its timer and supports pause and manual navigation',async()=>{
 const {installVisitorLanding}=await import('../visitor-landing.mjs');
 const previousWindow=global.window,previousObserver=global.IntersectionObserver,previousTimeout=global.setTimeout,previousClear=global.clearTimeout;
 const observers=[],timers=new Map();let timerId=0;global.setTimeout=(fn,delay)=>{fn.delay=delay;timers.set(++timerId,fn);return timerId;};global.clearTimeout=id=>timers.delete(id);
 const handlers={},nodes=new Map(),tabs=['change','start','refund'].map(key=>({dataset:{landStory:key},attributes:{},setAttribute(k,v){this.attributes[k]=v;},focus(){this.focused=true;}}));
 let scrolls=0,frame,authCalls=0;
 function node(selector){
  if(!nodes.has(selector))nodes.set(selector,{hidden:false,innerHTML:'',textContent:'',getBoundingClientRect(){return {top:48,bottom:1348};},dataset:{},style:{setProperty(){}},attributes:{},classList:{toggle(){},add(){}},setAttribute(k,v){this.attributes[k]=v;},querySelector:node,querySelectorAll:()=>[],focus(){this.focused=true;},scrollIntoView(){throw Error('Journey selection must not scroll the page');}});
  return nodes.get(selector);
 }
 const root={...node('root'),addEventListener(k,fn){handlers[k]=fn;},querySelector:selector=>tabs.find(tab=>selector==='[data-land-story="'+tab.dataset.landStory+'"]')||node(selector),querySelectorAll:selector=>selector==='[data-land-story]'?tabs:[]};
 const body={classList:{toggle(){}},setAttribute(){}};
 const doc={body,querySelector:()=>root,documentElement:{classList:{toggle(){}}},defaultView:{history:{replaceState(){}}}};
 global.window={matchMedia:()=>({matches:false,addEventListener(){}}),addEventListener(){},scrollTo(){scrolls++;},scrollY:0,innerWidth:1400,innerHeight:1000};
 global.IntersectionObserver=class{constructor(callback){this.callback=callback;observers.push(this);}observe(target){this.target=target;}unobserve(){}};
 const oldRaf=global.requestAnimationFrame,oldCancel=global.cancelAnimationFrame,oldPerformance=global.performance;let now=0,rafId=0;const frames=new Map();global.performance={now:()=>now};global.requestAnimationFrame=fn=>{frame=fn;frames.set(++rafId,fn);return rafId;};global.cancelAnimationFrame=id=>frames.delete(id);
 function advance(ms){now+=ms;const pending=[...frames];frames.clear();for(const [,fn]of pending)fn(now);}
 try{
  const cloud={document:doc,location:{hash:'',href:'http://localhost:5173/'},active:false,state:'anonymous',syncChrome(){},openAccount(){authCalls++;}};
  installVisitorLanding(cloud);cloud.syncChrome();
  assert.match(root.innerHTML,/land-story-tabs/);assert.match(root.innerHTML,/TeTrato/);assert.match(root.innerHTML,/assets\/mascot\/trato-guide.png/);assert.doesNotMatch(root.innerHTML,/data-land-chapter=/);
  const event=(selector,target)=>({target:{closest:s=>s===selector?target:null}});
  handlers.click(event('[data-land-story]',tabs[1]));
  assert.equal(tabs[1].attributes['aria-selected'],'true');assert.equal(tabs[1].tabIndex,0);assert.equal(tabs[0].tabIndex,-1);
  assert.equal(node('#land-story-panel').attributes['aria-labelledby'],'story-tab-start');
  assert.equal((node('#land-story-panel').innerHTML.match(/data-land-story-step=/g)||[]).length,4);
  let prevented=false;handlers.keydown({...event('[data-land-story]',tabs[1]),key:'ArrowRight',preventDefault(){prevented=true;}});
  assert.equal(prevented,true);assert.equal(tabs[2].attributes['aria-selected'],'true');assert.equal(tabs[2].focused,true);
  assert.equal(scrolls,1);assert.equal(authCalls,0);
  assert.ok(frame);
  assert.doesNotMatch(root.innerHTML,/land-mascot-welcome|land-hero-actions|land-practice-details|land-practice-cta|class="land-cta"/);
  assert.doesNotMatch(root.innerHTML,/class="land-visual"/);
  const timeline=observers.find(observer=>observer.target===node('.land-stories'));
  timeline.callback([{isIntersecting:true}]);
  advance(3000);assert.match(node('#land-story-panel').innerHTML,/data-narrative-stage="-1"/);
  doc.hidden=true;timeline.callback([{isIntersecting:true}]);advance(10000);
  doc.hidden=false;timeline.callback([{isIntersecting:true}]);advance(2499);
  assert.match(node('#land-story-panel').innerHTML,/data-narrative-stage="-1"/);
  advance(1);assert.match(node('#land-story-panel').innerHTML,/data-narrative-stage="0"/);
  for(const stage of [1,2,3,-1]){advance(5500);assert.match(node('#land-story-panel').innerHTML,new RegExp('data-narrative-stage="'+stage+'"'));}
  assert.doesNotMatch(root.innerHTML,/land-practice-motion/);
  handlers.click(event('[data-land-motion]',{}));advance(6000);
  assert.match(node('#land-story-panel').innerHTML,/data-narrative-stage="-1"/);
  assert.match(node('#land-story-panel').innerHTML,/land-story-mascot/);

 }finally{global.window=previousWindow;global.IntersectionObserver=previousObserver;global.requestAnimationFrame=oldRaf;global.cancelAnimationFrame=oldCancel;global.performance=oldPerformance;global.setTimeout=previousTimeout;global.clearTimeout=previousClear;}
});
