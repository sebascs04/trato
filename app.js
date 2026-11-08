// Connected studio shell. Business data and access belong to ConnectedWorkspace.
const {uiText}=window.TratoI18n;
const cloud=window.TratoCloud;
if(!cloud)throw new Error(uiText("No pudimos recuperar tu espacio. Vuelve a intentar."));
const labels={inicio:uiText("Vista general"),clientes:uiText("Clientes"),ensayos:uiText('practice.title'),reputacion:uiText('reputation.title'),acuerdos:uiText("Mis proyectos")};
function renderView(){
  let view=location.hash.slice(1)||'inicio';
  if(view==='kb'||view==='conversaciones')view='clientes';
  if(!Object.hasOwn(labels,view))view='inicio';
  if(location.hash&&location.hash!==`#${view}`){
    const url=new URL(location.href);url.hash=view;window.history.replaceState(null,'',url.href);
  }
  for(const link of document.querySelectorAll('[data-view]')){
    const selected=link.dataset.view===view;
    link.classList.toggle('active',selected);
    if(selected)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');
  }
  document.querySelector('#crumb').textContent=labels[view];
  const workspace=document.querySelector('#client-workspace');
  cloud.renderWorkspace(workspace);
  cloud.syncChrome();
}
function setSidebarCollapsed(collapsed){
  document.querySelector('#trato-sidebar').hidden=collapsed;
  document.querySelector('.shell').classList.toggle('sidebar-is-hidden',collapsed);
  const toggle=document.querySelector('#sidebar-toggle');
  toggle.setAttribute('aria-expanded',String(!collapsed));
  const label=uiText(collapsed?'Mostrar barra lateral':'Ocultar barra lateral');
  toggle.setAttribute('aria-label',label);toggle.setAttribute('title',label);
}
document.querySelector('#sidebar-toggle').addEventListener('click',()=>{
  setSidebarCollapsed(!document.querySelector('#trato-sidebar').hidden);
});
window.addEventListener('hashchange',renderView);
cloud.attach(renderView);
