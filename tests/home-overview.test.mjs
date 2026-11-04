import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ConnectedWorkspace} from '../connected-workspace.mjs';

function workspace(){
 const app=new ConnectedWorkspace({document:{},location:{origin:'http://localhost:5173',hash:'#inicio'},storage:{},fetchFn:()=>{throw Error('Inicio must not request additional data');}});
 app.active=true;
 return app;
}

test('Inicio keeps an empty account actionable without fabricating a project or financial totals',()=>{
 const app=workspace(),panel={};app.renderHome(panel);
 assert.match(panel.innerHTML,/data-cloud-action="client"/);
 assert.equal((panel.innerHTML.match(/data-cloud-action="client"/g)||[]).length,1);
 assert.doesNotMatch(panel.innerHTML,/data-cloud-action="home-tab"/);
 assert.match(panel.innerHTML,/href="#reputacion"/);assert.match(panel.innerHTML,/href="#ensayos"/);
});

test('Inicio shows at most two authorized clients and a demonstration instead of project details',()=>{
 const app=workspace(),panel={};
 app.clients=[{id:'client-1',name:'<img src=x>',contact_email:'a&b@example.com'},{id:'client-2',name:'Second'},{id:'client-3',name:'Third hidden'}];
 app.projects=[{id:'project-1',client_id:'client-1',name:'Private project title'}];app.projectId='project-1';
 app.renderHome(panel);
 assert.match(panel.innerHTML,/a&amp;b@example.com/);assert.match(panel.innerHTML,/&lt;img src=x&gt;/);
 assert.doesNotMatch(panel.innerHTML,/<img src=x>|Third hidden|Private project title|data-cloud-action="home-tab"/);
 assert.equal((panel.innerHTML.match(/data-cloud-action="client-open"/g)||[]).length,2);
 assert.match(panel.innerHTML,/data-demo-open/);assert.match(panel.innerHTML,/data-cloud-action="clients"/);
});

test('project shortcuts preserve selected IDs and navigate to the requested project section',()=>{
 for(const tab of ['asistente','solicitudes']){
  const app=workspace();app.projects=[{id:'p',client_id:'c'}];app.projectId='p';app.clientId='c';let notified=0;app.notify=()=>notified++;
  app.click({target:{closest:()=>({dataset:{cloudAction:'home-tab',cloudTab:tab}})}});
  assert.equal(app.tab,tab);assert.equal(app.location.hash,'clientes');assert.equal(app.projectId,'p');assert.equal(app.clientId,'c');assert.equal(notified,1);
 }
});

test('project shortcuts cannot bypass missing context or busy state or select an unsupported section',()=>{
 for(const state of [{busy:true},{loading:true},{missing:true},{tab:'revision'}]){
  const app=workspace();app.projects=state.missing?[]:[{id:'p'}];app.projectId='p';Object.assign(app,{busy:!!state.busy,loading:!!state.loading});
  app.notify=()=>{throw Error('Blocked shortcut must not navigate');};
  app.click({target:{closest:()=>({dataset:{cloudAction:'home-tab',cloudTab:state.tab||'asistente'}})}});
  assert.equal(app.location.hash,'#inicio');assert.equal(app.tab,'acuerdo');
 }
});
