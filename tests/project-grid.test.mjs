import test from 'node:test';
import assert from 'node:assert/strict';
import {projectGridRows,projectGridLocale} from '../project-grid.mjs';
import {setUiLanguage} from '../i18n.mjs';
import {gridLocaleKeys} from '../project-grid-locale-keys.mjs';
import {createGrid,ModuleRegistry,ClientSideRowModelModule,QuickFilterModule} from '../assets/vendor/project-grid-vendor.mjs';
test('the table contains only the selected client and existing directory fields',()=>{
 const projects=[{id:'a',client_id:'client-a',name:'First',created_at:'2026-11-03T00:00:00Z',secret:'not a column'}, {id:'b',client_id:'client-b',name:'Other'}];
 assert.deepEqual(projectGridRows(projects,'client-a'),[{id:'a',name:'First',created_at:'2026-11-03T00:00:00Z'}]);
 assert.deepEqual(projectGridRows(projects,'missing'),[]);
 assert.equal(projects[0].secret,'not a column');
});
test('vendor accessibility and status text uses the selected catalogue without losing variable placeholders',()=>{
 const previousWindow=globalThis.window,previousDocument=globalThis.document;globalThis.window={localStorage:{setItem(){}}};globalThis.document={documentElement:{}};
 try{for(const language of ['es','en']){
  setUiLanguage(language,{persist:false});const locale=projectGridLocale();
  assert.equal(Object.keys(locale).length,gridLocaleKeys.length);
  assert.equal(locale.noRowsToShow,language==='es'?'No hay filas para mostrar':'No Rows To Show');
  assert.ok(locale.filterSummaryTextQuote.includes('${variable}'));
 }
 }finally{setUiLanguage('es');if(previousWindow===undefined)delete globalThis.window;else globalThis.window=previousWindow;if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;}
});
test('the local vendor bundle exposes only the selected Community entry points',()=>{
 assert.equal(typeof createGrid,'function');assert.equal(typeof ModuleRegistry.registerModules,'function');
 assert.equal(ClientSideRowModelModule.moduleName,'ClientSideRowModel');assert.equal(QuickFilterModule.moduleName,'QuickFilter');
});
