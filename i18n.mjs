import es from './locales/es.mjs';
import en from './locales/en.mjs';

const catalogs={es,en};
const storageKey='trato:ui-language';
let language='es';
if(typeof window!=='undefined'){
 const saved=window.localStorage.getItem(storageKey);
 if(saved!==null){if(!Object.hasOwn(catalogs,saved))throw Error('Unsupported Trato language');language=saved;}
 document.documentElement.lang=language;
}
export const uiLanguage=()=>language;
export const uiLocale=()=>language==='es'?'es-PE':'en-US';
export function textForLanguage(target,key,values={}){
 if(!Object.hasOwn(catalogs,target))throw Error('Unsupported Trato language');
 if(!Object.hasOwn(catalogs[target],key))throw Error('Missing translation: '+key);
 return catalogs[target][key].replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g,(_,name)=>{
  if(!Object.hasOwn(values,name))throw Error('Missing translation parameter: '+name);
  return String(values[name]);
 });
}
export function uiText(key,values={}){
 return textForLanguage(language,key,values);
}
export function setUiLanguage(next){
 if(!Object.hasOwn(catalogs,next))throw Error('Unsupported Trato language');
 if(next===language)return false;
 window.localStorage.setItem(storageKey,next);language=next;document.documentElement.lang=next;return true;
}
// One pass over the static page, before private workspace data is mounted.
// Rendered user names, sources, messages and email bodies never pass through this function.
export function localizeStaticDocument(root=document){
 const walker=document.createTreeWalker(root.documentElement,NodeFilter.SHOW_TEXT);
 const nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);
 for(const node of nodes){
  if(node.parentElement?.closest('script,style,[data-i18n-content]'))continue;
  const key=node.nodeValue.trim();
  if(Object.hasOwn(es,key))node.nodeValue=node.nodeValue.replace(key,uiText(key));
 }
 for(const node of root.querySelectorAll('[aria-label],[title],[placeholder],[alt],[aria-valuetext]'))for(const attr of ['aria-label','title','placeholder','alt','aria-valuetext']){
  const key=node.getAttribute(attr);if(key&&Object.hasOwn(es,key))node.setAttribute(attr,uiText(key));
 }
 root.documentElement.lang=language;
}
export function installLanguagePreference(cloud){
 const mount=()=>{
  const modal=cloud.modal;if(!modal?.open||modal.querySelector('[data-ui-language]'))return;
  if(!modal.querySelector('.cloud-identity,form[data-cloud-form="auth"]'))return;
  const section=document.createElement('section');section.className='cloud-language-preference';
  const label=document.createElement('label');label.htmlFor='trato-ui-language';label.textContent=uiText('profile.language');
  const select=document.createElement('select');select.id='trato-ui-language';select.dataset.uiLanguage='';select.className='context-box';
  for(const [value,name]of [['es','Español'],['en','English']]){const option=document.createElement('option');option.value=value;option.textContent=name;select.append(option);}
  select.value=language;
  select.addEventListener('change',()=>{
   try{cloud.saveNavigation?.();if(setUiLanguage(select.value))window.location.reload();}
   catch{select.value=language;modal.querySelector('[data-cloud-error]').textContent=uiText('profile.languageError');}
  });
  section.append(label,select);const identity=modal.querySelector('.cloud-identity');if(identity)identity.after(section);else modal.append(section);
 };
 const observer=new MutationObserver(mount);observer.observe(document.body,{childList:true,subtree:true});mount();
 return ()=>observer.disconnect();
}
if(typeof window!=='undefined')window.TratoI18n={uiText,uiLocale,uiLanguage};
