// Studio navigation contracts; no browser, provider calls or invented business data.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const vm=require('node:vm');
function loadShell(hash='#inicio',localStorage){
  const elements=new Map(),handlers={},renders=[],labels=['inicio','clientes','ensayos','reputacion'];
  function element(selector){
    if(!elements.has(selector))elements.set(selector,{hidden:false,textContent:'',attributes:{},dataset:{},classList:{toggle(){}},setAttribute(k,v){this.attributes[k]=v;},removeAttribute(k){delete this.attributes[k];},addEventListener(k,fn){handlers[selector+':'+k]=fn;}});
    return elements.get(selector);
  }
  const links=labels.map(view=>{const node=element('nav:'+view);node.dataset.view=view;return node;});
  const location={hash,href:'http://localhost:5173/'+hash};
  const cloud={attach(fn){handlers.render=fn;fn();},renderWorkspace(target){renders.push({hash:location.hash,target});},syncChrome(){}};
  const window={TratoI18n:{uiText:k=>k},TratoCloud:cloud,history:{replaceState(_,title,href){location.href=href;location.hash=new URL(href).hash;}},addEventListener(k,fn){handlers[k]=fn;}};
  const context=vm.createContext({document:{querySelector:element,querySelectorAll:()=>links},window,location,URL,localStorage});
  vm.runInContext(readFileSync(new URL('../app.js',`file://${__filename}`),'utf8'),context);
  return {element,handlers,location,renders,links};
}
test('the shell renders the connected workspace without demo data or a local demo store',()=>{
  const shell=loadShell('#clientes');
  assert.equal(shell.renders.length,1);assert.equal(shell.renders[0].target,shell.element('#client-workspace'));
  assert.equal(shell.element('#crumb').textContent,'Clientes');
  assert.equal(shell.links.find(n=>n.dataset.view==='clientes').attributes['aria-current'],'page');
});
test('obsolete standalone demo routes resolve to the studio overview',()=>{
  for(const hash of ['#cambios','#cobros','#reembolsos','#unknown']){
    const shell=loadShell(hash);assert.equal(shell.location.hash,'#inicio');
    assert.equal(shell.element('#crumb').textContent,'Vista general');
  }
});
test('refreshing a supported tab preserves it and its breadcrumb',()=>{
  for(const [hash,label] of [['#ensayos','practice.title'],['#reputacion','reputation.title'],['#clientes','Clientes']]){
    const shell=loadShell(hash);shell.handlers.hashchange();
    assert.equal(shell.location.hash,hash);assert.equal(shell.element('#crumb').textContent,label);
    assert.equal(shell.renders.length,2);
  }
});
test('sidebar toggling keeps visibility and accessible state aligned',()=>{
  const shell=loadShell();const toggle=shell.element('#sidebar-toggle');
  shell.handlers['#sidebar-toggle:click']();assert.equal(shell.element('#trato-sidebar').hidden,true);assert.equal(toggle.attributes['aria-expanded'],'false');
  shell.handlers['#sidebar-toggle:click']();assert.equal(shell.element('#trato-sidebar').hidden,false);assert.equal(toggle.attributes['aria-expanded'],'true');
});
test('a closed sidebar stays closed after a reload and a reopened one stays open',()=>{
  const saved=new Map(),localStorage={getItem:key=>saved.get(key)??null,setItem:(key,value)=>saved.set(key,value)};
  const first=loadShell('#inicio',localStorage);assert.equal(first.element('#trato-sidebar').hidden,false);
  first.handlers['#sidebar-toggle:click']();
  const second=loadShell('#inicio',localStorage);assert.equal(second.element('#trato-sidebar').hidden,true);assert.equal(second.element('#sidebar-toggle').attributes['aria-expanded'],'false');
  second.handlers['#sidebar-toggle:click']();
  assert.equal(loadShell('#inicio',localStorage).element('#trato-sidebar').hidden,false);
});
test('the sidebar opens normally when the browser refuses its storage',()=>{
  const blocked={getItem(){throw new Error('blocked');},setItem(){throw new Error('blocked');}};
  const shell=loadShell('#inicio',blocked);assert.equal(shell.element('#trato-sidebar').hidden,false);
  shell.handlers['#sidebar-toggle:click']();assert.equal(shell.element('#trato-sidebar').hidden,true);
});
