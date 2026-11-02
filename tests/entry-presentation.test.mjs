import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {entryPresentation} from '../visitor-landing.mjs';

test('initial HTML hides the studio before scripts or session requests finish',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(html,/<html[^>]*class="trato-starting"/);
 const guard=html.slice(html.indexOf('<style>'),html.indexOf('</style>'));
 for(const selector of ['body > .sidebar','body > .shell','#visitor-landing'])assert.ok(guard.includes(selector));
 assert.match(guard,/display:\s*none\s*!important/);
 assert.ok(html.indexOf('</style>')<html.indexOf('src="/boot.js"'));
 assert.match(html,/<div id="boot-status"[^>]*role="status"/);
});

test('cached credentials cannot reveal the studio until session verification succeeds',()=>{
 const cloud={demoMode:false,active:false,state:'loading',session:{session:{access_token:'cached'}}};
 assert.equal(entryPresentation(cloud),'loading');
 cloud.state='ready';assert.equal(entryPresentation(cloud),'loading');
 cloud.active=true;assert.equal(entryPresentation(cloud),'workspace');
 cloud.session.session=null;assert.equal(entryPresentation(cloud),'loading');
});

test('anonymous or failed session restoration shows the public entry, including cached-token failures',()=>{
 for(const session of [null,{access_token:'expired'}]){
  const cloud={demoMode:false,active:false,state:'anonymous',session:{session}};
  assert.equal(entryPresentation(cloud),'visitor');
  cloud.state='error';assert.equal(entryPresentation(cloud),'visitor');
  cloud.state='loading';assert.equal(entryPresentation(cloud),'loading');
 }
});

test('obsolete demo flags cannot bypass the connected entry gate',()=>{
 const cloud={demoMode:false,active:false,state:'error'};
 assert.equal(entryPresentation(cloud),'visitor');
 cloud.demoMode=true;assert.equal(entryPresentation(cloud),'visitor');
});
