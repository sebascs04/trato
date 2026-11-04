import {uiText,uiLocale} from './i18n.mjs';
import {icon} from './icons.mjs';
import {gridLocaleKeys} from './project-grid-locale-keys.mjs';
const t=(key,values)=>uiText(['projectGrid',key].join('.'),values);
export function projectGridRows(projects,clientId){
 return projects.filter(project=>project.client_id===clientId).map(project=>({id:project.id,name:project.name,created_at:project.created_at||null}));
}
export function projectGridLocale(){
 // Preserve AG Grid's substitution templates; its locale service supplies values.
 const variables=Object.fromEntries(['variable','chartType','count','min','max','start','end','value'].map(name=>[name,'{'+name+'}']));
 return Object.fromEntries(gridLocaleKeys.map(key=>[key,uiText(['projectGrid','vendor',key].join('.'),variables)]));
}
export function installProjectGrid(cloud){
 let api=null,generation=0;const layouts=new Map();
 function release(){generation++;api?.destroy();api=null;}
 const originalReset=cloud.reset.bind(cloud);
 cloud.reset=function(){release();layouts.clear();return originalReset();};
 const originalRender=cloud.renderWorkspace.bind(cloud);
 cloud.renderWorkspace=function(workspace){
  release();originalRender(workspace);
  const directory=workspace.querySelector('.cloud-project-directory');
  if(!directory||!cloud.active||cloud.state!=='ready'||!cloud.navigationOwner||!cloud.clientId||cloud.projectId||cloud.projectsLoading)return;
  const owner=cloud.navigationOwner,client=cloud.clientId,key=owner+':'+client,run=generation;
  if(!layouts.has(key))layouts.set(key,{mode:'list',query:''});
  const state=layouts.get(key),heading=directory.querySelector('h3');if(!heading)return;
  const list=cloud.document.createElement('div');list.className='project-grid-original';
  while(heading.nextSibling)list.append(heading.nextSibling);directory.append(list);
  const tools=cloud.document.createElement('div');tools.className='project-grid-tools';
  const toggle=cloud.document.createElement('button');toggle.type='button';toggle.className='text-button';toggle.dataset.projectGridToggle='';toggle.setAttribute('aria-pressed',String(state.mode==='table'));
  toggle.textContent=t(state.mode==='table'?'showList':'showTable');toggle.addEventListener('click',()=>{state.mode=state.mode==='table'?'list':'table';cloud.notify();});tools.append(toggle);heading.after(tools);
  if(state.mode!=='table')return;
  list.hidden=true;
  const label=cloud.document.createElement('label');label.className='project-grid-search';
  const glyph=cloud.document.createElement('span');glyph.innerHTML=icon('search');
  const input=cloud.document.createElement('input');input.type='search';input.placeholder=t('search');input.setAttribute('aria-label',t('search'));input.value=state.query;
  label.append(glyph,input);tools.prepend(label);
  const table=cloud.document.createElement('div');table.className='project-grid-table';table.style.height=Math.min(390,Math.max(140,projectGridRows(cloud.projects,client).length*60+48))+'px';table.setAttribute('aria-label',t('title'));directory.append(table);
  const loading=cloud.document.createElement('p');loading.setAttribute('role','status');loading.textContent=t('loading');table.append(loading);
  const current=()=>run===generation&&table.isConnected&&cloud.active&&cloud.navigationOwner===owner&&cloud.clientId===client&&!cloud.projectId;
  input.addEventListener('input',()=>{state.query=input.value;if(current())api?.setGridOption('quickFilterText',state.query);});
  void import('/assets/vendor/project-grid-vendor.mjs').then(({createGrid,ModuleRegistry,ClientSideRowModelModule,QuickFilterModule,themeQuartz})=>{
   if(!current())return;
   ModuleRegistry.registerModules([ClientSideRowModelModule,QuickFilterModule]);table.replaceChildren();
   api=createGrid(table,{
    theme:themeQuartz.withParams({fontFamily:'Manrope, sans-serif',fontSize:13,accentColor:'#8060b0',backgroundColor:'#ffffff',foregroundColor:'#40324d',borderColor:'#e7e0ef',headerBackgroundColor:'#faf8fc',rowHeight:60,headerHeight:46,wrapperBorderRadius:12}),
    localeText:projectGridLocale(),rowData:projectGridRows(cloud.projects,client),getRowId:params=>params.data.id,
    quickFilterText:state.query,animateRows:false,suppressMovableColumns:true,enableCellTextSelection:true,
    defaultColDef:{sortable:true,resizable:true,suppressHeaderMenuButton:true,suppressHeaderFilterButton:true},
    icons:{sortAscending:icon('arrow-up'),sortDescending:icon('arrow-down'),sortUnSort:icon('arrow-up-down')},
    columnDefs:[
     {field:'name',headerName:t('name'),flex:1,minWidth:180},
     {field:'created_at',headerName:t('created'),width:170,valueFormatter:params=>params.value?new Intl.DateTimeFormat(uiLocale(),{dateStyle:'medium',timeZone:'America/Lima'}).format(new Date(params.value)):t('noDate')},
     {colId:'actions',headerName:t('actions'),width:190,sortable:false,resizable:false,cellRenderer:params=>{
      const actions=cloud.document.createElement('div');actions.className='project-grid-actions';
      const remove=cloud.document.createElement('button');remove.type='button';remove.className='cloud-icon-button';remove.dataset.cloudAction='project-delete';remove.dataset.cloudId=params.data.id;remove.setAttribute('aria-label',t('delete',{name:params.data.name}));remove.title=t('delete',{name:params.data.name});remove.innerHTML=icon('trash-2');
      const open=cloud.document.createElement('button');open.type='button';open.className='text-button';open.dataset.cloudAction='project-open';open.dataset.cloudId=params.data.id;open.setAttribute('aria-label',t('openNamed',{name:params.data.name}));open.append(cloud.document.createTextNode(t('open')));const arrow=cloud.document.createElement('span');arrow.innerHTML=icon('arrow-up-right');open.append(arrow);
      actions.append(remove,open);return actions;
     }}
    ]
   });
  }).catch(()=>{
   if(!current())return;api?.destroy();api=null;table.replaceChildren();
   const message=cloud.document.createElement('p');message.className='cloud-error';message.setAttribute('role','alert');message.textContent=t('error');
   const retry=cloud.document.createElement('button');retry.type='button';retry.className='button secondary';retry.textContent=t('retry');retry.addEventListener('click',()=>cloud.notify());table.append(message,retry);
  });
 };
 return release;
}
