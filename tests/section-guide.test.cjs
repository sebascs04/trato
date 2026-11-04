const {test}=require('node:test');
const assert=require('node:assert/strict');
const moduleGuide=()=>import('../section-guide.mjs');
const signed=()=>({active:true,state:'ready',session:{session:{user:{id:'owner'}}},location:{hash:'#clientes'},clientId:'',projectId:'',tab:'acuerdo'});
test('the guide is limited to a verified, loaded section and never trusts cached credentials alone',async()=>{
 const {guideScope}=await moduleGuide();const cloud=signed();
 assert.equal(guideScope(cloud).kind,'clients');
 for(const field of ['loading','directoryLoading','projectsLoading','proposalLoading'])assert.equal(guideScope({...cloud,[field]:true}),null);
 assert.equal(guideScope({...cloud,active:false}),null);assert.equal(guideScope({...cloud,state:'loading'}),null);assert.equal(guideScope({...cloud,session:{session:null}}),null);
 assert.equal(guideScope({...cloud,location:{hash:'#unsupported'}}),null);
});
test('each project tab has its own guide and changing project or request changes the scope',async()=>{
 const {guideScope}=await moduleGuide();const cloud={...signed(),clientId:'client',projectId:'project-a'};
 for(const [tab,kind]of [['acuerdo','project'],['plan','plan'],['solicitudes','requests'],['comparar','comparison'],['gestion','change'],['devoluciones','refunds'],['documentos','documents'],['historial','history']])assert.equal(guideScope({...cloud,tab}).kind,kind);
 assert.equal(guideScope({...cloud,tab:'historial',historyView:'map'}).kind,'map');
 assert.notEqual(guideScope(cloud).key,guideScope({...cloud,projectId:'project-b'}).key);
 assert.notEqual(guideScope({...cloud,tab:'gestion',requestId:'a'}).key,guideScope({...cloud,tab:'gestion',requestId:'b'}).key);
 assert.equal(guideScope({...cloud,projectId:''}).kind,'projects');
 assert.equal(guideScope({...cloud,location:{hash:'#inicio'}}).kind,'home');
});
test('every explanation has ES and EN titles and bodies',async()=>{
 const {sectionGuides}=await moduleGuide();const {textForLanguage}=await import('../i18n.mjs');
 for(const entries of Object.values(sectionGuides))for(const entry of entries)for(const language of ['es','en'])for(const field of ['title','body'])assert.ok(textForLanguage(language,['guide',entry.key,field].join('.')));
});
function fixture(){
 const handlers={},elements=new Map();let root,requests=0;
 const node=()=>({hidden:false,isConnected:true,style:{},attributes:{},focusCount:0,setAttribute(k,v){this.attributes[k]=v;},focus(){this.focusCount++;},closest(){return null;},getClientRects(){return [{}];},getBoundingClientRect(){return {left:100,top:100,right:700,bottom:450};},scrollIntoView(){},remove(){this.isConnected=false;}});
 for(const selector of ['[data-guide-open]','.guide-panel','.guide-highlight','#guide-step-title','.guide-explanation','.guide-lead','.guide-support','.guide-progress','[data-guide-previous]','[data-guide-next]'])elements.set(selector,node());
 elements.get('.guide-panel').hidden=true;elements.get('.guide-highlight').hidden=true;
 const targets=new Map(['.cloud-client-directory','[data-cloud-action="client"]','#client-workspace'].map(k=>[k,node()]));
 const win={innerWidth:1400,innerHeight:1000,matchMedia:()=>({matches:true}),requestAnimationFrame:()=>1,cancelAnimationFrame(){},addEventListener(k,fn){handlers['window:'+k]=fn;},removeEventListener(k){delete handlers['window:'+k];}};
 const doc={defaultView:win,activeElement:null,body:{append(n){root=n;}},createElement(){return {...node(),querySelector:k=>elements.get(k),addEventListener(k,fn){handlers['root:'+k]=fn;}};},querySelector:k=>targets.get(k)||null,addEventListener(k,fn){handlers['document:'+k]=fn;},removeEventListener(k){delete handlers['document:'+k];}};
 const cloud={...signed(),document:doc,syncChrome(){},request(){requests++;throw Error('Guide must not request backend data');}};
 const click=key=>handlers['root:click']({target:{closest:selector=>selector===key?{}:null}});
 return {cloud,handlers,elements,targets,click,get root(){return root;},get requests(){return requests;}};
}
test('the robot starts closed; clicking it walks only through visible controls and Escape closes it',async()=>{
 const {installSectionGuide}=await moduleGuide();const f=fixture(),dispose=installSectionGuide(f.cloud);
 assert.equal(f.elements.get('.guide-panel').hidden,true);assert.equal(f.root.hidden,false);
 f.click('[data-guide-open]');assert.equal(f.elements.get('.guide-panel').hidden,false);assert.equal(f.elements.get('[data-guide-previous]').disabled,true);
 const first=f.elements.get('#guide-step-title').textContent;
 f.click('[data-guide-next]');assert.notEqual(f.elements.get('#guide-step-title').textContent,first);
 f.click('[data-guide-previous]');assert.equal(f.elements.get('#guide-step-title').textContent,first);
 let prevented=false;f.handlers['document:keydown']({key:'Escape',preventDefault(){prevented=true;}});
 assert.equal(prevented,true);assert.equal(f.elements.get('.guide-panel').hidden,true);assert.equal(f.requests,0);
 dispose();assert.equal(f.root.isConnected,false);
});
test('changing tabs or signing out closes the guide without opening another tour',async()=>{
 const {installSectionGuide}=await moduleGuide();const f=fixture(),dispose=installSectionGuide(f.cloud);
 f.click('[data-guide-open]');f.cloud.location.hash='#ensayos';f.handlers['window:hashchange']();assert.equal(f.elements.get('.guide-panel').hidden,true);
 f.cloud.active=false;f.cloud.syncChrome();assert.equal(f.root.hidden,true);assert.equal(f.requests,0);dispose();
});

test('practice configuration, conversation and analysis each explain only their visible stage',async()=>{
 const {guideScope}=await moduleGuide();const cloud={...signed(),location:{hash:'#ensayos'}};
 assert.equal(guideScope(cloud).kind,'practice');
 cloud.document={querySelector:selector=>selector==='.practice-conversation'?{}:null};assert.equal(guideScope(cloud).kind,'practiceConversation');
 cloud.document={querySelector:selector=>selector==='.practice-finished'?{}:null};assert.equal(guideScope(cloud).kind,'practiceAnalysis');
});
test('visible ES/EN guide and interface values do not contain long dashes',async()=>{
 for(const language of ['es','en']){
  const catalog=(await import('../locales/'+language+'.mjs')).default;
  for(const [key,value]of Object.entries(catalog))assert.equal(value.includes('\u2014'),false,language+': '+key);
 }
});
