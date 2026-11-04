const {test}=require('node:test');
const assert=require('node:assert/strict');
test('all three problem journeys have four complete ES/EN steps and approved icons',async()=>{
 const {landingFlows}=await import('../visitor-landing.mjs');const {textForLanguage}=await import('../i18n.mjs');const {icon}=await import('../icons.mjs');
 assert.deepEqual(Object.keys(landingFlows),['change','start','practice']);
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
test('horizontal journeys change only on request and preserve keyboard navigation without scrolling the page',async()=>{
 const {installVisitorLanding}=await import('../visitor-landing.mjs');
 const previousWindow=global.window,previousObserver=global.IntersectionObserver;
 const handlers={},nodes=new Map(),tabs=['change','start','practice'].map(key=>({dataset:{landStory:key},attributes:{},setAttribute(k,v){this.attributes[k]=v;},focus(){this.focused=true;}}));
 let scrolls=0,frame,authCalls=0;
 function node(selector){
  if(!nodes.has(selector))nodes.set(selector,{hidden:false,innerHTML:'',textContent:'',dataset:{},style:{setProperty(){}},attributes:{},classList:{toggle(){},add(){}},setAttribute(k,v){this.attributes[k]=v;},querySelector:node,querySelectorAll:()=>[],focus(){this.focused=true;},scrollIntoView(){throw Error('Journey selection must not scroll the page');}});
  return nodes.get(selector);
 }
 const root={...node('root'),addEventListener(k,fn){handlers[k]=fn;},querySelector:selector=>tabs.find(tab=>selector==='[data-land-story="'+tab.dataset.landStory+'"]')||node(selector),querySelectorAll:selector=>selector==='[data-land-story]'?tabs:[]};
 const body={classList:{toggle(){}},setAttribute(){}};
 const doc={body,querySelector:()=>root,documentElement:{classList:{toggle(){}}},defaultView:{history:{replaceState(){}}}};
 global.window={matchMedia:()=>({matches:false,addEventListener(){}}),addEventListener(){},scrollTo(){scrolls++;},innerWidth:1400,innerHeight:1000};
 global.IntersectionObserver=class{observe(){}unobserve(){}};
 const oldRaf=global.requestAnimationFrame;global.requestAnimationFrame=fn=>{frame=fn;return 1;};
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
 }finally{global.window=previousWindow;global.IntersectionObserver=previousObserver;global.requestAnimationFrame=oldRaf;}
});
